// Bundled example: "tail" (planfile §9 item 6). Elevation view, gravity on.
// A three-section boom whose root nests into the body-frame pipe (the
// click/detachable realization from the original build); two compliant
// pivots model the garden-hose flex joints, each with a torsion spring for
// the hose stiffness plus the internal fiberglass rod's return-to-straight
// bias; a rope from the spine top holds the first section up; a tip mass
// makes it swing and sag believably.
import type { Mechanism, MechanismElement, Vec2 } from '../schema';
import { CORD, dist, PIPE_050, PIPE_075 } from './shared';

const P: Record<string, Vec2> = {
  rootA: { x: -0.18, y: 0.95 },
  spineTopA: { x: -0.22, y: 1.42 },
  j1: { x: -0.66, y: 1.0 },
  j2: { x: -1.1, y: 1.06 },
  tailTip: { x: -1.52, y: 1.13 },
};

function boom(
  id: string,
  nodeA: string,
  nodeB: string,
  materialId: string,
): Extract<MechanismElement, { type: 'link' }> {
  return {
    id,
    type: 'link',
    maturity: 'engineered',
    subsystemTag: 'tail',
    nodeA,
    nodeB,
    pipeMaterialId: materialId,
    endRealizationA: 'nestedSleeve',
    endRealizationB: 'nestedSleeve',
    pointMasses: [],
  };
}

export function buildTailMechanism(): Mechanism {
  const elements: MechanismElement[] = [
    { ...boom('tailBoom1', 'rootA', 'j1', PIPE_075), endRealizationA: 'clickDetachable' },
    boom('tailBoom2', 'j1', 'j2', PIPE_050),
    { ...boom('tailBoom3', 'j2', 'tailTip', PIPE_050), endRealizationB: 'boltThrough' },
    {
      id: 'tailFlex1',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'tail',
      nodeId: 'j1',
      memberIds: ['tailBoom1', 'tailBoom2'],
      welds: [],
      angleLimit: { memberA: 'tailBoom1', memberB: 'tailBoom2', minRad: -0.6, maxRad: 0.6 },
      torsionSpring: {
        memberA: 'tailBoom1',
        memberB: 'tailBoom2',
        stiffnessNmPerRad: 25,
        restAngleRad: 0,
      },
      realization: 'nestedSleeve',
    },
    {
      id: 'tailFlex2',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'tail',
      nodeId: 'j2',
      memberIds: ['tailBoom2', 'tailBoom3'],
      welds: [],
      angleLimit: { memberA: 'tailBoom2', memberB: 'tailBoom3', minRad: -0.7, maxRad: 0.7 },
      torsionSpring: {
        memberA: 'tailBoom2',
        memberB: 'tailBoom3',
        stiffnessNmPerRad: 18,
        restAngleRad: 0,
      },
      realization: 'nestedSleeve',
    },
    {
      id: 'tailHoldRope',
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'tail',
      path: ['spineTopA', 'j1'],
      lengthM: dist(P.spineTopA!, P.j1!),
      cordageMaterialId: CORD,
    },
  ];

  return {
    id: 'tail-boom',
    name: 'Tail',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes: [
      { id: 'rootA', kind: 'anchor', position: P.rootA! },
      { id: 'spineTopA', kind: 'anchor', position: P.spineTopA! },
      { id: 'j1', kind: 'free', position: P.j1! },
      { id: 'j2', kind: 'free', position: P.j2! },
      { id: 'tailTip', kind: 'free', position: P.tailTip! },
    ],
    elements,
    pointMasses: [{ id: 'tailTipMass', name: 'tail tip', massKg: 0.5, nodeId: 'tailTip' }],
    skeletonBindings: [],
    inputs: [],
    namedStates: [],
  };
}
