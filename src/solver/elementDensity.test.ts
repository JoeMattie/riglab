// Phase 3 solver plumbing: SolveInputs.elementLinearDensityKgPerM lets the BOM
// layer feed per-element (engineered) linear densities into equilibrium mass,
// falling back to the generic linkDensityKgPerM. Additive, non-breaking.
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../schema';
import { solve } from '.';

const G = 9.81;

/** A rigid link hanging a free node straight below an anchor: at rest the
 * link carries half its own self-weight at the free end, so the link tension
 * equals (L·density/2)·g — a clean analytic hook on link density. */
function hangingLink(): Mechanism {
  return {
    id: 'hl',
    name: 'hanging link',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes: [
      { id: 'A', kind: 'anchor', position: { x: 0, y: 1 } },
      { id: 'B', kind: 'free', position: { x: 0, y: 0 } },
    ],
    elements: [
      {
        id: 'link',
        type: 'link',
        maturity: 'engineered',
        nodeA: 'A',
        nodeB: 'B',
        pipeMaterialId: 'p',
        pointMasses: [],
      },
    ],
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
    namedStates: [],
  };
}

const tensionFor = (density: number, key: 'element' | 'generic'): number => {
  const inputs =
    key === 'element'
      ? { channelValues: {}, elementLinearDensityKgPerM: { link: density } }
      : { channelValues: {}, linkDensityKgPerM: density };
  const r = solve(hangingLink(), inputs, 'equilibrium');
  return Math.abs(r.forces.elements.link ?? Number.NaN);
};

describe('elementLinearDensityKgPerM (Phase 3)', () => {
  it("changes an engineered link's equilibrium tension analytically", () => {
    // L = 1 m, tension = (L·density/2)·g
    expect(tensionFor(0.4, 'element')).toBeCloseTo((0.4 / 2) * G, 1);
    expect(tensionFor(0.8, 'element')).toBeCloseTo((0.8 / 2) * G, 1);
  });

  it('falls back to the generic linkDensityKgPerM when no per-element value', () => {
    expect(tensionFor(0.4, 'generic')).toBeCloseTo((0.4 / 2) * G, 1);
  });

  it('per-element density overrides the generic default', () => {
    const r = solve(
      hangingLink(),
      { channelValues: {}, linkDensityKgPerM: 0.4, elementLinearDensityKgPerM: { link: 0.8 } },
      'equilibrium',
    );
    expect(Math.abs(r.forces.elements.link ?? Number.NaN)).toBeCloseTo((0.8 / 2) * G, 1);
  });

  it('is ignored when neither density is supplied (massless link)', () => {
    const r = solve(hangingLink(), { channelValues: {} }, 'equilibrium');
    expect(Math.abs(r.forces.elements.link ?? 0)).toBeLessThan(0.05);
  });
});
