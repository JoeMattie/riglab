// Off-plane hinge guard (PLANFILE-solver-play-feel.md, slice 4). A hinge axis
// should be PERPENDICULAR to the plane its members swing in — for a leg drawn
// on the side panel that means +z, so the bars bend like a knee. When a hinge
// was drawn (or converted) with an axis pointing OUT of that plane — the
// raptor test rig has four hinges on +y where the members plainly lie in the
// x–y side plane — the joint splays/twists instead of bending, which reads as
// the "weird behavior" when posing.
//
// This module finds hinges whose drawn axis disagrees with the plane their own
// members span, and proposes snapping the axis to the nearest cardinal
// direction of that plane's normal. Pure analysis over the mechanism; the
// docOp wrapper (repairOffPlaneHinges) applies the proposals.
import { cross, dot, length, normalize, sub } from '../geometry/math3';
import type { Mechanism, MechanismElement, Vec3 } from '../schema';

/** Angle (rad) a drawn axis may differ from its members' plane normal before
 * it counts as "off plane". ~10° — comfortably past sketch/rounding noise,
 * well under the 90° cardinal-vs-cardinal mistakes we want to catch. */
export const OFF_PLANE_TOL_RAD = (10 * Math.PI) / 180;

/** Below this the members are too collinear to define a swing plane, so the
 * axis is left alone (no reliable normal to snap to). */
const MIN_PLANE_AREA = 1e-4;

export interface OffPlaneHinge {
  pivotElementId: string;
  nodeId: string;
  /** the drawn (current) unit axis */
  currentAxis: Vec3;
  /** the proposed axis: nearest cardinal to the members' plane normal */
  suggestedAxis: Vec3;
  /** angle between current axis and the members' plane normal, radians */
  deviationRad: number;
}

/** The pivot-adjacent node(s) of a member — the same lever-arm convention the
 * solver uses, kept local so this analysis doesn't reach into solver code. */
function memberNeighborIds(el: MechanismElement, pivotNodeId: string): string[] {
  if (el.type === 'link' || el.type === 'telescope') {
    if (el.nodeA === pivotNodeId) return [el.nodeB];
    if (el.nodeB === pivotNodeId) return [el.nodeA];
    return [];
  }
  if (el.type === 'bentLink') {
    const i = el.nodeIds.indexOf(pivotNodeId);
    if (i < 0) return [];
    return [el.nodeIds[i - 1], el.nodeIds[i + 1]].filter(
      (id): id is string => id !== undefined && id !== pivotNodeId,
    );
  }
  return [];
}

/** Nearest positive cardinal axis (+x/+y/+z) to a direction. A hinge axis is
 * an undirected line, so we canonicalise to the positive octant for a stable,
 * clean result on panel-drawn rigs. */
function nearestCardinal(n: Vec3): Vec3 {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ax >= ay && ax >= az) return { x: 1, y: 0, z: 0 };
  if (ay >= ax && ay >= az) return { x: 0, y: 1, z: 0 };
  return { x: 0, y: 0, z: 1 };
}

/** Best-fit plane normal of the pivot + its member neighbours, via a triangle
 * fan of cross products from the pivot (exact for the common 3-point case,
 * area-weighted for more). Null when the points are collinear/degenerate. */
function membersPlaneNormal(points: Vec3[]): Vec3 | null {
  if (points.length < 3) return null;
  const p0 = points[0]!;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const c = cross(sub(points[i]!, p0), sub(points[i + 1]!, p0));
    nx += c.x;
    ny += c.y;
    nz += c.z;
  }
  const n = { x: nx, y: ny, z: nz };
  if (length(n) < MIN_PLANE_AREA) return null;
  return normalize(n);
}

/** Hinges whose drawn axis disagrees with the plane their members span. */
export function detectOffPlaneHinges(mech: Mechanism): OffPlaneHinge[] {
  const posOf = new Map(mech.nodes.map((n) => [n.id, n.position]));
  const elById = new Map(mech.elements.map((e) => [e.id, e]));
  const out: OffPlaneHinge[] = [];
  for (const el of mech.elements) {
    if (el.type !== 'pivot' || el.joint.kind !== 'hinge') continue;
    const pivotPos = posOf.get(el.nodeId);
    if (!pivotPos) continue;
    // gather the pivot plus each member's pivot-adjacent node(s)
    const pts: Vec3[] = [pivotPos];
    const seen = new Set<string>([el.nodeId]);
    for (const mId of el.memberIds) {
      const member = elById.get(mId);
      if (!member) continue;
      for (const nId of memberNeighborIds(member, el.nodeId)) {
        if (seen.has(nId)) continue;
        seen.add(nId);
        const p = posOf.get(nId);
        if (p) pts.push(p);
      }
    }
    const normal = membersPlaneNormal(pts);
    if (!normal) continue; // members too collinear to judge
    const axis = normalize(el.joint.axis);
    if (length(axis) < 0.5) continue;
    // undirected line comparison: angle between axis and plane normal
    const deviationRad = Math.acos(Math.min(1, Math.abs(dot(axis, normal))));
    if (deviationRad <= OFF_PLANE_TOL_RAD) continue;
    const suggestedAxis = nearestCardinal(normal);
    // only propose a genuine change (suggested differs from current cardinal)
    if (Math.abs(dot(axis, suggestedAxis)) > Math.cos(OFF_PLANE_TOL_RAD)) continue;
    out.push({
      pivotElementId: el.id,
      nodeId: el.nodeId,
      currentAxis: axis,
      suggestedAxis,
      deviationRad,
    });
  }
  return out;
}
