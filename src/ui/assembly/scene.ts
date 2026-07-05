// Pure scene extraction for the 3D Assembly viewport (§8.3). Turns a composed
// assembly into world-space polylines (mechanism elements + the wearer
// mannequin) the r3f layer draws as <Line>s. Kept pure so the geometry is
// unit-testable without a WebGL context.

import type { ComposedInstance } from '../../assembly';
import type { MechanismElement, Vec3 } from '../../schema';
import type { SkeletonFrame } from '../../wearer/skeleton';

export type Segment = [Vec3, Vec3];

/** Ordered node ids to stroke for an element, or null for elements that carry
 * no drawn geometry of their own (pivots/sliders live at a node; torsion
 * cables are an abstract angle coupling). Bowden returns both cable runs. */
export function elementPolylines(el: MechanismElement): string[][] {
  switch (el.type) {
    case 'link':
    case 'telescope':
    case 'elastic':
      return [[el.nodeA, el.nodeB]];
    case 'bentLink':
      return [el.nodeIds];
    case 'rope':
      return [el.path];
    case 'bowden':
      return [
        [el.a1, el.a2],
        [el.b1, el.b2],
      ];
    default:
      return [];
  }
}

/** World-space segments for one instance's mechanism, given its lifted nodes.
 * Segments whose endpoints are missing (unsolved) are skipped. */
export function instanceSegments(
  elements: MechanismElement[],
  nodeWorld: ComposedInstance['nodeWorld'],
): Segment[] {
  const out: Segment[] = [];
  for (const el of elements) {
    for (const poly of elementPolylines(el)) {
      for (let i = 1; i < poly.length; i++) {
        const a = nodeWorld[poly[i - 1]!];
        const b = nodeWorld[poly[i]!];
        if (a && b) out.push([a, b]);
      }
    }
  }
  return out;
}

/** Wearer mannequin bones in world space (§7 stick figure). */
export function mannequinBones(frame: SkeletonFrame): Segment[] {
  const P = frame.points;
  const chain = (...ids: (keyof typeof P)[]): Segment[] => {
    const segs: Segment[] = [];
    for (let i = 1; i < ids.length; i++) segs.push([P[ids[i - 1]!], P[ids[i]!]]);
    return segs;
  };
  return [
    ...chain('pelvis', 'spineTop', 'head'),
    ...chain('shoulderL', 'shoulderR'),
    ...chain('hipL', 'hipR'),
    ...chain('shoulderL', 'elbowL', 'handL'),
    ...chain('shoulderR', 'elbowR', 'handR'),
    ...chain('hipL', 'kneeL', 'ankleL', 'shoeL'),
    ...chain('hipR', 'kneeR', 'ankleR', 'shoeR'),
  ];
}
