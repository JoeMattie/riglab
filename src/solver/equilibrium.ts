// Static equilibrium mode (§5.1 mode 2) + force extraction (§5.2).
//
// Pseudo-dynamic relaxation: integrate the mechanism particles under gravity
// and spring forces with heavy damping (×0.85/step) and an XPBD position
// projection each step, until the fastest particle drops below ε or an
// iteration cap. This settles the pose the real rig would sag into. Forces
// are then read from the XPBD Lagrange multipliers via a single gravity-loaded
// measurement substep from the settled pose (force = λ/Δt² per unit gradient).
//
// Determinism (§12, DECISIONS.md): fixed timestep, fixed iteration counts,
// constraints projected in id order, no Math.random. Same input ⇒ identical
// output.
//
// The solver is pure and framework-free (§12): schema data in, plain data out.
import { polylineLengthM } from '../geometry/pipe';
import type { InputChannel, Mechanism, MechanismElement, Vec2 } from '../schema';
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

// ── particle ─────────────────────────────────────────────────────────────
interface Particle {
  id: string;
  x: number;
  y: number;
  px: number; // previous position (for velocity)
  py: number;
  vx: number;
  vy: number;
  w: number; // inverse mass used by projection (0 = held: anchor/driven)
  mass: number; // true mass (kg) — drives gravity and force balance
  held: boolean; // anchor or driven: position is prescribed
}

const hypot = Math.hypot;
const unit = (dx: number, dy: number): [number, number] => {
  const l = hypot(dx, dy);
  return l < 1e-12 ? [0, 0] : [dx / l, dy / l];
};
const perp = (x: number, y: number): [number, number] => [-y, x];

// ── driven-node input channels (semantics defined in Phase 2, DECISIONS.md) ─
interface DriveRef {
  nodeId: string;
  channel: InputChannel;
  kind: 'angle' | 'displacement';
  pivot: Vec2; // angle: rotation centre · displacement: axis origin
  drawn: Vec2; // node's drawn position
  axis: Vec2; // displacement: unit drive direction
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
 * lowest-id anchor; failing that, the world +x axis through the drawn point. */
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
    let other: Vec2 | null = null;
    for (const el of [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id))) {
      if (
        (el.type === 'link' || el.type === 'telescope') &&
        (el.nodeA === n.id || el.nodeB === n.id)
      ) {
        other = posOf.get(el.nodeA === n.id ? el.nodeB : el.nodeA) ?? null;
        break;
      }
    }
    if (!other) {
      const anchor = [...mechanism.nodes]
        .filter((a) => a.kind === 'anchor' && a.id !== n.id)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      other = anchor ? anchor.position : { x: drawn.x - 1, y: drawn.y };
    }
    const [ax, ay] = unit(drawn.x - other.x, drawn.y - other.y);
    refs.push({
      nodeId: n.id,
      channel,
      kind: channel.kind,
      pivot: other,
      drawn,
      axis: { x: ax || 1, y: ay },
    });
  }
  return refs;
}

/** Prescribed position of a driven node for a channel value. */
function drivenPosition(ref: DriveRef, value: number): Vec2 {
  if (ref.kind === 'angle') {
    const dx = ref.drawn.x - ref.pivot.x;
    const dy = ref.drawn.y - ref.pivot.y;
    const c = Math.cos(value);
    const s = Math.sin(value);
    return { x: ref.pivot.x + c * dx - s * dy, y: ref.pivot.y + s * dx + c * dy };
  }
  // displacement: slide along the rail axis by `value` metres from drawn
  return { x: ref.drawn.x + ref.axis.x * value, y: ref.drawn.y + ref.axis.y * value };
}

/** Public: prescribed positions of all driven nodes, keyed by node id. Shared
 * with kinematic drag so both modes honour input channels identically. */
export function drivenTargets(mechanism: Mechanism, inputs: SolveInputs): Record<string, Vec2> {
  const out: Record<string, Vec2> = {};
  for (const ref of driveRefs(mechanism)) {
    out[ref.nodeId] = drivenPosition(ref, channelValue(ref.channel, inputs));
  }
  return out;
}

// ── mass accumulation (§5.1) ─────────────────────────────────────────────
function polyLen(nodeIds: string[], posOf: Map<string, Vec2>): number {
  return polylineLengthM(nodeIds.map((id) => posOf.get(id)!));
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
      const len = el.type === 'telescope' ? el.lengthM : hypot(a.x - b.x, a.y - b.y);
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
  mobility: number; // equalities touching a free node (Grübler count)
  reset(): void;
  project(): void;
  violation(): number;
  /** add this constraint's force on each incident particle (λ/Δt²·∇C). */
  addForces(force: Map<string, { fx: number; fy: number }>): void;
}

function addForce(
  map: Map<string, { fx: number; fy: number }>,
  id: string,
  fx: number,
  fy: number,
): void {
  const f = map.get(id);
  if (f) {
    f.fx += fx;
    f.fy += fy;
  } else {
    map.set(id, { fx, fy });
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
    const c = hypot(this.p1.x - this.p2.x, this.p1.y - this.p2.y) - this.rest;
    if (this.kind === 'max') return Math.max(0, c);
    if (this.kind === 'min') return Math.min(0, c);
    return c;
  }

  project(): void {
    const C = this.cValue();
    if (C === 0) return;
    const dx = this.p1.x - this.p2.x;
    const dy = this.p1.y - this.p2.y;
    const len = hypot(dx, dy);
    if (len < 1e-12) return;
    const nx = dx / len;
    const ny = dy / len;
    const denom = this.p1.w + this.p2.w;
    if (denom <= 0) return;
    const dl = -C / denom;
    this.lambda += dl;
    this.p1.x += this.p1.w * dl * nx;
    this.p1.y += this.p1.w * dl * ny;
    this.p2.x -= this.p2.w * dl * nx;
    this.p2.y -= this.p2.w * dl * ny;
  }

  violation(): number {
    return Math.abs(this.cValue());
  }

  addForces(force: Map<string, { fx: number; fy: number }>): void {
    const [nx, ny] = unit(this.p1.x - this.p2.x, this.p1.y - this.p2.y);
    const f = this.lambda * INV_DT2;
    addForce(force, this.p1.id, f * nx, f * ny);
    addForce(force, this.p2.id, -f * nx, -f * ny);
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
      t += hypot(this.nodes[i]!.x - this.nodes[i - 1]!.x, this.nodes[i]!.y - this.nodes[i - 1]!.y);
    }
    return t;
  }

  private grads(): Array<[number, number]> {
    const g: Array<[number, number]> = this.nodes.map(() => [0, 0]);
    for (let i = 0; i < this.nodes.length; i++) {
      const p = this.nodes[i]!;
      if (i > 0) {
        const [ux, uy] = unit(p.x - this.nodes[i - 1]!.x, p.y - this.nodes[i - 1]!.y);
        g[i]![0] += ux;
        g[i]![1] += uy;
      }
      if (i < this.nodes.length - 1) {
        const [ux, uy] = unit(p.x - this.nodes[i + 1]!.x, p.y - this.nodes[i + 1]!.y);
        g[i]![0] += ux;
        g[i]![1] += uy;
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
      denom += this.nodes[i]!.w * (g[i]![0] * g[i]![0] + g[i]![1] * g[i]![1]);
    }
    if (denom <= 0) return;
    const dl = (-C - at * this.lambda) / denom;
    this.lambda += dl;
    for (let i = 0; i < this.nodes.length; i++) {
      const p = this.nodes[i]!;
      p.x += p.w * dl * g[i]![0];
      p.y += p.w * dl * g[i]![1];
    }
  }

  violation(): number {
    return Math.max(0, this.total() - this.l0);
  }

  addForces(force: Map<string, { fx: number; fy: number }>): void {
    const g = this.grads();
    const f = this.lambda * INV_DT2;
    for (let i = 0; i < this.nodes.length; i++) {
      addForce(force, this.nodes[i]!.id, f * g[i]![0], f * g[i]![1]);
    }
  }

  tension(): number {
    return -this.lambda * INV_DT2;
  }
}

/** Signed relative angle at a pivot = deviation from the straight
 * continuation of memberA through the pivot into memberB (schema convention,
 * DECISIONS.md Phase 1). Returns θ and the ∂θ/∂node gradients. */
function angleAndGrads(
  pivot: Particle,
  a: Particle,
  b: Particle,
): { theta: number; ga: [number, number]; gb: [number, number]; gp: [number, number] } | null {
  const vax = pivot.x - a.x;
  const vay = pivot.y - a.y;
  const vbx = b.x - pivot.x;
  const vby = b.y - pivot.y;
  const la2 = vax * vax + vay * vay;
  const lb2 = vbx * vbx + vby * vby;
  if (la2 < 1e-12 || lb2 < 1e-12) return null;
  const theta = Math.atan2(vax * vby - vay * vbx, vax * vbx + vay * vby);
  const ga = perp(vax / la2, vay / la2);
  const gb = perp(vbx / lb2, vby / lb2);
  const gp: [number, number] = [-(ga[0] + gb[0]), -(ga[1] + gb[1])];
  return { theta, ga, gb, gp };
}

/** Pivot angle limit (inequality): clamp the relative angle into [min, max]. */
class AngleLimitC implements EqConstraint {
  lambda = 0;
  readonly mobility = 0;
  constructor(
    readonly elementId: string,
    private readonly pivot: Particle,
    private readonly a: Particle,
    private readonly b: Particle,
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
    const ag = angleAndGrads(this.pivot, this.a, this.b);
    if (!ag) return;
    const C = this.cValue(ag.theta);
    if (C === 0) return;
    const denom =
      this.a.w * (ag.ga[0] ** 2 + ag.ga[1] ** 2) +
      this.b.w * (ag.gb[0] ** 2 + ag.gb[1] ** 2) +
      this.pivot.w * (ag.gp[0] ** 2 + ag.gp[1] ** 2);
    if (denom <= 0) return;
    const s = -C / denom;
    this.a.x += this.a.w * s * ag.ga[0];
    this.a.y += this.a.w * s * ag.ga[1];
    this.b.x += this.b.w * s * ag.gb[0];
    this.b.y += this.b.w * s * ag.gb[1];
    this.pivot.x += this.pivot.w * s * ag.gp[0];
    this.pivot.y += this.pivot.w * s * ag.gp[1];
  }

  violation(): number {
    const ag = angleAndGrads(this.pivot, this.a, this.b);
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
  const len = hypot(a.x - b.x, a.y - b.y);
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
    const [ux, uy] = unit(this.b.x - this.a.x, this.b.y - this.a.y); // pull A toward B
    this.a.vx += this.a.w * f * ux * DT;
    this.a.vy += this.a.w * f * uy * DT;
    this.b.vx -= this.b.w * f * ux * DT;
    this.b.vy -= this.b.w * f * uy * DT;
  }
}

/** Pivot torsion spring — restoring moment τ = −k(θ − rest) applied to the two
 * members (hose-joint flex / fibreglass return rod). */
class TorsionSpringForceGen implements ForceGen {
  constructor(
    readonly elementId: string,
    private readonly pivot: Particle,
    private readonly a: Particle,
    private readonly b: Particle,
    private readonly restAngle: number,
    private readonly stiffness: number,
  ) {}

  moment(): number {
    const ag = angleAndGrads(this.pivot, this.a, this.b);
    return ag ? -this.stiffness * (ag.theta - this.restAngle) : 0;
  }

  apply(): void {
    if (this.stiffness <= 0) return;
    const ag = angleAndGrads(this.pivot, this.a, this.b);
    if (!ag) return;
    const tau = -this.stiffness * (ag.theta - this.restAngle); // restoring
    this.a.vx += this.a.w * tau * ag.ga[0] * DT;
    this.a.vy += this.a.w * tau * ag.ga[1] * DT;
    this.b.vx += this.b.w * tau * ag.gb[0] * DT;
    this.b.vy += this.b.w * tau * ag.gb[1] * DT;
    this.pivot.vx += this.pivot.w * tau * ag.gp[0] * DT;
    this.pivot.vy += this.pivot.w * tau * ag.gp[1] * DT;
  }
}

/** Point-on-line (slider) with parametric travel limits. */
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

  private apply(C: number, gx: number, gy: number, t: number): void {
    if (C === 0) return;
    const denom = this.n.w + this.a.w * (1 - t) * (1 - t) + this.b.w * t * t;
    if (denom <= 0) return;
    const s = -C / denom;
    this.n.x += this.n.w * s * gx;
    this.n.y += this.n.w * s * gy;
    this.a.x -= this.a.w * (1 - t) * s * gx;
    this.a.y -= this.a.w * (1 - t) * s * gy;
    this.b.x -= this.b.w * t * s * gx;
    this.b.y -= this.b.w * t * s * gy;
  }

  project(): void {
    const ux = this.b.x - this.a.x;
    const uy = this.b.y - this.a.y;
    const L = hypot(ux, uy);
    if (L < 1e-12) return;
    const relx = this.n.x - this.a.x;
    const rely = this.n.y - this.a.y;
    const t = (relx * ux + rely * uy) / (L * L);
    this.apply((relx * -uy + rely * ux) / L, -uy / L, ux / L, t);
    const s = (relx * ux + rely * uy) / L;
    if (s < this.travelMin * L) this.apply(s - this.travelMin * L, ux / L, uy / L, t);
    else if (s > this.travelMax * L) this.apply(s - this.travelMax * L, ux / L, uy / L, t);
  }

  violation(): number {
    const ux = this.b.x - this.a.x;
    const uy = this.b.y - this.a.y;
    const L = hypot(ux, uy);
    if (L < 1e-12) return 0;
    const relx = this.n.x - this.a.x;
    const rely = this.n.y - this.a.y;
    const cPerp = Math.abs((relx * -uy + rely * ux) / L);
    const s = (relx * ux + rely * uy) / L;
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
    const lenA = hypot(this.a1.x - this.a2.x, this.a1.y - this.a2.y);
    const lenB = hypot(this.b1.x - this.b2.x, this.b1.y - this.b2.y);
    return lenA - this.restA + (lenB - this.restB);
  }

  project(): void {
    const [uAx, uAy] = unit(this.a1.x - this.a2.x, this.a1.y - this.a2.y);
    const [uBx, uBy] = unit(this.b1.x - this.b2.x, this.b1.y - this.b2.y);
    const denom = this.a1.w + this.a2.w + this.b1.w + this.b2.w;
    if (denom <= 0) return;
    const dl = -this.cValue() / denom;
    this.lambda += dl;
    this.a1.x += this.a1.w * dl * uAx;
    this.a1.y += this.a1.w * dl * uAy;
    this.a2.x -= this.a2.w * dl * uAx;
    this.a2.y -= this.a2.w * dl * uAy;
    this.b1.x += this.b1.w * dl * uBx;
    this.b1.y += this.b1.w * dl * uBy;
    this.b2.x -= this.b2.w * dl * uBx;
    this.b2.y -= this.b2.w * dl * uBy;
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
 * (θB−θB0) = ratio·(θA−θA0), free play of ±backlash before it transmits. */
class TorsionCableC implements EqConstraint {
  lambda = 0;
  readonly mobility = 0;
  constructor(
    readonly elementId: string,
    private readonly pa: Particle,
    private readonly aa: Particle,
    private readonly ba: Particle,
    private readonly pb: Particle,
    private readonly ab: Particle,
    private readonly bb: Particle,
    private readonly thetaA0: number,
    private readonly thetaB0: number,
    private readonly ratio: number,
    private readonly backlash: number,
  ) {}

  reset(): void {
    this.lambda = 0;
  }

  project(): void {
    const A = angleAndGrads(this.pa, this.aa, this.ba);
    const B = angleAndGrads(this.pb, this.ab, this.bb);
    if (!A || !B) return;
    const raw = B.theta - this.thetaB0 - this.ratio * (A.theta - this.thetaA0);
    // dead-zone: only the part of `raw` beyond ±backlash transmits
    const excess =
      raw > this.backlash ? raw - this.backlash : raw < -this.backlash ? raw + this.backlash : 0;
    if (excess === 0) return;
    // effective gradient per node: ∂raw/∂θB·(θB grads) − ratio·(θA grads)
    const contrib: Array<[Particle, number, number]> = [
      [this.ab, B.ga[0], B.ga[1]],
      [this.bb, B.gb[0], B.gb[1]],
      [this.pb, B.gp[0], B.gp[1]],
      [this.aa, -this.ratio * A.ga[0], -this.ratio * A.ga[1]],
      [this.ba, -this.ratio * A.gb[0], -this.ratio * A.gb[1]],
      [this.pa, -this.ratio * A.gp[0], -this.ratio * A.gp[1]],
    ];
    let denom = 0;
    for (const [p, gx, gy] of contrib) denom += p.w * (gx * gx + gy * gy);
    if (denom <= 0) return;
    const dl = -excess / denom;
    this.lambda += dl;
    for (const [p, gx, gy] of contrib) {
      p.x += p.w * dl * gx;
      p.y += p.w * dl * gy;
    }
  }

  violation(): number {
    const A = angleAndGrads(this.pa, this.aa, this.ba);
    const B = angleAndGrads(this.pb, this.ab, this.bb);
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
function adjacentNodeId(el: MechanismElement, pivotNodeId: string): string | null {
  if (el.type === 'link' || el.type === 'telescope') {
    if (el.nodeA === pivotNodeId) return el.nodeB;
    if (el.nodeB === pivotNodeId) return el.nodeA;
    return null;
  }
  if (el.type === 'bentLink') {
    const i = el.nodeIds.indexOf(pivotNodeId);
    if (i < 0) return null;
    return el.nodeIds[i + 1] ?? el.nodeIds[i - 1] ?? null;
  }
  return null;
}

interface Built {
  particles: Map<string, Particle>;
  constraints: EqConstraint[];
  forceGens: ForceGen[];
  torsionSpringByPivot: Map<string, TorsionSpringForceGen>;
  elementById: Map<string, MechanismElement>;
  pivotByElementId: Map<string, { pivotNodeId: string; aId: string; bId: string } | null>;
  freeCount: number;
}

function build(mechanism: Mechanism, inputs: SolveInputs): Built {
  const density = inputs.linkDensityKgPerM ?? 0;
  const masses = accumulateMasses(mechanism, density, inputs.elementLinearDensityKgPerM ?? {});
  const targets = drivenTargets(mechanism, inputs);

  const particles = new Map<string, Particle>();
  for (const n of mechanism.nodes) {
    const held = n.kind === 'anchor' || n.kind === 'driven';
    const prescribed = n.kind === 'driven' ? targets[n.id] : undefined;
    const pos = prescribed ?? n.position;
    const mass = masses.get(n.id) ?? 0;
    particles.set(n.id, {
      id: n.id,
      x: pos.x,
      y: pos.y,
      px: pos.x,
      py: pos.y,
      vx: 0,
      vy: 0,
      w: held ? 0 : mass > 0 ? 1 / mass : 1 / GENERIC_NODE_MASS,
      mass,
      held,
    });
  }
  const get = (id: string): Particle => {
    const p = particles.get(id);
    if (!p) throw new Error(`unknown node ${id}`);
    return p;
  };
  const posOf = new Map(mechanism.nodes.map((n) => [n.id, n.position]));
  const elementById = new Map(mechanism.elements.map((e) => [e.id, e]));
  const free = new Set(mechanism.nodes.filter((n) => n.kind === 'free').map((n) => n.id));
  const mob = (...ids: string[]): number => (ids.some((id) => free.has(id)) ? 1 : 0);
  const dist = (a: string, b: string): number => {
    const pa = posOf.get(a)!;
    const pb = posOf.get(b)!;
    return hypot(pa.x - pb.x, pa.y - pb.y);
  };

  const constraints: EqConstraint[] = [];
  const forceGens: ForceGen[] = [];
  const torsionSpringByPivot = new Map<string, TorsionSpringForceGen>();
  const pivotByElementId = new Map<
    string,
    { pivotNodeId: string; aId: string; bId: string } | null
  >();

  for (const el of [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id))) {
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
        let mobilityLeft = 2 * ids.length - 3;
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
        if (el.angleLimit) {
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
                el.angleLimit.minRad,
                el.angleLimit.maxRad,
              ),
            );
          }
        }
        if (el.torsionSpring) {
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
        pivotByElementId.set(el.id, an && bn ? { pivotNodeId: el.nodeId, aId: an, bId: bn } : null);
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
              mob(el.nodeId),
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

  // torsion cables reference pivot elements; wire them now that pivots exist
  for (const el of [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id))) {
    if (el.type !== 'torsionCable') continue;
    const pa = pivotByElementId.get(el.pivotA);
    const pb = pivotByElementId.get(el.pivotB);
    if (!pa || !pb) continue;
    const thetaA0 = drawnAngle(posOf, pa);
    const thetaB0 = drawnAngle(posOf, pb);
    constraints.push(
      new TorsionCableC(
        el.id,
        get(pa.pivotNodeId),
        get(pa.aId),
        get(pa.bId),
        get(pb.pivotNodeId),
        get(pb.aId),
        get(pb.bId),
        thetaA0,
        thetaB0,
        el.ratio,
        el.backlashRad,
      ),
    );
  }

  return {
    particles,
    constraints,
    forceGens,
    torsionSpringByPivot,
    elementById,
    pivotByElementId,
    freeCount: free.size,
  };
}

function drawnAngle(
  posOf: Map<string, Vec2>,
  piv: { pivotNodeId: string; aId: string; bId: string },
): number {
  const p = posOf.get(piv.pivotNodeId)!;
  const a = posOf.get(piv.aId)!;
  const b = posOf.get(piv.bId)!;
  const vax = p.x - a.x;
  const vay = p.y - a.y;
  const vbx = b.x - p.x;
  const vby = b.y - p.y;
  return Math.atan2(vax * vby - vay * vbx, vax * vbx + vay * vby);
}

// ── settle + measure ─────────────────────────────────────────────────────
/** Apply gravity + spring forces to the free particles' velocities, integrate,
 * and project the rigid constraints. Returns the max resulting particle speed. */
function substep(built: Built, free: Particle[], gravity: Vec2): number {
  for (const p of free) {
    p.px = p.x;
    p.py = p.y;
    if (p.mass > 0) {
      p.vx += gravity.x * DT;
      p.vy += gravity.y * DT;
    }
  }
  for (const g of built.forceGens) g.apply();
  for (const p of free) {
    p.x += p.vx * DT;
    p.y += p.vy * DT;
  }
  for (const c of built.constraints) c.reset();
  for (let it = 0; it < ITERS; it++) {
    for (const c of built.constraints) c.project();
  }
  let maxSpeed = 0;
  for (const p of free) {
    p.vx = ((p.x - p.px) / DT) * DAMPING;
    p.vy = ((p.y - p.py) / DT) * DAMPING;
    maxSpeed = Math.max(maxSpeed, hypot(p.vx, p.vy));
  }
  return maxSpeed;
}

function settle(built: Built, gravity: Vec2): boolean {
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
  for (let step = 0; step < MAX_STEPS; step++) {
    if (substep(built, free, gravity) < SETTLE_SPEED_EPS) return true;
    if ((step + 1) % POSE_QUIESCENCE_WINDOW === 0) {
      let maxDrift = 0;
      for (let i = 0; i < free.length; i++) {
        maxDrift = Math.max(maxDrift, hypot(free[i]!.x - snapX[i]!, free[i]!.y - snapY[i]!));
      }
      if (maxDrift < POSE_QUIESCENCE_EPS) return true;
      snapX = free.map((p) => p.x);
      snapY = free.map((p) => p.y);
    }
  }
  return false;
}

/** One loaded substep from the settled pose to read static forces from the
 * rigid-constraint λ (force = λ/Δt²). The gravity + spring loads present at
 * equilibrium are exactly what the rigid constraints react, so their λ is the
 * static force — this works with gravity off (the coupling load is a spring or
 * a driven displacement). Positions are restored afterwards. */
function measure(built: Built, gravity: Vec2): Map<string, { fx: number; fy: number }> {
  const { particles } = built;
  const free = [...particles.values()].filter((p) => !p.held);
  const savedX = new Map([...particles].map(([id, p]) => [id, [p.x, p.y, p.vx, p.vy] as const]));
  for (const p of free) {
    p.vx = 0;
    p.vy = 0;
  }
  substep(built, free, gravity);
  const force = new Map<string, { fx: number; fy: number }>();
  for (const c of built.constraints) c.addForces(force);
  for (const [id, p] of particles) {
    const s = savedX.get(id)!;
    p.x = s[0];
    p.y = s[1];
    p.vx = s[2];
    p.vy = s[3];
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
  gravity: Vec2,
  density: number,
  elementDensity: Record<string, number>,
): string[] {
  if (!mechanism.elements.some((e) => e.type === 'rope')) return [];
  const posOf = new Map(mechanism.nodes.map((n) => [n.id, n.position]));
  const freeNodes = mechanism.nodes.filter((n) => n.kind === 'free').map((n) => n.id);
  if (freeNodes.length === 0) return [];
  const rowOf = new Map(freeNodes.map((id, i) => [id, i]));
  const masses = accumulateMasses(mechanism, density, elementDensity);

  interface Member {
    ropeId: string | null;
    // contribution of +1 unit tension to each free node's (x,y) balance
    terms: Array<{ node: string; dx: number; dy: number }>;
  }
  const members: Member[] = [];
  const pathTaut = (path: string[], l0: number): boolean => {
    let t = 0;
    for (let i = 1; i < path.length; i++) {
      const a = posOf.get(path[i - 1]!)!;
      const b = posOf.get(path[i]!)!;
      t += hypot(a.x - b.x, a.y - b.y);
    }
    return t >= l0 - 1e-6;
  };
  for (const el of [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id))) {
    if (el.type === 'link' || (el.type === 'telescope' && !el.sliding)) {
      const a = posOf.get(el.nodeA)!;
      const b = posOf.get(el.nodeB)!;
      const [ux, uy] = unit(b.x - a.x, b.y - a.y);
      members.push({
        ropeId: null,
        terms: [
          { node: el.nodeA, dx: ux, dy: uy }, // tension pulls A toward B
          { node: el.nodeB, dx: -ux, dy: -uy },
        ],
      });
    } else if (el.type === 'rope' && pathTaut(el.path, el.lengthM)) {
      const terms: Array<{ node: string; dx: number; dy: number }> = [];
      for (let i = 0; i < el.path.length; i++) {
        const p = posOf.get(el.path[i]!)!;
        let gx = 0;
        let gy = 0;
        if (i > 0) {
          const [ux, uy] = unit(
            posOf.get(el.path[i - 1]!)!.x - p.x,
            posOf.get(el.path[i - 1]!)!.y - p.y,
          );
          gx += ux;
          gy += uy;
        }
        if (i < el.path.length - 1) {
          const [ux, uy] = unit(
            posOf.get(el.path[i + 1]!)!.x - p.x,
            posOf.get(el.path[i + 1]!)!.y - p.y,
          );
          gx += ux;
          gy += uy;
        }
        terms.push({ node: el.path[i]!, dx: gx, dy: gy });
      }
      members.push({ ropeId: el.id, terms });
    }
  }
  if (members.length === 0) return [];

  // right-hand side: −(gravity + elastic loads) per free node
  const b = new Float64Array(2 * freeNodes.length);
  const addRhs = (node: string, fx: number, fy: number): void => {
    const r = rowOf.get(node);
    if (r === undefined) return;
    b[2 * r] = (b[2 * r] ?? 0) - fx;
    b[2 * r + 1] = (b[2 * r + 1] ?? 0) - fy;
  };
  for (const id of freeNodes) {
    const m = masses.get(id) ?? 0;
    addRhs(id, m * gravity.x, m * gravity.y);
  }
  for (const el of mechanism.elements) {
    if (el.type !== 'elastic') continue;
    const a = posOf.get(el.nodeA)!;
    const bb = posOf.get(el.nodeB)!;
    const len = hypot(a.x - bb.x, a.y - bb.y);
    const restEff = el.restLengthM - (el.pretensionN ?? 0) / el.stiffnessNPerM;
    let f = el.stiffnessNPerM * (len - restEff);
    if (el.tensionOnly) f = Math.max(0, f);
    const [ux, uy] = unit(bb.x - a.x, bb.y - a.y);
    addRhs(el.nodeA, f * ux, f * uy); // pulls A toward B
    addRhs(el.nodeB, -f * ux, -f * uy);
  }

  // A: (2·free) × members. Solve least-squares via normal equations.
  const rows = 2 * freeNodes.length;
  const cols = members.length;
  const A: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let c = 0; c < cols; c++) {
    for (const t of members[c]!.terms) {
      const r = rowOf.get(t.node);
      if (r === undefined) continue;
      A[2 * r]![c] = A[2 * r]![c]! + t.dx;
      A[2 * r + 1]![c] = A[2 * r + 1]![c]! + t.dy;
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
  nodeForce: Map<string, { fx: number; fy: number }>,
  gravity: Vec2,
): SolveForces {
  const elements: Record<string, number> = {};
  const pivotReactions: Record<string, Vec2> = {};
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
    const f = nodeForce.get(el.nodeId) ?? { fx: 0, fy: 0 };
    pivotReactions[el.id] = { x: -f.fx, y: -f.fy };
  }

  // required input per driven channel: the generalized force the operator's
  // hand must supply to hold the driven node at its prescribed value.
  for (const ref of driveRefs(mechanism)) {
    const p = built.particles.get(ref.nodeId);
    if (!p) continue;
    const cf = nodeForce.get(ref.nodeId) ?? { fx: 0, fy: 0 };
    // holder must cancel constraint forces + gravity on the held node
    const holdX = -(cf.fx + p.mass * gravity.x);
    const holdY = -(cf.fy + p.mass * gravity.y);
    if (ref.kind === 'displacement') {
      requiredInputs[ref.channel.name] = Math.abs(holdX * ref.axis.x + holdY * ref.axis.y);
    } else {
      const relx = p.x - ref.pivot.x;
      const rely = p.y - ref.pivot.y;
      requiredInputs[ref.channel.name] = Math.abs(relx * holdY - rely * holdX); // moment about the rail pivot
    }
  }

  return { elements, pivotReactions, requiredInputs };
}

function diagnostics(
  mechanism: Mechanism,
  built: Built,
  settled: boolean,
  gravity: Vec2,
  density: number,
  elementDensity: Record<string, number>,
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
  const freeCount = mechanism.nodes.filter((n) => n.kind === 'free').length;
  const dof = 2 * freeCount - equalities;
  return {
    dof,
    classification: dof < 0 ? 'overconstrained' : dof === 0 ? 'structure' : 'mechanism',
    converged: settled && residual <= RESIDUAL_TOL,
    residual,
    violated: [...violated].sort(),
    ropesRequiringCompression: ropesRequiringCompression(
      mechanism,
      gravity,
      density,
      elementDensity,
    ),
  };
}

// ── entry point ──────────────────────────────────────────────────────────
export function solveEquilibrium(mechanism: Mechanism, inputs: SolveInputs): SolveResult {
  const gravity: Vec2 = mechanism.gravityOn ? { x: 0, y: -G } : { x: 0, y: 0 };
  const density = inputs.linkDensityKgPerM ?? 0;
  const elementDensity = inputs.elementLinearDensityKgPerM ?? {};
  const built = build(mechanism, inputs);
  const settled = settle(built, gravity);
  const nodeForce = measure(built, gravity);

  const positions: Record<string, Vec2> = {};
  for (const p of built.particles.values()) positions[p.id] = { x: p.x, y: p.y };

  return {
    positions,
    forces: extractForces(mechanism, built, nodeForce, gravity),
    diagnostics: diagnostics(mechanism, built, settled, gravity, density, elementDensity),
  };
}
