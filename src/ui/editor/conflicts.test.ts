// Conflict-list derivation for the DOF pill (design handoff §9).
import { describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../../bom/testHelpers';
import type { LinkElement, Project, RopeElement } from '../../schema';
import { createEmptyProject } from '../../schema';
import { deriveConflicts } from './conflicts';

const L1: LinkElement = {
  id: 'L1',
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
};
const R1: RopeElement = {
  id: 'R1',
  type: 'rope',
  maturity: 'sketch',
  path: ['n1', 'n2'],
  lengthM: 5,
};

const m = (locked = false) =>
  mech([{ ...L1, lengthLocked: locked || undefined }, R1], [node('n1', 0, 0), node('n2', 3, 4)]);

function project(locked = false): Project {
  const p = createEmptyProject('p1', 'test');
  return { ...p, materials: testMaterials(), mechanism: m(locked) };
}

describe('deriveConflicts', () => {
  it('returns no rows for a healthy mechanism', () => {
    expect(deriveConflicts(m(), { dof: 1, classification: 'mechanism' }, [], [])).toEqual([]);
  });

  it('maps violated ids to labelled rows with zoom targets', () => {
    const rows = deriveConflicts(m(), { dof: 0, classification: 'structure' }, ['L1'], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ elementId: 'L1', issue: 'constraint violated' });
    expect(rows[0]!.label).toContain('link');
  });

  it('a violated LOCKED pipe gets an "unlock length" fix that clears the lock', () => {
    const rows = deriveConflicts(m(true), { dof: 0, classification: 'structure' }, ['L1'], []);
    expect(rows[0]!.issue).toBe('locked length in conflict');
    const fixed = rows[0]!.fix!.apply(project(true));
    const link = fixed.mechanism.elements.find((e) => e.id === 'L1') as LinkElement;
    expect(link.lengthLocked).toBeUndefined();
  });

  it('compression ropes get their own wording and are not double-reported', () => {
    const rows = deriveConflicts(m(), { dof: 1, classification: 'mechanism' }, ['R1'], ['R1']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ elementId: 'R1', issue: 'requires compression' });
  });

  it('over-constrained adds a mechanism row; with a locked length it offers the unlock fix', () => {
    const none = deriveConflicts(m(), { dof: -1, classification: 'overconstrained' }, [], []);
    expect(none).toHaveLength(1);
    expect(none[0]!.fix).toBeUndefined();

    const withLock = deriveConflicts(
      m(true),
      { dof: -1, classification: 'overconstrained' },
      [],
      [],
    );
    expect(withLock[0]!.fix!.label).toBe('unlock a length');
    expect(withLock[0]!.elementId).toBe('L1');
  });
});
