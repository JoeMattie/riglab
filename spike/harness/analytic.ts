import type { Vec2 } from './types';
import { dist } from './types';

/** Four-bar linkage: ground pivots O2=(0,0), O4=(d,0); crank a (O2→A),
 * coupler b (A→B), rocker c (B→O4). Grashof crank-rocker so the crank
 * rotates fully. */
export interface FourBarConfig {
  a: number;
  b: number;
  c: number;
  d: number;
}

export const FOUR_BAR: FourBarConfig = { a: 0.2, b: 0.5, c: 0.4, d: 0.6 };

export function crankTip(cfg: FourBarConfig, theta2: number): Vec2 {
  return { x: cfg.a * Math.cos(theta2), y: cfg.a * Math.sin(theta2) };
}

/** Both intersection points of circle(c1,r1) and circle(c2,r2), or null if
 * they don't intersect. */
export function circleCircleIntersection(
  c1: Vec2,
  r1: number,
  c2: Vec2,
  r2: number,
): [Vec2, Vec2] | null {
  const d = dist(c1, c2);
  if (d === 0 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = Math.sqrt(Math.max(0, h2));
  const ux = (c2.x - c1.x) / d;
  const uy = (c2.y - c1.y) / d;
  const mx = c1.x + a * ux;
  const my = c1.y + a * uy;
  return [
    { x: mx + h * -uy, y: my + h * ux },
    { x: mx - h * -uy, y: my - h * ux },
  ];
}

/** Position of the coupler-rocker joint B for crank angle theta2, picking the
 * assembly branch closest to prevB (branch continuity while sweeping). */
export function fourBarB(cfg: FourBarConfig, theta2: number, prevB: Vec2): Vec2 {
  const A = crankTip(cfg, theta2);
  const O4 = { x: cfg.d, y: 0 };
  const sols = circleCircleIntersection(A, cfg.b, O4, cfg.c);
  if (!sols) throw new Error(`four-bar cannot assemble at theta2=${theta2}`);
  return dist(sols[0], prevB) <= dist(sols[1], prevB) ? sols[0] : sols[1];
}

/** Initial pose used by the four-bar scenario: crank at 90°, upper branch. */
export function fourBarInitial(cfg: FourBarConfig): { A: Vec2; B: Vec2 } {
  const A = crankTip(cfg, Math.PI / 2);
  const sols = circleCircleIntersection(A, cfg.b, { x: cfg.d, y: 0 }, cfg.c);
  if (!sols) throw new Error('four-bar initial pose cannot assemble');
  const B = sols[0].y >= sols[1].y ? sols[0] : sols[1];
  return { A, B };
}
