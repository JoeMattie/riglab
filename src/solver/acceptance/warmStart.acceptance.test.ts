// Warm-start + substep-budget acceptance (PLANFILE-forces-playback-perf):
// seeding an equilibrium solve from a previous settled result must not change
// what it converges to, must make it converge within a small per-frame budget
// (the property the playback readout relies on), and an under-budgeted solve
// must report converged:false honestly instead of throwing or lying.
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../../schema';
import { solve } from '..';
import { dist3, hinge, link, mech, node } from './analytic';

const G = 9.81;
const MASS_KG = 5;

/** Playback budget order-of-magnitude (PLANFILE-forces-playback-perf): tiny
 * next to MAX_STEPS=6000 — converging inside it is what makes the per-frame
 * readout affordable. */
const SMALL_BUDGET = 150;

/** Mass hanging on a slack-drawn rope: the cold settle has to drop the mass
 * ~0.1 m and pull the rope taut (same fixture as hangingMass acceptance). */
function hangingMassMechanism(): Mechanism {
  return mech(
    [node('H', { x: 0.3, y: 1, z: 0.4 }, 'anchor'), node('M', { x: 0.3, y: 0.3, z: 0.4 })],
    [{ id: 'rope', type: 'rope', maturity: 'sketch', path: ['H', 'M'], lengthM: 0.8 }],
    { pointMasses: [{ id: 'm', name: 'weight', massKg: MASS_KG, nodeId: 'M' }] },
  );
}

/** Rigid pendulum drawn horizontal on a z-axis hinge at an anchor: the cold
 * settle swings it plumb — exercises the hinge virtual-axis machinery under
 * seeding. */
function pendulumMechanism(): Mechanism {
  return mech(
    [node('P', { x: 0, y: 1, z: 0 }, 'anchor'), node('M', { x: 0.5, y: 1, z: 0 })],
    [link('arm', 'P', 'M'), hinge('pv', 'P', ['arm'], { x: 0, y: 0, z: 1 })],
    { pointMasses: [{ id: 'm', name: 'bob', massKg: 3, nodeId: 'M' }] },
  );
}

describe('ACCEPTANCE equilibrium warm-start + substep budget', () => {
  it('seeding with its own settled output reproduces the cold result within a small budget (rope)', () => {
    const m = hangingMassMechanism();
    const cold = solve(m, { channelValues: {} }, 'equilibrium');
    expect(cold.diagnostics.converged).toBe(true);
    const warm = solve(
      m,
      { channelValues: {}, seedPositions: cold.positions, maxSubsteps: SMALL_BUDGET },
      'equilibrium',
    );
    expect(warm.diagnostics.converged).toBe(true);
    expect(dist3(warm.positions.M!, cold.positions.M!)).toBeLessThanOrEqual(1e-3);
    const coldT = cold.forces.elements.rope ?? NaN;
    const warmT = warm.forces.elements.rope ?? NaN;
    expect(Math.abs(warmT - coldT)).toBeLessThanOrEqual(0.02 * MASS_KG * G);
  });

  it('seeding with its own settled output reproduces the cold result within a small budget (hinge)', () => {
    const m = pendulumMechanism();
    const cold = solve(m, { channelValues: {} }, 'equilibrium');
    expect(cold.diagnostics.converged).toBe(true);
    // sanity: pendulum settled plumb below the hinge
    expect(dist3(cold.positions.M!, { x: 0, y: 0.5, z: 0 })).toBeLessThanOrEqual(2e-3);
    const warm = solve(
      m,
      { channelValues: {}, seedPositions: cold.positions, maxSubsteps: SMALL_BUDGET },
      'equilibrium',
    );
    expect(warm.diagnostics.converged).toBe(true);
    expect(dist3(warm.positions.M!, cold.positions.M!)).toBeLessThanOrEqual(1e-3);
  });

  it('seeded solves are deterministic: same inputs ⇒ identical output', () => {
    const m = pendulumMechanism();
    const seed = solve(m, { channelValues: {} }, 'equilibrium').positions;
    const inputs = { channelValues: {}, seedPositions: seed, maxSubsteps: SMALL_BUDGET };
    const a = solve(m, inputs, 'equilibrium');
    const b = solve(m, inputs, 'equilibrium');
    expect(b).toEqual(a);
  });

  it('an under-budgeted cold solve reports converged:false with a usable partial pose', () => {
    const partial = solve(
      pendulumMechanism(),
      { channelValues: {}, maxSubsteps: 1 },
      'equilibrium',
    );
    expect(partial.diagnostics.converged).toBe(false);
    // the partial pose is still constraint-projected plain data, not a throw
    expect(partial.positions.M).toBeTruthy();
    expect(dist3(partial.positions.P!, { x: 0, y: 1, z: 0 })).toBeLessThanOrEqual(1e-9);
  });

  it('seed entries for held nodes and unknown ids are ignored', () => {
    const m = pendulumMechanism();
    const cold = solve(m, { channelValues: {} }, 'equilibrium');
    const noisy = solve(
      m,
      {
        channelValues: {},
        seedPositions: { P: { x: 9, y: 9, z: 9 }, ghost: { x: 1, y: 2, z: 3 } },
      },
      'equilibrium',
    );
    expect(noisy).toEqual(cold);
  });
});
