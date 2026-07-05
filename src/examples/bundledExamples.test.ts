// Bundled-example acceptance (§9 items 2–7): every artifact validates,
// matches its authoritative builder, and each mechanism demonstrably DOES
// the thing its planfile entry says it demonstrates, via solve().
//
// Mode notes: rope/elastic/bowden coupling acts in equilibrium mode only
// (kinematic leaves force elements inert by design), so channel-driven
// behaviors are asserted in equilibrium; gait-following uses kinematic with
// binding targets, exactly like clip playback.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../bom';
import { DEFAULT_WEARER } from '../schema';
import { solve } from '../solver';
import { bindingTargets, getClip, samplePose } from '../wearer';
import { ARTIFACT_BUILDERS, EXAMPLES, loadExample } from '.';
import { buildJawBowdenMechanism, JAW_PIVOT_Y } from './jawBowden';
import { buildLegExoMechanism } from './legExo';
import { buildNeckTrussMechanism } from './neckTruss';
import { buildSteerMirrorMechanism } from './steerMirror';
import { buildTailMechanism } from './tailBoom';

const FILE_BY_ID: Record<string, string> = {
  'example-seesaw-spine': 'seesaw-spine.json',
  'example-neck-truss': 'neck-truss.json',
  'example-steer-mirror': 'steer-mirror.json',
  'example-jaw-bowden': 'jaw-bowden.json',
  'example-leg-exoskeleton': 'leg-exoskeleton.json',
  'example-tail': 'tail.json',
  'example-full-creature': 'full-creature.json',
};

describe('bundled example registry (§9)', () => {
  it('ships all seven examples, each JSON valid and matching its builder', () => {
    expect(EXAMPLES).toHaveLength(7);
    for (const example of EXAMPLES) {
      const project = example.load();
      const builder = ARTIFACT_BUILDERS[FILE_BY_ID[example.id]!]!;
      expect(project, example.id).toEqual(builder());
    }
  });

  it('keeps creature language out of every identifier and mechanism string', () => {
    for (const example of EXAMPLES) {
      const project = example.load();
      // the full-creature PROJECT NAME is the one allowed appearance (§9:
      // raptor exists only in bundled example data)
      const blob = JSON.stringify({ ...project, name: '' }).toLowerCase();
      expect(blob.includes('raptor'), example.id).toBe(false);
    }
  });

  it('loadExample returns fresh copies (no shared mutable singleton)', () => {
    const a = loadExample('example-tail')!;
    const b = loadExample('example-tail')!;
    expect(a).not.toBe(b);
    a.name = 'mutated';
    expect(b.name).not.toBe('mutated');
  });
});

describe('example 2 — neck truss (pitch)', () => {
  const mech = buildNeckTrussMechanism();
  const solveAt = (steerPitch: number) =>
    solve(mech, { channelValues: { 'steer pitch': steerPitch } }, 'equilibrium');

  it('settles neck-up at rest, held between the up/down rope pair', () => {
    const rest = solveAt(0);
    expect(rest.diagnostics.converged).toBe(true);
    expect(rest.diagnostics.ropesRequiringCompression).toHaveLength(0);
    expect(rest.positions.head!.y).toBeGreaterThan(1.6);
    expect(rest.positions.head!.y).toBeLessThan(1.8);
  });

  it('sliding the steer grip down pitches the head down, monotonically', () => {
    const rest = solveAt(0);
    const half = solveAt(-0.015);
    const full = solveAt(-0.03);
    expect(full.diagnostics.converged).toBe(true);
    expect(half.positions.head!.y).toBeLessThan(rest.positions.head!.y - 0.03);
    expect(full.positions.head!.y).toBeLessThan(half.positions.head!.y - 0.03);
  });
});

describe('example 3 — steer mirror (plan, crossed ropes)', () => {
  const mech = buildSteerMirrorMechanism();
  const solveAt = (steerPan: number) =>
    solve(mech, { channelValues: { 'steer pan': steerPan } }, 'equilibrium');

  it('panning the steer turns the head tip to the SAME side (the crossing)', () => {
    for (const pan of [0.3, -0.3]) {
      const result = solveAt(pan);
      expect(result.diagnostics.converged).toBe(true);
      const sY = result.positions.sTip!.y;
      const hY = result.positions.hTip!.y;
      expect(Math.abs(sY)).toBeGreaterThan(0.05);
      expect(Math.sign(hY)).toBe(Math.sign(sY));
      expect(hY).toBeCloseTo(sY, 1.5);
    }
  });

  it('the rope-coupled pair is a single-DOF mechanism', () => {
    expect(solveAt(0).diagnostics.classification).toBe('mechanism');
  });
});

describe('example 4 — jaw + Bowden', () => {
  const mech = buildJawBowdenMechanism();
  const solveAt = (trigger: number) =>
    solve(mech, { channelValues: { 'jaw trigger': trigger } }, 'equilibrium');

  it('rests open: the opening elastic swings the jaw tip down to the limit', () => {
    const open = solveAt(0);
    expect(open.diagnostics.converged).toBe(true);
    expect(open.positions.jawTip!.y).toBeLessThan(JAW_PIVOT_Y - 0.1);
  });

  it('squeezing the trigger closes the jaw through the cable', () => {
    const half = solveAt(0.02);
    const closed = solveAt(0.038);
    expect(closed.diagnostics.converged).toBe(true);
    expect(half.positions.jawTip!.y).toBeGreaterThan(JAW_PIVOT_Y - 0.1);
    expect(half.positions.jawTip!.y).toBeLessThan(JAW_PIVOT_Y - 0.05);
    expect(closed.positions.jawTip!.y).toBeGreaterThan(JAW_PIVOT_Y - 0.02);
  });

  it('locking the trigger channel freezes the jaw (set-screw analogue)', () => {
    const locked = structuredClone(mech);
    locked.inputs[0]!.value = 0.038;
    locked.inputs[0]!.locked = true;
    // an override that would open the jaw is ignored while locked
    const result = solve(locked, { channelValues: { 'jaw trigger': 0 } }, 'equilibrium');
    expect(result.positions.jawTip!.y).toBeGreaterThan(JAW_PIVOT_Y - 0.02);
  });
});

describe('example 5 — leg exoskeleton (driven by gait)', () => {
  it('follows the wearer through a full walk cycle', () => {
    const mech = buildLegExoMechanism('left');
    const walk = getClip('walk')!;

    let maxKneeX = Number.NEGATIVE_INFINITY;
    let minKneeX = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 12; i++) {
      const pose = samplePose(walk, (i / 12) * walk.durationS);
      const targets = bindingTargets(mech, DEFAULT_WEARER, pose);
      const result = solve(mech, { channelValues: {}, dragTargets: targets }, 'kinematic');
      const p = result.positions;
      // rigid femur holds while the leg is gait-driven
      const femur = Math.hypot(p.eKnee!.x - p.frameHip!.x, p.eKnee!.y - p.frameHip!.y);
      expect(femur).toBeCloseTo(0.4808, 2);
      // toe stays within its stops (rope limit backed by the pivot stop)
      const toe = Math.hypot(p.eToe!.x - p.eToePad!.x, p.eToe!.y - p.eToePad!.y);
      expect(toe).toBeLessThan(0.155);
      maxKneeX = Math.max(maxKneeX, p.eKnee!.x);
      minKneeX = Math.min(minKneeX, p.eKnee!.x);
    }
    // the external knee visibly strides back and forth over the cycle
    expect(maxKneeX - minKneeX).toBeGreaterThan(0.1);
  });

  it('mirrors bindings for the right side', () => {
    const right = buildLegExoMechanism('right');
    expect(right.viewOrientation).toBe('side-right');
    expect(right.skeletonBindings.map((b) => b.point)).toEqual(['hipR', 'kneeR', 'shoeR']);
  });
});

describe('example 6 — tail', () => {
  const mech = buildTailMechanism();

  it('hangs on the hold rope and sags at the compliant joints under the tip mass', () => {
    const rest = solve(mech, { channelValues: {} }, 'equilibrium');
    expect(rest.diagnostics.converged).toBe(true);
    expect(rest.diagnostics.ropesRequiringCompression).toHaveLength(0);
    const tip = rest.positions.tailTip!;
    expect(tip.y).toBeLessThan(1.13); // sags below the drawn pose…
    expect(tip.y).toBeGreaterThan(0.75); // …but the springs carry it
  });

  it('a heavier tip sags further', () => {
    const heavy = structuredClone(mech);
    heavy.pointMasses[0]!.massKg = 1.5;
    const light = solve(mech, { channelValues: {} }, 'equilibrium');
    const sagged = solve(heavy, { channelValues: {} }, 'equilibrium');
    expect(sagged.positions.tailTip!.y).toBeLessThan(light.positions.tailTip!.y - 0.01);
  });
});

describe('example 7 — full creature (§9 item 7)', () => {
  const project = loadExample('example-full-creature')!;

  it('bundles all eight mechanisms with 3D instances and body masses', () => {
    expect(project.mechanisms.map((m) => m.id)).toEqual([
      'seesaw-spine',
      'neck-truss',
      'steer-mirror',
      'jaw-bowden',
      'leg-exo-left',
      'leg-exo-right',
      'tail-boom',
      'arms',
    ]);
    // Phase 4: every mechanism is placed as a 3D assembly instance
    expect(project.assembly.instances.map((i) => i.mechanismId).sort()).toEqual(
      project.mechanisms.map((m) => m.id).sort(),
    );
    expect(project.assembly.pointMasses.map((m) => m.name).sort()).toEqual([
      'battery pack',
      'head + foam',
      'speaker',
      'tail counterweight',
    ]);
  });

  it('ships the §4.4 yoke control + head-sweep control clip mapped to its channels', () => {
    const yoke = project.controls.find((c) => c.type === 'yoke');
    expect(yoke).toBeDefined();
    expect(yoke!.mount).toEqual({ kind: 'wearerAnchor', anchor: 'handR' });
    expect(yoke!.axes.map((a) => a.channelName).sort()).toEqual([
      'jaw trigger',
      'steer pan',
      'steer pitch',
    ]);
    const clip = project.controlClips.find((c) => c.name === 'head sweep + jaw snap');
    expect(clip).toBeDefined();
    expect(Object.keys(clip!.tracks).sort()).toEqual(['jaw trigger', 'steer pan']);
  });

  it('has working sliders: every input channel drives a driven node', () => {
    const channels = project.mechanisms.flatMap((m) => m.inputs.map((c) => c.name));
    expect(channels.sort()).toEqual(['jaw trigger', 'steer pan', 'steer pitch']);
    for (const mech of project.mechanisms) {
      for (const input of mech.inputs) {
        expect(
          mech.nodes.some((n) => n.kind === 'driven' && n.channelId === input.id),
          `${mech.id}/${input.name}`,
        ).toBe(true);
      }
    }
  });

  it('populates a fully resolved global BOM with a plausible creature weight', () => {
    const bom = computeBom(project.mechanisms, project.materials, project.bomSettings);
    expect(bom.unresolved.count).toBe(0);
    // a wearable PVC creature: heavier than a prop, lighter than a person
    expect(bom.weights.grandTotalKg).toBeGreaterThan(3);
    expect(bom.weights.grandTotalKg).toBeLessThan(30);
    const pipeLength = bom.cutList
      .filter((p) => p.kind === 'pipe')
      .reduce((sum, p) => sum + p.lengthM * p.quantity, 0);
    expect(pipeLength).toBeGreaterThan(8); // meters of pipe across the build
  });

  it('every NEW mechanism solves cleanly at its default channel values', () => {
    // seesaw-spine is exercised by its own §11 acceptance suite; the XPBD
    // residual it settles to under gravity predates this example set
    for (const mech of project.mechanisms.filter((m) => m.id !== 'seesaw-spine')) {
      const mode = mech.gravityOn ? 'equilibrium' : 'kinematic';
      const result = solve(mech, { channelValues: {} }, mode);
      expect(result.diagnostics.violated, mech.id).toHaveLength(0);
      expect(result.diagnostics.residual, mech.id).toBeLessThan(1e-3);
    }
  });
});
