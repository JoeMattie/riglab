import { describe, expect, it } from 'vitest';
import type { PivotElement, Project } from '../schema';
import { createEmptyProject } from '../schema/project';
import { repairOffPlaneHinges } from './docOps';

/** A bent 2-bar knee in the x–y plane with the hinge axis set wrong (+y). */
function kneeProject(axis: { x: number; y: number; z: number }): Project {
  const doc = createEmptyProject('p', 'p');
  const pivot: PivotElement = {
    id: 'piv',
    type: 'pivot',
    maturity: 'sketch',
    nodeId: 'P',
    joint: { kind: 'hinge', axis },
    memberIds: ['barA', 'barB'],
    welds: [],
  };
  return {
    ...doc,
    mechanism: {
      ...doc.mechanism,
      nodes: [
        { id: 'P', kind: 'free', position: { x: 0, y: 0, z: 0 } },
        { id: 'A', kind: 'free', position: { x: -1, y: 0.2, z: 0 } },
        { id: 'B', kind: 'free', position: { x: 1, y: 0.3, z: 0 } },
      ],
      elements: [
        { id: 'barA', type: 'link', maturity: 'sketch', nodeA: 'P', nodeB: 'A', pointMasses: [] },
        { id: 'barB', type: 'link', maturity: 'sketch', nodeA: 'P', nodeB: 'B', pointMasses: [] },
        pivot,
      ],
    },
  };
}

const pivotAxisOf = (doc: Project) => {
  const p = doc.mechanism.elements.find((e) => e.id === 'piv');
  if (p?.type !== 'pivot' || p.joint.kind !== 'hinge') throw new Error('no hinge');
  return p.joint.axis;
};

describe('repairOffPlaneHinges', () => {
  it('snaps an off-plane +y knee axis to the +z swing-plane normal', () => {
    const { doc, repaired } = repairOffPlaneHinges(kneeProject({ x: 0, y: 1, z: 0 }));
    expect(repaired).toBe(1);
    expect(pivotAxisOf(doc)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('is a no-op (same doc, 0 repaired) when every hinge is already in plane', () => {
    const input = kneeProject({ x: 0, y: 0, z: 1 });
    const { doc, repaired } = repairOffPlaneHinges(input);
    expect(repaired).toBe(0);
    expect(doc).toBe(input); // referentially unchanged
  });

  it('is idempotent: repairing twice changes nothing the second time', () => {
    const once = repairOffPlaneHinges(kneeProject({ x: 0, y: 1, z: 0 }));
    const twice = repairOffPlaneHinges(once.doc);
    expect(twice.repaired).toBe(0);
    expect(twice.doc).toBe(once.doc);
  });
});
