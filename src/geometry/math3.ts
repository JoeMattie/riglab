// Minimal, dependency-free 3D vector/quaternion helpers for assembly
// composition (§5.4). Kept framework-free (no three.js) so the composition
// module stays a pure, fast-to-test layer over solve() results; the r3f UI
// converts these plain records to three objects at the boundary.
import type { Quaternion, Vec3 } from '../schema';

export const IDENTITY_Q: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l < 1e-12 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l);
}

/** Rotate vector v by unit quaternion q: v' = v + 2·q.w·(q×v) + 2·q×(q×v). */
export function rotate(q: Quaternion, v: Vec3): Vec3 {
  const qv: Vec3 = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(qv, v), 2);
  return add(add(v, scale(t, q.w)), cross(qv, t));
}

/** Hamilton product a·b (apply b first, then a — same convention as three). */
export function mulQ(a: Quaternion, b: Quaternion): Quaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Build a quaternion from an orthonormal basis given as its column axes
 * (local +x → x, +y → y, +z → z in world). */
export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quaternion {
  // Rotation matrix columns are the basis axes; convert to quaternion.
  const m00 = x.x;
  const m10 = x.y;
  const m20 = x.z;
  const m01 = y.x;
  const m11 = y.y;
  const m21 = y.z;
  const m02 = z.x;
  const m12 = z.y;
  const m22 = z.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
}
