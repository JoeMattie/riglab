import { describe, expect, it } from 'vitest';
import type { Mechanism, Vec2 } from '../schema';
import { elementIdsInRect, normalizedRect, segmentIntersectsRect } from './marquee';

const rect = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe('segmentIntersectsRect — crossing semantics', () => {
  const r = rect(0, 0, 1, 1);

  it('accepts a segment fully inside', () => {
    expect(segmentIntersectsRect({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, r)).toBe(true);
  });

  it('accepts a segment crossing through with both endpoints outside', () => {
    expect(segmentIntersectsRect({ x: -1, y: 0.5 }, { x: 2, y: 0.5 }, r)).toBe(true);
  });

  it('accepts a segment with one endpoint inside', () => {
    expect(segmentIntersectsRect({ x: 0.5, y: 0.5 }, { x: 5, y: 5 }, r)).toBe(true);
  });

  it('rejects a disjoint segment', () => {
    expect(segmentIntersectsRect({ x: 2, y: 2 }, { x: 3, y: 2 }, r)).toBe(false);
  });

  it('rejects a segment whose bounding box overlaps but which passes outside a corner', () => {
    // runs diagonally past the top-right corner without entering
    expect(segmentIntersectsRect({ x: 0.9, y: 2 }, { x: 2, y: 0.9 }, r)).toBe(false);
  });
});

describe('normalizedRect', () => {
  it('orders any two corners into min/max form', () => {
    expect(normalizedRect({ x: 3, y: 1 }, { x: 1, y: 4 })).toEqual(rect(1, 1, 3, 4));
  });
});

/** Minimal v7 mechanism exercising every hit-testable element type. The node
 * positions here are Vec3 (document space); the `positions` record handed to
 * elementIdsInRect is the PROJECTED panel-plane view of them (z dropped —
 * exactly what the quad panel's projection produces for the side panel).
 * Layout (metres):  n1(0,0) — link l1 — n2(1,0);  n3(2,2) — link l2 — n4(3,2)
 * pivot p1 at n2; slider s1 at n3; rope through n1→n3→n4;
 * elastic n1–n2; bowden (n1,n2 | n3,n4); torsion cable p1↔p2 (p2 at n4). */
function testMech(): Mechanism {
  const node = (id: string, x: number, y: number) => ({
    id,
    kind: 'free' as const,
    position: { x, y, z: 0.25 },
  });
  const base = { maturity: 'sketch' as const, pointMasses: [] };
  const hinge = { kind: 'hinge' as const, axis: { x: 0, y: 0, z: 1 } };
  return {
    id: 'm1',
    name: 'test',
    nodes: [node('n1', 0, 0), node('n2', 1, 0), node('n3', 2, 2), node('n4', 3, 2)],
    elements: [
      { ...base, id: 'l1', type: 'link', nodeA: 'n1', nodeB: 'n2' },
      { ...base, id: 'l2', type: 'link', nodeA: 'n3', nodeB: 'n4' },
      {
        id: 'p1',
        type: 'pivot',
        maturity: 'sketch',
        nodeId: 'n2',
        joint: hinge,
        memberIds: ['l1', 'l2'],
        welds: [],
      },
      {
        id: 'p2',
        type: 'pivot',
        maturity: 'sketch',
        nodeId: 'n4',
        joint: hinge,
        memberIds: ['l1', 'l2'],
        welds: [],
      },
      {
        id: 's1',
        type: 'slider',
        maturity: 'sketch',
        nodeId: 'n3',
        alongElementId: 'l1',
        travelMin: 0,
        travelMax: 1,
      },
      { ...base, id: 'r1', type: 'rope', path: ['n1', 'n3', 'n4'], lengthM: 5 },
      {
        ...base,
        id: 'e1',
        type: 'elastic',
        nodeA: 'n1',
        nodeB: 'n2',
        restLengthM: 1,
        stiffnessNPerM: 100,
        tensionOnly: true,
      },
      {
        ...base,
        id: 'b1',
        type: 'bowden',
        a1: 'n1',
        a2: 'n2',
        b1: 'n3',
        b2: 'n4',
        restLengthAM: 1,
        restLengthBM: 1,
      },
      {
        ...base,
        id: 't1',
        type: 'torsionCable',
        pivotA: 'p1',
        pivotB: 'p2',
        ratio: 1,
        backlashRad: 0,
      },
    ],
    pointMasses: [],
    skeletonBindings: [],
    anchorBindings: [],
    inputs: [],
    namedStates: [],
  };
}

/** Project the Vec3 document positions into the side panel's plane (drop z) —
 * what the quad UI does before calling elementIdsInRect. */
const positionsOf = (m: Mechanism): Record<string, Vec2> =>
  Object.fromEntries(m.nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));

describe('elementIdsInRect', () => {
  const mech = testMech();
  const positions = positionsOf(mech);

  it('selects span elements crossing the box and node elements whose node is inside', () => {
    // box around n2 (1,0): l1 and e1 end there, the pivot p1 sits there,
    // bowden segment a crosses; l2 / s1 / p2 are far away
    const ids = elementIdsInRect(mech, positions, rect(0.9, -0.1, 1.1, 0.1));
    expect(ids).toContain('l1');
    expect(ids).toContain('e1');
    expect(ids).toContain('p1');
    expect(ids).toContain('b1');
    expect(ids).not.toContain('l2');
    expect(ids).not.toContain('s1');
    expect(ids).not.toContain('p2');
  });

  it('selects a rope by any intermediate path segment', () => {
    // box straddling the n1→n3 leg mid-way, away from every node
    const ids = elementIdsInRect(mech, positions, rect(0.9, 0.9, 1.1, 1.1));
    expect(ids).toEqual(['r1']);
  });

  it('selects a torsion cable when either coupled pivot node is inside', () => {
    const ids = elementIdsInRect(mech, positions, rect(2.9, 1.9, 3.1, 2.1));
    expect(ids).toContain('t1');
    expect(ids).toContain('p2');
  });

  it('selects everything with an enclosing box and nothing with a disjoint one', () => {
    const all = elementIdsInRect(mech, positions, rect(-1, -1, 4, 3));
    expect(all.sort()).toEqual(mech.elements.map((e) => e.id).sort());
    expect(elementIdsInRect(mech, positions, rect(10, 10, 11, 11))).toEqual([]);
  });

  it('uses the passed (posed) positions, not the document rest pose', () => {
    const posed = { ...positions, n2: { x: 5, y: 5 } };
    const ids = elementIdsInRect(mech, posed, rect(4.9, 4.9, 5.1, 5.1));
    expect(ids).toContain('p1'); // pivot rides its node
    expect(ids).toContain('l1'); // link endpoint moved into the box
  });

  it('skips geometry with missing positions instead of throwing', () => {
    const sparse: Record<string, Vec2> = { n1: { x: 0, y: 0 } };
    expect(() => elementIdsInRect(mech, sparse, rect(-1, -1, 4, 3))).not.toThrow();
  });
});
