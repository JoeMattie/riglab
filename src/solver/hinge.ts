// Hinge machinery shared by both solve modes (PLANFILE-3d-conversion.md).
//
// A hinge pivot is realised as ONE solver-internal VIRTUAL PARTICLE placed on
// the axis at pivot + axis·h, rigidly distance-tied to the pivot node and to
// each member's pivot-adjacent node(s). Every point of a member then keeps a
// fixed distance to two points ON the axis line (the pivot and the virtual),
// so the only relative motion left between members is rotation about that
// line — the classic two-shared-points particle hinge, with the pivot node
// itself as the first shared point. Spherical pivots need no machinery: the
// shared node already is a ball joint.
//
// Virtual particles never appear in the schema or in returned positions;
// their ids derive deterministically from the pivot element id, and all ties
// are created in a stable order (memberIds document order) so constraint
// iteration stays id-deterministic (§12).
import { add, cross, dot, normalize, scale, sub } from '../geometry/math3';
import type { MechanismElement, PivotElement, Vec3 } from '../schema';

/** Minimal positional view of a particle — both solve modes' particle
 * records satisfy it structurally. */
export interface Pt3 {
  x: number;
  y: number;
  z: number;
}

export const VIRTUAL_AXIS_SUFFIX = '#axis';

export const virtualAxisId = (pivotElementId: string): string =>
  `${pivotElementId}${VIRTUAL_AXIS_SUFFIX}`;

/** The member's node adjacent to the pivot node — the lever arm used for
 * welds, angle features and drive frames (same convention as the 2D solver). */
export function adjacentNodeId(el: MechanismElement, pivotNodeId: string): string | null {
  if (el.type === 'link' || el.type === 'telescope') {
    if (el.nodeA === pivotNodeId) return el.nodeB;
    if (el.nodeB === pivotNodeId) return el.nodeA;
    return null;
  }
  if (el.type === 'bentLink') {
    const i = el.nodeIds.indexOf(pivotNodeId);
    if (i < 0) return null;
    return el.nodeIds[i + 1] ?? el.nodeIds[i - 1] ?? null;
  }
  return null;
}

/** Nodes of a member that get distance-tied to the axis particle. A bar
 * (link/telescope) ties its one opposite endpoint — a 2-particle bar has no
 * representable axial twist, so one tie fully hinges it. A bentLink is an
 * extended rigid body: it ties its two chain nodes nearest the pivot, which
 * locks the whole body to the axis (rotation about the axis line preserves
 * every distance to the on-axis virtual, twist about any other line does
 * not). */
export function tieNodeIds(el: MechanismElement, pivotNodeId: string): string[] {
  if (el.type === 'link' || el.type === 'telescope') {
    const other = adjacentNodeId(el, pivotNodeId);
    return other ? [other] : [];
  }
  if (el.type === 'bentLink') {
    const ids = el.nodeIds;
    const i = ids.indexOf(pivotNodeId);
    if (i < 0) return [];
    const picks =
      i === 0
        ? [ids[1], ids[2]]
        : i === ids.length - 1
          ? [ids[i - 1], ids[i - 2]]
          : [ids[i - 1], ids[i + 1]];
    return picks.filter((id): id is string => id !== undefined && id !== pivotNodeId);
  }
  return [];
}

/** All node ids a member occupies (for the axis-pinning rule). */
function memberNodeIds(el: MechanismElement): string[] | null {
  if (el.type === 'link' || el.type === 'telescope') return [el.nodeA, el.nodeB];
  if (el.type === 'bentLink') return [...el.nodeIds];
  return null;
}

export interface HingeTie {
  nodeId: string;
  rest: number;
}

export interface HingePlan {
  virtualId: string;
  pivotNodeId: string;
  /** unit axis, document space (drawn) */
  axis: Vec3;
  /** axis-particle offset along the axis */
  h: number;
  /** virtual position at the DRAWN pose (rest-length reference) */
  drawnVirtualPos: Vec3;
  /** member-node distance ties (pivot tie is implicit: rest = h) */
  ties: HingeTie[];
  /** true ⇒ the axis is rigidly grounded: create the virtual with weight 0
   * at (current pivot position + axis·h) instead of solving for it */
  pinned: boolean;
}

const dist3 = (a: Vec3, b: Vec3): number =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

/** Build the virtual-axis-particle plan for a hinge pivot from DRAWN geometry.
 * Returns null for spherical joints, degenerate axes, or unresolvable members
 * (then the pivot degrades to the shared-node spherical behaviour, mirroring
 * how the 2D solver skipped unresolvable welds).
 *
 * Pinning rule: when the pivot node is held (anchor/driven/drag-held) AND at
 * least one member is fully held, the axis is rigidly determined by ground —
 * distance ties alone would leave it free to precess about that member, so
 * the virtual is pinned at (current pivot + drawn axis·h) with weight 0. */
export function hingePlan(
  el: PivotElement,
  posOf: ReadonlyMap<string, Vec3>,
  elementById: ReadonlyMap<string, MechanismElement>,
  isHeld: (nodeId: string) => boolean,
): HingePlan | null {
  if (el.joint.kind !== 'hinge') return null;
  const axis = normalize(el.joint.axis);
  if (dot(axis, axis) < 0.5) return null; // zero-length axis in the document
  const pivotPos = posOf.get(el.nodeId);
  if (!pivotPos) return null;

  const ties: HingeTie[] = [];
  const seen = new Set<string>([el.nodeId]);
  let minArm = Number.POSITIVE_INFINITY;
  let anyMemberFullyHeld = false;
  for (const memberId of el.memberIds) {
    const member = elementById.get(memberId);
    if (!member) continue;
    const nodes = memberNodeIds(member);
    if (nodes?.every((id) => isHeld(id))) anyMemberFullyHeld = true;
    for (const nodeId of tieNodeIds(member, el.nodeId)) {
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      const p = posOf.get(nodeId);
      if (!p) continue;
      minArm = Math.min(minArm, dist3(pivotPos, p));
      ties.push({ nodeId, rest: 0 }); // rest filled once h is known
    }
  }
  if (ties.length === 0) return null;

  // deterministic offset: ~half the shortest lever arm, clamped to a sane
  // conditioning range for metre-scale rigs
  const h = Number.isFinite(minArm) ? Math.min(Math.max(0.5 * minArm, 1e-3), 0.5) : 0.1;
  const drawnVirtualPos = add(pivotPos, scale(axis, h));
  for (const tie of ties) tie.rest = dist3(drawnVirtualPos, posOf.get(tie.nodeId)!);

  return {
    virtualId: virtualAxisId(el.id),
    pivotNodeId: el.nodeId,
    axis,
    h,
    drawnVirtualPos,
    ties,
    pinned: isHeld(el.nodeId) && anyMemberFullyHeld,
  };
}

// ── signed hinge angle + gradients ────────────────────────────────────────
export interface Angle3 {
  theta: number;
  ga: Vec3;
  gb: Vec3;
  gp: Vec3;
}

/** Signed relative angle about the CURRENT axis direction n = unit(V − P):
 *   θ = atan2(dot(cross(va′, vb), n), dot(va′, vb))
 * with va′ = P − A (continuation of memberA through the pivot) and
 * vb = B − P — same "0 = straight continuation" convention and discontinuity
 * placement as the 2D solver; with n = +z and planar geometry it reduces
 * EXACTLY to the 2D atan2 formula. Gradients treat n as fixed within a
 * projection step (Gauss–Seidel only needs a descent direction; violation()
 * stays exact): ∂θ/∂A = (n × a⊥)/|a⊥|², the 3D analogue of perp(va′)/|va′|². */
export function angle3(pivot: Pt3, a: Pt3, b: Pt3, axisBase: Pt3, axisTip: Pt3): Angle3 | null {
  const n = normalize({
    x: axisTip.x - axisBase.x,
    y: axisTip.y - axisBase.y,
    z: axisTip.z - axisBase.z,
  });
  if (dot(n, n) < 0.5) return null;
  const va: Vec3 = { x: pivot.x - a.x, y: pivot.y - a.y, z: pivot.z - a.z };
  const vb: Vec3 = { x: b.x - pivot.x, y: b.y - pivot.y, z: b.z - pivot.z };
  const aPerp = sub(va, scale(n, dot(va, n)));
  const bPerp = sub(vb, scale(n, dot(vb, n)));
  const la2 = dot(aPerp, aPerp);
  const lb2 = dot(bPerp, bPerp);
  if (la2 < 1e-12 || lb2 < 1e-12) return null;
  const theta = Math.atan2(dot(cross(va, vb), n), dot(va, vb));
  const ga = scale(cross(n, aPerp), 1 / la2);
  const gb = scale(cross(n, bPerp), 1 / lb2);
  const gp: Vec3 = { x: -(ga.x + gb.x), y: -(ga.y + gb.y), z: -(ga.z + gb.z) };
  return { theta, ga, gb, gp };
}

/** Signed hinge angle at a DRAWN pose about a document-space axis (θ₀ for
 * torsion cables — at the drawn pose the virtual sits exactly on the axis). */
export function drawnAngle3(pivot: Vec3, a: Vec3, b: Vec3, axis: Vec3): number {
  const va = sub(pivot, a);
  const vb = sub(b, pivot);
  return Math.atan2(dot(cross(va, vb), axis), dot(va, vb));
}

/** Rodrigues rotation of v about a unit axis by angle (driven-node angle
 * channels rotate about their pivot's hinge axis). */
export function rotateAboutAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = axis;
  const kxv = cross(k, v);
  const kdv = dot(k, v);
  return {
    x: v.x * c + kxv.x * s + k.x * kdv * (1 - c),
    y: v.y * c + kxv.y * s + k.y * kdv * (1 - c),
    z: v.z * c + kxv.z * s + k.z * kdv * (1 - c),
  };
}
