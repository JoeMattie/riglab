// Shared pipe geometry (§4.2). Pure functions used by BOTH the solver (link /
// bentLink self-weight from length) and the BOM (cut lengths, bend schedule),
// so the developed-length definition lives in exactly one place.
import type { Vec2 } from '../schema';

/** Sum of consecutive segment lengths through the points (the sharp polyline
 * / chord length). */
export function polylineLengthM(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

/** Deflection (turn) angle at an interior vertex: 0 = straight through,
 * π = full reversal. */
export function deflectionAngleRad(prev: Vec2, vertex: Vec2, next: Vec2): number {
  const inx = vertex.x - prev.x;
  const iny = vertex.y - prev.y;
  const outx = next.x - vertex.x;
  const outy = next.y - vertex.y;
  const li = Math.hypot(inx, iny);
  const lo = Math.hypot(outx, outy);
  if (li < 1e-12 || lo < 1e-12) return 0;
  const cos = (inx * outx + iny * outy) / (li * lo);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/** Developed (centre-line) length of a heat-bent pipe through the points, with
 * an optional fillet radius per interior vertex (filletRadiiM[i] applies to
 * the (i+1)-th point, matching the schema's length = nodeIds.length − 2). A
 * fillet of radius r at a vertex of deflection φ replaces 2·r·tan(φ/2) of sharp
 * polyline with an r·φ arc, so:
 *   developed = Σ segments − Σ_vertices r·(2·tan(φ/2) − φ).
 * With all radii 0 this equals the polyline length. Clamped ≥ 0. */
export function developedLengthM(points: Vec2[], filletRadiiM: number[]): number {
  let total = polylineLengthM(points);
  for (let i = 1; i < points.length - 1; i++) {
    const r = filletRadiiM[i - 1] ?? 0;
    if (r <= 0) continue;
    const phi = deflectionAngleRad(points[i - 1]!, points[i]!, points[i + 1]!);
    total -= r * (2 * Math.tan(phi / 2) - phi);
  }
  return Math.max(0, total);
}
