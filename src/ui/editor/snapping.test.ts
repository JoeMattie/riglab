import { describe, expect, it } from 'vitest';
import { dedupConsecutive, isCoincidentFinish } from './snapping';

// Guards for Konva's time-based dblclick (fires for any two clicks within its
// window, regardless of position). Regression coverage for the premature-finish
// bug found in the rope tool during Phase 2 and confirmed in the polyline tool
// during Phase 2 verification: rapid distinct waypoints must NOT finish the
// stroke; only a coincident double-click does.

describe('isCoincidentFinish', () => {
  it('finishes when the last two points are coincident (double-click on one spot)', () => {
    expect(
      isCoincidentFinish([
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 0 },
      ]),
    ).toBe(true);
  });

  it('does not finish on a rapid pair of distinct waypoints', () => {
    expect(
      isCoincidentFinish([
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 1.0, y: 0 },
      ]),
    ).toBe(false);
  });

  it('never finishes with fewer than two points', () => {
    expect(isCoincidentFinish([])).toBe(false);
    expect(isCoincidentFinish([{ x: 0, y: 0 }])).toBe(false);
  });

  it('respects the tolerance', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1e-7, y: 0 },
    ];
    expect(isCoincidentFinish(pts)).toBe(true);
    expect(isCoincidentFinish(pts, 1e-9)).toBe(false);
  });
});

describe('dedupConsecutive', () => {
  it('drops the duplicate the double-click mousedowns inject', () => {
    expect(
      dedupConsecutive([
        { x: 0, y: 0 },
        { x: 0.5, y: 0.25 },
        { x: 1, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.25 },
      { x: 1, y: 0 },
    ]);
  });

  it('keeps non-consecutive repeats (a path may legitimately revisit a point)', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(dedupConsecutive(pts)).toEqual(pts);
  });

  it('handles empty input', () => {
    expect(dedupConsecutive([])).toEqual([]);
  });
});
