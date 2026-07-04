import type { Mechanism, Vec2, WearerParams } from '../schema';
import { projectPoint } from './projection';
import { computeSkeleton, type JointPose } from './skeleton';

/** Resolve a mechanism's skeleton bindings for a pose: each bound node gets
 * the projected position of its skeleton point in the mechanism's view
 * plane. The result feeds solve() as dragTargets — the same machinery as
 * pointer dragging (§7.3), so bound nodes obey the mechanism's constraints. */
export function bindingTargets(
  mechanism: Mechanism,
  params: WearerParams,
  pose: JointPose,
): Record<string, Vec2> {
  if (mechanism.skeletonBindings.length === 0) return {};
  const frame = computeSkeleton(params, pose);
  const out: Record<string, Vec2> = {};
  for (const b of mechanism.skeletonBindings) {
    out[b.nodeId] = projectPoint(mechanism.viewOrientation, frame.points[b.point]);
  }
  return out;
}
