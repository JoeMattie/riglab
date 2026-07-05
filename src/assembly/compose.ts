// 3D assembly composition (§5.4) — explicitly NOT a 3D solver. Each mechanism
// solves in its own plane; this layer lifts those 2D results into world space
// through instance transforms, resolves transform-drive (fixed / glued to a
// wearer anchor / driven by two solved nodes of another instance), and rolls
// up total mass, CG, and the seesaw balance report. Pure and framework-free:
// it consumes plain solve() output + a wearer SkeletonFrame and returns plain
// records, so it is unit-testable without any UI or three.js.
import type { Assembly, AttachTarget, Quaternion, Vec2, Vec3 } from '../schema';
import type { SkeletonFrame } from '../wearer/skeleton';
import {
  add,
  cross,
  dot,
  IDENTITY_Q,
  mulQ,
  normalize,
  quatFromBasis,
  rotate,
  scale,
  sub,
} from './math3';

export const GRAVITY = 9.80665;

/** Per-instance solve products the caller feeds in, keyed by instance id. */
export interface InstanceSolveData {
  /** solved 2D node positions in the mechanism's local plane */
  nodes: Record<string, Vec2>;
  /** optional distributed masses in local 2D space — e.g. link midpoints with
   * mass = developed length × linear density (resolved by the BOM layer). */
  localMasses?: LocalMass[];
}

export interface LocalMass {
  pos: Vec2;
  massKg: number;
  name?: string;
}

export interface ComposedInstance {
  instanceId: string;
  origin: Vec3;
  rot: Quaternion;
  mirror: boolean;
  /** solved nodes lifted into world space */
  nodeWorld: Record<string, Vec3>;
}

export type MassSource = 'pointMass' | 'foamPlate' | 'link';

export interface WorldMass {
  id: string;
  name: string;
  massKg: number;
  world: Vec3;
  source: MassSource;
}

export interface Composition {
  instances: Record<string, ComposedInstance>;
  masses: WorldMass[];
  totalMassKg: number;
  /** center of gravity; {0,0,0} when the assembly is massless */
  cg: Vec3;
}

export interface ComposeOptions {
  /** sheet density (kg/m²) per foam material id, for foam-plate mass */
  sheetDensityKgPerM2?: Record<string, number>;
}

/** Resolve an attach target to a world point given the composed instances and
 * the wearer frame. Returns null if the target dangles (missing instance/node). */
export function resolveAttach(
  target: AttachTarget,
  instances: Record<string, ComposedInstance>,
  wearer: SkeletonFrame,
): Vec3 | null {
  if (target.kind === 'wearerAnchor') {
    return wearer.anchors[target.anchor] ?? null;
  }
  const inst = instances[target.instanceId];
  return inst?.nodeWorld[target.nodeId] ?? null;
}

function liftNode(local: Vec2, origin: Vec3, rot: Quaternion, mirror: boolean): Vec3 {
  const lx = mirror ? -local.x : local.x;
  return add(origin, rotate(rot, { x: lx, y: local.y, z: 0 }));
}

/** Base drive frame (origin + orientation) an instance is placed relative to.
 * Returns null when a dependency is not yet resolvable. */
function driveFrame(
  drive: Assembly['instances'][number]['transformDrive'],
  instances: Record<string, ComposedInstance>,
  wearer: SkeletonFrame,
): { origin: Vec3; rot: Quaternion } | null {
  switch (drive.kind) {
    case 'fixed':
      return { origin: { x: 0, y: 0, z: 0 }, rot: IDENTITY_Q };
    case 'wearerAnchor': {
      const origin = wearer.anchors[drive.anchor];
      return origin ? { origin, rot: IDENTITY_Q } : null;
    }
    case 'instanceNodes': {
      const parent = instances[drive.instanceId];
      if (!parent) return null;
      const o = parent.nodeWorld[drive.originNodeId];
      const a = parent.nodeWorld[drive.axisNodeId];
      if (!o || !a) return null;
      // local +x → the origin→axis heading; local +y → world up (kept upright
      // so a pitch plane driven by a pan mechanism stands vertical, §5.4).
      const xAxis = normalize(sub(a, o));
      const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
      let zAxis = cross(xAxis, worldUp);
      if (dot(zAxis, zAxis) < 1e-9) zAxis = { x: 0, y: 0, z: 1 }; // heading ∥ up
      zAxis = normalize(zAxis);
      const yAxis = cross(zAxis, xAxis);
      return { origin: o, rot: quatFromBasis(xAxis, yAxis, zAxis) };
    }
  }
}

function polygonAreaM2(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Compose the assembly into world space. Instances with `instanceNodes`
 * drive depend on their parent being composed first; resolution iterates until
 * a fixed point (cyclic/dangling drives are skipped, not crashed). */
export function composeAssembly(
  assembly: Assembly,
  wearer: SkeletonFrame,
  solves: Record<string, InstanceSolveData>,
  opts: ComposeOptions = {},
): Composition {
  const instances: Record<string, ComposedInstance> = {};
  const pending = new Set(assembly.instances.map((i) => i.id));

  // Iteratively resolve instances whose drive dependencies are ready.
  let progressed = true;
  while (pending.size > 0 && progressed) {
    progressed = false;
    for (const inst of assembly.instances) {
      if (!pending.has(inst.id)) continue;
      const base = driveFrame(inst.transformDrive, instances, wearer);
      if (!base) continue; // dependency not ready yet
      const origin = add(base.origin, rotate(base.rot, inst.position));
      const rot = mulQ(base.rot, inst.quaternion);
      const solve = solves[inst.id];
      const nodeWorld: Record<string, Vec3> = {};
      if (solve) {
        for (const [nodeId, p] of Object.entries(solve.nodes)) {
          nodeWorld[nodeId] = liftNode(p, origin, rot, inst.mirror);
        }
      }
      instances[inst.id] = { instanceId: inst.id, origin, rot, mirror: inst.mirror, nodeWorld };
      pending.delete(inst.id);
      progressed = true;
    }
  }

  const masses: WorldMass[] = [];

  // Distributed link masses lifted from each instance's local space.
  for (const inst of assembly.instances) {
    const composed = instances[inst.id];
    const solve = solves[inst.id];
    if (!composed || !solve?.localMasses) continue;
    solve.localMasses.forEach((lm, i) => {
      if (lm.massKg <= 0) return;
      masses.push({
        id: `${inst.id}:link:${i}`,
        name: lm.name ?? inst.name,
        massKg: lm.massKg,
        world: liftNode(lm.pos, composed.origin, composed.rot, inst.mirror),
        source: 'link',
      });
    });
  }

  // Explicit point masses.
  for (const pm of assembly.pointMasses) {
    const world = resolveAttach(pm.attach, instances, wearer);
    if (!world || pm.massKg <= 0) continue;
    masses.push({ id: pm.id, name: pm.name, massKg: pm.massKg, world, source: 'pointMass' });
  }

  // Foam plates: mass = area × sheet density, located at the attach point.
  for (const fp of assembly.foamPlates) {
    const world = resolveAttach(fp.attach, instances, wearer);
    if (!world) continue;
    const area = fp.areaM2 ?? (fp.polygon ? polygonAreaM2(fp.polygon) : 0);
    const density = fp.sheetMaterialId ? (opts.sheetDensityKgPerM2?.[fp.sheetMaterialId] ?? 0) : 0;
    const massKg = area * density;
    if (massKg <= 0) continue;
    masses.push({ id: fp.id, name: fp.name, massKg, world, source: 'foamPlate' });
  }

  let totalMassKg = 0;
  let acc: Vec3 = { x: 0, y: 0, z: 0 };
  for (const m of masses) {
    totalMassKg += m.massKg;
    acc = add(acc, scale(m.world, m.massKg));
  }
  const cg = totalMassKg > 0 ? scale(acc, 1 / totalMassKg) : { x: 0, y: 0, z: 0 };

  return { instances, masses, totalMassKg, cg };
}

export interface BalanceQuery {
  /** a point on the pivot axis */
  axisPoint: Vec3;
  /** horizontal pivot-axis direction (e.g. wearer-left +z) */
  axisDir: Vec3;
  /** horizontal "front" direction, perpendicular to the axis (default world +x) */
  frontDir?: Vec3;
  /** where a balancing counterweight would be placed (for the suggestion) */
  counterweightPoint?: Vec3;
}

export interface BalanceReport {
  /** Σ m·g·arm for masses on the front side (N·m) */
  frontMomentNm: number;
  /** Σ m·g·arm for masses on the back side (N·m, positive magnitude) */
  backMomentNm: number;
  /** front − back; positive tips forward */
  netMomentNm: number;
  imbalanceNm: number;
  heavySide: 'front' | 'back' | 'balanced';
  /** counterweight mass at counterweightPoint that zeroes the imbalance */
  suggestedCounterweightKg?: number;
}

/** Seesaw report (§5.4): per-side moment about a chosen horizontal pivot axis
 * under gravity. Only the horizontal lever arm (projection on frontDir) counts;
 * vertical offsets contribute nothing to a moment about a horizontal axis. */
export function balanceReport(masses: WorldMass[], q: BalanceQuery): BalanceReport {
  const front = normalize(q.frontDir ?? { x: 1, y: 0, z: 0 });
  let frontMomentNm = 0;
  let backMomentNm = 0;
  for (const m of masses) {
    const arm = dot(sub(m.world, q.axisPoint), front);
    const moment = m.massKg * GRAVITY * Math.abs(arm);
    if (arm >= 0) frontMomentNm += moment;
    else backMomentNm += moment;
  }
  const netMomentNm = frontMomentNm - backMomentNm;
  const imbalanceNm = Math.abs(netMomentNm);
  const heavySide = imbalanceNm < 1e-9 ? 'balanced' : netMomentNm > 0 ? 'front' : 'back';

  let suggestedCounterweightKg: number | undefined;
  if (q.counterweightPoint && imbalanceNm > 1e-9) {
    const arm = dot(sub(q.counterweightPoint, q.axisPoint), front);
    // counterweight must sit on the light side to oppose the tip
    const onHeavySide = (arm >= 0 && heavySide === 'front') || (arm < 0 && heavySide === 'back');
    if (!onHeavySide && Math.abs(arm) > 1e-6) {
      suggestedCounterweightKg = imbalanceNm / (GRAVITY * Math.abs(arm));
    }
  }

  return {
    frontMomentNm,
    backMomentNm,
    netMomentNm,
    imbalanceNm,
    heavySide,
    suggestedCounterweightKg,
  };
}
