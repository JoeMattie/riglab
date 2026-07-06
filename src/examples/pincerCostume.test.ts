// C3 — pincer costume (PLANFILE-fun-costume-samples.md): structural asserts
// (suspension bindings, hinge axes, id namespace, drawn-geometry-derived rest
// lengths) plus behavioral solve acceptance — rest equilibrium, independent
// grip channels, boom mimicry off the arm-swing clip, and the eye-stalk
// bobble. Calibration per bundledExamples.test.ts: this costume hangs a
// dozen tension-only members (straps, marionette ropes, droop limits) at
// their active boundaries, so the settle creeps at its floor (~1.4e-4 m)
// and honestly reports converged:false — the tests therefore assert
// residual < 1e-3 PLUS the behavior (pose, gaps, link-length honesty, no
// rope compression), the full-creature form, never residual alone.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../bom';
import type { PivotElement, Vec3 } from '../schema';
import { DEFAULT_WEARER, projectSchema } from '../schema';
import { type SolveResult, solve } from '../solver';
import { bindingTargets, computeSkeleton, getClip, REST_POSE, samplePose } from '../wearer';
import { buildPincerCostumeProject, GRIP_TRAVEL } from './pincerCostume';

const project = buildPincerCostumeProject();
const mech = project.mechanism;

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const nodePos = (id: string): Vec3 => {
  const node = mech.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`missing node ${id}`);
  return node.position;
};

const pivot = (id: string): PivotElement => {
  const found = mech.elements.find((e): e is PivotElement => e.type === 'pivot' && e.id === id);
  if (!found) throw new Error(`missing pivot ${id}`);
  return found;
};

const element = (id: string) => {
  const found = mech.elements.find((e) => e.id === id);
  if (!found) throw new Error(`missing element ${id}`);
  return found;
};

// ── shared solves (each equilibrium settle is expensive; reuse results) ────
const wornTargets = bindingTargets(mech, DEFAULT_WEARER, REST_POSE);
const solveWorn = (channelValues: Record<string, number>): SolveResult =>
  solve(mech, { channelValues, dragTargets: wornTargets }, 'equilibrium');
let restCache: SolveResult | undefined;
const restSolve = (): SolveResult => {
  restCache ??= solveWorn({});
  return restCache;
};

const gapOf = (r: SolveResult, side: 'L' | 'R'): number =>
  dist3(r.positions[`movTip${side}`]!, r.positions[`fixTip${side}`]!);

describe('C3 pincer costume — structure', () => {
  it('validates against projectSchema (snap snap clip passes the loop/duration refinements)', () => {
    expect(() => projectSchema.parse(project)).not.toThrow();
    const clip = project.controlClips.find((c) => c.name === 'snap snap');
    expect(clip).toBeDefined();
    expect(clip!.durationS).toBe(4);
    expect(clip!.loop).toBe(true);
    expect(Object.keys(clip!.tracks).sort()).toEqual(['grip left', 'grip right']);
  });

  it('uses one flat id namespace; groups cover every element exactly once', () => {
    expect(new Set(mech.nodes.map((n) => n.id)).size).toBe(mech.nodes.length);
    expect(new Set(mech.elements.map((e) => e.id)).size).toBe(mech.elements.length);
    expect(new Set(mech.inputs.map((c) => c.name)).size).toBe(mech.inputs.length);
    const grouped = project.groups.flatMap((g) => g.elementIds);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(mech.elements.map((e) => e.id)));
    expect(project.groups.map((g) => g.name)).toEqual([
      'Shell + suspension',
      'Claw (left)',
      'Claw (right)',
      'Eye stalks',
    ]);
  });

  it('hangs on the wearer: shoulder + hip-rect anchorBindings at the true anchor points', () => {
    const frame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    const byAnchor = new Map(mech.anchorBindings.map((b) => [b.anchor, b.nodeId]));
    expect([...byAnchor.keys()].sort()).toEqual([
      'hipRectBackL',
      'hipRectBackR',
      'hipRectFrontL',
      'hipRectFrontR',
      'shoulderL',
      'shoulderR',
    ]);
    for (const [anchor, nodeId] of byAnchor) {
      const node = mech.nodes.find((n) => n.id === nodeId)!;
      expect(node.kind, nodeId).toBe('anchor');
      expect(dist3(node.position, frame.anchors[anchor]), nodeId).toBeLessThan(1e-6);
    }
    // bungee carry (rest = 0.9 × drawn) + near-taut straps (drawn + 0.01)
    for (const id of [
      'suspBungeeFrontL',
      'suspBungeeBackL',
      'suspBungeeFrontR',
      'suspBungeeBackR',
    ]) {
      const el = element(id);
      if (el.type !== 'elastic') throw new Error(`${id} must be an elastic`);
      expect(el.slackLengthM, id).toBeCloseTo(0.9 * dist3(nodePos(el.nodeA), nodePos(el.nodeB)), 3);
    }
    for (const id of ['suspStrapFrontL', 'suspStrapBackL', 'suspStrapFrontR', 'suspStrapBackR']) {
      const el = element(id);
      if (el.type !== 'rope') throw new Error(`${id} must be a rope`);
      expect(el.lengthM, id).toBeCloseTo(
        dist3(nodePos(el.path[0]!), nodePos(el.path[1]!)) + 0.01,
        3,
      );
    }
  });

  it('mounts both claw booms on +z root hinges with the lift post welded to the hoop', () => {
    for (const s of ['L', 'R'] as const) {
      const root = pivot(`boomRootPivot${s}`);
      expect(root.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
      expect(root.nodeId).toBe(`hoopFront${s}`);
      expect(root.welds).toEqual([['shellHoop', `liftPost${s}`]]);
      expect(root.angleLimit!.maxRad - root.angleLimit!.minRad).toBeCloseTo(1.45, 3);
      const claw = pivot(`clawPivot${s}`);
      expect(claw.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
      expect(claw.welds).toContainEqual([`boom${s}`, `fixedJaw${s}`]);
      expect(claw.welds).toContainEqual([`movJaw${s}`, `heelSpur${s}`]);
    }
    // hand ropes and marionette rig: rest lengths derive from drawn geometry
    for (const s of ['L', 'R'] as const) {
      const rope = element(`boomTieRope${s}`);
      if (rope.type !== 'rope') throw new Error('boom tie must be a rope');
      expect(rope.path).toEqual([`boomKnee${s}`, `eyeMast${s}`, `wHand${s}`]);
      const drawn =
        dist3(nodePos(`boomKnee${s}`), nodePos(`eyeMast${s}`)) +
        dist3(nodePos(`eyeMast${s}`), nodePos(`wHand${s}`));
      expect(rope.lengthM).toBeCloseTo(drawn + 0.02, 3);
    }
    // the wearer's hands drive the booms: bindings sit at the true rest hands
    const frame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    const points = new Map(mech.skeletonBindings.map((b) => [b.point, b.nodeId]));
    expect([...points.keys()].sort()).toEqual(['handL', 'handR']);
    expect(dist3(nodePos(points.get('handL')!), frame.points.handL)).toBeLessThan(1e-6);
    expect(dist3(nodePos(points.get('handR')!), frame.points.handR)).toBeLessThan(1e-6);
  });

  it('wires each grip: Bowden rests from drawn geometry, channel + hand-mounted trigger control', () => {
    for (const [s, name, anchor] of [
      ['L', 'grip left', 'handL'],
      ['R', 'grip right', 'handR'],
    ] as const) {
      const cable = element(`gripCable${s}`);
      if (cable.type !== 'bowden') throw new Error('grip cable must be a bowden');
      expect(cable.restLengthAM).toBeCloseTo(
        dist3(nodePos(`casingTrigger${s}`), nodePos(`trigger${s}`)),
        4,
      );
      expect(cable.restLengthBM).toBeCloseTo(
        dist3(nodePos(`casingClaw${s}`), nodePos(`movHeel${s}`)),
        4,
      );
      const channel = mech.inputs.find((c) => c.name === name)!;
      expect(channel.kind).toBe('displacement');
      expect(channel.max).toBe(GRIP_TRAVEL);
      const trigger = mech.nodes.find((n) => n.id === `trigger${s}`)!;
      expect(trigger.kind).toBe('driven');
      expect(trigger.channelId).toBe(channel.id);
      const control = project.controls.find((c) => c.axes[0]?.channelName === name)!;
      expect(control.type).toBe('trigger');
      expect(control.mount).toEqual({ kind: 'wearerAnchor', anchor });
      expect(control.axes[0]!.outMax).toBe(GRIP_TRAVEL);
    }
  });

  it('mirrors left/right geometry across z = 0 and keeps eye-stalk nests neutral at drawn', () => {
    for (const node of mech.nodes) {
      if (!node.id.endsWith('L')) continue;
      const twin = mech.nodes.find((n) => n.id === `${node.id.slice(0, -1)}R`);
      expect(twin, node.id).toBeDefined();
      expect(twin!.position.x, node.id).toBe(node.position.x);
      expect(twin!.position.y, node.id).toBe(node.position.y);
      expect(twin!.position.z, node.id).toBeCloseTo(-node.position.z, 9);
    }
    for (const s of ['L', 'R'] as const) {
      expect(pivot(`stalkBase${s}`).joint).toEqual({ kind: 'spherical' });
      for (const suffix of ['Front', 'Cross', 'Mast']) {
        const el = element(`nestElastic${suffix}${s}`);
        if (el.type !== 'elastic') throw new Error('nest must be elastic');
        expect(el.slackLengthM, el.id).toBeCloseTo(dist3(nodePos(el.nodeA), nodePos(el.nodeB)), 4);
      }
    }
    // every hinge axis is a unit vector
    for (const el of mech.elements) {
      if (el.type === 'pivot' && el.joint.kind === 'hinge') {
        const { x, y, z } = el.joint.axis;
        expect(Math.hypot(x, y, z), el.id).toBeCloseTo(1, 9);
      }
    }
  });

  it('resolves the whole BOM at a plausible costume weight', () => {
    const bom = computeBom(project);
    expect(bom.unresolved.count).toBe(0);
    expect(bom.weights.grandTotalKg).toBeGreaterThan(2);
    expect(bom.weights.grandTotalKg).toBeLessThan(20);
    expect(bom.techniqueSummary.bends).toBeGreaterThan(0); // hoop + boom bends
    for (const group of project.groups) {
      expect(bom.weights.perGroupKg[group.id]!, group.name).toBeGreaterThan(0);
    }
  });
});

describe('C3 pincer costume — solve acceptance', () => {
  it('rest (worn): settles honestly, no rope compression, shell and claws at working pose', {
    timeout: 30_000,
  }, () => {
    const rest = restSolve();
    expect(rest.diagnostics.residual).toBeLessThan(1e-3);
    expect(rest.diagnostics.ropesRequiringCompression).toHaveLength(0);
    // the pose is rigid-true: every link keeps its drawn length within 2 mm
    for (const el of mech.elements) {
      if (el.type !== 'link') continue;
      const drawn = dist3(nodePos(el.nodeA), nodePos(el.nodeB));
      const now = dist3(rest.positions[el.nodeA]!, rest.positions[el.nodeB]!);
      expect(Math.abs(now - drawn), el.id).toBeLessThan(2e-3);
    }
    // shell rides near its drawn height on the bungee/strap suspension
    expect(Math.abs(rest.positions.hoopFrontL!.y - 1.2)).toBeLessThan(0.06);
    expect(Math.abs(rest.positions.hoopFrontR!.y - 1.2)).toBeLessThan(0.06);
    // booms hang on their hand ropes just below drawn, out at z ≈ ±0.55
    for (const s of ['L', 'R'] as const) {
      const base = rest.positions[`clawBase${s}`]!;
      expect(base.y, s).toBeGreaterThan(0.95);
      expect(base.y, s).toBeLessThan(1.2);
      expect(Math.abs(Math.abs(base.z) - 0.55), s).toBeLessThan(0.06);
    }
    // eye stalks ride the (slightly settled) shell at their drawn attitude
    for (const s of ['L', 'R'] as const) {
      expect(dist3(rest.positions[`eyeTip${s}`]!, nodePos(`eyeTip${s}`)), s).toBeLessThan(0.08);
    }
  });

  it('each grip channel closes ITS claw only, monotonically', { timeout: 60_000 }, () => {
    const rest = restSolve();
    const restGapL = gapOf(rest, 'L');
    const restGapR = gapOf(rest, 'R');
    // drawn fully open ≈ 0.15 m between jaw tips
    expect(restGapL).toBeCloseTo(dist3(nodePos('movTipL'), nodePos('fixTipL')), 2);

    const half = solveWorn({ 'grip left': GRIP_TRAVEL / 2 });
    const left = solveWorn({ 'grip left': GRIP_TRAVEL });
    expect(left.diagnostics.residual).toBeLessThan(1e-3);
    // full squeeze closes the left gap by > 8 cm; half squeeze lands between
    expect(restGapL - gapOf(left, 'L')).toBeGreaterThan(0.08);
    expect(gapOf(half, 'L')).toBeLessThan(restGapL - 0.02);
    expect(gapOf(half, 'L')).toBeGreaterThan(gapOf(left, 'L') + 0.02);
    // ... and leaves the right claw alone
    expect(Math.abs(gapOf(left, 'R') - restGapR)).toBeLessThan(0.01);

    const right = solveWorn({ 'grip right': GRIP_TRAVEL });
    expect(right.diagnostics.residual).toBeLessThan(1e-3);
    expect(restGapR - gapOf(right, 'R')).toBeGreaterThan(0.08);
    expect(Math.abs(gapOf(right, 'L') - restGapL)).toBeLessThan(0.01);
  });

  it('arm swing pitches each boom tip by > 0.15 m, opposite phases, links honest', {
    timeout: 60_000,
  }, () => {
    const clip = getClip('arm swing')!;
    const at = (t: number) =>
      solve(
        mech,
        {
          channelValues: {},
          dragTargets: bindingTargets(mech, DEFAULT_WEARER, samplePose(clip, t)),
        },
        'equilibrium',
      );
    // t = 0: left hand swung forward (rope slack, left claw drops), right hand
    // back (rope taut, right claw raised); t = 1 mirrors both
    const fwd = at(0);
    const back = at(1);
    const dyL = back.positions.clawBaseL!.y - fwd.positions.clawBaseL!.y;
    const dyR = back.positions.clawBaseR!.y - fwd.positions.clawBaseR!.y;
    expect(dyL).toBeGreaterThan(0.15);
    expect(dyR).toBeLessThan(-0.15);
    // the pitch is a rigid rotation, not solver stretch: boom chord holds
    const drawnChordL = dist3(nodePos('hoopFrontL'), nodePos('clawBaseL'));
    for (const result of [fwd, back]) {
      expect(
        Math.abs(dist3(result.positions.hoopFrontL!, result.positions.clawBaseL!) - drawnChordL),
      ).toBeLessThan(2e-3);
      expect(result.diagnostics.residual).toBeLessThan(1e-3);
      expect(result.diagnostics.ropesRequiringCompression).toHaveLength(0);
    }
  });

  it('eye stalks restore after a 0.1 m sideways shove (sprung spherical bobble)', {
    timeout: 30_000,
  }, () => {
    const rest = restSolve();
    const displaced = structuredClone(mech);
    displaced.nodes.find((n) => n.id === 'eyeTipL')!.position.z += 0.1;
    const shoved = solve(displaced, { channelValues: {}, dragTargets: wornTargets }, 'equilibrium');
    // the nest pulls the tip back to within 4 cm of the rest pose laterally
    expect(Math.abs(shoved.positions.eyeTipL!.z - rest.positions.eyeTipL!.z)).toBeLessThan(0.04);
    // the shove was real: the displaced document starts 0.1 m off the rest z
    expect(
      Math.abs(displaced.nodes.find((n) => n.id === 'eyeTipL')!.position.z - nodePos('eyeTipL').z),
    ).toBeCloseTo(0.1, 9);
  });
});
