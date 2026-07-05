// Bundled example: "tail" (planfile §9 item 6). Elevation geometry, native in
// the world x-y plane at z = 0. A three-section boom whose root nests into
// the body-frame pipe (the click/detachable realization from the original
// build); two compliant pivots model the garden-hose flex joints — hinges
// about the sagittal normal, each with a torsion spring for the hose
// stiffness plus the internal fiberglass rod's return-to-straight bias; a
// rope from the spine top holds the first section up; a tip mass makes it
// swing and sag believably.
import type { MechanismElement, Vec3 } from '../schema';
import { CORD, dist, HINGE_SAGITTAL, type MechParts, PIPE_050, PIPE_075, v3 } from './shared';

const P: Record<string, Vec3> = {
  rootA: v3(-0.18, 0.95, 0),
  spineTopA: v3(-0.22, 1.42, 0),
  j1: v3(-0.66, 1.0, 0),
  j2: v3(-1.1, 1.06, 0),
  tailTip: v3(-1.52, 1.13, 0),
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

export function buildTailParts(prefix = ''): MechParts {
  const n = (id: string) => prefix + id;
  const elements: MechanismElement[] = [
    { ...boom(n('tailBoom1'), n('rootA'), n('j1'), PIPE_075), endRealizationA: 'clickDetachable' },
    boom(n('tailBoom2'), n('j1'), n('j2'), PIPE_050),
    { ...boom(n('tailBoom3'), n('j2'), n('tailTip'), PIPE_050), endRealizationB: 'boltThrough' },
    {
      id: n('tailFlex1'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'tail',
      nodeId: n('j1'),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n('tailBoom1'), n('tailBoom2')],
      welds: [],
      angleLimit: { memberA: n('tailBoom1'), memberB: n('tailBoom2'), minRad: -0.6, maxRad: 0.6 },
      torsionSpring: {
        memberA: n('tailBoom1'),
        memberB: n('tailBoom2'),
        stiffnessNmPerRad: 25,
        restAngleRad: 0,
      },
      realization: 'nestedSleeve',
    },
    {
      id: n('tailFlex2'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'tail',
      nodeId: n('j2'),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n('tailBoom2'), n('tailBoom3')],
      welds: [],
      angleLimit: { memberA: n('tailBoom2'), memberB: n('tailBoom3'), minRad: -0.7, maxRad: 0.7 },
      torsionSpring: {
        memberA: n('tailBoom2'),
        memberB: n('tailBoom3'),
        stiffnessNmPerRad: 18,
        restAngleRad: 0,
      },
      realization: 'nestedSleeve',
    },
    {
      id: n('tailHoldRope'),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'tail',
      path: [n('spineTopA'), n('j1')],
      lengthM: dist(P.spineTopA!, P.j1!),
      cordageMaterialId: CORD,
    },
  ];

  return {
    nodes: [
      { id: n('rootA'), kind: 'anchor', position: P.rootA! },
      { id: n('spineTopA'), kind: 'anchor', position: P.spineTopA! },
      { id: n('j1'), kind: 'free', position: P.j1! },
      { id: n('j2'), kind: 'free', position: P.j2! },
      { id: n('tailTip'), kind: 'free', position: P.tailTip! },
    ],
    elements,
    pointMasses: [{ id: n('tailTipMass'), name: 'tail tip', massKg: 0.5, nodeId: n('tailTip') }],
    skeletonBindings: [],
    inputs: [],
  };
}
