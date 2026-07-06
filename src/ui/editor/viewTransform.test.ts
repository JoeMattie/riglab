import { describe, expect, it } from 'vitest';
import { wheelZoomFactor } from './gesture';
import {
  initialView,
  panBy,
  panTo,
  toScreen,
  toWorld,
  type ViewTransform,
  zoomAt,
} from './viewTransform';

const V: ViewTransform = { scale: 200, cx: 0.25, cy: 0.95, w: 800, h: 500 };

describe('zoomAt (pointer-anchored, clamped 40–3000 px/m)', () => {
  it('keeps the world point under the cursor fixed while zooming', () => {
    const cursor = { x: 610, y: 120 };
    const worldBefore = toWorld(V, cursor);
    const zoomed = zoomAt(V, cursor, 1.4);
    const worldAfter = toWorld(zoomed, cursor);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
    expect(zoomed.scale).toBeCloseTo(280, 9);
  });

  it('anchors correctly zooming out too', () => {
    const cursor = { x: 200, y: 380 };
    const worldBefore = toWorld(V, cursor);
    const worldAfter = toWorld(zoomAt(V, cursor, 0.5), cursor);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
  });

  it('clamps at the 3000 px/m ceiling', () => {
    const near = { ...V, scale: 2800 };
    expect(zoomAt(near, { x: 400, y: 250 }, 4).scale).toBe(3000);
  });

  it('clamps at the 40 px/m floor', () => {
    const near = { ...V, scale: 50 };
    expect(zoomAt(near, { x: 400, y: 250 }, 0.1).scale).toBe(40);
  });

  it('is a no-op factor of 1 (up to float error) at the center', () => {
    const center = { x: V.w / 2, y: V.h / 2 };
    const same = zoomAt(V, center, 1);
    expect(same.cx).toBeCloseTo(V.cx, 12);
    expect(same.cy).toBeCloseTo(V.cy, 12);
  });
});

describe('panBy', () => {
  it('translates the world center by the screen delta / scale (y inverted)', () => {
    const p = panBy(V, 100, -50);
    expect(p.cx).toBeCloseTo(V.cx - 100 / V.scale, 12);
    expect(p.cy).toBeCloseTo(V.cy + -50 / V.scale, 12);
  });

  it('round-trips a screen point: pan then inverse pan restores it', () => {
    const there = panBy(V, 37, 91);
    const back = panBy(there, -37, -91);
    expect(back.cx).toBeCloseTo(V.cx, 12);
    expect(back.cy).toBeCloseTo(V.cy, 12);
  });
});

describe('panTo (drag-pan: the grabbed canvas point rides the cursor)', () => {
  it('puts the grabbed world point exactly under the given screen point', () => {
    const grabbed = toWorld(V, { x: 610, y: 120 }); // grab here at pan start
    const moved = panTo(V, grabbed, { x: 250, y: 340 }); // drag cursor here
    const under = toWorld(moved, { x: 250, y: 340 });
    expect(under.x).toBeCloseTo(grabbed.x, 12);
    expect(under.y).toBeCloseTo(grabbed.y, 12);
    expect(moved.scale).toBe(V.scale); // pure pan, no zoom
  });

  it('is absolute: skipping intermediate moves lands on the same view', () => {
    const grabbed = toWorld(V, { x: 100, y: 100 });
    const direct = panTo(V, grabbed, { x: 400, y: 300 });
    const stepped = panTo(panTo(V, grabbed, { x: 33, y: 471 }), grabbed, { x: 400, y: 300 });
    expect(stepped.cx).toBeCloseTo(direct.cx, 12);
    expect(stepped.cy).toBeCloseTo(direct.cy, 12);
  });
});

describe('wheel zoom stays pointer-anchored (§11 acceptance line)', () => {
  it('a plain wheel scroll applied via zoomAt pins the cursor world point', () => {
    const cursor = { x: 650, y: 90 };
    const factor = wheelZoomFactor({ deltaY: -12, deltaMode: 0 });
    const worldBefore = toWorld(V, cursor);
    const next = zoomAt(V, cursor, factor);
    const worldAfter = toWorld(next, cursor);
    expect(next.scale).toBeGreaterThan(V.scale); // it zoomed in
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9); // and stayed anchored
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
    // the same screen pixel still maps back to the same world point
    expect(toScreen(next, worldBefore).x).toBeCloseTo(cursor.x, 6);
    expect(toScreen(next, worldBefore).y).toBeCloseTo(cursor.y, 6);
  });

  it('initialView is within the zoom clamp range', () => {
    const v = initialView(800, 500);
    expect(v.scale).toBeGreaterThanOrEqual(40);
    expect(v.scale).toBeLessThanOrEqual(3000);
  });
});
