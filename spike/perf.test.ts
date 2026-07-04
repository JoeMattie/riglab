// Headless solver perf probe: 100-node truss, scripted drag, 600 frames.
// Numbers are reported for DECISIONS.md; the assertion is deliberately
// generous so CI machines don't flake — the real 16 ms judgment happens on
// the recorded numbers.
import { describe, expect, it } from 'vitest';
import { PlanckAdapter } from './candidates/planck';
import { RapierAdapter } from './candidates/rapier';
import { XpbdAdapter } from './candidates/xpbd';
import { DT } from './harness/run';
import { trussScenario } from './harness/scenarios';
import type { SpikeAdapter } from './harness/types';
import { percentile } from './ui/view';

const FRAMES = 600;

async function measure(adapter: SpikeAdapter): Promise<{ p50: number; p95: number }> {
  await adapter.init(trussScenario(50));
  const times: number[] = [];
  const base = { x: 4.9, y: 0.1 };
  for (let frame = 0; frame < FRAMES; frame++) {
    const t = (frame / FRAMES) * 4 * Math.PI;
    adapter.setDragTarget('t49', {
      x: base.x - 0.8 * (1 - Math.cos(t / 2)),
      y: base.y + 1.6 * Math.sin(t),
    });
    const t0 = performance.now();
    adapter.step(DT);
    times.push(performance.now() - t0);
  }
  adapter.dispose();
  const sorted = times.slice(10).sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

describe('perf: 100-node truss drag-solve, step time only', () => {
  const candidates: Array<[string, () => SpikeAdapter]> = [
    ['custom-xpbd', () => new XpbdAdapter()],
    ['rapier2d', () => new RapierAdapter()],
    ['planck', () => new PlanckAdapter()],
  ];
  for (const [name, make] of candidates) {
    it(`${name}: p95 well under budget`, async () => {
      const { p50, p95 } = await measure(make());
      // eslint-disable-next-line no-console
      console.log(`[perf] ${name}: p50=${p50.toFixed(3)} ms p95=${p95.toFixed(3)} ms (${FRAMES} frames)`);
      expect(p95).toBeLessThan(100);
    });
  }
});
