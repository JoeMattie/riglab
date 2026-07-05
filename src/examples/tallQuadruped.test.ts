// C5 — tall quadruped (PLANFILE-fun-costume-samples.md): structural +
// behavioral acceptance against the builder directly (the JSON artifact and
// registry wiring land in the integration slice).
//
// Solve-assertion calibration (bundledExamples.test.ts post-integration
// header): prefer diagnostics.converged; a massy compound that honestly
// cannot reach the 1e-4 m gate asserts residual < 1e-3 PLUS the behavior.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../bom';
import type { ElasticElement, PivotElement, RopeElement, Vec3 } from '../schema';
import { DEFAULT_WEARER, projectSchema, SCHEMA_VERSION } from '../schema';
import { solve } from '../solver';
import {
  anchorTargets,
  bindingTargets,
  computeSkeleton,
  getClip,
  REST_POSE,
  samplePose,
} from '../wearer';
import {
  buildTallQuadrupedParts,
  buildTallQuadrupedProject,
  COUNTERWEIGHT_KG,
  HEAD_MASS_KG,
  LEG_OUT_Z,
} from './tallQuadruped';

const project = buildTallQuadrupedProject();
const mech = project.mechanism;

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

const rope = (id: string): RopeElement => {
  const found = mech.elements.find((e): e is RopeElement => e.type === 'rope' && e.id === id);
  if (!found) throw new Error(`missing rope ${id}`);
  return found;
};

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('tall quadruped — structure (C5)', () => {
  it('validates against projectSchema at the current schema version', () => {
    expect(() => projectSchema.parse(project)).not.toThrow();
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.id).toBe('example-tall-quadruped');
    expect(buildTallQuadrupedParts().elements.map((e) => e.id)).toEqual(
      mech.elements.map((e) => e.id),
    );
  });

  it('uses one flat id namespace without collisions', () => {
    expect(new Set(mech.nodes.map((n) => n.id)).size).toBe(mech.nodes.length);
    expect(new Set(mech.elements.map((e) => e.id)).size).toBe(mech.elements.length);
  });

  it('keeps creature language out of identifiers and mechanism strings', () => {
    const blob = JSON.stringify({ ...project, name: '' }).toLowerCase();
    for (const word of ['raptor', 'giraffe', 'grazer', 'skyline']) {
      expect(blob.includes(word), word).toBe(false);
    }
  });

  it('hangs on the wearer: shoulder + hip-rect anchorBindings on anchor nodes at the rest anchors', () => {
    const frame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    expect(mech.anchorBindings.map((b) => b.anchor).sort()).toEqual([
      'hipRectBackL',
      'hipRectBackR',
      'hipRectFrontL',
      'hipRectFrontR',
      'shoulderL',
      'shoulderR',
    ]);
    for (const binding of mech.anchorBindings) {
      const node = mech.nodes.find((n) => n.id === binding.nodeId);
      expect(node, binding.id).toBeDefined();
      expect(node!.kind, binding.id).toBe('anchor');
      const anchor = frame.anchors[binding.anchor];
      expect(node!.position.x, binding.id).toBeCloseTo(anchor.x, 9);
      expect(node!.position.y, binding.id).toBeCloseTo(anchor.y, 9);
      expect(node!.position.z, binding.id).toBeCloseTo(anchor.z, 9);
    }
  });

  it('suspends the frame by pretensioned bungee carry + near-taut straps, lengths from drawn geometry', () => {
    const bungees = mech.elements.filter(
      (e): e is ElasticElement => e.type === 'elastic' && e.id.startsWith('frame.bungee'),
    );
    expect(bungees).toHaveLength(4);
    for (const b of bungees) {
      const drawn = dist3(nodePos(b.nodeA), nodePos(b.nodeB));
      expect(b.restLengthM, b.id).toBeCloseTo(0.85 * drawn, 3);
      expect(b.tensionOnly, b.id).toBe(true);
    }
    const straps = mech.elements.filter(
      (e): e is RopeElement => e.type === 'rope' && e.id.startsWith('frame.strap'),
    );
    expect(straps).toHaveLength(4);
    for (const s of straps) {
      const drawn = dist3(nodePos(s.path[0]!), nodePos(s.path[1]!));
      expect(s.lengthM - drawn, s.id).toBeGreaterThan(0);
      expect(s.lengthM - drawn, s.id).toBeLessThan(0.005); // near-taut
    }
  });

  it('copies the leg-exo linkage outboard at z ±0.30 with wearer ties on the skeleton half-width', () => {
    const exoIds = [
      'frameHip',
      'frameSide',
      'eKnee',
      'eAnkle',
      'eHeel',
      'eToeJ',
      'eToePad',
      'eToe',
    ];
    for (const id of exoIds) {
      expect(nodePos(`legL.${id}`).z, id).toBeCloseTo(LEG_OUT_Z, 9);
      expect(nodePos(`legR.${id}`).z, id).toBeCloseTo(-LEG_OUT_Z, 9);
    }
    for (const id of ['wHip', 'wKnee', 'wShoe']) {
      expect(nodePos(`legL.${id}`).z, id).toBeCloseTo(DEFAULT_WEARER.hipWidthM / 2, 9);
      expect(nodePos(`legR.${id}`).z, id).toBeCloseTo(-DEFAULT_WEARER.hipWidthM / 2, 9);
    }
    // true mirror geometry across z = 0
    for (const node of mech.nodes.filter((n) => n.id.startsWith('legL.'))) {
      const twin = mech.nodes.find((n) => n.id === node.id.replace('legL.', 'legR.'));
      expect(twin, node.id).toBeDefined();
      expect(twin!.position.x).toBe(node.position.x);
      expect(twin!.position.y).toBe(node.position.y);
      expect(twin!.position.z).toBeCloseTo(-node.position.z, 9);
    }
    // gait bindings for both sides; limits carried over from the leg exo
    expect(mech.skeletonBindings.map((b) => b.point).sort()).toEqual([
      'hipL',
      'hipR',
      'kneeL',
      'kneeR',
      'shoeL',
      'shoeR',
    ]);
    for (const side of ['legL', 'legR']) {
      expect(pivot(`${side}.kneePivot`).angleLimit).toMatchObject({ minRad: -1.5, maxRad: 0.05 });
      expect(pivot(`${side}.anklePivot`).angleLimit).toMatchObject({ minRad: 0.6, maxRad: 1.9 });
      expect(pivot(`${side}.toePivot`).angleLimit).toMatchObject({ minRad: -0.6, maxRad: 0.35 });
    }
  });

  it('articulates the neck per spec: sagittal root + sprung mid hinge, spherical bobble, rope-as-limit', () => {
    for (const piv of mech.elements.filter((e): e is PivotElement => e.type === 'pivot')) {
      if (piv.joint.kind === 'hinge') {
        const { x, y, z } = piv.joint.axis;
        expect(Math.hypot(x, y, z), piv.id).toBeCloseTo(1, 9);
      }
    }
    const root = pivot('neck.rootPivot');
    expect(root.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
    // frame members give the root hinge its axis tie
    expect(root.memberIds).toContain('frame.pylonNeckL');
    expect(root.memberIds).toContain('frame.spineBar');
    const mid = pivot('neck.midPivot');
    expect(mid.torsionSpring).toBeDefined();
    expect(mid.memberIds).toContain('neck.keelPost'); // anti-roll keel
    expect(mid.angleLimit!.minRad).toBeLessThan(mid.torsionSpring!.restAngleRad);
    expect(mid.angleLimit!.maxRad).toBeGreaterThan(mid.torsionSpring!.restAngleRad);
    const bobble = pivot('neck.bobblePivot');
    expect(bobble.joint).toEqual({ kind: 'spherical' });
    expect(bobble.angleLimit).toBeUndefined();
    expect(bobble.torsionSpring).toBeUndefined();
    // droop stop: the hold rope is exactly taut at the drawn pose, and the
    // hinge's own limits sit well outside (the rope is the limiter)
    const hold = rope('neck.holdRope');
    const taut = dist3(nodePos('frame.mastTop'), nodePos('neck.mid'));
    expect(hold.lengthM).toBeCloseTo(taut, 3);
    const rest = Math.atan2(
      // drawn deviation of the boom from the spine bar's continuation
      (nodePos('frame.neckRoot').x - nodePos('frame.tailRoot').x) *
        (nodePos('neck.mid').y - nodePos('frame.neckRoot').y) -
        (nodePos('frame.neckRoot').y - nodePos('frame.tailRoot').y) *
          (nodePos('neck.mid').x - nodePos('frame.neckRoot').x),
      (nodePos('frame.neckRoot').x - nodePos('frame.tailRoot').x) *
        (nodePos('neck.mid').x - nodePos('frame.neckRoot').x) +
        (nodePos('frame.neckRoot').y - nodePos('frame.tailRoot').y) *
          (nodePos('neck.mid').y - nodePos('frame.neckRoot').y),
    );
    expect(root.angleLimit!.minRad).toBeLessThan(rest - 0.3);
    expect(root.angleLimit!.maxRad).toBeGreaterThan(rest + 0.2);
    // nest guys pretensioned against drawn geometry (0.88 × drawn — see the
    // builder's nest-tuning note; a neutral nest could not hold the bobble)
    const guys = mech.elements.filter(
      (e): e is ElasticElement => e.type === 'elastic' && e.id.startsWith('neck.nest'),
    );
    expect(guys).toHaveLength(3);
    for (const g of guys) {
      expect(g.restLengthM, g.id).toBeCloseTo(0.88 * dist3(nodePos(g.nodeA), nodePos(g.nodeB)), 3);
    }
  });

  it('groups the five costume subsystems, covering every element exactly once', () => {
    expect(project.groups.map((g) => g.name)).toEqual([
      'Body frame + suspension',
      'Neck + head',
      'Leg (left)',
      'Leg (right)',
      'Tail counterweight',
    ]);
    const grouped = project.groups.flatMap((g) => g.elementIds);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(mech.elements.map((e) => e.id)));
  });

  it('resolves the full BOM at a plausible costume weight', () => {
    const bom = computeBom(project);
    expect(bom.unresolved.count).toBe(0);
    expect(bom.weights.grandTotalKg).toBeGreaterThan(2);
    expect(bom.weights.grandTotalKg).toBeLessThan(20);
  });

  // DESIGN assert (not a solver assert): the 1.2 kg counterweight cancels the
  // head's standing gravity moment about the pack to within 0.65 N·m (≈ 10%
  // of the head-side moment) — the seesaw-spine trick.
  it('balances neck+head against the tail counterweight about the pack x', () => {
    const g = 9.81;
    const packX =
      ['frame.aHipFL', 'frame.aHipFR', 'frame.aHipBL', 'frame.aHipBR']
        .map((id) => nodePos(id).x)
        .reduce((a, b) => a + b, 0) / 4;
    const headMoment = HEAD_MASS_KG * g * (nodePos('neck.head').x - packX);
    const tailMoment = COUNTERWEIGHT_KG * g * (nodePos('tail.tip').x - packX);
    expect(headMoment).toBeGreaterThan(4); // nonvacuous: real levers each side
    expect(tailMoment).toBeLessThan(-4);
    expect(Math.abs(headMoment + tailMoment)).toBeLessThan(0.65);
  });
});

describe('tall quadruped — behavior through solve() (C5)', () => {
  const drawn = new Map(mech.nodes.map((n) => [n.id, n.position]));
  const linkLen = (positions: Record<string, Vec3>, a: string, b: string) =>
    dist3(positions[a]!, positions[b]!);

  it('rest equilibrium: the head is held tall on the sagittal plane, ropes in tension', {
    timeout: 60_000,
  }, () => {
    const rest = solve(mech, { channelValues: {} }, 'equilibrium');
    // Massy compound (2 kg of point masses on a suspended frame with legs at
    // their rope/angle limits): like the full creature it settles at
    // ~2×10⁻⁴ m constraint error and honestly reports converged:false, so
    // per the calibration note assert residual < 1e-3 PLUS the behavior.
    expect(rest.diagnostics.residual).toBeLessThan(1e-3);
    expect(rest.diagnostics.ropesRequiringCompression).toHaveLength(0);
    expect(rest.positions['neck.head']!.y).toBeGreaterThan(2.7);
    expect(Math.abs(rest.positions['neck.head']!.z)).toBeLessThan(0.02);
    // rigid geometry holds its drawn dimensions
    for (const el of mech.elements) {
      if (el.type !== 'link') continue;
      const restLen = dist3(drawn.get(el.nodeA)!, drawn.get(el.nodeB)!);
      expect(Math.abs(linkLen(rest.positions, el.nodeA, el.nodeB) - restLen), el.id).toBeLessThan(
        2e-3,
      );
    }
  });

  it('walk mimicry: 12 gait samples keep femur/boom lengths true while the knees sweep', {
    timeout: 60_000,
  }, () => {
    const walk = getClip('walk')!;
    const spans: Array<[string, string]> = [
      ['legL.frameHip', 'legL.eKnee'],
      ['legR.frameHip', 'legR.eKnee'],
      ['frame.neckRoot', 'neck.mid'],
      ['neck.mid', 'neck.top'],
    ];
    let maxSweep = Number.NEGATIVE_INFINITY;
    let minSweep = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 12; i++) {
      const pose = samplePose(walk, (i / 12) * walk.durationS);
      const result = solve(
        mech,
        {
          channelValues: {},
          dragTargets: bindingTargets(mech, DEFAULT_WEARER, pose),
          groundTargets: anchorTargets(mech, DEFAULT_WEARER, pose),
        },
        'kinematic',
      );
      for (const [a, b] of spans) {
        const restLen = dist3(drawn.get(a)!, drawn.get(b)!);
        expect(Math.abs(linkLen(result.positions, a, b) - restLen), `${a}→${b} @${i}`).toBeLessThan(
          2e-3,
        );
      }
      const sweep = result.positions['legL.eKnee']!.x - result.positions['legL.frameHip']!.x;
      maxSweep = Math.max(maxSweep, sweep);
      minSweep = Math.min(minSweep, sweep);
    }
    expect(maxSweep - minSweep).toBeGreaterThan(0.1);
  });

  it('bobble: a 0.1 m sideways head displacement restores through the nest', {
    timeout: 60_000,
  }, () => {
    const rest = solve(mech, { channelValues: {} }, 'equilibrium');
    const tilted = structuredClone(mech);
    const head = tilted.nodes.find((n) => n.id === 'neck.head')!;
    const top = drawn.get('neck.top')!;
    const post = dist3(top, drawn.get('neck.head')!);
    // tilt ON the post sphere (post length preserved, so link rest lengths
    // derived from drawn geometry are unchanged)
    head.position = {
      x: top.x,
      y: top.y + Math.sqrt(post * post - 0.1 * 0.1),
      z: top.z + 0.1,
    };
    const restored = solve(tilted, { channelValues: {} }, 'equilibrium');
    expect(dist3(restored.positions['neck.head']!, rest.positions['neck.head']!)).toBeLessThan(
      0.04,
    );
  });
});
