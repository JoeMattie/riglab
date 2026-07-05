// Phase 5 performance acceptance (§11), re-homed by the 3D conversion
// (PLANFILE-3d-conversion.md): drag-solve and clip playback stay under 16 ms
// on the examples. The heaviest per-frame path is now one global kinematic
// solve of the full-creature compound mechanism with the walk pose feeding
// skeleton/anchor binding targets — the successor of the old per-mechanism
// solve + compose loop (which measured ~1.4 ms).
import { describe, expect, it } from 'vitest';
import { solve } from '../solver';
import { anchorTargets, bindingTargets, getClip, samplePose } from '../wearer';
import { buildFullCreatureProject } from './fullCreature';

describe('compound solve stays within the frame budget', () => {
  it('solves the full-creature compound at a walk pose in <16 ms/frame', () => {
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
    // warm up (JIT) then measure
    for (let i = 0; i < 20; i++) frame(i * 0.05);
    const N = 60;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) frame(i * 0.03);
    const perFrame = (performance.now() - t0) / N;
    expect(perFrame).toBeLessThan(16);
  });
});
