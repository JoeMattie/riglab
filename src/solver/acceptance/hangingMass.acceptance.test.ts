// 2D-parity acceptance: a hanging mass on a tension-only rope reports
// tension = m·g ± 2%, and a slack rope reports ~zero tension, never
// compression — now with the rig placed off both world axes so all three
// coordinates are exercised.
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../../schema';
import { solve } from '..';
import { dist3, link, mech, node } from './analytic';

const G = 9.81;
const MASS_KG = 5;

function hangingMassMechanism(): Mechanism {
  return mech(
    [node('H', { x: 0.3, y: 1, z: 0.4 }, 'anchor'), node('M', { x: 0.3, y: 0.3, z: 0.4 })],
    [
      {
        id: 'rope',
        type: 'rope',
        maturity: 'sketch',
        path: ['H', 'M'],
        lengthM: 0.8,
      },
    ],
    { pointMasses: [{ id: 'm', name: 'weight', massKg: MASS_KG, nodeId: 'M' }] },
  );
}

describe('ACCEPTANCE 3D parity — hanging mass on a rope', () => {
  it('settles with the rope taut, plumb below the anchor, tension = m·g ±2%', () => {
    const result = solve(hangingMassMechanism(), { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const m = result.positions.M;
    if (!m) throw new Error('solver returned no position for M');
    expect(dist3(m, { x: 0.3, y: 0.2, z: 0.4 })).toBeLessThanOrEqual(1e-3);
    const tension = result.forces.elements.rope ?? NaN;
    expect(Math.abs(tension - MASS_KG * G)).toBeLessThanOrEqual(0.02 * MASS_KG * G);
  });

  it('reports ~zero tension (never compression) when the rope is longer than needed', () => {
    const m = hangingMassMechanism();
    // hang the mass on a rigid link instead; the 0.8 m rope only needs 0.5 m
    m.nodes.push(node('G', { x: 0.3, y: 1.5, z: 0.4 }, 'anchor'));
    m.nodes = m.nodes.map((n) =>
      n.id === 'M' ? { ...n, position: { x: 0.3, y: 0.5, z: 0.4 } } : n,
    );
    m.elements.push(link('rod', 'G', 'M'));
    const result = solve(m, { channelValues: {} }, 'equilibrium');
    const tension = result.forces.elements.rope ?? NaN;
    expect(tension).toBeGreaterThanOrEqual(-1e-6);
    expect(tension).toBeLessThan(0.5);
    expect(result.diagnostics.ropesRequiringCompression).toEqual([]);
  });
});
