// Bundled example: "towering figure (dance mirror)" (PLANFILE-fun-costume-
// samples.md C1). A ~2.8 m backpack-mounted stick figure that hangs on the
// wearer (anchorBindings to spineTop + beltBack + the four hip-rect anchors)
// and mirrors the wearer's dancing:
//   • marionette arms — each super-long arm hangs from a shoulder cross-bar
//     tip and is raised by a CORD rope [elbow → horn tip → belt eyelet →
//     wearer hand]. The horn post above each bar tip is the rope's off-axis
//     lever: the elbow→horn leg shortens as the arm swings up, so raising a
//     hand (lengthening the hand→belt leg) hoists the giant's arm the same
//     way, amplified by reach. Horns rake FORWARD (+x) so the initial rope
//     pull torques the hanging arm toward the forward-raise branch instead
//     of jamming against the rear stop.
//   • bobble head — 0.8 kg head on a post carried by a SPHERICAL pivot,
//     restrained by a 3-elastic guy nest to a 120° spreader wheel; it
//     jiggles with the dance and re-centres when displaced.
//   • legs — one hanging leg per side on a sagittal hip hinge, strapped to
//     the wearer's knee by a short tie link (leg-exo tie pattern) so the
//     figure steps along with the gait.
// The mast is rigid to the five HIP-FRAME anchors only (their mutual
// distances are pose-invariant, so clip playback never violates a strut);
// the pose-dependent spineTop anchor attaches compliantly — a near-taut
// strap rope plus two carry bungees (the body-frame pattern's soft half).
import type {
  AnchorBinding,
  Group,
  MechanismElement,
  Project,
  SkeletonBinding,
  Vec3,
} from '../schema';
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

type Side = 'left' | 'right';
const sideSign = (side: Side): number => (side === 'left' ? 1 : -1);

// ── coordinate table ──────────────────────────────────────────────────────
// Wearer-frame numbers (DEFAULT_WEARER, 1.75 m): hipY 0.9275, shoulderY
// 1.4315, shoulder z ±0.23, hip-rect anchors x 0.12/−0.14, z ±0.21. Anchor
// nodes are drawn exactly at their wearer-anchor rest positions so
// groundTargets are a no-op at the rest pose. Side geometry is given for the
// LEFT (+z); the right side mirrors z.
const P = {
  // anchors
  aSpine: v3(0, 1.4315, 0),
  aBelt: v3(-0.1, 0.9275, 0),
  aRectFL: v3(0.12, 0.9275, 0.21),
  aRectFR: v3(0.12, 0.9275, -0.21),
  aRectBL: v3(-0.14, 0.9275, 0.21),
  aRectBR: v3(-0.14, 0.9275, -0.21),
  // mast column (x = −0.1 plane, behind the back) + shoulder cross-bar
  mastMid: v3(-0.1, 1.4315, 0),
  mastTop: v3(-0.1, 2.3, 0),
  barTipL: v3(-0.1, 2.3, 0.35),
  hornTipL: v3(0.05, 2.6, 0.35), // marionette lever horn, raked forward
  // spreader wheel for the head nest: 120° spread in the horizontal plane
  spreadF: v3(0.2, 2.3, 0),
  spreadL: v3(-0.25, 2.3, 0.26),
  spreadR: v3(-0.25, 2.3, -0.26),
  // bobble head: spherical pivot at 2.45, head mass at 2.7
  neckBase: v3(-0.1, 2.45, 0),
  head: v3(-0.1, 2.7, 0),
  // arm (left): 0.6 m upper arm with a slight forward kink at its midpoint
  // (the return-elastic tap), 0.6 m forearm drawn ELBOW_BEND rad forward of
  // straight (the torsion spring's neutral)
  armMid: v3(-0.07, 2.0, 0.35),
  elbow: v3(-0.1, 1.7, 0.35),
  // elbow + 0.6·rot(+0.25 rad about +z)·unit(elbow − armMid), rounded 0.1 mm
  armTip: v3(-0.0101, 1.1068, 0.35),
  wHand: v3(0, 0.8505, 0.23), // wearer hand at rest (shoulderY − arm reach)
  // leg (left): hip bracket off the pack bottom, kinked knee, foot tip
  hipBkt: v3(-0.1, 0.85, 0.2),
  legKnee: v3(-0.06, 0.5, 0.2),
  foot: v3(-0.1, 0.1, 0.2),
  wKnee: v3(0, 0.49875, 0.18), // wearer knee at rest (hipY − thigh)
};

/** Marionette rope slack over the drawn taut path (spec: drawn + 0.002). */
const DRIVE_ROPE_SLACK_M = 0.002;
/** Elbow torsion-spring rest: the forearm's drawn forward bend (rad). */
const ELBOW_BEND_RAD = 0.25;

/** Signed angle about +z between the continuation of a→pivot and pivot→b —
 * the solver's hinge-angle convention (0 = straight) for sagittal joints,
 * rounded like dist() so stored limits stay float-stable. All triples used
 * here share one z plane, so the 2D formula is exact for both sides. */
function restAngleZ(a: Vec3, pivot: Vec3, b: Vec3): number {
  const vax = pivot.x - a.x;
  const vay = pivot.y - a.y;
  const vbx = b.x - pivot.x;
  const vby = b.y - pivot.y;
  return Math.round(Math.atan2(vax * vby - vay * vbx, vax * vbx + vay * vby) * 1e4) / 1e4;
}

const SHOULDER_REST = restAngleZ(P.hornTipL, P.barTipL, P.armMid);
const HIP_REST = restAngleZ(P.aBelt, P.hipBkt, P.legKnee);

function link(
  id: string,
  nodeA: string,
  nodeB: string,
  tag: string,
  materialId: string = PIPE_050,
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

function elastic(
  id: string,
  nodeA: string,
  nodeB: string,
  tag: string,
  a: Vec3,
  b: Vec3,
  stiffnessNPerM: number,
  materialId: string,
): Extract<MechanismElement, { type: 'elastic' }> {
  return {
    id,
    type: 'elastic',
    maturity: 'engineered',
    subsystemTag: tag,
    nodeA,
    nodeB,
    slackLengthM: dist(a, b), // neutral at the drawn pose
    stiffnessNPerM,
    cordageMaterialId: materialId,
  };
}

const mirror = (p: Vec3, s: number): Vec3 => v3(p.x, p.y, s * p.z);

// ── suspension: anchor nodes + mast-to-wearer attachment ─────────────────
function buildSuspensionParts(prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  return {
    nodes: [
      { id: n('aSpine'), kind: 'anchor', position: P.aSpine },
      { id: n('aBelt'), kind: 'anchor', position: P.aBelt },
      { id: n('aRectFL'), kind: 'anchor', position: P.aRectFL },
      { id: n('aRectFR'), kind: 'anchor', position: P.aRectFR },
      { id: n('aRectBL'), kind: 'anchor', position: P.aRectBL },
      { id: n('aRectBR'), kind: 'anchor', position: P.aRectBR },
    ],
    elements: [
      // rigid struts to the pose-invariant hip frame
      link(n('strutFL'), n('aRectFL'), n('mastMid'), 'suspension'),
      link(n('strutFR'), n('aRectFR'), n('mastMid'), 'suspension'),
      link(n('strutBL'), n('aRectBL'), n('mastMid'), 'suspension'),
      link(n('strutBR'), n('aRectBR'), n('mastMid'), 'suspension'),
      link(n('guyL'), n('aRectBL'), n('barTipL'), 'suspension'),
      link(n('guyR'), n('aRectBR'), n('barTipR'), 'suspension'),
      // horn stays: the only x-offset ties to the crossbar assembly — they
      // kill the roll DOF about the crossbar's own line (anti-roll keel duty)
      link(n('hornStayL'), n('aRectFL'), n('hornTipL'), 'suspension'),
      link(n('hornStayR'), n('aRectFR'), n('hornTipR'), 'suspension'),
      // the spineTop anchor moves with torso lean, so it attaches softly:
      // near-taut strap rope (slack covers the dance clip's lean range) +
      // two carry bungees to the bar tips
      {
        id: n('strapSpine'),
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'suspension',
        path: [n('aSpine'), n('mastTop')],
        lengthM: dist(P.aSpine, P.mastTop) + 0.01,
        cordageMaterialId: CORD,
      },
      elastic(
        n('carryL'),
        n('aSpine'),
        n('barTipL'),
        'suspension',
        P.aSpine,
        P.barTipL,
        200,
        BUNGEE_8,
      ),
      elastic(
        n('carryR'),
        n('aSpine'),
        n('barTipR'),
        'suspension',
        P.aSpine,
        mirror(P.barTipL, -1),
        200,
        BUNGEE_8,
      ),
    ],
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
  };
}

// ── mast + bobble head ────────────────────────────────────────────────────
function buildMastHeadParts(prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const nest = (id: string, spreadId: string, spread: Vec3) =>
    elastic(n(id), n('head'), n(spreadId), 'head', P.head, spread, 400, BUNGEE_6);
  return {
    nodes: [
      { id: n('mastMid'), kind: 'free', position: P.mastMid },
      { id: n('mastTop'), kind: 'free', position: P.mastTop },
      { id: n('barTipL'), kind: 'free', position: P.barTipL },
      { id: n('barTipR'), kind: 'free', position: mirror(P.barTipL, -1) },
      { id: n('hornTipL'), kind: 'free', position: P.hornTipL },
      { id: n('hornTipR'), kind: 'free', position: mirror(P.hornTipL, -1) },
      { id: n('spreadF'), kind: 'free', position: P.spreadF },
      { id: n('spreadL'), kind: 'free', position: P.spreadL },
      { id: n('spreadR'), kind: 'free', position: P.spreadR },
      { id: n('neckBase'), kind: 'free', position: P.neckBase },
      { id: n('head'), kind: 'free', position: P.head },
    ],
    elements: [
      link(n('mastLower'), n('aBelt'), n('mastMid'), 'mast', PIPE_075),
      link(n('mastUpper'), n('mastMid'), n('mastTop'), 'mast', PIPE_075),
      // shoulder cross-bar halves, each continuing up-forward into its
      // marionette horn — one heat-bent pipe per side
      {
        id: n('barL'),
        type: 'bentLink',
        maturity: 'engineered',
        subsystemTag: 'mast',
        nodeIds: [n('mastTop'), n('barTipL'), n('hornTipL')],
        filletRadiiM: [0.06],
        pipeMaterialId: PIPE_050,
        endRealizationA: 'boltThrough',
        endRealizationB: 'boltThrough',
        pointMasses: [],
      },
      {
        id: n('barR'),
        type: 'bentLink',
        maturity: 'engineered',
        subsystemTag: 'mast',
        nodeIds: [n('mastTop'), n('barTipR'), n('hornTipR')],
        filletRadiiM: [0.06],
        pipeMaterialId: PIPE_050,
        endRealizationA: 'boltThrough',
        endRealizationB: 'boltThrough',
        pointMasses: [],
      },
      // rigid mast head: both bar halves welded to the mast at its top
      {
        id: n('mastHeadPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'mast',
        nodeId: n('mastTop'),
        joint: { kind: 'hinge', axis: { x: 1, y: 0, z: 0 } },
        memberIds: [n('mastUpper'), n('barL'), n('barR')],
        welds: [
          [n('mastUpper'), n('barL')],
          [n('mastUpper'), n('barR')],
          [n('barL'), n('barR')],
        ],
        realization: 'boltThrough',
      },
      // spreader wheel (nest anchors at 120°): legs + rim + umbrella stays
      link(n('spreadLegF'), n('mastTop'), n('spreadF'), 'head'),
      link(n('spreadLegL'), n('mastTop'), n('spreadL'), 'head'),
      link(n('spreadLegR'), n('mastTop'), n('spreadR'), 'head'),
      link(n('spreadRimFL'), n('spreadF'), n('spreadL'), 'head'),
      link(n('spreadRimFR'), n('spreadF'), n('spreadR'), 'head'),
      link(n('spreadRimLR'), n('spreadL'), n('spreadR'), 'head'),
      link(n('spreadStayF'), n('mastMid'), n('spreadF'), 'head'),
      link(n('spreadStayL'), n('mastMid'), n('spreadL'), 'head'),
      link(n('spreadStayR'), n('mastMid'), n('spreadR'), 'head'),
      // the stays and legs all meet the mast line, so the wheel could still
      // spin about it — these short ties to the bar tips pin its azimuth
      link(n('spreadTieL'), n('spreadL'), n('barTipL'), 'head'),
      link(n('spreadTieR'), n('spreadR'), n('barTipR'), 'head'),
      // bobble: rigid neck post up to the spherical pivot, head post above
      link(n('neckPost'), n('mastTop'), n('neckBase'), 'head'),
      link(n('neckBraceF'), n('spreadF'), n('neckBase'), 'head'),
      link(n('neckBraceL'), n('spreadL'), n('neckBase'), 'head'),
      link(n('neckBraceR'), n('spreadR'), n('neckBase'), 'head'),
      link(n('headPost'), n('neckBase'), n('head'), 'head'),
      {
        id: n('headPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'head',
        nodeId: n('neckBase'),
        joint: { kind: 'spherical' },
        memberIds: [n('neckPost'), n('headPost')],
        welds: [],
        realization: 'ropeLashing',
      },
      nest('nestF', 'spreadF', P.spreadF),
      nest('nestL', 'spreadL', P.spreadL),
      nest('nestR', 'spreadR', P.spreadR),
    ],
    pointMasses: [{ id: n('headMass'), name: 'head', massKg: 0.8, nodeId: n('head') }],
    skeletonBindings: [],
    inputs: [],
  };
}

// ── marionette arm (per side) ─────────────────────────────────────────────
function buildArmParts(side: Side, prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const s = sideSign(side);
  const S = side === 'left' ? 'L' : 'R';
  const armMid = mirror(P.armMid, s);
  const elbow = mirror(P.elbow, s);
  const armTip = mirror(P.armTip, s);
  const wHand = mirror(P.wHand, s);
  const hornTip = mirror(P.hornTipL, s);
  const mastMid = P.mastMid;

  const bindings: SkeletonBinding[] = [
    {
      id: n(`bindHand${S}`),
      point: `hand${S}` as SkeletonBinding['point'],
      nodeId: n(`wHand${S}`),
    },
  ];

  const elements: MechanismElement[] = [
    {
      id: n(`upperArm${S}`),
      type: 'bentLink',
      maturity: 'engineered',
      subsystemTag: 'arm',
      nodeIds: [n(`barTip${S}`), n(`armMid${S}`), n(`elbow${S}`)],
      filletRadiiM: [0.08],
      pipeMaterialId: PIPE_050,
      endRealizationA: 'boltThrough',
      endRealizationB: 'boltThrough',
      pointMasses: [],
    },
    link(n(`foreArm${S}`), n(`elbow${S}`), n(`armTip${S}`), 'arm'),
    // shoulder: sagittal hinge at the bar tip; the horn is the angle
    // reference, so the limit window is exactly [−0.4, +2.9] about hanging
    {
      id: n(`shoulderPivot${S}`),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'arm',
      nodeId: n(`barTip${S}`),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n(`bar${S}`), n(`upperArm${S}`)],
      welds: [],
      angleLimit: {
        memberA: n(`bar${S}`),
        memberB: n(`upperArm${S}`),
        minRad: Math.round((SHOULDER_REST - 0.4) * 1e4) / 1e4,
        maxRad: Math.round((SHOULDER_REST + 2.9) * 1e4) / 1e4,
      },
      realization: 'boltThrough',
    },
    // elbow: soft torsion spring, neutral slightly bent — the forearm flops
    {
      id: n(`elbowPivot${S}`),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'arm',
      nodeId: n(`elbow${S}`),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n(`upperArm${S}`), n(`foreArm${S}`)],
      welds: [],
      angleLimit: {
        memberA: n(`upperArm${S}`),
        memberB: n(`foreArm${S}`),
        minRad: -0.1,
        maxRad: 2.5,
      },
      torsionSpring: {
        memberA: n(`upperArm${S}`),
        memberB: n(`foreArm${S}`),
        stiffnessNmPerRad: 8,
        restAngleRad: ELBOW_BEND_RAD,
      },
      realization: 'boltThrough',
    },
    elastic(
      n(`armReturn${S}`),
      n('mastMid'),
      n(`armMid${S}`),
      'arm',
      mastMid,
      armMid,
      40,
      BUNGEE_6,
    ),
    // the marionette drive (see file header)
    {
      id: n(`ropeDrive${S}`),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'arm',
      path: [n(`elbow${S}`), n(`hornTip${S}`), n('aBelt'), n(`wHand${S}`)],
      lengthM:
        dist(elbow, hornTip) + dist(hornTip, P.aBelt) + dist(P.aBelt, wHand) + DRIVE_ROPE_SLACK_M,
      cordageMaterialId: CORD,
    },
  ];

  return {
    nodes: [
      { id: n(`armMid${S}`), kind: 'free', position: armMid },
      { id: n(`elbow${S}`), kind: 'free', position: elbow },
      { id: n(`armTip${S}`), kind: 'free', position: armTip },
      { id: n(`wHand${S}`), kind: 'free', position: wHand },
    ],
    elements,
    pointMasses: [
      { id: n(`armTipMass${S}`), name: 'arm tip', massKg: 0.3, nodeId: n(`armTip${S}`) },
    ],
    skeletonBindings: bindings,
    inputs: [],
  };
}

// ── gait leg (per side) ───────────────────────────────────────────────────
function buildLegParts(side: Side, prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const s = sideSign(side);
  const S = side === 'left' ? 'L' : 'R';
  const rect = side === 'left' ? { f: 'aRectFL', b: 'aRectBL' } : { f: 'aRectFR', b: 'aRectBR' };

  return {
    nodes: [
      { id: n(`hipBkt${S}`), kind: 'free', position: mirror(P.hipBkt, s) },
      { id: n(`legKnee${S}`), kind: 'free', position: mirror(P.legKnee, s) },
      { id: n(`foot${S}`), kind: 'free', position: mirror(P.foot, s) },
      { id: n(`wKnee${S}`), kind: 'free', position: mirror(P.wKnee, s) },
    ],
    elements: [
      // hip bracket, triangulated to the hip frame
      link(n(`hipBktBelt${S}`), n('aBelt'), n(`hipBkt${S}`), 'leg'),
      link(n(`hipBktBack${S}`), n(rect.b), n(`hipBkt${S}`), 'leg'),
      link(n(`hipBktFront${S}`), n(rect.f), n(`hipBkt${S}`), 'leg'),
      // the leg itself: one bent pipe, knee kinked forward
      {
        id: n(`leg${S}`),
        type: 'bentLink',
        maturity: 'engineered',
        subsystemTag: 'leg',
        nodeIds: [n(`hipBkt${S}`), n(`legKnee${S}`), n(`foot${S}`)],
        filletRadiiM: [0.05],
        pipeMaterialId: PIPE_050,
        endRealizationA: 'boltThrough',
        endRealizationB: 'boltThrough',
        pointMasses: [],
      },
      {
        id: n(`hipPivot${S}`),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'leg',
        nodeId: n(`hipBkt${S}`),
        joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
        memberIds: [n(`hipBktBelt${S}`), n(`leg${S}`)],
        welds: [],
        angleLimit: {
          memberA: n(`hipBktBelt${S}`),
          memberB: n(`leg${S}`),
          minRad: Math.round((HIP_REST - 0.7) * 1e4) / 1e4,
          maxRad: Math.round((HIP_REST + 0.7) * 1e4) / 1e4,
        },
        realization: 'boltThrough',
      },
      // knee strap (leg-exo tie pattern): lashed to the wearer, bolted to
      // the leg — the gait swings the giant's leg
      {
        ...link(n(`tieKnee${S}`), n(`wKnee${S}`), n(`legKnee${S}`), 'leg'),
        endRealizationA: 'ropeLashing',
      },
    ],
    pointMasses: [{ id: n(`footMass${S}`), name: 'foot pad', massKg: 0.3, nodeId: n(`foot${S}`) }],
    skeletonBindings: [
      {
        id: n(`bindKnee${S}`),
        point: `knee${S}` as SkeletonBinding['point'],
        nodeId: n(`wKnee${S}`),
      },
    ],
    inputs: [],
  };
}

/** Whole-figure subsystem contribution, id-prefixable for compound merges. */
export function buildToweringFigureParts(prefix = ''): MechParts {
  return mergeParts(
    buildSuspensionParts(prefix),
    buildMastHeadParts(prefix),
    buildArmParts('left', prefix),
    buildArmParts('right', prefix),
    buildLegParts('left', prefix),
    buildLegParts('right', prefix),
  );
}

export function buildToweringFigureProject(): Project {
  const suspension = buildSuspensionParts('');
  const mastHead = buildMastHeadParts('');
  const armLeft = buildArmParts('left', '');
  const armRight = buildArmParts('right', '');
  const legLeft = buildLegParts('left', '');
  const legRight = buildLegParts('right', '');
  const parts = mergeParts(suspension, mastHead, armLeft, armRight, legLeft, legRight);

  const anchorBindings: AnchorBinding[] = [
    { id: 'attachSpine', anchor: 'spineTop', nodeId: 'aSpine' },
    { id: 'attachBelt', anchor: 'beltBack', nodeId: 'aBelt' },
    { id: 'attachRectFL', anchor: 'hipRectFrontL', nodeId: 'aRectFL' },
    { id: 'attachRectFR', anchor: 'hipRectFrontR', nodeId: 'aRectFR' },
    { id: 'attachRectBL', anchor: 'hipRectBackL', nodeId: 'aRectBL' },
    { id: 'attachRectBR', anchor: 'hipRectBackR', nodeId: 'aRectBR' },
  ];

  const groups: Group[] = [
    groupOf('grp-mast-head', 'Mast + head', mastHead.elements),
    groupOf('grp-arm-left', 'Arm (left)', armLeft.elements),
    groupOf('grp-arm-right', 'Arm (right)', armRight.elements),
    groupOf('grp-legs', 'Legs', [...legLeft.elements, ...legRight.elements]),
    groupOf('grp-suspension', 'Suspension', suspension.elements),
  ];

  return exampleProject(
    'example-towering-figure',
    'Example — Towering dance figure',
    {
      ...partsMechanism('towering-figure', 'Towering figure', parts),
      anchorBindings,
    },
    groups,
  );
}
