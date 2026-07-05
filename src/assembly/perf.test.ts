// Phase 5 performance acceptance (§11): drag-solve and clip playback stay under
// 16 ms on the examples. The full-creature assembly (eight mechanisms) is the
// heaviest per-frame path — solve each + compose to world. Measured ~1.4 ms
// locally; the 16 ms bound leaves ~10× headroom so this is stable across CI.
import { describe, expect, it } from 'vitest';
import { buildFullCreatureProject } from '../examples';
import { getClip, samplePose } from '../wearer';
import { composeProject } from './orchestrate';

describe('assembly compose stays within the frame budget', () => {
  it('composes the full-creature assembly at a walk pose in <16 ms/frame', () => {
    const project = buildFullCreatureProject();
    const walk = getClip('walk')!;
    // warm up (JIT) then measure
    for (let i = 0; i < 20; i++) composeProject(project, { pose: samplePose(walk, i * 0.05) });
    const N = 60;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) composeProject(project, { pose: samplePose(walk, i * 0.03) });
    const perFrame = (performance.now() - t0) / N;
    expect(perFrame).toBeLessThan(16);
  });
});
