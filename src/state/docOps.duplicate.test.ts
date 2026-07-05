import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Project } from '../schema/project';
import { addPipe, duplicateElement } from './docOps';

function projectWithPipe(): { doc: Project; linkId: string } {
  const piped = addPipe(
    createEmptyProject('p', 'P'),
    [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    { kind: 'newNode', pos: { x: 0, y: 0, z: 0 } },
    { kind: 'newNode', pos: { x: 1, y: 0, z: 0 } },
  );
  return { doc: piped.doc, linkId: piped.elementId };
}

describe('duplicateElement', () => {
  it('clones a link with fresh, offset, free nodes (z preserved)', () => {
    const { doc, linkId } = projectWithPipe();
    const before = doc.mechanism;
    const { doc: after, newElementId } = duplicateElement(doc, linkId);
    expect(newElementId).not.toBeNull();
    const m = after.mechanism;
    expect(m.elements.filter((e) => e.type === 'link')).toHaveLength(2);
    expect(m.nodes).toHaveLength(before.nodes.length + 2);

    const copy = m.elements.find((e) => e.id === newElementId)!;
    const orig = m.elements.find((e) => e.id === linkId)!;
    if (copy.type !== 'link' || orig.type !== 'link') throw new Error('expected links');
    // distinct nodes
    expect(copy.nodeA).not.toBe(orig.nodeA);
    expect(copy.nodeB).not.toBe(orig.nodeB);
    // offset by (0.1, −0.1, 0) and free
    const cA = m.nodes.find((n) => n.id === copy.nodeA)!;
    const oA = m.nodes.find((n) => n.id === orig.nodeA)!;
    expect(cA.position.x).toBeCloseTo(oA.position.x + 0.1, 9);
    expect(cA.position.y).toBeCloseTo(oA.position.y - 0.1, 9);
    expect(cA.position.z).toBeCloseTo(oA.position.z, 9);
    expect(cA.kind).toBe('free');
  });

  it('is a no-op for joints/ropes (returns null)', () => {
    const { doc } = projectWithPipe();
    const pivot = doc.mechanism.elements.find((e) => e.type === 'pivot');
    if (pivot) {
      const r = duplicateElement(doc, pivot.id);
      expect(r.newElementId).toBeNull();
      expect(r.doc).toBe(doc);
    }
    const missing = duplicateElement(doc, 'nope');
    expect(missing.newElementId).toBeNull();
  });
});
