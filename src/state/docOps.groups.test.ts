// Groups + mirror-duplicate + project-level masses (PLANFILE-3d-conversion.md):
// the ops that replace the deleted assembly layer.
import { describe, expect, it } from 'vitest';
import { mech, node, projectWith } from '../design/testFixtures';
import type { LinkElement, PivotElement, Project, SliderElement } from '../schema';
import {
  addToGroup,
  clearGroupNote,
  createGroup,
  deleteElement,
  deleteGroup,
  mirrorDuplicate,
  renameGroup,
  setGroupElements,
  setPointMassKg,
} from './docOps';

const link = (id: string, a: string, b: string): LinkElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA: a,
  nodeB: b,
  pointMasses: [],
});

const hingePivot = (id: string, nodeId: string, memberIds: string[]): PivotElement => ({
  id,
  type: 'pivot',
  maturity: 'sketch',
  nodeId,
  joint: { kind: 'hinge', axis: { x: 0, y: 1, z: 0 } },
  memberIds,
  welds: [],
});

/** Two links hinged at n2, drawn at nonzero z so reflections are visible. */
function legProject(): Project {
  return projectWith(
    mech(
      [link('L1', 'n1', 'n2'), link('L2', 'n2', 'n3'), hingePivot('P1', 'n2', ['L1', 'L2'])],
      [node('n1', 0, 0, 0.2), node('n2', 1, 0, 0.2), node('n3', 1, -1, 0.2)],
    ),
  );
}

describe('group ops', () => {
  it('creates, renames, re-assigns, and deletes a group; elements survive deletion', () => {
    let { doc, groupId } = createGroup(legProject(), 'left leg', ['L1', 'L1', 'L2']);
    expect(doc.groups).toHaveLength(1);
    expect(doc.groups[0]).toMatchObject({ name: 'left leg', elementIds: ['L1', 'L2'] }); // deduped

    doc = renameGroup(doc, groupId, 'front left leg');
    expect(doc.groups[0]!.name).toBe('front left leg');

    doc = setGroupElements(doc, groupId, ['L2']);
    expect(doc.groups[0]!.elementIds).toEqual(['L2']);
    doc = addToGroup(doc, groupId, ['L1', 'L2']);
    expect(doc.groups[0]!.elementIds).toEqual(['L2', 'L1']);

    const elementCount = doc.mechanism.elements.length;
    doc = deleteGroup(doc, groupId);
    expect(doc.groups).toEqual([]);
    expect(doc.mechanism.elements).toHaveLength(elementCount);
  });

  it('clearGroupNote removes the migration note; deleteElement prunes memberships', () => {
    let doc = legProject();
    doc = {
      ...doc,
      groups: [{ id: 'g1', name: 'neck', elementIds: ['L1', 'L2'], note: 're-joint needed' }],
    };
    const cleared = clearGroupNote(doc, 'g1');
    expect(cleared.groups[0]!.note).toBeUndefined();

    const afterDelete = deleteElement(cleared, 'L1');
    expect(afterDelete.groups[0]!.elementIds).toEqual(['L2']);
  });
});

describe('mirrorDuplicate', () => {
  it('reflects positions across the default sagittal plane with fresh ids', () => {
    const src = legProject();
    const { doc, newElementIds, groupId } = mirrorDuplicate(src, ['L1', 'L2', 'P1']);
    expect(newElementIds).toHaveLength(3);
    expect(groupId).not.toBeNull();
    // originals untouched
    expect(doc.mechanism.elements.filter((e) => ['L1', 'L2', 'P1'].includes(e.id))).toHaveLength(3);
    expect(doc.mechanism.nodes).toHaveLength(6);

    const copyL1 = doc.mechanism.elements.find(
      (e): e is LinkElement => e.type === 'link' && e.id === newElementIds[0],
    )!;
    const a = doc.mechanism.nodes.find((n) => n.id === copyL1.nodeA)!;
    expect(a.position).toEqual({ x: 0, y: 0, z: -0.2 }); // z reflected
  });

  it('reflects then NEGATES hinge axes so signed-angle conventions survive', () => {
    const src = legProject(); // P1 hinge axis +y (in-plane of the mirror)
    const { doc, newElementIds } = mirrorDuplicate(src, ['L1', 'L2', 'P1']);
    const copyPivot = doc.mechanism.elements.find(
      (e): e is PivotElement => e.type === 'pivot' && newElementIds.includes(e.id),
    )!;
    // +y is unchanged by the z=0 reflection, then negated → −y
    expect(copyPivot.joint).toEqual({ kind: 'hinge', axis: { x: -0, y: -1, z: -0 } });
    // members remapped to the copies, node remapped
    expect(copyPivot.memberIds).toHaveLength(2);
    expect(copyPivot.memberIds.every((id) => newElementIds.includes(id))).toBe(true);
    expect(copyPivot.nodeId).not.toBe('P1');
  });

  it('a normal-parallel hinge axis reflects to itself before negation', () => {
    let src = legProject();
    src = {
      ...src,
      mechanism: {
        ...src.mechanism,
        elements: src.mechanism.elements.map((e) =>
          e.id === 'P1' && e.type === 'pivot'
            ? { ...e, joint: { kind: 'hinge' as const, axis: { x: 0, y: 0, z: 1 } } }
            : e,
        ),
      },
    };
    const { doc, newElementIds } = mirrorDuplicate(src, ['L1', 'L2', 'P1']);
    const copyPivot = doc.mechanism.elements.find(
      (e): e is PivotElement => e.type === 'pivot' && newElementIds.includes(e.id),
    )!;
    // z axis: reflected across z=0 → −z, negated → +z (unchanged overall)
    expect(copyPivot.joint).toEqual({ kind: 'hinge', axis: { x: -0, y: -0, z: 1 } });
  });

  it('drops dependents whose references leave the selection', () => {
    const s1: SliderElement = {
      id: 'S1',
      type: 'slider',
      maturity: 'sketch',
      nodeId: 'n3',
      alongElementId: 'L1',
      travelMin: 0,
      travelMax: 1,
    };
    const base = legProject();
    const src = {
      ...base,
      mechanism: { ...base.mechanism, elements: [...base.mechanism.elements, s1] },
    };
    // select only L2 + P1 + S1: the pivot loses L1 (<2 members) and the
    // slider loses its rail — only L2 duplicates
    const { doc, newElementIds } = mirrorDuplicate(src, ['L2', 'P1', 'S1']);
    expect(newElementIds).toHaveLength(1);
    const copy = doc.mechanism.elements.find((e) => e.id === newElementIds[0])!;
    expect(copy.type).toBe('link');
  });

  it("names the new group after the source group, or 'mirror' when none covers the selection", () => {
    const grouped = createGroup(legProject(), 'left leg', ['L1', 'L2', 'P1']);
    const mirrored = mirrorDuplicate(grouped.doc, ['L1', 'L2', 'P1']);
    const g = mirrored.doc.groups.find((x) => x.id === mirrored.groupId)!;
    expect(g.name).toBe('left leg (mirrored)');
    expect(new Set(g.elementIds)).toEqual(new Set(mirrored.newElementIds));

    const ungrouped = mirrorDuplicate(legProject(), ['L1']);
    const g2 = ungrouped.doc.groups.find((x) => x.id === ungrouped.groupId)!;
    expect(g2.name).toBe('mirror (mirrored)');
  });

  it('supports an explicit plane and is a no-op for an empty selection', () => {
    const src = legProject();
    const { doc, newElementIds } = mirrorDuplicate(src, ['L1'], {
      origin: { x: 2, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
    });
    const copy = doc.mechanism.elements.find((e): e is LinkElement => e.id === newElementIds[0])!;
    const a = doc.mechanism.nodes.find((n) => n.id === copy.nodeA)!;
    expect(a.position).toEqual({ x: 4, y: 0, z: 0.2 }); // x=0 reflected about x=2

    const noop = mirrorDuplicate(src, []);
    expect(noop.doc).toBe(src);
    expect(noop.newElementIds).toEqual([]);
    expect(noop.groupId).toBeNull();
  });
});

describe('setPointMassKg (project level)', () => {
  it('sets a project point mass, clamped at zero', () => {
    const base = legProject();
    const doc: Project = {
      ...base,
      pointMasses: [
        {
          id: 'pm1',
          name: 'battery',
          massKg: 1.4,
          attach: { kind: 'wearerAnchor', anchor: 'beltBack' },
        },
      ],
    };
    expect(setPointMassKg(doc, 'pm1', 2).pointMasses[0]!.massKg).toBe(2);
    expect(setPointMassKg(doc, 'pm1', -1).pointMasses[0]!.massKg).toBe(0);
  });

  it('deleteElement drops node-attached project masses with the node', () => {
    const base = legProject();
    const doc: Project = {
      ...base,
      pointMasses: [
        { id: 'pm1', name: 'head foam', massKg: 0.5, attach: { kind: 'node', nodeId: 'n3' } },
        {
          id: 'pm2',
          name: 'battery',
          massKg: 1.4,
          attach: { kind: 'wearerAnchor', anchor: 'beltBack' },
        },
      ],
    };
    // deleting L2 orphans n3 (only L2 touches it)
    const next = deleteElement(doc, 'L2');
    expect(next.pointMasses.map((p) => p.id)).toEqual(['pm2']);
  });
});
