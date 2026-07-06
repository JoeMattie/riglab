import { describe, expect, it } from 'vitest';
import { mech, node } from '../../bom/testHelpers';
import type { BentLinkElement, LinkElement, SkeletonPoint, Vec2, WearerAnchor } from '../../schema';
import type { Silhouette } from '../../wearer';
import { dedupConsecutive, findBentLinkHit, findSnap, isCoincidentFinish } from './snapping';

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

// Regression for the endpoint-drag oscillation: while dragging a pipe's
// endpoint, the pipe's own span (and every other element incident to the
// dragged node) moves with the pointer, so snapping onto it chases a moving
// target. `excludeElements` must suppress those onPipe candidates.
describe('findSnap excludeElements', () => {
  const L1: LinkElement = {
    id: 'L1',
    type: 'link',
    maturity: 'sketch',
    nodeA: 'n1',
    nodeB: 'n2',
    pointMasses: [],
  };
  const m = mech([L1], [node('n1', 0, 0), node('n2', 1, 0)]);
  const positions = { n1: { x: 0, y: 0 }, n2: { x: 1, y: 0 } };
  const near = { x: 0.5, y: 0.005 }; // just off the pipe's midpoint

  it('normally snaps onto the pipe span', () => {
    const snap = findSnap(near, { mechanism: m, positions, silhouette: null, tolM: 0.02 });
    expect(snap.kind).toBe('onPipe');
  });

  it('with the element excluded, falls through to the grid', () => {
    const snap = findSnap(near, {
      mechanism: m,
      positions,
      silhouette: null,
      tolM: 0.02,
      exclude: new Set(['n2']),
      excludeElements: new Set(['L1']),
    });
    expect(snap.kind).toBe('grid');
  });
});

// Top-bar snap toggles (SnapPrefs → SnapContext.sources): each source can be
// switched off independently; with grid off the fallback carries the RAW
// pointer position instead of rounding to the grid.
describe('findSnap sources (top-bar snap toggles)', () => {
  const L1: LinkElement = {
    id: 'L1',
    type: 'link',
    maturity: 'sketch',
    nodeA: 'n1',
    nodeB: 'n2',
    pointMasses: [],
  };
  const m = mech([L1], [node('n1', 0, 0), node('n2', 1, 0)]);
  const positions = { n1: { x: 0, y: 0 }, n2: { x: 1, y: 0 } };
  const ctx = (sources: { ends: boolean; pipes: boolean; grid: boolean }) => ({
    mechanism: m,
    positions,
    silhouette: null,
    tolM: 0.02,
    sources,
  });

  it('ends off: a point on a node falls through to the pipe span or grid', () => {
    const nearEnd = { x: 0.005, y: 0 };
    expect(findSnap(nearEnd, ctx({ ends: true, pipes: true, grid: true })).kind).toBe('node');
    expect(findSnap(nearEnd, ctx({ ends: false, pipes: true, grid: true })).kind).not.toBe('node');
  });

  it('pipes off: a point on the span falls through to the grid', () => {
    const nearSpan = { x: 0.4, y: 0.005 };
    expect(findSnap(nearSpan, ctx({ ends: true, pipes: true, grid: true })).kind).toBe('onPipe');
    expect(findSnap(nearSpan, ctx({ ends: true, pipes: false, grid: true })).kind).toBe('grid');
  });

  it('gridBasis: the fallback rounds to the projected ground lattice (iso)', () => {
    // a 45°-ish lattice: u along (1,1), v along (-1,1), step 0.1
    const u = { x: 0.1, y: 0.1 };
    const v = { x: -0.1, y: 0.1 };
    const snapped = findSnap(
      { x: 0.19, y: 0.02 },
      { ...ctx({ ends: false, pipes: false, grid: true }), gridBasis: { u, v } },
    );
    // nearest lattice point: a=1, b=-1 → (0.2, 0)
    expect(snapped.kind).toBe('grid');
    expect(snapped.pos.x).toBeCloseTo(0.2, 12);
    expect(snapped.pos.y).toBeCloseTo(0, 12);
  });

  it('an end occupying the target grid point beats the bare grid', () => {
    // node exactly on a grid point; the cursor is OUTSIDE the node snap
    // tolerance but rounds to that same grid point — the node must win, or
    // the next stroke lands coincident but unjoined
    const gm = mech([L1], [node('n1', 0.1, 0), node('n2', 1, 0)]);
    const gpos = { n1: { x: 0.1, y: 0 }, n2: { x: 1, y: 0 } };
    const snap = findSnap(
      { x: 0.06, y: 0.04 }, // 0.057 from n1 — beyond tolM 0.05
      {
        mechanism: gm,
        positions: gpos,
        silhouette: null,
        tolM: 0.05,
        gridM: 0.1,
        sources: { ends: true, pipes: false, grid: true },
      },
    );
    expect(snap).toMatchObject({ kind: 'node', nodeId: 'n1' });
  });

  it('grid off: the fallback keeps the raw pointer position', () => {
    const raw = { x: 0.4031, y: 0.31 };
    const rounded = findSnap(raw, ctx({ ends: true, pipes: false, grid: true }));
    expect(rounded.pos.x).not.toBeCloseTo(raw.x, 6); // rounded to 0.5" grid
    const free = findSnap(raw, ctx({ ends: true, pipes: false, grid: false }));
    expect(free.kind).toBe('grid');
    expect(free.pos).toEqual(raw); // untouched
  });
});

// BentLinks emit no onPipe snap from findSnap (drawing can't attach
// mid-polyline), so grabbing their body to MOVE them goes through this
// dedicated segment hit-test — the regression here was polylines falling
// through to the marquee instead of dragging.
describe('findBentLinkHit', () => {
  const bent: BentLinkElement = {
    id: 'B1',
    type: 'bentLink',
    maturity: 'sketch',
    nodeIds: ['n1', 'n2', 'n3'],
    filletRadiiM: [0],
    pointMasses: [],
  };
  const m = mech([bent], [node('n1', 0, 0), node('n2', 1, 0), node('n3', 1, 1)]);
  const positions = { n1: { x: 0, y: 0 }, n2: { x: 1, y: 0 }, n3: { x: 1, y: 1 } };

  it('hits the nearest segment point within tolerance', () => {
    const hit = findBentLinkHit(
      { x: 0.5, y: 0.01 },
      { mechanism: m, positions, silhouette: null, tolM: 0.02 },
    );
    expect(hit).toMatchObject({ elementId: 'B1', nodeA: 'n1', nodeB: 'n2' });
    expect(hit!.t).toBeCloseTo(0.5, 9);
    expect(hit!.pos).toEqual({ x: 0.5, y: 0 });
  });

  it('picks the closer of two segments at a corner', () => {
    const hit = findBentLinkHit(
      { x: 0.99, y: 0.4 },
      { mechanism: m, positions, silhouette: null, tolM: 0.05 },
    );
    expect(hit).toMatchObject({ nodeA: 'n2', nodeB: 'n3' });
  });

  it('misses outside the tolerance and respects excludeElements', () => {
    const ctx = { mechanism: m, positions, silhouette: null, tolM: 0.02 };
    expect(findBentLinkHit({ x: 0.5, y: 0.5 }, ctx)).toBeNull();
    expect(
      findBentLinkHit({ x: 0.5, y: 0.01 }, { ...ctx, excludeElements: new Set(['B1']) }),
    ).toBeNull();
  });
});

// A pivot can always be snapped to a skeleton binding point or a pack-frame
// anchor: both sit at priority 1 — above pipe spans and grid, below a live
// node — so a drag landing near one resolves to a `skeleton`/`anchor` snap
// that the canvas turns into a binding / grounded node on release.
describe('findSnap skeleton binding points', () => {
  const at = (x: number, y: number): Vec2 => ({ x, y });
  const points = { handR: at(1, 1), handL: at(-1, 1), pelvis: at(0, 0) } as Record<
    SkeletonPoint,
    Vec2
  >;
  const anchors = { beltR: at(0.5, 2) } as Record<WearerAnchor, Vec2>;
  const silhouette: Silhouette = { outlines: [], loops: [], points, anchors };
  const m = mech([], [node('n1', 0, 0)]);
  const positions = { n1: { x: 0, y: 0 } };

  it('snaps a dragged node onto a nearby skeleton point (excluding itself)', () => {
    const snap = findSnap(
      { x: 1.004, y: 0.997 },
      {
        mechanism: m,
        positions,
        silhouette,
        tolM: 0.02,
        exclude: new Set(['n1']),
      },
    );
    expect(snap.kind).toBe('skeleton');
    if (snap.kind === 'skeleton') expect(snap.point).toBe('handR');
  });

  it('snaps a dragged node onto a nearby pack-frame anchor (excluding itself)', () => {
    const snap = findSnap(
      { x: 0.503, y: 1.996 },
      {
        mechanism: m,
        positions,
        silhouette,
        tolM: 0.02,
        exclude: new Set(['n1']),
      },
    );
    expect(snap.kind).toBe('anchor');
    if (snap.kind === 'anchor') expect(snap.anchor).toBe('beltR');
  });

  it('prefers a coincident live node over the skeleton point beneath it', () => {
    const snap = findSnap(
      { x: 0.002, y: 0 },
      {
        mechanism: m,
        positions,
        silhouette,
        tolM: 0.02,
      },
    );
    expect(snap.kind).toBe('node');
  });
});
