// Static equilibrium mode (§5.1 mode 2) + force extraction (§5.2), fully 3D
// (PLANFILE-3d-conversion.md).
//
// Pseudo-dynamic relaxation: integrate the mechanism particles under gravity
// and spring forces with heavy damping (×0.85/step) and an XPBD position
// projection each step, until the fastest particle drops below ε or an
// iteration cap. This settles the pose the real rig would sag into. Forces
// are then read from the XPBD Lagrange multipliers via a single gravity-loaded
// measurement substep from the settled pose (force = λ/Δt² per unit gradient).
//
// Gravity is global −y and always available (the per-mechanism gravityOn flag
// is gone); hinge pivots gain a solver-internal virtual axis particle
// (hinge.ts); spherical pivots are the plain shared node.
//
// Determinism (§12, DECISIONS.md): fixed timestep, fixed iteration counts,
// constraints projected in id order, no Math.random. Same input ⇒ identical
// output.
//
// The solver is pure and framework-free (§12): schema data in, plain data out.
import type { InputChannel, Mechanism, MechanismElement, Vec3 } from '../schema';
import {
  adjacentNodeId,
  angle3,
  drawnAngle3,
  type HingePlan,
  hingePlan,
  rotateAboutAxis,
} from './hinge';
import type { SolveDiagnostics, SolveForces, SolveInputs, SolveResult } from './types';

// ── tuned constants (all fixed for determinism) ──────────────────────────
const G = 9.81; // m/s²
const DT = 0.01; // s — timestep; equilibrium pose is Δt-independent, this only sets convergence rate
const INV_DT2 = 1 / (DT * DT);
const DAMPING = 0.85; // velocity ×0.85/step (§5.1)
const ITERS = 40; // Gauss–Seidel projection iterations per substep
const WARM_ITERS = 200; // constraint-only warm-start iterations (no dynamics)
const MAX_STEPS = 6000; // relaxation step cap
const SETTLE_SPEED_EPS = 1e-6; // m/s — "settled" threshold on max particle speed
// Pose-quiescence fallback settle criterion (Phase 3): a tension-only
// constraint at its active boundary makes the settle creep so its max speed
// plateaus above SETTLE_SPEED_EPS though the pose is already at rest. Declare
// settled when no free particle drifts more than POSE_QUIESCENCE_EPS over a
// POSE_QUIESCENCE_WINDOW-substep window. EPS = 1e-4 m is 10× finer than the
// tightest equilibrium position assertion (1e-3 m), so a pose this still is
// settled for reporting; WINDOW = 400 substeps (= 4.0 s at DT) is long enough
// that a genuinely transient (still-swinging) pose drifts well past EPS, so
// this never pre-empts a normal settle (verified against every equilibrium
// acceptance case — see DECISIONS.md "Phase 3 — solver robustness").
const POSE_QUIESCENCE_WINDOW = 400; // substeps
const POSE_QUIESCENCE_EPS = 1e-4; // m — max free-particle drift over the window
const RESIDUAL_TOL = 1e-4; // m — constraint-violation tolerance for `converged`
const GENERIC_NODE_MASS = 1; // kg — inverse-mass conditioning for massless free nodes (no gravity)
const COMP_TOL = 1e-3; // N — rope axial force below −tol ⇒ "requires compression"
const GRAVITY: Vec3 = { x: 0, y: -G, z: 0 }; // global −y, always on

// ── particle ─────────────────────────────────────────────────────────────
interface Particle {
  id: string;
  x: number;
  y: number;
  z: number;
  px: number; // previous position (for velocity)
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  w: number; // inverse mass used by projection (0 = held)
  mass: number; // true mass (kg) — drives gravity and force balance
  held: boolean; // anchor, driven, or drag-held: position is prescribed
}

const len3 = (dx: number, dy: number, dz: number): number => Math.sqrt(dx * dx + dy * dy + dz * dz);
const unit = (dx: number, dy: number, dz: number): [number, number, number] => {
  const l = len3(dx, dy, dz);
  return l < 1e-12 ? [0, 0, 0] : [dx / l, dy / l, dz / l];
};
const dist3 = (a: Vec3, b: Vec3): number => len3(a.x - b.x, a.y - b.y, a.z - b.z);

// ── driven-node input channels (semantics defined in Phase 2, DECISIONS.md) ─
interface DriveRef {
  nodeId: string;
  channel: InputChannel;
  kind: 'angle' | 'displacement';
  pivot: Vec3; // angle: rotation centre · displacement: axis origin
  drawn: Vec3; // node's drawn position
  axis: Vec3; // displacement: unit drive direction
  /** angle: unit rotation axis — the pivot's hinge axis when a hinge pivot
   * element sits at the reference node, else +z (the 2D-parity rotation) */
  rotAxis: Vec3;
}

/** Effective channel value: a locked channel ignores overrides and holds its
 * stored value (set-screw analogue, §4.2); an unlocked channel takes the
 * caller's override for its name if present, else its stored value. */
export function channelValue(channel: InputChannel, inputs: SolveInputs): number {
  if (channel.locked) return channel.value;
  const override = inputs.channelValues[channel.name];
  return override === undefined ? channel.value : override;
}

/** Reference frame a driven node moves in: the axis/pivot of the lowest-id
 * link/telescope incident to it (its "rail"); failing that, the line from the
 * lowest-id anchor; failing that, the world +x axis through the drawn point.
 * Angle channels rotate about the reference node's hinge axis when one is
 * declared there (lowest-id hinge pivot element), else about +z. */
function driveRefs(mechanism: Mechanism): DriveRef[] {
  const posOf = new Map(mechanism.nodes.map((n) => [n.id, n.position]));
  const channelById = new Map(mechanism.inputs.map((c) => [c.id, c]));
  const refs: DriveRef[] = [];
  for (const n of mechanism.nodes) {
    if (n.kind !== 'driven' || !n.channelId) continue;
    const channel = channelById.get(n.channelId);
    if (!channel) continue;
    const drawn = n.position;
    // rail: lowest-id link/telescope with this node as an endpoint
    let other: Vec3 | null = null;
    let otherId: string | null = null;
    for (const el of [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id))) {
      if (
        (el.type === 'link' || el.type === 'telescope') &&
        (el.nodeA === n.id || el.nodeB === n.id)
      ) {
        otherId = el.nodeA === n.id ? el.nodeB : el.nodeA;
        other = posOf.get(otherId) ?? null;
        if (!other) otherId = null;
        break;
      }
    }
    if (!other) {
      const anchor = [...mechanism.nodes]
        .filter((a) => a.kind === 'anchor' && a.id !== n.id)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (anchor) {
        other = anchor.position;
        otherId = anchor.id;
      } else {
        other = { x: drawn.x - 1, y: drawn.y, z: drawn.z };
      }
    }
    const [ax, ay, az] = unit(drawn.x - other.x, drawn.y - other.y, drawn.z - other.z);
    // hinge axis at the reference node, if a hinge pivot element sits there
    let rotAxis: Vec3 = { x: 0, y: 0, z: 1 };
    if (otherId) {
      for (const el of [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id))) {
        if (el.type === 'pivot' && el.nodeId === otherId && el.joint.kind === 'hinge') {
          const [kx, ky, kz] = unit(el.joint.axis.x, el.joint.axis.y, el.joint.axis.z);
          if (kx !== 0 || ky !== 0 || kz !== 0) rotAxis = { x: kx, y: ky, z: kz };
          break;
        }
      }
    }
    refs.push({
      nodeId: n.id,
      channel,
      kind: channel.kind,
      pivot: other,
      drawn,
      axis: ax === 0 && ay === 0 && az === 0 ? { x: 1, y: 0, z: 0 } : { x: ax, y: ay, z: az },
      rotAxis,
    });
  }
  return refs;
}

/** Prescribed position of a driven node for a channel value. */
function drivenPosition(ref: DriveRef, value: number): Vec3 {
  if (ref.kind === 'angle') {
    const v: Vec3 = {
      x: ref.drawn.x - ref.pivot.x,
      y: ref.drawn.y - ref.pivot.y,
      z: ref.drawn.z - ref.pivot.z,
    };
    const r = rotateAboutAxis(v, ref.rotAxis, value);
    return { x: ref.pivot.x + r.x, y: ref.pivot.y + r.y, z: ref.pivot.z + r.z };
  }
  // displacement: slide along the rail axis by `value` metres from drawn
  return {
    x: ref.drawn.x + ref.axis.x * value,
    y: ref.drawn.y + ref.axis.y * value,
    z: ref.drawn.z + ref.axis.z * value,
  };
}

/** Public: prescribed positions of all driven nodes, keyed by node id. Shared
 * with kinematic drag so both modes honour input channels identically. */
export function drivenTargets(mechanism: Mechanism, inputs: SolveInputs): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const ref of driveRefs(mechanism)) {
    out[ref.nodeId] = drivenPosition(ref, channelValue(ref.channel, inputs));
  }
  return out;
}

// ── mass accumulation (§5.1) ─────────────────────────────────────────────
/** Chord (sharp polyline) length through the node positions — 3D counterpart
 * of geometry/pipe.ts polylineLengthM (still Vec2 mid-conversion). */
function polyLen(nodeIds: string[], posOf: Map<string, Vec3>): number {
  let total = 0;
  for (let i = 1; i < nodeIds.length; i++) {
    total += dist3(posOf.get(nodeIds[i - 1]!)!, posOf.get(nodeIds[i]!)!);
  }
  return total;
}

/** Node masses: link/bentLink/telescope self-weight (length × density, half to
 * each endpoint) + point masses along links (by parametric t) + node point
 * masses. Each element's density is its per-element override (engineered pipe
 * material, §4.2) if present, else the generic `density`. */
function accumulateMasses(
  mechanism: Mechanism,
  density: number,
  elementDensity: Record<string, number> = {},
): Map<string, number> {
  const posOf = new Map(mechanism.nodes.map((n) => [n.id, n.position]));
  const mass = new Map(mechanism.nodes.map((n) => [n.id, 0]));
  const add = (id: string, m: number): void => {
    mass.set(id, (mass.get(id) ?? 0) + m);
  };
  const densityOf = (id: string): number => elementDensity[id] ?? density;

  for (const el of mechanism.elements) {
    if (el.type === 'link' || el.type === 'telescope') {
      const a = posOf.get(el.nodeA)!;
      const b = posOf.get(el.nodeB)!;
      const len = el.type === 'telescope' ? el.lengthM : dist3(a, b);
      const self = len * densityOf(el.id);
      add(el.nodeA, self / 2);
      add(el.nodeB, self / 2);
      for (const pm of el.pointMasses) {
        add(el.nodeA, pm.massKg * (1 - pm.t));
        add(el.nodeB, pm.massKg * pm.t);
      }
    } else if (el.type === 'bentLink') {
      const self = polyLen(el.nodeIds, posOf) * densityOf(el.id);
      const per = self / el.nodeIds.length;
      for (const id of el.nodeIds) add(id, per);
      // along-body point masses lumped to the two ends by parameter t
      const first = el.nodeIds[0]!;
      const last = el.nodeIds[el.nodeIds.length - 1]!;
      for (const pm of el.pointMasses) {
        add(first, pm.massKg * (1 - pm.t));
        add(last, pm.massKg * pm.t);
      }
    }
  }
  for (const pm of mechanism.pointMasses) add(pm.nodeId, pm.massKg);
  return mass;
}

// ── constraints ──────────────────────────────────────────────────────────
interface EqConstraint {
  elementId: string;
  lambda: number;
  mobility: number; // equalities touching a free particle (Grübler count)
  reset(): void;
  project(): void;
  violation(): number;
  /** add this constraint's force on each incident particle (λ/Δt²·∇C). */
  addForces(force: Map<string, Vec3>): void;
}

function addForce(map: Map<string, Vec3>, id: string, fx: number, fy: number, fz: number): void {
  const f = map.get(id);
  if (f) {
    f.x += fx;
    f.y += fy;
    f.z += fz;
  } else {
    map.set(id, { x: fx, y: fy, z: fz });
  }
}

/** Rigid distance constraint C = |p1−p2| − rest. kind: 'eq' | 'max' (len ≤
 * rest, e.g. a sliding telescope's travel ceiling) | 'min' (len ≥ rest). */
class DistanceC implements EqConstraint {
  lambda = 0;
  constructor(
    readonly elementId: string,
    private readonly p1: Particle,
    private readonly p2: Particle,
    private readonly rest: number,
    readonly mobility: number,
    private readonly kind: 'eq' | 'max' | 'min' = 'eq',
  ) {}

  reset(): void {
    this.lambda = 0;
  }

  private cValue(): number {
    const c = len3(this.p1.x - this.p2.x, this.p1.y - this.p2.y, this.p1.z - this.p2.z) - this.rest;
    if (this.kind === 'max') return Math.max(0, c);
    if (this.kind === 'min') return Math.min(0, c);
    return c;
  }

  project(): void {
    const C = this.cValue();
    if (C === 0) return;
    const dx = this.p1.x - this.p2.x;
    const dy = this.p1.y - this.p2.y;
    const dz = this.p1.z - this.p2.z;
    const len = len3(dx, dy, dz);
    if (len < 1e-12) return;
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const denom = this.p1.w + this.p2.w;
    if (denom <= 0) return;
    const dl = -C / denom;
    this.lambda += dl;
    this.p1.x += this.p1.w * dl * nx;
    this.p1.y += this.p1.w * dl * ny;
    this.p1.z += this.p1.w * dl * nz;
    this.p2.x -= this.p2.w * dl * nx;
    this.p2.y -= this.p2.w * dl * ny;
    this.p2.z -= this.p2.w * dl * nz;
  }

  violation(): number {
    return Math.abs(this.cValue());
  }

  addForces(force: Map<string, Vec3>): void {
    const [nx, ny, nz] = unit(this.p1.x - this.p2.x, this.p1.y - this.p2.y, this.p1.z - this.p2.z);
    const f = this.lambda * INV_DT2;
    addForce(force, this.p1.id, f * nx, f * ny, f * nz);
    addForce(force, this.p2.id, -f * nx, -f * ny, -f * nz);
  }

  /** signed axial tension (N): positive = tension pulling the ends together. */
  tension(): number {
    return -this.lambda * INV_DT2;
  }
}

/** Rope: total path length ≤ L0, tension-only, routed through frictionless
 * eyelets (intermediate path nodes). A single length constraint gives uniform
 * tension along the path. */
class RopeC implements EqConstraint {
  lambda = 0;
  readonly mobility = 0; // inequalities don't reduce DOF (§5.3)
  constructor(
    readonly elementId: string,
    private readonly nodes: Particle[],
    private readonly l0: number,
    private readonly compliance = 0,
  ) {}

  reset(): void {
    this.lambda = 0;
  }

  private total(): number {
    let t = 0;
    for (let i = 1; i < this.nodes.length; i++) {
      t += len3(
        this.nodes[i]!.x - this.nodes[i - 1]!.x,
        this.nodes[i]!.y - this.nodes[i - 1]!.y,
        this.nodes[i]!.z - this.nodes[i - 1]!.z,
      );
    }
    return t;
  }

  private grads(): Array<[number, number, number]> {
    const g: Array<[number, number, number]> = this.nodes.map(() => [0, 0, 0]);
    for (let i = 0; i < this.nodes.length; i++) {
      const p = this.nodes[i]!;
      if (i > 0) {
        const q = this.nodes[i - 1]!;
        const [ux, uy, uz] = unit(p.x - q.x, p.y - q.y, p.z - q.z);
        g[i]![0] += ux;
        g[i]![1] += uy;
        g[i]![2] += uz;
      }
      if (i < this.nodes.length - 1) {
        const q = this.nodes[i + 1]!;
        const [ux, uy, uz] = unit(p.x - q.x, p.y - q.y, p.z - q.z);
        g[i]![0] += ux;
        g[i]![1] += uy;
        g[i]![2] += uz;
      }
    }
    return g;
  }

  project(): void {
    const C = this.total() - this.l0;
    if (C <= 0) return; // slack: tension-only
    const g = this.grads();
    const at = this.compliance * INV_DT2;
    let denom = at;
    for (let i = 0; i < this.nodes.length; i++) {
      denom += this.nodes[i]!.w * (g[i]![0] * g[i]![0] + g[i]![1] * g[i]![1] + g[i]![2] * g[i]![2]);
    }
    if (denom <= 0) return;
    const dl = (-C - at * this.lambda) / denom;
    this.lambda += dl;
    for (let i = 0; i < this.nodes.length; i++) {
      const p = this.nodes[i]!;
      p.x += p.w * dl * g[i]![0];
      p.y += p.w * dl * g[i]![1];
      p.z += p.w * dl * g[i]![2];
    }
  }

  violation(): number {
    return Math.max(0, this.total() - this.l0);
  }

  addForces(force: Map<string, Vec3>): void {
    const g = this.grads();
    const f = this.lambda * INV_DT2;
    for (let i = 0; i < this.nodes.length; i++) {
      addForce(force, this.nodes[i]!.id, f * g[i]![0], f * g[i]![1], f * g[i]![2]);
    }
  }

  tension(): number {
    return -this.lambda * INV_DT2;
  }
}

/** Pivot angle limit (inequality): clamp the relative hinge angle into
 * [min, max], measured about the pivot's current axis (hinge.ts angle3). */
class AngleLimitC implements EqConstraint {
  lambda = 0;
  readonly mobility = 0;
  constructor(
    readonly elementId: string,
    private readonly pivot: Particle,
    private readonly a: Particle,
    private readonly b: Particle,
    private readonly axisTip: Particle,
    private readonly minRad: number,
    private readonly maxRad: number,
  ) {}

  reset(): void {
    this.lambda = 0;
  }

  private cValue(theta: number): number {
    if (theta < this.minRad) return theta - this.minRad;
    if (theta > this.maxRad) return theta - this.maxRad;
    return 0;
  }

  project(): void {
    const ag = angle3(this.pivot, this.a, this.b, this.pivot, this.axisTip);
    if (!ag) return;
    const C = this.cValue(ag.theta);
    if (C === 0) return;
    const denom =
      this.a.w * (ag.ga.x ** 2 + ag.ga.y ** 2 + ag.ga.z ** 2) +
      this.b.w * (ag.gb.x ** 2 + ag.gb.y ** 2 + ag.gb.z ** 2) +
      this.pivot.w * (ag.gp.x ** 2 + ag.gp.y ** 2 + ag.gp.z ** 2);
    if (denom <= 0) return;
    const s = -C / denom;
    this.a.x += this.a.w * s * ag.ga.x;
    this.a.y += this.a.w * s * ag.ga.y;
    this.a.z += this.a.w * s * ag.ga.z;
    this.b.x += this.b.w * s * ag.gb.x;
    this.b.y += this.b.w * s * ag.gb.y;
    this.b.z += this.b.w * s * ag.gb.z;
    this.pivot.x += this.pivot.w * s * ag.gp.x;
    this.pivot.y += this.pivot.w * s * ag.gp.y;
    this.pivot.z += this.pivot.w * s * ag.gp.z;
  }

  violation(): number {
    const ag = angle3(this.pivot, this.a, this.b, this.pivot, this.axisTip);
    return ag ? Math.abs(this.cValue(ag.theta)) : 0;
  }

  addForces(): void {
    /* angle limits contribute a moment, not a linear pivot reaction */
  }
}

// Springs are integrated as explicit FORCES (§5.1: "integrate particles under
// gravity + spring forces … and XPBD projection each step"), not as compliant
// position constraints — a compliant spring creeps so slowly the relaxation
// can quiesce before it reaches equilibrium. As forces they inject real
// velocity each step and the rigid XPBD projection reacts them, which also
// makes force read-out work for gravity-free coupling mechanisms.
interface ForceGen {
  /** add this element's force to the particles' velocities (Δv = w·F·Δt). */
  apply(): void;
}

/** Linear elastic force = k(len − rest_eff), tension-only by default, along
 * the axis (bungee/rubber can't push). rest_eff folds in pretension. */
function elasticForce(
  el: {
    restLengthM: number;
    stiffnessNPerM: number;
    tensionOnly: boolean;
    pretensionN?: number;
  },
  a: Particle,
  b: Particle,
): number {
  const len = len3(a.x - b.x, a.y - b.y, a.z - b.z);
  const restEff = el.restLengthM - (el.pretensionN ?? 0) / el.stiffnessNPerM;
  const f = el.stiffnessNPerM * (len - restEff);
  return el.tensionOnly ? Math.max(0, f) : f;
}

class ElasticForceGen implements ForceGen {
  constructor(
    private readonly el: {
      restLengthM: number;
      stiffnessNPerM: number;
      tensionOnly: boolean;
      pretensionN?: number;
    },
    private readonly a: Particle,
    private readonly b: Particle,
  ) {}

  apply(): void {
    const f = elasticForce(this.el, this.a, this.b);
    if (f === 0) return;
    const [ux, uy, uz] = unit(this.b.x - this.a.x, this.b.y - this.a.y, this.b.z - this.a.z); // pull A toward B
    this.a.vx += this.a.w * f * ux * DT;
    this.a.vy += this.a.w * f * uy * DT;
    this.a.vz += this.a.w * f * uz * DT;
    this.b.vx -= this.b.w * f * ux * DT;
    this.b.vy -= this.b.w * f * uy * DT;
    this.b.vz -= this.b.w * f * uz * DT;
  }
}

/** Pivot torsion spring — restoring moment τ = −k(θ − rest) applied to the two
 * members (hose-joint flex / fibreglass return rod), about the hinge axis. */
class TorsionSpringForceGen implements ForceGen {
  constructor(
    readonly elementId: string,
    private readonly pivot: Particle,
    private readonly a: Particle,
    private readonly b: Particle,
    private readonly axisTip: Particle,
    private readonly restAngle: number,
    private readonly stiffness: number,
  ) {}

  moment(): number {
    const ag = angle3(this.pivot, this.a, this.b, this.pivot, this.axisTip);
    return ag ? -this.stiffness * (ag.theta - this.restAngle) : 0;
  }

  apply(): void {
    if (this.stiffness <= 0) return;
    const ag = angle3(this.pivot, this.a, this.b, this.pivot, this.axisTip);
    if (!ag) return;
    const tau = -this.stiffness * (ag.theta - this.restAngle); // restoring
    this.a.vx += this.a.w * tau * ag.ga.x * DT;
    this.a.vy += this.a.w * tau * ag.ga.y * DT;
    this.a.vz += this.a.w * tau * ag.ga.z * DT;
    this.b.vx += this.b.w * tau * ag.gb.x * DT;
    this.b.vy += this.b.w * tau * ag.gb.y * DT;
    this.b.vz += this.b.w * tau * ag.gb.z * DT;
    this.pivot.vx += this.pivot.w * tau * ag.gp.x * DT;
    this.pivot.vy += this.pivot.w * tau * ag.gp.y * DT;
    this.pivot.vz += this.pivot.w * tau * ag.gp.z * DT;
  }
}

/** Point-on-line (slider) with parametric travel limits. On-line = 2 removed
 * DOF in 3D; the perpendicular offset is projected out along its own
 * direction each pass. */
class PointOnLineC implements EqConstraint {
  lambda = 0;
  constructor(
    readonly elementId: string,
    private readonly n: Particle,
    private readonly a: Particle,
    private readonly b: Particle,
    private readonly travelMin: number,
    private readonly travelMax: number,
    readonly mobility: number,
  ) {}

  reset(): void {
    this.lambda = 0;
  }

  private apply(C: number, gx: number, gy: number, gz: number, t: number): void {
    if (C === 0) return;
    const denom = this.n.w + this.a.w * (1 - t) * (1 - t) + this.b.w * t * t;
    if (denom <= 0) return;
    const s = -C / denom;
    this.n.x += this.n.w * s * gx;
    this.n.y += this.n.w * s * gy;
    this.n.z += this.n.w * s * gz;
    this.a.x -= this.a.w * (1 - t) * s * gx;
    this.a.y -= this.a.w * (1 - t) * s * gy;
    this.a.z -= this.a.w * (1 - t) * s * gz;
    this.b.x -= this.b.w * t * s * gx;
    this.b.y -= this.b.w * t * s * gy;
    this.b.z -= this.b.w * t * s * gz;
  }

  project(): void {
    const ux = this.b.x - this.a.x;
    const uy = this.b.y - this.a.y;
    const uz = this.b.z - this.a.z;
    const L = len3(ux, uy, uz);
    if (L < 1e-12) return;
    const ex = ux / L;
    const ey = uy / L;
    const ez = uz / L;
    const relx = this.n.x - this.a.x;
    const rely = this.n.y - this.a.y;
    const relz = this.n.z - this.a.z;
    const s = relx * ex + rely * ey + relz * ez;
    const t = s / L;
    const px = relx - s * ex;
    const py = rely - s * ey;
    const pz = relz - s * ez;
    const cPerp = len3(px, py, pz);
    if (cPerp > 1e-12) this.apply(cPerp, px / cPerp, py / cPerp, pz / cPerp, t);
    if (s < this.travelMin * L) this.apply(s - this.travelMin * L, ex, ey, ez, t);
    else if (s > this.travelMax * L) this.apply(s - this.travelMax * L, ex, ey, ez, t);
  }

  violation(): number {
    const ux = this.b.x - this.a.x;
    const uy = this.b.y - this.a.y;
    const uz = this.b.z - this.a.z;
    const L = len3(ux, uy, uz);
    if (L < 1e-12) return 0;
    const relx = this.n.x - this.a.x;
    const rely = this.n.y - this.a.y;
    const relz = this.n.z - this.a.z;
    const s = (relx * ux + rely * uy + relz * uz) / L;
    const cPerp = len3(relx - (s / L) * ux, rely - (s / L) * uy, relz - (s / L) * uz);
    return Math.max(
      cPerp,
      Math.max(0, this.travelMin * L - s),
      Math.max(0, s - this.travelMax * L),
    );
  }

  addForces(): void {
    /* slider reactions not reported as element/pivot forces in Phase 2 */
  }
}

/** Bowden displacement coupling: (lenA−lenA0)+(lenB−lenB0)=0, routing-
 * independent brake-cable drive. Modelled as a bilateral coupling (fixed total
 * cable length); reports cable tension from λ. */
class BowdenC implements EqConstraint {
  lambda = 0;
  readonly mobility = 1;
  constructor(
    readonly elementId: string,
    private readonly a1: Particle,
    private readonly a2: Particle,
    private readonly b1: Particle,
    private readonly b2: Particle,
    private readonly restA: number,
    private readonly restB: number,
  ) {}

  reset(): void {
    this.lambda = 0;
  }

  private cValue(): number {
    const lenA = len3(this.a1.x - this.a2.x, this.a1.y - this.a2.y, this.a1.z - this.a2.z);
    const lenB = len3(this.b1.x - this.b2.x, this.b1.y - this.b2.y, this.b1.z - this.b2.z);
    return lenA - this.restA + (lenB - this.restB);
  }

  project(): void {
    const [uAx, uAy, uAz] = unit(
      this.a1.x - this.a2.x,
      this.a1.y - this.a2.y,
      this.a1.z - this.a2.z,
    );
    const [uBx, uBy, uBz] = unit(
      this.b1.x - this.b2.x,
      this.b1.y - this.b2.y,
      this.b1.z - this.b2.z,
    );
    const denom = this.a1.w + this.a2.w + this.b1.w + this.b2.w;
    if (denom <= 0) return;
    const dl = -this.cValue() / denom;
    this.lambda += dl;
    this.a1.x += this.a1.w * dl * uAx;
    this.a1.y += this.a1.w * dl * uAy;
    this.a1.z += this.a1.w * dl * uAz;
    this.a2.x -= this.a2.w * dl * uAx;
    this.a2.y -= this.a2.w * dl * uAy;
    this.a2.z -= this.a2.w * dl * uAz;
    this.b1.x += this.b1.w * dl * uBx;
    this.b1.y += this.b1.w * dl * uBy;
    this.b1.z += this.b1.w * dl * uBz;
    this.b2.x -= this.b2.w * dl * uBx;
    this.b2.y -= this.b2.w * dl * uBy;
    this.b2.z -= this.b2.w * dl * uBz;
  }

  violation(): number {
    return Math.abs(this.cValue());
  }

  addForces(): void {
    /* cable tension reported via element force, not as a pivot reaction */
  }

  tension(): number {
    return Math.abs(this.lambda * INV_DT2);
  }
}

/** Torsion cable angle coupling with a backlash dead-zone:
 * (θB−θB0) = ratio·(θA−θA0), each angle measured about its OWN pivot's
 * current hinge axis (non-parallel axes couple fine), free play of ±backlash
 * before it transmits. */
class TorsionCableC implements EqConstraint {
  lambda = 0;
  readonly mobility = 0;
  constructor(
    readonly elementId: string,
    private readonly pa: Particle,
    private readonly aa: Particle,
    private readonly ba: Particle,
    private readonly axisTipA: Particle,
    private readonly pb: Particle,
    private readonly ab: Particle,
    private readonly bb: Particle,
    private readonly axisTipB: Particle,
    private readonly thetaA0: number,
    private readonly thetaB0: number,
    private readonly ratio: number,
    private readonly backlash: number,
  ) {}

  reset(): void {
    this.lambda = 0;
  }

  project(): void {
    const A = angle3(this.pa, this.aa, this.ba, this.pa, this.axisTipA);
    const B = angle3(this.pb, this.ab, this.bb, this.pb, this.axisTipB);
    if (!A || !B) return;
    const raw = B.theta - this.thetaB0 - this.ratio * (A.theta - this.thetaA0);
    // dead-zone: only the part of `raw` beyond ±backlash transmits
    const excess =
      raw > this.backlash ? raw - this.backlash : raw < -this.backlash ? raw + this.backlash : 0;
    if (excess === 0) return;
    // effective gradient per node: ∂raw/∂θB·(θB grads) − ratio·(θA grads)
    const contrib: Array<[Particle, Vec3, number]> = [
      [this.ab, B.ga, 1],
      [this.bb, B.gb, 1],
      [this.pb, B.gp, 1],
      [this.aa, A.ga, -this.ratio],
      [this.ba, A.gb, -this.ratio],
      [this.pa, A.gp, -this.ratio],
    ];
    let denom = 0;
    for (const [p, g, f] of contrib) denom += p.w * f * f * (g.x * g.x + g.y * g.y + g.z * g.z);
    if (denom <= 0) return;
    const dl = -excess / denom;
    this.lambda += dl;
    for (const [p, g, f] of contrib) {
      p.x += p.w * dl * f * g.x;
      p.y += p.w * dl * f * g.y;
      p.z += p.w * dl * f * g.z;
    }
  }

  violation(): number {
    const A = angle3(this.pa, this.aa, this.ba, this.pa, this.axisTipA);
    const B = angle3(this.pb, this.ab, this.bb, this.pb, this.axisTipB);
    if (!A || !B) return 0;
    const raw = B.theta - this.thetaB0 - this.ratio * (A.theta - this.thetaA0);
    return raw > this.backlash
      ? raw - this.backlash
      : raw < -this.backlash
        ? -this.backlash - raw
        : 0;
  }

  addForces(): void {
    /* transmitted torque reported via element force */
  }

  transmittedTorque(): number {
    return this.lambda * INV_DT2;
  }
}

// ── build ──────────────────────────────────────────────────────────────
interface Built {
  particles: Map<string, Particle>;
  userIds: Set<string>;
  constraints: EqConstraint[];
  forceGens: ForceGen[];
  torsionSpringByPivot: Map<string, TorsionSpringForceGen>;
  elementById: Map<string, MechanismElement>;
  pivotByElementId: Map<
    string,
    { pivotNodeId: string; aId: string; bId: string; axisVirtualId?: string } | null
  >;
  freeCount: number;
  freeVirtualCount: number;
}

/** Ground plane y ≥ 0 for free USER particles (v6 slice C, world y). A pure
 * position clamp: no λ (contact reactions are out of scope), no mobility
 * cost. Virtual axis particles are exempt (solver internals). */
class FloorC implements EqConstraint {
  readonly elementId = '__floor__';
  lambda = 0;
  readonly mobility = 0;
  constructor(private readonly p: Particle) {}

  reset(): void {}

  project(): void {
    if (this.p.held) return;
    if (this.p.y < 0) this.p.y = 0;
  }

  violation(): number {
    return this.p.held ? 0 : Math.max(0, -this.p.y);
  }

  addForces(): void {}
}

function build(mechanism: Mechanism, inputs: SolveInputs): Built {
  const density = inputs.linkDensityKgPerM ?? 0;
  const masses = accumulateMasses(mechanism, density, inputs.elementLinearDensityKgPerM ?? {});
  const targets = drivenTargets(mechanism, inputs);

  const particles = new Map<string, Particle>();
  for (const n of mechanism.nodes) {
    // A drag-targeted free node is held AT its target: the drag is an
    // external holder — the wearer's body via a skeleton binding (§7), or a
    // hand — that supplies whatever reaction the pose demands, so a linkage
    // hung off the shoulder dangles from it. Anchor/driven nodes ignore
    // drags, mirroring kinematic mode.
    // a drag hold below the floor is clamped onto it — the holder's hand
    // cannot be underground (slice C; the floor is global in 3D)
    const dragHoldRaw = n.kind === 'free' ? inputs.dragTargets?.[n.id] : undefined;
    const dragHold = dragHoldRaw
      ? { x: dragHoldRaw.x, y: Math.max(0, dragHoldRaw.y), z: dragHoldRaw.z }
      : undefined;
    const held = n.kind === 'anchor' || n.kind === 'driven' || dragHold !== undefined;
    // anchor nodes attached to the wearer (anchorBindings) are held AT the
    // caller's ground target — the pack frame / body carries the ground point
    const prescribed =
      n.kind === 'driven'
        ? targets[n.id]
        : n.kind === 'anchor'
          ? inputs.groundTargets?.[n.id]
          : dragHold;
    const pos = prescribed ?? n.position;
    const mass = masses.get(n.id) ?? 0;
    particles.set(n.id, {
      id: n.id,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      px: pos.x,
      py: pos.y,
      pz: pos.z,
      vx: 0,
      vy: 0,
      vz: 0,
      w: held ? 0 : mass > 0 ? 1 / mass : 1 / GENERIC_NODE_MASS,
      mass,
      held,
    });
  }
  const userIds = new Set(mechanism.nodes.map((n) => n.id));
  const get = (id: string): Particle => {
    const p = particles.get(id);
    if (!p) throw new Error(`unknown node ${id}`);
    return p;
  };
  const posOf = new Map(mechanism.nodes.map((n) => [n.id, n.position]));
  const elementById = new Map(mechanism.elements.map((e) => [e.id, e]));
  const sortedElements = [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id));

  // virtual axis particles for hinge pivots (hinge.ts) — created before the
  // constraint pass; massless (no gravity), generic conditioning mass, in the
  // free list unless pinned to a grounded axis
  const hingePlans = new Map<string, HingePlan>();
  let freeVirtualCount = 0;
  for (const el of sortedElements) {
    if (el.type !== 'pivot') continue;
    const plan = hingePlan(el, posOf, elementById, (id) => get(id).held);
    if (!plan) continue;
    hingePlans.set(el.id, plan);
    const pivot = get(plan.pivotNodeId);
    const x = pivot.x + plan.axis.x * plan.h;
    const y = pivot.y + plan.axis.y * plan.h;
    const z = pivot.z + plan.axis.z * plan.h;
    particles.set(plan.virtualId, {
      id: plan.virtualId,
      x,
      y,
      z,
      px: x,
      py: y,
      pz: z,
      vx: 0,
      vy: 0,
      vz: 0,
      w: plan.pinned ? 0 : 1 / GENERIC_NODE_MASS,
      mass: 0,
      held: plan.pinned,
    });
    if (!plan.pinned) freeVirtualCount++;
  }

  const free = new Set(mechanism.nodes.filter((n) => n.kind === 'free').map((n) => n.id));
  for (const plan of hingePlans.values()) if (!plan.pinned) free.add(plan.virtualId);
  const mob = (...ids: string[]): number => (ids.some((id) => free.has(id)) ? 1 : 0);
  const dist = (a: string, b: string): number => dist3(posOf.get(a)!, posOf.get(b)!);

  const constraints: EqConstraint[] = [];
  const forceGens: ForceGen[] = [];
  const torsionSpringByPivot = new Map<string, TorsionSpringForceGen>();
  const pivotByElementId = new Map<
    string,
    { pivotNodeId: string; aId: string; bId: string; axisVirtualId?: string } | null
  >();

  for (const el of sortedElements) {
    switch (el.type) {
      case 'link':
        constraints.push(
          new DistanceC(
            el.id,
            get(el.nodeA),
            get(el.nodeB),
            dist(el.nodeA, el.nodeB),
            mob(el.nodeA, el.nodeB),
          ),
        );
        break;
      case 'telescope':
        if (el.sliding) {
          constraints.push(
            new DistanceC(el.id, get(el.nodeA), get(el.nodeB), el.maxLengthM, 0, 'max'),
            new DistanceC(el.id, get(el.nodeA), get(el.nodeB), el.minLengthM, 0, 'min'),
          );
        } else {
          constraints.push(
            new DistanceC(el.id, get(el.nodeA), get(el.nodeB), el.lengthM, mob(el.nodeA, el.nodeB)),
          );
        }
        break;
      case 'bentLink': {
        const ids = el.nodeIds;
        let mobilityLeft = 3 * ids.length - 6;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const counts = mobilityLeft > 0 ? mob(ids[i]!, ids[j]!) : 0;
            constraints.push(
              new DistanceC(el.id, get(ids[i]!), get(ids[j]!), dist(ids[i]!, ids[j]!), counts),
            );
            if (counts > 0) mobilityLeft--;
          }
        }
        break;
      }
      case 'pivot': {
        for (const [ea, eb] of el.welds) {
          const elA = elementById.get(ea);
          const elB = elementById.get(eb);
          if (!elA || !elB) continue;
          const a = adjacentNodeId(elA, el.nodeId);
          const b = adjacentNodeId(elB, el.nodeId);
          if (!a || !b) continue;
          constraints.push(new DistanceC(el.id, get(a), get(b), dist(a, b), mob(a, b)));
        }
        const plan = hingePlans.get(el.id);
        if (plan) {
          const virtual = get(plan.virtualId);
          constraints.push(
            new DistanceC(
              el.id,
              virtual,
              get(plan.pivotNodeId),
              plan.h,
              mob(plan.virtualId, plan.pivotNodeId),
            ),
          );
          for (const tie of plan.ties) {
            constraints.push(
              new DistanceC(
                el.id,
                virtual,
                get(tie.nodeId),
                tie.rest,
                mob(plan.virtualId, tie.nodeId),
              ),
            );
          }
        }
        // angle features are hinge-only (measured about the axis)
        if (el.angleLimit && plan) {
          const a = elementById.get(el.angleLimit.memberA);
          const b = elementById.get(el.angleLimit.memberB);
          const an = a ? adjacentNodeId(a, el.nodeId) : null;
          const bn = b ? adjacentNodeId(b, el.nodeId) : null;
          if (an && bn) {
            constraints.push(
              new AngleLimitC(
                el.id,
                get(el.nodeId),
                get(an),
                get(bn),
                get(plan.virtualId),
                el.angleLimit.minRad,
                el.angleLimit.maxRad,
              ),
            );
          }
        }
        if (el.torsionSpring && plan) {
          const a = elementById.get(el.torsionSpring.memberA);
          const b = elementById.get(el.torsionSpring.memberB);
          const an = a ? adjacentNodeId(a, el.nodeId) : null;
          const bn = b ? adjacentNodeId(b, el.nodeId) : null;
          if (an && bn) {
            const gen = new TorsionSpringForceGen(
              el.id,
              get(el.nodeId),
              get(an),
              get(bn),
              get(plan.virtualId),
              el.torsionSpring.restAngleRad,
              el.torsionSpring.stiffnessNmPerRad,
            );
            forceGens.push(gen);
            torsionSpringByPivot.set(el.id, gen);
          }
        }
        // record the pivot's two reference members for torsion-cable coupling
        const first = el.memberIds[0] ? elementById.get(el.memberIds[0]) : undefined;
        const second = el.memberIds[1] ? elementById.get(el.memberIds[1]) : undefined;
        const an = first ? adjacentNodeId(first, el.nodeId) : null;
        const bn = second ? adjacentNodeId(second, el.nodeId) : null;
        pivotByElementId.set(
          el.id,
          an && bn
            ? { pivotNodeId: el.nodeId, aId: an, bId: bn, axisVirtualId: plan?.virtualId }
            : null,
        );
        break;
      }
      case 'slider': {
        const rail = elementById.get(el.alongElementId);
        if (rail && (rail.type === 'link' || rail.type === 'telescope')) {
          constraints.push(
            new PointOnLineC(
              el.id,
              get(el.nodeId),
              get(rail.nodeA),
              get(rail.nodeB),
              el.travelMin,
              el.travelMax,
              mob(el.nodeId) ? 2 : 0,
            ),
          );
        }
        break;
      }
      case 'rope':
        constraints.push(new RopeC(el.id, el.path.map(get), el.lengthM));
        break;
      case 'elastic':
        forceGens.push(new ElasticForceGen(el, get(el.nodeA), get(el.nodeB)));
        break;
      case 'bowden':
        constraints.push(
          new BowdenC(
            el.id,
            get(el.a1),
            get(el.a2),
            get(el.b1),
            get(el.b2),
            el.restLengthAM,
            el.restLengthBM,
          ),
        );
        break;
      case 'torsionCable':
        // deferred: needs both pivots resolved (built after the loop)
        break;
    }
  }

  // torsion cables reference pivot elements; wire them now that pivots exist.
  // Each angle is measured about its OWN pivot's hinge axis — both pivots
  // must be hinges (spherical joints carry no angle features, planfile).
  for (const el of sortedElements) {
    if (el.type !== 'torsionCable') continue;
    const pa = pivotByElementId.get(el.pivotA);
    const pb = pivotByElementId.get(el.pivotB);
    if (!pa || !pb || !pa.axisVirtualId || !pb.axisVirtualId) continue;
    const planA = hingePlans.get(el.pivotA)!;
    const planB = hingePlans.get(el.pivotB)!;
    const thetaA0 = drawnAngle3(
      posOf.get(pa.pivotNodeId)!,
      posOf.get(pa.aId)!,
      posOf.get(pa.bId)!,
      planA.axis,
    );
    const thetaB0 = drawnAngle3(
      posOf.get(pb.pivotNodeId)!,
      posOf.get(pb.aId)!,
      posOf.get(pb.bId)!,
      planB.axis,
    );
    constraints.push(
      new TorsionCableC(
        el.id,
        get(pa.pivotNodeId),
        get(pa.aId),
        get(pa.bId),
        get(pa.axisVirtualId),
        get(pb.pivotNodeId),
        get(pb.aId),
        get(pb.bId),
        get(pb.axisVirtualId),
        thetaA0,
        thetaB0,
        el.ratio,
        el.backlashRad,
      ),
    );
  }

  // ground plane (v6 slice C, world y in 3D): free USER particles cannot
  // settle below y = 0. Appended last so every projection pass ends
  // floor-satisfied — it never enters `violated`; geometry that cannot stay
  // above it reports on its own elements. Held particles (anchor/driven/
  // drag-held) are prescribed and exempt; virtual axis particles are solver
  // internals and exempt. Contact reactions are NOT reported (addForces is a
  // no-op) — positional only.
  for (const n of mechanism.nodes) {
    if (n.kind === 'free') constraints.push(new FloorC(get(n.id)));
  }

  return {
    particles,
    userIds,
    constraints,
    forceGens,
    torsionSpringByPivot,
    elementById,
    pivotByElementId,
    freeCount: free.size - freeVirtualCount,
    freeVirtualCount,
  };
}

// ── settle + measure ─────────────────────────────────────────────────────
/** Apply gravity + spring forces to the free particles' velocities, integrate,
 * and project the rigid constraints. Returns the max resulting particle speed. */
function substep(built: Built, free: Particle[]): number {
  for (const p of free) {
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    if (p.mass > 0) {
      p.vx += GRAVITY.x * DT;
      p.vy += GRAVITY.y * DT;
      p.vz += GRAVITY.z * DT;
    }
  }
  for (const g of built.forceGens) g.apply();
  for (const p of free) {
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    p.z += p.vz * DT;
  }
  for (const c of built.constraints) c.reset();
  for (let it = 0; it < ITERS; it++) {
    for (const c of built.constraints) c.project();
  }
  let maxSpeed = 0;
  for (const p of free) {
    p.vx = ((p.x - p.px) / DT) * DAMPING;
    p.vy = ((p.y - p.py) / DT) * DAMPING;
    p.vz = ((p.z - p.pz) / DT) * DAMPING;
    maxSpeed = Math.max(maxSpeed, len3(p.vx, p.vy, p.vz));
  }
  return maxSpeed;
}

function settle(built: Built): boolean {
  const free = [...built.particles.values()].filter((p) => !p.held);
  if (free.length === 0) return true;
  // Constraint-only warm start: propagate driven-input steps and any drawn
  // rigid-constraint violations onto the manifold WITHOUT the velocity ringing
  // a hard step would otherwise inject (a coupling's projection would snap a
  // node clear across a backlash dead-zone and clamp on the wrong edge).
  for (const c of built.constraints) c.reset();
  for (let it = 0; it < WARM_ITERS; it++) {
    for (const c of built.constraints) c.project();
  }
  for (const p of free) {
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
  }
  // Pose-quiescence fallback (Phase 3 solver-robustness). A tension-only
  // constraint held at its active boundary makes the relaxation *creep* rather
  // than quiesce: each substep the load re-tautens the rope (the projection is
  // skipped when marginally slack and applied when marginally taut), so the
  // pose crawls toward equilibrium at a near-constant, overdamped rate and the
  // max particle SPEED plateaus just above SETTLE_SPEED_EPS — the answer (pose
  // + tension) is already correct but `settle` never reports it. So in addition
  // to the speed test we declare the pose settled once no free particle has
  // moved more than POSE_QUIESCENCE_EPS over a POSE_QUIESCENCE_WINDOW-substep
  // window: net drift over a window, robust to the boundary alternation and
  // strictly a fallback (a still-moving transient drifts well past the eps, so
  // this never pre-empts a genuinely converging settle — see DECISIONS.md).
  let snapX = free.map((p) => p.x);
  let snapY = free.map((p) => p.y);
  let snapZ = free.map((p) => p.z);
  for (let step = 0; step < MAX_STEPS; step++) {
    if (substep(built, free) < SETTLE_SPEED_EPS) return true;
    if ((step + 1) % POSE_QUIESCENCE_WINDOW === 0) {
      let maxDrift = 0;
      for (let i = 0; i < free.length; i++) {
        maxDrift = Math.max(
          maxDrift,
          len3(free[i]!.x - snapX[i]!, free[i]!.y - snapY[i]!, free[i]!.z - snapZ[i]!),
        );
      }
      if (maxDrift < POSE_QUIESCENCE_EPS) return true;
      snapX = free.map((p) => p.x);
      snapY = free.map((p) => p.y);
      snapZ = free.map((p) => p.z);
    }
  }
  return false;
}

/** One loaded substep from the settled pose to read static forces from the
 * rigid-constraint λ (force = λ/Δt²). The gravity + spring loads present at
 * equilibrium are exactly what the rigid constraints react, so their λ is the
 * static force — this works for massless coupling mechanisms too (the load is
 * a spring or a driven displacement). Positions are restored afterwards. */
function measure(built: Built): Map<string, Vec3> {
  const { particles } = built;
  const free = [...particles.values()].filter((p) => !p.held);
  const savedX = new Map(
    [...particles].map(([id, p]) => [id, [p.x, p.y, p.z, p.vx, p.vy, p.vz] as const]),
  );
  for (const p of free) {
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
  }
  substep(built, free);
  const force = new Map<string, Vec3>();
  for (const c of built.constraints) c.addForces(force);
  for (const [id, p] of particles) {
    const s = savedX.get(id)!;
    p.x = s[0];
    p.y = s[1];
    p.z = s[2];
    p.vx = s[3];
    p.vy = s[4];
    p.vz = s[5];
  }
  return force;
}

// ── rope-compression diagnostic (§5.2) ───────────────────────────────────
// A design "relies on a rope pushing" when, at the as-drawn pose, the static
// force balance puts a taut rope in compression. We assemble the nodal force
// balance over two-force members (links, telescopes, taut ropes), with
// gravity + elastic loads on the right-hand side, and least-squares solve for
// the member axial forces. Ropes drawn slack (path length < L0) carry nothing
// and are never flagged. Reported independently of the settled pose, which is
// a collapsed equilibrium when a rope can't do its job.
function ropesRequiringCompression(
  mechanism: Mechanism,
  density: number,
  elementDensity: Record<string, number>,
  dragHeldIds: ReadonlySet<string>,
): string[] {
  if (!mechanism.elements.some((e) => e.type === 'rope')) return [];
  const posOf = new Map(mechanism.nodes.map((n) => [n.id, n.position]));
  // drag-held nodes are excluded from the balance: their holder (the wearer's
  // body or a hand) supplies whatever reaction is needed, so members never
  // have to push to support them
  const freeNodes = mechanism.nodes
    .filter((n) => n.kind === 'free' && !dragHeldIds.has(n.id))
    .map((n) => n.id);
  if (freeNodes.length === 0) return [];
  const rowOf = new Map(freeNodes.map((id, i) => [id, i]));
  const masses = accumulateMasses(mechanism, density, elementDensity);

  interface Member {
    ropeId: string | null;
    // contribution of +1 unit tension to each free node's (x,y,z) balance
    terms: Array<{ node: string; dx: number; dy: number; dz: number }>;
  }
  const members: Member[] = [];
  const pathTaut = (path: string[], l0: number): boolean => {
    let t = 0;
    for (let i = 1; i < path.length; i++) {
      t += dist3(posOf.get(path[i - 1]!)!, posOf.get(path[i]!)!);
    }
    return t >= l0 - 1e-6;
  };
  for (const el of [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id))) {
    if (el.type === 'link' || (el.type === 'telescope' && !el.sliding)) {
      const a = posOf.get(el.nodeA)!;
      const b = posOf.get(el.nodeB)!;
      const [ux, uy, uz] = unit(b.x - a.x, b.y - a.y, b.z - a.z);
      members.push({
        ropeId: null,
        terms: [
          { node: el.nodeA, dx: ux, dy: uy, dz: uz }, // tension pulls A toward B
          { node: el.nodeB, dx: -ux, dy: -uy, dz: -uz },
        ],
      });
    } else if (el.type === 'rope' && pathTaut(el.path, el.lengthM)) {
      const terms: Array<{ node: string; dx: number; dy: number; dz: number }> = [];
      for (let i = 0; i < el.path.length; i++) {
        const p = posOf.get(el.path[i]!)!;
        let gx = 0;
        let gy = 0;
        let gz = 0;
        if (i > 0) {
          const q = posOf.get(el.path[i - 1]!)!;
          const [ux, uy, uz] = unit(q.x - p.x, q.y - p.y, q.z - p.z);
          gx += ux;
          gy += uy;
          gz += uz;
        }
        if (i < el.path.length - 1) {
          const q = posOf.get(el.path[i + 1]!)!;
          const [ux, uy, uz] = unit(q.x - p.x, q.y - p.y, q.z - p.z);
          gx += ux;
          gy += uy;
          gz += uz;
        }
        terms.push({ node: el.path[i]!, dx: gx, dy: gy, dz: gz });
      }
      members.push({ ropeId: el.id, terms });
    }
  }
  if (members.length === 0) return [];

  // right-hand side: −(gravity + elastic loads) per free node
  const b = new Float64Array(3 * freeNodes.length);
  const addRhs = (node: string, fx: number, fy: number, fz: number): void => {
    const r = rowOf.get(node);
    if (r === undefined) return;
    b[3 * r] = (b[3 * r] ?? 0) - fx;
    b[3 * r + 1] = (b[3 * r + 1] ?? 0) - fy;
    b[3 * r + 2] = (b[3 * r + 2] ?? 0) - fz;
  };
  for (const id of freeNodes) {
    const m = masses.get(id) ?? 0;
    addRhs(id, m * GRAVITY.x, m * GRAVITY.y, m * GRAVITY.z);
  }
  for (const el of mechanism.elements) {
    if (el.type !== 'elastic') continue;
    const a = posOf.get(el.nodeA)!;
    const bb = posOf.get(el.nodeB)!;
    const len = dist3(a, bb);
    const restEff = el.restLengthM - (el.pretensionN ?? 0) / el.stiffnessNPerM;
    let f = el.stiffnessNPerM * (len - restEff);
    if (el.tensionOnly) f = Math.max(0, f);
    const [ux, uy, uz] = unit(bb.x - a.x, bb.y - a.y, bb.z - a.z);
    addRhs(el.nodeA, f * ux, f * uy, f * uz); // pulls A toward B
    addRhs(el.nodeB, -f * ux, -f * uy, -f * uz);
  }

  // A: (3·free) × members. Solve least-squares via normal equations.
  const rows = 3 * freeNodes.length;
  const cols = members.length;
  const A: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let c = 0; c < cols; c++) {
    for (const t of members[c]!.terms) {
      const r = rowOf.get(t.node);
      if (r === undefined) continue;
      A[3 * r]![c] = A[3 * r]![c]! + t.dx;
      A[3 * r + 1]![c] = A[3 * r + 1]![c]! + t.dy;
      A[3 * r + 2]![c] = A[3 * r + 2]![c]! + t.dz;
    }
  }
  const x = leastSquares(A, b, rows, cols);
  if (!x) return [];
  const flagged: string[] = [];
  for (let c = 0; c < cols; c++) {
    if (members[c]!.ropeId && x[c]! < -COMP_TOL) flagged.push(members[c]!.ropeId!);
  }
  return [...new Set(flagged)].sort();
}

/** Min-norm least squares of A x ≈ b via (AᵀA + εI) x = Aᵀb, Gaussian
 * elimination with partial pivoting. Small dense systems only. */
function leastSquares(
  A: number[][],
  b: Float64Array,
  rows: number,
  cols: number,
): Float64Array | null {
  if (cols === 0) return new Float64Array(0);
  const ata: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const atb = new Float64Array(cols);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < cols; j++) {
      let s = 0;
      for (let r = 0; r < rows; r++) s += A[r]![i]! * A[r]![j]!;
      ata[i]![j] = s + (i === j ? 1e-9 : 0);
    }
    let s = 0;
    for (let r = 0; r < rows; r++) s += A[r]![i]! * b[r]!;
    atb[i] = s;
  }
  const n = cols;
  const M = ata.map((row, i) => [...row, atb[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-15) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / M[col]![col]!;
      for (let k = col; k <= n; k++) M[r]![k]! -= f * M[col]![k]!;
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i]![n]! / M[i]![i]!;
  return x;
}

// ── forces + diagnostics assembly ─────────────────────────────────────────
function extractForces(
  mechanism: Mechanism,
  built: Built,
  nodeForce: Map<string, Vec3>,
): SolveForces {
  const elements: Record<string, number> = {};
  const pivotReactions: Record<string, Vec3> = {};
  const requiredInputs: Record<string, number> = {};

  // element axial forces / tensions / moments, grouped by element id
  const byElement = new Map<string, EqConstraint[]>();
  for (const c of built.constraints) {
    const list = byElement.get(c.elementId);
    if (list) list.push(c);
    else byElement.set(c.elementId, [c]);
  }
  for (const el of mechanism.elements) {
    const cs = byElement.get(el.id) ?? [];
    if (el.type === 'link' || (el.type === 'telescope' && !el.sliding)) {
      const d = cs.find((c): c is DistanceC => c instanceof DistanceC);
      if (d) elements[el.id] = d.tension();
    } else if (el.type === 'rope') {
      const r = cs.find((c): c is RopeC => c instanceof RopeC);
      if (r) elements[el.id] = Math.max(0, r.tension());
    } else if (el.type === 'elastic') {
      // spring force from geometry: k(len − rest_eff), clamped ≥0 if tension-only
      elements[el.id] = elasticForce(
        el,
        built.particles.get(el.nodeA)!,
        built.particles.get(el.nodeB)!,
      );
    } else if (el.type === 'bowden') {
      const bo = cs.find((c): c is BowdenC => c instanceof BowdenC);
      if (bo) elements[el.id] = bo.tension();
    } else if (el.type === 'torsionCable') {
      const t = cs.find((c): c is TorsionCableC => c instanceof TorsionCableC);
      if (t) elements[el.id] = t.transmittedTorque();
    } else if (el.type === 'pivot' && el.torsionSpring) {
      const ts = built.torsionSpringByPivot.get(el.id);
      if (ts) elements[el.id] = ts.moment();
    }
  }

  // pivot reactions: reaction = −(net constraint force on the pivot node)
  for (const el of mechanism.elements) {
    if (el.type !== 'pivot') continue;
    const f = nodeForce.get(el.nodeId) ?? { x: 0, y: 0, z: 0 };
    pivotReactions[el.id] = { x: -f.x, y: -f.y, z: -f.z };
  }

  // required input per driven channel: the generalized force the operator's
  // hand must supply to hold the driven node at its prescribed value.
  for (const ref of driveRefs(mechanism)) {
    const p = built.particles.get(ref.nodeId);
    if (!p) continue;
    const cf = nodeForce.get(ref.nodeId) ?? { x: 0, y: 0, z: 0 };
    // holder must cancel constraint forces + gravity on the held node
    const holdX = -(cf.x + p.mass * GRAVITY.x);
    const holdY = -(cf.y + p.mass * GRAVITY.y);
    const holdZ = -(cf.z + p.mass * GRAVITY.z);
    if (ref.kind === 'displacement') {
      requiredInputs[ref.channel.name] = Math.abs(
        holdX * ref.axis.x + holdY * ref.axis.y + holdZ * ref.axis.z,
      );
    } else {
      // moment about the drive's rotation axis through the rail pivot
      const relx = p.x - ref.pivot.x;
      const rely = p.y - ref.pivot.y;
      const relz = p.z - ref.pivot.z;
      const mx = rely * holdZ - relz * holdY;
      const my = relz * holdX - relx * holdZ;
      const mz = relx * holdY - rely * holdX;
      requiredInputs[ref.channel.name] = Math.abs(
        mx * ref.rotAxis.x + my * ref.rotAxis.y + mz * ref.rotAxis.z,
      );
    }
  }

  return { elements, pivotReactions, requiredInputs };
}

function diagnostics(
  mechanism: Mechanism,
  built: Built,
  settled: boolean,
  density: number,
  elementDensity: Record<string, number>,
  dragHeldIds: ReadonlySet<string>,
): SolveDiagnostics {
  let residual = 0;
  const violated = new Set<string>();
  let equalities = 0;
  for (const c of built.constraints) {
    const v = c.violation();
    residual = Math.max(residual, v);
    if (v > RESIDUAL_TOL) violated.add(c.elementId);
    equalities += c.mobility;
  }
  const dof = 3 * (built.freeCount + built.freeVirtualCount) - equalities;
  return {
    dof,
    classification: dof < 0 ? 'overconstrained' : dof === 0 ? 'structure' : 'mechanism',
    converged: settled && residual <= RESIDUAL_TOL,
    residual,
    violated: [...violated].sort(),
    ropesRequiringCompression: ropesRequiringCompression(
      mechanism,
      density,
      elementDensity,
      dragHeldIds,
    ),
  };
}

// ── entry point ──────────────────────────────────────────────────────────
export function solveEquilibrium(mechanism: Mechanism, inputs: SolveInputs): SolveResult {
  const density = inputs.linkDensityKgPerM ?? 0;
  const elementDensity = inputs.elementLinearDensityKgPerM ?? {};
  const built = build(mechanism, inputs);
  const settled = settle(built);
  const nodeForce = measure(built);

  const positions: Record<string, Vec3> = {};
  for (const p of built.particles.values()) {
    if (built.userIds.has(p.id)) positions[p.id] = { x: p.x, y: p.y, z: p.z };
  }

  const dragHeldIds = new Set(
    mechanism.nodes
      .filter((n) => n.kind === 'free' && inputs.dragTargets?.[n.id] !== undefined)
      .map((n) => n.id),
  );
  return {
    positions,
    forces: extractForces(mechanism, built, nodeForce),
    diagnostics: diagnostics(mechanism, built, settled, density, elementDensity, dragHeldIds),
  };
}
