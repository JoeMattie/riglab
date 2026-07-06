// Bundled example: C4 "Serpent costume (head + wave tail)" —
// PLANFILE-fun-costume-samples.md. A complete wearable rig: a body hoop
// suspended from the wearer (shoulder bungee carry + near-taut hip-rect
// strap ropes over anchorBindings), a forward boom to a head at y ≈ 2.2 on a
// PAN hinge (plan axis (0,−1,0)) at the boom base, a jaw at the head
// (elastic-open, Bowden-close on channel `jaw`, trigger control at beltR),
// and a four-segment aft tail chain whose plan hinges are chained by
// torsionCables (ratio 0.8, backlash 0.15) so a single root drive whips down
// the chain with lag. Both the head pan and the tail root are driven by
// CROSSED cord ropes from steer-style grips (sliding-telescope arm + driven
// tip node, the steer-mirror pattern): the grip chain and the driven chain
// point in opposite directions, so crossing makes the head/tail swing to the
// SAME side as the grip tip.
//
// Anti-roll on the chain (the fullCreature keel lesson, generalised): every
// tail segment is a 3+-node BENTLINK, not a bare 2-node bar. An extended
// rigid body ties TWO nodes to each hinge's virtual axis particle — one far
// node along the chain (pitch rigidity needs a long axial arm) and one
// raised "horn" off the chain line (roll rigidity) — so the vertical hinge
// axes stay first-order rigid to their carrying segments; a plain bar-on-bar
// hinge would leave a bracket-spin DOF and the horizontal chain would roll
// over and droop under the tip mass.
//
// The two long cantilevers (head boom, tail root) additionally get a MAST +
// STAY: a short post rising from the pivot node, tripod-braced to the hoop,
// with a rigid stay to the swinging member. The mast top sits ON the pan
// axis, so the stay length is exactly pan-invariant — it kills the pitch
// compliance of a long arm on a short virtual-axis offset without stealing
// any of the pan DOF (the classic guyed-mast pan bearing). A ridge spar
// joins the two mast tops: the flat hoop alone has only second-order
// rigidity against out-of-plane dishing (every pairwise distance of a planar
// body is tangent to it), and the gravity loads tilt the two masts APART —
// the ridge catches exactly that differential mode first-order, and the two
// diagonal braces (each mast top to the opposite hoop node) catch the
// common-mode fore/aft lean the short tripod legs are nearly tangent to.
import type { Control, ControlClip, Group, MechanismElement, Project, Vec3 } from '../schema';
import { DEFAULT_WEARER } from '../schema';
import {
  BOWDEN_CABLE,
  BUNGEE_6,
  BUNGEE_8,
  CORD,
  dist,
  exampleProject,
  groupOf,
  HINGE_PLAN,
  HINGE_SAGITTAL,
  type MechParts,
  mergeParts,
  PIPE_050,
  PIPE_075,
  PIPE_CLS200_075,
  PIPE_CTS_050,
  PIPE_CTS_075,
  partsMechanism,
  v3,
} from './shared';

// Wearer anchor rest positions (wearer/skeleton.ts anthropometry fractions of
// DEFAULT_WEARER.heightM at the rest pose — the planfile's shared numbers:
// hipY 0.9275, shoulderY 1.4315, shoulder z ±0.23, hip-rect x 0.12/−0.14,
// z ±0.21). Suspension anchor nodes are DRAWN at these points so anchor-
// binding playback starts exactly where the document draws them.
const HIP_Y = 0.53 * DEFAULT_WEARER.heightM;
const SHOULDER_Y = HIP_Y + (0.818 - 0.53) * DEFAULT_WEARER.heightM;
const SHOULDER_Z = DEFAULT_WEARER.shoulderWidthM / 2;
const RECT_Z = DEFAULT_WEARER.hipWidthM / 2 + 0.03;

const P: Record<string, Vec3> = {
  // suspension (drawn at the wearer anchors, anchor-bound)
  susShoulderL: v3(0, SHOULDER_Y, SHOULDER_Z),
  susShoulderR: v3(0, SHOULDER_Y, -SHOULDER_Z),
  susHipFL: v3(0.12, HIP_Y, RECT_Z),
  susHipFR: v3(0.12, HIP_Y, -RECT_Z),
  susHipBL: v3(-0.14, HIP_Y, RECT_Z),
  susHipBR: v3(-0.14, HIP_Y, -RECT_Z),
  // body hoop around the wearer at y = 1.15 (right side first, so the ring's
  // node order puts hoopBL/hoopFR next to the pivot nodes it carries)
  hoopF: v3(0.34, 1.15, 0),
  hoopFR: v3(0.22, 1.15, -0.28),
  hoopBR: v3(-0.26, 1.15, -0.26),
  hoopB: v3(-0.34, 1.15, 0),
  hoopBL: v3(-0.26, 1.15, 0.26),
  hoopFL: v3(0.22, 1.15, 0.28),
  // head boom + jaw (sagittal at rest); mast top ON the pan axis above hoopF
  panBarL: v3(0.34, 1.15, 0.12),
  panBarR: v3(0.34, 1.15, -0.12),
  headMastTop: v3(0.34, 1.55, 0),
  head: v3(0.68, 2.2, 0),
  jawTip: v3(1.02, 2.15, 0),
  jawHeel: v3(0.59, 2.25, 0),
  crest: v3(0.58, 2.36, 0),
  // jaw trigger hardware riding near the beltR anchor
  trigBase: v3(0, 0.93, -0.22),
  trigCasing: v3(0.06, 0.93, -0.22),
  trigger: v3(0.14, 0.93, -0.22),
  // head-pan grip: carrier forward, arm aft (head chain points forward)
  gripPanBase: v3(0.72, 1.0, 0),
  gripPanMid: v3(0.55, 1.0, 0),
  gripPanTip: v3(0.33, 1.0, 0),
  gripPanL: v3(0.55, 1.0, 0.18),
  gripPanR: v3(0.55, 1.0, -0.18),
  // tail-wave grip: carrier aft, arm forward (tail chain points aft)
  gripWaveBase: v3(0.11, 0.95, 0),
  gripWaveMid: v3(0.28, 0.95, 0),
  gripWaveTip: v3(0.5, 0.95, 0),
  gripWaveL: v3(0.28, 0.95, 0.18),
  gripWaveR: v3(0.28, 0.95, -0.18),
  // tail chain: 4 × 0.45 m junction spacing aft of the hoop rear; mast top
  // ON the root pan axis above hoopB
  tailMastTop: v3(-0.34, 1.5, 0),
  tailBar1L: v3(-0.4, 1.15, 0.12),
  tailBar1R: v3(-0.4, 1.15, -0.12),
  tailJ2: v3(-0.79, 1.15, 0),
  tailHorn2: v3(-0.79, 1.4, 0.1),
  tailJ3: v3(-1.24, 1.15, 0),
  tailHorn3: v3(-1.24, 1.4, 0.1),
  tailJ4: v3(-1.69, 1.15, 0),
  tailHorn4: v3(-1.69, 1.4, 0.1),
  tailTip: v3(-2.14, 1.15, 0),
};

/** Signed hinge angle of ray pivot→b measured from the straight continuation
 * of a through pivot, about `axis` — the drawn-pose twin of the solver's
 * angle convention (solver/hinge.ts drawnAngle3), rounded like PITCH_REST in
 * fullCreature.ts so the JSON artifacts stay stable. */
function restAngle(pivot: Vec3, a: Vec3, b: Vec3, axis: Vec3): number {
  const va = v3(pivot.x - a.x, pivot.y - a.y, pivot.z - a.z);
  const vb = v3(b.x - pivot.x, b.y - pivot.y, b.z - pivot.z);
  const cx = va.y * vb.z - va.z * vb.y;
  const cy = va.z * vb.x - va.x * vb.z;
  const cz = va.x * vb.y - va.y * vb.x;
  const theta = Math.atan2(
    cx * axis.x + cy * axis.y + cz * axis.z,
    va.x * vb.x + va.y * vb.y + va.z * vb.z,
  );
  return Math.round(theta * 1e4) / 1e4;
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/** How far the jaw opens below the drawn (closed) pose, radians. */
const JAW_OPEN_RAD = 0.6;

/** Jaw heel position at the fully-open limit: the drawn heel rotated
 * −JAW_OPEN_RAD about the jaw hinge (axis +z) at the head. */
function jawHeelOpen(): Vec3 {
  const c = Math.cos(-JAW_OPEN_RAD);
  const s = Math.sin(-JAW_OPEN_RAD);
  const rx = P.jawHeel!.x - P.head!.x;
  const ry = P.jawHeel!.y - P.head!.y;
  return v3(P.head!.x + c * rx - s * ry, P.head!.y + s * rx + c * ry, P.head!.z);
}

/** Bowden jaw-side rest length: heel→boom-base distance at full open, so the
 * jaw is free to open all the way at trigger 0 (jawBowden pattern). The boom
 * base hoopF sits ON the pan axis, so this length is pan-invariant and the
 * bite drive never fights the head pan. */
export function biteRestLengthB(): number {
  return dist(jawHeelOpen(), P.hoopF!);
}

/** `jaw` channel travel: stop just short of the geometric closed pull so the
 * cable never fights the closed angle limit (jawBowden pattern). */
export function jawChannelMax(): number {
  return round4(biteRestLengthB() - dist(P.jawHeel!, P.hoopF!) - 0.0035);
}

function link(
  id: string,
  nodeA: string,
  nodeB: string,
  tag: string,
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

/** Steer-style grip chain (steer-mirror pattern): anchored carrier, a
 * SLIDING-TELESCOPE arm whose tip is the driven node of `channel`, and welded
 * left/right cross-bars the crossed mirror ropes leave from. The arm points
 * along `armDir` (+1 forward, −1 aft) so each grip opposes the chain it
 * drives and the crossed ropes read "same side as the grip tip". */
function gripChain(
  n: (id: string) => string,
  ids: { base: string; mid: string; tip: string; barL: string; barR: string; pivot: string },
  names: { carrier: string; arm: string; barL: string; barR: string },
  channelId: string,
): MechParts {
  const at = (id: string): Vec3 => P[id]!;
  const elements: MechanismElement[] = [
    link(n(names.carrier), n(ids.base), n(ids.mid), 'drive', PIPE_050),
    {
      id: n(names.arm),
      type: 'telescope',
      maturity: 'engineered',
      subsystemTag: 'drive',
      nodeA: n(ids.mid),
      nodeB: n(ids.tip),
      minLengthM: 0.12,
      maxLengthM: 0.3,
      lengthM: dist(at(ids.mid), at(ids.tip)),
      sliding: true,
      outerPipeMaterialId: PIPE_CLS200_075,
      innerPipeMaterialId: PIPE_CTS_075,
      pointMasses: [],
    },
    link(n(names.barL), n(ids.mid), n(ids.barL), 'drive', PIPE_050),
    link(n(names.barR), n(ids.mid), n(ids.barR), 'drive', PIPE_050),
    {
      id: n(ids.pivot),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'drive',
      nodeId: n(ids.mid),
      joint: { kind: 'hinge', axis: HINGE_PLAN },
      memberIds: [n(names.carrier), n(names.arm), n(names.barL), n(names.barR)],
      welds: [
        [n(names.arm), n(names.barL)],
        [n(names.arm), n(names.barR)],
      ],
      angleLimit: { memberA: n(names.carrier), memberB: n(names.arm), minRad: -0.6, maxRad: 0.6 },
      realization: 'boltThrough',
    },
  ];
  return {
    nodes: [
      { id: n(ids.base), kind: 'anchor', position: at(ids.base) },
      { id: n(ids.mid), kind: 'anchor', position: at(ids.mid) },
      { id: n(ids.tip), kind: 'driven', position: at(ids.tip), channelId },
      { id: n(ids.barL), kind: 'free', position: at(ids.barL) },
      { id: n(ids.barR), kind: 'free', position: at(ids.barR) },
    ],
    elements,
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
  };
}

/** Strap slack over the drawn length: tight enough that the hoop can't wander
 * and eat the crossed-rope drive travel, loose enough to stay a rope, not a
 * weld (the shared-conventions "near-taut strap" with the slack tuned down
 * for the two long cantilevers this costume hangs off the hoop). */
export const STRAP_SLACK_M = 0.004;

/** Slack on the crossed drive ropes so the exact-taut pair doesn't flag
 * `ropesRequiringCompression` while the suspension settles a few millimetres
 * (fullCreature pitch-rope pattern). */
export const DRIVE_ROPE_SLACK_M = 0.002;

/** Body hoop + wearer suspension: bungee carry from the shoulders, near-taut
 * strap ropes from the four hip-rect anchors (rest lengths derived from the
 * drawn geometry: 0.85 × drawn pretension carry, drawn + slack straps). */
function bodyParts(prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const bungee = (
    id: string,
    a: string,
    b: string,
  ): Extract<MechanismElement, { type: 'elastic' }> => ({
    id: n(id),
    type: 'elastic',
    maturity: 'engineered',
    subsystemTag: 'body',
    nodeA: n(a),
    nodeB: n(b),
    slackLengthM: round4(0.85 * dist(P[a]!, P[b]!)),
    stiffnessNPerM: 180,
    cordageMaterialId: BUNGEE_8,
  });
  const strap = (
    id: string,
    a: string,
    b: string,
  ): Extract<MechanismElement, { type: 'rope' }> => ({
    id: n(id),
    type: 'rope',
    maturity: 'engineered',
    subsystemTag: 'body',
    path: [n(a), n(b)],
    lengthM: round4(dist(P[a]!, P[b]!) + STRAP_SLACK_M),
    cordageMaterialId: CORD,
  });
  return {
    nodes: [
      { id: n('susShoulderL'), kind: 'anchor', position: P.susShoulderL! },
      { id: n('susShoulderR'), kind: 'anchor', position: P.susShoulderR! },
      { id: n('susHipFL'), kind: 'anchor', position: P.susHipFL! },
      { id: n('susHipFR'), kind: 'anchor', position: P.susHipFR! },
      { id: n('susHipBL'), kind: 'anchor', position: P.susHipBL! },
      { id: n('susHipBR'), kind: 'anchor', position: P.susHipBR! },
      { id: n('hoopF'), kind: 'free', position: P.hoopF! },
      { id: n('hoopFR'), kind: 'free', position: P.hoopFR! },
      { id: n('hoopBR'), kind: 'free', position: P.hoopBR! },
      { id: n('hoopB'), kind: 'free', position: P.hoopB! },
      { id: n('hoopBL'), kind: 'free', position: P.hoopBL! },
      { id: n('hoopFL'), kind: 'free', position: P.hoopFL! },
    ],
    elements: [
      {
        id: n('hoopRing'),
        type: 'bentLink',
        maturity: 'engineered',
        subsystemTag: 'body',
        nodeIds: [n('hoopF'), n('hoopFR'), n('hoopBR'), n('hoopB'), n('hoopBL'), n('hoopFL')],
        filletRadiiM: [0.08, 0.08, 0.08, 0.08],
        pipeMaterialId: PIPE_075,
        endRealizationA: 'fitting',
        endRealizationB: 'fitting',
        pointMasses: [],
      },
      link(n('hoopClose'), n('hoopFL'), n('hoopF'), 'body', PIPE_050),
      bungee('bungeeFL', 'susShoulderL', 'hoopFL'),
      bungee('bungeeFR', 'susShoulderR', 'hoopFR'),
      bungee('bungeeBL', 'susShoulderL', 'hoopBL'),
      bungee('bungeeBR', 'susShoulderR', 'hoopBR'),
      strap('strapFL', 'susHipFL', 'hoopFL'),
      strap('strapFR', 'susHipFR', 'hoopFR'),
      strap('strapBL', 'susHipBL', 'hoopBL'),
      strap('strapBR', 'susHipBR', 'hoopBR'),
      // ridge spar between the two mast tops + fore/aft diagonals (header note)
      link(n('ridgeSpar'), n('headMastTop'), n('tailMastTop'), 'body', PIPE_050),
      link(n('ridgeDiagF'), n('headMastTop'), n('hoopB'), 'body', PIPE_050),
      link(n('ridgeDiagB'), n('tailMastTop'), n('hoopF'), 'body', PIPE_050),
    ],
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
  };
}

/** Head boom on the pan hinge at the hoop front, jaw at the head. The pan
 * pivot's carrying member is the hoop bentLink (two off-line ties keep the
 * vertical axis rigid to the hoop); the guyed mast + stay carries the boom's
 * pitch (see the header note); the crest post is WELDED to the boom at the
 * jaw pivot, giving the jaw hinge its off-line anti-roll tie. */
function headParts(prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const panRest = restAngle(P.hoopF!, P.hoopFR!, P.head!, HINGE_PLAN);
  const jawRest = restAngle(P.head!, P.hoopF!, P.jawTip!, HINGE_SAGITTAL);
  const elements: MechanismElement[] = [
    { ...link(n('boom'), n('hoopF'), n('head'), 'head', PIPE_075), endRealizationB: 'fitting' },
    // guyed pan mast: post on the axis, tripod-braced to the hoop, rigid
    // stay to the head — pan-invariant pitch support for the long boom
    link(n('headMast'), n('hoopF'), n('headMastTop'), 'head', PIPE_050),
    link(n('headMastBrL'), n('headMastTop'), n('hoopFL'), 'head', PIPE_050),
    link(n('headMastBrR'), n('headMastTop'), n('hoopFR'), 'head', PIPE_050),
    link(n('boomStay'), n('headMastTop'), n('head'), 'head', PIPE_050),
    link(n('panBarLBar'), n('hoopF'), n('panBarL'), 'head', PIPE_050),
    link(n('panBarRBar'), n('hoopF'), n('panBarR'), 'head', PIPE_050),
    {
      id: n('panPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'head',
      nodeId: n('hoopF'),
      joint: { kind: 'hinge', axis: HINGE_PLAN },
      memberIds: [n('hoopRing'), n('boom'), n('panBarLBar'), n('panBarRBar')],
      welds: [
        [n('boom'), n('panBarLBar')],
        [n('boom'), n('panBarRBar')],
      ],
      angleLimit: {
        memberA: n('hoopRing'),
        memberB: n('boom'),
        minRad: round4(panRest - 0.6),
        maxRad: round4(panRest + 0.6),
      },
      realization: 'boltThrough',
    },
    {
      ...link(n('jawMain'), n('head'), n('jawTip'), 'jaw', PIPE_CTS_050),
      endRealizationB: 'heatWrapRigid',
    },
    link(n('jawHeelSpur'), n('head'), n('jawHeel'), 'jaw', PIPE_CTS_050),
    link(n('crestPost'), n('head'), n('crest'), 'head', PIPE_050),
    {
      id: n('jawPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeId: n('head'),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n('boom'), n('jawMain'), n('jawHeelSpur'), n('crestPost')],
      welds: [
        [n('jawMain'), n('jawHeelSpur')],
        [n('boom'), n('crestPost')],
      ],
      angleLimit: {
        memberA: n('boom'),
        memberB: n('jawMain'),
        minRad: round4(jawRest - JAW_OPEN_RAD),
        maxRad: jawRest,
      },
      realization: 'boltThrough',
    },
    // opening elastic: heel pulled toward the crest ⇒ snout drops open
    {
      id: n('openElastic'),
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeA: n('crest'),
      nodeB: n('jawHeel'),
      slackLengthM: 0.06,
      stiffnessNPerM: 150,
      cordageMaterialId: BUNGEE_6,
    },
    // brake-cable bite drive; jaw-side casing end on the pan axis (hoopF)
    {
      id: n('biteCable'),
      type: 'bowden',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      a1: n('trigCasing'),
      a2: n('trigger'),
      b1: n('hoopF'),
      b2: n('jawHeel'),
      restLengthAM: dist(P.trigCasing!, P.trigger!),
      restLengthBM: biteRestLengthB(),
      cordageMaterialId: BOWDEN_CABLE,
    },
  ];
  return {
    nodes: [
      { id: n('panBarL'), kind: 'free', position: P.panBarL! },
      { id: n('panBarR'), kind: 'free', position: P.panBarR! },
      { id: n('headMastTop'), kind: 'free', position: P.headMastTop! },
      { id: n('head'), kind: 'free', position: P.head! },
      { id: n('jawTip'), kind: 'free', position: P.jawTip! },
      { id: n('jawHeel'), kind: 'free', position: P.jawHeel! },
      { id: n('crest'), kind: 'free', position: P.crest! },
    ],
    elements,
    pointMasses: [{ id: n('headMass'), name: 'head', massKg: 0.6, nodeId: n('head') }],
    skeletonBindings: [],
    inputs: [],
  };
}

/** Four-segment tail chain. Segments are bentLinks (see the header note),
 * each ordered so the pivots' tie/lever picks are one FAR chain node (pitch
 * arm) plus one raised horn (roll arm): seg1 runs horn2 → J2 → root → right
 * drive horn (the left horn is a welded bar, roll-braced to horn2), seg2/3
 * run Jk → Jk+1 with the horn appended; seg4 is a bare tip bar (nothing
 * extended hangs off it). Plan hinges at every junction with centering
 * torsion springs, coupled root→tip by torsion cables (ratio 0.8, backlash
 * 0.15); the guyed mast + stay carries the root cantilever's pitch. */
function tailParts(prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const rootRest = restAngle(P.hoopB!, P.hoopBL!, P.tailBar1R!, HINGE_PLAN);
  const flexRest = restAngle(P.tailJ2!, P.hoopB!, P.tailJ3!, HINGE_PLAN);
  const bent = (
    id: string,
    nodeIds: string[],
    material: string,
  ): Extract<MechanismElement, { type: 'bentLink' }> => ({
    id: n(id),
    type: 'bentLink',
    maturity: 'engineered',
    subsystemTag: 'tail',
    nodeIds: nodeIds.map(n),
    filletRadiiM: nodeIds.slice(2).map(() => 0.05),
    pipeMaterialId: material,
    endRealizationA: 'boltThrough',
    endRealizationB: 'boltThrough',
    pointMasses: [],
  });
  const flexPivot = (
    id: string,
    nodeId: string,
    memberA: string,
    memberB: string,
  ): Extract<MechanismElement, { type: 'pivot' }> => ({
    id: n(id),
    type: 'pivot',
    maturity: 'engineered',
    subsystemTag: 'tail',
    nodeId: n(nodeId),
    joint: { kind: 'hinge', axis: HINGE_PLAN },
    memberIds: [n(memberA), n(memberB)],
    welds: [],
    angleLimit: {
      memberA: n(memberA),
      memberB: n(memberB),
      minRad: round4(flexRest - 0.7),
      maxRad: round4(flexRest + 0.7),
    },
    torsionSpring: {
      memberA: n(memberA),
      memberB: n(memberB),
      stiffnessNmPerRad: 3,
      restAngleRad: flexRest,
    },
    realization: 'boltThrough',
  });
  const cable = (
    id: string,
    pivotA: string,
    pivotB: string,
  ): Extract<MechanismElement, { type: 'torsionCable' }> => ({
    id: n(id),
    type: 'torsionCable',
    maturity: 'engineered',
    subsystemTag: 'tail',
    pivotA: n(pivotA),
    pivotB: n(pivotB),
    ratio: 0.8,
    backlashRad: 0.15,
    cordageMaterialId: CORD,
  });
  const elements: MechanismElement[] = [
    // root segment: J2 horn and far chain node ahead of the root in chain
    // order, right drive horn at the tail end of the polyline
    bent('tailSeg1', ['tailHorn2', 'tailJ2', 'hoopB', 'tailBar1R'], PIPE_075),
    bent('tailSeg2', ['tailHorn3', 'tailJ3', 'tailJ2'], PIPE_050),
    bent('tailSeg3', ['tailHorn4', 'tailJ4', 'tailJ3'], PIPE_050),
    link(n('tailSeg4'), n('tailJ4'), n('tailTip'), 'tail', PIPE_050),
    // left drive horn: welded bar, roll-braced to the raised J2 horn
    link(n('tailBar1LBar'), n('hoopB'), n('tailBar1L'), 'tail', PIPE_050),
    link(n('tailBrace1L'), n('tailBar1L'), n('tailHorn2'), 'tail', PIPE_050),
    // guyed root mast: post on the axis, tripod-braced to the hoop, rigid
    // stay to the first junction — pan-invariant pitch support (header note)
    link(n('tailMast'), n('hoopB'), n('tailMastTop'), 'tail', PIPE_050),
    link(n('tailMastBrL'), n('tailMastTop'), n('hoopBL'), 'tail', PIPE_050),
    link(n('tailMastBrR'), n('tailMastTop'), n('hoopBR'), 'tail', PIPE_050),
    link(n('tailStay'), n('tailMastTop'), n('tailJ2'), 'tail', PIPE_050),
    {
      id: n('tailRootPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'tail',
      nodeId: n('hoopB'),
      joint: { kind: 'hinge', axis: HINGE_PLAN },
      memberIds: [n('hoopRing'), n('tailSeg1'), n('tailBar1LBar')],
      welds: [[n('tailSeg1'), n('tailBar1LBar')]],
      angleLimit: {
        memberA: n('hoopRing'),
        memberB: n('tailSeg1'),
        minRad: round4(rootRest - 0.7),
        maxRad: round4(rootRest + 0.7),
      },
      torsionSpring: {
        memberA: n('hoopRing'),
        memberB: n('tailSeg1'),
        stiffnessNmPerRad: 3,
        restAngleRad: rootRest,
      },
      realization: 'boltThrough',
    },
    flexPivot('tailPivot2', 'tailJ2', 'tailSeg1', 'tailSeg2'),
    flexPivot('tailPivot3', 'tailJ3', 'tailSeg2', 'tailSeg3'),
    flexPivot('tailPivot4', 'tailJ4', 'tailSeg3', 'tailSeg4'),
    cable('tailCable12', 'tailRootPivot', 'tailPivot2'),
    cable('tailCable23', 'tailPivot2', 'tailPivot3'),
    cable('tailCable34', 'tailPivot3', 'tailPivot4'),
  ];
  return {
    nodes: [
      { id: n('tailMastTop'), kind: 'free', position: P.tailMastTop! },
      { id: n('tailBar1L'), kind: 'free', position: P.tailBar1L! },
      { id: n('tailBar1R'), kind: 'free', position: P.tailBar1R! },
      { id: n('tailJ2'), kind: 'free', position: P.tailJ2! },
      { id: n('tailHorn2'), kind: 'free', position: P.tailHorn2! },
      { id: n('tailJ3'), kind: 'free', position: P.tailJ3! },
      { id: n('tailHorn3'), kind: 'free', position: P.tailHorn3! },
      { id: n('tailJ4'), kind: 'free', position: P.tailJ4! },
      { id: n('tailHorn4'), kind: 'free', position: P.tailHorn4! },
      { id: n('tailTip'), kind: 'free', position: P.tailTip! },
    ],
    elements,
    pointMasses: [{ id: n('tailTipMass'), name: 'tail tip', massKg: 0.25, nodeId: n('tailTip') }],
    skeletonBindings: [],
    inputs: [],
  };
}

/** Both steer-style grips + their crossed mirror ropes + the jaw trigger
 * slide. Channels: `head pan` and `tail wave` (angle, ±0.5) on the grip
 * tips; `jaw` (displacement) on the trigger. */
function driveParts(prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const rope = (id: string, a: string, b: string): Extract<MechanismElement, { type: 'rope' }> => ({
    id: n(id),
    type: 'rope',
    maturity: 'engineered',
    subsystemTag: 'drive',
    path: [n(a), n(b)],
    lengthM: round4(dist(P[a]!, P[b]!) + DRIVE_ROPE_SLACK_M),
    cordageMaterialId: CORD,
  });
  const panGrip = gripChain(
    n,
    {
      base: 'gripPanBase',
      mid: 'gripPanMid',
      tip: 'gripPanTip',
      barL: 'gripPanL',
      barR: 'gripPanR',
      pivot: 'gripPanPivot',
    },
    { carrier: 'gripPanCarrier', arm: 'gripPanArm', barL: 'gripPanBarL', barR: 'gripPanBarR' },
    'chHeadPan',
  );
  const waveGrip = gripChain(
    n,
    {
      base: 'gripWaveBase',
      mid: 'gripWaveMid',
      tip: 'gripWaveTip',
      barL: 'gripWaveL',
      barR: 'gripWaveR',
      pivot: 'gripWavePivot',
    },
    { carrier: 'gripWaveCarrier', arm: 'gripWaveArm', barL: 'gripWaveBarL', barR: 'gripWaveBarR' },
    'chTailWave',
  );
  const ropesAndTrigger: MechParts = {
    nodes: [
      { id: n('trigBase'), kind: 'anchor', position: P.trigBase! },
      { id: n('trigCasing'), kind: 'anchor', position: P.trigCasing! },
      { id: n('trigger'), kind: 'driven', position: P.trigger!, channelId: 'chJaw' },
    ],
    elements: [
      // the crossed pairs: grip-left rope to chain-right bar and vice versa
      rope('ropePanLtoR', 'gripPanL', 'panBarR'),
      rope('ropePanRtoL', 'gripPanR', 'panBarL'),
      rope('ropeWaveLtoR', 'gripWaveL', 'tailBar1R'),
      rope('ropeWaveRtoL', 'gripWaveR', 'tailBar1L'),
      // the trigger slides on the grip pipe (jawBowden pattern)
      {
        id: n('trigBar'),
        type: 'telescope',
        maturity: 'engineered',
        subsystemTag: 'drive',
        nodeA: n('trigBase'),
        nodeB: n('trigger'),
        minLengthM: 0.08,
        maxLengthM: 0.22,
        lengthM: dist(P.trigBase!, P.trigger!),
        sliding: true,
        outerPipeMaterialId: PIPE_CLS200_075,
        innerPipeMaterialId: PIPE_CTS_075,
        pointMasses: [],
      },
    ],
    pointMasses: [],
    skeletonBindings: [],
    inputs: [
      {
        id: 'chHeadPan',
        name: 'head pan',
        kind: 'angle',
        min: -0.5,
        max: 0.5,
        value: 0,
        locked: false,
      },
      {
        id: 'chTailWave',
        name: 'tail wave',
        kind: 'angle',
        min: -0.5,
        max: 0.5,
        value: 0,
        locked: false,
      },
      {
        id: 'chJaw',
        name: 'jaw',
        kind: 'displacement',
        min: 0,
        max: jawChannelMax(),
        value: 0,
        locked: false,
      },
    ],
  };
  return mergeParts(panGrip, waveGrip, ropesAndTrigger);
}

export interface SerpentCostumeSubsystems {
  body: MechParts;
  head: MechParts;
  tail: MechParts;
  drives: MechParts;
}

export function buildSerpentCostumeSubsystems(prefix = ''): SerpentCostumeSubsystems {
  return {
    body: bodyParts(prefix),
    head: headParts(prefix),
    tail: tailParts(prefix),
    drives: driveParts(prefix),
  };
}

/** The whole costume as one merge unit (compound-document consumers). */
export function buildSerpentCostumeParts(prefix = ''): MechParts {
  const s = buildSerpentCostumeSubsystems(prefix);
  return mergeParts(s.body, s.head, s.tail, s.drives);
}

export function buildSerpentCostumeProject(): Project {
  const s = buildSerpentCostumeSubsystems('');
  const parts = mergeParts(s.body, s.head, s.tail, s.drives);

  const groups: Group[] = [
    groupOf('grp-body', 'Body + suspension', s.body.elements),
    groupOf('grp-head', 'Head + jaw', s.head.elements),
    groupOf('grp-tail', 'Tail chain', s.tail.elements),
    groupOf('grp-drives', 'Drives', s.drives.elements),
  ];

  const mechanism = {
    ...partsMechanism('pan-wave-costume', 'Pan-head + wave-tail rig', parts),
    anchorBindings: [
      { id: 'bindShoulderL', anchor: 'shoulderL' as const, nodeId: 'susShoulderL' },
      { id: 'bindShoulderR', anchor: 'shoulderR' as const, nodeId: 'susShoulderR' },
      { id: 'bindHipFL', anchor: 'hipRectFrontL' as const, nodeId: 'susHipFL' },
      { id: 'bindHipFR', anchor: 'hipRectFrontR' as const, nodeId: 'susHipFR' },
      { id: 'bindHipBL', anchor: 'hipRectBackL' as const, nodeId: 'susHipBL' },
      { id: 'bindHipBR', anchor: 'hipRectBackR' as const, nodeId: 'susHipBR' },
    ],
  };

  // squeeze trigger at the right belt anchor → `jaw` channel (§4.4 control)
  const trigger: Control = {
    id: 'ctrl-jaw-trigger',
    name: 'Jaw trigger',
    type: 'trigger',
    mount: { kind: 'wearerAnchor', anchor: 'beltR' },
    axes: [
      {
        id: 'trig-squeeze',
        name: 'squeeze',
        min: 0,
        max: 1,
        value: 0,
        channelName: 'jaw',
        outMin: 0,
        outMax: jawChannelMax(),
        invert: false,
        locked: false,
      },
    ],
  };

  // full-range head-pan and tail-wave sweeps, phase-shifted by a quarter
  // period — the whole costume S-curves (loop: first/last values equal)
  const slither: ControlClip = {
    name: 'slither',
    durationS: 4,
    loop: true,
    tracks: {
      'head pan': { timesS: [0, 1, 2, 3, 4], values: [0, 0.5, 0, -0.5, 0] },
      'tail wave': { timesS: [0, 1, 2, 3, 4], values: [0.5, 0, -0.5, 0, 0.5] },
    },
  };

  return exampleProject('example-serpent-costume', 'Example — Parade dragon', mechanism, groups, {
    controls: [trigger],
    controlClips: [slither],
  });
}
