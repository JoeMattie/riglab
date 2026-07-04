// Candidate 3: planck.js (Box2D port) in damped/static mode.
//
// Same mapping as the Rapier candidate: nodes are point bodies (anchors
// static), rods are bar bodies with revolute joints, ropes/bowden run as a
// custom position-correction pass after each step with λ tension readout.
// Box2D specifics: sleeping disabled, linearSlop tightened from its 5 mm
// game default, bar masses scaled to endpoint loads (same mass-ratio
// conditioning issue as Rapier), gravity for pass bodies applied as a
// pre-step velocity impulse so λ readouts stay unbiased.
import { Body, RevoluteJoint, Settings, Vec2 as PVec2, World } from 'planck';
import type { Scenario, SpikeAdapter, Vec2 } from '../harness/types';

const PASS_ITERATIONS = 30;
const DAMPING = 0.85;
const VELOCITY_ITERATIONS = 16;
const POSITION_ITERATIONS = 8;

Settings.linearSlop = 1e-4;

interface RopePass {
  id: string;
  bodies: Body[];
  invMasses: number[];
  length: number;
  lambda: number;
}

interface BowdenPass {
  id: string;
  bodies: [Body, Body, Body, Body];
  invMasses: [number, number, number, number];
  lenA0: number;
  lenB0: number;
  lambda: number;
}

export class PlanckAdapter implements SpikeAdapter {
  readonly name = 'planck';
  private world: World | null = null;
  private nodeBodies = new Map<string, Body>();
  private nodeMasses = new Map<string, number>();
  private dragHeld = new Set<Body>();
  private ropes: RopePass[] = [];
  private bowdens: BowdenPass[] = [];
  private drags = new Map<string, Vec2>();
  private passBodies = new Set<Body>();
  private passBodyIds = new Set<string>();
  private gravity: Vec2 = { x: 0, y: 0 };
  private lastDt = 1 / 60;

  init(scenario: Scenario): Promise<void> {
    const world = new World({
      gravity: new PVec2(scenario.gravity.x, scenario.gravity.y),
      allowSleep: false,
    });
    this.world = world;
    this.gravity = { ...scenario.gravity };

    for (const n of scenario.nodes) {
      const body = world.createBody({
        type: n.kind === 'anchor' ? 'static' : 'dynamic',
        position: new PVec2(n.x, n.y),
        fixedRotation: true,
      });
      if (n.kind === 'free') {
        body.setMassData({ mass: n.mass, center: new PVec2(0, 0), I: 0 });
      }
      this.nodeBodies.set(n.id, body);
      this.nodeMasses.set(n.id, n.kind === 'anchor' ? 0 : n.mass);
    }

    const nodePos = new Map(scenario.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    for (const rod of scenario.rods) {
      const pa = nodePos.get(rod.a);
      const pb = nodePos.get(rod.b);
      const ba = this.nodeBodies.get(rod.a);
      const bb = this.nodeBodies.get(rod.b);
      if (!pa || !pb || !ba || !bb) throw new Error(`rod ${rod.id}: unknown node`);
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const angle = Math.atan2(pb.y - pa.y, pb.x - pa.x);
      const ma = this.nodeMasses.get(rod.a) ?? 0;
      const mb = this.nodeMasses.get(rod.b) ?? 0;
      const barMass = Math.max(0.05, ma + mb);
      const bar = world.createBody({
        type: 'dynamic',
        position: new PVec2((pa.x + pb.x) / 2, (pa.y + pb.y) / 2),
        angle,
      });
      bar.setMassData({
        mass: barMass,
        center: new PVec2(0, 0),
        I: (barMass * len * len) / 12,
      });
      world.createJoint(new RevoluteJoint({}, bar, ba, new PVec2(pa.x, pa.y)));
      world.createJoint(new RevoluteJoint({}, bar, bb, new PVec2(pb.x, pb.y)));
    }

    const pathLen = (ids: string[]): number => {
      let total = 0;
      for (let k = 0; k < ids.length - 1; k++) {
        const p = nodePos.get(ids[k]!)!;
        const q = nodePos.get(ids[k + 1]!)!;
        total += Math.hypot(q.x - p.x, q.y - p.y);
      }
      return total;
    };
    for (const rope of [...scenario.ropes].sort((a, b) => a.id.localeCompare(b.id))) {
      this.ropes.push({
        id: rope.id,
        bodies: rope.path.map((id) => this.nodeBodies.get(id)!),
        invMasses: rope.path.map((id) => this.invMass(id)),
        length: rope.length ?? pathLen(rope.path),
        lambda: 0,
      });
      for (const id of rope.path) this.passBodyIds.add(id);
    }
    for (const bw of [...scenario.bowdens].sort((a, b) => a.id.localeCompare(b.id))) {
      const ids = [bw.a1, bw.a2, bw.b1, bw.b2] as const;
      this.bowdens.push({
        id: bw.id,
        bodies: ids.map((id) => this.nodeBodies.get(id)!) as BowdenPass['bodies'],
        invMasses: ids.map((id) => this.invMass(id)) as BowdenPass['invMasses'],
        lenA0: pathLen([bw.a1, bw.a2]),
        lenB0: pathLen([bw.b1, bw.b2]),
        lambda: 0,
      });
      for (const id of ids) this.passBodyIds.add(id);
    }
    for (const id of this.passBodyIds) {
      const body = this.nodeBodies.get(id)!;
      this.passBodies.add(body);
      if (body.isDynamic()) body.setGravityScale(0);
    }
    return Promise.resolve();
  }

  private invMass(nodeId: string): number {
    const m = this.nodeMasses.get(nodeId) ?? 0;
    return m > 0 ? 1 / m : 0;
  }

  step(dt: number): void {
    const world = this.world;
    if (!world) throw new Error('adapter not initialized');
    this.lastDt = dt;

    const pre = new Map<string, Vec2>();
    for (const id of this.passBodyIds) {
      const p = this.nodeBodies.get(id)!.getPosition();
      pre.set(id, { x: p.x, y: p.y });
    }

    for (const id of this.passBodyIds) {
      const body = this.nodeBodies.get(id)!;
      if (!body.isDynamic() || this.drags.has(id)) continue;
      const v = body.getLinearVelocity();
      body.setLinearVelocity(
        new PVec2(v.x + this.gravity.x * dt, v.y + this.gravity.y * dt),
      );
    }

    this.dragHeld.clear();
    for (const [id, target] of this.drags) {
      const body = this.nodeBodies.get(id);
      if (!body) continue;
      this.dragHeld.add(body);
      const p = body.getPosition();
      body.setLinearVelocity(new PVec2((target.x - p.x) / dt, (target.y - p.y) / dt));
    }

    world.step(dt, VELOCITY_ITERATIONS, POSITION_ITERATIONS);

    for (const [id, target] of this.drags) {
      const body = this.nodeBodies.get(id);
      if (!body) continue;
      body.setTransform(new PVec2(target.x, target.y), body.getAngle());
      body.setLinearVelocity(new PVec2(0, 0));
    }

    for (const r of this.ropes) r.lambda = 0;
    for (const b of this.bowdens) b.lambda = 0;
    for (let it = 0; it < PASS_ITERATIONS; it++) {
      for (const r of this.ropes) this.projectRope(r);
      for (const b of this.bowdens) this.projectBowden(b);
    }

    for (const id of this.passBodyIds) {
      if (this.drags.has(id)) continue;
      const body = this.nodeBodies.get(id)!;
      if (!body.isDynamic()) continue;
      const p0 = pre.get(id)!;
      const p = body.getPosition();
      body.setLinearVelocity(
        new PVec2(((p.x - p0.x) / dt) * DAMPING, ((p.y - p0.y) / dt) * DAMPING),
      );
    }
  }

  private wOf(body: Body, invMass: number): number {
    if (!body.isDynamic()) return 0;
    if (this.dragHeld.has(body)) return 0;
    return invMass;
  }

  private projectRope(r: RopePass): void {
    const n = r.bodies.length;
    const pos = r.bodies.map((b) => b.getPosition());
    let total = 0;
    const units: Vec2[] = [];
    for (let k = 0; k < n - 1; k++) {
      const dx = pos[k + 1]!.x - pos[k]!.x;
      const dy = pos[k + 1]!.y - pos[k]!.y;
      const len = Math.hypot(dx, dy);
      total += len;
      units.push(len < 1e-12 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len });
    }
    const C = total - r.length;
    if (C <= 0 && r.lambda === 0) return;
    const grads: Vec2[] = [];
    let wg = 0;
    for (let k = 0; k < n; k++) {
      const prev = k > 0 ? units[k - 1]! : { x: 0, y: 0 };
      const next = k < n - 1 ? units[k]! : { x: 0, y: 0 };
      const g = { x: prev.x - next.x, y: prev.y - next.y };
      grads.push(g);
      wg += this.wOf(r.bodies[k]!, r.invMasses[k]!) * (g.x * g.x + g.y * g.y);
    }
    if (wg === 0) return;
    let dLambda = -C / wg;
    if (r.lambda + dLambda > 0) dLambda = -r.lambda;
    r.lambda += dLambda;
    for (let k = 0; k < n; k++) {
      const body = r.bodies[k]!;
      const w = this.wOf(body, r.invMasses[k]!);
      if (w === 0) continue;
      const p = body.getPosition();
      const g = grads[k]!;
      body.setTransform(
        new PVec2(p.x + w * dLambda * g.x, p.y + w * dLambda * g.y),
        body.getAngle(),
      );
    }
  }

  private projectBowden(b: BowdenPass): void {
    const pairs: Array<[Body, Body, number, number]> = [
      [b.bodies[0], b.bodies[1], b.invMasses[0], b.invMasses[1]],
      [b.bodies[2], b.bodies[3], b.invMasses[2], b.invMasses[3]],
    ];
    let C = -(b.lenA0 + b.lenB0);
    const units: Vec2[] = [];
    for (const [p, q] of pairs) {
      const tp = p.getPosition();
      const tq = q.getPosition();
      const dx = tq.x - tp.x;
      const dy = tq.y - tp.y;
      const len = Math.hypot(dx, dy);
      C += len;
      units.push(len < 1e-12 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len });
    }
    if (C <= 0 && b.lambda === 0) return;
    let wg = 0;
    for (const [p, q, wp, wq] of pairs) {
      wg += this.wOf(p, wp) + this.wOf(q, wq);
    }
    if (wg === 0) return;
    let dLambda = -C / wg;
    if (b.lambda + dLambda > 0) dLambda = -b.lambda;
    b.lambda += dLambda;
    for (let i = 0; i < 2; i++) {
      const [p, q, wp, wq] = pairs[i]!;
      const u = units[i]!;
      const wpe = this.wOf(p, wp);
      const wqe = this.wOf(q, wq);
      if (wpe > 0) {
        const tp = p.getPosition();
        p.setTransform(
          new PVec2(tp.x - wpe * dLambda * u.x, tp.y - wpe * dLambda * u.y),
          p.getAngle(),
        );
      }
      if (wqe > 0) {
        const tq = q.getPosition();
        q.setTransform(
          new PVec2(tq.x + wqe * dLambda * u.x, tq.y + wqe * dLambda * u.y),
          q.getAngle(),
        );
      }
    }
  }

  setDragTarget(nodeId: string, pos: Vec2 | null): void {
    if (pos === null) this.drags.delete(nodeId);
    else this.drags.set(nodeId, { ...pos });
  }

  positions(): Record<string, Vec2> {
    const out: Record<string, Vec2> = {};
    for (const [id, body] of this.nodeBodies) {
      const p = body.getPosition();
      out[id] = { x: p.x, y: p.y };
    }
    return out;
  }

  forces(): Record<string, number> {
    const out: Record<string, number> = {};
    const dt2 = this.lastDt * this.lastDt;
    for (const r of this.ropes) out[r.id] = -r.lambda / dt2;
    for (const b of this.bowdens) out[b.id] = -b.lambda / dt2;
    // pivot reactions are available natively via joint.getReactionForce —
    // noted for the force-extraction score in DECISIONS.md
    return out;
  }

  dispose(): void {
    this.world = null;
    this.nodeBodies.clear();
    this.nodeMasses.clear();
    this.ropes = [];
    this.bowdens = [];
    this.drags.clear();
    this.dragHeld.clear();
    this.passBodies.clear();
    this.passBodyIds.clear();
  }
}
