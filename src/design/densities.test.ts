// Per-element linear densities for the equilibrium solve (§4.2 materials
// integration): engineered elements weigh what their assigned pipe weighs;
// everything else falls back to the generic density inside the solver.
import { describe, expect, it } from 'vitest';
import type { BentLinkElement, LinkElement, TelescopeElement } from '../schema';
import { elementLinearDensities } from './densities';
import { mech, node, testMaterials } from './testFixtures';

const materials = testMaterials(); // PA 0.5 kg/m · TO 0.5 · TI 0.3 (OD 22 mm)

const link = (id: string, pipeMaterialId?: string): LinkElement => ({
  id,
  type: 'link',
  maturity: pipeMaterialId ? 'engineered' : 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
  pipeMaterialId,
});

describe('elementLinearDensities', () => {
  it('maps engineered links and bentLinks to their material density, omits sketch ones', () => {
    const bent: BentLinkElement = {
      id: 'B1',
      type: 'bentLink',
      maturity: 'engineered',
      nodeIds: ['n1', 'n2', 'n3'],
      filletRadiiM: [0],
      pointMasses: [],
      pipeMaterialId: 'PB',
    };
    const m = mech(
      [link('L1', 'PA'), link('L2'), bent],
      [node('n1', 0, 0), node('n2', 1, 0), node('n3', 2, 0)],
    );
    const d = elementLinearDensities(m, materials);
    expect(d).toEqual({ L1: 0.5, B1: 0.8 });
  });

  it('gives a telescope the effective density that reproduces its BOM member masses', () => {
    const tele: TelescopeElement = {
      id: 'T1',
      type: 'telescope',
      maturity: 'engineered',
      nodeA: 'n1',
      nodeB: 'n2',
      lengthM: 2,
      minLengthM: 1,
      maxLengthM: 3,
      sliding: false,
      pointMasses: [],
      outerPipeMaterialId: 'TO',
      innerPipeMaterialId: 'TI',
    };
    const m = mech([tele], [node('n1', 0, 0), node('n2', 2, 0)]);
    const d = elementLinearDensities(m, materials);
    // overlap defaults to 2× inner OD = 0.044 m; members: outer 1 m × 0.5,
    // inner (1 + 0.044) m × 0.3 → total 0.8132 kg over 2 m
    expect(d.T1).toBeCloseTo((1 * 0.5 + 1.044 * 0.3) / 2, 12);
  });

  it('omits a telescope until both members are assigned', () => {
    const tele: TelescopeElement = {
      id: 'T1',
      type: 'telescope',
      maturity: 'sketch',
      nodeA: 'n1',
      nodeB: 'n2',
      lengthM: 2,
      minLengthM: 1,
      maxLengthM: 3,
      sliding: false,
      pointMasses: [],
      outerPipeMaterialId: 'TO',
    };
    const m = mech([tele], [node('n1', 0, 0), node('n2', 2, 0)]);
    expect(elementLinearDensities(m, materials)).toEqual({});
  });

  it('ignores dangling material references', () => {
    const m = mech([link('L1', 'nope')], [node('n1', 0, 0), node('n2', 1, 0)]);
    expect(elementLinearDensities(m, materials)).toEqual({});
  });
});
