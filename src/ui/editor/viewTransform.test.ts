import { describe, expect, it } from 'vitest';
import { wheelGesture } from './gesture';
import { initialView, panBy, toScreen, toWorld, type ViewTransform, zoomAt } from './viewTransform';

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

describe('wheel zoom stays pointer-anchored (§11 acceptance line)', () => {
  it('a ctrl+wheel gesture applied via zoomAt pins the cursor world point', () => {
    const cursor = { x: 650, y: 90 };
    const g = wheelGesture({ deltaX: 0, deltaY: -12, deltaMode: 0, ctrlKey: true });
    expect(g.kind).toBe('zoom');
    if (g.kind !== 'zoom') return;
    const worldBefore = toWorld(V, cursor);
    const next = zoomAt(V, cursor, g.factor);
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
