// Shared conformance suite: every candidate adapter must pass these to clear
// the spike's hard gates (correctness vs analytic, tension-only semantics,
// bowden transfer, determinism). Perf is measured separately (perf.ts).
import { describe, expect, it } from 'vitest';
import { FOUR_BAR, crankTip, fourBarB, fourBarInitial } from './analytic';
import {
  BOWDEN_A2_START,
  BOWDEN_EXPECTED_TENSION,
  HANGING_EXPECTED_POS,
  HANGING_EXPECTED_TENSION,
  PULLEY_EXPECTED_POS,
  PULLEY_EXPECTED_TENSION,
  SLACK_EXPECTED_POS,
  bowdenScenario,
  fourBarScenario,
  hangingSlackScenario,
  hangingTautScenario,
  pulleyScenario,
} from './scenarios';
import { dragTo, settle, snapshot, stepN } from './run';
import type { SpikeAdapter, Vec2 } from './types';
import { dist } from './types';

const SWEEP_SAMPLES = 72;
const STEPS_PER_SAMPLE = 30;

function sweepFourBar(
  adapter: SpikeAdapter,
  samples: number,
  stepsPerSample: number,
  onSample?: (sampleIndex: number, expectedA: Vec2, expectedB: Vec2) => void,
): void {
  let prevB = fourBarInitial(FOUR_BAR).B;
  for (let k = 1; k <= samples; k++) {
    const theta = Math.PI / 2 + (k * 2 * Math.PI) / samples;
    const target = crankTip(FOUR_BAR, theta);
    adapter.setDragTarget('A', target);
    stepN(adapter, stepsPerSample);
    const expB = fourBarB(FOUR_BAR, theta, prevB);
    prevB = expB;
    onSample?.(k, target, expB);
  }
}

async function determinismRun(makeAdapter: () => SpikeAdapter): Promise<number[]> {
  const out: number[] = [];
  const fb = makeAdapter();
  await fb.init(fourBarScenario());
  sweepFourBar(fb, 12, 10, () => out.push(...snapshot(fb)));
  fb.dispose();
  const hang = makeAdapter();
  await hang.init(hangingTautScenario());
  stepN(hang, 400);
  out.push(...snapshot(hang));
  hang.dispose();
  return out;
}

export function conformanceSuite(adapterName: string, makeAdapter: () => SpikeAdapter): void {
  describe(`${adapterName}: conformance`, () => {
    it('(a) four-bar drag tracks the analytic solution within 1e-3 m', async () => {
      const adapter = makeAdapter();
      await adapter.init(fourBarScenario());
      let maxErr = 0;
      sweepFourBar(adapter, SWEEP_SAMPLES, STEPS_PER_SAMPLE, (_k, expA, expB) => {
        const pos = adapter.positions();
        if (!pos.A || !pos.B) throw new Error('missing node positions');
        maxErr = Math.max(maxErr, dist(pos.A, expA), dist(pos.B, expB));
      });
      adapter.dispose();
      expect(maxErr).toBeLessThanOrEqual(1e-3);
    });

    it('(b1) hanging mass: rope catches it and tension = m·g ±2%', async () => {
      const adapter = makeAdapter();
      await adapter.init(hangingTautScenario());
      const result = settle(adapter);
      expect(result.converged).toBe(true);
      const m = adapter.positions().M;
      if (!m) throw new Error('missing node M');
      expect(dist(m, HANGING_EXPECTED_POS)).toBeLessThanOrEqual(1e-3);
      const tension = adapter.forces().rope ?? NaN;
      expect(Math.abs(tension - HANGING_EXPECTED_TENSION)).toBeLessThanOrEqual(
        0.02 * HANGING_EXPECTED_TENSION,
      );
      adapter.dispose();
    });

    it('(b2) slack rope reports ~zero tension, never compression', async () => {
      const adapter = makeAdapter();
      await adapter.init(hangingSlackScenario());
      const result = settle(adapter);
      expect(result.converged).toBe(true);
      const m = adapter.positions().M;
      if (!m) throw new Error('missing node M');
      expect(dist(m, SLACK_EXPECTED_POS)).toBeLessThanOrEqual(1e-3);
      const tension = adapter.forces().rope ?? NaN;
      expect(tension).toBeGreaterThanOrEqual(-1e-6);
      expect(tension).toBeLessThan(0.5);
      adapter.dispose();
    });

    it('(c) rope through an eyelet settles at the analytic pose and tension ±2%', async () => {
      const adapter = makeAdapter();
      await adapter.init(pulleyScenario());
      const result = settle(adapter);
      expect(result.converged).toBe(true);
      const m = adapter.positions().M;
      if (!m) throw new Error('missing node M');
      expect(dist(m, PULLEY_EXPECTED_POS)).toBeLessThanOrEqual(2e-3);
      const tension = adapter.forces().rope ?? NaN;
      expect(Math.abs(tension - PULLEY_EXPECTED_TENSION)).toBeLessThanOrEqual(
        0.02 * PULLEY_EXPECTED_TENSION,
      );
      adapter.dispose();
    });

    it('(d) bowden transfers displacement 1:1 while taut, tension = m·g ±2%', async () => {
      const adapter = makeAdapter();
      await adapter.init(bowdenScenario());
      adapter.setDragTarget('A2', BOWDEN_A2_START);
      settle(adapter);

      const check = (expectedB2y: number) => {
        const b2 = adapter.positions().B2;
        if (!b2) throw new Error('missing node B2');
        expect(Math.abs(b2.x - 2)).toBeLessThanOrEqual(1e-3);
        expect(Math.abs(b2.y - expectedB2y)).toBeLessThanOrEqual(1e-3);
        const tension = adapter.forces().cable ?? NaN;
        expect(Math.abs(tension - BOWDEN_EXPECTED_TENSION)).toBeLessThanOrEqual(
          0.02 * BOWDEN_EXPECTED_TENSION,
        );
      };
      check(0.1);

      // Shorten the A gap by 0.1 → B gap grows 0.1 → the hanging mass drops 0.1.
      dragTo(adapter, 'A2', BOWDEN_A2_START, { x: 0.2, y: 0.5 }, 60);
      settle(adapter);
      check(0.0);

      // Lengthen the A gap to 0.35 → B gap must shrink to 0.35 → mass pulled up.
      dragTo(adapter, 'A2', { x: 0.2, y: 0.5 }, { x: 0.35, y: 0.5 }, 60);
      settle(adapter);
      check(0.15);

      adapter.dispose();
    });

    it('(det) two fresh runs of an identical script produce identical positions', async () => {
      const run1 = await determinismRun(makeAdapter);
      const run2 = await determinismRun(makeAdapter);
      expect(run2.length).toBe(run1.length);
      let maxDiff = 0;
      for (let i = 0; i < run1.length; i++) {
        maxDiff = Math.max(maxDiff, Math.abs((run1[i] ?? NaN) - (run2[i] ?? NaN)));
      }
      expect(maxDiff).toBeLessThanOrEqual(1e-12);
    });
  });
}
