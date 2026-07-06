// Snap-to-join drag-drop ops (Joe's attachment UX): merging a dragged end
// into another end (attachNodes) or onto a straight pipe's body
// (attachNodeToLink), with the guard predicates that refuse degenerate
// merges. The joint menu's "Attached" toggle is the inverse op (detachNode,
// covered in docOps.joints.test.ts).
import { describe, expect, it } from 'vitest';
import { mech, node, projectWith } from '../design/testFixtures';
import type { LinkElement, MechanismElement, PivotElement, Project } from '../schema';
import { attachNodes, attachNodeToLink, canAttachNodes, canAttachNodeToLink } from './docOps';

// two separate pipes: L1 = n1–n2, L2 = n3–n4 (n2 and n3 near each other)
const L1: LinkElement = {
  id: 'L1',
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
};
const L2: LinkElement = { ...L1, id: 'L2', nodeA: 'n3', nodeB: 'n4' };

function project(
  elements: MechanismElement[] = [L1, L2],
  nodes = [node('n1', 0, 0), node('n2', 1, 0), node('n3', 1, 0.01), node('n4', 2, 1)],
): Project {
  return projectWith(mech(elements, nodes));
}

const m0 = (doc: Project) => doc.mechanism;
const pivotOf = (doc: Project) =>
  m0(doc).elements.find((e): e is PivotElement => e.type === 'pivot');

describe('attachNodes', () => {
  it('merges the dragged end into the target and pins both pipes with one pivot', () => {
    const doc = attachNodes(project(), 'n3', 'n2');
    // n3 is gone; L2 now starts at n2
    expect(m0(doc).nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n4']);
    expect(m0(doc).elements.find((e) => e.id === 'L2')).toMatchObject({ nodeA: 'n2' });
    // one pivot at the junction, owning BOTH pipes
    const pivot = pivotOf(doc)!;
    expect(pivot).toMatchObject({ nodeId: 'n2', welds: [] });
    expect([...pivot.memberIds].sort()).toEqual(['L1', 'L2']);
  });

  it('an existing pivot at the target adopts the arriving member', () => {
    const L3: LinkElement = { ...L1, id: 'L3', nodeA: 'n2', nodeB: 'n4' };
    const existing: PivotElement = {
      id: 'P1',
      type: 'pivot',
      maturity: 'sketch',
      nodeId: 'n2',
      joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
      memberIds: ['L1', 'L3'],
      welds: [],
    };
    const doc = attachNodes(project([L1, L3, L2, existing]), 'n3', 'n2');
    const pivots = m0(doc).elements.filter((e) => e.type === 'pivot');
    expect(pivots).toHaveLength(1);
    expect([...(pivots[0] as PivotElement).memberIds].sort()).toEqual(['L1', 'L2', 'L3']);
  });

  it('rewrites wearer bindings and hung masses from the merged node', () => {
    const base = project();
    const withRefs: Project = {
      ...base,
      mechanism: {
        ...base.mechanism,
        skeletonBindings: [{ id: 'b1', point: 'handR', nodeId: 'n3' }],
      },
      pointMasses: [
        {
          id: 'pm1',
          name: 'head',
          massKg: 1,
          attach: { kind: 'node', nodeId: 'n3' },
        },
      ],
    };
    const doc = attachNodes(withRefs, 'n3', 'n2');
    expect(m0(doc).skeletonBindings[0]).toMatchObject({ nodeId: 'n2' });
    expect(doc.pointMasses[0]!.attach).toMatchObject({ kind: 'node', nodeId: 'n2' });
  });

  it('refuses degenerate merges: same element, joints on either side, self', () => {
    const doc = project();
    // both ends of the SAME pipe would collapse it into a self-loop
    expect(canAttachNodes(m0(doc), 'n1', 'n2')).toBe(false);
    expect(attachNodes(doc, 'n1', 'n2')).toBe(doc);
    // identical nodes
    expect(canAttachNodes(m0(doc), 'n2', 'n2')).toBe(false);
    // a pivot living on the dragged node — merging joints is undefined
    const pinned: PivotElement = {
      id: 'P1',
      type: 'pivot',
      maturity: 'sketch',
      nodeId: 'n3',
      joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
      memberIds: ['L2'],
      welds: [],
    };
    const doc2 = project([L1, L2, pinned]);
    expect(canAttachNodes(m0(doc2), 'n3', 'n2')).toBe(false);
    expect(attachNodes(doc2, 'n3', 'n2')).toBe(doc2);
    // a slider carriage at the target
    const slid = project([
      L1,
      L2,
      {
        id: 'S1',
        type: 'slider',
        maturity: 'sketch',
        nodeId: 'n2',
        alongElementId: 'L1',
        travelMin: 0,
        travelMax: 1,
      },
    ]);
    expect(canAttachNodes(m0(slid), 'n3', 'n2')).toBe(false);
  });
});

describe('attachNodeToLink', () => {
  it('splits the link at t and pins the dragged end there', () => {
    const doc = attachNodeToLink(project(), 'n3', 'L1', 0.5);
    // L1 split into two welded segments + L2 rehomed onto the split node
    const links = m0(doc).elements.filter((e): e is LinkElement => e.type === 'link');
    expect(links).toHaveLength(3);
    const pivots = m0(doc).elements.filter((e): e is PivotElement => e.type === 'pivot');
    expect(pivots).toHaveLength(1);
    const pivot = pivots[0]!;
    // the split pair stays welded (physically one pipe); L2 pivots freely
    expect(pivot.welds).toHaveLength(1);
    expect(pivot.memberIds).toHaveLength(3);
    expect(pivot.memberIds).toContain('L2');
    // n3 merged away
    expect(m0(doc).nodes.some((n) => n.id === 'n3')).toBe(false);
  });

  it('refuses a pipe incident to the dragged node and non-links', () => {
    const doc = project();
    expect(canAttachNodeToLink(m0(doc), 'n2', 'L1')).toBe(false); // own pipe
    expect(attachNodeToLink(doc, 'n2', 'L1', 0.5)).toBe(doc);
    expect(canAttachNodeToLink(m0(doc), 'n3', 'L1')).toBe(true);
    expect(canAttachNodeToLink(m0(doc), 'n3', 'nope')).toBe(false);
  });
});
