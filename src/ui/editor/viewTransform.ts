import type { Vec2 } from '../../schema';

/** World (meters, y up) ↔ screen (px, y down). */
export interface ViewTransform {
  scale: number; // px per meter
  cx: number; // world point at the canvas center
  cy: number;
  w: number;
  h: number;
}

export function initialView(w: number, h: number): ViewTransform {
  // fit a ~2.6 m × 2.2 m window around the silhouette
  const scale = Math.min(w / 2.6, h / 2.2);
  return { scale, cx: 0.25, cy: 0.95, w, h };
}

export function toScreen(v: ViewTransform, p: Vec2): Vec2 {
  return { x: v.w / 2 + (p.x - v.cx) * v.scale, y: v.h / 2 - (p.y - v.cy) * v.scale };
}

export function toWorld(v: ViewTransform, s: Vec2): Vec2 {
  return { x: v.cx + (s.x - v.w / 2) / v.scale, y: v.cy - (s.y - v.h / 2) / v.scale };
}

export function zoomAt(v: ViewTransform, screen: Vec2, factor: number): ViewTransform {
  const worldBefore = toWorld(v, screen);
  const scale = Math.min(3000, Math.max(40, v.scale * factor));
  const next = { ...v, scale };
  const worldAfter = toWorld(next, screen);
  return {
    ...next,
    cx: next.cx + (worldBefore.x - worldAfter.x),
    cy: next.cy + (worldBefore.y - worldAfter.y),
  };
}

export function panBy(v: ViewTransform, dxPx: number, dyPx: number): ViewTransform {
  return { ...v, cx: v.cx - dxPx / v.scale, cy: v.cy + dyPx / v.scale };
}

/** Pan so `grabbedWorld` (the world point under the cursor at pan start) sits
 * exactly under `screen` — the canvas point rides the cursor. Absolute, not
 * incremental, so batched/dropped move events can never make the grab drift. */
export function panTo(v: ViewTransform, grabbedWorld: Vec2, screen: Vec2): ViewTransform {
  return {
    ...v,
    cx: grabbedWorld.x - (screen.x - v.w / 2) / v.scale,
    cy: grabbedWorld.y + (screen.y - v.h / 2) / v.scale,
  };
}
