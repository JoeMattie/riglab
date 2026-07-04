import { describe, expect, it } from 'vitest';
import { deflectionAngleRad, developedLengthM, polylineLengthM } from './pipe';

describe('polylineLengthM', () => {
  it('sums consecutive segment lengths', () => {
    expect(
      polylineLengthM([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBeCloseTo(7, 9);
  });
  it('is zero for a single point', () => {
    expect(polylineLengthM([{ x: 1, y: 1 }])).toBe(0);
  });
});

describe('deflectionAngleRad', () => {
  it('is 0 for a straight run', () => {
    expect(deflectionAngleRad({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(0, 9);
  });
  it('is π/2 for a right-angle corner', () => {
    expect(deflectionAngleRad({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(
      Math.PI / 2,
      9,
    );
  });
});

describe('developedLengthM', () => {
  const corner = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ];

  it('equals the polyline length when all fillet radii are 0', () => {
    expect(developedLengthM(corner, [0])).toBeCloseTo(polylineLengthM(corner), 9);
  });

  it('shortens by r·(2·tan(φ/2) − φ) at a filleted vertex', () => {
    const r = 0.1;
    const phi = Math.PI / 2;
    const reduction = r * (2 * Math.tan(phi / 2) - phi); // ≈ 0.0429204
    expect(developedLengthM(corner, [r])).toBeCloseTo(2 - reduction, 9);
  });

  it('never returns negative for an over-large fillet', () => {
    expect(developedLengthM(corner, [100])).toBeGreaterThanOrEqual(0);
  });
});
