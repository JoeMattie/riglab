import { describe, expect, it } from 'vitest';
import { composeProject } from '../../assembly';
import { buildFullCreatureProject } from '../../examples';
import type { PipeMaterial } from '../../schema';
import { computeSkeleton, REST_POSE } from '../../wearer';
import {
  elementPolylines,
  GENERIC_PIPE_OD_M,
  instancePrimitives,
  instanceSegments,
  MANNEQUIN_RADIUS_M,
  mannequinBones,
  mannequinTubes,
} from './scene';

describe('elementPolylines', () => {
  it('strokes link/telescope/elastic end-to-end, bentLink through its path', () => {
    expect(elementPolylines({ type: 'link', nodeA: 'a', nodeB: 'b' } as never)).toEqual([
      ['a', 'b'],
    ]);
    expect(elementPolylines({ type: 'bentLink', nodeIds: ['a', 'b', 'c'] } as never)).toEqual([
      ['a', 'b', 'c'],
    ]);
    expect(elementPolylines({ type: 'rope', path: ['a', 'b', 'c'] } as never)).toEqual([
      ['a', 'b', 'c'],
    ]);
  });

  it('draws both bowden cable runs and nothing for pivots', () => {
    expect(
      elementPolylines({ type: 'bowden', a1: 'a', a2: 'b', b1: 'c', b2: 'd' } as never),
    ).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(elementPolylines({ type: 'pivot', nodeId: 'n' } as never)).toEqual([]);
  });
});

describe('instanceSegments + mannequinBones on the full creature', () => {
  const project = buildFullCreatureProject();

  it('produces drawable segments for every instanced mechanism', () => {
    const c = composeProject(project);
    const mechById = new Map(project.mechanisms.map((m) => [m.id, m]));
    for (const inst of project.assembly.instances) {
      const composed = c.instances[inst.id]!;
      const segs = instanceSegments(mechById.get(inst.mechanismId)!.elements, composed.nodeWorld);
      expect(segs.length).toBeGreaterThan(0);
      for (const [a, b] of segs) {
        expect(Number.isFinite(a.x) && Number.isFinite(b.z)).toBe(true);
      }
    }
  });

  it('skips segments whose endpoints are unsolved', () => {
    const segs = instanceSegments(
      [{ id: 'x', type: 'link', nodeA: 'a', nodeB: 'missing' } as never],
      { a: { x: 0, y: 0, z: 0 } },
    );
    expect(segs).toHaveLength(0);
  });

  it('draws the mannequin skeleton', () => {
    const bones = mannequinBones(computeSkeleton(project.wearer, REST_POSE));
    expect(bones.length).toBeGreaterThan(8);
  });

  it('renders the mannequin as capsule tubes matching the bones', () => {
    const frame = computeSkeleton(project.wearer, REST_POSE);
    const tubes = mannequinTubes(frame);
    expect(tubes).toHaveLength(mannequinBones(frame).length);
    for (const t of tubes) expect(t.radiusM).toBe(MANNEQUIN_RADIUS_M);
  });
});

describe('instancePrimitives', () => {
  const pvc: PipeMaterial = {
    id: 'pvc34',
    name: 'PVC 3/4"',
    sizingSystem: 'NPS',
    nominalSize: '3/4',
    outerDiameterM: 0.0267,
    innerDiameterM: 0.0205,
    linearDensityKgPerM: 0.32,
    approximate: false,
  };
  const world = {
    a: { x: 0, y: 0, z: 0 },
    b: { x: 1, y: 0, z: 0 },
    c: { x: 1, y: 1, z: 0 },
  };

  it('engineered links get true-OD tubes; sketch links get generic-OD tubes', () => {
    const { tubes } = instancePrimitives(
      [
        {
          id: 'l1',
          type: 'link',
          maturity: 'engineered',
          nodeA: 'a',
          nodeB: 'b',
          pipeMaterialId: 'pvc34',
          pointMasses: [],
        } as never,
        {
          id: 'l2',
          type: 'link',
          maturity: 'sketch',
          nodeA: 'b',
          nodeB: 'c',
          pointMasses: [],
        } as never,
      ],
      world,
      [pvc],
    );
    expect(tubes).toHaveLength(2);
    expect(tubes[0]).toMatchObject({ radiusM: pvc.outerDiameterM / 2, style: 'engineered' });
    expect(tubes[1]).toMatchObject({ radiusM: GENERIC_PIPE_OD_M / 2, style: 'sketch' });
  });

  it('an engineered link without a resolvable material still renders, as sketch', () => {
    const { tubes } = instancePrimitives(
      [
        {
          id: 'l1',
          type: 'link',
          maturity: 'engineered',
          nodeA: 'a',
          nodeB: 'b',
          pipeMaterialId: 'missing',
          pointMasses: [],
        } as never,
      ],
      world,
      [pvc],
    );
    expect(tubes[0]!.style).toBe('sketch');
  });

  it('telescopes use the outer pipe OD; bentLinks tube every segment', () => {
    const { tubes } = instancePrimitives(
      [
        {
          id: 't1',
          type: 'telescope',
          maturity: 'engineered',
          nodeA: 'a',
          nodeB: 'b',
          minLengthM: 0.5,
          maxLengthM: 1.5,
          lengthM: 1,
          sliding: false,
          outerPipeMaterialId: 'pvc34',
          pointMasses: [],
        } as never,
        {
          id: 'bl1',
          type: 'bentLink',
          maturity: 'sketch',
          nodeIds: ['a', 'b', 'c'],
          filletRadiiM: [0.05],
          pointMasses: [],
        } as never,
      ],
      world,
      [pvc],
    );
    expect(tubes).toHaveLength(3); // telescope + two bentLink segments
    expect(tubes[0]).toMatchObject({ radiusM: pvc.outerDiameterM / 2, style: 'engineered' });
  });

  it('ropes/elastics/bowdens become cables, split at unsolved nodes', () => {
    const { tubes, cables } = instancePrimitives(
      [
        {
          id: 'r1',
          type: 'rope',
          maturity: 'sketch',
          path: ['a', 'missing', 'c'],
          lengthM: 2,
        } as never,
        {
          id: 'e1',
          type: 'elastic',
          maturity: 'sketch',
          nodeA: 'a',
          nodeB: 'b',
          restLengthM: 1,
          stiffnessNPerM: 100,
          tensionOnly: true,
        } as never,
        {
          id: 'bo1',
          type: 'bowden',
          maturity: 'sketch',
          a1: 'a',
          a2: 'b',
          b1: 'b',
          b2: 'c',
          restLengthAM: 1,
          restLengthBM: 1,
        } as never,
      ],
      world,
      [],
    );
    expect(tubes).toHaveLength(0);
    // rope contributes nothing (no two consecutive solved points survive the
    // missing waypoint as single-point runs are dropped); elastic 1; bowden 2
    expect(cables).toHaveLength(3);
    for (const c of cables) expect(c.points.length).toBeGreaterThanOrEqual(2);
  });
});
