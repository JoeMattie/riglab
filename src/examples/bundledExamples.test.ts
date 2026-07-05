// Bundled-example acceptance (§9 items 2–7, rebuilt for the v7 fully-3D
// compound documents): every artifact validates, matches its authoritative
// builder, and carries the 3D geometry its planfile entry promises — world
// frame +y up / +x wearer-front / +z wearer-left, hinge joints on the
// correct plane normals, one namespace of ids across the whole document.
//
// Behavioral (solve-based) assertions live in the trailing
// `describe('post-integration …')` block, enabled now that the 3D solver has
// landed; its header documents the converged-vs-residual calibration.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../bom';
import type { MechanismElement, PivotElement, Project, Vec3 } from '../schema';
import { projectSchema } from '../schema';
import { ARTIFACT_BUILDERS, EXAMPLES, loadExample } from '.';
import { JAW_PIVOT_Y, openHeelDistance } from './jawBowden';
import { STEER_PLANE_Y } from './steerMirror';

const FILE_BY_ID: Record<string, string> = {
  'example-seesaw-spine': 'seesaw-spine.json',
  'example-neck-truss': 'neck-truss.json',
  'example-steer-mirror': 'steer-mirror.json',
  'example-jaw-bowden': 'jaw-bowden.json',
  'example-leg-exoskeleton': 'leg-exoskeleton.json',
  'example-tail': 'tail.json',
  'example-full-creature': 'full-creature.json',
  // complete-costume samples C1–C5 (PLANFILE-fun-costume-samples.md);
  // per-costume structural + solve acceptance lives in each costume's own
  // test file (toweringFigure.test.ts, …)
  'example-towering-figure': 'towering-figure.json',
  'example-winged-costume': 'winged-costume.json',
  'example-pincer-costume': 'pincer-costume.json',
  'example-serpent-costume': 'serpent-costume.json',
  'example-tall-quadruped': 'tall-quadruped.json',
};

const pivotsOf = (p: Project): PivotElement[] =>
  p.mechanism.elements.filter((e): e is PivotElement => e.type === 'pivot');

const pivot = (p: Project, id: string): PivotElement => {
  const found = pivotsOf(p).find((e) => e.id === id);
  if (!found) throw new Error(`missing pivot ${id}`);
  return found;
};

const nodePos = (p: Project, id: string): Vec3 => {
  const node = p.mechanism.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`missing node ${id}`);
  return node.position;
};

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** node ids an element references */
function nodeRefsOf(el: MechanismElement): string[] {
  switch (el.type) {
    case 'link':
    case 'telescope':
    case 'elastic':
      return [el.nodeA, el.nodeB];
    case 'bentLink':
      return el.nodeIds;
    case 'pivot':
    case 'slider':
      return [el.nodeId];
    case 'rope':
      return el.path;
    case 'bowden':
      return [el.a1, el.a2, el.b1, el.b2];
    case 'torsionCable':
      return [];
  }
}

/** element ids an element references */
function elementRefsOf(el: MechanismElement): string[] {
  switch (el.type) {
    case 'pivot': {
      const limit = el.angleLimit ? [el.angleLimit.memberA, el.angleLimit.memberB] : [];
      const spring = el.torsionSpring ? [el.torsionSpring.memberA, el.torsionSpring.memberB] : [];
      return [...el.memberIds, ...el.welds.flat(), ...limit, ...spring];
    }
    case 'slider':
      return [el.alongElementId];
    case 'torsionCable':
      return [el.pivotA, el.pivotB];
    default:
      return [];
  }
}

describe('bundled example registry (§9)', () => {
  it('ships all twelve examples, each JSON valid and matching its builder', () => {
    expect(EXAMPLES).toHaveLength(12);
    for (const example of EXAMPLES) {
      const project = example.load();
      const builder = ARTIFACT_BUILDERS[FILE_BY_ID[example.id]!]!;
      expect(project, example.id).toEqual(builder());
    }
  });

  it('every builder output validates against projectSchema directly', () => {
    for (const [file, builder] of Object.entries(ARTIFACT_BUILDERS)) {
      expect(() => projectSchema.parse(builder()), file).not.toThrow();
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

describe('v7 compound-document integrity (every example)', () => {
  for (const example of EXAMPLES) {
    describe(example.id, () => {
      const project = example.load();
      const mech = project.mechanism;
      const nodeIds = new Set(mech.nodes.map((n) => n.id));
      const elementIds = new Set(mech.elements.map((e) => e.id));

      it('uses one flat id namespace without collisions', () => {
        expect(nodeIds.size).toBe(mech.nodes.length);
        expect(elementIds.size).toBe(mech.elements.length);
        expect(new Set(mech.inputs.map((c) => c.id)).size).toBe(mech.inputs.length);
        expect(new Set(mech.inputs.map((c) => c.name)).size).toBe(mech.inputs.length);
      });

      it('every element reference resolves', () => {
        for (const el of mech.elements) {
          for (const ref of nodeRefsOf(el)) expect(nodeIds.has(ref), `${el.id}→${ref}`).toBe(true);
          for (const ref of elementRefsOf(el))
            expect(elementIds.has(ref), `${el.id}→${ref}`).toBe(true);
        }
      });

      it('every pivot carries a v7 joint; hinge axes are unit vectors', () => {
        for (const piv of pivotsOf(project)) {
          if (piv.joint.kind === 'hinge') {
            const { x, y, z } = piv.joint.axis;
            expect(Math.hypot(x, y, z), piv.id).toBeCloseTo(1, 9);
          } else {
            // spherical joints carry neither limits nor springs (v1 parity)
            expect(piv.angleLimit, piv.id).toBeUndefined();
            expect(piv.torsionSpring, piv.id).toBeUndefined();
          }
        }
      });

      it('groups cover every element exactly once and resolve', () => {
        const grouped = project.groups.flatMap((g) => g.elementIds);
        expect(new Set(grouped).size).toBe(grouped.length); // no double-membership
        expect(new Set(grouped)).toEqual(elementIds); // full cover
      });

      it('channels and driven nodes pair up', () => {
        const channelIds = new Set(mech.inputs.map((c) => c.id));
        for (const node of mech.nodes) {
          if (node.kind === 'driven') {
            expect(node.channelId && channelIds.has(node.channelId), node.id).toBe(true);
          }
        }
        for (const input of mech.inputs) {
          expect(
            mech.nodes.some((n) => n.kind === 'driven' && n.channelId === input.id),
            input.name,
          ).toBe(true);
        }
      });

      it('project point masses attach to real nodes or wearer anchors', () => {
        for (const mass of project.pointMasses) {
          if (mass.attach.kind === 'node') {
            expect(nodeIds.has(mass.attach.nodeId), mass.id).toBe(true);
          }
        }
        for (const mass of mech.pointMasses) {
          expect(nodeIds.has(mass.nodeId), mass.id).toBe(true);
        }
      });
    });
  }
});

describe('example 2 — neck truss (pitch), lifted into the sagittal plane', () => {
  const project = loadExample('example-neck-truss')!;

  it('lives in the world x-y plane (z = 0) with gravity along −y', () => {
    for (const node of project.mechanism.nodes) expect(node.position.z, node.id).toBe(0);
  });

  it('models the conduit lashing as a sagittal-normal hinge with ±0.35 compliance', () => {
    const box = pivot(project, 'boxPivot');
    expect(box.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
    expect(box.angleLimit).toMatchObject({ minRad: -0.35, maxRad: 0.35 });
    expect(box.realization).toBe('ropeLashing');
  });

  it('keeps the slider-based conduit box riding the guide rail', () => {
    const sliders = project.mechanism.elements.filter((e) => e.type === 'slider');
    // bundle on the main guide; the keel post's slider on the twin rail is
    // the box's roll-proof footprint (see neckTruss.ts header)
    expect(sliders.map((s) => s.alongElementId)).toEqual(['aGuide', 'aGuide', 'bGuide']);
  });
});

describe('example 3 — steer mirror, genuinely horizontal (correct physics now)', () => {
  const project = loadExample('example-steer-mirror')!;

  it('lies in a horizontal plane at working height — the old gravity-off hack is gone', () => {
    for (const node of project.mechanism.nodes) {
      expect(node.position.y, node.id).toBe(STEER_PLANE_Y);
    }
  });

  it('pan pivots hinge about the plan-view normal (−y), so limits keep meaning', () => {
    for (const id of ['sPivot', 'hPivot']) {
      const piv = pivot(project, id);
      expect(piv.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: -1, z: 0 } });
      expect(piv.angleLimit).toMatchObject({ minRad: -0.6, maxRad: 0.6 });
    }
  });

  it('ships the CROSSED rope pair, taut at the drawn pose', () => {
    const ropes = project.mechanism.elements.filter((e) => e.type === 'rope');
    expect(ropes.map((r) => r.path)).toEqual([
      ['sL', 'hR'],
      ['sR', 'hL'],
    ]);
    for (const rope of ropes) {
      const taut = dist3(nodePos(project, rope.path[0]!), nodePos(project, rope.path[1]!));
      expect(rope.lengthM, rope.id).toBeCloseTo(taut, 3);
    }
  });
});

describe('example 4 — jaw + Bowden', () => {
  const project = loadExample('example-jaw-bowden')!;

  it('is head-local sagittal geometry hinged about +z at head height', () => {
    for (const node of project.mechanism.nodes) expect(node.position.z, node.id).toBe(0);
    expect(nodePos(project, 'jawPivot')).toEqual({ x: 0, y: JAW_PIVOT_Y, z: 0 });
    const pin = pivot(project, 'jawPivotPin');
    expect(pin.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
    expect(pin.angleLimit).toMatchObject({ minRad: -0.7, maxRad: 0 });
    expect(pin.welds).toEqual([['jawMain', 'jawHeelSpur']]);
  });

  it('sizes the bite cable so the jaw can rest fully open', () => {
    const cable = project.mechanism.elements.find((e) => e.id === 'biteCable');
    if (cable?.type !== 'bowden') throw new Error('biteCable must be a bowden');
    expect(cable.restLengthBM).toBeCloseTo(openHeelDistance(), 9);
  });
});

describe('example 5 — leg exoskeleton, on the wearer-left hip plane', () => {
  const project = loadExample('example-leg-exoskeleton')!;

  it('lies at z = +hipWidth/2 so bound nodes meet their true 3D skeleton points', () => {
    for (const node of project.mechanism.nodes) {
      expect(node.position.z, node.id).toBeCloseTo(0.18, 9);
    }
    expect(project.mechanism.skeletonBindings.map((b) => b.point)).toEqual([
      'hipL',
      'kneeL',
      'shoeL',
    ]);
  });

  it('hinges knee/ankle/toe about the sagittal normal with the drawn limits', () => {
    expect(pivot(project, 'kneePivot').angleLimit).toMatchObject({ minRad: -1.5, maxRad: 0.05 });
    expect(pivot(project, 'anklePivot').angleLimit).toMatchObject({ minRad: 0.6, maxRad: 1.9 });
    expect(pivot(project, 'toePivot').angleLimit).toMatchObject({ minRad: -0.6, maxRad: 0.35 });
    for (const id of ['kneePivot', 'anklePivot', 'toePivot']) {
      expect(pivot(project, id).joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
    }
  });
});

describe('example 6 — tail', () => {
  const project = loadExample('example-tail')!;

  it('keeps the torsion-sprung compliant hinges and hold rope in the sagittal plane', () => {
    for (const node of project.mechanism.nodes) expect(node.position.z, node.id).toBe(0);
    for (const id of ['tailFlex1', 'tailFlex2']) {
      const flex = pivot(project, id);
      expect(flex.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
      expect(flex.torsionSpring).toBeDefined();
    }
    const rope = project.mechanism.elements.find((e) => e.id === 'tailHoldRope');
    if (rope?.type !== 'rope') throw new Error('tailHoldRope must be a rope');
    expect(rope.lengthM).toBeCloseTo(
      dist3(nodePos(project, 'spineTopA'), nodePos(project, 'j1')),
      3,
    );
  });
});

describe('example 7 — full creature: ONE compound document (§9 item 7)', () => {
  const project = loadExample('example-full-creature')!;
  const mech = project.mechanism;

  it('is a single mechanism whose groups are the former mechanisms', () => {
    expect(project.groups.map((g) => g.name)).toEqual([
      'Spine',
      'Neck (pan × pitch)',
      'Steer',
      'Jaw + Bowden',
      'Leg (left)',
      'Leg (right)',
      'Tail',
      'Arm',
    ]);
  });

  it('joins pan × pitch as real stacked 3D hinges sharing the bundle member', () => {
    const pan = pivot(project, 'neck.panPivot');
    const pitch = pivot(project, 'neck.pitchPivot');
    // pan: vertical axis (plan normal) at the conduit-box base
    expect(pan.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: -1, z: 0 } });
    expect(pan.nodeId).toBe('neck.panBase');
    // pitch: horizontal rest axis, carried by the pan-side bundle — the
    // SHARED member is what makes the pitch plane rotate with pan
    expect(pitch.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
    expect(pitch.memberIds).toContain('neck.bundleCore');
    expect(pan.memberIds).toContain('neck.bundleCore');
    // the lashing compliance brackets the drawn rest deviation of the boom
    const rest = Math.atan2(
      nodePos(project, 'neck.head').y - nodePos(project, 'neck.pitchBase').y,
      nodePos(project, 'neck.head').x - nodePos(project, 'neck.pitchBase').x,
    );
    expect(pitch.angleLimit!.minRad).toBeLessThan(rest);
    expect(pitch.angleLimit!.maxRad).toBeGreaterThan(rest);
    expect(pitch.angleLimit!.maxRad - pitch.angleLimit!.minRad).toBeCloseTo(0.7, 3);
  });

  it('mirrors the steer pan to the neck bars through CROSSED taut ropes', () => {
    const ropes = mech.elements.filter((e) => e.type === 'rope' && e.id.startsWith('steer.rope'));
    expect(ropes.map((r) => (r.type === 'rope' ? r.path : []))).toEqual([
      ['steer.sL', 'neck.barR'],
      ['steer.sR', 'neck.barL'],
    ]);
    for (const rope of ropes) {
      if (rope.type !== 'rope') continue;
      const taut = dist3(nodePos(project, rope.path[0]!), nodePos(project, rope.path[1]!));
      expect(rope.lengthM, rope.id).toBeCloseTo(taut, 3);
    }
    // welded cross-bars give both pan joints their rope lever arms
    expect(pivot(project, 'steer.sPivot').welds).toEqual([
      ['steer.sArm', 'steer.sBarL'],
      ['steer.sArm', 'steer.sBarR'],
    ]);
    expect(pivot(project, 'neck.panPivot').welds).toEqual([
      ['neck.bundleCore', 'neck.barLBar'],
      ['neck.bundleCore', 'neck.barRBar'],
    ]);
  });

  it('duplicates the legs as true mirror geometry across z = 0', () => {
    const left = mech.nodes.filter((n) => n.id.startsWith('legL.'));
    expect(left.length).toBeGreaterThan(0);
    for (const node of left) {
      const twin = mech.nodes.find((n) => n.id === node.id.replace('legL.', 'legR.'));
      expect(twin, node.id).toBeDefined();
      expect(twin!.position.x).toBe(node.position.x);
      expect(twin!.position.y).toBe(node.position.y);
      expect(twin!.position.z).toBeCloseTo(-node.position.z, 9);
    }
    // sagittal geometry in a z-normal plane is mirror-invariant about +z:
    // same hinge axes, same limits (see legExo.ts)
    for (const id of ['kneePivot', 'anklePivot', 'toePivot']) {
      const l = pivot(project, `legL.${id}`);
      const r = pivot(project, `legR.${id}`);
      expect(r.joint).toEqual(l.joint);
      expect(r.angleLimit?.minRad).toBe(l.angleLimit?.minRad);
      expect(r.angleLimit?.maxRad).toBe(l.angleLimit?.maxRad);
    }
    const points = mech.skeletonBindings.map((b) => b.point);
    for (const p of ['hipL', 'kneeL', 'shoeL', 'hipR', 'kneeR', 'shoeR']) {
      expect(points).toContain(p);
    }
  });

  it('showcases the spherical joint at the arm’s rope-lashed hang', () => {
    const lash = pivot(project, 'arm.shoulderLash');
    expect(lash.joint).toEqual({ kind: 'spherical' });
    expect(lash.realization).toBe('ropeLashing');
    // the elbow stays a limited hinge
    expect(pivot(project, 'arm.armElbowPivot').joint.kind).toBe('hinge');
  });

  it('carries body masses at project level and node masses on the mechanism', () => {
    expect(project.pointMasses.map((m) => m.name).sort()).toEqual([
      'battery pack',
      'head + foam',
      'speaker',
      'tail counterweight',
    ]);
    const nodeMassNames = mech.pointMasses.map((m) => m.name).sort();
    expect(nodeMassNames).toEqual([
      'arm claw',
      'head',
      'head',
      'paw claw',
      'paw claw',
      'tail',
      'tail tip',
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

  it('has working sliders: the three global channels each drive a driven node', () => {
    expect(mech.inputs.map((c) => c.name).sort()).toEqual([
      'jaw trigger',
      'steer pan',
      'steer pitch',
    ]);
  });

  it('populates a fully resolved global BOM with a plausible creature weight', () => {
    const bom = computeBom(project);
    expect(bom.unresolved.count).toBe(0);
    // a wearable PVC creature: heavier than a prop, lighter than a person
    expect(bom.weights.grandTotalKg).toBeGreaterThan(3);
    expect(bom.weights.grandTotalKg).toBeLessThan(30);
    const pipeLength = bom.cutList
      .filter((p) => p.kind === 'pipe')
      .reduce((sum, p) => sum + p.lengthM * p.quantity, 0);
    expect(pipeLength).toBeGreaterThan(8); // meters of pipe across the build
    // per-group rollup covers every former mechanism
    expect(Object.keys(bom.weights.perGroupKg).sort()).toEqual(
      project.groups.map((g) => g.id).sort(),
    );
    for (const group of project.groups) {
      expect(bom.weights.perGroupKg[group.id]!, group.name).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST-INTEGRATION: behavioral acceptance through solve(). Assertion
// calibration note: `converged` requires every constraint within 1e-4 m —
// deep massy chains (the spine truss with kg-scale tip masses, the compound
// creature) settle at sub-millimetre constraint error and honestly report
// converged:false, exactly as the 2D solver did. Per the solver's guidance,
// those cases assert residual < 1e-3 plus the BEHAVIOR (positions, stretch);
// light chains (neck truss, tail) do converge and assert it.
// ─────────────────────────────────────────────────────────────────────────
describe('post-integration — examples solve (enable with the 3D solver)', () => {
  it('neck truss: settles neck-up at rest; steer grip down pitches the head down', async () => {
    const { solve } = await import('../solver');
    const mech = loadExample('example-neck-truss')!.mechanism;
    const solveAt = (steerPitch: number) =>
      solve(mech, { channelValues: { 'steer pitch': steerPitch } }, 'equilibrium');
    const rest = solveAt(0);
    expect(rest.diagnostics.converged).toBe(true);
    expect(rest.diagnostics.ropesRequiringCompression).toHaveLength(0);
    expect(rest.positions.head!.y).toBeGreaterThan(1.6);
    expect(rest.positions.head!.y).toBeLessThan(1.8);
    // the twin-rail keel keeps the boom from rolling off the sagittal plane
    expect(Math.abs(rest.positions.head!.z)).toBeLessThan(0.02);
    const half = solveAt(-0.015);
    const full = solveAt(-0.03);
    expect(full.diagnostics.converged).toBe(true);
    expect(half.positions.head!.y).toBeLessThan(rest.positions.head!.y - 0.03);
    expect(full.positions.head!.y).toBeLessThan(half.positions.head!.y - 0.03);
  });

  it('steer mirror: panning turns the head tip to the SAME side (crossed ropes)', async () => {
    const { solve } = await import('../solver');
    const mech = loadExample('example-steer-mirror')!.mechanism;
    for (const pan of [0.3, -0.3]) {
      const result = solve(mech, { channelValues: { 'steer pan': pan } }, 'equilibrium');
      expect(result.diagnostics.converged).toBe(true);
      // plan-view lateral coordinate is world z now
      const sZ = result.positions.sTip!.z;
      const hZ = result.positions.hTip!.z;
      expect(Math.abs(sZ)).toBeGreaterThan(0.05);
      expect(Math.sign(hZ)).toBe(Math.sign(sZ));
      expect(hZ).toBeCloseTo(sZ, 1.5);
    }
  });

  it('jaw: rests open, closes through the cable, freezes when locked', async () => {
    const { solve } = await import('../solver');
    const mech = loadExample('example-jaw-bowden')!.mechanism;
    const solveAt = (trigger: number) =>
      solve(mech, { channelValues: { 'jaw trigger': trigger } }, 'equilibrium');
    expect(solveAt(0).positions.jawTip!.y).toBeLessThan(JAW_PIVOT_Y - 0.1);
    // trigger max (0.038) stops short of geometric closed (0.0447): the cable
    // leaves the jaw at −0.095 rad, tip 0.0228 below the pivot analytically
    // (heel circle r=0.0716 against casing distance openHeel − 0.038)
    expect(solveAt(0.038).positions.jawTip!.y).toBeGreaterThan(JAW_PIVOT_Y - 0.026);
    const locked = structuredClone(mech);
    locked.inputs[0]!.value = 0.038;
    locked.inputs[0]!.locked = true;
    const result = solve(locked, { channelValues: { 'jaw trigger': 0 } }, 'equilibrium');
    expect(result.positions.jawTip!.y).toBeGreaterThan(JAW_PIVOT_Y - 0.026);
  });

  it('leg exoskeleton: follows the wearer through a full walk cycle', async () => {
    const { solve } = await import('../solver');
    const { bindingTargets, getClip, samplePose } = await import('../wearer');
    const { DEFAULT_WEARER } = await import('../schema');
    const mech = loadExample('example-leg-exoskeleton')!.mechanism;
    const walk = getClip('walk')!;
    let maxKneeX = Number.NEGATIVE_INFINITY;
    let minKneeX = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 12; i++) {
      const pose = samplePose(walk, (i / 12) * walk.durationS);
      const targets = bindingTargets(mech, DEFAULT_WEARER, pose);
      const result = solve(mech, { channelValues: {}, dragTargets: targets }, 'kinematic');
      const p = result.positions;
      const femur = dist3(p.eKnee!, p.frameHip!);
      expect(femur).toBeCloseTo(0.4808, 2);
      expect(dist3(p.eToe!, p.eToePad!)).toBeLessThan(0.155);
      maxKneeX = Math.max(maxKneeX, p.eKnee!.x);
      minKneeX = Math.min(minKneeX, p.eKnee!.x);
    }
    expect(maxKneeX - minKneeX).toBeGreaterThan(0.1);
  });

  it('tail: hangs on the hold rope and sags at the compliant joints', async () => {
    const { solve } = await import('../solver');
    const mech = loadExample('example-tail')!.mechanism;
    const rest = solve(mech, { channelValues: {} }, 'equilibrium');
    expect(rest.diagnostics.converged).toBe(true);
    expect(rest.positions.tailTip!.y).toBeLessThan(1.13);
    expect(rest.positions.tailTip!.y).toBeGreaterThan(0.75);
    const heavy = structuredClone(mech);
    heavy.pointMasses.find((m) => m.id === 'tailTipMass')!.massKg = 1.5;
    const sagged = solve(heavy, { channelValues: {} }, 'equilibrium');
    expect(sagged.positions.tailTip!.y).toBeLessThan(rest.positions.tailTip!.y - 0.01);
  });

  // four equilibrium solves of the full compound; well over the 5 s default
  it('full creature: pan REALLY carries pitch — the head pans and pitches in 3D', {
    timeout: 30_000,
  }, async () => {
    const { solve } = await import('../solver');
    const mech = loadExample('example-full-creature')!.mechanism;
    const solveAt = (pan: number, pitch: number) =>
      solve(mech, { channelValues: { 'steer pan': pan, 'steer pitch': pitch } }, 'equilibrium');
    const rest = solveAt(0, 0);
    // massy compound: converged demands 1e-4 m; assert residual + behavior
    expect(rest.diagnostics.residual).toBeLessThan(1e-3);
    expect(rest.diagnostics.ropesRequiringCompression).toHaveLength(0);
    expect(Math.abs(rest.positions['neck.head']!.z)).toBeLessThan(0.02);
    // pan: head swings hard to the same side as the steer tip (crossed
    // ropes); keep the +0.3 solve for the pitch-while-panned check below
    const pannedByPan = new Map<number, ReturnType<typeof solveAt>>();
    for (const pan of [0.3, -0.3]) {
      const panned = solveAt(pan, 0);
      pannedByPan.set(pan, panned);
      const sZ = panned.positions['steer.sTip']!.z;
      const hZ = panned.positions['neck.head']!.z;
      expect(Math.abs(hZ)).toBeGreaterThan(0.1);
      expect(Math.sign(hZ)).toBe(Math.sign(sZ));
    }
    // pitch still works while panned, IN the panned plane: the head drops
    // without giving up its pan offset — the pitch hinge rode the pan joint
    const panned = pannedByPan.get(0.3)!;
    const pannedDown = solveAt(0.3, -0.03);
    expect(pannedDown.positions['neck.head']!.y).toBeLessThan(
      panned.positions['neck.head']!.y - 0.03,
    );
    expect(Math.abs(pannedDown.positions['neck.head']!.z)).toBeGreaterThan(0.1);
    expect(Math.sign(pannedDown.positions['neck.head']!.z)).toBe(
      Math.sign(panned.positions['neck.head']!.z),
    );
  });

  it('full creature: settles millimetre-true at default channel values', async () => {
    const { solve } = await import('../solver');
    const mech = loadExample('example-full-creature')!.mechanism;
    const result = solve(mech, { channelValues: {} }, 'equilibrium');
    // kg-scale masses on a compound chain: the XPBD settle leaves sub-mm
    // constraint error (flagged `violated` at the 1e-4 m tolerance), same as
    // the 2D solver — so assert the honest form: residual within 1e-3 and
    // every rigid link within 2 mm of its drawn length
    expect(result.diagnostics.residual).toBeLessThan(1e-3);
    expect(result.diagnostics.ropesRequiringCompression).toHaveLength(0);
    const drawn = new Map(mech.nodes.map((n) => [n.id, n.position]));
    for (const el of mech.elements) {
      if (el.type !== 'link') continue;
      const rest = dist3(drawn.get(el.nodeA)!, drawn.get(el.nodeB)!);
      const now = dist3(result.positions[el.nodeA]!, result.positions[el.nodeB]!);
      expect(Math.abs(now - rest), el.id).toBeLessThan(2e-3);
    }
  });
});
