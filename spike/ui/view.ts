import type { Scenario, Vec2 } from '../harness/types';

export interface View {
  toScreen(p: Vec2): Vec2;
  toWorld(s: Vec2): Vec2;
  width: number;
  height: number;
}

/** Fit the scenario's initial nodes into a canvas, y-up world → y-down screen. */
export function fitView(scenario: Scenario, width: number, height: number, pad = 60): View {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of scenario.nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  // leave world room for motion around the initial pose
  const spanX = Math.max(maxX - minX, 0.5) * 1.6;
  const spanY = Math.max(maxY - minY, 0.5) * 1.6;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  return {
    width,
    height,
    toScreen: (p) => ({ x: width / 2 + (p.x - cx) * scale, y: height / 2 - (p.y - cy) * scale }),
    toWorld: (s) => ({ x: cx + (s.x - width / 2) / scale, y: cy - (s.y - height / 2) / scale }),
  };
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx]!;
}
