// Bundled example: "leg exoskeleton" (planfile §9 item 5). The external leg
// (femur / tibiotarsus / foot) hangs from a body-frame anchor and is
// strapped to the wearer: nodes bound to the hip / knee / shoe skeleton
// points are driven by the gait during clip playback (§7.3), so the linkage
// is powered by the wearer walking, not free-swinging. A heel-lift elastic
// runs to the body frame; the toe segment is limited by a rope to an
// under-foot pad (rope-as-limit) and returned by an elastic on the same pad.
//
// v7: the sagittal geometry lives in a plane parallel to x-y at the leg's
// hip offset (z = ±hipWidth/2, matching the skeleton's hipL/hipR), so the
// bound nodes coincide with their true 3D skeleton points at rest. Both
// sides keep hinge axis +z with identical limits: the geometry lies in a
// z-normal plane, and conjugating a rotation about +z by the z-mirror leaves
// it unchanged — the mirror duplicate needs no axis flip or limit swap.
import type { MechanismElement, SkeletonBinding, Vec3 } from '../schema';
import { DEFAULT_WEARER } from '../schema';
import {
  BUNGEE_6,
  BUNGEE_8,
  CORD,
  dist,
  HINGE_SAGITTAL,
  type MechParts,
  PIPE_050,
  PIPE_075,
  v3,
} from './shared';

const P: Record<string, { x: number; y: number }> = {
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

export function buildLegExoParts(side: 'left' | 'right', prefix = ''): MechParts {
  const n = (id: string) => prefix + id;
  const s = side === 'left' ? 'L' : 'R';
  // wearer-left is +z; the right leg is the mirror duplicate across z = 0
  const legZ = ((side === 'left' ? 1 : -1) * DEFAULT_WEARER.hipWidthM) / 2;
  const at = (id: string): Vec3 => v3(P[id]!.x, P[id]!.y, legZ);

  const bindings: SkeletonBinding[] = [
    { id: n('bindHip'), point: `hip${s}` as SkeletonBinding['point'], nodeId: n('wHip') },
    { id: n('bindKnee'), point: `knee${s}` as SkeletonBinding['point'], nodeId: n('wKnee') },
    { id: n('bindShoe'), point: `shoe${s}` as SkeletonBinding['point'], nodeId: n('wShoe') },
  ];

  const elements: MechanismElement[] = [
    pipe(n('exoFemur'), n('frameHip'), n('eKnee'), PIPE_075),
    pipe(n('exoTibia'), n('eKnee'), n('eAnkle'), PIPE_075),
    pipe(n('exoFootMain'), n('eAnkle'), n('eToeJ'), PIPE_050),
    pipe(n('exoHeelSpur'), n('eAnkle'), n('eHeel'), PIPE_050),
    pipe(n('exoToePadBar'), n('eToeJ'), n('eToePad'), PIPE_050),
    pipe(n('exoToe'), n('eToeJ'), n('eToe'), PIPE_050),
    { ...pipe(n('tieKnee'), n('wKnee'), n('eKnee'), PIPE_050), endRealizationA: 'ropeLashing' },
    { ...pipe(n('tieShoe'), n('wShoe'), n('eAnkle'), PIPE_050), endRealizationA: 'ropeLashing' },
    {
      id: n('kneePivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeId: n('eKnee'),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n('exoFemur'), n('exoTibia'), n('tieKnee')],
      welds: [],
      angleLimit: { memberA: n('exoFemur'), memberB: n('exoTibia'), minRad: -1.5, maxRad: 0.05 },
      realization: 'boltThrough',
    },
    {
      id: n('anklePivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeId: n('eAnkle'),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n('exoTibia'), n('exoFootMain'), n('exoHeelSpur'), n('tieShoe')],
      welds: [[n('exoFootMain'), n('exoHeelSpur')]],
      angleLimit: { memberA: n('exoTibia'), memberB: n('exoFootMain'), minRad: 0.6, maxRad: 1.9 },
      realization: 'boltThrough',
    },
    // hard mechanical stop at ±; the travel-limit ROPE below engages first
    // (~0.29 rad) whenever forces are simulated — rope-as-limit per §9
    {
      id: n('toePivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeId: n('eToeJ'),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n('exoFootMain'), n('exoToe'), n('exoToePadBar')],
      welds: [[n('exoFootMain'), n('exoToePadBar')]],
      angleLimit: { memberA: n('exoFootMain'), memberB: n('exoToe'), minRad: -0.6, maxRad: 0.35 },
      realization: 'boltThrough',
    },
    {
      id: n('heelLiftElastic'),
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeA: n('frameSide'),
      nodeB: n('eHeel'),
      restLengthM: 0.45,
      stiffnessNPerM: 150,
      tensionOnly: true,
      cordageMaterialId: BUNGEE_8,
    },
    {
      id: n('toeLimitRope'),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'leg',
      path: [n('eToe'), n('eToePad')],
      lengthM: TOE_ROPE_LENGTH,
      cordageMaterialId: CORD,
    },
    {
      id: n('toeReturnElastic'),
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeA: n('eToe'),
      nodeB: n('eToePad'),
      restLengthM: dist(at('eToe'), at('eToePad')),
      stiffnessNPerM: 60,
      tensionOnly: true,
      cordageMaterialId: BUNGEE_6,
    },
  ];

  return {
    nodes: [
      { id: n('frameHip'), kind: 'anchor', position: at('frameHip') },
      { id: n('frameSide'), kind: 'anchor', position: at('frameSide') },
      { id: n('wHip'), kind: 'free', position: at('wHip') },
      { id: n('wKnee'), kind: 'free', position: at('wKnee') },
      { id: n('wShoe'), kind: 'free', position: at('wShoe') },
      { id: n('eKnee'), kind: 'free', position: at('eKnee') },
      { id: n('eAnkle'), kind: 'free', position: at('eAnkle') },
      { id: n('eHeel'), kind: 'free', position: at('eHeel') },
      { id: n('eToeJ'), kind: 'free', position: at('eToeJ') },
      { id: n('eToePad'), kind: 'free', position: at('eToePad') },
      { id: n('eToe'), kind: 'free', position: at('eToe') },
    ],
    elements,
    pointMasses: [{ id: n('pawMass'), name: 'paw claw', massKg: 0.1, nodeId: n('eToe') }],
    skeletonBindings: bindings,
    inputs: [],
  };
}
