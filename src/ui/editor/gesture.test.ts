import { describe, expect, it } from 'vitest';
import { isPixelDelta, pinchStep, wheelZoomFactor } from './gesture';

describe('wheelZoomFactor (every wheel scroll zooms — desktop-mouse decision)', () => {
  it('scroll up zooms in, scroll down zooms out', () => {
    expect(wheelZoomFactor({ deltaY: -10, deltaMode: 0 })).toBeGreaterThan(1);
    expect(wheelZoomFactor({ deltaY: 10, deltaMode: 0 })).toBeLessThan(1);
  });

  it('applies gentler zoom to a small trackpad delta than a coarse mouse notch', () => {
    const trackpad = wheelZoomFactor({ deltaY: -8, deltaMode: 0 });
    const mouseNotch = wheelZoomFactor({ deltaY: -100, deltaMode: 0 });
    expect(trackpad).toBeGreaterThan(1);
    expect(trackpad).toBeLessThan(mouseNotch); // smaller step
    expect(trackpad).toBeCloseTo(Math.exp(0.04), 6); // 8/100 * 0.5
  });

  it('treats a line-mode delta as whole notches (classic mouse wheel)', () => {
    // one line-mode notch ≈ one pixel-mode 100px notch, not 1/100th of it
    expect(wheelZoomFactor({ deltaY: -1, deltaMode: 1 })).toBeCloseTo(
      wheelZoomFactor({ deltaY: -100, deltaMode: 0 }),
      9,
    );
  });

  it('keeps the zoom factor positive and bounded for any delta (no slam/invert)', () => {
    // the regression this guards: a coarse wheel-down must not go ≤ 0
    for (const deltaY of [-100000, -240, -100, -1, 1, 100, 240, 100000]) {
      for (const deltaMode of [0, 1]) {
        const factor = wheelZoomFactor({ deltaY, deltaMode });
        expect(factor).toBeGreaterThan(0);
        expect(factor).toBeGreaterThanOrEqual(0.5);
        expect(factor).toBeLessThanOrEqual(2);
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
