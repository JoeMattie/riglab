import { describe, expect, it } from 'vitest';
import { composeProject } from '../../assembly';
import { buildFullCreatureProject } from '../../examples';
import { computeSkeleton, REST_POSE } from '../../wearer';
import { elementPolylines, instanceSegments, mannequinBones } from './scene';

describe('elementPolylines', () => {
  it('strokes link/telescope/elastic end-to-end, bentLink through its path', () => {
    expect(elementPolylines({ type: 'link', nodeA: 'a', nodeB: 'b' } as never)).toEqual([
      ['a', 'b'],
    ]);
    expect(elementPolylines({ type: 'bentLink', nodeIds: ['a', 'b', 'c'] } as never)).toEqual([
      ['a', 'b', 'c'],
    ]);
    expect(elementPolylines({ type: 'rope', path: ['a', 'b', 'c'] } as never)).toEqual([
      ['a', 'b', 'c'],
    ]);
  });

  it('draws both bowden cable runs and nothing for pivots', () => {
    expect(
      elementPolylines({ type: 'bowden', a1: 'a', a2: 'b', b1: 'c', b2: 'd' } as never),
    ).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(elementPolylines({ type: 'pivot', nodeId: 'n' } as never)).toEqual([]);
  });
});

describe('instanceSegments + mannequinBones on the full creature', () => {
  const project = buildFullCreatureProject();

  it('produces drawable segments for every instanced mechanism', () => {
    const c = composeProject(project);
    const mechById = new Map(project.mechanisms.map((m) => [m.id, m]));
    for (const inst of project.assembly.instances) {
      const composed = c.instances[inst.id]!;
      const segs = instanceSegments(mechById.get(inst.mechanismId)!.elements, composed.nodeWorld);
      expect(segs.length).toBeGreaterThan(0);
      for (const [a, b] of segs) {
        expect(Number.isFinite(a.x) && Number.isFinite(b.z)).toBe(true);
      }
    }
  });

  it('skips segments whose endpoints are unsolved', () => {
    const segs = instanceSegments(
      [{ id: 'x', type: 'link', nodeA: 'a', nodeB: 'missing' } as never],
      { a: { x: 0, y: 0, z: 0 } },
    );
    expect(segs).toHaveLength(0);
  });

  it('draws the mannequin skeleton', () => {
    const bones = mannequinBones(computeSkeleton(project.wearer, REST_POSE));
    expect(bones.length).toBeGreaterThan(8);
  });
});
