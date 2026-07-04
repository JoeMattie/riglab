import { describe, expect, it } from 'vitest';
import { DEFAULT_WEARER } from '../schema';
import { CLIPS, getClip } from './clips';
import { samplePose } from './playback';
import { computeSilhouette, projectPoint } from './projection';
import { computeSkeleton, REST_POSE } from './skeleton';

describe('parametric skeleton', () => {
  it('is left/right symmetric at rest (mirrored z, equal x/y)', () => {
    const { points } = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    for (const [l, r] of [
      ['shoulderL', 'shoulderR'],
      ['handL', 'handR'],
      ['hipL', 'hipR'],
      ['kneeL', 'kneeR'],
      ['shoeL', 'shoeR'],
    ] as const) {
      expect(points[l].x).toBeCloseTo(points[r].x, 10);
      expect(points[l].y).toBeCloseTo(points[r].y, 10);
      expect(points[l].z).toBeCloseTo(-points[r].z, 10);
    }
  });

  it('stacks plausibly: shoes near ground, head near height, shoulders above hips', () => {
    const { points } = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    expect(points.shoeL.y).toBeLessThan(0.05);
    expect(points.shoeL.y).toBeGreaterThan(-0.05);
    expect(points.head.y).toBeGreaterThan(0.85 * DEFAULT_WEARER.heightM);
    expect(points.spineTop.y).toBeGreaterThan(points.pelvis.y);
    expect(points.kneeL.y).toBeLessThan(points.hipL.y);
  });

  it('anchors scale with the wearer', () => {
    const small = computeSkeleton({ heightM: 1.5, shoulderWidthM: 0.4, hipWidthM: 0.3 }, REST_POSE);
    const tall = computeSkeleton({ heightM: 2.0, shoulderWidthM: 0.5, hipWidthM: 0.4 }, REST_POSE);
    expect(tall.anchors.spineTop.y).toBeGreaterThan(small.anchors.spineTop.y);
    expect(tall.anchors.beltL.z).toBeGreaterThan(small.anchors.beltL.z);
  });

  it('hip flexion moves the knee forward; lean moves the shoulders forward', () => {
    const bent = computeSkeleton(DEFAULT_WEARER, { ...REST_POSE, hipR: 0.5, lean: 0.3 });
    const rest = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    expect(bent.points.kneeR.x).toBeGreaterThan(rest.points.kneeR.x);
    expect(bent.points.spineTop.x).toBeGreaterThan(rest.points.spineTop.x);
  });
});

describe('view projections', () => {
  const p = { x: 0.1, y: 1.2, z: 0.2 };
  it('elevation views keep world y as 2D y; top drops it', () => {
    expect(projectPoint('side-left', p)).toEqual({ x: 0.1, y: 1.2 });
    expect(projectPoint('side-right', p)).toEqual({ x: -0.1, y: 1.2 });
    expect(projectPoint('front', p)).toEqual({ x: 0.2, y: 1.2 });
    expect(projectPoint('back', p)).toEqual({ x: -0.2, y: 1.2 });
    expect(projectPoint('top', p)).toEqual({ x: 0.1, y: 0.2 });
  });

  it('silhouette provides outlines and all snappable points', () => {
    const s = computeSilhouette(DEFAULT_WEARER, REST_POSE, 'side-left');
    expect(s.outlines.length).toBeGreaterThan(5);
    expect(Object.keys(s.points)).toContain('handR');
    expect(Object.keys(s.anchors)).toContain('hipRectFrontL');
    // side view: left and right hands project to the same 2D point at rest
    expect(s.points.handL).toEqual(s.points.handR);
  });
});

describe('movement clips', () => {
  it('bundles walk, arm swing, and lean, all schema-valid', () => {
    expect(CLIPS.map((c) => c.name).sort()).toEqual(['arm swing', 'lean', 'walk']);
  });

  it('walk loops seamlessly and the legs run half a phase apart', () => {
    const walk = getClip('walk')!;
    const at = (t: number) => samplePose(walk, t);
    // seamless loop
    expect(at(0)).toEqual(at(walk.durationS));
    // left leg = right leg shifted half a cycle
    for (const t of [0, 0.15, 0.3, 0.45, 0.6, 0.9]) {
      expect(at(t).hipL).toBeCloseTo(at(t + walk.durationS / 2).hipR, 10);
    }
  });

  it('amplitude 0 collapses to the rest pose; speed rescales time', () => {
    const walk = getClip('walk')!;
    expect(samplePose(walk, 0.37, { amplitude: 0 })).toEqual(REST_POSE);
    expect(samplePose(walk, 0.6, { speed: 2 })).toEqual(samplePose(walk, 1.2));
  });
});
