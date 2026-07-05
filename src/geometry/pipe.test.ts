import { describe, expect, it } from 'vitest';
import type { Quaternion, Vec3 } from '../schema';
import { rotate } from './math3';
import { bendDihedralsRad, deflectionAngleRad, developedLengthM, polylineLengthM } from './pipe';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Quaternion for a rotation of `angle` about the unit `axis`. */
function axisAngle(axis: Vec3, angle: number): Quaternion {
  const s = Math.sin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

const TILT = axisAngle({ x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) }, 0.7);
const lift = (points: Vec3[], offset: Vec3 = V(0.3, -1.2, 2.5)): Vec3[] =>
  points.map((p) => {
    const r = rotate(TILT, p);
    return V(r.x + offset.x, r.y + offset.y, r.z + offset.z);
  });

describe('polylineLengthM', () => {
  it('sums consecutive segment lengths', () => {
    expect(polylineLengthM([V(0, 0, 0), V(3, 0, 0), V(3, 4, 0)])).toBeCloseTo(7, 9);
  });
  it('measures true 3D distances', () => {
    expect(polylineLengthM([V(0, 0, 0), V(1, 2, 2)])).toBeCloseTo(3, 9);
  });
  it('is zero for a single point', () => {
    expect(polylineLengthM([V(1, 1, 1)])).toBe(0);
  });
  it('is invariant under a rigid transform', () => {
    const pts = [V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(1, 1, 2)];
    expect(polylineLengthM(lift(pts))).toBeCloseTo(polylineLengthM(pts), 9);
  });
});

describe('deflectionAngleRad', () => {
  it('is 0 for a straight run', () => {
    expect(deflectionAngleRad(V(0, 0, 0), V(1, 0, 0), V(2, 0, 0))).toBeCloseTo(0, 9);
  });
  it('is π/2 for a right-angle corner', () => {
    expect(deflectionAngleRad(V(0, 0, 0), V(1, 0, 0), V(1, 1, 0))).toBeCloseTo(Math.PI / 2, 9);
  });
  it('is π/2 for an out-of-plane right angle (plane-independent)', () => {
    expect(deflectionAngleRad(V(0, 0, 0), V(1, 0, 0), V(1, 0, 1))).toBeCloseTo(Math.PI / 2, 9);
  });
  it('is invariant under a rigid transform', () => {
    const [a, b, c] = lift([V(0, 0, 0), V(1, 0, 0), V(1.6, 0.8, 0)]);
    expect(deflectionAngleRad(a!, b!, c!)).toBeCloseTo(
      deflectionAngleRad(V(0, 0, 0), V(1, 0, 0), V(1.6, 0.8, 0)),
      9,
    );
  });
});

describe('developedLengthM', () => {
  const corner = [V(0, 0, 0), V(1, 0, 0), V(1, 1, 0)];

  it('equals the polyline length when all fillet radii are 0', () => {
    expect(developedLengthM(corner, [0])).toBeCloseTo(polylineLengthM(corner), 9);
  });

  it('shortens by r·(2·tan(φ/2) − φ) at a filleted vertex', () => {
    const r = 0.1;
    const phi = Math.PI / 2;
    const reduction = r * (2 * Math.tan(phi / 2) - phi); // ≈ 0.0429204
    expect(developedLengthM(corner, [r])).toBeCloseTo(2 - reduction, 9);
  });

  it('applies the same fillet math to an out-of-plane vertex', () => {
    const r = 0.1;
    const phi = Math.PI / 2;
    const reduction = r * (2 * Math.tan(phi / 2) - phi);
    // right angle turning out of the xy plane — same deflection, same arc
    expect(developedLengthM([V(0, 0, 0), V(1, 0, 0), V(1, 0, 1)], [r])).toBeCloseTo(
      2 - reduction,
      9,
    );
  });

  it('is invariant under a rigid transform', () => {
    const pts = [V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(1, 1, 2)];
    expect(developedLengthM(lift(pts), [0.05, 0.08])).toBeCloseTo(
      developedLengthM(pts, [0.05, 0.08]),
      9,
    );
  });

  it('never returns negative for an over-large fillet', () => {
    expect(developedLengthM(corner, [100])).toBeGreaterThanOrEqual(0);
  });
});

describe('bendDihedralsRad', () => {
  it('is [0] for a single bend (first bend defines the reference plane)', () => {
    expect(bendDihedralsRad([V(0, 0, 0), V(1, 0, 0), V(1, 1, 0)])).toEqual([0]);
  });

  it('is all zeros for a planar U (both bends turn the same way)', () => {
    // A→B→C→D tracing three sides of a square in the xy plane
    const d = bendDihedralsRad([V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(0, 1, 0)]);
    expect(d).toHaveLength(2);
    expect(d[0]).toBeCloseTo(0, 9);
    expect(d[1]).toBeCloseTo(0, 9);
  });

  it('is ±π for a planar S-bend (flip the pipe over in the bender)', () => {
    const d = bendDihedralsRad([V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(2, 1, 0)]);
    expect(Math.abs(d[1]!)).toBeCloseTo(Math.PI, 9);
  });

  it('reports +π/2 when the second bend plane rotates by the right-hand rule', () => {
    // bend 1 in the xy plane (normal +z), bend 2 turning up +z; shared segment
    // travels +y, and rotating +z→+x about +y is +90° right-handed.
    const d = bendDihedralsRad([V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(1, 1, 1)]);
    expect(d[0]).toBeCloseTo(0, 9);
    expect(d[1]).toBeCloseTo(Math.PI / 2, 9);
  });

  it('flips sign for the mirrored polyline', () => {
    const d = bendDihedralsRad([V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(1, 1, -1)]);
    expect(d[1]).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('reports 0 at collinear vertices and measures the next bend against the last real one', () => {
    const d = bendDihedralsRad([
      V(0, 0, 0),
      V(1, 0, 0), // bend 1: xy plane
      V(1, 1, 0), // straight through
      V(1, 2, 0), // bend 2: yz plane, +90° about the +y travel direction
      V(1, 2, 1),
    ]);
    expect(d).toEqual([0, 0, d[2]]);
    expect(d[1]).toBe(0);
    expect(d[2]).toBeCloseTo(Math.PI / 2, 9);
  });

  it('is invariant under a rigid transform', () => {
    const pts = [V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(1, 1, 1), V(0.4, 1.7, 1.1)];
    const a = bendDihedralsRad(pts);
    const b = bendDihedralsRad(lift(pts));
    expect(b).toHaveLength(a.length);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i]!, 9);
  });
});
