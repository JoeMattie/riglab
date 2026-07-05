import { describe, expect, it } from 'vitest';
import { orientationFrame } from '../geometry/placement';
import { DEFAULT_WEARER, type Mechanism } from '../schema';
import { anchorTargets, bindingTargets } from './bindings';
import { CLIPS, getClip } from './clips';
import { samplePose } from './playback';
import { computeSilhouette, FIGURE, projectPoint, projectSilhouette } from './projection';
import { computeSkeleton, headRadiusM, REST_POSE } from './skeleton';

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

describe('panel projections', () => {
  const p = { x: 0.1, y: 1.2, z: 0.2 };
  it('projects along the panel basis axes (ortho frames from placement)', () => {
    expect(projectPoint(orientationFrame('side-left'), p)).toEqual({ x: 0.1, y: 1.2 });
    expect(projectPoint(orientationFrame('side-right'), p)).toEqual({ x: -0.1, y: 1.2 });
    expect(projectPoint(orientationFrame('front'), p)).toEqual({ x: -0.2, y: 1.2 });
    expect(projectPoint(orientationFrame('back'), p)).toEqual({ x: 0.2, y: 1.2 });
    expect(projectPoint(orientationFrame('top'), p)).toEqual({ x: 0.1, y: 0.2 });
  });

  it('accepts an arbitrary (non-axis-aligned) plane basis', () => {
    const s = Math.SQRT1_2;
    const basis = { xAxis: { x: s, y: 0, z: s }, yAxis: { x: 0, y: 1, z: 0 } };
    const q = projectPoint(basis, p);
    expect(q.x).toBeCloseTo(s * (p.x + p.z), 12);
    expect(q.y).toBeCloseTo(1.2, 12);
  });

  it('silhouette provides outlines and all snappable points', () => {
    const s = computeSilhouette(DEFAULT_WEARER, REST_POSE, orientationFrame('side-left'));
    expect(s.outlines.length).toBeGreaterThan(5);
    expect(Object.keys(s.points)).toContain('handR');
    expect(Object.keys(s.anchors)).toContain('hipRectFrontL');
    // side panel: left and right hands project to the same 2D point at rest
    expect(s.points.handL).toEqual(s.points.handR);
  });

  it('computeSilhouette matches projecting a precomputed frame', () => {
    const frame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    const basis = orientationFrame('front');
    expect(projectSilhouette(frame, headRadiusM(DEFAULT_WEARER), basis)).toEqual(
      computeSilhouette(DEFAULT_WEARER, REST_POSE, basis),
    );
  });

  it('draws the sketch figure: egg head, 8 joint rings, 2 fists, 2 foot ovals', () => {
    const hr = headRadiusM(DEFAULT_WEARER);
    const s = computeSilhouette(DEFAULT_WEARER, REST_POSE, orientationFrame('front'));
    expect(s.loops).toHaveLength(13);

    // head loop is centered on the head point and narrower than tall
    const head = s.loops[0]!;
    const xs = head.map((p) => p.x);
    const ys = head.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(height).toBeCloseTo(2 * hr, 6);
    expect(width).toBeCloseTo(2 * FIGURE.headRx * hr, 6);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(s.points.head.x, 6);

    // some loop rings each articulated joint (front view: none degenerate)
    for (const joint of ['shoulderL', 'elbowR', 'hipL', 'kneeR', 'handL', 'shoeR'] as const) {
      const c = s.points[joint];
      const ringed = s.loops.some((loop) =>
        loop.every((p) => {
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          return d > 0.05 * hr && d < 1.1 * hr;
        }),
      );
      expect(ringed, `${joint} has a ring/blob`).toBe(true);
    }
  });

  it('bone strokes stop at the joint rings instead of running through them', () => {
    const hr = headRadiusM(DEFAULT_WEARER);
    const s = computeSilhouette(DEFAULT_WEARER, REST_POSE, orientationFrame('front'));
    const rJoint = FIGURE.jointR * hr;
    // the upper-arm stroke exists with both endpoints pulled back by the
    // joint radius along the shoulder→elbow line
    const a = s.points.shoulderL;
    const b = s.points.elbowL;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const upperArm = s.outlines.find(
      (o) =>
        o.length === 2 &&
        Math.abs(o[0]!.x - (a.x + u.x * rJoint)) < 1e-9 &&
        Math.abs(o[0]!.y - (a.y + u.y * rJoint)) < 1e-9 &&
        Math.abs(o[1]!.x - (b.x - u.x * rJoint)) < 1e-9 &&
        Math.abs(o[1]!.y - (b.y - u.y * rJoint)) < 1e-9,
    );
    expect(upperArm).toBeDefined();
    // no outline endpoint sits at a ringed joint center anymore
    for (const o of s.outlines)
      for (const p of [o[0]!, o[o.length - 1]!])
        expect(Math.hypot(p.x - b.x, p.y - b.y)).toBeGreaterThan(0.9 * rJoint);
  });

  it('drops bones that are edge-on in the panel (shoulder bar in side view)', () => {
    const front = computeSilhouette(DEFAULT_WEARER, REST_POSE, orientationFrame('front'));
    const side = computeSilhouette(DEFAULT_WEARER, REST_POSE, orientationFrame('side-left'));
    // side view: the shoulder/hip bars project to a point shorter than their
    // trims, so the side panel carries fewer strokes than the front panel
    expect(side.outlines.length).toBeLessThan(front.outlines.length);
    expect(side.loops.length).toBe(13);
  });
});

describe('binding targets are direct 3D wearer points', () => {
  const mech: Mechanism = {
    id: 'm',
    name: 'm',
    nodes: [
      { id: 'n1', kind: 'free', position: { x: 0, y: 0, z: 0 } },
      { id: 'n2', kind: 'anchor', position: { x: 0, y: 1, z: 0 } },
    ],
    elements: [],
    pointMasses: [],
    skeletonBindings: [{ id: 'sb', point: 'handR', nodeId: 'n1' }],
    anchorBindings: [{ id: 'ab', anchor: 'beltR', nodeId: 'n2' }],
    inputs: [],
    namedStates: [],
  };

  it('skeleton bindings resolve to the 3D skeleton point (soft drag target)', () => {
    const frame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    expect(bindingTargets(mech, DEFAULT_WEARER, REST_POSE)).toEqual({
      n1: frame.points.handR,
    });
  });

  it('anchor bindings resolve to the 3D wearer anchor (prescribed ground)', () => {
    const frame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
    expect(anchorTargets(mech, DEFAULT_WEARER, REST_POSE)).toEqual({
      n2: frame.anchors.beltR,
    });
  });

  it('targets move with the pose (they ride the skeleton, not the document)', () => {
    const walk = getClip('walk')!;
    const a = bindingTargets(mech, DEFAULT_WEARER, samplePose(walk, 0.1));
    const b = bindingTargets(mech, DEFAULT_WEARER, samplePose(walk, walk.durationS / 2 + 0.1));
    const d = Math.hypot(a.n1!.x - b.n1!.x, a.n1!.y - b.n1!.y, a.n1!.z - b.n1!.z);
    expect(d).toBeGreaterThan(0.02);
  });

  it('mechanisms without bindings resolve to empty target maps', () => {
    const bare = { ...mech, skeletonBindings: [], anchorBindings: [] };
    expect(bindingTargets(bare, DEFAULT_WEARER, REST_POSE)).toEqual({});
    expect(anchorTargets(bare, DEFAULT_WEARER, REST_POSE)).toEqual({});
  });
});

describe('movement clips', () => {
  it('bundles the full §7.2 clip library, all schema-valid', () => {
    expect(CLIPS.map((c) => c.name).sort()).toEqual([
      'arm swing',
      'crouch',
      'dance',
      'idle sway',
      'lean',
      'sit down / stand up',
      'walk',
    ]);
  });

  it('sit and crouch lower the pelvis at mid-clip and return to rest', () => {
    for (const name of ['sit down / stand up', 'crouch']) {
      const clip = getClip(name)!;
      const mid = samplePose(clip, clip.durationS / 2);
      expect(mid.pelvisRise).toBeLessThan(-0.3);
      expect(mid.kneeL).toBeGreaterThan(1);
      expect(mid.kneeL).toBeCloseTo(mid.kneeR, 10); // symmetric pose
      expect(samplePose(clip, 0)).toEqual(samplePose(clip, clip.durationS)); // seamless
    }
  });

  it('idle sway stays subtle (never leaves the near-rest envelope)', () => {
    const sway = getClip('idle sway')!;
    for (let t = 0; t <= sway.durationS; t += 0.25) {
      const p = samplePose(sway, t);
      for (const key of ['hipL', 'hipR', 'kneeL', 'kneeR', 'lean'] as const) {
        expect(Math.abs(p[key])).toBeLessThan(0.15);
      }
      expect(Math.abs(p.pelvisRise)).toBeLessThan(0.02);
    }
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
