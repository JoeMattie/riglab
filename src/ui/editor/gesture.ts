import type { Vec2 } from '../../schema';

/*
 * Canvas-navigation gesture math (Phase 3, revised for desktop mice — see
 * DECISIONS.md "wheel scroll zooms; middle-drag pans in every tool"). Every
 * wheel event is a cursor-anchored ZOOM: a mouse wheel notch, a trackpad
 * two-finger scroll, and a trackpad pinch (which browsers encode as a
 * ctrl+wheel) all zoom, differing only in delta resolution — `deltaMode === 0`
 * is the documented precision/trackpad signal. Panning is a drag gesture
 * (middle-mouse or space+drag; two-finger touch via pinchStep), never a wheel
 * one. The zoom-factor curve is exponential + clamped, so a coarse mouse
 * notch can't invert or slam the scale. These functions are pure so the math
 * is unit-tested independently of the DOM.
 */

/** e^(this × notches) is the per-event zoom factor. */
const ZOOM_PER_NOTCH = 0.5;
/** A pixel-mode notch (Chrome mouse wheel) is ~100 px; a trackpad emits far
 * smaller pixel deltas, so both map onto the same "notches" scale. */
const PIXELS_PER_NOTCH = 100;
/** Per-event zoom is clamped to this window so no single coarse notch (or an odd
 * cross-browser delta) can invert or jump the scale — trackpad pinch lands well
 * inside it. */
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 2;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Precision-device (trackpad) signal: pixel-mode deltas come from a trackpad or
 * high-resolution wheel; line/page mode is a classic mouse notch. */
export function isPixelDelta(deltaMode: number): boolean {
  return deltaMode === 0;
}

/** The subset of a native WheelEvent the zoom math needs (kept plain so the
 * math is testable without a DOM). */
export interface WheelSample {
  deltaY: number;
  deltaMode: number;
}

/**
 * Cursor-anchored zoom factor for a wheel event (apply via `zoomAt`). Every
 * wheel scroll zooms — a mouse notch, a trackpad two-finger scroll, and a
 * trackpad pinch (browser-encoded as ctrl+wheel) all land here; `deltaMode`
 * only selects sensitivity. Exponential in "notches" so the factor is always
 * positive and symmetric — a coarse mouse wheel (Chrome reports pixel-mode
 * ±100/notch) can't invert the scale the way a linear 1 + k·Δ can — then
 * clamped per event.
 */
export function wheelZoomFactor(e: WheelSample): number {
  const notches = isPixelDelta(e.deltaMode) ? e.deltaY / PIXELS_PER_NOTCH : e.deltaY;
  // scroll up (deltaY < 0) zooms in (factor > 1); down zooms out
  return clamp(Math.exp(-notches * ZOOM_PER_NOTCH), MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR);
}

/** Two active touch/pointer positions (screen px). */
export interface PinchSample {
  a: Vec2;
  b: Vec2;
}

/** One two-finger pinch step between successive samples: a cursor(midpoint)-
 * anchored zoom factor (finger-distance ratio) plus the midpoint's pan in
 * screen px. Apply as `zoomAt(panBy(v, panDxPx, panDyPx), anchor, factor)`. */
export interface PinchStep {
  factor: number;
  anchor: Vec2;
  panDxPx: number;
  panDyPx: number;
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pinchStep(prev: PinchSample, curr: PinchSample): PinchStep {
  const dPrev = distance(prev.a, prev.b);
  const dCurr = distance(curr.a, curr.b);
  const midPrev = midpoint(prev.a, prev.b);
  const midCurr = midpoint(curr.a, curr.b);
  return {
    factor: dPrev > 0 ? dCurr / dPrev : 1,
    anchor: midCurr,
    panDxPx: midCurr.x - midPrev.x,
    panDyPx: midCurr.y - midPrev.y,
  };
}
