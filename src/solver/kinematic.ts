// Kinematic drag mode (§5.1), fully 3D (PLANFILE-3d-conversion.md): gravity/
// springs ignored; position projection satisfies rigid constraints and limits.
// Stateless per call — rest lengths come from the mechanism's drawn geometry
// (except telescope, whose length is the design parameter), drag targets are
// wishes projected before the constraints so pipe lengths always win over the
// pointer. Hinge pivots gain a solver-internal virtual axis particle (see
// hinge.ts); spherical pivots are the plain shared node.
//
// Determinism: fixed iteration count, constraints sorted by element id,
// drags sorted by node id, no randomness (§12).
import type { Mechanism, Vec3 } from '../schema';
import { drivenTargets } from './equilibrium';
import { adjacentNodeId, angle3, type HingePlan, hingePlan } from './hinge';
import type { SolveInputs, SolveResult } from './types';

const ITERATIONS = 300;
/** Drag-loop fixed-point exit: the drag/project map converges to a fixed
 * point long before ITERATIONS on quiet frames (clip playback moves targets
 * a few millimetres per frame). Every FIXED_POINT_CHECK iterations the max
 * particle displacement since the last check is measured; below
 * FIXED_POINT_TOL the loop has converged — further iterations are no-ops at
 * sub-nanometre scale — and it exits. Deterministic: the exit depends only
 * on deterministic state, and hard frames still run the full ITERATIONS. */
const FIXED_POINT_CHECK = 25;
const FIXED_POINT_TOL = 1e-9;
/** constraint-only sweeps after the drag loop: a far-from-feasible drag
 * target would otherwise leave real violation in the output (the drag/
 * constraint cycle never converges), and since callers recompute rest
 * lengths from returned positions, that error would compound per frame */
const SETTLE_ITERATIONS = 100;
/** 3D tradeoff: a rigid all-pairs body (bentLink) ROTATING OUT OF PLANE
 * relaxes under Gauss–Seidel at only ~0.995 per sweep — far slower than any
 * in-plane case — so a single 100-sweep settle can leave ~1e-4 violation
 * that the per-frame rest-length recompute would ratchet into permanent
 * distortion. The settle therefore runs in blocks of SETTLE_ITERATIONS with
 * an early exit once under tolerance, capped at SETTLE_BLOCKS blocks:
 * ordinary frames pay one or two blocks, pathological rotations keep
 * sweeping until the body is rigid again. Still deterministic — the exit
 * condition depends only on deterministic state (§12). */
const SETTLE_BLOCKS = 60;
const CONVERGE_TOL = 1e-5;
/** Settle-block early-exit threshold — deliberately two decades TIGHTER than
 * CONVERGE_TOL. Residual-scale artifacts leak through constraint gradients
 * amplified by O(1) factors (e.g. the hinge virtual-axis ties turn distance
 * residual into out-of-plane z at ~2×), so exiting at CONVERGE_TOL would let
 * a planar sketch float ~2e-5 off its plane every frame. Exiting at 1e-9
 * puts that leakage well under 1e-6 while healthy rigs only pay ~1 extra
 * block (geometric convergence); pathological cases hit the SETTLE_BLOCKS
 * cap exactly as before. `converged` still reports against CONVERGE_TOL. */
const SETTLE_EXIT_TOL = 1e-9;
/** Settle stagnation exit: Gauss–Seidel has a floating-point floor per pose
 * (rope inequalities and hinge ties can cycle at ~1e-8, above EXIT_TOL). If
 * a whole block improves the violation by less than 3%, further blocks are
 * provably useless — stop and keep the budget. A genuinely converging hard
 * pose (the four-bar branch-limit frame relaxes at ~0.90 per block) is well
 * below the factor and keeps sweeping. */
const SETTLE_STAGNATION_FACTOR = 0.97;
/** Successive over-relaxation factor for the settle's equality distance
 * projections. GS on serial chains (leg/neck assemblies: links + hinge ties)
 * relaxes at ~0.9986/sweep; ω = 1.7 roughly squares the rate at identical
 * fixed points (a satisfied constraint steps zero for any ω). The drag loop
 * and all inequality projections stay at ω = 1 for clamp stability. */
const SETTLE_OMEGA = 1.7;

interface P {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
}

interface KConstraint {
  /** element id reported when violated */
  elementId: string;
  project(omega?: number): void;
  /** current violation magnitude (0 for a satisfied inequality) */
  violation(): number;
  /** scalar equality constraints contributed to the mobility count (0 for
   * inequalities; redundant rigid-body pairs are not double-counted) */
  mobilityEqualities: number;
  /** incident particles — island decomposition splits the constraint graph
   * at held particles (see solveKinematic) */
  parts(): P[];
}

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
    const dx = this.p1.x - this.p2.x;
    const dy = this.p1.y - this.p2.y;
    const dz = this.p1.z - this.p2.z;
    const c = Math.sqrt(dx * dx + dy * dy + dz * dz) - this.rest;
    if (this.kind === 'max') return Math.max(0, c);
    if (this.kind === 'min') return Math.min(0, c);
    return c;
  }

  project(omega = 1): void {
    const dx = this.p1.x - this.p2.x;
    const dy = this.p1.y - this.p2.y;
    const dz = this.p1.z - this.p2.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let C = len - this.rest;
    if (this.kind === 'max') C = Math.max(0, C);
    else if (this.kind === 'min') C = Math.min(0, C);
    if (C === 0) return;
    if (len < 1e-12) return;
    const wSum = this.p1.w + this.p2.w;
    if (wSum === 0) return;
    // over-relaxation (settle only, equalities only): same fixed point
    // (C = 0 steps are zero regardless of ω), ~squared convergence rate on
    // serial chains; inequalities keep ω = 1 to avoid clamp chatter
    const s = (this.kind === 'eq' ? omega : 1) * (-C / wSum);
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    this.p1.x += this.p1.w * s * nx;
    this.p1.y += this.p1.w * s * ny;
    this.p1.z += this.p1.w * s * nz;
    this.p2.x -= this.p2.w * s * nx;
    this.p2.y -= this.p2.w * s * ny;
    this.p2.z -= this.p2.w * s * nz;
  }

  violation(): number {
    return Math.abs(this.C());
  }

  parts(): P[] {
    return [this.p1, this.p2];
  }
}

/** Hinge angle limit: signed angle about the pivot's current axis direction
 * (pivot → virtual particle), same 0-=-straight convention as 2D (hinge.ts). */
class AngleLimitC implements KConstraint {
  readonly mobilityEqualities = 0;
  constructor(
    readonly elementId: string,
    private readonly pivot: P,
    private readonly a: P,
    private readonly b: P,
    private readonly axisTip: P,
    private readonly minRad: number,
    private readonly maxRad: number,
  ) {}

  private C(theta: number): number {
    if (theta < this.minRad) return theta - this.minRad;
    if (theta > this.maxRad) return theta - this.maxRad;
    return 0;
  }

  project(): void {
    const ag = angle3(this.pivot, this.a, this.b, this.pivot, this.axisTip);
    if (!ag) return;
    const C = this.C(ag.theta);
    if (C === 0) return;
    const denom =
      this.a.w * (ag.ga.x ** 2 + ag.ga.y ** 2 + ag.ga.z ** 2) +
      this.b.w * (ag.gb.x ** 2 + ag.gb.y ** 2 + ag.gb.z ** 2) +
      this.pivot.w * (ag.gp.x ** 2 + ag.gp.y ** 2 + ag.gp.z ** 2);
    if (denom === 0) return;
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
    return ag ? Math.abs(this.C(ag.theta)) : 0;
  }

  parts(): P[] {
    return [this.pivot, this.a, this.b, this.axisTip];
  }
}

/** Node on the axis of a link (A→B), with travel limits on the projected
 * parameter. In 3D the on-line condition removes TWO translational DOF, so it
 * counts 2 mobility equalities; the perpendicular offset is projected out as
 * one scalar along its own direction each pass. Gradients distributed
 * barycentrically to the rail ends. */
class PointOnLineC implements KConstraint {
  constructor(
    readonly elementId: string,
    private readonly n: P,
    private readonly a: P,
    private readonly b: P,
    private readonly travelMin: number,
    private readonly travelMax: number,
    readonly mobilityEqualities: number,
  ) {}

  project(): void {
    const ux = this.b.x - this.a.x;
    const uy = this.b.y - this.a.y;
    const uz = this.b.z - this.a.z;
    const L = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (L < 1e-12) return;
    const ex = ux / L;
    const ey = uy / L;
    const ez = uz / L;
    const relx = this.n.x - this.a.x;
    const rely = this.n.y - this.a.y;
    const relz = this.n.z - this.a.z;
    const s = relx * ex + rely * ey + relz * ez;
    const t = s / L;
    // perpendicular offset (equality): project it out along its own direction
    const px = relx - s * ex;
    const py = rely - s * ey;
    const pz = relz - s * ez;
    const cPerp = Math.sqrt(px * px + py * py + pz * pz);
    if (cPerp > 1e-12) this.apply(cPerp, px / cPerp, py / cPerp, pz / cPerp, t);
    // travel limits (inequalities), along the axis
    const sMin = this.travelMin * L;
    const sMax = this.travelMax * L;
    if (s < sMin) this.apply(s - sMin, ex, ey, ez, t);
    else if (s > sMax) this.apply(s - sMax, ex, ey, ez, t);
  }

  private apply(C: number, gx: number, gy: number, gz: number, t: number): void {
    if (C === 0) return;
    const wa = this.a.w * (1 - t) * (1 - t);
    const wb = this.b.w * t * t;
    const denom = this.n.w + wa + wb;
    if (denom === 0) return;
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

  violation(): number {
    const ux = this.b.x - this.a.x;
    const uy = this.b.y - this.a.y;
    const uz = this.b.z - this.a.z;
    const L = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (L < 1e-12) return 0;
    const relx = this.n.x - this.a.x;
    const rely = this.n.y - this.a.y;
    const relz = this.n.z - this.a.z;
    const s = (relx * ux + rely * uy + relz * uz) / L;
    const px = relx - (s / L) * ux;
    const py = rely - (s / L) * uy;
    const pz = relz - (s / L) * uz;
    const cPerp = Math.sqrt(px * px + py * py + pz * pz);
    const under = Math.max(0, this.travelMin * L - s);
    const over = Math.max(0, s - this.travelMax * L);
    return Math.max(cPerp, under, over);
  }

  parts(): P[] {
    return [this.n, this.a, this.b];
  }
}

/** Ground plane y ≥ 0 (v6 slice C, carried to world y): free USER nodes
 * cannot pass below the floor. A pure clamp — zero mobility cost, and floors
 * project last in every pass, so the floor itself is always satisfied
 * afterwards and never appears in `violated`; geometry that cannot stay above
 * it reports on its own elements. Virtual axis particles are exempt (solver
 * internals, not physical pipe ends). */
class FloorC implements KConstraint {
  readonly elementId = '__floor__';
  readonly mobilityEqualities = 0;
  constructor(private readonly p: P) {}

  project(): void {
    if (this.p.w === 0) return;
    if (this.p.y < 0) this.p.y = 0;
  }

  violation(): number {
    return Math.max(0, -this.p.y);
  }

  parts(): P[] {
    return [this.p];
  }
}

/** Drag target: a wish, projected before the real constraints each
 * iteration so geometry always wins. Not counted in residual/DOF. */
class DragC {
  constructor(
    readonly p: P,
    readonly target: Vec3,
  ) {}

  project(): void {
    if (this.p.w === 0) return;
    this.p.x = this.target.x;
    this.p.y = this.target.y;
    this.p.z = this.target.z;
  }
}

function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

export function solveKinematic(mechanism: Mechanism, inputs: SolveInputs): SolveResult {
  // driven nodes are prescribed by their input channel (§4.2) and held fixed
  // there, exactly like equilibrium mode — so a channel drives the same
  // geometry in drag and settle. No driven nodes ⇒ this is empty and inert.
  const driven = drivenTargets(mechanism, inputs);
  const particles = new Map<string, P>(
    mechanism.nodes.map((n) => {
      // driven nodes follow their channel; anchor nodes follow the wearer
      // attachment target when one is supplied (groundTargets) — both are
      // prescribed (weight 0), so the structure hangs off the moved point
      const target =
        n.kind === 'driven'
          ? driven[n.id]
          : n.kind === 'anchor'
            ? inputs.groundTargets?.[n.id]
            : undefined;
      const p = target ?? n.position;
      return [
        n.id,
        {
          id: n.id,
          x: p.x,
          y: p.y,
          z: p.z,
          w: n.kind === 'anchor' || n.kind === 'driven' ? 0 : 1,
        },
      ];
    }),
  );
  const userIds = new Set(mechanism.nodes.map((n) => n.id));
  const pos = new Map(mechanism.nodes.map((n) => [n.id, n.position]));
  const get = (id: string): P => {
    const p = particles.get(id);
    if (!p) throw new Error(`unknown node ${id}`);
    return p;
  };
  const elementById = new Map(mechanism.elements.map((e) => [e.id, e]));
  const free = new Set(mechanism.nodes.filter((n) => n.kind === 'free').map((n) => n.id));
  const sortedElements = [...mechanism.elements].sort((a, b) => a.id.localeCompare(b.id));

  // virtual axis particles for hinge pivots (hinge.ts), created before the
  // constraint pass so ties can reference them; pinned axes (grounded hinges)
  // get weight 0 at (current pivot + drawn axis·h)
  const hingePlans = new Map<string, HingePlan>();
  let freeVirtualCount = 0;
  for (const el of sortedElements) {
    if (el.type !== 'pivot') continue;
    const plan = hingePlan(el, pos, elementById, (id) => get(id).w === 0);
    if (!plan) continue;
    hingePlans.set(el.id, plan);
    const pivot = get(plan.pivotNodeId);
    particles.set(plan.virtualId, {
      id: plan.virtualId,
      x: pivot.x + plan.axis.x * plan.h,
      y: pivot.y + plan.axis.y * plan.h,
      z: pivot.z + plan.axis.z * plan.h,
      w: plan.pinned ? 0 : 1,
    });
    if (!plan.pinned) {
      free.add(plan.virtualId);
      freeVirtualCount++;
    }
  }
  // an equality only reduces mobility if it touches at least one free particle
  const mob = (...ids: string[]): 0 | 1 => (ids.some((id) => free.has(id)) ? 1 : 0);

  const constraints: KConstraint[] = [];
  for (const el of sortedElements) {
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
        // all-pairs distances for projection robustness; only 3k−6 count
        // toward mobility (the rest are redundant rigid-body constraints)
        const ids = el.nodeIds;
        let mobilityLeft = 3 * ids.length - 6;
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
          // angle limits are hinge-only (measured about the axis)
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
                  virtual,
                  el.angleLimit.minRad,
                  el.angleLimit.maxRad,
                ),
              );
            }
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
              mob(el.nodeId) ? 2 : 0,
            ),
          );
        }
        break;
      }
      // force elements are inert in kinematic mode
      case 'rope':
      case 'elastic':
      case 'bowden':
      case 'torsionCable':
        break;
    }
  }

  // floor last so each pass ends with y ≥ 0 for every free user node
  for (const n of mechanism.nodes) {
    if (n.kind === 'free') constraints.push(new FloorC(get(n.id)));
  }

  // a drag wish cannot point underground: clamped to the floor surface, so a
  // pointer below ground drags ALONG the ground instead of collapsing the
  // linkage collinear onto it (a degenerate manifold the symmetry nudge
  // cannot escape — the floor clamp kills the downward half of every nudge)
  const drags: DragC[] = Object.entries(inputs.dragTargets ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([id]) => particles.has(id) && userIds.has(id))
    .map(
      ([id, target]) => new DragC(get(id), { x: target.x, y: Math.max(0, target.y), z: target.z }),
    );

  // ── island decomposition ────────────────────────────────────────────────
  // Gauss–Seidel corrections propagate only through FREE particles: held
  // particles (anchors / driven / pinned axis virtuals) absorb no motion, so
  // the constraint graph splits at them into independent islands whose
  // separate solves are exactly what interleaved global sweeps would compute
  // — but each island stops as soon as IT is done. On a compound document
  // (many subsystems bound to the wearer) this is the difference between the
  // slowest subsystem sweeping its own ~10 constraints and sweeping all of
  // them. Deterministic: islands form in constraint order and keep the
  // global element-id constraint order within.
  const rootOf = new Map<string, string>();
  for (const p of particles.values()) if (p.w > 0) rootOf.set(p.id, p.id);
  const findRoot = (id: string): string => {
    let r = id;
    while (rootOf.get(r) !== r) r = rootOf.get(r)!;
    let cur = id;
    while (cur !== r) {
      const next = rootOf.get(cur)!;
      rootOf.set(cur, r);
      cur = next;
    }
    return r;
  };
  for (const c of constraints) {
    const freeParts = c.parts().filter((p) => p.w > 0);
    for (let i = 1; i < freeParts.length; i++) {
      const ra = findRoot(freeParts[0]!.id);
      const rb = findRoot(freeParts[i]!.id);
      if (ra !== rb) rootOf.set(rb, ra);
    }
  }

  interface Island {
    constraints: KConstraint[];
    drags: DragC[];
    parts: P[];
  }
  const islandByRoot = new Map<string, Island>();
  const islands: Island[] = [];
  const islandFor = (root: string): Island => {
    let island = islandByRoot.get(root);
    if (!island) {
      island = { constraints: [], drags: [], parts: [] };
      islandByRoot.set(root, island);
      islands.push(island);
    }
    return island;
  };
  for (const c of constraints) {
    const firstFree = c.parts().find((p) => p.w > 0);
    // fully-held constraints move nothing — excluded from the solve, still
    // part of the residual/DOF reporting below
    if (firstFree) islandFor(findRoot(firstFree.id)).constraints.push(c);
  }
  for (const d of drags) {
    if (d.p.w > 0) islandFor(findRoot(d.p.id)).drags.push(d);
  }
  for (const p of particles.values()) {
    if (p.w === 0) continue;
    const island = islandByRoot.get(findRoot(p.id));
    if (island) island.parts.push(p);
  }

  // ── per-island solve: drag loop → settle → degeneracy nudges ────────────
  const solveIsland = (island: Island): void => {
    const cs = island.constraints;
    const maxViolation = () => {
      let r = 0;
      for (const c of cs) r = Math.max(r, c.violation());
      return r;
    };
    const settle = () => {
      let prev = maxViolation();
      if (prev <= SETTLE_EXIT_TOL) return;
      for (let b = 0; b < SETTLE_BLOCKS; b++) {
        for (let it = 0; it < SETTLE_ITERATIONS; it++) {
          for (const c of cs) c.project(SETTLE_OMEGA);
        }
        const v = maxViolation();
        if (v <= SETTLE_EXIT_TOL || v > prev * SETTLE_STAGNATION_FACTOR) return;
        prev = v;
      }
    };

    // drag loop with fixed-point exit (see FIXED_POINT_CHECK); without drags
    // the settle below is the whole job
    if (island.drags.length > 0) {
      const fpSnap = new Float64Array(island.parts.length * 3);
      const takeSnap = () => {
        for (let i = 0; i < island.parts.length; i++) {
          fpSnap[3 * i] = island.parts[i]!.x;
          fpSnap[3 * i + 1] = island.parts[i]!.y;
          fpSnap[3 * i + 2] = island.parts[i]!.z;
        }
      };
      const snapDrift = () => {
        let d = 0;
        for (let i = 0; i < island.parts.length; i++) {
          d = Math.max(
            d,
            Math.abs(island.parts[i]!.x - fpSnap[3 * i]!),
            Math.abs(island.parts[i]!.y - fpSnap[3 * i + 1]!),
            Math.abs(island.parts[i]!.z - fpSnap[3 * i + 2]!),
          );
        }
        return d;
      };
      takeSnap();
      for (let it = 0; it < ITERATIONS; it++) {
        for (const d of island.drags) d.project();
        for (const c of cs) c.project();
        if ((it + 1) % FIXED_POINT_CHECK === 0) {
          if (snapDrift() < FIXED_POINT_TOL) break;
          takeSnap();
        }
      }
    }
    // release the drag and settle onto the constraint manifold
    settle();

    // degenerate configurations (e.g. links dragged exactly collinear) leave
    // Gauss–Seidel with no perpendicular gradient to escape along; a tiny
    // DETERMINISTIC golden-angle nudge per free particle breaks the symmetry
    // (with a z component in 3D). Truly conflicting constraints stay violated
    // and get reported below.
    for (let round = 0; round < 3 && maxViolation() > CONVERGE_TOL; round++) {
      // escalate per round: 1e-6 breaks exact collinearity; a floor wedge
      // (the satisfying pose is well above ground, the iterate pinned onto
      // the floor by the clamp) needs a kick on the scale of the violation
      // itself to leave the wrong basin, so the last round lifts by
      // maxViolation()
      const mag = round < 2 ? 1e-6 * 10 ** round : Math.max(1e-4, maxViolation());
      let k = 0;
      for (const p of island.parts) {
        k++;
        p.x += 1e-6 * Math.sin(k * 2.39996);
        // a particle resting on the floor can only escape upward, and by the
        // full magnitude — the clamp erases downward nudges, and a golden-
        // angle fraction can be arbitrarily small for exactly the stuck
        // particle
        p.y += p.y <= CONVERGE_TOL ? mag : 1e-6 * Math.cos(k * 2.39996);
        p.z += 1e-6 * Math.sin(k * 2.39996 * 0.5 + 1);
      }
      settle();
    }
  };
  for (const island of islands) solveIsland(island);

  let residual = 0;
  const violatedSet = new Set<string>();
  for (const c of constraints) {
    const v = c.violation();
    residual = Math.max(residual, v);
    if (v > CONVERGE_TOL) violatedSet.add(c.elementId);
  }

  // mobility: particle-space DOF (3 per mobile particle, virtual axis
  // particles included) minus independent equality constraints that touch at
  // least one free particle (PLANFILE-3d-conversion.md)
  const freeCount = mechanism.nodes.filter((n) => n.kind !== 'anchor').length + freeVirtualCount;
  let equalities = 0;
  for (const c of constraints) equalities += c.mobilityEqualities;
  const dof = 3 * freeCount - equalities;

  const positions: Record<string, Vec3> = {};
  for (const p of particles.values()) {
    if (userIds.has(p.id)) positions[p.id] = { x: p.x, y: p.y, z: p.z };
  }

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
