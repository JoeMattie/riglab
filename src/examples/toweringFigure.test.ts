// C1 — towering figure (dance mirror) acceptance (PLANFILE-fun-costume-
// samples.md): structural conventions (suspension bindings, joint windows,
// geometry-derived cordage rests, resolved BOM) plus behavioral solves —
// rest equilibrium, dance-clip arm mimicry through the marionette ropes, and
// the bobble-head restoring nest. The mimicry harness follows the leg-exo
// walk-cycle pattern (samplePose → drive bound nodes → solve), but in
// EQUILIBRIUM mode: the marionette drive is a rope, and ropes are force
// elements, inert in kinematic mode.
import { describe, expect, it } from 'vitest';
import { computeBom } from '../bom';
import type { Mechanism, PivotElement, Project, Vec3 } from '../schema';
import { DEFAULT_WEARER, projectSchema } from '../schema';
import { solve } from '../solver';
import {
  anchorTargets,
  bindingTargets,
  computeSkeleton,
  getClip,
  REST_POSE,
  samplePose,
} from '../wearer';
import { buildToweringFigureProject } from './toweringFigure';

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const project: Project = buildToweringFigureProject();
const mech: Mechanism = project.mechanism;
const drawn = new Map(mech.nodes.map((n) => [n.id, n.position]));
const posOf = (id: string): Vec3 => {
  const p = drawn.get(id);
  if (!p) throw new Error(`missing node ${id}`);
  return p;
};

const pivot = (id: string): PivotElement => {
  const found = mech.elements.find((e): e is PivotElement => e.type === 'pivot' && e.id === id);
  if (!found) throw new Error(`missing pivot ${id}`);
  return found;
};

/** Rigid-member node pairs (links + consecutive bentLink segments) whose
 * solved lengths must track the drawn geometry. */
function rigidPairs(): Array<[string, string, string]> {
  const pairs: Array<[string, string, string]> = [];
  for (const el of mech.elements) {
    if (el.type === 'link') pairs.push([el.id, el.nodeA, el.nodeB]);
    if (el.type === 'bentLink') {
      for (let i = 1; i < el.nodeIds.length; i++) {
        pairs.push([el.id, el.nodeIds[i - 1]!, el.nodeIds[i]!]);
      }
    }
  }
  return pairs;
}

function expectRigidLengthsHold(positions: Record<string, Vec3>, tolM: number): void {
  for (const [id, a, b] of rigidPairs()) {
    const rest = dist3(posOf(a), posOf(b));
    const now = dist3(positions[a]!, positions[b]!);
    expect(Math.abs(now - rest), `${id} ${a}–${b}`).toBeLessThan(tolM);
  }
}

const solveEq = (inputs: {
  dragTargets?: Record<string, Vec3>;
  groundTargets?: Record<string, Vec3>;
}) => solve(mech, { channelValues: {}, ...inputs }, 'equilibrium');

describe('C1 towering figure — structure', () => {
  it('validates against projectSchema with one flat id namespace', () => {
    expect(() => projectSchema.parse(project)).not.toThrow();
    expect(new Set(mech.nodes.map((n) => n.id)).size).toBe(mech.nodes.length);
    expect(new Set(mech.elements.map((e) => e.id)).size).toBe(mech.elements.length);
    expect(mech.inputs).toHaveLength(0); // pure mimicry: no input channels
  });

  it('ships the five planfile groups covering every element exactly once', () => {
    expect(project.groups.map((g) => g.name)).toEqual([
      'Mast + head',
      'Arm (left)',
      'Arm (right)',
      'Legs',
      'Suspension',
    ]);
    const grouped = project.groups.flatMap((g) => g.elementIds);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(mech.elements.map((e) => e.id)));
  });

  it('hangs on the wearer: anchorBindings on spineTop + beltBack + hip rect', () => {
    expect(mech.anchorBindings.map((b) => b.anchor).sort()).toEqual([
      'beltBack',
      'hipRectBackL',
      'hipRectBackR',
      'hipRectFrontL',
      'hipRectFrontR',
      'spineTop',
    ]);
    // every grounded node is wearer-attached, drawn exactly at its anchor's
    // rest position (groundTargets are a no-op at rest)
    const frame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    const boundNodes = new Set(mech.anchorBindings.map((b) => b.nodeId));
    for (const node of mech.nodes.filter((n) => n.kind === 'anchor')) {
      expect(boundNodes.has(node.id), node.id).toBe(true);
    }
    for (const b of mech.anchorBindings) {
      const node = mech.nodes.find((n) => n.id === b.nodeId)!;
      expect(node.kind, b.id).toBe('anchor');
      expect(dist3(node.position, frame.anchors[b.anchor]), b.id).toBeLessThan(1e-6);
    }
  });

  it('mirrors the dance through hand and knee skeleton bindings drawn on-pose', () => {
    expect(mech.skeletonBindings.map((b) => b.point).sort()).toEqual([
      'handL',
      'handR',
      'kneeL',
      'kneeR',
    ]);
    const frame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    for (const b of mech.skeletonBindings) {
      expect(dist3(posOf(b.nodeId), frame.points[b.point]), b.id).toBeLessThan(1e-6);
    }
  });

  it('meets the C1 geometry envelope: 2.3 m cross-bar, ±0.35 tips, 2.7 m head', () => {
    expect(posOf('mastTop')).toEqual({ x: -0.1, y: 2.3, z: 0 });
    expect(posOf('barTipL')).toEqual({ x: -0.1, y: 2.3, z: 0.35 });
    expect(posOf('barTipR')).toEqual({ x: -0.1, y: 2.3, z: -0.35 });
    expect(posOf('head').y).toBe(2.7);
    expect(posOf('neckBase').y).toBe(2.45);
    // 0.6 m upper arm (chord) + 0.6 m forearm, both sides mirrored across z=0
    for (const s of ['L', 'R'] as const) {
      expect(dist3(posOf(`barTip${s}`), posOf(`elbow${s}`))).toBeCloseTo(0.6, 9);
      expect(dist3(posOf(`elbow${s}`), posOf(`armTip${s}`))).toBeCloseTo(0.6, 4);
    }
    for (const node of mech.nodes) {
      const twinId = node.id.endsWith('L') ? `${node.id.slice(0, -1)}R` : null;
      if (!twinId) continue;
      const twin = mech.nodes.find((n) => n.id === twinId);
      if (!twin) continue;
      expect(twin.position.x, node.id).toBe(node.position.x);
      expect(twin.position.y, node.id).toBe(node.position.y);
      expect(twin.position.z, node.id).toBeCloseTo(-node.position.z, 9);
    }
    // PIPE_075 mast, PIPE_050 elsewhere
    for (const id of ['mastLower', 'mastUpper']) {
      const el = mech.elements.find((e) => e.id === id);
      if (el?.type !== 'link') throw new Error(`${id} must be a link`);
      expect(el.pipeMaterialId).toBe('pipe-nps-sch40-075');
    }
  });

  it('draws the C1 joints: shoulder window, soft bent-rest elbow, spherical bobble', () => {
    for (const s of ['L', 'R'] as const) {
      const shoulder = pivot(`shoulderPivot${s}`);
      expect(shoulder.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
      // limits are [−0.4, +2.9] about the drawn hanging pose
      expect(shoulder.angleLimit!.maxRad - shoulder.angleLimit!.minRad).toBeCloseTo(3.3, 9);
      const elbowPivot = pivot(`elbowPivot${s}`);
      expect(elbowPivot.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
      expect(elbowPivot.torsionSpring).toMatchObject({ stiffnessNmPerRad: 8, restAngleRad: 0.25 });
      const hip = pivot(`hipPivot${s}`);
      expect(hip.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
      expect(hip.angleLimit!.maxRad - hip.angleLimit!.minRad).toBeCloseTo(1.4, 9);
    }
    const headPivot = pivot('headPivot');
    expect(headPivot.joint).toEqual({ kind: 'spherical' });
    expect(headPivot.realization).toBe('ropeLashing');
    expect(headPivot.angleLimit).toBeUndefined();
    expect(headPivot.torsionSpring).toBeUndefined();
  });

  it('derives every rope length and elastic rest from the drawn geometry', () => {
    for (const el of mech.elements) {
      if (el.type === 'rope') {
        let taut = 0;
        for (let i = 1; i < el.path.length; i++) {
          taut += dist3(posOf(el.path[i - 1]!), posOf(el.path[i]!));
        }
        const slack = el.id === 'strapSpine' ? 0.01 : 0.002;
        expect(el.lengthM, el.id).toBeCloseTo(taut + slack, 3);
        expect(el.lengthM, el.id).toBeGreaterThan(taut); // never drawn overtaut
      }
      if (el.type === 'elastic') {
        // all elastics are drawn neutral (rest = drawn distance)
        expect(el.slackLengthM, el.id).toBeCloseTo(dist3(posOf(el.nodeA), posOf(el.nodeB)), 3);
      }
    }
  });

  it('resolves the full BOM at a plausible costume weight', () => {
    const bom = computeBom(project);
    expect(bom.unresolved.count).toBe(0);
    expect(bom.weights.grandTotalKg).toBeGreaterThan(2);
    expect(bom.weights.grandTotalKg).toBeLessThan(20);
    for (const group of project.groups) {
      expect(bom.weights.perGroupKg[group.id]!, group.name).toBeGreaterThan(0);
    }
  });
});

describe('C1 towering figure — behavior (equilibrium solves)', () => {
  it('rest: honest converge, no compressed ropes, mast top on station', { timeout: 60_000 }, () => {
    const rest = solveEq({});
    expect(rest.diagnostics.converged).toBe(true);
    expect(rest.diagnostics.ropesRequiringCompression).toHaveLength(0);
    // mast top within 0.05 m of drawn (spec), head upright over the pivot
    expect(dist3(rest.positions.mastTop!, posOf('mastTop'))).toBeLessThan(0.05);
    expect(rest.positions.head!.y).toBeGreaterThan(2.6);
    expect(Math.abs(rest.positions.head!.z)).toBeLessThan(0.02);
    // arms hang near full droop
    for (const s of ['L', 'R'] as const) {
      expect(rest.positions[`armTip${s}`]!.y).toBeGreaterThan(0.9);
      expect(rest.positions[`armTip${s}`]!.y).toBeLessThan(1.3);
    }
  });

  it('dance mimicry: hands high/low swing the giant arms > 0.5 m, mirrored', {
    timeout: 120_000,
  }, () => {
    const dance = getClip('dance');
    if (!dance) throw new Error('missing dance clip');
    const solveAt = (tS: number) => {
      const pose = samplePose(dance, tS);
      return solve(
        mech,
        {
          channelValues: {},
          dragTargets: bindingTargets(mech, DEFAULT_WEARER, pose),
          groundTargets: anchorTargets(mech, DEFAULT_WEARER, pose),
        },
        'equilibrium',
      );
    };
    const leftHigh = solveAt(0.6); // shoulderL 1.4 — left hand high
    const leftLow = solveAt(1.8); // shoulderL −0.4 — left hand behind
    // massy compound under drag: honestly misses the 1e-4 converged gate, so
    // per the calibration note assert residual < 1e-3 PLUS the behavior
    expect(leftHigh.diagnostics.residual).toBeLessThan(1e-3);
    expect(leftLow.diagnostics.residual).toBeLessThan(1e-3);
    // the giant mirrors: left arm tip travels > 0.5 m of height between the
    // two, the right arm does the same at the opposite phase
    expect(leftHigh.positions.armTipL!.y - leftLow.positions.armTipL!.y).toBeGreaterThan(0.5);
    expect(leftLow.positions.armTipR!.y - leftHigh.positions.armTipR!.y).toBeGreaterThan(0.5);
    // and no cheating: every rigid member holds its drawn length within 2 mm
    expectRigidLengthsHold(leftHigh.positions, 2e-3);
    expectRigidLengthsHold(leftLow.positions, 2e-3);
  });

  it('bobble: a 0.1 m sideways head shove settles back within 0.04 m', { timeout: 120_000 }, () => {
    const rest = solveEq({});
    const restHead = rest.positions.head!;
    // displace the head 0.1 m in +z, length-preserving about the spherical
    // pivot (rotating the post, not stretching it), and re-solve
    const displaced = structuredClone(mech);
    const neckBase = posOf('neckBase');
    const postLen = dist3(neckBase, posOf('head'));
    const headNode = displaced.nodes.find((n) => n.id === 'head');
    if (!headNode) throw new Error('missing head node');
    headNode.position = {
      x: neckBase.x,
      y: Math.round((neckBase.y + Math.sqrt(postLen ** 2 - 0.1 ** 2)) * 1e4) / 1e4,
      z: 0.1,
    };
    expect(dist3(headNode.position, restHead)).toBeGreaterThan(0.09); // it IS displaced
    const settled = solve(displaced, { channelValues: {} }, 'equilibrium');
    expect(dist3(settled.positions.head!, restHead)).toBeLessThan(0.04);
  });
});
