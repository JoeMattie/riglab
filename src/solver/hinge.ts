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

/** Drawn axial offsets below this are treated as numerical drift, not design
 * intent, for FRAME-FIXED (pinned-axis) hinge ties — see hingePlan. */
const AXIAL_SNAP_M = 1e-4;

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
 * Pinning rule: when the PIVOT NODE is held (anchor/driven/drag-held), the
 * pin's body is bolted to the frame, so its axis is frame-fixed too — the
 * virtual is pinned at (current pivot + drawn axis·h) with weight 0. Distance
 * ties alone would instead let the axis precess about a member (a cone
 * manifold that keeps out-of-plane drift injected by violated drags — the
 * planar-sketch feel demands a drawn side-panel four-bar stay planar). A
 * single-member pivot at an anchored node is exactly a GROUND HINGE (pin
 * fixed to the frame); at a free node a single-member hinge is inert but
 * harmless. Hinges whose pivot node is mobile keep a free virtual. */
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
  for (const memberId of el.memberIds) {
    const member = elementById.get(memberId);
    if (!member) continue;
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
  const pinned = isHeld(el.nodeId);
  for (const tie of ties) {
    let p = posOf.get(tie.nodeId)!;
    if (pinned) {
      // Axial-offset snap for frame-fixed hinges: tie rests otherwise
      // PRESERVE whatever axial offset the drawn node carries, so per-frame
      // solver residue (a hard toggle pose can leave ~1e-5) fed back as new
      // drawn geometry would ratchet a sketched-planar linkage off its plane
      // forever. Sub-threshold offsets are numerical noise, never design
      // intent (real axial offsets are ≥ tenths of a millimetre), so the
      // rest is computed as if the node sat exactly on the pin's plane —
      // the solve then pulls the drift back to zero instead of keeping it.
      const off = dot(sub(p, pivotPos), axis);
      if (Math.abs(off) < AXIAL_SNAP_M) p = sub(p, scale(axis, off));
    }
    tie.rest = dist3(drawnVirtualPos, p);
  }

  return {
    virtualId: virtualAxisId(el.id),
    pivotNodeId: el.nodeId,
    axis,
    h,
    drawnVirtualPos,
    ties,
    pinned,
  };
}

/** Slop half-angle for an axis-locked hinge (Joe's "allowed slop"): the
 * virtual axis particle may lean this far off the drawn axis before the lock
 * corrects it. A little give so a drag settles into the cone instead of
 * fighting an infinitely-stiff pin — the old hard placement overshot (a 5 cm
 * drag flung to 20 cm) and never converged. ~4°. */
export const HINGE_AXIS_SLOP_RAD = (4 * Math.PI) / 180;

/** Cone-limit a hinge's virtual axis particle. Given the pivot position, the
 * current virtual position, the drawn unit axis and offset, return where the
 * virtual should move so it sits within `slop` radians of the drawn axis
 * (angle measured at the pivot), preserving its current distance from the
 * pivot so the axis DISTANCE tie stays this constraint's job to fight, not
 * ours. Returns null when the virtual is already inside the cone — that null
 * IS the give: small leans get no correction and nothing to fight, so the
 * solve converges; only the excess beyond the cone is projected back. */
export function coneLimitVirtual(pivot: Pt3, virtual: Pt3, axis: Vec3, slop: number): Vec3 | null {
  const dx = virtual.x - pivot.x;
  const dy = virtual.y - pivot.y;
  const dz = virtual.z - pivot.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) return null;
  const along = dx * axis.x + dy * axis.y + dz * axis.z;
  const px = dx - along * axis.x;
  const py = dy - along * axis.y;
  const pz = dz - along * axis.z;
  const perp = Math.sqrt(px * px + py * py + pz * pz);
  const angle = Math.atan2(perp, along);
  if (angle <= slop) return null;
  // rotate d toward the axis onto the cone boundary, keeping |d| = len
  const cs = Math.cos(slop) * len;
  const sn = perp > 1e-12 ? (Math.sin(slop) * len) / perp : 0;
  return {
    x: pivot.x + axis.x * cs + px * sn,
    y: pivot.y + axis.y * cs + py * sn,
    z: pivot.z + axis.z * cs + pz * sn,
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
