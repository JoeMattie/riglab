import type { Vec2 } from '../../schema';

/*
 * Canvas-navigation gesture math (Phase 3). This is the "secret sauce" the
 * zoompinch spike was after: a wheel/trackpad/pinch model good enough to feel
 * right. The zoompinch library itself can't be used (it drives a CSS transform
 * on a required `.canvas` DOM child, which would bitmap-scale our Konva canvas —
 * see DECISIONS.md "Phase 3 — UI infrastructure"), so we reproduce the *model*
 * of its `handleWheel` here and apply it to our own `ViewTransform` instead.
 *
 * The model is re-implemented, not copied: the published `@zoompinch/core`
 * declares no license (GitHub detects none), so lifting its source verbatim
 * would be legally unclear. Everything reused here is standard, non-proprietary
 * technique — `ctrlKey`⇒zoom/else⇒pan is the browser's own trackpad-pinch
 * encoding (Figma/Maps use the same idiom) and `deltaMode === 0` is the
 * documented precision/trackpad signal. The zoom-factor curve is our own
 * (exponential + clamped, so a coarse mouse notch can't invert or slam the
 * scale — a bug the library's linear factor has). These functions are pure so
 * the math is unit-tested independently of the DOM.
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
/** A line-mode notch pans by ~one line height. */
const LINE_HEIGHT_PX = 16;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Precision-device (trackpad) signal: pixel-mode deltas come from a trackpad or
 * high-resolution wheel; line/page mode is a classic mouse notch. */
export function isPixelDelta(deltaMode: number): boolean {
  return deltaMode === 0;
}

/** The subset of a native WheelEvent the classifier needs (kept plain so the
 * math is testable without a DOM). */
export interface WheelSample {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}

/** A wheel event resolves to either a cursor-anchored zoom (multiplicative
 * factor for `zoomAt`) or a pan (screen-px deltas for `panBy`). */
export type WheelGesture =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dxPx: number; dyPx: number };

/**
 * Classify a wheel event using zoompinch's heuristic:
 *   - `ctrlKey` ⇒ **zoom** — the browser encodes a trackpad pinch as a
 *     wheel event with `ctrlKey` set, and an explicit Ctrl/⌘+wheel on a mouse is
 *     the same intent. Cursor-anchored via `zoomAt`.
 *   - otherwise ⇒ **pan** — a two-finger trackpad scroll (or a plain mouse
 *     wheel), panning so the viewport follows the fingers (scrollbar-style).
 * `deltaMode` only selects sensitivity, never the pan-vs-zoom decision.
 */
export function wheelGesture(e: WheelSample): WheelGesture {
  const pixel = isPixelDelta(e.deltaMode);

  if (e.ctrlKey) {
    // Exponential in "notches" so the factor is always positive and symmetric —
    // a coarse mouse ctrl+wheel (Chrome reports pixel-mode ±100/notch) can't
    // invert the scale the way a linear 1 + k·Δ can — then clamped per event.
    const notches = pixel ? e.deltaY / PIXELS_PER_NOTCH : e.deltaY;
    // scroll up (deltaY < 0) zooms in (factor > 1); down zooms out
    const factor = clamp(Math.exp(-notches * ZOOM_PER_NOTCH), MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR);
    return { kind: 'zoom', factor };
  }

  // plain wheel / two-finger scroll → pan in the scroll-delta direction on both
  // axes (viewport follows the fingers, content moves opposite — scrollbar-style
  // rather than content-follows-fingers). Pixel deltas are 1:1 screen px; a line
  // notch is one line height.
  const panPxPerUnit = pixel ? 1 : LINE_HEIGHT_PX;
  return { kind: 'pan', dxPx: e.deltaX * panPxPerUnit, dyPx: e.deltaY * panPxPerUnit };
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
