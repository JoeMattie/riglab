import { describe, expect, it } from 'vitest';
import type { Vec3, ViewOrientation } from '../schema';
import { rotate } from './math3';
import { defaultPlacement, orientationFrame } from './placement';

const close = (a: Vec3, b: Vec3) => {
  expect(a.x).toBeCloseTo(b.x, 10);
  expect(a.y).toBeCloseTo(b.y, 10);
  expect(a.z).toBeCloseTo(b.z, 10);
};

describe('orientationFrame / defaultPlacement', () => {
  it('side views keep the sketch upright in the world x-y plane, offset ±z', () => {
    const left = defaultPlacement('side-left');
    // local +x (screen-right) → wearer front (+x); local +y stays up
    close(rotate(left.quaternion, { x: 1, y: 0, z: 0 }), { x: 1, y: 0, z: 0 });
    close(rotate(left.quaternion, { x: 0, y: 1, z: 0 }), { x: 0, y: 1, z: 0 });
    expect(left.position.z).toBeGreaterThan(0); // wearer-left is +z

    const right = defaultPlacement('side-right');
    // mirrored: screen-right → -x so the drawing faces the viewer on that side
    close(rotate(right.quaternion, { x: 1, y: 0, z: 0 }), { x: -1, y: 0, z: 0 });
    expect(right.position.z).toBeLessThan(0);
  });

  it('front/back views map the plane normal onto ±x', () => {
    const front = orientationFrame('front');
    close(front.zAxis, { x: 1, y: 0, z: 0 });
    close(front.yAxis, { x: 0, y: 1, z: 0 });
    const back = orientationFrame('back');
    close(back.zAxis, { x: -1, y: 0, z: 0 });
    expect(defaultPlacement('front').position.x).toBeGreaterThan(0);
    expect(defaultPlacement('back').position.x).toBeLessThan(0);
  });

  it('top view lays the sketch horizontal (normal looking down -y), lifted up', () => {
    const top = defaultPlacement('top');
    // local +y (screen-up) → world +z (wearer-left); plane normal → -y
    close(rotate(top.quaternion, { x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: 1 });
    close(rotate(top.quaternion, { x: 0, y: 0, z: 1 }), { x: 0, y: -1, z: 0 });
    expect(top.position.y).toBeGreaterThan(1);
  });

  it('free falls back to the front frame', () => {
    expect(defaultPlacement('free')).toEqual(defaultPlacement('front'));
  });

  it('every orientation yields a right-handed orthonormal frame', () => {
    const orientations: ViewOrientation[] = [
      'side-left',
      'side-right',
      'front',
      'back',
      'top',
      'free',
    ];
    for (const vo of orientations) {
      const f = orientationFrame(vo);
      const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
      expect(dot(f.xAxis, f.yAxis)).toBeCloseTo(0, 10);
      expect(dot(f.xAxis, f.xAxis)).toBeCloseTo(1, 10);
      // z = x × y (right-handed)
      close(
        {
          x: f.xAxis.y * f.yAxis.z - f.xAxis.z * f.yAxis.y,
          y: f.xAxis.z * f.yAxis.x - f.xAxis.x * f.yAxis.z,
          z: f.xAxis.x * f.yAxis.y - f.xAxis.y * f.yAxis.x,
        },
        f.zAxis,
      );
    }
  });
});
