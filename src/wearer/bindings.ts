import type { Mechanism, Vec3, WearerParams } from '../schema';
import { computeSkeleton, type JointPose, type SkeletonFrame } from './skeleton';

// Fully-3D binding resolution (PLANFILE-3d-conversion.md): bindings drive
// nodes to true 3D wearer points — the per-view projection indirection is
// gone. The *FromFrame variants let callers that already computed a
// SkeletonFrame (silhouette drawing, control mounts) reuse it.

/** Resolve the mechanism's skeleton bindings against a computed frame: each
 * bound node gets its skeleton point's 3D position. Feeds solve() as
 * dragTargets — the same machinery as pointer dragging (§7.3), so bound
 * nodes obey the mechanism's constraints (soft pull). */
export function bindingTargetsFromFrame(
  mechanism: Mechanism,
  frame: SkeletonFrame,
): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const b of mechanism.skeletonBindings) {
    out[b.nodeId] = { ...frame.points[b.point] };
  }
  return out;
}

/** Resolve the mechanism's wearer-anchor attachments against a computed
 * frame: each attached grounded node gets its wearer anchor's 3D position.
 * Feeds solve() as groundTargets — prescribed, unlike bindingTargets' soft
 * pull — so the ground point rides the pack frame / body
 * (PLANFILE-wearer-attachments-and-floor, slice A). */
export function anchorTargetsFromFrame(
  mechanism: Mechanism,
  frame: SkeletonFrame,
): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const b of mechanism.anchorBindings) {
    out[b.nodeId] = { ...frame.anchors[b.anchor] };
  }
  return out;
}

/** Resolve skeleton bindings for a pose (computes the skeleton frame). */
export function bindingTargets(
  mechanism: Mechanism,
  params: WearerParams,
  pose: JointPose,
): Record<string, Vec3> {
  if (mechanism.skeletonBindings.length === 0) return {};
  return bindingTargetsFromFrame(mechanism, computeSkeleton(params, pose));
}

/** Resolve wearer-anchor attachments for a pose (computes the skeleton frame). */
export function anchorTargets(
  mechanism: Mechanism,
  params: WearerParams,
  pose: JointPose,
): Record<string, Vec3> {
  if (mechanism.anchorBindings.length === 0) return {};
  return anchorTargetsFromFrame(mechanism, computeSkeleton(params, pose));
}
