// Hinge-plane arcs (Joe's ask): a thin arc swept between a pivot's member
// pipes, lying IN the hinge plane (⊥ the hinge axis) at the pivot node.
// Panels project the same 3D polyline — a true circular arc in the view
// whose normal matches the axis, foreshortened elsewhere — so the arc's
// shape itself indicates which plane the pivot works in; the perspective
// view draws it directly. Pure math, unit-tested without a canvas.
import type { Mechanism, PivotElement, Vec3 } from '../schema';

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (v: Vec3): Vec3 | null => {
  const len = Math.hypot(v.x, v.y, v.z);
  return len > 1e-9 ? { x: v.x / len, y: v.y / len, z: v.z / len } : null;
};

/** Unit direction from the pivot node toward a member's adjacent point. */
function memberDir(
  mech: Mechanism,
  memberId: string,
  nodeId: string,
  positions: Record<string, Vec3>,
): Vec3 | null {
  const el = mech.elements.find((e) => e.id === memberId);
  if (!el) return null;
  let otherId: string | undefined;
  if (el.type === 'link' || el.type === 'telescope') {
    otherId = el.nodeA === nodeId ? el.nodeB : el.nodeB === nodeId ? el.nodeA : undefined;
  } else if (el.type === 'bentLink') {
    const i = el.nodeIds.indexOf(nodeId);
    if (i >= 0) otherId = el.nodeIds[i + 1] ?? el.nodeIds[i - 1];
  }
  const at = positions[nodeId];
  const other = otherId ? positions[otherId] : undefined;
  return at && other ? unit(sub(other, at)) : null;
}

/** The in-plane frame the hinge angle is measured in (for the interactive
 * angle-limit handles): `ref` is the θ=0 direction (the straight continuation
 * of angleLimit.memberA through the pivot), `e2 = axis × ref` is the +θ
 * direction, both unit and in the hinge plane. `center` is the pivot node.
 * A hinge angle θ maps to the world point center + radius·(cosθ·ref +
 * sinθ·e2). Null unless the pivot is a hinge with a resolvable memberA. */
export interface PivotAngleFrame {
  center: Vec3;
  axis: Vec3;
  ref: Vec3;
  e2: Vec3;
}

export function pivotAngleFrame(
  mech: Mechanism,
  pivot: PivotElement,
  positions: Record<string, Vec3>,
): PivotAngleFrame | null {
  if (pivot.joint.kind !== 'hinge' || !pivot.angleLimit) return null;
  const center = positions[pivot.nodeId];
  const axis = unit(pivot.joint.axis);
  if (!center || !axis) return null;
  const mDir = memberDir(mech, pivot.angleLimit.memberA, pivot.nodeId, positions);
  if (!mDir) return null;
  // continuation of memberA = −(direction toward memberA's far node),
  // projected into the hinge plane
  const cont = { x: -mDir.x, y: -mDir.y, z: -mDir.z };
  const ref = unit(
    sub(cont, {
      x: axis.x * dot(cont, axis),
      y: axis.y * dot(cont, axis),
      z: axis.z * dot(cont, axis),
    }),
  );
  if (!ref) return null;
  const e2 = cross(axis, ref); // unit (axis ⟂ ref, both unit)
  return { center, axis, ref, e2 };
}

/** World point on the angle circle at hinge angle θ (radians), radius r. */
export function pivotAnglePoint(f: PivotAngleFrame, radiusM: number, theta: number): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    x: f.center.x + radiusM * (c * f.ref.x + s * f.e2.x),
    y: f.center.y + radiusM * (c * f.ref.y + s * f.e2.y),
    z: f.center.z + radiusM * (c * f.ref.z + s * f.e2.z),
  };
}

/** Weld groups: members welded to each other move as ONE side of the arc. */
function weldGroups(pivot: PivotElement): string[][] {
  const root = new Map<string, string>(pivot.memberIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let r = id;
    while (root.get(r) !== r) r = root.get(r)!;
    return r;
  };
  for (const [a, b] of pivot.welds) {
    if (root.has(a) && root.has(b)) root.set(find(b), find(a));
  }
  const groups = new Map<string, string[]>();
  for (const id of pivot.memberIds) {
    const r = find(id);
    const g = groups.get(r) ?? [];
    g.push(id);
    groups.set(r, g);
  }
  return [...groups.values()];
}

/**
 * The arc polyline for a hinge pivot, or null when no arc applies: spherical
 * joints (no single plane), fully-welded junctions (rigid), ground hinges
 * with a single member, or unresolved geometry. The arc sweeps the SHORT way
 * about the hinge axis between the two closest member directions (one from
 * each of the first two weld groups — a weld+pivot junction reads as the
 * arriving pipe against the nearer half of the through pipe), at `radiusM`
 * from the node, sampled into `segments` chords.
 */
export function pivotArcPoints(
  mech: Mechanism,
  pivot: PivotElement,
  positions: Record<string, Vec3>,
  radiusM: number,
  segments = 16,
): Vec3[] | null {
  if (pivot.joint.kind !== 'hinge') return null;
  if (pivot.welds.length > 0 && pivot.welds.length >= pivot.memberIds.length - 1) return null;
  const center = positions[pivot.nodeId];
  if (!center) return null;
  const axis = unit(pivot.joint.axis);
  if (!axis) return null;

  const inPlane = (d: Vec3): Vec3 | null =>
    unit(sub(d, { x: axis.x * dot(d, axis), y: axis.y * dot(d, axis), z: axis.z * dot(d, axis) }));

  // ── angle-limited pivot: draw the ALLOWED WEDGE from min to max, anchored
  //    on the straight continuation of memberA (0 = straight, hinge.ts) ─────
  if (pivot.angleLimit) {
    const mDir = memberDir(mech, pivot.angleLimit.memberA, pivot.nodeId, positions);
    const ref = mDir ? inPlane({ x: -mDir.x, y: -mDir.y, z: -mDir.z }) : null; // continuation
    if (ref) {
      const e2 = cross(axis, ref);
      return sweep(
        center,
        ref,
        e2,
        radiusM,
        pivot.angleLimit.minRad,
        pivot.angleLimit.maxRad,
        segments,
      );
    }
  }

  const groups = weldGroups(pivot);
  if (groups.length < 2) return null;

  // per-group member directions projected into the hinge plane
  const planeDirs = (ids: string[]): Vec3[] =>
    ids.flatMap((id) => {
      const d = memberDir(mech, id, pivot.nodeId, positions);
      const p = d ? inPlane(d) : null;
      return p ? [p] : [];
    });
  const dirsA = planeDirs(groups[0]!);
  const dirsB = planeDirs(groups[1]!);
  if (dirsA.length === 0 || dirsB.length === 0) return null;

  // the arc spans the two CLOSEST directions, one per side
  let best: { a: Vec3; b: Vec3; cos: number } | null = null;
  for (const a of dirsA) {
    for (const b of dirsB) {
      const c = dot(a, b);
      if (!best || c > best.cos) best = { a, b, cos: c };
    }
  }
  if (!best) return null;

  // signed sweep about the axis, short way (|θ| ≤ π by atan2)
  const theta = Math.atan2(dot(cross(best.a, best.b), axis), best.cos);
  if (Math.abs(theta) < 1e-6) return null; // collinear — nothing to sweep
  const e2 = cross(axis, best.a);
  return sweep(center, best.a, e2, radiusM, 0, theta, segments);
}

/** Circular arc: center + radius·(cos·base + sin·perp), from angle t0 to t1. */
function sweep(
  center: Vec3,
  base: Vec3,
  perp: Vec3,
  radiusM: number,
  t0: number,
  t1: number,
  segments: number,
): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = t0 + (i / segments) * (t1 - t0);
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push({
      x: center.x + radiusM * (c * base.x + s * perp.x),
      y: center.y + radiusM * (c * base.y + s * perp.y),
      z: center.z + radiusM * (c * base.z + s * perp.z),
    });
  }
  return pts;
}
