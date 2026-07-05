// Ground-hinge materialization on anchoring (PLANFILE-3d-conversion
// integration fix): anchoring a node that carries rigid members but no pivot
// creates a single pivot over all members in the SAME op — one undo step —
// so a double-click-anchored chain end hinges about the panel normal instead
// of coning about a bare spherical anchor. Covers setNodeKind, the joint
// popover's anchor path (setNodeJoint), drop-grounding (groundNodeAtAnchor),
// and drawing onto a wearer anchor (addPipe anchorNode end).
import { describe, expect, it } from 'vitest';
import { mech, node, proj } from '../bom/testHelpers';
import type { LinkElement, PivotElement, PivotJoint, Project } from '../schema';
import { addPipe, groundNodeAtAnchor, setNodeJoint, setNodeKind } from './docOps';

const link = (id: string, a: string, b: string): LinkElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA: a,
  nodeB: b,
  pointMasses: [],
});

const TOP_HINGE: PivotJoint = { kind: 'hinge', axis: { x: 0, y: -1, z: 0 } };

/** Two links meeting at n2; a lone chain end at n3; an isolated node n4. */
function project(extraElements: Project['mechanism']['elements'] = []): Project {
  return proj(
    mech(
      [link('L1', 'n1', 'n2'), link('L2', 'n2', 'n3'), ...extraElements],
      [node('n1', 0, 0), node('n2', 1, 0), node('n3', 2, 0), node('n4', 3, 3)],
    ),
  );
}

const pivotsAt = (doc: Project, nodeId: string): PivotElement[] =>
  doc.mechanism.elements.filter(
    (e): e is PivotElement => e.type === 'pivot' && e.nodeId === nodeId,
  );

describe('setNodeKind anchoring materializes a ground hinge', () => {
  it('a chain-end node (1 member) gets a single-member pivot with the passed axis, in one op', () => {
    const doc = setNodeKind(project(), 'n3', 'anchor', TOP_HINGE);
    // one call = one undo step: both the re-kind and the pivot are present
    expect(doc.mechanism.nodes.find((n) => n.id === 'n3')!.kind).toBe('anchor');
    const pivots = pivotsAt(doc, 'n3');
    expect(pivots).toHaveLength(1);
    expect(pivots[0]).toMatchObject({ memberIds: ['L2'], welds: [], joint: TOP_HINGE });
  });

  it('a junction node lists ALL members at the node', () => {
    const doc = setNodeKind(project(), 'n2', 'anchor', TOP_HINGE);
    expect(pivotsAt(doc, 'n2')[0]!.memberIds.sort()).toEqual(['L1', 'L2']);
  });

  it('defaults to the side-panel normal (+z) when no joint is passed', () => {
    const doc = setNodeKind(project(), 'n3', 'anchor');
    expect(pivotsAt(doc, 'n3')[0]!.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
  });

  it('a node with an existing pivot is left untouched (its joint is respected)', () => {
    const existing: PivotElement = {
      id: 'P1',
      type: 'pivot',
      maturity: 'sketch',
      nodeId: 'n2',
      joint: { kind: 'spherical' },
      memberIds: ['L1', 'L2'],
      welds: [],
    };
    const doc = setNodeKind(project([existing]), 'n2', 'anchor', TOP_HINGE);
    const pivots = pivotsAt(doc, 'n2');
    expect(pivots).toHaveLength(1);
    expect(pivots[0]).toBe(
      doc.mechanism.elements.find((e) => e.id === 'P1'), // same element, unchanged
    );
    expect(pivots[0]!.joint).toEqual({ kind: 'spherical' });
  });

  it('an isolated node (no rigid members) anchors without a pivot', () => {
    const doc = setNodeKind(project(), 'n4', 'anchor', TOP_HINGE);
    expect(doc.mechanism.nodes.find((n) => n.id === 'n4')!.kind).toBe('anchor');
    expect(pivotsAt(doc, 'n4')).toHaveLength(0);
  });

  it('un-anchoring leaves the ground hinge alone (a plain pivot remains)', () => {
    const anchored = setNodeKind(project(), 'n3', 'anchor', TOP_HINGE);
    const freed = setNodeKind(anchored, 'n3', 'free');
    expect(freed.mechanism.nodes.find((n) => n.id === 'n3')!.kind).toBe('free');
    expect(pivotsAt(freed, 'n3')).toHaveLength(1); // removable via its own delete
  });
});

describe('the other panel grounding paths materialize the same ground hinge', () => {
  it('setNodeJoint anchor (joint popover) with the panel hinge', () => {
    const doc = setNodeJoint(project(), 'n3', 'anchor', TOP_HINGE);
    expect(doc.mechanism.nodes.find((n) => n.id === 'n3')!.kind).toBe('anchor');
    expect(pivotsAt(doc, 'n3')[0]).toMatchObject({ memberIds: ['L2'], joint: TOP_HINGE });
  });

  it('groundNodeAtAnchor (drop on a wearer anchor) with the panel hinge', () => {
    const pos = { x: 0.2, y: 1.1, z: 0 };
    const doc = groundNodeAtAnchor(project(), 'n3', 'hipRectFrontL', pos, TOP_HINGE);
    const n3 = doc.mechanism.nodes.find((n) => n.id === 'n3')!;
    expect(n3.kind).toBe('anchor');
    expect(n3.position).toEqual(pos);
    expect(doc.mechanism.anchorBindings.some((b) => b.nodeId === 'n3')).toBe(true);
    expect(pivotsAt(doc, 'n3')[0]).toMatchObject({ memberIds: ['L2'], joint: TOP_HINGE });
  });

  it('addPipe onto a wearer anchor (anchorNode end) pins the new end as a ground hinge', () => {
    const { doc, elementId } = addPipe(
      project(),
      [
        { x: 3, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 },
      ],
      { kind: 'newNode', pos: { x: 3, y: 0, z: 0 } },
      { kind: 'anchorNode', pos: { x: 3, y: 1, z: 0 }, anchor: 'shoulderL' },
      TOP_HINGE,
    );
    const el = doc.mechanism.elements.find((e) => e.id === elementId);
    expect(el?.type).toBe('link');
    const anchorNode = doc.mechanism.nodes.find((n) => n.kind === 'anchor')!;
    expect(pivotsAt(doc, anchorNode.id)[0]).toMatchObject({
      memberIds: [elementId],
      welds: [],
      joint: TOP_HINGE,
    });
  });
});
