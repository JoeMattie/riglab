// Shared pipe geometry (§4.2). Pure functions used by BOTH the solver (link /
// bentLink self-weight from length) and the BOM (cut lengths, bend schedule),
// so the developed-length definition lives in exactly one place. Fully 3D
// (PLANFILE-3d-conversion.md): all inputs are Vec3 polylines; every quantity
// here is intrinsic to the polyline (lengths, turn angles, relative bend
// planes) and therefore invariant under rigid transforms — lifted geometry
// yields identical cut lists.
import type { Vec3 } from '../schema';
import { cross, dot, length, normalize, scale, sub } from './math3';

const EPS = 1e-9;

/** Sum of consecutive segment lengths through the points (the sharp polyline
 * / chord length). */
export function polylineLengthM(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  return total;
}

/** Deflection (turn) angle at an interior vertex: 0 = straight through,
 * π = full reversal. Plane-independent — the angle between the incoming and
 * outgoing segment directions is the same in any plane through the three
 * points. */
export function deflectionAngleRad(prev: Vec3, vertex: Vec3, next: Vec3): number {
  const din = sub(vertex, prev);
  const dout = sub(next, vertex);
  const li = length(din);
  const lo = length(dout);
  if (li < 1e-12 || lo < 1e-12) return 0;
  const cos = dot(din, dout) / (li * lo);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/** Developed (centre-line) length of a heat-bent pipe through the points, with
 * an optional fillet radius per interior vertex (filletRadiiM[i] applies to
 * the (i+1)-th point, matching the schema's length = nodeIds.length − 2). A
 * fillet of radius r at a vertex of deflection φ is a tangent arc in the plane
 * spanned by the two segments (any plane through three points — the math is
 * identical in 3D): it replaces 2·r·tan(φ/2) of sharp polyline with an r·φ
 * arc, so:
 *   developed = Σ segments − Σ_vertices r·(2·tan(φ/2) − φ).
 * With all radii 0 this equals the polyline length. Clamped ≥ 0. */
export function developedLengthM(points: Vec3[], filletRadiiM: number[]): number {
  let total = polylineLengthM(points);
  for (let i = 1; i < points.length - 1; i++) {
    const r = filletRadiiM[i - 1] ?? 0;
    if (r <= 0) continue;
    const phi = deflectionAngleRad(points[i - 1]!, points[i]!, points[i + 1]!);
    total -= r * (2 * Math.tan(phi / 2) - phi);
  }
  return Math.max(0, total);
}

/** Component of v perpendicular to the unit axis u. */
function perp(v: Vec3, u: Vec3): Vec3 {
  return sub(v, scale(u, dot(v, u)));
}

// ── Bend-plane rotation ("twist") convention — DECISIONS-style note ─────────
// Each bend of a heat-bent pipe lies in a plane (spanned by its incoming and
// outgoing segments). To fabricate a 3D bentLink, the builder makes bend 1,
// then ROTATES THE PIPE IN THE BENDER about the straight segment between
// bends before making bend 2, and so on. bendDihedralsRad reports that
// rotation per interior vertex:
//   • First bend: 0 by convention — the builder orients the first bend plane
//     freely; everything after is measured relative to it.
//   • Bend i: the signed dihedral angle from the PREVIOUS bend's plane to
//     this bend's plane, measured about the shared straight segment, with the
//     axis direction pointing from the previous vertex toward this vertex
//     (the direction of travel along the pipe). Sign = right-hand rule about
//     that axis: positive when the bend plane rotates counterclockwise as
//     seen looking back down the axis (thumb along travel direction).
//     Computed as atan2(dot(cross(n_prev, n_i), u), dot(n_prev, n_i)) on the
//     bend-plane normals n = u_in × u_out projected perpendicular to u.
//   • Degenerate vertices (collinear or reversal segments, |u_in × u_out|≈0)
//     have no bend plane: they report 0 and do NOT update the reference
//     plane, so a bend after a straight run is still measured against the
//     last real bend (the intervening segments are collinear, so the shared
//     axis stays well-defined).
// A planar polyline therefore reports all zeros (alternating ±π for zig-zags
// would appear only if the plane normal flipped; it does not — both u_in×u_out
// normals of a planar zig-zag point along ±the plane normal and the signed
// angle is 0 or ±π: 0 for same-way bends, ±π for an S-bend, which is exactly
// "flip the pipe over in the bender").
// ─────────────────────────────────────────────────────────────────────────────

/** Per-interior-vertex bend-plane rotation of a 3D polyline (radians), array
 * aligned with the schema's filletRadiiM (length = points.length − 2). See
 * the convention note above: first bend 0, sign = right-hand rule about the
 * shared segment's travel direction, degenerate vertices 0. */
export function bendDihedralsRad(points: Vec3[]): number[] {
  const out: number[] = [];
  let prevNormal: Vec3 | null = null;
  for (let i = 1; i < points.length - 1; i++) {
    const uIn = normalize(sub(points[i]!, points[i - 1]!));
    const uOut = normalize(sub(points[i + 1]!, points[i]!));
    const n = cross(uIn, uOut); // |n| = sin(deflection)
    if (length(n) < EPS) {
      // straight-through / reversal / zero-length segment: no bend plane here
      out.push(0);
      continue;
    }
    if (prevNormal === null) {
      out.push(0); // first real bend defines the reference plane
      prevNormal = n;
      continue;
    }
    // Signed angle from the previous bend plane to this one about the shared
    // segment direction uIn. Both normals are (near-)perpendicular to uIn;
    // project to be exact when intermediate collinearity is approximate.
    const a = perp(prevNormal, uIn);
    const b = perp(n, uIn);
    if (length(a) < EPS || length(b) < EPS) out.push(0);
    else out.push(Math.atan2(dot(cross(a, b), uIn), dot(a, b)));
    prevNormal = n;
  }
  return out;
}
