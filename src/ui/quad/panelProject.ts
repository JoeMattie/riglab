// Pure projection math for the quad workspace (PLANFILE-quad-workspace
// slice 4): which ortho panel hosts a mechanism's editing, and how world-space
// geometry lands in a panel plane or in a placed mechanism's local sketch
// frame (for the ghost overlays around the active mechanism).
import { dot, type OrientationFrame, orientationFrame, rotate, sub } from '../../assembly';
import type { Quaternion, Vec2, Vec3, ViewOrientation } from '../../schema';

export type OrthoPanelId = 'top' | 'front' | 'side';

/** side-left/right edit in the Side panel, top in Top, everything else
 * (front/back/free) in Front. */
export function panelForOrientation(vo: ViewOrientation): OrthoPanelId {
  switch (vo) {
    case 'top':
      return 'top';
    case 'side-left':
    case 'side-right':
      return 'side';
    default:
      return 'front';
  }
}

export const PANEL_FRAME: Record<OrthoPanelId, OrientationFrame> = {
  top: orientationFrame('top'),
  front: orientationFrame('front'),
  side: orientationFrame('side-left'),
};

/** Orthographic projection of a world point onto a panel plane. */
export function projectToPanel(w: Vec3, f: OrientationFrame): Vec2 {
  return { x: dot(w, f.xAxis), y: dot(w, f.yAxis) };
}

/** Inverse of the composition's node lift: world → a placed mechanism's local
 * sketch coordinates (origin + rotation from the instance/default placement;
 * mirror flips local x). Lets ghost geometry draw around the active mechanism
 * inside its own SketchCanvas frame. */
export function projectToLocal(w: Vec3, origin: Vec3, rot: Quaternion, mirror: boolean): Vec2 {
  const d = sub(w, origin);
  const x = dot(d, rotate(rot, { x: 1, y: 0, z: 0 }));
  const y = dot(d, rotate(rot, { x: 0, y: 1, z: 0 }));
  return { x: mirror ? -x : x, y };
}
