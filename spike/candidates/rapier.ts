// Candidate 2: Rapier2D (@dimforge/rapier2d-compat) in damped/static mode.
//
// Mapping: every scenario node is a point rigid body (rotation locked;
// anchors are fixed bodies). Every rod is a bar rigid body connected by
// revolute joints to its endpoint node bodies — the idiomatic engine
// representation of links + pivots. Ropes (with eyelets) and bowden have no
// native equivalent, so they run as a custom position-correction pass after
// each engine step (the "engine + custom constraint pass" hybrid the
// planfile §3.1 anticipates), with λ accumulation for tension readout.
//
// The -compat flavor (base64-embedded WASM) is used so the same code runs in
// Node tests and browser builds; bundle-size cost is recorded in DECISIONS.md.
import RAPIER from '@dimforge/rapier2d-compat';
import type { Scenario, SpikeAdapter, Vec2 } from '../harness/types';

const PASS_ITERATIONS = 30;
const DAMPING = 0.85;

let rapierReady: Promise<unknown> | null = null;

interface RopePass {
  id: string;
  bodies: RAPIER.RigidBody[]; // path; intermediates are frictionless eyelets
  invMasses: number[];
  length: number;
  lambda: number;
}

interface BowdenPass {
  id: string;
  bodies: [RAPIER.RigidBody, RAPIER.RigidBody, RAPIER.RigidBody, RAPIER.RigidBody];
  invMasses: [number, number, number, number];
  lenA0: number;
  lenB0: number;
  lambda: number;
}

export class RapierAdapter implements SpikeAdapter {
  readonly name = 'rapier2d';
  private world: RAPIER.World | null = null;
  private nodeBodies = new Map<string, RAPIER.RigidBody>();
  private nodeMasses = new Map<string, number>();
  private ropes: RopePass[] = [];
  private bowdens: BowdenPass[] = [];
  private drags = new Map<string, Vec2>();
  private passBodyIds = new Set<string>();
  private gravity: Vec2 = { x: 0, y: 0 };
  private lastDt = 1 / 60;

  async init(scenario: Scenario): Promise<void> {
    rapierReady ??= RAPIER.init();
    await rapierReady;
    const world = new RAPIER.World(scenario.gravity);
    // more solver iterations than the game-oriented default, for accuracy
    (world as unknown as { numSolverIterations: number }).numSolverIterations = 16;
    (world as unknown as { numInternalPgsIterations: number }).numInternalPgsIterations = 4;
    this.world = world;

    for (const n of scenario.nodes) {
      const desc =
        n.kind === 'anchor'
          ? RAPIER.RigidBodyDesc.fixed()
          : RAPIER.RigidBodyDesc.dynamic().lockRotations().setAdditionalMass(n.mass);
      desc.setTranslation(n.x, n.y);
      this.nodeBodies.set(n.id, world.createRigidBody(desc));
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
      // Bar mass is scaled to the endpoint loads: extreme mass ratios
      // (light bar, heavy attached node) leave millimetre-scale steady-state
      // joint stretch in the impulse solver. Kinematics/statics targets are
      // mass-independent, so this only improves conditioning.
      const ma = this.nodeMasses.get(rod.a) ?? 0;
      const mb = this.nodeMasses.get(rod.b) ?? 0;
      const barMass = Math.max(0.05, ma + mb);
      const barDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation((pa.x + pb.x) / 2, (pa.y + pb.y) / 2)
        .setRotation(angle)
        .setAdditionalMassProperties(barMass, { x: 0, y: 0 }, (barMass * len * len) / 12);
      const bar = world.createRigidBody(barDesc);
      const half = len / 2;
      world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: -half, y: 0 }, { x: 0, y: 0 }),
        bar,
        ba,
        true,
      );
      world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: half, y: 0 }, { x: 0, y: 0 }),
        bar,
        bb,
        true,
      );
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

    // Rapier's TGS solver substeps internally, so a continuous gravity force
    // yields ~g·dt²·(n+1)/2n free-fall displacement per frame — which would
    // bias λ-based tension readouts by that factor. Custom-pass bodies get
    // gravity as an explicit pre-step velocity impulse instead, making the
    // per-frame violation exactly g·dt².
    this.gravity = { ...scenario.gravity };
    for (const id of this.passBodyIds) {
      const body = this.nodeBodies.get(id)!;
      if (!body.isFixed()) body.setGravityScale(0, true);
    }
  }

  private invMass(nodeId: string): number {
    const m = this.nodeMasses.get(nodeId) ?? 0;
    return m > 0 ? 1 / m : 0;
  }

  step(dt: number): void {
    const world = this.world;
    if (!world) throw new Error('adapter not initialized');
    this.lastDt = dt;
    world.timestep = dt;

    // record pre-step positions of custom-pass bodies for velocity recovery
    const pre = new Map<string, Vec2>();
    for (const id of this.passBodyIds) {
      const t = this.nodeBodies.get(id)!.translation();
      pre.set(id, { x: t.x, y: t.y });
    }

    // manual gravity impulse for custom-pass bodies (see init)
    for (const id of this.passBodyIds) {
      const body = this.nodeBodies.get(id)!;
      if (body.isFixed() || this.drags.has(id)) continue;
      const v = body.linvel();
      body.setLinvel({ x: v.x + this.gravity.x * dt, y: v.y + this.gravity.y * dt }, true);
    }

    // kinematic drag: steer the node body toward its target
    for (const [id, target] of this.drags) {
      const body = this.nodeBodies.get(id);
      if (!body) continue;
      const t = body.translation();
      body.setLinvel({ x: (target.x - t.x) / dt, y: (target.y - t.y) / dt }, true);
    }

    world.step();

    // dragged nodes land exactly on target (targets are always reachable in
    // the spike scenarios; the joint solver relaxes any residual next steps)
    for (const [id, target] of this.drags) {
      const body = this.nodeBodies.get(id);
      if (!body) continue;
      body.setTranslation(target, true);
      body.setLinvel({ x: 0, y: 0 }, true);
    }

    // custom constraint pass: ropes (with eyelets) + bowden, position level
    for (const r of this.ropes) r.lambda = 0;
    for (const b of this.bowdens) b.lambda = 0;
    for (let it = 0; it < PASS_ITERATIONS; it++) {
      for (const r of this.ropes) this.projectRope(r);
      for (const b of this.bowdens) this.projectBowden(b);
    }

    // PBD-style velocity recovery + heavy damping for the pass bodies
    for (const id of this.passBodyIds) {
      if (this.drags.has(id)) continue;
      const body = this.nodeBodies.get(id)!;
      if (body.isFixed()) continue;
      const p0 = pre.get(id)!;
      const t = body.translation();
      body.setLinvel(
        { x: ((t.x - p0.x) / dt) * DAMPING, y: ((t.y - p0.y) / dt) * DAMPING },
        true,
      );
    }
  }

  private effInvMass(body: RAPIER.RigidBody, invMass: number, nodeId?: string): number {
    if (body.isFixed()) return 0;
    if (nodeId !== undefined && this.drags.has(nodeId)) return 0;
    return invMass;
  }

  private projectRope(r: RopePass): void {
    const n = r.bodies.length;
    const pos = r.bodies.map((b) => b.translation());
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
      wg += this.wOf(r, k) * (g.x * g.x + g.y * g.y);
    }
    if (wg === 0) return;
    let dLambda = -C / wg;
    if (r.lambda + dLambda > 0) dLambda = -r.lambda;
    r.lambda += dLambda;
    for (let k = 0; k < n; k++) {
      const w = this.wOf(r, k);
      if (w === 0) continue;
      const b = r.bodies[k]!;
      const t = b.translation();
      const g = grads[k]!;
      b.setTranslation({ x: t.x + w * dLambda * g.x, y: t.y + w * dLambda * g.y }, true);
    }
  }

  private wOf(r: RopePass, k: number): number {
    const body = r.bodies[k]!;
    if (body.isFixed()) return 0;
    for (const [id, b] of this.nodeBodies) {
      if (b === body && this.drags.has(id)) return 0;
    }
    return r.invMasses[k]!;
  }

  private projectBowden(b: BowdenPass): void {
    const [a1, a2, b1, b2] = b.bodies;
    const pairs: Array<[RAPIER.RigidBody, RAPIER.RigidBody, number, number]> = [
      [a1, a2, b.invMasses[0], b.invMasses[1]],
      [b1, b2, b.invMasses[2], b.invMasses[3]],
    ];
    let C = -(b.lenA0 + b.lenB0);
    const units: Vec2[] = [];
    for (const [p, q] of pairs) {
      const tp = p.translation();
      const tq = q.translation();
      const dx = tq.x - tp.x;
      const dy = tq.y - tp.y;
      const len = Math.hypot(dx, dy);
      C += len;
      units.push(len < 1e-12 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len });
    }
    if (C <= 0 && b.lambda === 0) return;
    let wg = 0;
    for (let i = 0; i < 2; i++) {
      const [p, q, wp, wq] = pairs[i]!;
      wg += this.dragAware(p, wp) + this.dragAware(q, wq);
    }
    if (wg === 0) return;
    let dLambda = -C / wg;
    if (b.lambda + dLambda > 0) dLambda = -b.lambda;
    b.lambda += dLambda;
    for (let i = 0; i < 2; i++) {
      const [p, q, wp, wq] = pairs[i]!;
      const u = units[i]!;
      const wpe = this.dragAware(p, wp);
      const wqe = this.dragAware(q, wq);
      if (wpe > 0) {
        const t = p.translation();
        p.setTranslation({ x: t.x - wpe * dLambda * u.x, y: t.y - wpe * dLambda * u.y }, true);
      }
      if (wqe > 0) {
        const t = q.translation();
        q.setTranslation({ x: t.x + wqe * dLambda * u.x, y: t.y + wqe * dLambda * u.y }, true);
      }
    }
  }

  private dragAware(body: RAPIER.RigidBody, invMass: number): number {
    if (body.isFixed()) return 0;
    for (const [id, b] of this.nodeBodies) {
      if (b === body && this.drags.has(id)) return 0;
    }
    return invMass;
  }

  setDragTarget(nodeId: string, pos: Vec2 | null): void {
    if (pos === null) this.drags.delete(nodeId);
    else this.drags.set(nodeId, { ...pos });
  }

  positions(): Record<string, Vec2> {
    const out: Record<string, Vec2> = {};
    for (const [id, body] of this.nodeBodies) {
      const t = body.translation();
      out[id] = { x: t.x, y: t.y };
    }
    return out;
  }

  forces(): Record<string, number> {
    const out: Record<string, number> = {};
    const dt2 = this.lastDt * this.lastDt;
    for (const r of this.ropes) out[r.id] = -r.lambda / dt2;
    for (const b of this.bowdens) out[b.id] = -b.lambda / dt2;
    // rod axial forces / pivot reactions: not exposed by the JS bindings'
    // impulse joints in a usable form — scored in DECISIONS.md
    return out;
  }

  dispose(): void {
    this.world?.free();
    this.world = null;
    this.nodeBodies.clear();
    this.nodeMasses.clear();
    this.ropes = [];
    this.bowdens = [];
    this.drags.clear();
    this.passBodyIds.clear();
  }
}
