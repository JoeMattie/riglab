// Phase 2 acceptance (§11a): a hanging mass on a tension-only rope reports
// tension = m·g ± 2%, and a slack rope reports ~zero tension, never
// compression. Un-skipped at the start of Phase 2 (equilibrium mode +
// force extraction now implemented).
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../../schema';
import { solve } from '..';

const G = 9.81;
const MASS_KG = 5;

function hangingMassMechanism(): Mechanism {
  return {
    id: 'hanging',
    name: 'hanging mass',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes: [
      { id: 'H', kind: 'anchor', position: { x: 0, y: 1 } },
      { id: 'M', kind: 'free', position: { x: 0, y: 0.3 } },
    ],
    elements: [
      {
        id: 'rope',
        type: 'rope',
        maturity: 'sketch',
        path: ['H', 'M'],
        lengthM: 0.8,
      },
    ],
    pointMasses: [{ id: 'm', name: 'weight', massKg: MASS_KG, nodeId: 'M' }],
    skeletonBindings: [],
    anchorBindings: [],
    inputs: [],
    namedStates: [],
  };
}

describe('ACCEPTANCE Phase 2 — hanging mass on a rope', () => {
  it('settles with the rope taut and tension = m·g ±2%', () => {
    const result = solve(hangingMassMechanism(), { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const m = result.positions.M;
    if (!m) throw new Error('solver returned no position for M');
    expect(Math.hypot(m.x - 0, m.y - 0.2)).toBeLessThanOrEqual(1e-3);
    const tension = result.forces.elements.rope ?? NaN;
    expect(Math.abs(tension - MASS_KG * G)).toBeLessThanOrEqual(0.02 * MASS_KG * G);
  });

  it('reports ~zero tension (never compression) when the rope is longer than needed', () => {
    const mech = hangingMassMechanism();
    // hang the mass on a rigid link instead; the 0.8 m rope only needs 0.5 m
    mech.nodes.push({ id: 'G', kind: 'anchor', position: { x: 0, y: 1.5 } });
    mech.nodes = mech.nodes.map((n) => (n.id === 'M' ? { ...n, position: { x: 0, y: 0.5 } } : n));
    mech.elements.push({
      id: 'rod',
      type: 'link',
      maturity: 'sketch',
      nodeA: 'G',
      nodeB: 'M',
      pointMasses: [],
    });
    const result = solve(mech, { channelValues: {} }, 'equilibrium');
    const tension = result.forces.elements.rope ?? NaN;
    expect(tension).toBeGreaterThanOrEqual(-1e-6);
    expect(tension).toBeLessThan(0.5);
    expect(result.diagnostics.ropesRequiringCompression).toEqual([]);
  });
});
