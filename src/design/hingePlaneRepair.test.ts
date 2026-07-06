import { describe, expect, it } from 'vitest';
import type { Mechanism, MechanismElement, MechanismNode, Vec3 } from '../schema';
import { detectOffPlaneHinges, OFF_PLANE_TOL_RAD } from './hingePlaneRepair';

const node = (id: string, position: Vec3): MechanismNode => ({ id, kind: 'free', position });
const link = (id: string, nodeA: string, nodeB: string): MechanismElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA,
  nodeB,
  pointMasses: [],
});
const hinge = (id: string, nodeId: string, memberIds: string[], axis: Vec3): MechanismElement => ({
  id,
  type: 'pivot',
  maturity: 'sketch',
  nodeId,
  joint: { kind: 'hinge', axis },
  memberIds,
  welds: [],
});

/** A bent 2-bar knee whose bars lie in the x–y plane (normal = ±z), with the
 * hinge axis set to `axis`. */
function knee(axis: Vec3): Mechanism {
  return {
    id: 'm',
    name: 't',
    nodes: [
      node('P', { x: 0, y: 0, z: 0 }),
      node('A', { x: -1, y: 0.2, z: 0 }),
      node('B', { x: 1, y: 0.3, z: 0 }),
    ],
    elements: [
      link('barA', 'P', 'A'),
      link('barB', 'P', 'B'),
      hinge('piv', 'P', ['barA', 'barB'], axis),
    ],
    pointMasses: [],
    skeletonBindings: [],
    anchorBindings: [],
    inputs: [],
    namedStates: [],
  };
}

describe('detectOffPlaneHinges', () => {
  it('flags a side-plane knee whose axis points out of plane (+y), suggesting +z', () => {
    const flagged = detectOffPlaneHinges(knee({ x: 0, y: 1, z: 0 }));
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.pivotElementId).toBe('piv');
    expect(flagged[0]!.suggestedAxis).toEqual({ x: 0, y: 0, z: 1 });
    expect(flagged[0]!.deviationRad).toBeGreaterThan(OFF_PLANE_TOL_RAD);
  });

  it('leaves a correctly-drawn +z side-plane knee alone', () => {
    expect(detectOffPlaneHinges(knee({ x: 0, y: 0, z: 1 }))).toHaveLength(0);
  });

  it('leaves a small-tilt axis within tolerance alone', () => {
    // axis a few degrees off +z — under the 10° tolerance, not worth churning
    const tilt = Math.sin((5 * Math.PI) / 180);
    expect(
      detectOffPlaneHinges(knee({ x: 0, y: tilt, z: Math.cos((5 * Math.PI) / 180) })),
    ).toHaveLength(0);
  });

  it('skips a straight (collinear) hinge with no definable swing plane', () => {
    const m = knee({ x: 0, y: 1, z: 0 });
    // make the bars exactly collinear along x → no plane normal
    m.nodes[1]!.position = { x: -1, y: 0, z: 0 };
    m.nodes[2]!.position = { x: 1, y: 0, z: 0 };
    expect(detectOffPlaneHinges(m)).toHaveLength(0);
  });
});
