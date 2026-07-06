// Bundled example: "neck truss (pitch)" (planfile §9 item 2). Formerly a
// side-left planar mechanism; in v7 the same elevation geometry lives
// natively in the world x-y plane at z = 0. The conduit-box neck base is
// modeled per spec as slider + limited pivot: the pipe bundle inside the box
// is a short link whose BOTH endpoints ride point-on-line sliders on the
// box-axis guide (a sliding prismatic joint), and the neck boom meets the
// bundle at a rope-lashed pivot — a hinge about the sagittal normal with a
// small angle limit (the lashing compliance). An elastic counterbalances the
// head mass so the rest pose is neck-up; the "steer pitch" input channel
// pulls a rope routed through a chin-level eyelet BELOW the boom axis (the
// offset is what gives the rope a lever arm) to pitch the head down.
//
// 3D roll keeper: a hinge carried by a 2-node bar keeps a "bracket spin" DOF
// about the bar's own line (the particle model cannot represent a bar's
// torsion), so the boom — an inverted pendulum over the rail — would fall
// sideways. The real conduit box cannot roll on the mast, so the model says
// so: the box carries a short keel post riding a second, parallel rail (the
// box straddles twin rails). The keel is a member of the lashing pivot, which
// ties the hinge axis to an off-rail point and kills the roll while leaving
// the slide (both sliders translate together) and the pitch free.
import type { MechanismElement, Vec3 } from '../schema';
import {
  BUNGEE_8,
  CORD,
  dist,
  HINGE_SAGITTAL,
  type MechParts,
  PIPE_075,
  PIPE_CLS200_075,
  PIPE_CTS_075,
  v3,
} from './shared';

const P: Record<string, Vec3> = {
  guideA: v3(0.05, 1.32, 0),
  guideB: v3(0.23, 1.41, 0),
  // second rail: the guide translated straight up by the keel height, so the
  // keel node rides it at the same parameter as neckBase rides the guide
  guideA2: v3(0.05, 1.44, 0),
  guideB2: v3(0.23, 1.53, 0),
  boxBack: v3(0.104, 1.347, 0),
  neckBase: v3(0.185, 1.3875, 0),
  keel: v3(0.185, 1.5075, 0),
  head: v3(0.95, 1.72, 0),
  mastTop: v3(0.05, 1.55, 0),
  chinGuide: v3(0.28, 1.25, 0),
  handleBase: v3(0.25, 0.85, 0),
  pull: v3(0.25, 1.0, 0),
};

export function buildNeckTrussParts(prefix = ''): MechParts {
  const n = (id: string) => prefix + id;
  const elements: MechanismElement[] = [
    {
      id: n('aGuide'),
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'frame',
      nodeA: n('guideA'),
      nodeB: n('guideB'),
      pipeMaterialId: PIPE_075,
      endRealizationA: 'fitting',
      endRealizationB: 'fitting',
      pointMasses: [],
    },
    {
      id: n('bGuide'),
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'frame',
      nodeA: n('guideA2'),
      nodeB: n('guideB2'),
      pipeMaterialId: PIPE_075,
      endRealizationA: 'fitting',
      endRealizationB: 'fitting',
      pointMasses: [],
    },
    {
      id: n('bundleCore'),
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeA: n('boxBack'),
      nodeB: n('neckBase'),
      pipeMaterialId: PIPE_075,
      endRealizationA: 'ropeLashing',
      endRealizationB: 'ropeLashing',
      pointMasses: [],
    },
    {
      id: n('neckBoom'),
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeA: n('neckBase'),
      nodeB: n('head'),
      pipeMaterialId: PIPE_075,
      endRealizationA: 'ropeLashing',
      endRealizationB: 'boltThrough',
      pointMasses: [],
    },
    // the steer grip slides on the handle pipe: a sliding telescope, so the
    // driven node can travel along the rail instead of fighting a rigid link
    {
      id: n('zHandle'),
      type: 'telescope',
      maturity: 'engineered',
      subsystemTag: 'frame',
      nodeA: n('handleBase'),
      nodeB: n('pull'),
      minLengthM: 0.05,
      maxLengthM: 0.3,
      lengthM: 0.15,
      sliding: true,
      outerPipeMaterialId: PIPE_CLS200_075,
      innerPipeMaterialId: PIPE_CTS_075,
      pointMasses: [],
    },
    // the keel post: rigidly part of the conduit box, riding the second rail
    {
      id: n('keelPost'),
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeA: n('neckBase'),
      nodeB: n('keel'),
      pipeMaterialId: PIPE_075,
      endRealizationA: 'ropeLashing',
      endRealizationB: 'conduitBox',
      pointMasses: [],
    },
    // conduit box = two point-on-line sliders on the guide axis
    {
      id: n('boxSliderBack'),
      type: 'slider',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: n('boxBack'),
      alongElementId: n('aGuide'),
      travelMin: 0.26,
      travelMax: 0.36,
      realization: 'conduitBox',
    },
    {
      id: n('boxSliderFront'),
      type: 'slider',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: n('neckBase'),
      alongElementId: n('aGuide'),
      travelMin: 0.71,
      travelMax: 0.81,
      realization: 'conduitBox',
    },
    // the keel's slider on the second rail — the box's wide, roll-proof
    // footprint on the mast
    {
      id: n('boxSliderKeel'),
      type: 'slider',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: n('keel'),
      alongElementId: n('bGuide'),
      travelMin: 0.71,
      travelMax: 0.81,
      realization: 'conduitBox',
    },
    // lashing compliance: boom deviates from the bundle axis within ±20°,
    // hinged about the sketch plane's normal (side-left elevation → +z).
    // keelPost is a member so the hinge axis is tied to the off-rail keel —
    // that tie is what kills the bracket-spin roll (see header comment).
    {
      id: n('boxPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: n('neckBase'),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n('bundleCore'), n('neckBoom'), n('keelPost')],
      welds: [],
      angleLimit: {
        memberA: n('bundleCore'),
        memberB: n('neckBoom'),
        minRad: -0.35,
        maxRad: 0.35,
      },
      realization: 'ropeLashing',
    },
    {
      id: n('counterElastic'),
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeA: n('mastTop'),
      nodeB: n('head'),
      slackLengthM: 0.65,
      stiffnessNPerM: 185,
      cordageMaterialId: BUNGEE_8,
    },
    // the up/down rope pair from the original build: sliding the grip down
    // tightens the chin rope (head pitches down) while paying out the over-
    // the-mast rope, and vice versa — together they pin the head attitude to
    // the grip position bidirectionally
    {
      id: n('pitchRopeDown'),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'neck',
      path: [n('pull'), n('chinGuide'), n('head')],
      lengthM: dist(P.pull!, P.chinGuide!) + dist(P.chinGuide!, P.head!) + 0.002,
      cordageMaterialId: CORD,
    },
    {
      id: n('pitchRopeUp'),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'neck',
      path: [n('pull'), n('handleBase'), n('mastTop'), n('head')],
      lengthM:
        dist(P.pull!, P.handleBase!) +
        dist(P.handleBase!, P.mastTop!) +
        dist(P.mastTop!, P.head!) +
        0.002,
      cordageMaterialId: CORD,
    },
  ];

  return {
    nodes: [
      { id: n('guideA'), kind: 'anchor', position: P.guideA! },
      { id: n('guideB'), kind: 'anchor', position: P.guideB! },
      { id: n('guideA2'), kind: 'anchor', position: P.guideA2! },
      { id: n('guideB2'), kind: 'anchor', position: P.guideB2! },
      { id: n('mastTop'), kind: 'anchor', position: P.mastTop! },
      { id: n('chinGuide'), kind: 'anchor', position: P.chinGuide! },
      { id: n('handleBase'), kind: 'anchor', position: P.handleBase! },
      { id: n('boxBack'), kind: 'free', position: P.boxBack! },
      { id: n('neckBase'), kind: 'free', position: P.neckBase! },
      { id: n('keel'), kind: 'free', position: P.keel! },
      { id: n('head'), kind: 'free', position: P.head! },
      { id: n('pull'), kind: 'driven', position: P.pull!, channelId: 'chSteerPitch' },
    ],
    elements,
    pointMasses: [{ id: n('headMass'), name: 'head', massKg: 1.2, nodeId: n('head') }],
    skeletonBindings: [],
    inputs: [
      {
        id: 'chSteerPitch',
        name: 'steer pitch',
        // range stops short of driving the boom into its lashing angle limit
        kind: 'displacement',
        min: -0.03,
        max: 0.015,
        value: 0,
        locked: false,
      },
    ],
  };
}
