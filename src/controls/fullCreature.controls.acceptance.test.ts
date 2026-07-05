// Phase 4.5 acceptance (§11): the bundled yoke drives the full creature. Uses
// the pure control-mapping + assembly-composition layers to prove: a yoke axis
// scrubs its mapped channel into solve() (invert + range); a control mounted to
// hand.R follows the hand through walk while its axes stay drivable; a control
// clip composes with the walk movement clip on one timeline; and axis lock
// freezes its channel. Widget UX is verified separately in the browser.
import { describe, expect, it } from 'vitest';
import { composeProject, resolveAttach } from '../assembly';
import { buildFullCreatureProject } from '../examples';
import { computeSkeleton, getClip, samplePose } from '../wearer';
import type { JointPose } from '../wearer/skeleton';
import { REST_POSE } from '../wearer/skeleton';
import { axisChannelValue, projectControlChannels } from './mapping';

const base = buildFullCreatureProject();

function withTwist(value: number) {
  const p = structuredClone(base);
  const yoke = p.controls.find((c) => c.id === 'ctrl-yoke')!;
  yoke.axes.find((a) => a.id === 'yoke-twist')!.value = value;
  return p;
}

describe('yoke axis → mapped channel → solve() input', () => {
  it('maps the twist axis onto the steer-pan channel range', () => {
    const yoke = base.controls[0]!;
    const twist = yoke.axes.find((a) => a.id === 'yoke-twist')!;
    expect(axisChannelValue({ ...twist, value: 1 })).toBeCloseTo(0.5, 9); // outMax
    expect(axisChannelValue({ ...twist, value: -1 })).toBeCloseTo(-0.5, 9); // outMin
  });

  it('drives the steered head through the assembly when the twist axis moves', () => {
    const neutral = composeProject(base, {
      channelValues: projectControlChannels({
        controls: base.controls,
        controlClips: base.controlClips,
      }),
    });
    const twisted = composeProject(withTwist(1), {
      channelValues: projectControlChannels({
        controls: withTwist(1).controls,
        controlClips: base.controlClips,
      }),
    });
    // the steer-mirror plan mechanism's head node swings under a pan input
    const a = neutral.instances['inst-steer']!.nodeWorld;
    const b = twisted.instances['inst-steer']!.nodeWorld;
    const moved = Object.keys(a).some((id) => {
      const p = a[id]!;
      const q = b[id]!;
      return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > 0.01;
    });
    expect(moved).toBe(true);
  });
});

describe('mounted control follows the hand through walk', () => {
  it('the yoke mount rides hand.R as the walk pose changes', () => {
    const walk = getClip('walk')!;
    const poseA: JointPose = samplePose(walk, 0.1);
    const poseB: JointPose = samplePose(walk, walk.durationS / 2 + 0.1);
    const mount = base.controls[0]!.mount!;
    const frameA = computeSkeleton(base.wearer, poseA);
    const frameB = computeSkeleton(base.wearer, poseB);
    const wa = resolveAttach(mount, {}, frameA)!;
    const wb = resolveAttach(mount, {}, frameB)!;
    // the mount point tracks handR, which moves between the two walk phases
    expect(wa).toEqual(frameA.anchors.handR);
    expect(Math.hypot(wa.x - wb.x, wa.y - wb.y)).toBeGreaterThan(0.02);
  });
});

describe('control clip composes with walk on one timeline', () => {
  it('the head-sweep clip drives steer-pan while walk drives the body', () => {
    const p = base;
    const clip = getClip('walk')!;
    const pose = samplePose(clip, 1);
    // control clip active at t=1 → steer pan at its first keyframe peak (0.5)
    const channelValues = projectControlChannels({
      controls: p.controls,
      controlClips: p.controlClips,
      controlClipName: 'head sweep + jaw snap',
      tS: 1,
      // playback with nothing held: the clip drives its channels
      heldChannels: new Set(),
    });
    expect(channelValues['steer pan']).toBeCloseTo(0.5, 6);
    // and the body still poses from walk (legs animate) — compose succeeds
    const comp = composeProject(p, { pose, channelValues });
    expect(comp.instances['inst-leg-left']).toBeDefined();
    expect(comp.instances['inst-steer']).toBeDefined();
  });

  it('a held axis overrides the clip; a locked axis still drives its channel', () => {
    const p = withTwist(-1); // live twist commands steer-pan = −0.5
    const held = projectControlChannels({
      controls: p.controls,
      controlClips: p.controlClips,
      controlClipName: 'head sweep + jaw snap',
      tS: 1, // clip alone would give +0.5
      heldChannels: new Set(['steer pan']),
    });
    expect(held['steer pan']).toBeCloseTo(-0.5, 6); // manual override wins

    const locked = structuredClone(p);
    locked.controls[0]!.axes.find((a) => a.id === 'yoke-twist')!.locked = true;
    const vals = projectControlChannels({ controls: locked.controls, controlClips: [] });
    expect(vals['steer pan']).toBeCloseTo(-0.5, 6); // locked axis still commands
  });
});

describe('rest baseline', () => {
  it('composes with no control input at the rest pose', () => {
    const comp = composeProject(base, { pose: REST_POSE });
    expect(comp.totalMassKg).toBeGreaterThan(1);
  });
});
