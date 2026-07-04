// View-orientation projections (§4.2/§7): each mechanism's 2D space is a
// projection of the wearer's world frame (y up, x forward, z wearer-left).
// Elevation views keep world y as 2D y (gravity −Y); `top` maps the ground
// plane; `free` behaves like side-left.
import type {
  SkeletonPoint,
  Vec2,
  Vec3,
  ViewOrientation,
  WearerAnchor,
  WearerParams,
} from '../schema';
import { computeSkeleton, headRadiusM, type JointPose, type SkeletonFrame } from './skeleton';

export function projectPoint(view: ViewOrientation, p: Vec3): Vec2 {
  switch (view) {
    case 'side-left':
    case 'free':
      return { x: p.x, y: p.y };
    case 'side-right':
      return { x: -p.x, y: p.y };
    case 'front':
      return { x: p.z, y: p.y };
    case 'back':
      return { x: -p.z, y: p.y };
    case 'top':
      return { x: p.x, y: p.z };
  }
}

export interface Silhouette {
  /** dimmed underlay polylines (body + schematic pack frame), 2D view space */
  outlines: Vec2[][];
  /** snappable, bindable skeleton points */
  points: Record<SkeletonPoint, Vec2>;
  /** snappable structural anchors */
  anchors: Record<WearerAnchor, Vec2>;
}

export function computeSilhouette(
  params: WearerParams,
  pose: JointPose,
  view: ViewOrientation,
): Silhouette {
  const frame: SkeletonFrame = computeSkeleton(params, pose);
  const pr = (p: Vec3): Vec2 => projectPoint(view, p);
  const P = frame.points;
  const A = frame.anchors;

  const chain = (...pts: Vec3[]): Vec2[] => pts.map(pr);
  const headR = headRadiusM(params);
  const head: Vec2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * 2 * Math.PI;
    // head circle in the view plane, centered on the projected head point
    const c = pr(P.head);
    head.push({ x: c.x + headR * Math.cos(a), y: c.y + headR * Math.sin(a) });
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
