// Analytic reference solutions + 3D test-frame helpers for solver acceptance
// tests. Test-support code only — never imported by the app.
//
// The 2D-parity strategy (PLANFILE-3d-conversion.md): every analytic case is
// authored in a LOCAL 2D frame (exactly the old planar case), then lifted
// into world space through a quaternion + origin. Kinematic cases tilt by a
// fully general quaternion; gravity cases rotate about world y (gravity stays
// −y) so the physics is unchanged while every solver code path runs in 3D.
import { add, normalize, rotate, sub } from '../../geometry/math3';
import type {
  Mechanism,
  MechanismElement,
  MechanismNode,
  PivotElement,
  Quaternion,
  Vec3,
} from '../../schema';

// ── 2D four-bar closed form (local-frame math, unchanged from 2D) ────────
interface Pt2 {
  x: number;
  y: number;
}

export interface FourBarConfig {
  a: number; // crank (O2→A)
  b: number; // coupler (A→B)
  c: number; // rocker (B→O4)
  d: number; // ground (O2→O4), O2 at origin
}

/** Grashof crank-rocker used across the acceptance suite. */
export const FOUR_BAR: FourBarConfig = { a: 0.2, b: 0.5, c: 0.4, d: 0.6 };

export function crankTip(cfg: FourBarConfig, theta2: number): Pt2 {
  return { x: cfg.a * Math.cos(theta2), y: cfg.a * Math.sin(theta2) };
}

export function circleCircleIntersection(
  c1: Pt2,
  r1: number,
  c2: Pt2,
  r2: number,
): [Pt2, Pt2] | null {
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
export function fourBarB(cfg: FourBarConfig, theta2: number, prevB: Pt2): Pt2 {
  const A = crankTip(cfg, theta2);
  const sols = circleCircleIntersection(A, cfg.b, { x: cfg.d, y: 0 }, cfg.c);
  if (!sols) throw new Error(`four-bar cannot assemble at theta2=${theta2}`);
  const d0 = Math.hypot(sols[0].x - prevB.x, sols[0].y - prevB.y);
  const d1 = Math.hypot(sols[1].x - prevB.x, sols[1].y - prevB.y);
  return d0 <= d1 ? sols[0] : sols[1];
}

export function fourBarInitial(cfg: FourBarConfig): { A: Pt2; B: Pt2 } {
  const A = crankTip(cfg, Math.PI / 2);
  const sols = circleCircleIntersection(A, cfg.b, { x: cfg.d, y: 0 }, cfg.c);
  if (!sols) throw new Error('four-bar initial pose cannot assemble');
  const B = sols[0].y >= sols[1].y ? sols[0] : sols[1];
  return { A, B };
}

// ── quaternion frames ────────────────────────────────────────────────────
export function quatAxisAngle(axis: Vec3, angleRad: number): Quaternion {
  const u = normalize(axis);
  const s = Math.sin(angleRad / 2);
  return { x: u.x * s, y: u.y * s, z: u.z * s, w: Math.cos(angleRad / 2) };
}

export const conjQ = (q: Quaternion): Quaternion => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** Non-trivial general tilt for kinematic / gravity-free parity cases. */
export const TILT: Quaternion = quatAxisAngle({ x: 1, y: 2, z: 0.5 }, 0.7);
/** Rotation about world y (gravity axis) for statics parity cases: the
 * vertical plane turns, the physics does not. */
export const YAW: Quaternion = quatAxisAngle({ x: 0, y: 1, z: 0 }, 0.6);

/** local (x, y, z=0) → world through a frame. */
export const place =
  (q: Quaternion, origin: Vec3) =>
  (x: number, y: number, z = 0): Vec3 =>
    add(origin, rotate(q, { x, y, z }));

/** The hinge-axis direction for a plane authored in a frame's local (x, y):
 * local +z lifted to world — exactly what a sketch panel's normal becomes. */
export const rotAxisOfFrame = (q: Quaternion): Vec3 => rotate(q, { x: 0, y: 0, z: 1 });

/** world → local coordinates of a frame. */
export const unplace =
  (q: Quaternion, origin: Vec3) =>
  (p: Vec3): Vec3 =>
    rotate(conjQ(q), sub(p, origin));

export const dist3 = (a: Vec3, b: Vec3): number =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

// ── mechanism builders (schema v7) ───────────────────────────────────────
export function mech(
  nodes: MechanismNode[],
  elements: MechanismElement[],
  overrides: Partial<Mechanism> = {},
): Mechanism {
  return {
    id: 'm',
    name: 'test',
    nodes,
    elements,
    pointMasses: [],
    skeletonBindings: [],
    anchorBindings: [],
    inputs: [],
    namedStates: [],
    ...overrides,
  };
}

export const node = (
  id: string,
  position: Vec3,
  kind: MechanismNode['kind'] = 'free',
  channelId?: string,
): MechanismNode => ({ id, kind, position, ...(channelId ? { channelId } : {}) });

export const link = (id: string, nodeA: string, nodeB: string): MechanismElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA,
  nodeB,
  pointMasses: [],
});

export const hinge = (
  id: string,
  nodeId: string,
  memberIds: string[],
  axis: Vec3,
  extra: Partial<PivotElement> = {},
): MechanismElement => ({
  id,
  type: 'pivot',
  maturity: 'sketch',
  nodeId,
  joint: { kind: 'hinge', axis },
  memberIds,
  welds: [],
  ...extra,
});

export const spherical = (
  id: string,
  nodeId: string,
  memberIds: string[],
  extra: Partial<PivotElement> = {},
): MechanismElement => ({
  id,
  type: 'pivot',
  maturity: 'sketch',
  nodeId,
  joint: { kind: 'spherical' },
  memberIds,
  welds: [],
  ...extra,
});
