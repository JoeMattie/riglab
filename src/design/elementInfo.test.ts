// Derived-info helpers for the info panel (§8.2a).
import { describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../bom/testHelpers';
import type {
  BentLinkElement,
  LinkElement,
  PivotElement,
  RopeElement,
  TelescopeElement,
} from '../schema';
import {
  boundChannelNames,
  connectedElements,
  elementGeometry,
  elementMassKg,
  elementNodeIds,
} from './elementInfo';

const materials = testMaterials();

const link = (id: string, a: string, b: string, over: Partial<LinkElement> = {}): LinkElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA: a,
  nodeB: b,
  pointMasses: [],
  ...over,
});

describe('elementGeometry', () => {
  it('link length is the node-to-node distance, with endpoints reported', () => {
    const m = mech([link('L1', 'n1', 'n2')], [node('n1', 0, 0), node('n2', 3, 4)]);
    const g = elementGeometry(m.elements[0]!, m);
    expect(g.lengthM).toBeCloseTo(5, 9);
    expect(g.points).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ]);
  });

  it('bentLink reports developed length and vertex deflection angles', () => {
    const bl: BentLinkElement = {
      id: 'B1',
      type: 'bentLink',
      maturity: 'sketch',
      nodeIds: ['n1', 'n2', 'n3'],
      filletRadiiM: [0],
      pointMasses: [],
    };
    const m = mech([bl], [node('n1', 0, 0), node('n2', 1, 0), node('n3', 1, 1)]);
    const g = elementGeometry(bl, m);
    expect(g.developedLengthM).toBeCloseTo(2, 9);
    expect(g.vertexAnglesRad).toHaveLength(1);
    expect(g.vertexAnglesRad![0]).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('elementMassKg', () => {
  it('link mass = length × density once a material is assigned', () => {
    const m = mech(
      [link('L1', 'n1', 'n2', { pipeMaterialId: 'PA' })], // PA: 0.5 kg/m
      [node('n1', 0, 0), node('n2', 2, 0)],
    );
    expect(elementMassKg(m.elements[0]!, m, materials)).toBeCloseTo(1.0, 9);
    const bare = mech([link('L2', 'n1', 'n2')], [node('n1', 0, 0), node('n2', 2, 0)]);
    expect(elementMassKg(bare.elements[0]!, bare, materials)).toBeUndefined();
  });

  it('telescope overlap counts both members (matches the BOM member split)', () => {
    const t: TelescopeElement = {
      id: 'T1',
      type: 'telescope',
      maturity: 'sketch',
      nodeA: 'n1',
      nodeB: 'n2',
      minLengthM: 0.5,
      maxLengthM: 3,
      lengthM: 2,
      sliding: false,
      outerPipeMaterialId: 'TO', // 0.5 kg/m
      innerPipeMaterialId: 'TI', // 0.3 kg/m, OD 22 mm → default overlap 44 mm
      pointMasses: [],
    };
    const m = mech([t], [node('n1', 0, 0), node('n2', 2, 0)]);
    // outer 1 m × 0.5 + inner (1 + 0.044) m × 0.3
    expect(elementMassKg(t, m, materials)).toBeCloseTo(0.5 + 1.044 * 0.3, 9);
  });
});

describe('connections + channel bindings', () => {
  it('lists elements sharing a node, via the shared node', () => {
    const p: PivotElement = {
      id: 'P1',
      type: 'pivot',
      maturity: 'sketch',
      nodeId: 'n2',
      memberIds: ['L1', 'L2'],
      welds: [],
    };
    const m = mech(
      [link('L1', 'n1', 'n2'), link('L2', 'n2', 'n3'), p],
      [node('n1', 0, 0), node('n2', 1, 0), node('n3', 2, 0)],
    );
    const conns = connectedElements(m.elements[0]!, m);
    expect(conns).toEqual([
      { elementId: 'L2', type: 'link', nodeId: 'n2' },
      { elementId: 'P1', type: 'pivot', nodeId: 'n2' },
    ]);
  });

  it('reports channels bound to the element nodes; rope path nodes count', () => {
    const r: RopeElement = {
      id: 'R1',
      type: 'rope',
      maturity: 'sketch',
      path: ['n1', 'n2'],
      lengthM: 1,
    };
    const m = mech(
      [r],
      [{ ...node('n1', 0, 0), kind: 'driven' as const, channelId: 'ch1' }, node('n2', 1, 0)],
      {
        inputs: [
          {
            id: 'ch1',
            name: 'jaw',
            kind: 'displacement' as const,
            min: 0,
            max: 1,
            value: 0,
            locked: false,
          },
        ],
      },
    );
    expect(boundChannelNames(r, m)).toEqual(['jaw']);
    expect(elementNodeIds(r, m)).toEqual(['n1', 'n2']);
  });
});
