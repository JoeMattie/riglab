// Kinematic drag mode (§5.1): gravity/springs ignored; position projection
// satisfies rigid constraints and limits. Stateless per call — rest lengths
// come from the mechanism's drawn geometry (except telescope, whose length
// is the design parameter), drag targets are wishes projected before the
// constraints so pipe lengths always win over the pointer.
//
// Determinism: fixed iteration count, constraints sorted by element id,
// drags sorted by node id, no randomness (§12).
import type { Mechanism, Vec2 } from '../schema';
import type { SolveInputs, SolveResult } from './types';

const ITERATIONS = 300;
const CONVERGE_TOL = 1e-5;

interface P {
  id: string;
  x: number;
  y: number;
  w: number;
}

interface KConstraint {
  /** element id reported when violated */
  elementId: string;
  project(): void;
  /** current violation magnitude (0 for a satisfied inequality) */
  violation(): number;
  /** scalar equality constraints contributed to the mobility count (0 for
   * inequalities; redundant rigid-body pairs are not double-counted) */
  mobilityEqualities: number;
}

const perp = (x: number, y: number): Vec2 => ({ x: -y, y: x });

class DistanceC implements KConstraint {
  constructor(
    readonly elementId: string,
    private readonly p1: P,
    private readonly p2: P,
    private readonly rest: number,
    readonly mobilityEqualities: number,
    /** 'eq' | 'max' (len ≤ rest) | 'min' (len ≥ rest) */
    private readonly kind: 'eq' | 'max' | 'min' = 'eq',
  ) {}

  private C(): number {
    const len = Math.hypot(this.p1.x - this.p2.x, this.p1.y - this.p2.y);
    const c = len - this.rest;
    if (this.kind === 'max') return Math.max(0, c);
    if (this.kind === 'min') return Math.min(0, c);
    return c;
  }

  project(): void {
    const C = this.C();
    if (C === 0) return;
    const dx = this.p1.x - this.p2.x;
    const dy = this.p1.y - this.p2.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) return;
    const wSum = this.p1.w + this.p2.w;
    if (wSum === 0) return;
    const s = -C / wSum;
    const nx = dx / len;
    const ny = dy / len;
    this.p1.x += this.p1.w * s * nx;
    this.p1.y += this.p1.w * s * ny;
    this.p2.x -= this.p2.w * s * nx;
    this.p2.y -= this.p2.w * s * ny;
  }

  violation(): number {
    return Math.abs(this.C());
  }
}

/** Joint angle limit. The relative angle is the signed deviation from the
 * straight continuation of memberA through the pivot into memberB
 * (0 = straight, like a knee), so the atan2 discontinuity sits at the
 * physically implausible fully-folded pose instead of at straight. */
class AngleLimitC implements KConstraint {
  readonly mobilityEqualities = 0;
  constructor(
    readonly elementId: string,
    private readonly pivot: P,
    private readonly a: P,
    private readonly b: P,
    private readonly minRad: number,
    private readonly maxRad: number,
  ) {}

  private theta(): number {
    const vax = this.pivot.x - this.a.x; // continuation of memberA through P
    const vay = this.pivot.y - this.a.y;
    const vbx = this.b.x - this.pivot.x;
    const vby = this.b.y - this.pivot.y;
    return Math.atan2(vax * vby - vay * vbx, vax * vbx + vay * vby);
  }

  private C(): number {
    const t = this.theta();
    if (t < this.minRad) return t - this.minRad;
    if (t > this.maxRad) return t - this.maxRad;
    return 0;
  }

  project(): void {
    const C = this.C();
    if (C === 0) return;
    const vax = this.pivot.x - this.a.x;
    const vay = this.pivot.y - this.a.y;
    const vbx = this.b.x - this.pivot.x;
    const vby = this.b.y - this.pivot.y;
    const la2 = vax * vax + vay * vay;
    const lb2 = vbx * vbx + vby * vby;
    if (la2 < 1e-12 || lb2 < 1e-12) return;
    const ga = perp(vax / la2, vay / la2); // ∂θ/∂a = +perp(va′)/|va′|²
    const gb = perp(vbx / lb2, vby / lb2); // ∂θ/∂b = +perp(vb)/|vb|²
    const gp = { x: -(ga.x + gb.x), y: -(ga.y + gb.y) }; // ∂θ/∂P = −(ga+gb)
    const denom =
      this.a.w * (ga.x * ga.x + ga.y * ga.y) +
      this.b.w * (gb.x * gb.x + gb.y * gb.y) +
      this.pivot.w * (gp.x * gp.x + gp.y * gp.y);
    if (denom === 0) return;
    const s = -C / denom;
    this.a.x += this.a.w * s * ga.x;
    this.a.y += this.a.w * s * ga.y;
    this.b.x += this.b.w * s * gb.x;
    this.b.y += this.b.w * s * gb.y;
    this.pivot.x += this.pivot.w * s * gp.x;
    this.pivot.y += this.pivot.w * s * gp.y;
  }

  violation(): number {
    return Math.abs(this.C());
  }
}

/** Node on the axis of a link (A→B), with travel limits on the projected
 * parameter. Gradients distributed barycentrically to the rail ends. */
class PointOnLineC implements KConstraint {
  readonly mobilityEqualities = 1;
  constructor(
    readonly elementId: string,
    private readonly n: P,
    private readonly a: P,
    private readonly b: P,
    private readonly travelMin: number,
    private readonly travelMax: number,
  ) {}

  project(): void {
    const ux = this.b.x - this.a.x;
    const uy = this.b.y - this.a.y;
    const L = Math.hypot(ux, uy);
    if (L < 1e-12) return;
    const nx = -uy / L;
    const ny = ux / L;
    const relx = this.n.x - this.a.x;
    const rely = this.n.y - this.a.y;
    const t = (relx * (ux / L) + rely * (uy / L)) / L;
    // perpendicular (equality)
    const Cperp = relx * nx + rely * ny;
    this.apply(Cperp, nx, ny, t);
    // travel limits (inequalities), along the axis
    const s = relx * (ux / L) + rely * (uy / L);
    const sMin = this.travelMin * L;
    const sMax = this.travelMax * L;
    if (s < sMin) this.apply(s - sMin, ux / L, uy / L, t);
    else if (s > sMax) this.apply(s - sMax, ux / L, uy / L, t);
  }

  private apply(C: number, gx: number, gy: number, t: number): void {
    if (C === 0) return;
    const wa = this.a.w * (1 - t) * (1 - t);
    const wb = this.b.w * t * t;
    const denom = this.n.w + wa + wb;
    if (denom === 0) return;
    const s = -C / denom;
    this.n.x += this.n.w * s * gx;
    this.n.y += this.n.w * s * gy;
    this.a.x -= this.a.w * (1 - t) * s * gx;
    this.a.y -= this.a.w * (1 - t) * s * gy;
    this.b.x -= this.b.w * t * s * gx;
    this.b.y -= this.b.w * t * s * gy;
  }

  violation(): number {
    const ux = this.b.x - this.a.x;
    const uy = this.b.y - this.a.y;
    const L = Math.hypot(ux, uy);
    if (L < 1e-12) return 0;
    const relx = this.n.x - this.a.x;
    const rely = this.n.y - this.a.y;
    const cPerp = Math.abs((relx * -uy + rely * ux) / L);
    const s = (relx * ux + rely * uy) / L;
    const under = Math.max(0, this.travelMin * L - s);
    const over = Math.max(0, s - this.travelMax * L);
    return Math.max(cPerp, under, over);
  }
}

/** Drag target: a wish, projected before the real constraints each
 * iteration so geometry always wins. Not counted in residual/DOF. */
class DragC {
  constructor(
    private readonly p: P,
    readonly target: Vec2,
  ) {}

  project(): void {
    if (this.p.w === 0) return;
    this.p.x = this.target.x;
    this.p.y = this.target.y;
  }
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The member's node adjacent to the pivot node — the lever arm used for
 * welds and angle limits. */
function adjacentNodeId(
  element: Mechanism['elements'][number],
  pivotNodeId: string,
): string | null {
  switch (element.type) {
    case 'link':
    case 'telescope':
      if (element.nodeA === pivotNodeId) return element.nodeB;
      if (element.nodeB === pivotNodeId) return element.nodeA;
      return null;
    case 'bentLink': {
      const i = element.nodeIds.indexOf(pivotNodeId);
      if (i < 0) return null;
      return element.nodeIds[i + 1] ?? element.nodeIds[i - 1] ?? null;
    }
    default:
      return null;
  }
}

export function solveKinematic(mechanism: Mechanism, inputs: SolveInputs): SolveResult {
  const particles = new Map<string, P>(
    mechanism.nodes.map((n) => [
      n.id,
      { id: n.id, x: n.position.x, y: n.position.y, w: n.kind === 'anchor' ? 0 : 1 },
    ]),
  );
  const pos = new Map(mechanism.nodes.map((n) => [n.id, n.position]));
  const get = (id: string): P => {
    const p = particles.get(id);
    if (!p) throw new Error(`unknown node ${id}`);
    return p;
  };
  const elementById = new Map(mechanism.elements.map((e) => [e.id, e]));
  const free = new Set(mechanism.nodes.filter((n) => n.kind !== 'anchor').map((n) => n.id));
  // an equality only reduces mobility if it touches at least one free node
  const mob = (...ids: string[]): 0 | 1 => (ids.some((id) => free.has(id)) ? 1 : 0);

  const constraints: KConstraint[] = [];
  for (const el of [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id))) {
    switch (el.type) {
      case 'link': {
        const rest = dist(pos.get(el.nodeA)!, pos.get(el.nodeB)!);
        constraints.push(
          new DistanceC(el.id, get(el.nodeA), get(el.nodeB), rest, mob(el.nodeA, el.nodeB)),
        );
        break;
      }
      case 'telescope': {
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
      }
      case 'bentLink': {
        // all-pairs distances for projection robustness; only 2k−3 count
        // toward mobility (the rest are redundant rigid-body constraints)
        const ids = el.nodeIds;
        let mobilityLeft = 2 * ids.length - 3;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const rest = dist(pos.get(ids[i]!)!, pos.get(ids[j]!)!);
            const counts = mobilityLeft > 0 ? mob(ids[i]!, ids[j]!) : 0;
            constraints.push(new DistanceC(el.id, get(ids[i]!), get(ids[j]!), rest, counts));
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
          const rest = dist(pos.get(a)!, pos.get(b)!);
          constraints.push(new DistanceC(el.id, get(a), get(b), rest, mob(a, b)));
        }
        if (el.angleLimit) {
          const elA = elementById.get(el.angleLimit.memberA);
          const elB = elementById.get(el.angleLimit.memberB);
          const a = elA ? adjacentNodeId(elA, el.nodeId) : null;
          const b = elB ? adjacentNodeId(elB, el.nodeId) : null;
          if (a && b) {
            constraints.push(
              new AngleLimitC(
                el.id,
                get(el.nodeId),
                get(a),
                get(b),
                el.angleLimit.minRad,
                el.angleLimit.maxRad,
              ),
            );
          }
        }
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
            ),
          );
        }
        break;
      }
      // force elements are inert in kinematic mode until Phase 2
      case 'rope':
      case 'elastic':
      case 'bowden':
      case 'torsionCable':
        break;
    }
  }

  const drags: DragC[] = Object.entries(inputs.dragTargets ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([id]) => particles.has(id))
    .map(([id, target]) => new DragC(get(id), target));

  for (let it = 0; it < ITERATIONS; it++) {
    for (const d of drags) d.project();
    for (const c of constraints) c.project();
  }

  let residual = 0;
  const violatedSet = new Set<string>();
  for (const c of constraints) {
    const v = c.violation();
    residual = Math.max(residual, v);
    if (v > CONVERGE_TOL) violatedSet.add(c.elementId);
  }

  // mobility: particle-space DOF (2 per free node) minus independent
  // equality constraints that touch at least one free node — equivalent to
  // the Grübler count for this pin-lattice model (see DECISIONS.md)
  const freeCount = mechanism.nodes.filter((n) => n.kind !== 'anchor').length;
  let equalities = 0;
  for (const c of constraints) equalities += c.mobilityEqualities;
  const dof = 2 * freeCount - equalities;

  const positions: Record<string, Vec2> = {};
  for (const p of particles.values()) positions[p.id] = { x: p.x, y: p.y };

  return {
    positions,
    forces: { elements: {}, pivotReactions: {}, requiredInputs: {} },
    diagnostics: {
      dof,
      classification: dof < 0 ? 'overconstrained' : dof === 0 ? 'structure' : 'mechanism',
      converged: residual <= CONVERGE_TOL,
      residual,
      violated: [...violatedSet].sort(),
      ropesRequiringCompression: [],
    },
  };
}
