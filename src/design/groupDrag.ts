// Group body-drag target math (PLANFILE-multiselect-drag-constraints):
// dragging a pipe body moves every node the dragged elements touch by one
// world-space delta. Pure geometry so the translate itself is unit-testable;
// the canvas decides whether the targets are written directly (constraints
// off) or handed to the kinematic solver as dragTargets (constraints on).
import type { Mechanism, Vec3 } from '../schema';
import { elementNodeIds } from './elementInfo';

/** Union of the nodes touched by the given elements, deduped, schema order. */
export function groupDragNodeIds(mech: Mechanism, elementIds: readonly string[]): string[] {
  const wanted = new Set(elementIds);
  const out = new Set<string>();
  for (const el of mech.elements) {
    if (!wanted.has(el.id)) continue;
    for (const id of elementNodeIds(el, mech)) out.add(id);
  }
  return [...out];
}

/** Each captured start position translated by the world-space delta. */
export function translatedTargets(
  orig: Readonly<Record<string, Vec3>>,
  delta: Vec3,
): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const [id, p] of Object.entries(orig)) {
    out[id] = { x: p.x + delta.x, y: p.y + delta.y, z: p.z + delta.z };
  }
  return out;
}
