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
  /** dimmed underlay polylines (body + schematic pack frame), panel 2D space */
  outlines: Vec2[][];
  /** snappable, bindable skeleton points */
  points: Record<SkeletonPoint, Vec2>;
  /** snappable structural anchors */
  anchors: Record<WearerAnchor, Vec2>;
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
  const head: Vec2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * 2 * Math.PI;
    // head circle in the panel plane, centered on the projected head point
    const c = pr(P.head);
    head.push({ x: c.x + headRadius * Math.cos(a), y: c.y + headRadius * Math.sin(a) });
  }

  const outlines: Vec2[][] = [
    head,
    chain(P.pelvis, P.spineTop), // torso
    chain(P.shoulderL, P.shoulderR),
    chain(P.hipL, P.hipR),
    chain(P.shoulderL, P.elbowL, P.handL),
    chain(P.shoulderR, P.elbowR, P.handR),
    chain(P.hipL, P.kneeL, P.ankleL, P.shoeL),
    chain(P.hipR, P.kneeR, P.ankleR, P.shoeR),
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

  return { outlines, points, anchors };
}

/** Convenience: compute the skeleton for a pose and project it in one call. */
export function computeSilhouette(
  params: WearerParams,
  pose: JointPose,
  basis: PanelBasis,
): Silhouette {
  return projectSilhouette(computeSkeleton(params, pose), headRadiusM(params), basis);
}
