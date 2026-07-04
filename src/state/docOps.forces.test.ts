import { describe, expect, it } from 'vitest';
import type { Mechanism, PivotElement, Project } from '../schema';
import { createEmptyProject } from '../schema/project';
import {
  addBowden,
  addElastic,
  addInputChannel,
  addMechanism,
  addRope,
  addTorsionCable,
  DEFAULT_ELASTIC_STIFFNESS_N_PER_M,
  type EndSpec,
  removeInputChannel,
  setGravity,
  setInputChannel,
} from './docOps';

function freshMechanism(): { doc: Project; mechId: string } {
  const { doc, mechanismId } = addMechanism(createEmptyProject('p', 'p'), 'side-left');
  return { doc, mechId: mechanismId };
}

const newNode = (x: number, y: number): EndSpec => ({ kind: 'newNode', pos: { x, y } });
const mechOf = (doc: Project): Mechanism => doc.mechanisms[0]!;

describe('addRope', () => {
  it('creates a tension cord through its path with rest length = drawn length', () => {
    const { doc, mechId } = freshMechanism();
    const { doc: next, elementId } = addRope(doc, mechId, [newNode(0, 0), newNode(0, 1)]);
    const rope = mechOf(next).elements.find((e) => e.id === elementId)!;
    expect(rope.type).toBe('rope');
    if (rope.type !== 'rope') return;
    expect(rope.path).toHaveLength(2);
    expect(rope.lengthM).toBeCloseTo(1, 9);
    expect(mechOf(next).nodes).toHaveLength(2);
  });

  it('routes through interior waypoints (eyelets) and sums the path length', () => {
    const { doc, mechId } = freshMechanism();
    const { doc: next, elementId } = addRope(doc, mechId, [
      newNode(0, 0),
      newNode(0, 1),
      newNode(1, 1),
    ]);
    const rope = mechOf(next).elements.find((e) => e.id === elementId)!;
    if (rope.type !== 'rope') throw new Error('not a rope');
    expect(rope.path).toHaveLength(3);
    expect(rope.lengthM).toBeCloseTo(2, 9);
  });
});

describe('addElastic', () => {
  it('creates a tension-only spring at rest = drawn length with the sketch default stiffness', () => {
    const { doc, mechId } = freshMechanism();
    const { doc: next, elementId } = addElastic(doc, mechId, newNode(0, 0), newNode(0, 0.5));
    const el = mechOf(next).elements.find((e) => e.id === elementId)!;
    if (el.type !== 'elastic') throw new Error('not an elastic');
    expect(el.restLengthM).toBeCloseTo(0.5, 9);
    expect(el.stiffnessNPerM).toBe(DEFAULT_ELASTIC_STIFFNESS_N_PER_M);
    expect(el.tensionOnly).toBe(true);
  });
});

describe('addBowden', () => {
  it('couples two drawn segments and records each rest length', () => {
    const { doc, mechId } = freshMechanism();
    const { doc: next, elementId } = addBowden(
      doc,
      mechId,
      newNode(0, 0),
      newNode(0.5, 0),
      newNode(1, 0),
      newNode(1.4, 0),
    );
    const el = mechOf(next).elements.find((e) => e.id === elementId)!;
    if (el.type !== 'bowden') throw new Error('not a bowden');
    expect(el.restLengthAM).toBeCloseTo(0.5, 9);
    expect(el.restLengthBM).toBeCloseTo(0.4, 9);
    expect(mechOf(next).nodes).toHaveLength(4);
  });
});

describe('addTorsionCable', () => {
  const withTwoPivots = (): { doc: Project; mechId: string } => {
    const { doc, mechId } = freshMechanism();
    const pivot = (id: string, nodeId: string): PivotElement => ({
      id,
      type: 'pivot',
      maturity: 'sketch',
      nodeId,
      memberIds: ['m1', 'm2'],
      welds: [],
    });
    const injected: Project = {
      ...doc,
      mechanisms: doc.mechanisms.map((m) =>
        m.id === mechId
          ? {
              ...m,
              nodes: [
                { id: 'na', kind: 'free', position: { x: 0, y: 0 } },
                { id: 'nb', kind: 'free', position: { x: 1, y: 0 } },
              ],
              elements: [pivot('piv-a', 'na'), pivot('piv-b', 'nb')],
            }
          : m,
      ),
    };
    return { doc: injected, mechId };
  };

  it('couples two distinct pivots with ratio 1 and no backlash', () => {
    const { doc, mechId } = withTwoPivots();
    const { doc: next, elementId } = addTorsionCable(doc, mechId, 'piv-a', 'piv-b');
    const el = mechOf(next).elements.find((e) => e.id === elementId)!;
    if (el.type !== 'torsionCable') throw new Error('not a torsion cable');
    expect(el.pivotA).toBe('piv-a');
    expect(el.pivotB).toBe('piv-b');
    expect(el.ratio).toBe(1);
    expect(el.backlashRad).toBe(0);
  });

  it('is a no-op when the two pivots are the same or one is not a pivot', () => {
    const { doc, mechId } = withTwoPivots();
    const same = addTorsionCable(doc, mechId, 'piv-a', 'piv-a').doc;
    expect(mechOf(same).elements.some((e) => e.type === 'torsionCable')).toBe(false);
    const bogus = addTorsionCable(doc, mechId, 'piv-a', 'na').doc;
    expect(mechOf(bogus).elements.some((e) => e.type === 'torsionCable')).toBe(false);
  });
});

describe('gravity + input channels', () => {
  it('toggles gravity per mechanism', () => {
    const { doc, mechId } = freshMechanism();
    expect(mechOf(doc).gravityOn).toBe(true); // side-left → elevation → gravity on
    const off = setGravity(doc, mechId, false);
    expect(mechOf(off).gravityOn).toBe(false);
  });

  it('adds a channel, clamps its value to range, toggles lock, and removes it', () => {
    const { doc, mechId } = freshMechanism();
    const { doc: added, channelId } = addInputChannel(doc, mechId);
    const ch = mechOf(added).inputs[0]!;
    expect(ch.name).toBe('input 1');
    expect(ch.locked).toBe(false);

    const clampedHigh = setInputChannel(added, mechId, channelId, { value: 5 });
    expect(mechOf(clampedHigh).inputs[0]!.value).toBe(1); // max is 1
    const clampedLow = setInputChannel(added, mechId, channelId, { value: -3 });
    expect(mechOf(clampedLow).inputs[0]!.value).toBe(0); // min is 0

    const locked = setInputChannel(added, mechId, channelId, { locked: true });
    expect(mechOf(locked).inputs[0]!.locked).toBe(true);

    const removed = removeInputChannel(added, mechId, channelId);
    expect(mechOf(removed).inputs).toHaveLength(0);
  });
});
