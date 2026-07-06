// Group body-drag target math (PLANFILE-multiselect-drag-constraints).
import { describe, expect, it } from 'vitest';
import { mech, node } from '../bom/testHelpers';
import type { LinkElement, PivotElement, RopeElement } from '../schema';
import { groupDragNodeIds, translatedTargets } from './groupDrag';

const L1: LinkElement = {
  id: 'L1',
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
};
const L2: LinkElement = { ...L1, id: 'L2', nodeA: 'n2', nodeB: 'n3' };
const P1: PivotElement = {
  id: 'P1',
  type: 'pivot',
  maturity: 'sketch',
  nodeId: 'n2',
  memberIds: ['L1', 'L2'],
  welds: [],
  joint: { kind: 'spherical' },
};
const R1: RopeElement = {
  id: 'R1',
  type: 'rope',
  maturity: 'sketch',
  path: ['n1', 'n4'],
  lengthM: 2,
};

const M = mech(
  [L1, L2, P1, R1],
  [node('n1', 0, 0), node('n2', 3, 4), node('n3', 6, 4, 1), node('n4', 0, 2)],
);

describe('groupDragNodeIds', () => {
  it('unions the nodes of the dragged elements, deduping shared joints', () => {
    // L1 and L2 share n2; the pivot on n2 adds nothing new
    expect(groupDragNodeIds(M, ['L1', 'L2', 'P1'])).toEqual(['n1', 'n2', 'n3']);
  });

  it('covers path elements and ignores ids not in the mechanism', () => {
    expect(groupDragNodeIds(M, ['R1', 'nope'])).toEqual(['n1', 'n4']);
  });

  it('empty selection drags nothing', () => {
    expect(groupDragNodeIds(M, [])).toEqual([]);
  });
});

describe('translatedTargets', () => {
  it('applies one world delta to every captured start position', () => {
    const orig = { n1: { x: 0, y: 0, z: 0 }, n3: { x: 6, y: 4, z: 1 } };
    expect(translatedTargets(orig, { x: 1, y: -2, z: 0.5 })).toEqual({
      n1: { x: 1, y: -2, z: 0.5 },
      n3: { x: 7, y: 2, z: 1.5 },
    });
  });
});
