// Phase 3 solver-robustness regression (carried forward from the Phase 2
// review, DECISIONS.md): a rope loaded exactly at its taut limit used to report
// `converged === false` while still extracting the correct tension. At the
// taut boundary the settle *creeps* — each substep the load re-tautens the
// rope (projection skipped when marginally slack, applied when marginally
// taut), so the pose crawls toward equilibrium and the max particle speed
// plateaus just above SETTLE_SPEED_EPS, never quiescing within the step cap
// even though the pose and tension are already correct. A mass hanging on such
// a rope must report `converged === true` AND tension = m·g ±2%.
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../../schema';
import { solve } from '..';

const G = 9.81;
const MASS_KG = 5;
const L0 = 4; // long-ish arm: the overdamped near-plumb creep exceeds the step
// cap here, which is what exposed the mis-reported non-convergence.
const HX = 0.2; // drawn a touch off-plumb, on the L0 circle (taut); it settles
// straight down to hang at exactly its taut length under load.

function tautLimitPendulum(): Mechanism {
  const drawnY = 1 - Math.sqrt(L0 * L0 - HX * HX); // on the taut circle
  return {
    id: 'taut-limit',
    name: 'rope at taut limit',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes: [
      { id: 'H', kind: 'anchor', position: { x: 0, y: 1 } },
      { id: 'M', kind: 'free', position: { x: HX, y: drawnY } },
    ],
    elements: [
      {
        id: 'rope',
        type: 'rope',
        maturity: 'sketch',
        path: ['H', 'M'],
        lengthM: L0,
      },
    ],
    pointMasses: [{ id: 'm', name: 'weight', massKg: MASS_KG, nodeId: 'M' }],
    skeletonBindings: [],
    inputs: [],
    namedStates: [],
  };
}

describe('ACCEPTANCE Phase 3 — rope loaded exactly at its taut limit', () => {
  it('converges (does not creep past the step cap) and reports tension = m·g ±2%', () => {
    const result = solve(tautLimitPendulum(), { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const m = result.positions.M;
    if (!m) throw new Error('solver returned no position for M');
    // settles plumb below the anchor at exactly the taut length: (0, 1 − L0)
    expect(Math.hypot(m.x - 0, m.y - (1 - L0))).toBeLessThanOrEqual(1e-3);
    // rope is at its taut limit: path length == L0 under load
    expect(Math.hypot(m.x - 0, m.y - 1)).toBeCloseTo(L0, 3);
    const tension = result.forces.elements.rope ?? NaN;
    expect(Math.abs(tension - MASS_KG * G)).toBeLessThanOrEqual(0.02 * MASS_KG * G);
    // the pose truly satisfies the constraint (not "converged" by luck)
    expect(result.diagnostics.residual).toBeLessThanOrEqual(1e-4);
  });
});
