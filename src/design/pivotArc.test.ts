// Hinge-plane arc math (Joe's ask): the arc that indicates which plane a
// pivot works in. It must lie in the hinge plane (⊥ axis), sweep the short
// way between the two member directions, and stay silent for joints that
// have no single plane (spherical, fully welded, single-member).
import { describe, expect, it } from 'vitest';
import type { LinkElement, PivotElement, PivotJoint, Vec3 } from '../schema';
import { pivotArcPoints } from './pivotArc';
import { mech, node } from './testFixtures';

const hingeZ: PivotJoint = { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } };

/** Two links meeting at n0: n1—n0—n2, with a pivot at n0. */
function elbow(
  joint: PivotJoint,
  welds: [string, string][] = [],
  n1: Vec3 = { x: 1, y: 0, z: 0 },
  n2: Vec3 = { x: 0, y: 1, z: 0 },
): { m: ReturnType<typeof mech>; pivot: PivotElement; pos: Record<string, Vec3> } {
  const L1: LinkElement = {
    id: 'L1',
    type: 'link',
    maturity: 'sketch',
    nodeA: 'n0',
    nodeB: 'n1',
    pointMasses: [],
  };
  const L2: LinkElement = { ...L1, id: 'L2', nodeA: 'n0', nodeB: 'n2' };
  const pivot: PivotElement = {
    id: 'P',
    type: 'pivot',
    maturity: 'sketch',
    nodeId: 'n0',
    joint,
    memberIds: ['L1', 'L2'],
    welds,
  };
  const pos: Record<string, Vec3> = {
    n0: { x: 0, y: 0, z: 0 },
    n1,
    n2,
  };
  const m = mech(
    [L1, L2, pivot],
    [node('n0', 0, 0), node('n1', n1.x, n1.y, n1.z), node('n2', n2.x, n2.y, n2.z)],
  );
  return { m, pivot, pos };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

describe('pivotArcPoints', () => {
  it('lies in the hinge plane at the given radius, endpoints on each member', () => {
    const { m, pivot, pos } = elbow(hingeZ);
    const pts = pivotArcPoints(m, pivot, pos, 0.2, 16)!;
    expect(pts).not.toBeNull();
    expect(pts.length).toBe(17);
    for (const p of pts) {
      // in the z = 0 hinge plane (axis +z)
      expect(dot(p, { x: 0, y: 0, z: 1 })).toBeCloseTo(0, 9);
      // on the radius-0.2 circle about the node
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(0.2, 9);
    }
    // first point toward L1 (+x), last toward L2 (+y)
    expect(pts[0]).toMatchObject({ x: expect.closeTo(0.2, 9), y: expect.closeTo(0, 9) });
    const last = pts[pts.length - 1]!;
    expect(last.x).toBeCloseTo(0, 9);
    expect(last.y).toBeCloseTo(0.2, 9);
  });

  it('sweeps the SHORT way (a 90° elbow sweeps 90°, never 270°)', () => {
    const { m, pivot, pos } = elbow(hingeZ);
    const pts = pivotArcPoints(m, pivot, pos, 0.2, 32)!;
    // total turned angle between consecutive chord directions ≈ 90°
    let total = 0;
    for (let i = 2; i < pts.length; i++) {
      const a = { x: pts[i - 1]!.x - pts[i - 2]!.x, y: pts[i - 1]!.y - pts[i - 2]!.y, z: 0 };
      const b = { x: pts[i]!.x - pts[i - 1]!.x, y: pts[i]!.y - pts[i - 1]!.y, z: 0 };
      const la = Math.hypot(a.x, a.y);
      const lb = Math.hypot(b.x, b.y);
      total += Math.acos(Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)));
    }
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(Math.PI); // well under a half-turn
  });

  it('orients in the hinge plane: an x-axis hinge arcs in the y-z plane', () => {
    const hingeX: PivotJoint = { kind: 'hinge', axis: { x: 1, y: 0, z: 0 } };
    // members in the y-z plane so the arc has something to sweep
    const { m, pivot, pos } = elbow(hingeX, [], { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    const pts = pivotArcPoints(m, pivot, pos, 0.2, 12)!;
    for (const p of pts) expect(p.x).toBeCloseTo(0, 9); // stays in x = 0
  });

  it('is null for spherical, fully-welded, and single-member joints', () => {
    const sph = elbow({ kind: 'spherical' });
    expect(pivotArcPoints(sph.m, sph.pivot, sph.pos, 0.2)).toBeNull();

    const welded = elbow(hingeZ, [['L1', 'L2']]);
    expect(pivotArcPoints(welded.m, welded.pivot, welded.pos, 0.2)).toBeNull();

    const single = elbow(hingeZ);
    single.pivot.memberIds = ['L1'];
    expect(pivotArcPoints(single.m, single.pivot, single.pos, 0.2)).toBeNull();
  });

  it('a weld+pivot junction arcs the arriving pipe against the through pipe', () => {
    // through pipe L1(+x)/L2(−x) welded; arrival L3(+y) pivots
    const L1: LinkElement = {
      id: 'L1',
      type: 'link',
      maturity: 'sketch',
      nodeA: 'n0',
      nodeB: 'n1',
      pointMasses: [],
    };
    const L2: LinkElement = { ...L1, id: 'L2', nodeA: 'n0', nodeB: 'n2' };
    const L3: LinkElement = { ...L1, id: 'L3', nodeA: 'n0', nodeB: 'n3' };
    const pivot: PivotElement = {
      id: 'P',
      type: 'pivot',
      maturity: 'sketch',
      nodeId: 'n0',
      joint: hingeZ,
      memberIds: ['L1', 'L2', 'L3'],
      welds: [['L1', 'L2']],
    };
    const pos: Record<string, Vec3> = {
      n0: { x: 0, y: 0, z: 0 },
      n1: { x: 1, y: 0, z: 0 },
      n2: { x: -1, y: 0, z: 0 },
      n3: { x: 0, y: 1, z: 0 },
    };
    const m = mech(
      [L1, L2, L3, pivot],
      [node('n0', 0, 0), node('n1', 1, 0), node('n2', -1, 0), node('n3', 0, 1)],
    );
    const pts = pivotArcPoints(m, pivot, pos, 0.2, 16)!;
    expect(pts).not.toBeNull();
    // arc between the arrival (+y) and a through-pipe half (±x): 90°, in-plane
    for (const p of pts) expect(p.z).toBeCloseTo(0, 9);
  });
});
