import { describe, expect, it } from 'vitest';
import { defaultPlacement } from '../assembly/placement';
import { fixtureProject } from '../schema/fixtures';
import { addInstance } from './docOps';

describe('addInstance (one-click Place)', () => {
  it('creates a fixed-drive instance at the view-orientation default plane', () => {
    const doc = fixtureProject();
    const mech = doc.mechanisms[0]!;
    const before = doc.assembly.instances.length;

    const { doc: next, instanceId } = addInstance(doc, mech.id);
    expect(instanceId).not.toBeNull();
    expect(next.assembly.instances).toHaveLength(before + 1);

    const inst = next.assembly.instances.find((i) => i.id === instanceId)!;
    const placement = defaultPlacement(mech.viewOrientation);
    expect(inst.mechanismId).toBe(mech.id);
    expect(inst.name).toBe(mech.name);
    expect(inst.mirror).toBe(false);
    expect(inst.transformDrive).toEqual({ kind: 'fixed' });
    expect(inst.position).toEqual(placement.position);
    expect(inst.quaternion).toEqual(placement.quaternion);
    // original document untouched (pure op)
    expect(doc.assembly.instances).toHaveLength(before);
  });

  it('is a no-op for an unknown mechanism id', () => {
    const doc = fixtureProject();
    const { doc: next, instanceId } = addInstance(doc, 'nope');
    expect(instanceId).toBeNull();
    expect(next).toBe(doc);
  });
});
