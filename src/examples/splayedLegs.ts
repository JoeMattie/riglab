// Bundled example: "splayed legs (3D gait)" (PLANFILE-3d-raptor-samples.md
// example 9). The leg-exoskeleton linkage topology (legExo.ts is the
// reference; its node table is copied here and transformed — legExo.ts
// itself is untouched), with each leg's sagittal geometry rotated about the
// VERTICAL axis through its hip point by a toe-out splay and pushed outward
// to z ≈ ±0.30, outside the body-frame rail line. The knee/ankle/toe hinge
// axes rotate with the geometry, so they are unit vectors that are NOT any
// panel normal (|x| ≈ sin 0.22 > 0.2) — the planfile's own motivating case.
//
// Stacked on top: a sprung hip-yaw joint. The yoke node (the rotated hip
// point) is ANCHORED, so the yaw pivot is a frame-fixed vertical bearing
// (the solver pins a hinge axis whose pivot node is held — the ground-hinge
// rule in solver/hinge.ts) and the bracket-spin roll DOF of a hinge-on-bar
// never opens; no anti-roll keel needed. The yaw hinge turns a short yoke
// ARM (a sleeve on the femur root, along the drawn femur direction); the
// swing linkage hangs spherically off the arm's end exactly as the leg-exo
// femur hangs off its hip anchor — a hinge holding the femur itself would
// pin the leg yaw-only and fight the sagittal gait harness (measured: up to
// 11 mm of femur stretch against the yaw limit; see DECISIONS.md). A
// torsion spring between the frame post and the arm centres the yaw at the
// drawn splay with ±0.35 rad of travel, so gait pulls make the paw wander
// in/out — a real spatial articulation no v6 document could express.
//
// The wearer-side nodes keep the leg-exo skeleton bindings (hipL/kneeL/
// shoeL and mirrored): sagittal gait targets pulling on a splayed linkage
// IS the demo. The right leg is the true mirror of the left across z = 0
// (positions z-negated; hinge axes mirrored as axial vectors: (x,y,z) →
// (−x,−y,z), which preserves the signed angle convention and limits).
import type { MechanismElement, Project, SkeletonBinding, Vec3 } from '../schema';
import {
  BUNGEE_6,
  BUNGEE_8,
  CORD,
  dist,
  exampleProject,
  groupOf,
  type MechParts,
  mergeParts,
  PIPE_050,
  PIPE_075,
  partsMechanism,
  v3,
} from './shared';

/** Toe-out splay per side (≈ 12.5°, outward). */
const SPLAY_RAD = 0.22;
/** The leg plane sits outside the body-frame rail line. */
const LEG_Z = 0.3;
/** x of the hip point — the vertical rotation axis of the splay. */
const HIP_X = -0.06;

// The leg-exo sagittal node table (legExo.ts), verbatim.
const P: Record<string, { x: number; y: number }> = {
  hipYoke: { x: -0.06, y: 0.98 }, // legExo's frameHip — now the yaw yoke
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

/** Heel-lift elastic pretension: rest = factor × drawn distance (matches the
 * leg-exo tension at its drawn 0.45 m rest over a 0.622 m hang). */
const HEEL_REST_FACTOR = 0.72;
/** Toe-up travel limit: rope engages 2 cm past the drawn tip–pad distance. */
const TOE_ROPE_SLACK_M = 0.02;
/** Hip-yaw centring spring (planfile: ~40 N·m/rad, centring the splay). */
const YAW_SPRING_NM_PER_RAD = 40;
/** Hip-yaw travel about the drawn splay. */
const YAW_TRAVEL_RAD = 0.35;

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

type Side = 'left' | 'right';
const sideSign = (side: Side): 1 | -1 => (side === 'left' ? 1 : -1);

/** Splay transform: rotate the sagittal point about the vertical axis
 * through the hip point, in the leg plane at z = ±LEG_Z, so the toe end
 * (x > HIP_X) swings outward; the right side is the z = 0 mirror. */
function at(id: string, side: Side): Vec3 {
  const p = P[id]!;
  const dx = p.x - HIP_X;
  return v3(
    round4(HIP_X + dx * Math.cos(SPLAY_RAD)),
    p.y,
    round4(sideSign(side) * (LEG_Z + dx * Math.sin(SPLAY_RAD))),
  );
}

/** The rotated sagittal-plane normal — the knee/ankle/toe hinge axis. Not a
 * panel normal: |x| = sin(SPLAY_RAD) ≈ 0.218. Mirrored as an axial vector
 * on the right side ((x,y,z) → (−x,−y,z)). */
function legHingeAxis(side: Side): Vec3 {
  // full-precision sin/cos so the axis is unit to machine epsilon
  return { x: -sideSign(side) * Math.sin(SPLAY_RAD), y: 0, z: Math.cos(SPLAY_RAD) };
}

/** Vertical yaw axis, oriented so signed yaw angles mirror left/right. */
function yawAxis(side: Side): Vec3 {
  return { x: 0, y: -sideSign(side), z: 0 };
}

function hipMountPos(side: Side): Vec3 {
  return v3(0.02, 0.98, sideSign(side) * 0.25);
}

/** The yoke-arm end — a short sleeve down the drawn femur direction; the
 * swing linkage hangs spherically from here. */
const ARM_FRACTION = 0.3;
function hipSwingPos(side: Side): Vec3 {
  const yoke = at('hipYoke', side);
  const knee = at('eKnee', side);
  return v3(
    round4(yoke.x + ARM_FRACTION * (knee.x - yoke.x)),
    round4(yoke.y + ARM_FRACTION * (knee.y - yoke.y)),
    round4(yoke.z + ARM_FRACTION * (knee.z - yoke.z)),
  );
}

/** Signed drawn yaw angle between the post's continuation and the yoke arm
 * about the yaw axis (the standard "0 = straight continuation" convention).
 * The torsion spring rests here — it centres the SPLAY, not zero — and the
 * ±YAW_TRAVEL limit brackets it. Identical on both sides by mirror symmetry
 * of the geometry and the mirrored axis. */
function drawnYawRad(side: Side): number {
  const mount = hipMountPos(side);
  const yoke = at('hipYoke', side);
  const arm = hipSwingPos(side);
  const axis = yawAxis(side);
  const va = { x: yoke.x - mount.x, y: yoke.y - mount.y, z: yoke.z - mount.z };
  const vb = { x: arm.x - yoke.x, y: arm.y - yoke.y, z: arm.z - yoke.z };
  const cross = {
    x: va.y * vb.z - va.z * vb.y,
    y: va.z * vb.x - va.x * vb.z,
    z: va.x * vb.y - va.y * vb.x,
  };
  const sin = cross.x * axis.x + cross.y * axis.y + cross.z * axis.z;
  const cos = va.x * vb.x + va.y * vb.y + va.z * vb.z;
  return round4(Math.atan2(sin, cos));
}

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

export function buildSplayedLegParts(side: Side, prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const s = side === 'left' ? 'L' : 'R';
  const axis = legHingeAxis(side);
  const yaw = drawnYawRad(side);

  const bindings: SkeletonBinding[] = [
    { id: n('bindHip'), point: `hip${s}` as SkeletonBinding['point'], nodeId: n('wHip') },
    { id: n('bindKnee'), point: `knee${s}` as SkeletonBinding['point'], nodeId: n('wKnee') },
    { id: n('bindShoe'), point: `shoe${s}` as SkeletonBinding['point'], nodeId: n('wShoe') },
  ];

  const elements: MechanismElement[] = [
    // frame post: hip mount to the yaw yoke (both frame-fixed anchors)
    {
      ...pipe(n('hipPost'), n('hipMount'), n('hipYoke'), PIPE_075),
      endRealizationA: 'fitting',
      endRealizationB: 'nestedSleeve',
    },
    // the yoke arm: a short sleeve turned by the yaw bearing; the femur
    // hangs spherically from its end (no pivot at hipSwing — the leg-exo
    // hip-hang pattern)
    {
      ...pipe(n('yokeArm'), n('hipYoke'), n('hipSwing'), PIPE_075),
      endRealizationA: 'nestedSleeve',
      endRealizationB: 'nestedSleeve',
    },
    pipe(n('exoFemur'), n('hipSwing'), n('eKnee'), PIPE_075),
    pipe(n('exoTibia'), n('eKnee'), n('eAnkle'), PIPE_075),
    pipe(n('exoFootMain'), n('eAnkle'), n('eToeJ'), PIPE_050),
    pipe(n('exoHeelSpur'), n('eAnkle'), n('eHeel'), PIPE_050),
    pipe(n('exoToePadBar'), n('eToeJ'), n('eToePad'), PIPE_050),
    pipe(n('exoToe'), n('eToeJ'), n('eToe'), PIPE_050),
    { ...pipe(n('tieKnee'), n('wKnee'), n('eKnee'), PIPE_050), endRealizationA: 'ropeLashing' },
    { ...pipe(n('tieShoe'), n('wShoe'), n('eAnkle'), PIPE_050), endRealizationA: 'ropeLashing' },
    // stacked hip yaw: a vertical-axis bearing at the ANCHORED yoke (pinned
    // axis — see header), sprung to the drawn splay
    {
      id: n('yawPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeId: n('hipYoke'),
      joint: { kind: 'hinge', axis: yawAxis(side) },
      memberIds: [n('hipPost'), n('yokeArm')],
      welds: [],
      angleLimit: {
        memberA: n('hipPost'),
        memberB: n('yokeArm'),
        minRad: round4(yaw - YAW_TRAVEL_RAD),
        maxRad: round4(yaw + YAW_TRAVEL_RAD),
      },
      torsionSpring: {
        memberA: n('hipPost'),
        memberB: n('yokeArm'),
        stiffnessNmPerRad: YAW_SPRING_NM_PER_RAD,
        restAngleRad: yaw,
      },
      realization: 'nestedSleeve',
    },
    {
      id: n('kneePivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeId: n('eKnee'),
      joint: { kind: 'hinge', axis },
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
      joint: { kind: 'hinge', axis },
      memberIds: [n('exoTibia'), n('exoFootMain'), n('exoHeelSpur'), n('tieShoe')],
      welds: [[n('exoFootMain'), n('exoHeelSpur')]],
      angleLimit: { memberA: n('exoTibia'), memberB: n('exoFootMain'), minRad: 0.6, maxRad: 1.9 },
      realization: 'boltThrough',
    },
    {
      id: n('toePivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeId: n('eToeJ'),
      joint: { kind: 'hinge', axis },
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
      restLengthM: round4(HEEL_REST_FACTOR * dist(at('frameSide', side), at('eHeel', side))),
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
      lengthM: round4(dist(at('eToe', side), at('eToePad', side)) + TOE_ROPE_SLACK_M),
      cordageMaterialId: CORD,
    },
    {
      id: n('toeReturnElastic'),
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'leg',
      nodeA: n('eToe'),
      nodeB: n('eToePad'),
      restLengthM: dist(at('eToe', side), at('eToePad', side)),
      stiffnessNPerM: 60,
      tensionOnly: true,
      cordageMaterialId: BUNGEE_6,
    },
  ];

  return {
    nodes: [
      { id: n('hipMount'), kind: 'anchor', position: hipMountPos(side) },
      { id: n('hipYoke'), kind: 'anchor', position: at('hipYoke', side) },
      { id: n('hipSwing'), kind: 'free', position: hipSwingPos(side) },
      { id: n('frameSide'), kind: 'anchor', position: at('frameSide', side) },
      { id: n('wHip'), kind: 'free', position: at('wHip', side) },
      { id: n('wKnee'), kind: 'free', position: at('wKnee', side) },
      { id: n('wShoe'), kind: 'free', position: at('wShoe', side) },
      { id: n('eKnee'), kind: 'free', position: at('eKnee', side) },
      { id: n('eAnkle'), kind: 'free', position: at('eAnkle', side) },
      { id: n('eHeel'), kind: 'free', position: at('eHeel', side) },
      { id: n('eToeJ'), kind: 'free', position: at('eToeJ', side) },
      { id: n('eToePad'), kind: 'free', position: at('eToePad', side) },
      { id: n('eToe'), kind: 'free', position: at('eToe', side) },
    ],
    elements,
    pointMasses: [{ id: n('pawMass'), name: 'paw claw', massKg: 0.1, nodeId: n('eToe') }],
    skeletonBindings: bindings,
    inputs: [],
  };
}

export function buildSplayedLegsProject(): Project {
  const left = buildSplayedLegParts('left', 'legL.');
  const right = buildSplayedLegParts('right', 'legR.');
  const parts = mergeParts(left, right);
  return exampleProject(
    'example-splayed-legs',
    'Example — Raptor splayed legs',
    partsMechanism('splayed-legs', 'Splayed legs (3D gait)', parts),
    [
      groupOf('grp-leg-left', 'Leg (left)', left.elements),
      groupOf('grp-leg-right', 'Leg (right)', right.elements),
    ],
  );
}
