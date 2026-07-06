// C2 — winged costume (flap amplifier): structural + behavioral acceptance
// (PLANFILE-fun-costume-samples.md). Behavioral solves follow the clip
// harness pattern (samplePose → bindingTargets → solve → assert geometry) in
// EQUILIBRIUM mode: the wing up-stroke is driven by the spring/elastic
// antagonists — forces — which pure kinematic projection cannot express.
// Convergence calibration (bundledExamples.test.ts post-integration note):
// the rest and jaw solves honestly converge (< 1e-4 m); only the flap
// EXTREMES, where a hand hauls a taut working cord through the whole
// suspended compound, settle at a few 1e-4 m and use the sanctioned
// residual-plus-behavior form.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../bom';
import type { PivotElement, Vec3 } from '../schema';
import { DEFAULT_WEARER, projectSchema, SCHEMA_VERSION } from '../schema';
import { solve } from '../solver';
import {
  anchorTargets,
  bindingTargets,
  getClip,
  type JointPose,
  REST_POSE,
  samplePose,
} from '../wearer';
import {
  buildWingedCostumeProject,
  JAW_OPEN_RAD,
  jawChannelMax,
  openHeelDistanceM,
  WING_DOWN_RAD,
  WING_FLAP_AXIS,
  WING_UP_RAD,
} from './wingedCostume';

const project = buildWingedCostumeProject();
const mech = project.mechanism;

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const nodePos = (id: string): Vec3 => {
  const node = mech.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`missing node ${id}`);
  return node.position;
};

const element = (id: string) => {
  const found = mech.elements.find((e) => e.id === id);
  if (!found) throw new Error(`missing element ${id}`);
  return found;
};

const pivot = (id: string): PivotElement => {
  const el = element(id);
  if (el.type !== 'pivot') throw new Error(`${id} must be a pivot`);
  return el;
};

/** Equilibrium with the wearer holding the rig: hands held at the pose's
 * skeleton points (they grip the flap cords), suspension anchors riding the
 * wearer anchors. */
function solveAt(pose: JointPose, channelValues: Record<string, number>) {
  return solve(
    mech,
    {
      channelValues,
      dragTargets: bindingTargets(mech, DEFAULT_WEARER, pose),
      groundTargets: anchorTargets(mech, DEFAULT_WEARER, pose),
    },
    'equilibrium',
  );
}

describe('C2 winged costume — structure', () => {
  it('validates against projectSchema at the current schema version', () => {
    expect(() => projectSchema.parse(project)).not.toThrow();
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.id).toBe('example-winged-costume');
    expect(project.name).toBe('Example — Storm bird');
  });

  it('uses one flat id namespace and groups cover every element exactly once', () => {
    expect(new Set(mech.nodes.map((n) => n.id)).size).toBe(mech.nodes.length);
    const elementIds = new Set(mech.elements.map((e) => e.id));
    expect(elementIds.size).toBe(mech.elements.length);
    const grouped = project.groups.flatMap((g) => g.elementIds);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(elementIds);
    expect(project.groups.map((g) => g.name)).toEqual([
      'Body frame + suspension',
      'Wing (left)',
      'Wing (right)',
      'Neck + jaw',
      'Tail',
    ]);
  });

  it('every element is engineered and creature language stays out of the data', () => {
    for (const el of mech.elements) expect(el.maturity, el.id).toBe('engineered');
    const blob = JSON.stringify({ ...project, name: '' }).toLowerCase();
    for (const word of ['bird', 'storm', 'raptor']) {
      expect(blob.includes(word), word).toBe(false);
    }
  });

  it('suspends the frame on shoulder bungees + hip-rect straps via anchorBindings', () => {
    expect(mech.anchorBindings.map((b) => b.anchor).sort()).toEqual([
      'hipRectBackL',
      'hipRectBackR',
      'hipRectFrontL',
      'hipRectFrontR',
      'shoulderL',
      'shoulderR',
    ]);
    // every bound node is a grounded anchor drawn at the wearer's rest anchor
    const rest = anchorTargets(mech, DEFAULT_WEARER, REST_POSE);
    for (const b of mech.anchorBindings) {
      const node = mech.nodes.find((n) => n.id === b.nodeId);
      expect(node?.kind, b.id).toBe('anchor');
      expect(
        dist3(node?.position ?? { x: 0, y: 0, z: 0 }, rest[b.nodeId] ?? { x: 9, y: 9, z: 9 }),
        b.id,
      ).toBeLessThan(1e-6);
    }
    // bungee carry: rest = 0.85 × drawn; straps: drawn + 0.01, near-taut
    for (const id of ['carryBungeeLF', 'carryBungeeLB', 'carryBungeeRF', 'carryBungeeRB']) {
      const el = element(id);
      if (el.type !== 'elastic') throw new Error(`${id} must be elastic`);
      expect(el.slackLengthM, id).toBeCloseTo(
        0.85 * dist3(nodePos(el.nodeA), nodePos(el.nodeB)),
        3,
      );
      expect(el.cordageMaterialId).toBe('cord-bungee8');
    }
    for (const id of ['hipStrapFL', 'hipStrapFR', 'hipStrapBL', 'hipStrapBR']) {
      const el = element(id);
      if (el.type !== 'rope') throw new Error(`${id} must be a rope`);
      const drawn = dist3(nodePos(el.path[0]!), nodePos(el.path[1]!));
      expect(el.lengthM, id).toBeCloseTo(drawn + 0.01, 3);
      expect(el.cordageMaterialId).toBe('cord-paracord550');
    }
  });

  it('wings: 4-node spars hinged about +x with mirrored limits and hand-rope drive', () => {
    for (const S of ['L', 'R'] as const) {
      const spar = element(`wingSpar${S}`);
      if (spar.type !== 'bentLink') throw new Error('spar must be a bentLink');
      expect(spar.nodeIds).toHaveLength(4);
      for (const r of spar.filletRadiiM) expect(r).toBeGreaterThan(0);
      // rope attachment ≈ 0.25 m from the root hinge (C2 lever arm)
      const attach = dist3(nodePos(`wingRoot${S}`), nodePos(`wingElbow${S}`));
      expect(Math.abs(attach - 0.25)).toBeLessThan(0.02);
      // tip reaches z ≈ ±1.15, mirrored
      const tip = nodePos(`wingTip${S}`);
      expect(Math.abs(tip.z)).toBeCloseTo(1.14, 2);
      const piv = pivot(`wingRootPivot${S}`);
      expect(piv.joint).toEqual({ kind: 'hinge', axis: WING_FLAP_AXIS });
      // return spring biased to the raised end of the travel window
      expect(piv.torsionSpring).toBeDefined();
      const raisedEnd = S === 'L' ? piv.angleLimit!.minRad : piv.angleLimit!.maxRad;
      expect(piv.torsionSpring!.restAngleRad).toBeCloseTo(raisedEnd, 6);
      // drive rope: spar attach → front-corner eyelet → wearer hand, with the
      // deliberate 2 cm working slack
      const rope = element(`flapRope${S}`);
      if (rope.type !== 'rope') throw new Error('flap rope must be a rope');
      expect(rope.path).toEqual([`wingElbow${S}`, `frameFront${S}`, `wHand${S}`]);
      const drawn =
        dist3(nodePos(rope.path[0]!), nodePos(rope.path[1]!)) +
        dist3(nodePos(rope.path[1]!), nodePos(rope.path[2]!));
      expect(rope.lengthM).toBeCloseTo(drawn + 0.02, 3);
    }
    // limit windows bracket the drawn pose and mirror in sign, spanning the
    // designed up/down stroke
    const left = pivot('wingRootPivotL').angleLimit;
    const right = pivot('wingRootPivotR').angleLimit;
    if (!left || !right) throw new Error('wing root pivots must carry limits');
    expect(left.minRad).toBeLessThan(0);
    expect(left.maxRad).toBeGreaterThan(0);
    expect(left.minRad).toBeCloseTo(-right.maxRad, 6);
    expect(left.maxRad).toBeCloseTo(-right.minRad, 6);
    expect(left.maxRad - left.minRad).toBeCloseTo(WING_UP_RAD + WING_DOWN_RAD, 6);
    // tip masses per C2 (plus skin/rib masses along each spar)
    const tipMasses = mech.pointMasses.filter((m) => m.name === 'wing tip');
    expect(tipMasses.map((m) => m.massKg)).toEqual([0.15, 0.15]);
    // hand nodes bound to the wearer skeleton (the mimicry drive)
    expect(mech.skeletonBindings.map((b) => b.point).sort()).toEqual(['handL', 'handR']);
  });

  it('jaw: `jaw` channel drives a trigger node; bowden sized to the open beak', () => {
    const channel = mech.inputs.find((c) => c.name === 'jaw');
    expect(channel).toBeDefined();
    expect(channel!.min).toBe(0);
    expect(channel!.max).toBeCloseTo(jawChannelMax(), 6);
    const trig = mech.nodes.find((n) => n.id === 'trig');
    expect(trig?.kind).toBe('driven');
    expect(trig?.channelId).toBe(channel!.id);
    const cable = element('biteCable');
    if (cable.type !== 'bowden') throw new Error('biteCable must be a bowden');
    expect(cable.restLengthBM).toBeCloseTo(openHeelDistanceM(), 9);
    // jaw hard stop sits past the cable-defined open angle (rope-as-limit)
    const jaw = pivot('jawPivot');
    expect(jaw.welds).toEqual([
      ['neckBoom', 'beakUpper'],
      ['jawBar', 'jawHeelSpur'],
    ]);
    expect(jaw.angleLimit!.maxRad - jaw.angleLimit!.minRad).toBeCloseTo(JAW_OPEN_RAD + 0.07, 3);
    // trigger control rides beltR and maps its axis onto the global channel
    const trigger = project.controls.find((c) => c.type === 'trigger');
    expect(trigger).toBeDefined();
    expect(trigger!.mount).toEqual({ kind: 'wearerAnchor', anchor: 'beltR' });
    expect(trigger!.axes.map((a) => a.channelName)).toEqual(['jaw']);
    expect(trigger!.axes[0]!.outMax).toBeCloseTo(jawChannelMax(), 6);
  });

  it('BOM: fully resolved, plausible weight, genuinely 3D spar bend schedules', () => {
    const bom = computeBom(project);
    expect(bom.unresolved.count).toBe(0);
    expect(bom.weights.grandTotalKg).toBeGreaterThan(2);
    expect(bom.weights.grandTotalKg).toBeLessThan(20);
    for (const group of project.groups) {
      expect(bom.weights.perGroupKg[group.id]!, group.name).toBeGreaterThan(0);
    }
    for (const id of ['wingSparL', 'wingSparR']) {
      const entry = bom.bendSchedule.find((b) => b.elementId === id);
      expect(entry, id).toBeDefined();
      expect(entry!.vertices).toHaveLength(2);
      for (const v of entry!.vertices) {
        expect(v.angleRad, `${id} deflection`).toBeGreaterThan(0.1);
        expect(v.radiusM).toBeGreaterThan(0);
      }
      // first bend plane is the free reference (0 by convention); the second
      // carries the out-of-plane twist — nonzero ⇒ the spar is truly 3D
      expect(entry!.vertices[0]!.dihedralRad).toBe(0);
      expect(Math.abs(entry!.vertices[1]!.dihedralRad), `${id} dihedral`).toBeGreaterThan(0.05);
    }
  });
});

describe('C2 winged costume — solve', () => {
  it('rest: honest convergence, no compressed ropes, wings raised and mirrored', {
    timeout: 30_000,
  }, () => {
    const rest = solveAt(REST_POSE, {});
    expect(rest.diagnostics.converged).toBe(true);
    expect(rest.diagnostics.ropesRequiringCompression).toHaveLength(0);
    // frame hangs level near the drawn height between bungees and straps
    for (const id of ['frameFrontL', 'frameFrontR', 'frameBackL', 'frameBackR']) {
      expect(Math.abs(rest.positions[id]!.y - 1.25), id).toBeLessThan(0.05);
    }
    // wings sit raised at the spring/gravity balance, tips far outboard and
    // z-mirrored
    const tipL = rest.positions.wingTipL!;
    const tipR = rest.positions.wingTipR!;
    expect(tipL.z).toBeGreaterThan(1.0);
    expect(tipR.z).toBeLessThan(-1.0);
    expect(tipL.y).toBeGreaterThan(1.5);
    expect(tipL.y).toBeLessThan(2.2);
    expect(Math.abs(tipL.y - tipR.y)).toBeLessThan(0.05);
    // beak rests open (the opening elastic wins until the trigger pulls)
    expect(dist3(rest.positions.beakTip!, rest.positions.jawTip!)).toBeGreaterThan(0.1);
    // tail droops onto its torsion spring but stays aloft
    expect(rest.positions.tailTip!.y).toBeLessThan(1.34);
    expect(rest.positions.tailTip!.y).toBeGreaterThan(1.1);
  });

  it('flap mimicry: arm-swing extremes flap each wingtip > 0.6 m, anti-phase, z-mirrored', {
    timeout: 60_000,
  }, () => {
    const clip = getClip('arm swing')!;
    const times = [0, 0.5, 1, 1.5];
    const tipYL: number[] = [];
    const tipYR: number[] = [];
    for (const t of times) {
      const result = solveAt(samplePose(clip, t), {});
      // hand-pulled extremes hold a taut working cord under load: the solve
      // settles at a few 1e-4 m of constraint error, over the 1e-4 converged
      // gate — assert the honest residual + behavior form (calibration note,
      // bundledExamples.test.ts post-integration block)
      expect(result.diagnostics.residual, `t=${t}`).toBeLessThan(1e-3);
      expect(result.diagnostics.ropesRequiringCompression, `t=${t}`).toHaveLength(0);
      const tipL = result.positions.wingTipL!;
      const tipR = result.positions.wingTipR!;
      // wings never cross the sagittal plane: z signs stay mirrored
      expect(tipL.z, `t=${t}`).toBeGreaterThan(0.15);
      expect(tipR.z, `t=${t}`).toBeLessThan(-0.15);
      tipYL.push(tipL.y);
      tipYR.push(tipR.y);
    }
    // each wingtip sweeps a > 0.6 m vertical range across the clip
    expect(Math.max(...tipYL) - Math.min(...tipYL)).toBeGreaterThan(0.6);
    expect(Math.max(...tipYR) - Math.min(...tipYR)).toBeGreaterThan(0.6);
    // anti-phase clip (shoulderL/R opposite) ⇒ anti-phase wings, symmetric
    // build: left at t=0 (hand forward, cord slack, wing up) mirrors right
    // at t=1 and vice versa
    expect(tipYL[0]!).toBeGreaterThan(tipYL[2]! + 0.5);
    expect(tipYR[2]!).toBeGreaterThan(tipYR[0]! + 0.5);
    expect(Math.abs(tipYL[0]! - tipYR[2]!)).toBeLessThan(0.1);
    expect(Math.abs(tipYL[2]! - tipYR[0]!)).toBeLessThan(0.1);
  });

  it('jaw channel sweep closes the beak gap monotonically', { timeout: 60_000 }, () => {
    const max = jawChannelMax();
    const gaps: number[] = [];
    for (const f of [0, 1 / 3, 2 / 3, 1]) {
      const result = solveAt(REST_POSE, { jaw: f * max });
      expect(result.diagnostics.converged, `jaw=${f * max}`).toBe(true);
      gaps.push(dist3(result.positions.beakTip!, result.positions.jawTip!));
    }
    expect(gaps[0]!).toBeGreaterThan(0.12);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]!, `step ${i}`).toBeLessThan(gaps[i - 1]! - 0.015);
    }
    expect(gaps[gaps.length - 1]!).toBeLessThan(0.07);
  });
});
