// Pure projection math for the quad workspace (PLANFILE-3d-conversion.md):
// how document-space (Vec3) geometry lands in an ortho panel's 2D drawing
// plane, and how panel-plane pointer input lifts back into document space at
// the panel's active work-plane depth. The frames come from
// src/geometry/placement.ts — the single panel-frame source of truth.
import { type OrientationFrame, orientationFrame } from '../../geometry/placement';
import type { Vec2, Vec3 } from '../../schema';
import type { OrthoPanelId } from '../../state/editorStore';

export type { OrthoPanelId };

/** Classic isometric basis (PLANFILE-iso-view.md): viewer at +(1,1,1),
 * world-up dominating screen-up. Orthonormal and right-handed, so the shared
 * project/lift math round-trips exactly like the principal frames. Defined
 * here (not placement.ts) — it is a workspace view, not a document
 * ViewOrientation. */
const S2 = Math.SQRT2;
const S3 = Math.sqrt(3);
const S6 = Math.sqrt(6);
const ISO_FRAME: OrientationFrame = {
  xAxis: { x: 1 / S2, y: 0, z: -1 / S2 },
  yAxis: { x: -1 / S6, y: 2 / S6, z: -1 / S6 },
  zAxis: { x: 1 / S3, y: 1 / S3, z: 1 / S3 },
};

export const PANEL_FRAME: Record<OrthoPanelId, OrientationFrame> = {
  top: orientationFrame('top'),
  front: orientationFrame('front'),
  side: orientationFrame('side-left'),
  iso: ISO_FRAME,
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
