// C4 "Serpent costume" acceptance (PLANFILE-fun-costume-samples.md):
// structural asserts (bindings, hinge axes, id namespace, chain wiring) plus
// behavioral solve asserts — rest equilibrium, the crossed-rope drives, the
// ratio-0.8/backlash-0.15 torsion-cable chain, and the `slither` clip.
// Imports the builder directly (the JSON artifact + registry land in the
// integration slice).
import { describe, expect, it } from 'vitest';
import { computeBom } from '../bom';
import type { Vec3 } from '../schema';
import { DEFAULT_WEARER, projectSchema } from '../schema';
import { solve } from '../solver';
import { computeSkeleton, REST_POSE } from '../wearer';
import {
  buildSerpentCostumeProject,
  DRIVE_ROPE_SLACK_M,
  jawChannelMax,
  STRAP_SLACK_M,
} from './serpentCostume';

const project = buildSerpentCostumeProject();
const mech = project.mechanism;
const drawn = new Map(mech.nodes.map((n) => [n.id, n.position]));
const at = (id: string): Vec3 => {
  const p = drawn.get(id);
  if (!p) throw new Error(`missing node ${id}`);
  return p;
};

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Signed pan angle from direction u to direction v about the plan hinge
 * axis (0,−1,0) — cross(u,v)·(0,−1,0) over dot, in the horizontal plane. */
const panBetween = (u: Vec3, v: Vec3): number =>
  Math.atan2(u.x * v.z - u.z * v.x, u.x * v.x + u.z * v.z);

const dir = (a: Vec3, b: Vec3): Vec3 => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });

type Channels = Record<string, number>;
const solveCache = new Map<string, ReturnType<typeof solve>>();
function solveAt(channels: Channels): ReturnType<typeof solve> {
  const key = JSON.stringify(channels);
  let result = solveCache.get(key);
  if (!result) {
    result = solve(mech, { channelValues: channels }, 'equilibrium');
    solveCache.set(key, result);
  }
  return result;
}

/** Tail joint pan deflections from a solved pose, root → tip, hoop-relative
 * (the hoop may yaw a hair under drive reaction torque). Drawn rest is 0 for
 * every junction: the chain is drawn straight aft. */
function tailDeflections(pos: Record<string, Vec3>): number[] {
  const hoopAft = dir(pos.hoopF!, pos.hoopB!); // hoop fore→aft axis
  const seg = (a: string, b: string) => dir(pos[a]!, pos[b]!);
  const d1 = panBetween(hoopAft, seg('hoopB', 'tailJ2'));
  const d2 = panBetween(seg('hoopB', 'tailJ2'), seg('tailJ2', 'tailJ3'));
  const d3 = panBetween(seg('tailJ2', 'tailJ3'), seg('tailJ3', 'tailJ4'));
  const d4 = panBetween(seg('tailJ3', 'tailJ4'), seg('tailJ4', 'tailTip'));
  return [d1, d2, d3, d4];
}

describe('bundled serpent-costume example (C4) — structure', () => {
  it('is a valid v7 project with the planfile identity and creature-clean mechanism', () => {
    const parsed = projectSchema.parse(structuredClone(project));
    expect(parsed).toEqual(project);
    expect(project.id).toBe('example-serpent-costume');
    expect(project.name).toBe('Example — Parade dragon');
    // species words live ONLY in the project name (§9 creature-agnostic rule)
    const blob = JSON.stringify({ mech, groups: project.groups }).toLowerCase();
    for (const word of ['dragon', 'serpent', 'snake']) {
      expect(blob.includes(word), word).toBe(false);
    }
  });

  it('hangs on the wearer: shoulder + hip-rect anchorBindings drawn at the true anchors', () => {
    expect(mech.anchorBindings.map((b) => b.anchor).sort()).toEqual([
      'hipRectBackL',
      'hipRectBackR',
      'hipRectFrontL',
      'hipRectFrontR',
      'shoulderL',
      'shoulderR',
    ]);
    const frame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    const byId = new Map(mech.nodes.map((n) => [n.id, n]));
    for (const b of mech.anchorBindings) {
      const node = byId.get(b.nodeId);
      expect(node, b.id).toBeDefined();
      expect(node!.kind, b.id).toBe('anchor');
      const anchor = frame.anchors[b.anchor];
      expect(node!.position.x, b.id).toBeCloseTo(anchor.x, 6);
      expect(node!.position.y, b.id).toBeCloseTo(anchor.y, 6);
      expect(node!.position.z, b.id).toBeCloseTo(anchor.z, 6);
    }
    // bungee carry (pretensioned to 0.85 × drawn) + near-taut straps
    const bungees = mech.elements.filter((e) => e.type === 'elastic' && e.id.startsWith('bungee'));
    expect(bungees).toHaveLength(4);
    for (const e of bungees) {
      if (e.type !== 'elastic') continue;
      expect(e.restLengthM).toBeCloseTo(0.85 * dist3(at(e.nodeA), at(e.nodeB)), 3);
    }
    const straps = mech.elements.filter((e) => e.type === 'rope' && e.id.startsWith('strap'));
    expect(straps).toHaveLength(4);
    for (const e of straps) {
      if (e.type !== 'rope') continue;
      expect(e.lengthM).toBeCloseTo(dist3(at(e.path[0]!), at(e.path[1]!)) + STRAP_SLACK_M, 3);
    }
  });

  it('tail: four 0.45 m segments on plan hinges, springs centering, cables chaining at 0.8', () => {
    const junctions = ['hoopB', 'tailJ2', 'tailJ3', 'tailJ4', 'tailTip'];
    for (let i = 1; i < junctions.length; i++) {
      expect(dist3(at(junctions[i - 1]!), at(junctions[i]!)), junctions[i]).toBeCloseTo(0.45, 4);
    }
    const pivotIds = ['tailRootPivot', 'tailPivot2', 'tailPivot3', 'tailPivot4'];
    for (const id of pivotIds) {
      const p = mech.elements.find((e) => e.id === id);
      if (p?.type !== 'pivot') throw new Error(`${id} must be a pivot`);
      expect(p.joint, id).toEqual({ kind: 'hinge', axis: { x: 0, y: -1, z: 0 } });
      expect(p.torsionSpring, id).toBeDefined();
      expect(p.angleLimit, id).toBeDefined();
    }
    const cables = mech.elements.filter((e) => e.type === 'torsionCable');
    expect(cables.map((c) => c.id).sort()).toEqual(['tailCable12', 'tailCable23', 'tailCable34']);
    for (const c of cables) {
      if (c.type !== 'torsionCable') continue;
      expect(c.ratio).toBe(0.8);
      expect(c.backlashRad).toBe(0.15);
    }
    const chain = cables.map((c) => (c.type === 'torsionCable' ? [c.pivotA, c.pivotB] : []));
    expect(chain).toEqual([
      ['tailRootPivot', 'tailPivot2'],
      ['tailPivot2', 'tailPivot3'],
      ['tailPivot3', 'tailPivot4'],
    ]);
    // crossed drive ropes, rest lengths derived from the drawn geometry
    for (const [id, a, b] of [
      ['ropeWaveLtoR', 'gripWaveL', 'tailBar1R'],
      ['ropeWaveRtoL', 'gripWaveR', 'tailBar1L'],
      ['ropePanLtoR', 'gripPanL', 'panBarR'],
      ['ropePanRtoL', 'gripPanR', 'panBarL'],
    ] as const) {
      const rope = mech.elements.find((e) => e.id === id);
      if (rope?.type !== 'rope') throw new Error(`${id} must be a rope`);
      expect(rope.path).toEqual([a, b]);
      expect(rope.lengthM).toBeCloseTo(dist3(at(a), at(b)) + DRIVE_ROPE_SLACK_M, 3);
    }
  });

  it('channels, trigger control at beltR, and the quarter-phase slither clip', () => {
    expect(mech.inputs.map((c) => c.name).sort()).toEqual(['head pan', 'jaw', 'tail wave']);
    const drivenChannels = mech.nodes
      .filter((n) => n.kind === 'driven')
      .map((n) => n.channelId)
      .sort();
    expect(drivenChannels).toEqual(['chHeadPan', 'chJaw', 'chTailWave']);
    const trigger = project.controls.find((c) => c.type === 'trigger');
    expect(trigger).toBeDefined();
    expect(trigger!.mount).toEqual({ kind: 'wearerAnchor', anchor: 'beltR' });
    expect(trigger!.axes.map((a) => a.channelName)).toEqual(['jaw']);
    expect(trigger!.axes[0]!.outMax).toBe(jawChannelMax());
    const clip = project.controlClips.find((c) => c.name === 'slither');
    expect(clip).toBeDefined();
    expect(clip!.durationS).toBe(4);
    expect(clip!.loop).toBe(true);
    expect(clip!.tracks['head pan']!.values).toEqual([0, 0.5, 0, -0.5, 0]);
    expect(clip!.tracks['tail wave']!.values).toEqual([0.5, 0, -0.5, 0, 0.5]);
  });

  it('groups cover every element exactly once, one per subsystem', () => {
    expect(project.groups.map((g) => g.name)).toEqual([
      'Body + suspension',
      'Head + jaw',
      'Tail chain',
      'Drives',
    ]);
    const covered = project.groups.flatMap((g) => g.elementIds);
    expect(covered).toHaveLength(mech.elements.length);
    expect(new Set(covered)).toEqual(new Set(mech.elements.map((e) => e.id)));
    for (const el of mech.elements) expect(el.maturity, el.id).toBe('engineered');
  });

  it('resolves a full BOM at a plausible costume weight', () => {
    const bom = computeBom(project);
    expect(bom.unresolved.count).toBe(0);
    expect(bom.weights.grandTotalKg).toBeGreaterThan(2);
    expect(bom.weights.grandTotalKg).toBeLessThan(20);
    for (const group of project.groups) {
      expect(bom.weights.perGroupKg[group.id]!, group.name).toBeGreaterThan(0);
    }
  });
});

// Assertion calibration (bundledExamples.test.ts note): `converged` demands
// every constraint within 1e-4 m AND the relaxation to quiesce; the 4-hinge
// tail chain with its kg-scale tip mass relaxes to ~1e-4 constraint error but
// keeps creeping below the quiescence gate, honestly reporting
// converged:false (verified: the same rig converges with the point masses
// removed). Per the planfile's test conventions, these solves assert
// residual < 1e-3 PLUS the behavior — positions, rigid lengths, no
// compressed ropes — never a vacuous residual-only test.
describe('serpent-costume solve behavior (equilibrium)', () => {
  it('rest: settles on its suspension, chain straight aft, geometry rigid', {
    timeout: 60_000,
  }, () => {
    const rest = solveAt({});
    expect(rest.diagnostics.residual).toBeLessThan(1e-3);
    expect(rest.diagnostics.ropesRequiringCompression).toHaveLength(0);
    // tail tip near the sagittal plane at drawn height (no roll-droop)
    expect(Math.abs(rest.positions.tailTip!.z)).toBeLessThan(0.05);
    expect(rest.positions.tailTip!.y).toBeGreaterThan(1.09);
    expect(rest.positions.tailTip!.y).toBeLessThan(1.21);
    // head rides the suspended hoop within a few cm of drawn
    expect(dist3(rest.positions.head!, at('head'))).toBeLessThan(0.06);
    expect(Math.abs(rest.positions.head!.z)).toBeLessThan(0.03);
    // every rigid member holds its drawn length within 2 mm (honest-form
    // behavior check backing the residual assert)
    for (const el of mech.elements) {
      if (el.type === 'link') {
        const want = dist3(at(el.nodeA), at(el.nodeB));
        const got = dist3(rest.positions[el.nodeA]!, rest.positions[el.nodeB]!);
        expect(Math.abs(got - want), el.id).toBeLessThan(2e-3);
      } else if (el.type === 'bentLink') {
        for (let i = 1; i < el.nodeIds.length; i++) {
          const a = el.nodeIds[i - 1]!;
          const b = el.nodeIds[i]!;
          const want = dist3(at(a), at(b));
          const got = dist3(rest.positions[a]!, rest.positions[b]!);
          expect(Math.abs(got - want), `${el.id} ${a}-${b}`).toBeLessThan(2e-3);
        }
      }
    }
  });

  it('tail wave: tip follows the grip side, chain curls at ratio ≈ 0.8 with backlash lag', {
    timeout: 120_000,
  }, () => {
    for (const wave of [0.5, -0.5]) {
      const result = solveAt({ 'tail wave': wave });
      expect(result.diagnostics.residual, `residual (wave ${wave})`).toBeLessThan(1e-3);
      expect(result.diagnostics.ropesRequiringCompression, `ropes (wave ${wave})`).toHaveLength(0);
      const gripZ = result.positions.gripWaveTip!.z;
      const tipZ = result.positions.tailTip!.z;
      expect(Math.abs(gripZ), `grip moved (wave ${wave})`).toBeGreaterThan(0.05);
      expect(Math.sign(tipZ), `tip side (wave ${wave})`).toBe(Math.sign(gripZ));
      expect(Math.abs(tipZ), `tip swing (wave ${wave})`).toBeGreaterThan(0.15);
      const [d1, d2, d3, d4] = tailDeflections(result.positions);
      // the root drive actually deflects, and the coupled chain follows it
      expect(Math.abs(d1!), `root deflection (wave ${wave})`).toBeGreaterThan(0.3);
      expect(Math.abs(d2!), `J2 curls (wave ${wave})`).toBeGreaterThan(0.1);
      expect(Math.sign(d2!), `J2 sign (wave ${wave})`).toBe(Math.sign(d1!));
      // each successive joint at ratio 0.8 within the ±0.15 backlash band
      // (plus solver slack): J2 rides the trailing edge at 0.8·δ1 − 0.15,
      // J3/J4 sit inside the dead zone — exactly the whip-with-lag spec
      const chain = [d1!, d2!, d3!, d4!];
      for (let k = 0; k + 1 < chain.length; k++) {
        expect(
          Math.abs(chain[k + 1]! - 0.8 * chain[k]!),
          `ratio J${k + 1}→J${k + 2} (wave ${wave})`,
        ).toBeLessThan(0.2);
      }
      // drive reaction through the suspension counter-swings the head a
      // little (the S-curve look); it stays well under the tail's swing
      expect(Math.abs(result.positions.head!.z), `head subordinate (wave ${wave})`).toBeLessThan(
        0.2,
      );
    }
  });

  it('head pan: head turns to the steered side while the tail holds', { timeout: 120_000 }, () => {
    for (const pan of [0.5, -0.5]) {
      const result = solveAt({ 'head pan': pan });
      const gripZ = result.positions.gripPanTip!.z;
      const headZ = result.positions.head!.z;
      expect(Math.abs(gripZ), `grip moved (pan ${pan})`).toBeGreaterThan(0.05);
      expect(Math.sign(headZ), `head side (pan ${pan})`).toBe(Math.sign(gripZ));
      expect(Math.abs(headZ), `head swing (pan ${pan})`).toBeGreaterThan(0.1);
      expect(Math.abs(result.positions.tailTip!.z), `tail holds (pan ${pan})`).toBeLessThan(0.06);
    }
  });

  it('jaw: rests open on the elastic, trigger closes it monotonically', { timeout: 60_000 }, () => {
    const max = jawChannelMax();
    const tipYs = [0, max / 2, max].map((v) => solveAt({ jaw: v }).positions.jawTip!.y);
    expect(tipYs[1]!).toBeGreaterThan(tipYs[0]! + 0.02);
    expect(tipYs[2]!).toBeGreaterThan(tipYs[1]! + 0.02);
    // full sweep recovers most of the 0.6 rad drop of the ~0.34 m snout
    expect(tipYs[2]! - tipYs[0]!).toBeGreaterThan(0.1);
  });

  it('slither quarter-points give four distinct S-curve states', { timeout: 120_000 }, () => {
    const clip = project.controlClips.find((c) => c.name === 'slither')!;
    const sample = (t: number): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const [name, track] of Object.entries(clip.tracks)) {
        const i = track.timesS.indexOf(t);
        expect(i, `quarter point t=${t} is a keyframe`).toBeGreaterThanOrEqual(0);
        out[name] = track.values[i]!;
      }
      return out;
    };
    const states = [0, 1, 2, 3].map((t) => {
      const result = solveAt(sample(t));
      return {
        headZ: Math.round(result.positions.head!.z * 100) / 100,
        tipZ: Math.round(result.positions.tailTip!.z * 100) / 100,
      };
    });
    const keys = states.map((s) => `${s.headZ}|${s.tipZ}`);
    expect(new Set(keys).size).toBe(4);
    // quarter-period phase shift: at t=0 the tail leads, at t=1 the head does
    expect(Math.abs(states[0]!.tipZ)).toBeGreaterThan(Math.abs(states[0]!.headZ));
    expect(Math.abs(states[1]!.headZ)).toBeGreaterThan(Math.abs(states[1]!.tipZ));
  });
});
