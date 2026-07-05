// Bundled example: "tall quadruped" (PLANFILE-fun-costume-samples.md, C5) —
// a complete wearable costume: a giraffe-legged animal ~3 m at the head, as
// ONE v7 compound mechanism suspended from the wearer.
//
//   • Body frame: a rail box around the wearer at hip height (y 0.98) with
//     front/rear pylons, a spine bar and a chest mast, exactly triangulated
//     (15 links on 7 free nodes = 3·7 − 6). It HANGS on the wearer through
//     anchorBindings: four pretensioned shoulder bungees carry it up, four
//     near-taut hip-rect straps (drawn + 2 mm) hold it down and centre it —
//     the body-frame suspension pattern.
//   • Neck: a two-section boom rising to y 2.86. The root hinge at the front
//     pylon apex swings sagittally; a taut CORD hold rope from the mast to
//     mid-neck is the droop stop (rope-as-limit — the hinge's own limits sit
//     well outside). The mid-neck pivot is the compliant torsion-sprung sway
//     joint (tailBoom pattern, stiff). Both hinges get their axis tie from
//     off-line members rigid to the carrying cluster (frame pylons at the
//     root; a keel triangle on the lower boom at the mid pivot) — the
//     anti-roll keel pattern from the full-creature neck.
//   • Head: 0.6 kg on a short post over a spherical pivot at the boom top —
//     a bobble — restrained by a 3-elastic guy nest to crown spreader tips
//     (the towering-figure nest pattern). The crown is a rigid tetrahedron
//     (three bars + ring) stayed to mid-neck so it rides the boom.
//   • Legs: the leg-exoskeleton linkage node table copied here (legExo.ts is
//     untouched) with an outward transform — exo geometry at z ±0.30, the
//     wearer-strapped nodes at the true skeleton half-width z ±0.18 — and the
//     frame-side nodes re-homed from world anchors onto the suspended rail
//     box (three braces each). Skeleton bindings to hip/knee/shoe drive the
//     legs from the walk clip.
//   • Tail: a short aft stub (frame-rigid via braces to the rear corners)
//     with a torsion-sprung droop hinge and a 1.2 kg counterweight sized so
//     the standing gravity moment about the pack roughly cancels the
//     neck+head moment (seesaw-spine trick; see the balance test).
//
// No input channels: the costume is entirely wearer-driven (gait mimicry)
// plus passive springs. All rope/elastic rest lengths derive from drawn
// geometry via dist(); deliberate deltas are explicit constants.
import type {
  AnchorBinding,
  ElasticElement,
  MechanismElement,
  Project,
  RopeElement,
  SkeletonBinding,
  Vec3,
} from '../schema';
import { DEFAULT_WEARER } from '../schema';
import {
  BUNGEE_6,
  BUNGEE_8,
  CORD,
  dist,
  exampleProject,
  groupOf,
  HINGE_SAGITTAL,
  type MechParts,
  mergeParts,
  PIPE_050,
  PIPE_075,
  partsMechanism,
  v3,
} from './shared';

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/** Signed hinge deviation about +z at the drawn pose: 0 = memberB continuing
 * memberA straight through the pivot (schema angle convention). */
function restAngleZ(a: Vec3, pivot: Vec3, b: Vec3): number {
  const vax = pivot.x - a.x;
  const vay = pivot.y - a.y;
  const vbx = b.x - pivot.x;
  const vby = b.y - pivot.y;
  return round4(Math.atan2(vax * vby - vay * vbx, vax * vbx + vay * vby));
}

function pipe(
  id: string,
  tag: string,
  nodeA: string,
  nodeB: string,
  materialId: string,
): Extract<MechanismElement, { type: 'link' }> {
  return {
    id,
    type: 'link',
    maturity: 'engineered',
    subsystemTag: tag,
    nodeA,
    nodeB,
    pipeMaterialId: materialId,
    endRealizationA: 'boltThrough',
    endRealizationB: 'boltThrough',
    pointMasses: [],
  };
}

// ── body frame + suspension ──────────────────────────────────────────────
// Wearer rest-frame anchor positions (skeleton.ts with DEFAULT_WEARER,
// 1.75 m): shoulders (0, 0.818·H, ±shoulderWidth/2), hip-rect corners at
// hip height 0.53·H with x 0.12/−0.14, z ±(hipWidth/2 + 0.03).
const SHOULDER_Y = 1.4315;
const HIP_Y = 0.9275;
const RECT_Z = 0.21;
const SHOULDER_Z = DEFAULT_WEARER.shoulderWidthM / 2; // 0.23

/** Strap slack over drawn length: "near-taut" — the pretensioned bungees
 * lift the frame ~7 mm until the straps engage and pin it. */
const STRAP_SLACK_M = 0.002;
/** Bungee pretension: rest = 0.85 × drawn (carry with margin). */
const BUNGEE_REST_FACTOR = 0.85;
const BUNGEE_STIFFNESS = 180; // N/m

const F = {
  fl: v3(0.28, 0.98, 0.3),
  fr: v3(0.28, 0.98, -0.3),
  bl: v3(-0.36, 0.98, 0.3),
  br: v3(-0.36, 0.98, -0.3),
  neckRoot: v3(0.34, 1.12, 0),
  tailRoot: v3(-0.42, 1.1, 0),
  mastTop: v3(0.18, 1.48, 0),
  aShoulderL: v3(0, SHOULDER_Y, SHOULDER_Z),
  aShoulderR: v3(0, SHOULDER_Y, -SHOULDER_Z),
  aHipFL: v3(0.12, HIP_Y, RECT_Z),
  aHipFR: v3(0.12, HIP_Y, -RECT_Z),
  aHipBL: v3(-0.14, HIP_Y, RECT_Z),
  aHipBR: v3(-0.14, HIP_Y, -RECT_Z),
};

function bungee(id: string, nodeA: string, nodeB: string, a: Vec3, b: Vec3): ElasticElement {
  return {
    id,
    type: 'elastic',
    maturity: 'engineered',
    subsystemTag: 'frame',
    nodeA,
    nodeB,
    restLengthM: round4(BUNGEE_REST_FACTOR * dist(a, b)),
    stiffnessNPerM: BUNGEE_STIFFNESS,
    tensionOnly: true,
    cordageMaterialId: BUNGEE_8,
  };
}

function strap(id: string, from: string, to: string, a: Vec3, b: Vec3): RopeElement {
  return {
    id,
    type: 'rope',
    maturity: 'engineered',
    subsystemTag: 'frame',
    path: [from, to],
    lengthM: dist(a, b) + STRAP_SLACK_M,
    cordageMaterialId: CORD,
  };
}

function buildFrameParts(): MechParts {
  const elements: MechanismElement[] = [
    // rail box (exactly rigid: 15 links on 7 free nodes)
    pipe('frame.railFront', 'frame', 'frame.fl', 'frame.fr', PIPE_075),
    pipe('frame.railBack', 'frame', 'frame.bl', 'frame.br', PIPE_075),
    pipe('frame.railLeft', 'frame', 'frame.fl', 'frame.bl', PIPE_075),
    pipe('frame.railRight', 'frame', 'frame.fr', 'frame.br', PIPE_075),
    pipe('frame.crossFLBR', 'frame', 'frame.fl', 'frame.br', PIPE_050),
    pipe('frame.crossFRBL', 'frame', 'frame.fr', 'frame.bl', PIPE_050),
    pipe('frame.pylonNeckL', 'frame', 'frame.fl', 'frame.neckRoot', PIPE_050),
    pipe('frame.pylonNeckR', 'frame', 'frame.fr', 'frame.neckRoot', PIPE_050),
    pipe('frame.pylonTailL', 'frame', 'frame.bl', 'frame.tailRoot', PIPE_050),
    pipe('frame.pylonTailR', 'frame', 'frame.br', 'frame.tailRoot', PIPE_050),
    pipe('frame.spineBar', 'frame', 'frame.tailRoot', 'frame.neckRoot', PIPE_075),
    pipe('frame.mastLegL', 'frame', 'frame.fl', 'frame.mastTop', PIPE_050),
    pipe('frame.mastLegR', 'frame', 'frame.fr', 'frame.mastTop', PIPE_050),
    pipe('frame.mastStayFront', 'frame', 'frame.neckRoot', 'frame.mastTop', PIPE_050),
    pipe('frame.mastStayAft', 'frame', 'frame.tailRoot', 'frame.mastTop', PIPE_050),
    // suspension: bungee carry from the shoulders…
    bungee('frame.bungeeShoulderLF', 'frame.aShoulderL', 'frame.fl', F.aShoulderL, F.fl),
    bungee('frame.bungeeShoulderLB', 'frame.aShoulderL', 'frame.bl', F.aShoulderL, F.bl),
    bungee('frame.bungeeShoulderRF', 'frame.aShoulderR', 'frame.fr', F.aShoulderR, F.fr),
    bungee('frame.bungeeShoulderRB', 'frame.aShoulderR', 'frame.br', F.aShoulderR, F.br),
    // …near-taut straps from the hip rect hold down + centre
    strap('frame.strapHipFL', 'frame.aHipFL', 'frame.fl', F.aHipFL, F.fl),
    strap('frame.strapHipFR', 'frame.aHipFR', 'frame.fr', F.aHipFR, F.fr),
    strap('frame.strapHipBL', 'frame.aHipBL', 'frame.bl', F.aHipBL, F.bl),
    strap('frame.strapHipBR', 'frame.aHipBR', 'frame.br', F.aHipBR, F.br),
  ];
  return {
    nodes: [
      { id: 'frame.fl', kind: 'free', position: F.fl },
      { id: 'frame.fr', kind: 'free', position: F.fr },
      { id: 'frame.bl', kind: 'free', position: F.bl },
      { id: 'frame.br', kind: 'free', position: F.br },
      { id: 'frame.neckRoot', kind: 'free', position: F.neckRoot },
      { id: 'frame.tailRoot', kind: 'free', position: F.tailRoot },
      { id: 'frame.mastTop', kind: 'free', position: F.mastTop },
      { id: 'frame.aShoulderL', kind: 'anchor', position: F.aShoulderL },
      { id: 'frame.aShoulderR', kind: 'anchor', position: F.aShoulderR },
      { id: 'frame.aHipFL', kind: 'anchor', position: F.aHipFL },
      { id: 'frame.aHipFR', kind: 'anchor', position: F.aHipFR },
      { id: 'frame.aHipBL', kind: 'anchor', position: F.aHipBL },
      { id: 'frame.aHipBR', kind: 'anchor', position: F.aHipBR },
    ],
    elements,
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
  };
}

/** The whole rig rides the wearer: every grounded node is bound to a wearer
 * anchor (shoulders + all four hip-rect corners). */
const SUSPENSION_BINDINGS: AnchorBinding[] = [
  { id: 'ab-shoulderL', anchor: 'shoulderL', nodeId: 'frame.aShoulderL' },
  { id: 'ab-shoulderR', anchor: 'shoulderR', nodeId: 'frame.aShoulderR' },
  { id: 'ab-hipRectFrontL', anchor: 'hipRectFrontL', nodeId: 'frame.aHipFL' },
  { id: 'ab-hipRectFrontR', anchor: 'hipRectFrontR', nodeId: 'frame.aHipFR' },
  { id: 'ab-hipRectBackL', anchor: 'hipRectBackL', nodeId: 'frame.aHipBL' },
  { id: 'ab-hipRectBackR', anchor: 'hipRectBackR', nodeId: 'frame.aHipBR' },
];

// ── neck + head ──────────────────────────────────────────────────────────
export const HEAD_MASS_KG = 0.6;
/** Mid-neck sway spring — stiff, per C5 ("tailBoom pattern, stiff"): sags
 * ≈ 0.05 rad under the 0.6 kg head, keeping the head well above y 2.7. */
const NECK_SPRING_NM_PER_RAD = 45;
// Nest tuning (deviation from the C1 "rest = dist" neutral nest, logged in
// the summary): a neutral nest left the 0.6 kg bobble with a basin barely
// 2× gravity, and the settle transient flipped the head post to hang under
// the boom top. Pretensioning every guy (rest = 0.88 × drawn) keeps all
// three taut so the restoring torque is ≈ 7× the tip-over torque.
const NEST_STIFFNESS = 350; // N/m per guy
const NEST_REST_FACTOR = 0.88;

const NECK_MID = v3(0.72, 1.98, 0);
const NECK_TOP = v3(1.08, 2.86, 0);
// Unit direction of the upper boom — the crown and head post are built
// axisymmetric about THIS axis. The crown tetra keeps one free spin DOF
// about the boom line (both its hinge-tie points, mid and top, lie on that
// line, so no stay can pin spin without locking the sway hinge); with the
// nest ring and post symmetric about the boom axis that spin carries zero
// torque, so the drawn orientation IS the equilibrium. A vertical-axis nest
// on the leaning boom was spin-loaded and flopped 180° in the settle.
const BOOM_U = (() => {
  const dx = NECK_TOP.x - NECK_MID.x;
  const dy = NECK_TOP.y - NECK_MID.y;
  const l = Math.hypot(dx, dy);
  return { x: dx / l, y: dy / l };
})();
const BOOM_PERP = { x: -BOOM_U.y, y: BOOM_U.x }; // in-plane, aft-up
const NEST_RING_R = 0.19;
const NEST_RING_DROP = 0.04; // ring centre sits this far below the boom top
const HEAD_POST_LEN = 0.18;
const RING_C = {
  x: NECK_TOP.x - NEST_RING_DROP * BOOM_U.x,
  y: NECK_TOP.y - NEST_RING_DROP * BOOM_U.y,
};
const RING_Z = round4(NEST_RING_R * Math.sin(Math.PI / 3));

const N = {
  mid: NECK_MID,
  // keel: off the lower-boom line; the keel triangle (boomLower/keelPost/
  // keelStay) is the mid hinge's anti-roll axis tie
  keel: v3(0.555, 2.053, 0),
  top: NECK_TOP,
  // crown spreader tips: 120° nest ring, perpendicular to the boom
  tipBack: v3(
    round4(RING_C.x + NEST_RING_R * BOOM_PERP.x),
    round4(RING_C.y + NEST_RING_R * BOOM_PERP.y),
    0,
  ),
  tipLeft: v3(
    round4(RING_C.x - 0.5 * NEST_RING_R * BOOM_PERP.x),
    round4(RING_C.y - 0.5 * NEST_RING_R * BOOM_PERP.y),
    RING_Z,
  ),
  tipRight: v3(
    round4(RING_C.x - 0.5 * NEST_RING_R * BOOM_PERP.x),
    round4(RING_C.y - 0.5 * NEST_RING_R * BOOM_PERP.y),
    -RING_Z,
  ),
  // head post continues the boom line (axisymmetry, above)
  head: v3(
    round4(NECK_TOP.x + HEAD_POST_LEN * BOOM_U.x),
    round4(NECK_TOP.y + HEAD_POST_LEN * BOOM_U.y),
    0,
  ),
};

/** Drawn deviation of the lower boom from the spine bar's continuation at the
 * root hinge — the hold rope pins the pose here; limits sit well outside. */
const NECK_ROOT_REST = restAngleZ(F.tailRoot, F.neckRoot, N.mid);
/** Drawn deviation of the upper boom at the mid pivot (spring rest). */
const NECK_MID_REST = restAngleZ(F.neckRoot, N.mid, N.top);

function nestGuy(id: string, tipNodeId: string, tip: Vec3): ElasticElement {
  return {
    id,
    type: 'elastic',
    maturity: 'engineered',
    subsystemTag: 'neck',
    nodeA: 'neck.head',
    nodeB: tipNodeId,
    restLengthM: round4(NEST_REST_FACTOR * dist(N.head, tip)),
    stiffnessNPerM: NEST_STIFFNESS,
    tensionOnly: true,
    cordageMaterialId: BUNGEE_6,
  };
}

function buildNeckParts(): MechParts {
  const elements: MechanismElement[] = [
    pipe('neck.boomLower', 'neck', 'frame.neckRoot', 'neck.mid', PIPE_075),
    pipe('neck.keelPost', 'neck', 'neck.mid', 'neck.keel', PIPE_050),
    pipe('neck.keelStay', 'neck', 'neck.keel', 'frame.neckRoot', PIPE_050),
    pipe('neck.boomUpper', 'neck', 'neck.mid', 'neck.top', PIPE_075),
    // ROOT: sagittal hinge at the pylon apex. Frame members (pylons + spine
    // bar) tie the axis to the frame; the rope below is the droop stop.
    {
      id: 'neck.rootPivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: 'frame.neckRoot',
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [
        'frame.pylonNeckL',
        'frame.pylonNeckR',
        'frame.spineBar',
        'neck.boomLower',
        'neck.keelStay',
      ],
      welds: [],
      angleLimit: {
        memberA: 'frame.spineBar',
        memberB: 'neck.boomLower',
        minRad: round4(NECK_ROOT_REST - 0.6),
        maxRad: round4(NECK_ROOT_REST + 0.3),
      },
      realization: 'boltThrough',
    },
    // rope-as-limit: taut at the drawn pose, so the neck rests exactly here
    // and cannot droop further (raising it slackens the rope)
    {
      id: 'neck.holdRope',
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'neck',
      path: ['frame.mastTop', 'neck.mid'],
      lengthM: dist(F.mastTop, N.mid),
      cordageMaterialId: CORD,
    },
    // MID: the compliant sway pivot; keelPost is the off-line member that
    // keeps the axis from rolling with the boom (anti-roll keel)
    {
      id: 'neck.midPivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: 'neck.mid',
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: ['neck.boomLower', 'neck.keelPost', 'neck.boomUpper'],
      welds: [],
      angleLimit: {
        memberA: 'neck.boomLower',
        memberB: 'neck.boomUpper',
        minRad: round4(NECK_MID_REST - 0.35),
        maxRad: round4(NECK_MID_REST + 0.35),
      },
      torsionSpring: {
        memberA: 'neck.boomLower',
        memberB: 'neck.boomUpper',
        stiffnessNmPerRad: NECK_SPRING_NM_PER_RAD,
        restAngleRad: NECK_MID_REST,
      },
      realization: 'nestedSleeve',
    },
    // crown: rigid spreader tetrahedron (3 bars + ring) stayed to mid-neck
    pipe('neck.crownBarBack', 'neck', 'neck.top', 'neck.tipBack', PIPE_050),
    pipe('neck.crownBarLeft', 'neck', 'neck.top', 'neck.tipLeft', PIPE_050),
    pipe('neck.crownBarRight', 'neck', 'neck.top', 'neck.tipRight', PIPE_050),
    pipe('neck.crownRingBL', 'neck', 'neck.tipBack', 'neck.tipLeft', PIPE_050),
    pipe('neck.crownRingLR', 'neck', 'neck.tipLeft', 'neck.tipRight', PIPE_050),
    pipe('neck.crownRingRB', 'neck', 'neck.tipRight', 'neck.tipBack', PIPE_050),
    pipe('neck.crownStayLeft', 'neck', 'neck.tipLeft', 'neck.mid', PIPE_050),
    pipe('neck.crownStayRight', 'neck', 'neck.tipRight', 'neck.mid', PIPE_050),
    // bobble: head post on a spherical (lashed) pivot, guyed by the nest
    pipe('neck.headPost', 'neck', 'neck.top', 'neck.head', PIPE_050),
    {
      id: 'neck.bobblePivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'neck',
      nodeId: 'neck.top',
      joint: { kind: 'spherical' },
      memberIds: ['neck.boomUpper', 'neck.headPost'],
      welds: [],
      realization: 'ropeLashing',
    },
    nestGuy('neck.nestBack', 'neck.tipBack', N.tipBack),
    nestGuy('neck.nestLeft', 'neck.tipLeft', N.tipLeft),
    nestGuy('neck.nestRight', 'neck.tipRight', N.tipRight),
  ];
  return {
    nodes: [
      { id: 'neck.mid', kind: 'free', position: N.mid },
      { id: 'neck.keel', kind: 'free', position: N.keel },
      { id: 'neck.top', kind: 'free', position: N.top },
      { id: 'neck.tipBack', kind: 'free', position: N.tipBack },
      { id: 'neck.tipLeft', kind: 'free', position: N.tipLeft },
      { id: 'neck.tipRight', kind: 'free', position: N.tipRight },
      { id: 'neck.head', kind: 'free', position: N.head },
    ],
    elements,
    pointMasses: [{ id: 'neck.headMass', name: 'head', massKg: HEAD_MASS_KG, nodeId: 'neck.head' }],
    skeletonBindings: [],
    inputs: [],
  };
}

// ── tail counterweight ───────────────────────────────────────────────────
export const COUNTERWEIGHT_KG = 1.2;
const TAIL_SPRING_NM_PER_RAD = 30;

const T = {
  j: v3(-0.5, 1.04, 0),
  tip: v3(-0.6, 0.84, 0),
};

const TAIL_REST = restAngleZ(F.tailRoot, T.j, T.tip);

function buildTailParts(): MechParts {
  const elements: MechanismElement[] = [
    {
      ...pipe('tail.stub', 'tail', 'frame.tailRoot', 'tail.j', PIPE_075),
      endRealizationA: 'clickDetachable',
    },
    // braces make the stub frame-rigid AND, as droop-pivot members, tie the
    // hinge axis to the frame (anti-roll)
    pipe('tail.braceL', 'tail', 'tail.j', 'frame.bl', PIPE_050),
    pipe('tail.braceR', 'tail', 'tail.j', 'frame.br', PIPE_050),
    {
      id: 'tail.droopPivot',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'tail',
      nodeId: 'tail.j',
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: ['tail.stub', 'tail.braceL', 'tail.braceR', 'tail.boom'],
      welds: [],
      angleLimit: {
        memberA: 'tail.stub',
        memberB: 'tail.boom',
        minRad: round4(TAIL_REST - 0.5),
        maxRad: round4(TAIL_REST + 0.5),
      },
      torsionSpring: {
        memberA: 'tail.stub',
        memberB: 'tail.boom',
        stiffnessNmPerRad: TAIL_SPRING_NM_PER_RAD,
        restAngleRad: TAIL_REST,
      },
      realization: 'nestedSleeve',
    },
    pipe('tail.boom', 'tail', 'tail.j', 'tail.tip', PIPE_075),
  ];
  return {
    nodes: [
      { id: 'tail.j', kind: 'free', position: T.j },
      { id: 'tail.tip', kind: 'free', position: T.tip },
    ],
    elements,
    pointMasses: [
      {
        id: 'tail.counterweightMass',
        name: 'counterweight',
        massKg: COUNTERWEIGHT_KG,
        nodeId: 'tail.tip',
      },
    ],
    skeletonBindings: [],
    inputs: [],
  };
}

// ── gait legs — the leg-exo node table, transformed outward ─────────────
// Copied from legExo.ts (which stays untouched): identical sagittal x-y
// coordinates, limits and springs. Outward transform: exo/frame nodes sit at
// z ±LEG_OUT_Z while the wearer-strapped nodes stay on the true skeleton
// half-width (z ±hipWidth/2), so bound nodes still coincide with their 3D
// skeleton points at rest and the tie straps run outward to the linkage.
export const LEG_OUT_Z = 0.3;

const LEG_P: Record<string, { x: number; y: number; wearer?: boolean }> = {
  frameHip: { x: -0.06, y: 0.98 },
  frameSide: { x: -0.1, y: 0.75 },
  wHip: { x: 0, y: 0.9275, wearer: true },
  wKnee: { x: 0, y: 0.49875, wearer: true },
  wShoe: { x: 0.1, y: 0, wearer: true },
  eKnee: { x: 0.08, y: 0.52 },
  eAnkle: { x: 0.05, y: 0.1 },
  eHeel: { x: -0.05, y: 0.13 },
  eToeJ: { x: 0.18, y: 0.045 },
  eToePad: { x: 0.18, y: -0.02 },
  eToe: { x: 0.3, y: 0.03 },
};

/** Toe-up travel limit (rope-as-limit), as in the leg-exo example. */
const TOE_ROPE_LENGTH = 0.15;

function buildLegParts(side: 'left' | 'right'): MechParts {
  const prefix = side === 'left' ? 'legL.' : 'legR.';
  const n = (id: string) => prefix + id;
  const s = side === 'left' ? 1 : -1;
  const railFront = side === 'left' ? 'frame.fl' : 'frame.fr';
  const railBack = side === 'left' ? 'frame.bl' : 'frame.br';
  const sk = side === 'left' ? 'L' : 'R';
  const at = (id: string): Vec3 => {
    const p = LEG_P[id]!;
    return v3(p.x, p.y, s * (p.wearer ? DEFAULT_WEARER.hipWidthM / 2 : LEG_OUT_Z));
  };
  const leg = (id: string, a: string, b: string, mat: string) =>
    pipe(n(id), 'leg', n(a), n(b), mat);

  const bindings: SkeletonBinding[] = [
    { id: n('bindHip'), point: `hip${sk}` as SkeletonBinding['point'], nodeId: n('wHip') },
    { id: n('bindKnee'), point: `knee${sk}` as SkeletonBinding['point'], nodeId: n('wKnee') },
    { id: n('bindShoe'), point: `shoe${sk}` as SkeletonBinding['point'], nodeId: n('wShoe') },
  ];

  const elements: MechanismElement[] = [
    // mount: re-home the leg's frame nodes onto the suspended rail box —
    // frameHip is pinned on the side rail by the taut front/back pair, the
    // stays to the tail pylon give both nodes their off-rail tie
    { ...pipe(n('mountHipFront'), 'leg', n('frameHip'), railFront, PIPE_050) },
    { ...pipe(n('mountHipBack'), 'leg', n('frameHip'), railBack, PIPE_050) },
    { ...pipe(n('mountHipStay'), 'leg', n('frameHip'), 'frame.tailRoot', PIPE_050) },
    { ...pipe(n('mountSidePost'), 'leg', n('frameSide'), n('frameHip'), PIPE_050) },
    { ...pipe(n('mountSideRail'), 'leg', n('frameSide'), railBack, PIPE_050) },
    { ...pipe(n('mountSideStay'), 'leg', n('frameSide'), 'frame.tailRoot', PIPE_050) },
    // the exoskeleton linkage (legExo table)
    leg('exoFemur', 'frameHip', 'eKnee', PIPE_075),
    leg('exoTibia', 'eKnee', 'eAnkle', PIPE_075),
    leg('exoFootMain', 'eAnkle', 'eToeJ', PIPE_050),
    leg('exoHeelSpur', 'eAnkle', 'eHeel', PIPE_050),
    leg('exoToePadBar', 'eToeJ', 'eToePad', PIPE_050),
    leg('exoToe', 'eToeJ', 'eToe', PIPE_050),
    { ...leg('tieKnee', 'wKnee', 'eKnee', PIPE_050), endRealizationA: 'ropeLashing' },
    { ...leg('tieShoe', 'wShoe', 'eAnkle', PIPE_050), endRealizationA: 'ropeLashing' },
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
    nodes: Object.keys(LEG_P).map((id) => ({
      id: n(id),
      kind: 'free' as const,
      position: at(id),
    })),
    elements,
    pointMasses: [{ id: n('pawMass'), name: 'paw claw', massKg: 0.1, nodeId: n('eToe') }],
    skeletonBindings: bindings,
    inputs: [],
  };
}

// ── assembly ─────────────────────────────────────────────────────────────
/** All subsystems merged into one MechParts (no anchorBindings — those are
 * added by the project builder, which owns the mechanism shell). */
export function buildTallQuadrupedParts(): MechParts {
  return mergeParts(
    buildFrameParts(),
    buildNeckParts(),
    buildLegParts('left'),
    buildLegParts('right'),
    buildTailParts(),
  );
}

export function buildTallQuadrupedProject(): Project {
  const frame = buildFrameParts();
  const neck = buildNeckParts();
  const legLeft = buildLegParts('left');
  const legRight = buildLegParts('right');
  const tail = buildTailParts();
  const parts = mergeParts(frame, neck, legLeft, legRight, tail);
  const mechanism = {
    ...partsMechanism('tall-quadruped', 'Tall quadruped', parts),
    anchorBindings: SUSPENSION_BINDINGS,
  };
  return exampleProject('example-tall-quadruped', 'Example — Skyline grazer', mechanism, [
    groupOf('grp-frame', 'Body frame + suspension', frame.elements),
    groupOf('grp-neck', 'Neck + head', neck.elements),
    groupOf('grp-leg-left', 'Leg (left)', legLeft.elements),
    groupOf('grp-leg-right', 'Leg (right)', legRight.elements),
    groupOf('grp-tail', 'Tail counterweight', tail.elements),
  ]);
}
