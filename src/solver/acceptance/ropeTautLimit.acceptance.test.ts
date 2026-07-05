// Solver-robustness regression (carried from the 2D Phase 3 review,
// DECISIONS.md): a rope loaded exactly at its taut limit used to report
// `converged === false` while still extracting the correct tension. At the
// taut boundary the settle *creeps* — each substep the load re-tautens the
// rope (projection skipped when marginally slack, applied when marginally
// taut), so the pose crawls toward equilibrium and the max particle speed
// plateaus just above SETTLE_SPEED_EPS, never quiescing within the step cap
// even though the pose and tension are already correct. A mass hanging on
// such a rope must report `converged === true` AND tension = m·g ±2%.
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../../schema';
import { solve } from '..';
import { dist3, mech, node } from './analytic';

const G = 9.81;
const MASS_KG = 5;
const L0 = 4; // long-ish arm: the overdamped near-plumb creep exceeds the step
// cap here, which is what exposed the mis-reported non-convergence.
const HY = 5; // anchor height: the L0 plumb line must clear the floor
const HX = 0.2; // drawn a touch off-plumb (with a z component too), on the L0
const HZ = 0.1; // circle (taut); it settles straight down under load.

function tautLimitPendulum(): Mechanism {
  const drawnY = HY - Math.sqrt(L0 * L0 - HX * HX - HZ * HZ); // on the taut sphere
  return mech(
    [node('H', { x: 0, y: HY, z: 0 }, 'anchor'), node('M', { x: HX, y: drawnY, z: HZ })],
    [
      {
        id: 'rope',
        type: 'rope',
        maturity: 'sketch',
        path: ['H', 'M'],
        lengthM: L0,
      },
    ],
    { pointMasses: [{ id: 'm', name: 'weight', massKg: MASS_KG, nodeId: 'M' }] },
  );
}

describe('ACCEPTANCE — rope loaded exactly at its taut limit', () => {
  it('converges (does not creep past the step cap) and reports tension = m·g ±2%', () => {
    const result = solve(tautLimitPendulum(), { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const m = result.positions.M;
    if (!m) throw new Error('solver returned no position for M');
    // settles plumb below the anchor at exactly the taut length: (0, HY − L0, 0)
    expect(dist3(m, { x: 0, y: HY - L0, z: 0 })).toBeLessThanOrEqual(1e-3);
    // rope is at its taut limit: path length == L0 under load
    expect(dist3(m, { x: 0, y: HY, z: 0 })).toBeCloseTo(L0, 3);
    const tension = result.forces.elements.rope ?? NaN;
    expect(Math.abs(tension - MASS_KG * G)).toBeLessThanOrEqual(0.02 * MASS_KG * G);
    // the pose truly satisfies the constraint (not "converged" by luck)
    expect(result.diagnostics.residual).toBeLessThanOrEqual(1e-4);
  });
});
