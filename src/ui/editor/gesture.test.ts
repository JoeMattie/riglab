import { describe, expect, it } from 'vitest';
import { isPixelDelta, pinchStep, wheelGesture } from './gesture';

describe('wheelGesture', () => {
  it('treats ctrl+wheel as a zoom (browser trackpad-pinch encoding)', () => {
    const inn = wheelGesture({ deltaX: 0, deltaY: -10, deltaMode: 0, ctrlKey: true });
    expect(inn.kind).toBe('zoom');
    if (inn.kind === 'zoom') expect(inn.factor).toBeGreaterThan(1); // scroll up → zoom in

    const out = wheelGesture({ deltaX: 0, deltaY: 10, deltaMode: 0, ctrlKey: true });
    expect(out.kind).toBe('zoom');
    if (out.kind === 'zoom') expect(out.factor).toBeLessThan(1); // scroll down → zoom out
  });

  it('treats a plain (non-ctrl) wheel as a pan, content following the fingers', () => {
    const g = wheelGesture({ deltaX: 6, deltaY: -4, deltaMode: 0, ctrlKey: false });
    expect(g.kind).toBe('pan');
    if (g.kind === 'pan') {
      // pan is opposite the scroll delta (pixel mode is 1:1)
      expect(g.dxPx).toBe(-6);
      expect(g.dyPx).toBe(4);
    }
  });

  it('applies gentler zoom to a small trackpad delta than a coarse mouse notch', () => {
    const trackpad = wheelGesture({ deltaX: 0, deltaY: -8, deltaMode: 0, ctrlKey: true });
    const mouseNotch = wheelGesture({ deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: true });
    if (trackpad.kind === 'zoom' && mouseNotch.kind === 'zoom') {
      expect(trackpad.factor).toBeGreaterThan(1);
      expect(trackpad.factor).toBeLessThan(mouseNotch.factor); // smaller step
      expect(trackpad.factor).toBeCloseTo(Math.exp(0.04), 6); // 8/100 * 0.5
    }
  });

  it('keeps the zoom factor positive and bounded for any delta (no slam/invert)', () => {
    // the regression this guards: a coarse ctrl+wheel-down must not go ≤ 0
    for (const deltaY of [-100000, -240, -100, -1, 1, 100, 240, 100000]) {
      for (const deltaMode of [0, 1]) {
        const g = wheelGesture({ deltaX: 0, deltaY, deltaMode, ctrlKey: true });
        if (g.kind === 'zoom') {
          expect(g.factor).toBeGreaterThan(0);
          expect(g.factor).toBeGreaterThanOrEqual(0.5);
          expect(g.factor).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('isPixelDelta flags only deltaMode 0', () => {
    expect(isPixelDelta(0)).toBe(true);
    expect(isPixelDelta(1)).toBe(false);
    expect(isPixelDelta(2)).toBe(false);
  });
});

describe('pinchStep', () => {
  it('reports the finger-distance ratio as the zoom factor', () => {
    // fingers move from 100px apart to 200px apart → 2× zoom
    const step = pinchStep(
      { a: { x: 100, y: 100 }, b: { x: 200, y: 100 } },
      { a: { x: 50, y: 100 }, b: { x: 250, y: 100 } },
    );
    expect(step.factor).toBeCloseTo(2, 6);
  });

  it('anchors at the current midpoint', () => {
    const step = pinchStep(
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      { a: { x: 20, y: 40 }, b: { x: 120, y: 40 } },
    );
    expect(step.anchor).toEqual({ x: 70, y: 40 });
  });

  it('is a pure pan (factor 1) when the finger distance is unchanged', () => {
    const step = pinchStep(
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      { a: { x: 30, y: 10 }, b: { x: 130, y: 10 } },
    );
    expect(step.factor).toBeCloseTo(1, 6);
    expect(step.panDxPx).toBe(30);
    expect(step.panDyPx).toBe(10);
  });
});
