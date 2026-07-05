// Bundled example: "steer mirror (plan)" (planfile §9 item 3). Plan view,
// gravity off. The steer handle's pan joint (a 2-joint chain whose first,
// out-of-plane pitch joint is the static carrier in this view) is rope-
// mirrored to the head's pan joint. Each rotating arm carries a welded
// perpendicular cross-bar; the left/right ropes between the bars are CROSSED
// as in the original build — the steer chain points aft, the head chain
// points forward, so crossing is exactly what makes the head turn to the
// same side as the steer tip.
import type { Mechanism, MechanismElement, Vec2 } from '../schema';
import { CORD, dist, PIPE_050 } from './shared';

const P: Record<string, Vec2> = {
  sBase: { x: 0.55, y: 0 },
  sMid: { x: 0.38, y: 0 },
  sTip: { x: 0.16, y: 0 },
  sL: { x: 0.38, y: 0.07 },
  sR: { x: 0.38, y: -0.07 },
  hBase: { x: 0.95, y: 0 },
  hMid: { x: 1.12, y: 0 },
  hTip: { x: 1.34, y: 0 },
  hL: { x: 1.12, y: 0.07 },
  hR: { x: 1.12, y: -0.07 },
};

function link(
  id: string,
  nodeA: string,
  nodeB: string,
  tag: string,
): Extract<MechanismElement, { type: 'link' }> {
  return {
    id,
    type: 'link',
    maturity: 'engineered',
    subsystemTag: tag,
    nodeA,
    nodeB,
    pipeMaterialId: PIPE_050,
    endRealizationA: 'boltThrough',
    endRealizationB: 'boltThrough',
    pointMasses: [],
  };
}

export function buildSteerMirrorMechanism(): Mechanism {
  const elements: MechanismElement[] = [
    link('sCarrier', 'sBase', 'sMid', 'steer'),
    link('sArm', 'sMid', 'sTip', 'steer'),
    link('sBarL', 'sMid', 'sL', 'steer'),
    link('sBarR', 'sMid', 'sR', 'steer'),
    link('hCarrier', 'hBase', 'hMid', 'head'),
    link('hArm', 'hMid', 'hTip', 'head'),
    link('hBarL', 'hMid', 'hL', 'head'),
    link('hBarR', 'hMid', 'hR', 'head'),
    {
      id: 'sPivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'steer',
      nodeId: 'sMid',
      memberIds: ['sCarrier', 'sArm', 'sBarL', 'sBarR'],
      welds: [
        ['sArm', 'sBarL'],
        ['sArm', 'sBarR'],
      ],
      angleLimit: { memberA: 'sCarrier', memberB: 'sArm', minRad: -0.6, maxRad: 0.6 },
      realization: 'boltThrough',
    },
    {
      id: 'hPivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'head',
      nodeId: 'hMid',
      memberIds: ['hCarrier', 'hArm', 'hBarL', 'hBarR'],
      welds: [
        ['hArm', 'hBarL'],
        ['hArm', 'hBarR'],
      ],
      angleLimit: { memberA: 'hCarrier', memberB: 'hArm', minRad: -0.6, maxRad: 0.6 },
      realization: 'boltThrough',
    },
    // the crossed pair: steer-left rope attaches head-right and vice versa
    {
      id: 'ropeCrossLtoR',
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'steer',
      path: ['sL', 'hR'],
      lengthM: dist(P.sL!, P.hR!),
      cordageMaterialId: CORD,
    },
    {
      id: 'ropeCrossRtoL',
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'steer',
      path: ['sR', 'hL'],
      lengthM: dist(P.sR!, P.hL!),
      cordageMaterialId: CORD,
    },
  ];

  return {
    id: 'steer-mirror',
    name: 'Steer mirror (plan)',
    viewOrientation: 'top',
    gravityOn: false,
    nodes: [
      { id: 'sBase', kind: 'anchor', position: P.sBase! },
      { id: 'sMid', kind: 'anchor', position: P.sMid! },
      { id: 'hBase', kind: 'anchor', position: P.hBase! },
      { id: 'hMid', kind: 'anchor', position: P.hMid! },
      { id: 'sTip', kind: 'driven', position: P.sTip!, channelId: 'chSteerPan' },
      { id: 'sL', kind: 'free', position: P.sL! },
      { id: 'sR', kind: 'free', position: P.sR! },
      { id: 'hTip', kind: 'free', position: P.hTip! },
      { id: 'hL', kind: 'free', position: P.hL! },
      { id: 'hR', kind: 'free', position: P.hR! },
    ],
    elements,
    pointMasses: [],
    skeletonBindings: [],
    anchorBindings: [],
    inputs: [
      // the steer IS the input device: panning the handle drives the tip
      // around its pivot; the crossed ropes mirror the head to the same side
      {
        id: 'chSteerPan',
        name: 'steer pan',
        kind: 'angle',
        min: -0.5,
        max: 0.5,
        value: 0,
        locked: false,
      },
    ],
    namedStates: [],
  };
}
