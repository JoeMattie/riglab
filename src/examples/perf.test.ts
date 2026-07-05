// Phase 5 performance acceptance (§11), re-homed by the 3D conversion
// (PLANFILE-3d-conversion.md): drag-solve and clip playback stay under 16 ms
// on the examples. The heaviest per-frame path is now one global kinematic
// solve of the full-creature compound mechanism with the walk pose feeding
// skeleton/anchor binding targets — the successor of the old per-mechanism
// solve + compose loop. The assertion uses the MEDIAN of 60 frames: a robust
// per-frame statistic that a GC pause or a parallel test worker cannot flip.
import { describe, expect, it } from 'vitest';
import { solve } from '../solver';
import { anchorTargets, bindingTargets, getClip, samplePose } from '../wearer';
import { buildFullCreatureProject } from './fullCreature';

describe('compound solve stays within the frame budget', () => {
  it('solves the full-creature compound at a walk pose in <16 ms/frame (median)', () => {
    const project = buildFullCreatureProject();
    const mechanism = project.mechanism;
    const walk = getClip('walk');
    expect(walk).toBeTruthy();
    const frame = (t: number) => {
      const pose = samplePose(walk!, t);
      const inputs = {
        channelValues: Object.fromEntries(mechanism.inputs.map((c) => [c.name, c.value])),
        dragTargets: bindingTargets(mechanism, project.wearer, pose),
        groundTargets: anchorTargets(mechanism, project.wearer, pose),
      };
      return solve(mechanism, inputs, 'kinematic');
    };
    // warm up (JIT) then measure per-frame
    for (let i = 0; i < 20; i++) frame(i * 0.05);
    const N = 60;
    const times: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      frame(i * 0.03);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[N / 2]!;
    expect(
      median,
      `median frame time ${median.toFixed(2)} ms (min ${times[0]!.toFixed(2)}, max ${times[N - 1]!.toFixed(2)})`,
    ).toBeLessThan(16);
  });
});
