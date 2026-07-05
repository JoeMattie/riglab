// Pipe-and-fittings model (PLANFILE-quad-workspace slice 3): turns composed
// world-space mechanisms into a flat list of solid primitives — true-OD pipe
// cylinders, fitting bodies at realized joints, sleeves/bands/pins for the
// other realizations — for the 3D "Pipe model" render. Composed primitives,
// not CAD: BOM still owns cut math (socket-depth trimming is not modeled).
// Pure and unit-testable without WebGL.
import type {
  FittingType,
  MaterialsDb,
  Mechanism,
  MechanismElement,
  PipeMaterial,
  Vec3,
} from '../schema';
import { add, cross, dot, normalize, scale, sub } from './math3';

/** Default OD for sketch-maturity stand-ins (3/4" NPS look, §4.2 generic
 * pipe). Shared with the wireframe tube extraction. */
export const GENERIC_PIPE_OD_M = 0.0267;

/** Socket depth used when no fitting row matches the member's pipe size. */
const DEFAULT_SOCKET_DEPTH_M = 0.035;

export type PipeRole = 'pipe' | 'fitting' | 'sleeve' | 'band' | 'pin';

export interface PipeCylinder {
  kind: 'cylinder';
  a: Vec3;
  b: Vec3;
  radiusM: number;
  role: PipeRole;
  /** sketch-maturity stand-in (rendered translucent) */
  ghost: boolean;
}

export interface PipeSphere {
  kind: 'sphere';
  center: Vec3;
  radiusM: number;
  ghost: boolean;
}

export interface PipeBox {
  kind: 'box';
  center: Vec3;
  halfExtentM: number;
  ghost: boolean;
}

export type PipePrimitive = PipeCylinder | PipeSphere | PipeBox;

export interface PipeModel {
  prims: PipePrimitive[];
  /** pipe-role cylinders (segments of actual pipe) */
  pipeCount: number;
  /** joints rendered as commercial fitting bodies */
  fittingCount: number;
  /** primitives standing in for sketch-maturity elements */
  ghostCount: number;
}

/** One composed mechanism to model: its solved world nodes, and whether the
 * whole mechanism is an unplaced ghost preview. */
export interface PipeModelItem {
  mechanismId: string;
  nodeWorld: Record<string, Vec3 | undefined>;
  ghost?: boolean;
}

/** Which commercial fitting a `fitting`-realized joint becomes, from the
 * directions of its members leaving the joint (§6.2). Two members nearly
 * straight-through → coupling; two at an angle → elbow (90 vs 45 by which is
 * closer); three → tee; four or more → cross. */
export function classifyFitting(dirs: Vec3[]): FittingType {
  if (dirs.length >= 4) return 'cross';
  if (dirs.length === 3) return 'tee';
  if (dirs.length === 2) {
    // deviation from straight continuation: 0 = collinear pass-through
    const cosDev = dot(dirs[0]!, scale(dirs[1]!, -1));
    const devDeg = (Math.acos(Math.max(-1, Math.min(1, cosDev))) * 180) / Math.PI;
    if (devDeg <= 30) return 'coupling';
    return devDeg >= 67.5 ? 'elbow90' : 'elbow45';
  }
  return 'cap';
}

interface MemberAtJoint {
  dir: Vec3;
  radiusM: number;
  pipe: PipeMaterial | undefined;
  engineered: boolean;
}

/** Direction a member element leaves a joint node in, with its pipe radius. */
function memberAtJoint(
  el: MechanismElement,
  nodeId: string,
  nodeWorld: PipeModelItem['nodeWorld'],
  pipeOf: (id: string | undefined) => PipeMaterial | undefined,
): MemberAtJoint | null {
  let otherId: string | undefined;
  let pipe: PipeMaterial | undefined;
  if (el.type === 'link') {
    otherId = el.nodeA === nodeId ? el.nodeB : el.nodeB === nodeId ? el.nodeA : undefined;
    pipe = pipeOf(el.pipeMaterialId);
  } else if (el.type === 'telescope') {
    otherId = el.nodeA === nodeId ? el.nodeB : el.nodeB === nodeId ? el.nodeA : undefined;
    pipe = pipeOf(el.outerPipeMaterialId);
  } else if (el.type === 'bentLink') {
    const i = el.nodeIds.indexOf(nodeId);
    if (i >= 0) otherId = el.nodeIds[i + 1] ?? el.nodeIds[i - 1];
    pipe = pipeOf(el.pipeMaterialId);
  }
  if (!otherId) return null;
  const p = nodeWorld[nodeId];
  const q = nodeWorld[otherId];
  if (!p || !q) return null;
  const d = sub(q, p);
  if (dot(d, d) < 1e-12) return null;
  const engineered = el.maturity === 'engineered' && !!pipe;
  return {
    dir: normalize(d),
    radiusM: (engineered && pipe ? pipe.outerDiameterM : GENERIC_PIPE_OD_M) / 2,
    pipe,
    engineered,
  };
}

/** Any unit vector perpendicular to `d` (bolt pins on collinear members). */
function anyPerpendicular(d: Vec3): Vec3 {
  const up: Vec3 = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalize(cross(d, up));
}

/** Build the solid pipe model for a set of composed mechanisms. */
export function buildPipeModel(
  mechanisms: Mechanism[],
  items: PipeModelItem[],
  materials: MaterialsDb,
): PipeModel {
  const prims: PipePrimitive[] = [];
  let pipeCount = 0;
  let fittingCount = 0;
  const mechById = new Map(mechanisms.map((m) => [m.id, m]));
  const pipeOf = (id: string | undefined) => materials.pipes.find((p) => p.id === id);

  const socketDepth = (type: FittingType, pipe: PipeMaterial | undefined): number => {
    if (!pipe) return DEFAULT_SOCKET_DEPTH_M;
    const row = materials.fittings.find(
      (f) =>
        f.type === type &&
        f.sizingSystem === pipe.sizingSystem &&
        f.nominalSize === pipe.nominalSize,
    );
    return row?.socketDepthM ?? DEFAULT_SOCKET_DEPTH_M;
  };

  for (const item of items) {
    const mech = mechById.get(item.mechanismId);
    if (!mech) continue;
    const world = item.nodeWorld;
    const at = (id: string) => world[id];

    const pushPipe = (a: Vec3, b: Vec3, radiusM: number, ghost: boolean) => {
      prims.push({ kind: 'cylinder', a, b, radiusM, role: 'pipe', ghost });
      pipeCount++;
    };

    // ── pipe runs ─────────────────────────────────────────────────────────
    for (const el of mech.elements) {
      if (el.type === 'link' || el.type === 'bentLink') {
        const pipe = pipeOf(el.pipeMaterialId);
        const engineered = el.maturity === 'engineered' && !!pipe;
        const r = (engineered && pipe ? pipe.outerDiameterM : GENERIC_PIPE_OD_M) / 2;
        const ghost = !!item.ghost || !engineered;
        const ids = el.type === 'link' ? [el.nodeA, el.nodeB] : el.nodeIds;
        for (let i = 1; i < ids.length; i++) {
          const a = at(ids[i - 1]!);
          const b = at(ids[i]!);
          if (a && b) pushPipe(a, b, r, ghost);
        }
      } else if (el.type === 'telescope') {
        const a = at(el.nodeA);
        const b = at(el.nodeB);
        if (!a || !b) continue;
        const outer = pipeOf(el.outerPipeMaterialId);
        const inner = pipeOf(el.innerPipeMaterialId);
        if (el.maturity === 'engineered' && outer && inner) {
          // outer member from A, inner member from B, meeting over the overlap
          const d = sub(b, a);
          const len = Math.sqrt(dot(d, d));
          if (len < 1e-9) continue;
          const dir = scale(d, 1 / len);
          const overlap = el.overlapM ?? 2 * inner.outerDiameterM;
          const reach = Math.min(len, len / 2 + overlap / 2);
          pushPipe(a, add(a, scale(dir, reach)), outer.outerDiameterM / 2, !!item.ghost);
          pushPipe(b, sub(b, scale(dir, reach)), inner.outerDiameterM / 2, !!item.ghost);
        } else {
          pushPipe(a, b, GENERIC_PIPE_OD_M / 2, true);
        }
      }
    }

    // ── joints ────────────────────────────────────────────────────────────
    const elById = new Map(mech.elements.map((e) => [e.id, e]));
    const jointNodes = new Set<string>();

    for (const el of mech.elements) {
      const isJoint = el.type === 'pivot' || el.type === 'slider';
      if (!isJoint) continue;
      const nodeId = el.nodeId;
      jointNodes.add(nodeId);
      const pos = at(nodeId);
      if (!pos || !el.realization) continue;

      const memberIds = el.type === 'pivot' ? el.memberIds : [el.alongElementId];
      const members = memberIds
        .map((id) => {
          const m = elById.get(id);
          return m ? memberAtJoint(m, nodeId, world, pipeOf) : null;
        })
        .filter((m): m is MemberAtJoint => m !== null);
      if (members.length === 0) continue;
      const maxR = Math.max(...members.map((m) => m.radiusM));
      const ghost = !!item.ghost || members.every((m) => !m.engineered);

      switch (el.realization) {
        case 'fitting': {
          const type = classifyFitting(members.map((m) => m.dir));
          for (const m of members) {
            const lenM = socketDepth(type, m.pipe) * 1.6;
            prims.push({
              kind: 'cylinder',
              a: pos,
              b: add(pos, scale(m.dir, lenM)),
              radiusM: maxR * 1.3,
              role: 'fitting',
              ghost,
            });
          }
          fittingCount++;
          break;
        }
        case 'nestedSleeve':
        case 'nestedCoupler': {
          const dir = members[0]!.dir;
          prims.push({
            kind: 'cylinder',
            a: add(pos, scale(dir, -0.05)),
            b: add(pos, scale(dir, 0.05)),
            radiusM: maxR * 1.18,
            role: 'sleeve',
            ghost,
          });
          break;
        }
        case 'heatWrapPivot':
        case 'heatWrapRigid':
        case 'ropeLashing':
        case 'clickDetachable': {
          const dir = members[0]!.dir;
          prims.push({
            kind: 'cylinder',
            a: add(pos, scale(dir, -0.018)),
            b: add(pos, scale(dir, 0.018)),
            radiusM: maxR * 1.12,
            role: 'band',
            ghost,
          });
          break;
        }
        case 'boltThrough': {
          const d1 = members[0]!.dir;
          const d2 = members[1]?.dir;
          let axis = d2 ? cross(d1, d2) : anyPerpendicular(d1);
          axis = dot(axis, axis) < 1e-9 ? anyPerpendicular(d1) : normalize(axis);
          const reach = maxR * 2.2;
          prims.push({
            kind: 'cylinder',
            a: add(pos, scale(axis, -reach)),
            b: add(pos, scale(axis, reach)),
            radiusM: 0.004,
            role: 'pin',
            ghost,
          });
          break;
        }
        case 'conduitBox':
          prims.push({ kind: 'box', center: pos, halfExtentM: 0.035, ghost });
          break;
      }
    }

    // ── bare junctions: tube elements meeting with no joint element ───────
    const nodeMembers = new Map<string, MemberAtJoint[]>();
    for (const el of mech.elements) {
      const ends =
        el.type === 'link' || el.type === 'telescope'
          ? [el.nodeA, el.nodeB]
          : el.type === 'bentLink'
            ? [el.nodeIds[0]!, el.nodeIds[el.nodeIds.length - 1]!]
            : [];
      for (const nodeId of ends) {
        const m = memberAtJoint(el, nodeId, world, pipeOf);
        if (!m) continue;
        const list = nodeMembers.get(nodeId) ?? [];
        list.push(m);
        nodeMembers.set(nodeId, list);
      }
    }
    for (const [nodeId, members] of nodeMembers) {
      if (members.length < 2 || jointNodes.has(nodeId)) continue;
      const pos = at(nodeId);
      if (!pos) continue;
      prims.push({
        kind: 'sphere',
        center: pos,
        radiusM: Math.max(...members.map((m) => m.radiusM)) * 1.02,
        ghost: !!item.ghost || members.every((m) => !m.engineered),
      });
    }
  }

  return { prims, pipeCount, fittingCount, ghostCount: prims.filter((p) => p.ghost).length };
}
