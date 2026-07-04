import { describe, expect, it } from 'vitest';
import { FOUR_BAR, circleCircleIntersection, crankTip, fourBarB, fourBarInitial } from './analytic';
import { dist } from './types';

describe('analytic four-bar', () => {
  it('is a Grashof crank-rocker (shortest link is the crank)', () => {
    const { a, b, c, d } = FOUR_BAR;
    const lengths = [a, b, c, d].sort((x, y) => x - y);
    const [s, p, q, l] = lengths as [number, number, number, number];
    expect(s + l).toBeLessThanOrEqual(p + q);
    expect(s).toBe(a);
  });

  it('crank tip stays on the crank circle', () => {
    for (let k = 0; k < 36; k++) {
      const A = crankTip(FOUR_BAR, (k * 2 * Math.PI) / 36);
      expect(Math.hypot(A.x, A.y)).toBeCloseTo(FOUR_BAR.a, 12);
    }
  });

  it('B satisfies coupler and rocker lengths through a full crank rotation', () => {
    let prevB = fourBarInitial(FOUR_BAR).B;
    for (let k = 1; k <= 360; k++) {
      const theta = Math.PI / 2 + (k * 2 * Math.PI) / 360;
      const A = crankTip(FOUR_BAR, theta);
      const B = fourBarB(FOUR_BAR, theta, prevB);
      expect(dist(A, B)).toBeCloseTo(FOUR_BAR.b, 10);
      expect(dist(B, { x: FOUR_BAR.d, y: 0 })).toBeCloseTo(FOUR_BAR.c, 10);
      // branch continuity: B moves smoothly, never jumps to the mirror branch
      expect(dist(B, prevB)).toBeLessThan(0.05);
      prevB = B;
    }
  });

  it('circle intersection handles tangent and disjoint cases', () => {
    expect(circleCircleIntersection({ x: 0, y: 0 }, 1, { x: 3, y: 0 }, 1)).toBeNull();
    expect(circleCircleIntersection({ x: 0, y: 0 }, 1, { x: 0.1, y: 0 }, 3)).toBeNull();
    const sols = circleCircleIntersection({ x: 0, y: 0 }, 1, { x: 2, y: 0 }, 1);
    expect(sols).not.toBeNull();
    if (sols) {
      expect(sols[0].x).toBeCloseTo(1, 12);
      expect(sols[0].y).toBeCloseTo(0, 6);
    }
  });
});
