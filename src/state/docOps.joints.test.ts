// Interface-overhaul docOps: length locks, joint-popover re-realization,
// detach, and the selection-card Split/Reverse actions.
import { describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../bom/testHelpers';
import type { LinkElement, MechanismElement, PivotElement, Project } from '../schema';
import { createEmptyProject } from '../schema';
import {
  addSkeletonBinding,
  detachNode,
  groundNodeAtAnchor,
  releaseNodeConnection,
  reverseLink,
  setLengthLocked,
  setNodeJoint,
  splitLinkAtMidpoint,
} from './docOps';

const L1: LinkElement = {
  id: 'L1',
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
};
const L2: LinkElement = { ...L1, id: 'L2', nodeA: 'n2', nodeB: 'n3' };

function project(
  elements: MechanismElement[] = [L1, L2],
  nodes = [node('n1', 0, 0), node('n2', 3, 4), node('n3', 6, 4)],
): Project {
  const p = createEmptyProject('p1', 'test');
  return { ...p, materials: testMaterials(), mechanisms: [mech(elements, nodes)] };
}

const m0 = (doc: Project) => doc.mechanisms[0]!;
const el = (doc: Project, id: string) => m0(doc).elements.find((e) => e.id === id);

describe('setLengthLocked', () => {
  it('locks and unlocks a link length', () => {
    let doc = setLengthLocked(project(), 'm1', 'L1', true);
    expect(el(doc, 'L1')).toMatchObject({ lengthLocked: true });
    doc = setLengthLocked(doc, 'm1', 'L1', false);
    expect((el(doc, 'L1') as LinkElement).lengthLocked).toBeUndefined();
  });

  it('ignores non-pipe elements', () => {
    const rope: MechanismElement = {
      id: 'R1',
      type: 'rope',
      maturity: 'sketch',
      path: ['n1', 'n3'],
      lengthM: 2,
    };
    const doc = setLengthLocked(project([L1, rope]), 'm1', 'R1', true);
    expect(el(doc, 'R1')).not.toHaveProperty('lengthLocked');
  });
});

describe('setNodeJoint', () => {
  it('weld creates a pivot element with every member pair welded', () => {
    const doc = setNodeJoint(project(), 'm1', 'n2', 'weld');
    const pivot = m0(doc).elements.find((e) => e.type === 'pivot') as PivotElement;
    expect(pivot.nodeId).toBe('n2');
    expect(new Set(pivot.memberIds)).toEqual(new Set(['L1', 'L2']));
    expect(pivot.welds).toEqual([['L1', 'L2']]);
  });

  it('pivot clears the welds of an existing pivot element', () => {
    let doc = setNodeJoint(project(), 'm1', 'n2', 'weld');
    doc = setNodeJoint(doc, 'm1', 'n2', 'pivot');
    const pivot = m0(doc).elements.find((e) => e.type === 'pivot') as PivotElement;
    expect(pivot.welds).toEqual([]);
  });

  it('anchor grounds the node; pivot un-grounds it', () => {
    let doc = setNodeJoint(project(), 'm1', 'n2', 'anchor');
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('anchor');
    doc = setNodeJoint(doc, 'm1', 'n2', 'pivot');
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('free');
  });

  it('weld is a no-op on an end node with fewer than 2 members', () => {
    const doc = setNodeJoint(project(), 'm1', 'n1', 'weld');
    expect(m0(doc).elements.some((e) => e.type === 'pivot')).toBe(false);
  });
});

describe('detachNode', () => {
  it('gives each member beyond the first its own node copy and drops the pivot', () => {
    let doc = setNodeJoint(project(), 'm1', 'n2', 'weld');
    doc = detachNode(doc, 'm1', 'n2');
    const m = m0(doc);
    expect(m.elements.some((e) => e.type === 'pivot')).toBe(false);
    const l1 = m.elements.find((e) => e.id === 'L1') as LinkElement;
    const l2 = m.elements.find((e) => e.id === 'L2') as LinkElement;
    expect(l1.nodeB).toBe('n2'); // first reference keeps the original node
    expect(l2.nodeA).not.toBe('n2');
    const copy = m.nodes.find((n) => n.id === l2.nodeA)!;
    expect(copy.position).toEqual({ x: 3, y: 4 });
    expect(m.nodes).toHaveLength(4);
  });
});

describe('reverseLink', () => {
  it('swaps A/B ends and their end realizations', () => {
    const link: LinkElement = { ...L1, endRealizationA: 'fitting', endRealizationB: 'boltThrough' };
    const doc = reverseLink(project([link, L2]), 'm1', 'L1');
    expect(el(doc, 'L1')).toMatchObject({
      nodeA: 'n2',
      nodeB: 'n1',
      endRealizationA: 'boltThrough',
      endRealizationB: 'fitting',
    });
  });
});

describe('splitLinkAtMidpoint', () => {
  it('splits a link into two welded halves at the midpoint', () => {
    const doc = splitLinkAtMidpoint(project(), 'm1', 'L1');
    const m = m0(doc);
    const links = m.elements.filter((e) => e.type === 'link');
    expect(links).toHaveLength(3); // two halves + untouched L2
    const pivot = m.elements.find((e) => e.type === 'pivot') as PivotElement;
    expect(pivot.welds).toHaveLength(1);
    const mid = m.nodes.find((n) => n.id === pivot.nodeId)!;
    expect(mid.position.x).toBeCloseTo(1.5, 9);
    expect(mid.position.y).toBeCloseTo(2, 9);
  });

  it('is a no-op for non-link elements', () => {
    const doc = splitLinkAtMidpoint(project(), 'm1', 'nope');
    expect(m0(doc).elements).toHaveLength(2);
  });
});

// Dropping a dragged node on a pack-frame anchor grounds it there AND
// attaches it to the wearer anchor — the select-gesture counterpart of
// drawing a pipe end onto an anchor (PLANFILE-wearer-attachments-and-floor).
describe('groundNodeAtAnchor', () => {
  it('moves the node to the anchor position, grounds it, and records the attachment', () => {
    const doc = groundNodeAtAnchor(project(), 'm1', 'n2', 'hipRectBackL', { x: 0.12, y: 0.9 });
    const n2 = m0(doc).nodes.find((n) => n.id === 'n2')!;
    expect(n2.kind).toBe('anchor');
    expect(n2.position).toEqual({ x: 0.12, y: 0.9 });
    expect(m0(doc).anchorBindings).toMatchObject([{ anchor: 'hipRectBackL', nodeId: 'n2' }]);
  });

  it('re-grounding on another anchor replaces the attachment', () => {
    let doc = groundNodeAtAnchor(project(), 'm1', 'n2', 'hipRectBackL', { x: 0.12, y: 0.9 });
    doc = groundNodeAtAnchor(doc, 'm1', 'n2', 'beltBack', { x: -0.1, y: 0.93 });
    expect(m0(doc).anchorBindings).toMatchObject([{ anchor: 'beltBack', nodeId: 'n2' }]);
  });

  it('removes any skeleton binding — a grounded node cannot be clip-driven', () => {
    let doc = addSkeletonBinding(project(), 'm1', 'handR', 'n2');
    expect(m0(doc).skeletonBindings).toHaveLength(1);
    doc = groundNodeAtAnchor(doc, 'm1', 'n2', 'beltR', { x: 0.12, y: 0.9 });
    expect(m0(doc).skeletonBindings).toHaveLength(0);
  });

  it('leaves other nodes and bindings untouched', () => {
    let doc = addSkeletonBinding(project(), 'm1', 'handL', 'n3');
    doc = groundNodeAtAnchor(doc, 'm1', 'n2', 'beltR', { x: 0, y: 0 });
    expect(m0(doc).nodes.find((n) => n.id === 'n1')!.kind).toBe('free');
    expect(m0(doc).skeletonBindings).toHaveLength(1);
  });
});

// Tear-off (PLANFILE-wearer-attachments-and-floor slice B): dragging a
// connected node past the deadzone releases whatever holds it to the wearer.
describe('releaseNodeConnection', () => {
  it('removes a skeleton binding', () => {
    let doc = addSkeletonBinding(project(), 'm1', 'handR', 'n2');
    doc = releaseNodeConnection(doc, 'm1', 'n2');
    expect(m0(doc).skeletonBindings).toHaveLength(0);
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('free');
  });

  it('removes an anchor attachment and un-grounds the node', () => {
    let doc = groundNodeAtAnchor(project(), 'm1', 'n2', 'beltR', { x: 0, y: 0.9 });
    doc = releaseNodeConnection(doc, 'm1', 'n2');
    expect(m0(doc).anchorBindings).toHaveLength(0);
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('free');
  });

  it('un-grounds a plain grounded node with no attachment', () => {
    let doc = setNodeJoint(project(), 'm1', 'n2', 'anchor');
    doc = releaseNodeConnection(doc, 'm1', 'n2');
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('free');
  });

  it('is a no-op on a bare free node and leaves others untouched', () => {
    let doc = addSkeletonBinding(project(), 'm1', 'handL', 'n3');
    doc = groundNodeAtAnchor(doc, 'm1', 'n1', 'beltL', { x: 0, y: 0.9 });
    const released = releaseNodeConnection(doc, 'm1', 'n2');
    expect(released).toEqual(doc);
    expect(m0(released).skeletonBindings).toHaveLength(1);
    expect(m0(released).anchorBindings).toHaveLength(1);
  });
});
