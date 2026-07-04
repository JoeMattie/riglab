// Candidate 1: custom XPBD solver (planfile §5.1 reference design).
// Particles + compliant constraint projection, Gauss–Seidel, fixed iteration
// count and constraint order, λ accumulation for force extraction.
import type { Scenario, SpikeAdapter, Vec2 } from '../harness/types';

const ITERATIONS = 30;
const DAMPING = 0.85;

interface Particle {
  id: string;
  x: number;
  y: number;
  px: number; // position at start of step (for velocity update)
  py: number;
  vx: number;
  vy: number;
  w: number; // inverse mass; 0 = anchor
}

interface Constraint {
  id: string;
  lambda: number;
  project(dt: number): void;
  /** Signed axial force, newtons; tension positive. */
  force(dt: number): number;
}

class DistanceConstraint implements Constraint {
  lambda = 0;
  constructor(
    readonly id: string,
    private readonly p1: Particle,
    private readonly p2: Particle,
    private readonly rest: number,
    /** compliance α (m/N); 0 = rigid. Zero-rest-length variants allowed. */
    private readonly compliance = 0,
    /** if true, only resists stretching (C > 0) */
    private readonly tensionOnly = false,
  ) {}

  project(dt: number): void {
    const { p1, p2 } = this;
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) return;
    const C = len - this.rest;
    if (this.tensionOnly && C <= 0 && this.lambda === 0) return;
    const alphaTilde = this.compliance / (dt * dt);
    const wSum = p1.w + p2.w;
    if (wSum + alphaTilde === 0) return;
    let dLambda = (-C - alphaTilde * this.lambda) / (wSum + alphaTilde);
    if (this.tensionOnly && this.lambda + dLambda > 0) dLambda = -this.lambda;
    this.lambda += dLambda;
    const nx = dx / len;
    const ny = dy / len;
    p1.x += p1.w * dLambda * nx;
    p1.y += p1.w * dLambda * ny;
    p2.x -= p2.w * dLambda * nx;
    p2.y -= p2.w * dLambda * ny;
  }

  force(dt: number): number {
    return -this.lambda / (dt * dt);
  }
}

/** Total polyline length through `path` ≤ rest; intermediate nodes are
 * frictionless eyelets. Tension-only. */
class RopeConstraint implements Constraint {
  lambda = 0;
  constructor(
    readonly id: string,
    private readonly path: Particle[],
    private readonly rest: number,
  ) {}

  project(dt: number): void {
    const n = this.path.length;
    let total = 0;
    const units: Vec2[] = [];
    for (let k = 0; k < n - 1; k++) {
      const a = this.path[k]!;
      const b = this.path[k + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      total += len;
      units.push(len < 1e-12 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len });
    }
    const C = total - this.rest;
    if (C <= 0 && this.lambda === 0) return;
    const grads: Vec2[] = [];
    let wg = 0;
    for (let k = 0; k < n; k++) {
      const prev = k > 0 ? units[k - 1]! : { x: 0, y: 0 };
      const next = k < n - 1 ? units[k]! : { x: 0, y: 0 };
      const g = { x: prev.x - next.x, y: prev.y - next.y };
      grads.push(g);
      wg += this.path[k]!.w * (g.x * g.x + g.y * g.y);
    }
    if (wg === 0) return;
    let dLambda = -C / wg;
    if (this.lambda + dLambda > 0) dLambda = -this.lambda;
    this.lambda += dLambda;
    for (let k = 0; k < n; k++) {
      const p = this.path[k]!;
      const g = grads[k]!;
      // note: gradient of C w.r.t. p_k is (u_{k-1} − u_k); grads[k] holds that
      p.x += p.w * dLambda * g.x;
      p.y += p.w * dLambda * g.y;
    }
  }

  force(dt: number): number {
    return -this.lambda / (dt * dt);
  }
}

/** (|a1a2| − lenA0) + (|b1b2| − lenB0) ≤ 0, tension-only. */
class BowdenConstraint implements Constraint {
  lambda = 0;
  constructor(
    readonly id: string,
    private readonly a1: Particle,
    private readonly a2: Particle,
    private readonly b1: Particle,
    private readonly b2: Particle,
    private readonly lenA0: number,
    private readonly lenB0: number,
  ) {}

  project(dt: number): void {
    const pairs: Array<[Particle, Particle]> = [
      [this.a1, this.a2],
      [this.b1, this.b2],
    ];
    let C = -(this.lenA0 + this.lenB0);
    const units: Vec2[] = [];
    for (const [p, q] of pairs) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy);
      C += len;
      units.push(len < 1e-12 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len });
    }
    if (C <= 0 && this.lambda === 0) return;
    let wg = 0;
    for (let i = 0; i < 2; i++) {
      const [p, q] = pairs[i]!;
      const u = units[i]!;
      const g2 = u.x * u.x + u.y * u.y;
      wg += (p.w + q.w) * g2;
    }
    if (wg === 0) return;
    let dLambda = -C / wg;
    if (this.lambda + dLambda > 0) dLambda = -this.lambda;
    this.lambda += dLambda;
    for (let i = 0; i < 2; i++) {
      const [p, q] = pairs[i]!;
      const u = units[i]!;
      p.x -= p.w * dLambda * u.x;
      p.y -= p.w * dLambda * u.y;
      q.x += q.w * dLambda * u.x;
      q.y += q.w * dLambda * u.y;
    }
  }

  force(dt: number): number {
    return -this.lambda / (dt * dt);
  }
}

/** Pulls a particle to a target point; rigid (compliance 0). Used for drag. */
class TargetConstraint implements Constraint {
  lambda = 0;
  target: Vec2 = { x: 0, y: 0 };
  constructor(
    readonly id: string,
    private readonly p: Particle,
  ) {}

  project(_dt: number): void {
    const dx = this.p.x - this.target.x;
    const dy = this.p.y - this.target.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-12 || this.p.w === 0) return;
    // Direct projection with unit weight share: behaves as an infinitely
    // stiff attachment negotiated by Gauss–Seidel with the other constraints.
    this.p.x -= dx;
    this.p.y -= dy;
    this.lambda += -len; // bookkeeping only
  }

  force(dt: number): number {
    return -this.lambda / (dt * dt);
  }
}

export class XpbdAdapter implements SpikeAdapter {
  readonly name = 'custom-xpbd';
  private particles = new Map<string, Particle>();
  private constraints: Constraint[] = [];
  private drags = new Map<string, TargetConstraint>();
  private gravity: Vec2 = { x: 0, y: 0 };
  private lastDt = 1 / 60;

  init(scenario: Scenario): Promise<void> {
    this.gravity = scenario.gravity;
    this.particles = new Map(
      scenario.nodes.map((n) => [
        n.id,
        {
          id: n.id,
          x: n.x,
          y: n.y,
          px: n.x,
          py: n.y,
          vx: 0,
          vy: 0,
          w: n.kind === 'anchor' ? 0 : 1 / n.mass,
        },
      ]),
    );
    const get = (id: string): Particle => {
      const p = this.particles.get(id);
      if (!p) throw new Error(`unknown node ${id}`);
      return p;
    };
    const d = (a: Particle, b: Particle) => Math.hypot(a.x - b.x, a.y - b.y);
    this.constraints = [
      ...scenario.rods.map((r) => {
        const a = get(r.a);
        const b = get(r.b);
        return new DistanceConstraint(r.id, a, b, d(a, b));
      }),
      ...scenario.ropes.map((r) => {
        const path = r.path.map(get);
        let len = 0;
        for (let k = 0; k < path.length - 1; k++) len += d(path[k]!, path[k + 1]!);
        return new RopeConstraint(r.id, path, r.length ?? len);
      }),
      ...scenario.bowdens.map((b) => {
        const a1 = get(b.a1);
        const a2 = get(b.a2);
        const b1 = get(b.b1);
        const b2 = get(b.b2);
        return new BowdenConstraint(b.id, a1, a2, b1, b2, d(a1, a2), d(b1, b2));
      }),
    ].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    return Promise.resolve();
  }

  step(dt: number): void {
    this.lastDt = dt;
    for (const p of this.particles.values()) {
      if (p.w === 0) continue;
      p.vx += this.gravity.x * dt;
      p.vy += this.gravity.y * dt;
      p.px = p.x;
      p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    const active: Constraint[] = [...this.constraints, ...this.drags.values()];
    for (const c of active) c.lambda = 0;
    for (let it = 0; it < ITERATIONS; it++) {
      for (const c of active) c.project(dt);
    }
    // Damping is applied to the recovered velocity, after projection: damping
    // the pre-projection gravity impulse instead would bias extracted
    // constraint forces (λ would only ever see 0.85·g).
    for (const p of this.particles.values()) {
      if (p.w === 0) continue;
      p.vx = ((p.x - p.px) / dt) * DAMPING;
      p.vy = ((p.y - p.py) / dt) * DAMPING;
    }
  }

  setDragTarget(nodeId: string, pos: Vec2 | null): void {
    if (pos === null) {
      this.drags.delete(nodeId);
      return;
    }
    let c = this.drags.get(nodeId);
    if (!c) {
      const p = this.particles.get(nodeId);
      if (!p) throw new Error(`unknown node ${nodeId}`);
      c = new TargetConstraint(`drag:${nodeId}`, p);
      this.drags.set(nodeId, c);
    }
    c.target = { ...pos };
  }

  positions(): Record<string, Vec2> {
    const out: Record<string, Vec2> = {};
    for (const p of this.particles.values()) out[p.id] = { x: p.x, y: p.y };
    return out;
  }

  forces(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.constraints) out[c.id] = c.force(this.lastDt);
    return out;
  }

  dispose(): void {
    this.particles.clear();
    this.constraints = [];
    this.drags.clear();
  }
}
