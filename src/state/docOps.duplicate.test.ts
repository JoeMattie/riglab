import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Project } from '../schema/project';
import { addMechanism, addPipe, duplicateElement } from './docOps';

function projectWithPipe(): { doc: Project; mechId: string; linkId: string } {
  let doc = createEmptyProject('p', 'P');
  const added = addMechanism(doc, 'side-left');
  doc = added.doc;
  const mechId = added.mechanismId;
  const piped = addPipe(
    doc,
    mechId,
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    { kind: 'newNode', pos: { x: 0, y: 0 } },
    { kind: 'newNode', pos: { x: 1, y: 0 } },
  );
  return { doc: piped.doc, mechId, linkId: piped.elementId };
}

describe('duplicateElement', () => {
  it('clones a link with fresh, offset, free nodes', () => {
    const { doc, mechId, linkId } = projectWithPipe();
    const before = doc.mechanisms[0]!;
    const { doc: after, newElementId } = duplicateElement(doc, mechId, linkId);
    expect(newElementId).not.toBeNull();
    const m = after.mechanisms[0]!;
    expect(m.elements.filter((e) => e.type === 'link')).toHaveLength(2);
    expect(m.nodes).toHaveLength(before.nodes.length + 2);

    const copy = m.elements.find((e) => e.id === newElementId)!;
    const orig = m.elements.find((e) => e.id === linkId)!;
    if (copy.type !== 'link' || orig.type !== 'link') throw new Error('expected links');
    // distinct nodes
    expect(copy.nodeA).not.toBe(orig.nodeA);
    expect(copy.nodeB).not.toBe(orig.nodeB);
    // offset by (0.1, −0.1) and free
    const cA = m.nodes.find((n) => n.id === copy.nodeA)!;
    const oA = m.nodes.find((n) => n.id === orig.nodeA)!;
    expect(cA.position.x).toBeCloseTo(oA.position.x + 0.1, 9);
    expect(cA.position.y).toBeCloseTo(oA.position.y - 0.1, 9);
    expect(cA.kind).toBe('free');
  });

  it('is a no-op for joints/ropes (returns null)', () => {
    const { doc, mechId } = projectWithPipe();
    const pivot = doc.mechanisms[0]!.elements.find((e) => e.type === 'pivot');
    if (pivot) {
      const r = duplicateElement(doc, mechId, pivot.id);
      expect(r.newElementId).toBeNull();
      expect(r.doc).toBe(doc);
    }
    const missing = duplicateElement(doc, mechId, 'nope');
    expect(missing.newElementId).toBeNull();
  });
});
