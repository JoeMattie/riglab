// Bundled example: "neck truss (pitch)" (planfile §9 item 2). Elevation view.
// The conduit-box neck base is modeled per spec as slider + limited pivot:
// the pipe bundle inside the box is a short link whose BOTH endpoints ride
// point-on-line sliders on the box-axis guide (a sliding prismatic joint),
// and the neck boom meets the bundle at a rope-lashed pivot with a small
// angle limit (the lashing compliance). An elastic counterbalances the head
// mass so the rest pose is neck-up; the "steer pitch" input channel pulls a
// rope routed through a chin-level eyelet BELOW the boom axis (the offset is
// what gives the rope a lever arm) to pitch the head down.
import type { Mechanism, MechanismElement, Vec2 } from '../schema';
import { BUNGEE_8, CORD, dist, PIPE_075, PIPE_CLS200_075, PIPE_CTS_075 } from './shared';

const P: Record<string, Vec2> = {
  guideA: { x: 0.05, y: 1.32 },
  guideB: { x: 0.23, y: 1.41 },
  boxBack: { x: 0.104, y: 1.347 },
  neckBase: { x: 0.185, y: 1.3875 },
  head: { x: 0.95, y: 1.72 },
  mastTop: { x: 0.05, y: 1.55 },
  chinGuide: { x: 0.28, y: 1.25 },
  handleBase: { x: 0.25, y: 0.85 },
  pull: { x: 0.25, y: 1.0 },
};

export function buildNeckTrussMechanism(): Mechanism {
  const elements: MechanismElement[] = [
    {
      id: 'aGuide',
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'frame',
      nodeA: 'guideA',
      nodeB: 'guideB',
      pipeMaterialId: PIPE_075,
      endRealizationA: 'fitting',
      endRealizationB: 'fitting',
      pointMasses: [],
    },
    {
      id: 'bundleCore',
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeA: 'boxBack',
      nodeB: 'neckBase',
      pipeMaterialId: PIPE_075,
      endRealizationA: 'ropeLashing',
      endRealizationB: 'ropeLashing',
      pointMasses: [],
    },
    {
      id: 'neckBoom',
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeA: 'neckBase',
      nodeB: 'head',
      pipeMaterialId: PIPE_075,
      endRealizationA: 'ropeLashing',
      endRealizationB: 'boltThrough',
      pointMasses: [],
    },
    // the steer grip slides on the handle pipe: a sliding telescope, so the
    // driven node can travel along the rail instead of fighting a rigid link
    {
      id: 'zHandle',
      type: 'telescope',
      maturity: 'engineered',
      subsystemTag: 'frame',
      nodeA: 'handleBase',
      nodeB: 'pull',
      minLengthM: 0.05,
      maxLengthM: 0.3,
      lengthM: 0.15,
      sliding: true,
      outerPipeMaterialId: PIPE_CLS200_075,
      innerPipeMaterialId: PIPE_CTS_075,
      pointMasses: [],
    },
    // conduit box = two point-on-line sliders on the guide axis
    {
      id: 'boxSliderBack',
      type: 'slider',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: 'boxBack',
      alongElementId: 'aGuide',
      travelMin: 0.26,
      travelMax: 0.36,
      realization: 'conduitBox',
    },
    {
      id: 'boxSliderFront',
      type: 'slider',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: 'neckBase',
      alongElementId: 'aGuide',
      travelMin: 0.71,
      travelMax: 0.81,
      realization: 'conduitBox',
    },
    // lashing compliance: boom deviates from the bundle axis within ±20°
    {
      id: 'boxPivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: 'neckBase',
      memberIds: ['bundleCore', 'neckBoom'],
      welds: [],
      angleLimit: { memberA: 'bundleCore', memberB: 'neckBoom', minRad: -0.35, maxRad: 0.35 },
      realization: 'ropeLashing',
    },
    {
      id: 'counterElastic',
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeA: 'mastTop',
      nodeB: 'head',
      restLengthM: 0.65,
      stiffnessNPerM: 185,
      tensionOnly: true,
      cordageMaterialId: BUNGEE_8,
    },
    // the up/down rope pair from the original build: sliding the grip down
    // tightens the chin rope (head pitches down) while paying out the over-
    // the-mast rope, and vice versa — together they pin the head attitude to
    // the grip position bidirectionally
    {
      id: 'pitchRopeDown',
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'neck',
      path: ['pull', 'chinGuide', 'head'],
      lengthM: dist(P.pull!, P.chinGuide!) + dist(P.chinGuide!, P.head!) + 0.002,
      cordageMaterialId: CORD,
    },
    {
      id: 'pitchRopeUp',
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'neck',
      path: ['pull', 'handleBase', 'mastTop', 'head'],
      lengthM:
        dist(P.pull!, P.handleBase!) +
        dist(P.handleBase!, P.mastTop!) +
        dist(P.mastTop!, P.head!) +
        0.002,
      cordageMaterialId: CORD,
    },
  ];

  return {
    id: 'neck-truss',
    name: 'Neck truss (pitch)',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes: [
      { id: 'guideA', kind: 'anchor', position: P.guideA! },
      { id: 'guideB', kind: 'anchor', position: P.guideB! },
      { id: 'mastTop', kind: 'anchor', position: P.mastTop! },
      { id: 'chinGuide', kind: 'anchor', position: P.chinGuide! },
      { id: 'handleBase', kind: 'anchor', position: P.handleBase! },
      { id: 'boxBack', kind: 'free', position: P.boxBack! },
      { id: 'neckBase', kind: 'free', position: P.neckBase! },
      { id: 'head', kind: 'free', position: P.head! },
      { id: 'pull', kind: 'driven', position: P.pull!, channelId: 'chSteerPitch' },
    ],
    elements,
    pointMasses: [{ id: 'headMass', name: 'head', massKg: 1.2, nodeId: 'head' }],
    skeletonBindings: [],
    anchorBindings: [],
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
    namedStates: [],
  };
}
