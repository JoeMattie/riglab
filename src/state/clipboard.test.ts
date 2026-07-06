// Clipboard copy/paste (PLANFILE-quad-panel-controls C) — the correctness-
// critical remap suite: closure rules on copy, fresh ids + full reference
// remapping on paste, channel-binding policy, and snapshot semantics.
import { describe, expect, it } from 'vitest';
import { mech, node, projectWith } from '../design/testFixtures';
import type {
  BentLinkElement,
  BowdenElement,
  ElasticElement,
  LinkElement,
  MechanismElement,
  PivotElement,
  Project,
  RopeElement,
  SliderElement,
  TelescopeElement,
  TorsionCableElement,
} from '../schema';
import { type ClipboardPayload, copyPayload, pastePayload } from './clipboard';
import { deleteElement } from './docOps';

const NO_OFFSET = { x: 0, y: 0, z: 0 };
const OFFSET = { x: 0.1, y: -0.1, z: 0.05 };

const link = (id: string, a: string, b: string): LinkElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA: a,
  nodeB: b,
  pointMasses: [],
});

/** One mechanism exercising every element type and every cross-reference:
 * two hinged+welded links with limit/spring, a third link for a second
 * pivot, a torsion cable across the pivots, a slider on L1, a rope, an
 * elastic, a bowden, a telescope anchored under a single-member ground
 * hinge, and a bentLink with point masses. n5 is driven by channel ch1;
 * n8 is driven by a channel that no longer exists. */
function rig(): Project {
  const L1 = link('L1', 'n1', 'n2');
  const L2 = link('L2', 'n2', 'n3');
  const L3 = link('L3', 'n3', 'n4');
  const P1: PivotElement = {
    id: 'P1',
    type: 'pivot',
    maturity: 'sketch',
    nodeId: 'n2',
    joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
    memberIds: ['L1', 'L2'],
    welds: [['L1', 'L2']],
    angleLimit: { memberA: 'L1', memberB: 'L2', minRad: -1, maxRad: 1 },
    torsionSpring: { memberA: 'L1', memberB: 'L2', stiffnessNmPerRad: 2, restAngleRad: 0.2 },
  };
  const P2: PivotElement = {
    id: 'P2',
    type: 'pivot',
    maturity: 'sketch',
    nodeId: 'n3',
    joint: { kind: 'spherical' },
    memberIds: ['L2', 'L3'],
    welds: [],
  };
  const TC: TorsionCableElement = {
    id: 'TC',
    type: 'torsionCable',
    maturity: 'sketch',
    pivotA: 'P1',
    pivotB: 'P2',
    ratio: -1.5,
    backlashRad: 0.1,
  };
  const S1: SliderElement = {
    id: 'S1',
    type: 'slider',
    maturity: 'sketch',
    nodeId: 'n5',
    alongElementId: 'L1',
    travelMin: 0.1,
    travelMax: 0.9,
  };
  const R1: RopeElement = {
    id: 'R1',
    type: 'rope',
    maturity: 'sketch',
    path: ['n1', 'n4', 'n5'],
    lengthM: 3,
  };
  const E1: ElasticElement = {
    id: 'E1',
    type: 'elastic',
    maturity: 'sketch',
    nodeA: 'n1',
    nodeB: 'n4',
    slackLengthM: 1,
    stiffnessNPerM: 200,
  };
  const B1: BowdenElement = {
    id: 'B1',
    type: 'bowden',
    maturity: 'sketch',
    a1: 'n1',
    a2: 'n2',
    b1: 'n3',
    b2: 'n4',
    restLengthAM: 1,
    restLengthBM: 1,
  };
  const T1: TelescopeElement = {
    id: 'T1',
    type: 'telescope',
    maturity: 'sketch',
    nodeA: 'n6',
    nodeB: 'n7',
    minLengthM: 0.5,
    maxLengthM: 1.5,
    lengthM: 1,
    sliding: false,
    pointMasses: [{ id: 'tm1', name: 'motor', massKg: 0.4, t: 0.5 }],
  };
  // single-member GROUND HINGE at the anchored node n6
  const G1: PivotElement = {
    id: 'G1',
    type: 'pivot',
    maturity: 'sketch',
    nodeId: 'n6',
    joint: { kind: 'hinge', axis: { x: 0, y: 1, z: 0 } },
    memberIds: ['T1'],
    welds: [],
  };
  const BL: BentLinkElement = {
    id: 'BL',
    type: 'bentLink',
    maturity: 'sketch',
    nodeIds: ['n4', 'n8', 'n9'],
    filletRadiiM: [0.05],
    pointMasses: [{ id: 'bm1', name: 'head foam', massKg: 0.2, t: 0.9 }],
  };
  const nodes = [
    node('n1', 0, 0),
    node('n2', 1, 0),
    node('n3', 2, 0),
    node('n4', 3, 0, 0.4),
    { ...node('n5', 0.5, 0), kind: 'driven' as const, channelId: 'ch1' },
    { ...node('n6', 0, 2), kind: 'anchor' as const },
    node('n7', 1, 2),
    { ...node('n8', 3.5, 1), kind: 'driven' as const, channelId: 'ch-gone' },
    node('n9', 4, 2),
  ];
  return projectWith(
    mech([L1, L2, L3, P1, P2, TC, S1, R1, E1, B1, T1, G1, BL], nodes, {
      inputs: [
        { id: 'ch1', name: 'jaw', kind: 'displacement', min: 0, max: 1, value: 0, locked: false },
      ],
    }),
  );
}

const ALL_IDS = ['L1', 'L2', 'L3', 'P1', 'P2', 'TC', 'S1', 'R1', 'E1', 'B1', 'T1', 'G1', 'BL'];

function byType<T extends MechanismElement['type']>(
  els: MechanismElement[],
  type: T,
): Extract<MechanismElement, { type: T }>[] {
  return els.filter((e): e is Extract<MechanismElement, { type: T }> => e.type === type);
}

describe('copyPayload: closure rules', () => {
  it('captures the selected elements plus every node they reference', () => {
    const doc = rig();
    const p = copyPayload(doc, ALL_IDS)!;
    expect(p.elements.map((e) => e.id).sort()).toEqual([...ALL_IDS].sort());
    expect(p.nodes.map((n) => n.id).sort()).toEqual(
      ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'].sort(),
    );
  });

  it('shared nodes appear once', () => {
    const p = copyPayload(rig(), ['L1', 'L2'])!;
    expect(p.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('a pivot needs ≥2 in-selection members', () => {
    expect(copyPayload(rig(), ['P1'])).toBeNull();
    const p = copyPayload(rig(), ['L1', 'P1'])!; // only 1 of P1's 2 members
    expect(p.elements.map((e) => e.id)).toEqual(['L1']);
  });

  it('a single-member ground hinge travels with its member', () => {
    const p = copyPayload(rig(), ['T1', 'G1'])!;
    expect(p.elements.map((e) => e.id).sort()).toEqual(['G1', 'T1']);
  });

  it('a slider needs its rail', () => {
    expect(copyPayload(rig(), ['S1'])).toBeNull();
    const p = copyPayload(rig(), ['L1', 'S1'])!;
    expect(p.elements.map((e) => e.id).sort()).toEqual(['L1', 'S1']);
  });

  it('a torsion cable needs both pivots — re-checked after pivot filtering', () => {
    // P2 selected but loses L3 → P2 drops → TC drops with it
    const p = copyPayload(rig(), ['L1', 'L2', 'P1', 'P2', 'TC'])!;
    expect(p.elements.map((e) => e.id).sort()).toEqual(['L1', 'L2', 'P1']);
    const full = copyPayload(rig(), ['L1', 'L2', 'L3', 'P1', 'P2', 'TC'])!;
    expect(full.elements.map((e) => e.id)).toContain('TC');
  });

  it('returns null for an empty or uncopyable selection', () => {
    expect(copyPayload(rig(), [])).toBeNull();
    expect(copyPayload(rig(), ['nope'])).toBeNull();
  });
});

describe('pastePayload: fresh ids + full reference remap', () => {
  function pasteAll(): {
    src: Project;
    doc: Project;
    newElementIds: string[];
    pasted: MechanismElement[];
  } {
    const src = rig();
    const payload = copyPayload(src, ALL_IDS)!;
    const { doc, newElementIds } = pastePayload(src, payload, OFFSET);
    const newSet = new Set(newElementIds);
    return {
      src,
      doc,
      newElementIds,
      pasted: doc.mechanism.elements.filter((e) => newSet.has(e.id)),
    };
  }

  it('adds fresh nodes and elements without touching the originals', () => {
    const { src, doc, pasted } = pasteAll();
    expect(doc.mechanism.elements).toHaveLength(src.mechanism.elements.length * 2);
    expect(doc.mechanism.nodes).toHaveLength(src.mechanism.nodes.length * 2);
    const oldElementIds = new Set(src.mechanism.elements.map((e) => e.id));
    const oldNodeIds = new Set(src.mechanism.nodes.map((n) => n.id));
    for (const e of pasted) expect(oldElementIds.has(e.id)).toBe(false);
    // no pasted element references ANY old node or old element id
    for (const e of pasted) {
      const refs: string[] = [];
      if (e.type === 'link' || e.type === 'telescope' || e.type === 'elastic') {
        refs.push(e.nodeA, e.nodeB);
      }
      if (e.type === 'bentLink') refs.push(...e.nodeIds);
      if (e.type === 'pivot') refs.push(e.nodeId, ...e.memberIds, ...e.welds.flat());
      if (e.type === 'slider') refs.push(e.nodeId, e.alongElementId);
      if (e.type === 'rope') refs.push(...e.path);
      if (e.type === 'bowden') refs.push(e.a1, e.a2, e.b1, e.b2);
      if (e.type === 'torsionCable') refs.push(e.pivotA, e.pivotB);
      for (const r of refs) {
        expect(oldNodeIds.has(r)).toBe(false);
        expect(oldElementIds.has(r)).toBe(false);
      }
    }
  });

  it('remaps pivot members, welds, angle limit, and torsion spring consistently', () => {
    const { pasted, newElementIds } = pasteAll();
    const newSet = new Set(newElementIds);
    const p1 = byType(pasted, 'pivot').find((p) => p.welds.length === 1)!;
    expect(p1.memberIds).toHaveLength(2);
    for (const m of p1.memberIds) expect(newSet.has(m)).toBe(true);
    expect(p1.welds[0]).toEqual([p1.memberIds[0], p1.memberIds[1]]);
    expect(p1.angleLimit).toMatchObject({
      memberA: p1.memberIds[0],
      memberB: p1.memberIds[1],
      minRad: -1,
      maxRad: 1,
    });
    expect(p1.torsionSpring).toMatchObject({
      memberA: p1.memberIds[0],
      memberB: p1.memberIds[1],
      stiffnessNmPerRad: 2,
    });
    // the hinge axis pastes untransformed
    expect(p1.joint).toEqual({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } });
  });

  it('remaps the torsion cable onto the pasted pivots', () => {
    const { pasted } = pasteAll();
    const tc = byType(pasted, 'torsionCable')[0]!;
    const pivotIds = new Set(byType(pasted, 'pivot').map((p) => p.id));
    expect(pivotIds.has(tc.pivotA)).toBe(true);
    expect(pivotIds.has(tc.pivotB)).toBe(true);
    expect(tc.ratio).toBe(-1.5);
    expect(tc.backlashRad).toBe(0.1);
  });

  it('remaps the slider node + rail, rope path, bowden endpoints, bentLink chain', () => {
    const { doc, pasted } = pasteAll();
    const nodeIds = new Set(doc.mechanism.nodes.map((n) => n.id));
    const s = byType(pasted, 'slider')[0]!;
    const rail = pasted.find((e) => e.id === s.alongElementId);
    expect(rail?.type).toBe('link');
    expect(nodeIds.has(s.nodeId)).toBe(true);
    const r = byType(pasted, 'rope')[0]!;
    expect(r.path).toHaveLength(3);
    for (const id of r.path) expect(nodeIds.has(id)).toBe(true);
    const b = byType(pasted, 'bowden')[0]!;
    for (const id of [b.a1, b.a2, b.b1, b.b2]) expect(nodeIds.has(id)).toBe(true);
    const bl = byType(pasted, 'bentLink')[0]!;
    expect(bl.nodeIds).toHaveLength(3);
    for (const id of bl.nodeIds) expect(nodeIds.has(id)).toBe(true);
    expect(bl.filletRadiiM).toEqual([0.05]);
  });

  it('gives attached point masses fresh ids but keeps their data', () => {
    const { pasted } = pasteAll();
    const t = byType(pasted, 'telescope')[0]!;
    expect(t.pointMasses).toHaveLength(1);
    expect(t.pointMasses[0]!.id).not.toBe('tm1');
    expect(t.pointMasses[0]).toMatchObject({ name: 'motor', massKg: 0.4, t: 0.5 });
    const bl = byType(pasted, 'bentLink')[0]!;
    expect(bl.pointMasses[0]!.id).not.toBe('bm1');
  });

  it('offsets every pasted node and keeps node kinds', () => {
    const { src, doc, pasted } = pasteAll();
    const srcByPos = new Map(src.mechanism.nodes.map((n) => [n.id, n]));
    const pastedNodeIds = new Set<string>();
    for (const e of pasted) {
      if (e.type === 'link' || e.type === 'telescope' || e.type === 'elastic') {
        pastedNodeIds.add(e.nodeA).add(e.nodeB);
      }
    }
    expect(pastedNodeIds.size).toBeGreaterThan(0);
    for (const id of pastedNodeIds) {
      const n = doc.mechanism.nodes.find((x) => x.id === id)!;
      // find the source node at position − offset
      const match = [...srcByPos.values()].find(
        (s) =>
          Math.abs(s.position.x + OFFSET.x - n.position.x) < 1e-12 &&
          Math.abs(s.position.y + OFFSET.y - n.position.y) < 1e-12 &&
          Math.abs(s.position.z + OFFSET.z - n.position.z) < 1e-12,
      );
      expect(match).toBeDefined();
    }
    // the anchored telescope end pastes still anchored
    const t = byType(pasted, 'telescope')[0]!;
    expect(doc.mechanism.nodes.find((n) => n.id === t.nodeA)!.kind).toBe('anchor');
  });

  it('driven nodes keep an existing channel; a missing channel demotes to free', () => {
    const { doc, pasted } = pasteAll();
    const s = byType(pasted, 'slider')[0]!; // rides n5 (driven by ch1)
    const sliderNode = doc.mechanism.nodes.find((n) => n.id === s.nodeId)!;
    expect(sliderNode.kind).toBe('driven');
    expect(sliderNode.channelId).toBe('ch1');
    const bl = byType(pasted, 'bentLink')[0]!; // its middle node rode ch-gone
    const middle = doc.mechanism.nodes.find((n) => n.id === bl.nodeIds[1])!;
    expect(middle.kind).toBe('free');
    expect(middle.channelId).toBeUndefined();
  });

  it('copies no wearer bindings and joins no group', () => {
    const base = rig();
    const src: Project = {
      ...base,
      mechanism: {
        ...base.mechanism,
        skeletonBindings: [{ id: 'sb1', point: 'head', nodeId: 'n4' }],
        anchorBindings: [{ id: 'ab1', anchor: 'spineTop', nodeId: 'n6' }],
      },
      groups: [{ id: 'g1', name: 'leg', elementIds: ['L1', 'L2'] }],
    };
    const payload = copyPayload(src, ALL_IDS)!;
    const { doc } = pastePayload(src, payload, NO_OFFSET);
    expect(doc.mechanism.skeletonBindings).toHaveLength(1);
    expect(doc.mechanism.anchorBindings).toHaveLength(1);
    expect(doc.groups).toEqual(src.groups);
  });

  it('prunes welds/limits/springs whose member did not travel', () => {
    // P3 joins three members with a weld and a limit touching L4; selecting
    // only L1+L2+P3 keeps the pivot but prunes everything referencing L4
    const base = rig();
    const L4 = link('L4', 'n2', 'n9');
    const P3: PivotElement = {
      id: 'P3',
      type: 'pivot',
      maturity: 'sketch',
      nodeId: 'n2',
      joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
      memberIds: ['L1', 'L2', 'L4'],
      welds: [['L1', 'L4']],
      angleLimit: { memberA: 'L1', memberB: 'L4', minRad: -1, maxRad: 1 },
      torsionSpring: { memberA: 'L2', memberB: 'L4', stiffnessNmPerRad: 1, restAngleRad: 0 },
    };
    const src: Project = {
      ...base,
      mechanism: {
        ...base.mechanism,
        elements: [...base.mechanism.elements.filter((e) => e.id !== 'P1'), L4, P3],
      },
    };
    const payload = copyPayload(src, ['L1', 'L2', 'P3'])!;
    const { doc, newElementIds } = pastePayload(src, payload, NO_OFFSET);
    const copy = doc.mechanism.elements.find(
      (e): e is PivotElement => e.type === 'pivot' && newElementIds.includes(e.id),
    )!;
    expect(copy.memberIds).toHaveLength(2);
    expect(copy.welds).toEqual([]);
    expect(copy.angleLimit).toBeUndefined();
    expect(copy.torsionSpring).toBeUndefined();
  });

  it('pasting twice yields disjoint id sets', () => {
    const src = rig();
    const payload = copyPayload(src, ALL_IDS)!;
    const first = pastePayload(src, payload, OFFSET);
    const second = pastePayload(first.doc, payload, OFFSET);
    const a = new Set(first.newElementIds);
    for (const id of second.newElementIds) expect(a.has(id)).toBe(false);
    expect(second.doc.mechanism.elements).toHaveLength(src.mechanism.elements.length * 3);
  });

  it('is a snapshot: paste still works after the source is deleted', () => {
    const src = rig();
    const payload = copyPayload(src, ['L1'])!;
    let doc = deleteElement(src, 'L1');
    expect(doc.mechanism.elements.find((e) => e.id === 'L1')).toBeUndefined();
    const r = pastePayload(doc, payload, OFFSET);
    doc = r.doc;
    expect(r.newElementIds).toHaveLength(1);
    const copy = doc.mechanism.elements.find((e) => e.id === r.newElementIds[0]);
    expect(copy?.type).toBe('link');
  });

  it('an empty payload is a no-op', () => {
    const src = rig();
    const r = pastePayload(src, { elements: [], nodes: [] } satisfies ClipboardPayload, OFFSET);
    expect(r.doc).toBe(src);
    expect(r.newElementIds).toEqual([]);
  });
});
