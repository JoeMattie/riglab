// Shared axis→transform math for cylinder/capsule meshes: place a unit-Y
// primitive along the segment a→b. Used by the wireframe tubes and the pipe
// model layer.
import { Quaternion as ThreeQuat, Vector3 } from 'three';
import type { Vec3 } from '../../schema';

const WORLD_UP = new Vector3(0, 1, 0);

export interface AxisPlacement {
  mid: Vector3;
  quat: ThreeQuat;
  len: number;
}

export function placeAxis(a: Vec3, b: Vec3): AxisPlacement | null {
  const va = new Vector3(a.x, a.y, a.z);
  const vb = new Vector3(b.x, b.y, b.z);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  if (len < 1e-6) return null;
  return {
    mid: va.clone().add(vb).multiplyScalar(0.5),
    quat: new ThreeQuat().setFromUnitVectors(WORLD_UP, dir.multiplyScalar(1 / len)),
    len,
  };
}
