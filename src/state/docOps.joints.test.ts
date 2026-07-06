// Interface-overhaul docOps: length locks, joint-popover re-realization,
// detach, the selection-card Split/Reverse actions, and the v7 hinge/spherical
// joint plumbing (PLANFILE-3d-conversion.md decision 2).
import { describe, expect, it } from 'vitest';
import { mech, node, projectWith } from '../design/testFixtures';
import type { LinkElement, MechanismElement, PivotElement, PivotJoint, Project } from '../schema';
import {
  addPipe,
  addSkeletonBinding,
  DEFAULT_PIVOT_JOINT,
  detachNode,
  groundNodeAtAnchor,
  releaseNodeConnection,
  reverseLink,
  setLengthLocked,
  setNodeJoint,
  setNodePivotJoint,
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
  return projectWith(mech(elements, nodes));
}

const m0 = (doc: Project) => doc.mechanism;
const el = (doc: Project, id: string) => m0(doc).elements.find((e) => e.id === id);
const pivotOf = (doc: Project) =>
  m0(doc).elements.find((e): e is PivotElement => e.type === 'pivot');

describe('setLengthLocked', () => {
  it('locks and unlocks a link length', () => {
    let doc = setLengthLocked(project(), 'L1', true);
    expect(el(doc, 'L1')).toMatchObject({ lengthLocked: true });
    doc = setLengthLocked(doc, 'L1', false);
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
    const doc = setLengthLocked(project([L1, rope]), 'R1', true);
    expect(el(doc, 'R1')).not.toHaveProperty('lengthLocked');
  });
});

describe('setNodeJoint', () => {
  it('weld creates a pivot element with every member pair welded (default hinge)', () => {
    const doc = setNodeJoint(project(), 'n2', 'weld');
    const pivot = pivotOf(doc)!;
    expect(pivot.nodeId).toBe('n2');
    expect(new Set(pivot.memberIds)).toEqual(new Set(['L1', 'L2']));
    expect(pivot.welds).toEqual([['L1', 'L2']]);
    expect(pivot.joint).toEqual(DEFAULT_PIVOT_JOINT);
  });

  it('pivot clears the welds of an existing pivot element', () => {
    let doc = setNodeJoint(project(), 'n2', 'weld');
    doc = setNodeJoint(doc, 'n2', 'pivot');
    expect(pivotOf(doc)!.welds).toEqual([]);
  });

  it('weldPivot welds only the straight-through pair; arrivals pivot', () => {
    // n1(0,0) — n2(3,4) — n3(6,4): L1 continues into L2 at ~straight; a
    // third pipe L3 arrives at n2 from n4 well off that line
    const L3: LinkElement = {
      id: 'L3',
      type: 'link',
      maturity: 'sketch',
      nodeA: 'n2',
      nodeB: 'n4',
      pointMasses: [],
    };
    const doc = setNodeJoint(
      project(
        [L1, L2, L3],
        [node('n1', 0, 4), node('n2', 3, 4), node('n3', 6, 4), node('n4', 3, 0)],
      ),
      'n2',
      'weldPivot',
    );
    const pivot = pivotOf(doc)!;
    expect(new Set(pivot.memberIds)).toEqual(new Set(['L1', 'L2', 'L3']));
    // exactly ONE weld, and it joins the collinear halves — L3 stays free
    expect(pivot.welds).toHaveLength(1);
    expect(new Set(pivot.welds[0])).toEqual(new Set(['L1', 'L2']));
  });

  it('weldPivot converts an existing full weld back to the mixed junction', () => {
    const L3: LinkElement = {
      id: 'L3',
      type: 'link',
      maturity: 'sketch',
      nodeA: 'n2',
      nodeB: 'n4',
      pointMasses: [],
    };
    const nodes = [node('n1', 0, 4), node('n2', 3, 4), node('n3', 6, 4), node('n4', 3, 0)];
    let doc = setNodeJoint(project([L1, L2, L3], nodes), 'n2', 'weld');
    expect(pivotOf(doc)!.welds).toHaveLength(2); // fully welded
    doc = setNodeJoint(doc, 'n2', 'weldPivot');
    expect(pivotOf(doc)!.welds).toHaveLength(1);
    expect(new Set(pivotOf(doc)!.welds[0])).toEqual(new Set(['L1', 'L2']));
  });

  it('weldPivot is a no-op with fewer than three members', () => {
    const doc = setNodeJoint(project(), 'n2', 'weldPivot');
    expect(pivotOf(doc)).toBeUndefined();
  });

  it('pivot materializes an explicit hinge with the caller-supplied axis', () => {
    // in 3D a bare shared node is spherical, so hinge-by-default needs the
    // element; the UI passes the active panel's normal
    const joint: PivotJoint = { kind: 'hinge', axis: { x: 0, y: 1, z: 0 } };
    const doc = setNodeJoint(project(), 'n2', 'pivot', joint);
    const pivot = pivotOf(doc)!;
    expect(pivot.joint).toEqual(joint);
    expect(new Set(pivot.memberIds)).toEqual(new Set(['L1', 'L2']));
    expect(pivot.welds).toEqual([]);
  });

  it('anchor grounds the node; pivot un-grounds it', () => {
    let doc = setNodeJoint(project(), 'n2', 'anchor');
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('anchor');
    doc = setNodeJoint(doc, 'n2', 'pivot');
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('free');
  });

  it('weld is a no-op on an end node with fewer than 2 members', () => {
    const doc = setNodeJoint(project(), 'n1', 'weld');
    expect(m0(doc).elements.some((e) => e.type === 'pivot')).toBe(false);
  });
});

describe('setNodePivotJoint', () => {
  it('re-aims an existing hinge and switches to spherical, preserving welds', () => {
    let doc = setNodeJoint(project(), 'n2', 'weld');
    doc = setNodePivotJoint(doc, 'n2', { kind: 'hinge', axis: { x: 1, y: 0, z: 0 } });
    expect(pivotOf(doc)!.joint).toEqual({ kind: 'hinge', axis: { x: 1, y: 0, z: 0 } });
    expect(pivotOf(doc)!.welds).toHaveLength(1); // untouched

    doc = setNodePivotJoint(doc, 'n2', { kind: 'spherical' });
    expect(pivotOf(doc)!.joint).toEqual({ kind: 'spherical' });
  });

  it('materializes a pivot on an implicit pin, and no-ops with <2 members', () => {
    const doc = setNodePivotJoint(project(), 'n2', { kind: 'spherical' });
    expect(pivotOf(doc)).toMatchObject({ nodeId: 'n2', joint: { kind: 'spherical' } });
    const noop = setNodePivotJoint(project(), 'n1', { kind: 'spherical' });
    expect(m0(noop).elements.some((e) => e.type === 'pivot')).toBe(false);
  });
});

describe('addPipe joint plumbing', () => {
  it('a pivot-connect end materializes a hinge pivot with the passed axis', () => {
    const joint: PivotJoint = { kind: 'hinge', axis: { x: 1, y: 0, z: 0 } };
    const { doc } = addPipe(
      project(),
      [
        { x: 3, y: 4, z: 0 },
        { x: 3, y: 8, z: 0 },
      ],
      { kind: 'existingNode', nodeId: 'n2', connect: 'pivot' },
      { kind: 'newNode', pos: { x: 3, y: 8, z: 0 } },
      joint,
    );
    const pivot = pivotOf(doc)!;
    expect(pivot.nodeId).toBe('n2');
    expect(pivot.joint).toEqual(joint);
    expect(pivot.welds).toEqual([]);
    expect(pivot.memberIds).toHaveLength(3); // L1, L2, and the new pipe
  });

  it('a weld-connect end still welds (joint carried for the schema)', () => {
    const { doc, elementId } = addPipe(
      project(),
      [
        { x: 3, y: 4, z: 0 },
        { x: 3, y: 8, z: 0 },
      ],
      { kind: 'existingNode', nodeId: 'n2', connect: 'weld' },
      { kind: 'newNode', pos: { x: 3, y: 8, z: 0 } },
    );
    const pivot = pivotOf(doc)!;
    expect(pivot.welds).toEqual([[elementId, 'L1']]);
    expect(pivot.joint).toEqual(DEFAULT_PIVOT_JOINT);
  });
});

describe('detachNode', () => {
  it('gives each member beyond the first its own node copy and drops the pivot', () => {
    let doc = setNodeJoint(project(), 'n2', 'weld');
    doc = detachNode(doc, 'n2');
    const m = m0(doc);
    expect(m.elements.some((e) => e.type === 'pivot')).toBe(false);
    const l1 = m.elements.find((e) => e.id === 'L1') as LinkElement;
    const l2 = m.elements.find((e) => e.id === 'L2') as LinkElement;
    expect(l1.nodeB).toBe('n2'); // first reference keeps the original node
    expect(l2.nodeA).not.toBe('n2');
    const copy = m.nodes.find((n) => n.id === l2.nodeA)!;
    expect(copy.position).toEqual({ x: 3, y: 4, z: 0 });
    expect(m.nodes).toHaveLength(4);
  });
});

describe('reverseLink', () => {
  it('swaps A/B ends and their end realizations', () => {
    const link: LinkElement = { ...L1, endRealizationA: 'fitting', endRealizationB: 'boltThrough' };
    const doc = reverseLink(project([link, L2]), 'L1');
    expect(el(doc, 'L1')).toMatchObject({
      nodeA: 'n2',
      nodeB: 'n1',
      endRealizationA: 'boltThrough',
      endRealizationB: 'fitting',
    });
  });
});

describe('splitLinkAtMidpoint', () => {
  it('re-homes a slider riding the split rail onto the half its carriage occupies', () => {
    // rail n1(0,0)→n2(4,0); carriage n4 at (3,0) = t 0.75, full travel
    const rail: LinkElement = { ...L1, id: 'R', nodeA: 'n1', nodeB: 'n2' };
    const doc0 = project(
      [
        rail,
        {
          id: 'S1',
          type: 'slider',
          maturity: 'sketch',
          nodeId: 'n4',
          alongElementId: 'R',
          travelMin: 0,
          travelMax: 1,
        },
      ],
      [node('n1', 0, 0), node('n2', 4, 0), node('n4', 3, 0)],
    );
    const doc = splitLinkAtMidpoint(doc0, 'R'); // split at t = 0.5
    const m = m0(doc);
    const slider = m.elements.find((e) => e.type === 'slider');
    expect(slider?.type).toBe('slider');
    if (slider?.type !== 'slider') return;
    // the original rail id is gone; the slider must point at the SECOND half
    // (its carriage sits at t 0.75 > 0.5) with travel remapped into it
    const half = m.elements.find((e) => e.id === slider.alongElementId);
    expect(half?.type).toBe('link');
    if (half?.type !== 'link') return;
    const pos = (id: string) => m.nodes.find((n) => n.id === id)!.position;
    expect(pos(half.nodeA).x).toBeCloseTo(2, 9); // split node
    expect(pos(half.nodeB).x).toBeCloseTo(4, 9);
    expect(slider.travelMin).toBe(0);
    expect(slider.travelMax).toBe(1);
  });

  it('splits a link into two welded halves at the midpoint', () => {
    const doc = splitLinkAtMidpoint(project(), 'L1');
    const m = m0(doc);
    const links = m.elements.filter((e) => e.type === 'link');
    expect(links).toHaveLength(3); // two halves + untouched L2
    const pivot = pivotOf(doc)!;
    expect(pivot.welds).toHaveLength(1);
    expect(pivot.joint).toEqual(DEFAULT_PIVOT_JOINT);
    const mid = m.nodes.find((n) => n.id === pivot.nodeId)!;
    expect(mid.position.x).toBeCloseTo(1.5, 9);
    expect(mid.position.y).toBeCloseTo(2, 9);
    expect(mid.position.z).toBeCloseTo(0, 9);
  });

  it('is a no-op for non-link elements', () => {
    const doc = splitLinkAtMidpoint(project(), 'nope');
    expect(m0(doc).elements).toHaveLength(2);
  });
});

// Dropping a dragged node on a pack-frame anchor grounds it there AND
// attaches it to the wearer anchor — the select-gesture counterpart of
// drawing a pipe end onto an anchor (PLANFILE-wearer-attachments-and-floor).
// v7: anchors are true 3D points, no per-view projection.
describe('groundNodeAtAnchor', () => {
  it('moves the node to the anchor position, grounds it, and records the attachment', () => {
    const doc = groundNodeAtAnchor(project(), 'n2', 'hipRectBackL', { x: 0.12, y: 0.9, z: 0.18 });
    const n2 = m0(doc).nodes.find((n) => n.id === 'n2')!;
    expect(n2.kind).toBe('anchor');
    expect(n2.position).toEqual({ x: 0.12, y: 0.9, z: 0.18 });
    expect(m0(doc).anchorBindings).toMatchObject([{ anchor: 'hipRectBackL', nodeId: 'n2' }]);
  });

  it('re-grounding on another anchor replaces the attachment', () => {
    let doc = groundNodeAtAnchor(project(), 'n2', 'hipRectBackL', { x: 0.12, y: 0.9, z: 0.18 });
    doc = groundNodeAtAnchor(doc, 'n2', 'beltBack', { x: -0.1, y: 0.93, z: 0 });
    expect(m0(doc).anchorBindings).toMatchObject([{ anchor: 'beltBack', nodeId: 'n2' }]);
  });

  it('removes any skeleton binding — a grounded node cannot be clip-driven', () => {
    let doc = addSkeletonBinding(project(), 'handR', 'n2');
    expect(m0(doc).skeletonBindings).toHaveLength(1);
    doc = groundNodeAtAnchor(doc, 'n2', 'beltR', { x: 0.12, y: 0.9, z: -0.18 });
    expect(m0(doc).skeletonBindings).toHaveLength(0);
  });

  it('leaves other nodes and bindings untouched', () => {
    let doc = addSkeletonBinding(project(), 'handL', 'n3');
    doc = groundNodeAtAnchor(doc, 'n2', 'beltR', { x: 0, y: 0, z: 0 });
    expect(m0(doc).nodes.find((n) => n.id === 'n1')!.kind).toBe('free');
    expect(m0(doc).skeletonBindings).toHaveLength(1);
  });
});

// Tear-off (PLANFILE-wearer-attachments-and-floor slice B): dragging a
// connected node past the deadzone releases whatever holds it to the wearer.
describe('releaseNodeConnection', () => {
  it('removes a skeleton binding', () => {
    let doc = addSkeletonBinding(project(), 'handR', 'n2');
    doc = releaseNodeConnection(doc, 'n2');
    expect(m0(doc).skeletonBindings).toHaveLength(0);
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('free');
  });

  it('removes an anchor attachment and un-grounds the node', () => {
    let doc = groundNodeAtAnchor(project(), 'n2', 'beltR', { x: 0, y: 0.9, z: 0 });
    doc = releaseNodeConnection(doc, 'n2');
    expect(m0(doc).anchorBindings).toHaveLength(0);
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('free');
  });

  it('un-grounds a plain grounded node with no attachment', () => {
    let doc = setNodeJoint(project(), 'n2', 'anchor');
    doc = releaseNodeConnection(doc, 'n2');
    expect(m0(doc).nodes.find((n) => n.id === 'n2')!.kind).toBe('free');
  });

  it('is a no-op on a bare free node and leaves others untouched', () => {
    let doc = addSkeletonBinding(project(), 'handL', 'n3');
    doc = groundNodeAtAnchor(doc, 'n1', 'beltL', { x: 0, y: 0.9, z: 0 });
    const released = releaseNodeConnection(doc, 'n2');
    expect(released).toEqual(doc);
    expect(m0(released).skeletonBindings).toHaveLength(1);
    expect(m0(released).anchorBindings).toHaveLength(1);
  });
});
