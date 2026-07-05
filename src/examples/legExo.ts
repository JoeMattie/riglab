// Bundled example: "leg exoskeleton" (planfile §9 item 5). Elevation view.
// The external leg (femur / tibiotarsus / foot) hangs from a body-frame
// anchor and is strapped to the wearer: nodes bound to the hip / knee / shoe
// skeleton points are driven by the gait during clip playback (§7.3), so the
// linkage is powered by the wearer walking, not free-swinging. A heel-lift
// elastic runs to the body frame; the toe segment is limited by a rope to an
// under-foot pad (rope-as-limit) and returned by an elastic on the same pad.
import type { Mechanism, MechanismElement, SkeletonBinding, Vec2 } from '../schema';
import { BUNGEE_6, BUNGEE_8, CORD, dist, PIPE_050, PIPE_075 } from './shared';

const P: Record<string, Vec2> = {
  frameHip: { x: -0.06, y: 0.98 },
  frameSide: { x: -0.1, y: 0.75 },
  wHip: { x: 0, y: 0.9275 },
  wKnee: { x: 0, y: 0.49875 },
  wShoe: { x: 0.1, y: 0 },
  eKnee: { x: 0.08, y: 0.52 },
  eAnkle: { x: 0.05, y: 0.1 },
  eHeel: { x: -0.05, y: 0.13 },
  eToeJ: { x: 0.18, y: 0.045 },
  eToePad: { x: 0.18, y: -0.02 },
  eToe: { x: 0.3, y: 0.03 },
};

/** Toe-up travel limit: the rope from toe tip to the under-foot pad lets the
 * toe rotate up until tip–pad distance reaches this length. */
const TOE_ROPE_LENGTH = 0.15;

function pipe(
  id: string,
  nodeA: string,
  nodeB: string,
  materialId: string,
): Extract<MechanismElement, { type: 'link' }> {
  return {
    id,
    type: 'link',
    maturity: 'engineered',
    subsystemTag: 'leg',
    nodeA,
    nodeB,
    pipeMaterialId: materialId,
    endRealizationA: 'boltThrough',
    endRealizationB: 'boltThrough',
    pointMasses: [],
  };
}

export function buildLegExoMechanism(side: 'left' | 'right'): Mechanism {
  const s = side === 'left' ? 'L' : 'R';
  const bindings: SkeletonBinding[] = [
    { id: 'bindHip', point: `hip${s}` as SkeletonBinding['point'], nodeId: 'wHip' },
    { id: 'bindKnee', point: `knee${s}` as SkeletonBinding['point'], nodeId: 'wKnee' },
    { id: 'bindShoe', point: `shoe${s}` as SkeletonBinding['point'], nodeId: 'wShoe' },
  ];

  const elements: MechanismElement[] = [
    pipe('exoFemur', 'frameHip', 'eKnee', PIPE_075),
    pipe('exoTibia', 'eKnee', 'eAnkle', PIPE_075),
    pipe('exoFootMain', 'eAnkle', 'eToeJ', PIPE_050),
    pipe('exoHeelSpur', 'eAnkle', 'eHeel', PIPE_050),
    pipe('exoToePadBar', 'eToeJ', 'eToePad', PIPE_050),
    pipe('exoToe', 'eToeJ', 'eToe', PIPE_050),
    { ...pipe('tieKnee', 'wKnee', 'eKnee', PIPE_050), endRealizationA: 'ropeLashing' },
    { ...pipe('tieShoe', 'wShoe', 'eAnkle', PIPE_050), endRealizationA: 'ropeLashing' },
    {
      id: 'kneePivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeId: 'eKnee',
      memberIds: ['exoFemur', 'exoTibia', 'tieKnee'],
      welds: [],
      angleLimit: { memberA: 'exoFemur', memberB: 'exoTibia', minRad: -1.5, maxRad: 0.05 },
      realization: 'boltThrough',
    },
    {
      id: 'anklePivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeId: 'eAnkle',
      memberIds: ['exoTibia', 'exoFootMain', 'exoHeelSpur', 'tieShoe'],
      welds: [['exoFootMain', 'exoHeelSpur']],
      angleLimit: { memberA: 'exoTibia', memberB: 'exoFootMain', minRad: 0.6, maxRad: 1.9 },
      realization: 'boltThrough',
    },
    // hard mechanical stop at ±; the travel-limit ROPE below engages first
    // (~0.29 rad) whenever forces are simulated — rope-as-limit per §9
    {
      id: 'toePivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeId: 'eToeJ',
      memberIds: ['exoFootMain', 'exoToe', 'exoToePadBar'],
      welds: [['exoFootMain', 'exoToePadBar']],
      angleLimit: { memberA: 'exoFootMain', memberB: 'exoToe', minRad: -0.6, maxRad: 0.35 },
      realization: 'boltThrough',
    },
    {
      id: 'heelLiftElastic',
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeA: 'frameSide',
      nodeB: 'eHeel',
      restLengthM: 0.45,
      stiffnessNPerM: 150,
      tensionOnly: true,
      cordageMaterialId: BUNGEE_8,
    },
    {
      id: 'toeLimitRope',
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'leg',
      path: ['eToe', 'eToePad'],
      lengthM: TOE_ROPE_LENGTH,
      cordageMaterialId: CORD,
    },
    {
      id: 'toeReturnElastic',
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeA: 'eToe',
      nodeB: 'eToePad',
      restLengthM: dist(P.eToe!, P.eToePad!),
      stiffnessNPerM: 60,
      tensionOnly: true,
      cordageMaterialId: BUNGEE_6,
    },
  ];

  return {
    id: `leg-exo-${side}`,
    name: `Leg exoskeleton (${side})`,
    viewOrientation: side === 'left' ? 'side-left' : 'side-right',
    gravityOn: true,
    nodes: [
      { id: 'frameHip', kind: 'anchor', position: P.frameHip! },
      { id: 'frameSide', kind: 'anchor', position: P.frameSide! },
      { id: 'wHip', kind: 'free', position: P.wHip! },
      { id: 'wKnee', kind: 'free', position: P.wKnee! },
      { id: 'wShoe', kind: 'free', position: P.wShoe! },
      { id: 'eKnee', kind: 'free', position: P.eKnee! },
      { id: 'eAnkle', kind: 'free', position: P.eAnkle! },
      { id: 'eHeel', kind: 'free', position: P.eHeel! },
      { id: 'eToeJ', kind: 'free', position: P.eToeJ! },
      { id: 'eToePad', kind: 'free', position: P.eToePad! },
      { id: 'eToe', kind: 'free', position: P.eToe! },
    ],
    elements,
    pointMasses: [{ id: 'pawMass', name: 'paw claw', massKg: 0.1, nodeId: 'eToe' }],
    skeletonBindings: bindings,
    inputs: [],
    namedStates: [],
  };
}
