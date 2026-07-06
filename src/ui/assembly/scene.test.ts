import { describe, expect, it } from 'vitest';
import type { PipeMaterial, Vec3 } from '../../schema';
import { computeSkeleton, FIGURE, headRadiusM, REST_POSE } from '../../wearer';
import {
  elementPolylines,
  GENERIC_PIPE_OD_M,
  MANNEQUIN_RADIUS_M,
  mannequinBalls,
  mannequinBones,
  mannequinTubes,
  mechanismPrimitives,
  mechanismSegments,
  PACK_FRAME_RADIUS_M,
  packFrameSegments,
  packFrameTubes,
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

describe('mechanismSegments + mannequinBones', () => {
  it('produces drawable segments from solved Vec3 positions', () => {
    const world: Record<string, Vec3> = {
      a: { x: 0, y: 1, z: 0 },
      b: { x: 1, y: 1, z: 0.2 },
      c: { x: 1, y: 2, z: 0.2 },
    };
    const segs = mechanismSegments(
      [
        { id: 'l1', type: 'link', nodeA: 'a', nodeB: 'b' } as never,
        { id: 'bl1', type: 'bentLink', nodeIds: ['a', 'b', 'c'] } as never,
      ],
      world,
    );
    expect(segs).toHaveLength(3);
    for (const [a, b] of segs) {
      expect(Number.isFinite(a.x) && Number.isFinite(b.z)).toBe(true);
    }
  });

  it('skips segments whose endpoints are unsolved', () => {
    const segs = mechanismSegments(
      [{ id: 'x', type: 'link', nodeA: 'a', nodeB: 'missing' } as never],
      { a: { x: 0, y: 0, z: 0 } },
    );
    expect(segs).toHaveLength(0);
  });

  it('draws the mannequin skeleton', () => {
    const bones = mannequinBones(
      computeSkeleton({ heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 }, REST_POSE),
    );
    expect(bones.length).toBeGreaterThan(8);
  });

  it('renders the mannequin as capsule tubes matching the bones', () => {
    const frame = computeSkeleton(
      { heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 },
      REST_POSE,
    );
    const tubes = mannequinTubes(frame);
    expect(tubes).toHaveLength(mannequinBones(frame).length);
    for (const t of tubes) expect(t.radiusM).toBe(MANNEQUIN_RADIUS_M);
  });

  it('draws the pack frame: a closed hip rectangle plus two shoulder rails', () => {
    const frame = computeSkeleton(
      { heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 },
      REST_POSE,
    );
    const segs = packFrameSegments(frame);
    expect(segs).toHaveLength(6);
    const A = frame.anchors;
    // the four rectangle edges chain front-L → front-R → back-R → back-L → front-L
    expect(segs.slice(0, 4)).toEqual([
      [A.hipRectFrontL, A.hipRectFrontR],
      [A.hipRectFrontR, A.hipRectBackR],
      [A.hipRectBackR, A.hipRectBackL],
      [A.hipRectBackL, A.hipRectFrontL],
    ]);
    // back rails run from the back corners up to the shoulders
    expect(segs[4]).toEqual([A.hipRectBackL, A.shoulderL]);
    expect(segs[5]).toEqual([A.hipRectBackR, A.shoulderR]);
  });

  it('renders the pack frame as tubes slimmer than the mannequin bones', () => {
    const frame = computeSkeleton(
      { heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 },
      REST_POSE,
    );
    const tubes = packFrameTubes(frame);
    expect(tubes).toHaveLength(packFrameSegments(frame).length);
    for (const t of tubes) {
      expect(t.radiusM).toBe(PACK_FRAME_RADIUS_M);
      expect(t.radiusM).toBeLessThan(MANNEQUIN_RADIUS_M);
    }
  });

  it('adds sketch-figure balls: head + 8 joints + 2 fists + 2 feet', () => {
    const wearer = { heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 };
    const frame = computeSkeleton(wearer, REST_POSE);
    const hr = headRadiusM(wearer);
    const balls = mannequinBalls(frame, hr);
    expect(balls).toHaveLength(13);
    expect(balls[0]).toEqual({ center: frame.points.head, radiusM: FIGURE.headBallR * hr });
    const at = (p: Vec3) =>
      balls.find((b) => b.center.x === p.x && b.center.y === p.y && b.center.z === p.z);
    expect(at(frame.points.kneeR)?.radiusM).toBeCloseTo(FIGURE.jointR * hr, 12);
    expect(at(frame.points.handL)?.radiusM).toBeCloseTo(FIGURE.fistR * hr, 12);
    expect(at(frame.points.shoeL)?.radiusM).toBeCloseTo(FIGURE.footHalfWid * hr, 12);
    // joint balls are fatter than the bone capsules, so they read as joints
    for (const b of balls) expect(b.radiusM).toBeGreaterThan(MANNEQUIN_RADIUS_M);
  });
});

describe('mechanismPrimitives', () => {
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
    const { tubes } = mechanismPrimitives(
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
    expect(tubes[0]).toMatchObject({
      radiusM: pvc.outerDiameterM / 2,
      style: 'engineered',
      elementId: 'l1',
    });
    expect(tubes[1]).toMatchObject({
      radiusM: GENERIC_PIPE_OD_M / 2,
      style: 'sketch',
      elementId: 'l2',
    });
  });

  it('an engineered link without a resolvable material still renders, as sketch', () => {
    const { tubes } = mechanismPrimitives(
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
    const { tubes } = mechanismPrimitives(
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

  it('ropes/elastics/bowdens become cables carrying their element id, split at unsolved nodes', () => {
    const { tubes, cables } = mechanismPrimitives(
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
    expect(cables.map((c) => c.elementId).sort()).toEqual(['bo1', 'bo1', 'e1']);
  });
});
