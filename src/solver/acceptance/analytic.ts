// Analytic reference solutions for solver acceptance tests. Test-support
// code only — never imported by the app.
import type { Vec2 } from '../../schema';

export interface FourBarConfig {
  a: number; // crank (O2→A)
  b: number; // coupler (A→B)
  c: number; // rocker (B→O4)
  d: number; // ground (O2→O4), O2 at origin
}

/** Grashof crank-rocker used across the acceptance suite. */
export const FOUR_BAR: FourBarConfig = { a: 0.2, b: 0.5, c: 0.4, d: 0.6 };

export function crankTip(cfg: FourBarConfig, theta2: number): Vec2 {
  return { x: cfg.a * Math.cos(theta2), y: cfg.a * Math.sin(theta2) };
}

export function circleCircleIntersection(
  c1: Vec2,
  r1: number,
  c2: Vec2,
  r2: number,
): [Vec2, Vec2] | null {
  const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (d === 0 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const ux = (c2.x - c1.x) / d;
  const uy = (c2.y - c1.y) / d;
  const mx = c1.x + a * ux;
  const my = c1.y + a * uy;
  return [
    { x: mx - h * uy, y: my + h * ux },
    { x: mx + h * uy, y: my - h * ux },
  ];
}

/** Coupler-rocker joint position, branch-continuous via prevB. */
export function fourBarB(cfg: FourBarConfig, theta2: number, prevB: Vec2): Vec2 {
  const A = crankTip(cfg, theta2);
  const sols = circleCircleIntersection(A, cfg.b, { x: cfg.d, y: 0 }, cfg.c);
  if (!sols) throw new Error(`four-bar cannot assemble at theta2=${theta2}`);
  const d0 = Math.hypot(sols[0].x - prevB.x, sols[0].y - prevB.y);
  const d1 = Math.hypot(sols[1].x - prevB.x, sols[1].y - prevB.y);
  return d0 <= d1 ? sols[0] : sols[1];
}

export function fourBarInitial(cfg: FourBarConfig): { A: Vec2; B: Vec2 } {
  const A = crankTip(cfg, Math.PI / 2);
  const sols = circleCircleIntersection(A, cfg.b, { x: cfg.d, y: 0 }, cfg.c);
  if (!sols) throw new Error('four-bar initial pose cannot assemble');
  const B = sols[0].y >= sols[1].y ? sols[0] : sols[1];
  return { A, B };
}
