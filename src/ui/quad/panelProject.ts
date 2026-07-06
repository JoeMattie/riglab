// Pure projection math for the quad workspace (PLANFILE-3d-conversion.md):
// how document-space (Vec3) geometry lands in an ortho panel's 2D drawing
// plane, and how panel-plane pointer input lifts back into document space at
// the panel's active work-plane depth. The frames come from
// src/geometry/placement.ts — the single panel-frame source of truth.
import { type OrientationFrame, orientationFrame } from '../../geometry/placement';
import type { Vec2, Vec3 } from '../../schema';
import type { OrthoPanelId } from '../../state/editorStore';

export type { OrthoPanelId };

/** One sign per world axis picks the isometric viewing octant
 * (PLANFILE-iso-view.md): x = front/back ("reverse"), y = above/below,
 * z = wearer-left/right. */
export interface IsoOctant {
  x: 1 | -1;
  y: 1 | -1;
  z: 1 | -1;
}

export const DEFAULT_ISO_OCTANT: IsoOctant = { x: 1, y: 1, z: 1 };

const S3 = Math.sqrt(3);
const S6 = Math.sqrt(6);

/** Isometric basis for a viewing octant: viewer at (sx, sy, sz)·(1,1,1),
 * world-up dominating screen-up in EVERY octant (the up vector is world +y
 * projected into the view plane, so scenes never render upside-down —
 * "below" octants look up at the underside instead). Orthonormal and
 * right-handed, so the shared project/lift math round-trips exactly like
 * the principal frames. Defined here (not placement.ts) — a workspace view,
 * not a document ViewOrientation. */
function makeIsoFrame(o: IsoOctant): OrientationFrame {
  const zAxis: Vec3 = { x: o.x / S3, y: o.y / S3, z: o.z / S3 };
  // world +y minus its normal component, normalized: (−sx·sy, 2, −sz·sy)/√6
  const yAxis: Vec3 = { x: (-o.x * o.y) / S6, y: 2 / S6, z: (-o.z * o.y) / S6 };
  // right-handed completion: x = y × z
  const xAxis: Vec3 = {
    x: yAxis.y * zAxis.z - yAxis.z * zAxis.y,
    y: yAxis.z * zAxis.x - yAxis.x * zAxis.z,
    z: yAxis.x * zAxis.y - yAxis.y * zAxis.x,
  };
  return { xAxis, yAxis, zAxis };
}

/** All eight octant frames, precomputed so the frame OBJECT IDENTITY is
 * stable — SketchCanvas memos key off the frame reference. */
const ISO_FRAMES = new Map<string, OrientationFrame>(
  ([1, -1] as const).flatMap((x) =>
    ([1, -1] as const).flatMap((y) =>
      ([1, -1] as const).map(
        (z) => [`${x},${y},${z}`, makeIsoFrame({ x, y, z })] as [string, OrientationFrame],
      ),
    ),
  ),
);

export function isoFrame(o: IsoOctant): OrientationFrame {
  return ISO_FRAMES.get(`${o.x},${o.y},${o.z}`)!;
}

export const PANEL_FRAME: Record<OrthoPanelId, OrientationFrame> = {
  top: orientationFrame('top'),
  front: orientationFrame('front'),
  side: orientationFrame('side-left'),
  iso: isoFrame(DEFAULT_ISO_OCTANT),
};

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Orthographic projection of a document point onto a panel plane. */
export function projectToPanel(w: Vec3, f: OrientationFrame): Vec2 {
  return { x: dot(w, f.xAxis), y: dot(w, f.yAxis) };
}

/** Signed distance of a document point along the panel normal — the depth a
 * work plane must have for new geometry to connect to `w` exactly. */
export function panelDepthOf(w: Vec3, f: OrientationFrame): number {
  return dot(w, f.zAxis);
}

/** Inverse of projectToPanel at a given work-plane depth: lift a panel-plane
 * 2D point into document space. Exact round-trip because the frame axes are
 * orthonormal. */
export function panelToWorld(p: Vec2, f: OrientationFrame, depthM: number): Vec3 {
  return {
    x: f.xAxis.x * p.x + f.yAxis.x * p.y + f.zAxis.x * depthM,
    y: f.xAxis.y * p.x + f.yAxis.y * p.y + f.zAxis.y * depthM,
    z: f.xAxis.z * p.x + f.yAxis.z * p.y + f.zAxis.z * depthM,
  };
}

/** Project a whole positions record (solved pose / document nodes) into a
 * panel plane — the shape marquee hit-testing and the 2D canvas consume. */
export function projectPositions(
  positions: Record<string, Vec3>,
  f: OrientationFrame,
): Record<string, Vec2> {
  const out: Record<string, Vec2> = {};
  for (const [id, p] of Object.entries(positions)) out[id] = projectToPanel(p, f);
  return out;
}
