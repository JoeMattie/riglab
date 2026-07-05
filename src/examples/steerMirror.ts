// Bundled example: "steer mirror (plan)" (planfile §9 item 3). Formerly the
// plan-view / gravity-off mechanism; in v7 the same plan geometry genuinely
// lies in a horizontal plane at working height (STEER_PLANE_Y), which is now
// correct physics — gravity is global −y and has no moment about the
// vertical pan axes. The steer handle's pan joint is rope-mirrored to the
// head's pan joint. Each rotating arm carries a welded perpendicular
// cross-bar; the left/right ropes between the bars are CROSSED as in the
// original build — the steer chain points aft, the head chain points
// forward, so crossing is exactly what makes the head turn to the same side
// as the steer tip. Old sketch coordinates map through the frozen top-view
// frame: local (x, y) → world (x, STEER_PLANE_Y, y); hinge axes are the plan
// normal (−y), so angle signs and limits keep their 2D meaning.
import type { MechanismElement, Vec3 } from '../schema';
import { CORD, dist, HINGE_PLAN, type MechParts, mergeParts, PIPE_050, v3 } from './shared';

/** Working height of the horizontal steer deck — the old assembly placed the
 * plan-view mechanism at shoulder height. */
export const STEER_PLANE_Y = 1.43;

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

/** The steer-handle pan chain: an anchored carrier, a pan arm on a
 * vertical-axis hinge, and the welded left/right cross-bars the mirror ropes
 * attach to. `at` is the pan pivot position; the carrier points forward
 * (+x), the arm aft (−x), the bars to wearer-left/right (±z) — exactly the
 * old plan-view sketch lifted through the top frame. Reused by the
 * full-creature document with a different pivot position and prefix. */
export function buildSteerChainParts(prefix: string, at: Vec3): MechParts {
  const n = (id: string) => prefix + id;
  return {
    nodes: [
      { id: n('sBase'), kind: 'anchor', position: v3(at.x + 0.17, at.y, at.z) },
      { id: n('sMid'), kind: 'anchor', position: at },
      {
        id: n('sTip'),
        kind: 'driven',
        position: v3(at.x - 0.22, at.y, at.z),
        channelId: 'chSteerPan',
      },
      { id: n('sL'), kind: 'free', position: v3(at.x, at.y, at.z + 0.07) },
      { id: n('sR'), kind: 'free', position: v3(at.x, at.y, at.z - 0.07) },
    ],
    elements: [
      link(n('sCarrier'), n('sBase'), n('sMid'), 'steer'),
      link(n('sArm'), n('sMid'), n('sTip'), 'steer'),
      link(n('sBarL'), n('sMid'), n('sL'), 'steer'),
      link(n('sBarR'), n('sMid'), n('sR'), 'steer'),
      {
        id: n('sPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'steer',
        nodeId: n('sMid'),
        joint: { kind: 'hinge', axis: HINGE_PLAN },
        memberIds: [n('sCarrier'), n('sArm'), n('sBarL'), n('sBarR')],
        welds: [
          [n('sArm'), n('sBarL')],
          [n('sArm'), n('sBarR')],
        ],
        angleLimit: { memberA: n('sCarrier'), memberB: n('sArm'), minRad: -0.6, maxRad: 0.6 },
        realization: 'boltThrough',
      },
    ],
    pointMasses: [],
    skeletonBindings: [],
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
  };
}

export function buildSteerMirrorParts(prefix = ''): MechParts {
  const n = (id: string) => prefix + id;
  const y = STEER_PLANE_Y;
  const hMid = v3(1.12, y, 0);
  const hL = v3(1.12, y, 0.07);
  const hR = v3(1.12, y, -0.07);
  const sL = v3(0.38, y, 0.07);
  const sR = v3(0.38, y, -0.07);

  const headChain: MechParts = {
    nodes: [
      { id: n('hBase'), kind: 'anchor', position: v3(0.95, y, 0) },
      { id: n('hMid'), kind: 'anchor', position: hMid },
      { id: n('hTip'), kind: 'free', position: v3(1.34, y, 0) },
      { id: n('hL'), kind: 'free', position: hL },
      { id: n('hR'), kind: 'free', position: hR },
    ],
    elements: [
      link(n('hCarrier'), n('hBase'), n('hMid'), 'head'),
      link(n('hArm'), n('hMid'), n('hTip'), 'head'),
      link(n('hBarL'), n('hMid'), n('hL'), 'head'),
      link(n('hBarR'), n('hMid'), n('hR'), 'head'),
      {
        id: n('hPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'head',
        nodeId: n('hMid'),
        joint: { kind: 'hinge', axis: HINGE_PLAN },
        memberIds: [n('hCarrier'), n('hArm'), n('hBarL'), n('hBarR')],
        welds: [
          [n('hArm'), n('hBarL')],
          [n('hArm'), n('hBarR')],
        ],
        angleLimit: { memberA: n('hCarrier'), memberB: n('hArm'), minRad: -0.6, maxRad: 0.6 },
        realization: 'boltThrough',
      },
      // the crossed pair: steer-left rope attaches head-right and vice versa
      {
        id: n('ropeCrossLtoR'),
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'steer',
        path: [n('sL'), n('hR')],
        lengthM: dist(sL, hR),
        cordageMaterialId: CORD,
      },
      {
        id: n('ropeCrossRtoL'),
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'steer',
        path: [n('sR'), n('hL')],
        lengthM: dist(sR, hL),
        cordageMaterialId: CORD,
      },
    ],
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
  };

  return mergeParts(buildSteerChainParts(prefix, v3(0.38, y, 0)), headChain);
}
