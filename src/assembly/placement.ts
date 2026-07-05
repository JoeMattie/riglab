// Default 3D placement from a mechanism's view orientation (§4.2: "view
// orientation … informs the default plane placement in 3D assembly", governed
// by PLANFILE-quad-workspace.md). One source of truth shared by the ghost
// synthesis in the 3D view, the one-click Place op, and the quad workspace's
// ortho panel frames. World frame: +y up, wearer front +x, wearer-left +z.
import type { Quaternion, Vec3, ViewOrientation } from '../schema';
import { quatFromBasis } from './math3';

export interface OrientationFrame {
  /** world direction of the sketch's local +x (screen-right) */
  xAxis: Vec3;
  /** world direction of the sketch's local +y (screen-up) */
  yAxis: Vec3;
  /** plane normal (local +z), toward the viewer of that orientation */
  zAxis: Vec3;
}

export interface DefaultPlacement {
  position: Vec3;
  quaternion: Quaternion;
}

/** Lateral standoff so side/front/back ghost planes sit just outside the
 * wearer's body instead of slicing through it. */
const STANDOFF_M = 0.25;
/** Plan-view (top) mechanisms — neck pan and the like — live up around the
 * shoulders; a ghost at head height reads as "this is the top-view layer". */
const TOP_PLANE_HEIGHT_M = 1.45;

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const FRAMES: Record<ViewOrientation, OrientationFrame> = {
  // viewed from the wearer's left (+z): upright x-y plane, front to the right
  'side-left': { xAxis: V(1, 0, 0), yAxis: V(0, 1, 0), zAxis: V(0, 0, 1) },
  // viewed from the right (−z): mirrored so the drawing faces that viewer
  'side-right': { xAxis: V(-1, 0, 0), yAxis: V(0, 1, 0), zAxis: V(0, 0, -1) },
  // viewed from in front (+x), wearer-left appears screen-left (−z → +x norm)
  front: { xAxis: V(0, 0, -1), yAxis: V(0, 1, 0), zAxis: V(1, 0, 0) },
  back: { xAxis: V(0, 0, 1), yAxis: V(0, 1, 0), zAxis: V(-1, 0, 0) },
  // plan view looking down: screen-right → front (+x), screen-up → left (+z)
  top: { xAxis: V(1, 0, 0), yAxis: V(0, 0, 1), zAxis: V(0, -1, 0) },
  free: { xAxis: V(0, 0, -1), yAxis: V(0, 1, 0), zAxis: V(1, 0, 0) },
};

export function orientationFrame(vo: ViewOrientation): OrientationFrame {
  return FRAMES[vo];
}

const ORIGINS: Record<ViewOrientation, Vec3> = {
  'side-left': V(0, 0, STANDOFF_M),
  'side-right': V(0, 0, -STANDOFF_M),
  front: V(STANDOFF_M, 0, 0),
  back: V(-STANDOFF_M, 0, 0),
  top: V(0, TOP_PLANE_HEIGHT_M, 0),
  free: V(STANDOFF_M, 0, 0),
};

/** Where an unplaced mechanism's ghost renders, and the transform a
 * one-click Place bakes into the new instance. */
export function defaultPlacement(vo: ViewOrientation): DefaultPlacement {
  const f = FRAMES[vo];
  return { position: ORIGINS[vo], quaternion: quatFromBasis(f.xAxis, f.yAxis, f.zAxis) };
}
