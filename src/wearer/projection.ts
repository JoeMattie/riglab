// Skeleton → panel projection (PLANFILE-3d-conversion.md): the quad
// workspace draws the wearer silhouette as a dimmed underlay in each ortho
// panel. Pure functions parameterized by a panel plane basis — pass an
// OrientationFrame from src/geometry/placement.ts (the single panel-frame
// source of truth) or any orthonormal basis. No mechanism/viewOrientation
// coupling: the document is 3D, projection is a drawing concern only.
import type { OrientationFrame } from '../geometry/placement';
import type { SkeletonPoint, Vec2, Vec3, WearerAnchor, WearerParams } from '../schema';
import { computeSkeleton, headRadiusM, type JointPose, type SkeletonFrame } from './skeleton';

/** A panel's drawing plane: `xAxis` → screen-right, `yAxis` → screen-up
 * (unit, orthogonal). An OrientationFrame satisfies this. */
export type PanelBasis = Pick<OrientationFrame, 'xAxis' | 'yAxis'>;

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Orthographic projection of a world point into panel 2D coordinates
 * (world origin projects to the panel's 2D origin). */
export function projectPoint(basis: PanelBasis, p: Vec3): Vec2 {
  return { x: dot(p, basis.xAxis), y: dot(p, basis.yAxis) };
}

export interface Silhouette {
  /** dimmed underlay strokes (trimmed bones + schematic pack frame), panel 2D space */
  outlines: Vec2[][];
  /** closed figure shapes: egg head, joint rings, blob fists, oval feet */
  loops: Vec2[][];
  /** snappable, bindable skeleton points */
  points: Record<SkeletonPoint, Vec2>;
  /** snappable structural anchors */
  anchors: Record<WearerAnchor, Vec2>;
}

/** Sketch-figure proportions as fractions of the head radius (§7 stick
 * figure): open rings at the articulated joints, blob fists, oval feet, a
 * head slightly narrower than tall. Shared with the 3D mannequin so both
 * renders read as the same character. */
export const FIGURE = {
  jointR: 0.3,
  fistR: 0.45,
  footHalfLen: 0.62,
  footHalfWid: 0.36,
  headRx: 0.78,
  /** 3D head sphere, splitting the egg's two radii */
  headBallR: 0.85,
} as const;

/** Closed ellipse loop; `major` is the unit major-axis direction. */
function ellipseLoop(c: Vec2, rx: number, ry: number, major: Vec2, n: number): Vec2[] {
  const minor = { x: -major.y, y: major.x };
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const px = rx * Math.cos(a);
    const py = ry * Math.sin(a);
    pts.push({ x: c.x + major.x * px + minor.x * py, y: c.y + major.y * px + minor.y * py });
  }
  return pts;
}

/** Bone stroke from a to b, pulled back by each end's ring radius so the
 * stroke stops at the joint circle instead of running through it. Null when
 * the projected segment is shorter than its trims (edge-on in this panel). */
function bone(a: Vec2, b: Vec2, trimA: number, trimB: number): Vec2[] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= trimA + trimB + 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  return [
    { x: a.x + ux * trimA, y: a.y + uy * trimA },
    { x: b.x - ux * trimB, y: b.y - uy * trimB },
  ];
}

/** Project a computed skeleton frame into a panel plane for drawing. */
export function projectSilhouette(
  frame: SkeletonFrame,
  headRadius: number,
  basis: PanelBasis,
): Silhouette {
  const pr = (p: Vec3): Vec2 => projectPoint(basis, p);
  const P = frame.points;
  const A = frame.anchors;

  const chain = (...pts: Vec3[]): Vec2[] => pts.map(pr);
  const rJoint = FIGURE.jointR * headRadius;
  const rFist = FIGURE.fistR * headRadius;
  const ring = (p: Vec3, r: number) => ellipseLoop(pr(p), r, r, { x: 1, y: 0 }, 16);

  const loops: Vec2[][] = [
    // egg head in the panel plane, centered on the projected head point
    ellipseLoop(pr(P.head), FIGURE.headRx * headRadius, headRadius, { x: 1, y: 0 }, 24),
    ...[P.shoulderL, P.shoulderR, P.elbowL, P.elbowR, P.hipL, P.hipR, P.kneeL, P.kneeR].map((p) =>
      ring(p, rJoint),
    ),
    ring(P.handL, rFist),
    ring(P.handR, rFist),
  ];
  // feet: ovals at the shoe, along the projected ankle→shoe direction
  for (const [ankle, shoe] of [
    [P.ankleL, P.shoeL],
    [P.ankleR, P.shoeR],
  ] as const) {
    const a = pr(ankle);
    const s = pr(shoe);
    const len = Math.hypot(s.x - a.x, s.y - a.y);
    const major = len > 1e-6 ? { x: (s.x - a.x) / len, y: (s.y - a.y) / len } : { x: 0, y: -1 };
    loops.push(
      ellipseLoop(s, FIGURE.footHalfLen * headRadius, FIGURE.footHalfWid * headRadius, major, 16),
    );
  }

  const bones = [
    bone(pr(P.pelvis), pr(P.spineTop), 0, 0), // spine
    bone(pr(P.spineTop), pr(P.head), 0, headRadius), // neck, stops at the head egg
    bone(pr(P.shoulderL), pr(P.shoulderR), rJoint, rJoint),
    bone(pr(P.hipL), pr(P.hipR), rJoint, rJoint),
    bone(pr(P.shoulderL), pr(P.elbowL), rJoint, rJoint),
    bone(pr(P.elbowL), pr(P.handL), rJoint, rFist),
    bone(pr(P.shoulderR), pr(P.elbowR), rJoint, rJoint),
    bone(pr(P.elbowR), pr(P.handR), rJoint, rFist),
    bone(pr(P.hipL), pr(P.kneeL), rJoint, rJoint),
    bone(pr(P.kneeL), pr(P.ankleL), rJoint, 0),
    bone(pr(P.hipR), pr(P.kneeR), rJoint, rJoint),
    bone(pr(P.kneeR), pr(P.ankleR), rJoint, 0),
  ].filter((s): s is Vec2[] => s !== null);

  const outlines: Vec2[][] = [
    ...bones,
    // schematic pack frame: hip rectangle + back rails to the shoulders
    [
      pr(A.hipRectFrontL),
      pr(A.hipRectFrontR),
      pr(A.hipRectBackR),
      pr(A.hipRectBackL),
      pr(A.hipRectFrontL),
    ],
    chain(A.hipRectBackL, A.shoulderL),
    chain(A.hipRectBackR, A.shoulderR),
  ];

  const points = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, pr(v)])) as Record<
    SkeletonPoint,
    Vec2
  >;
  const anchors = Object.fromEntries(Object.entries(A).map(([k, v]) => [k, pr(v)])) as Record<
    WearerAnchor,
    Vec2
  >;

  return { outlines, loops, points, anchors };
}

/** Convenience: compute the skeleton for a pose and project it in one call. */
export function computeSilhouette(
  params: WearerParams,
  pose: JointPose,
  basis: PanelBasis,
): Silhouette {
  return projectSilhouette(computeSkeleton(params, pose), headRadiusM(params), basis);
}
