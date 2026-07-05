// Bundled example: "winged costume (flap amplifier)" (PLANFILE-fun-costume-
// samples.md, C2). A complete wearable rig in one compound mechanism:
//
//   • Body frame: a rigid triangulated rail box around the wearer at
//     y ≈ 1.25 (corner-welded rails, heat-wrap realization) with a short
//     mast, a shoulder cross bar carrying the wing roots, and nose/tail
//     mounts. Suspended from the shoulders by pretensioned bungees
//     (rest = 0.85 × drawn) in parallel with near-taut shoulder strap
//     webbing, plus straps to the four hip-rect anchors (drawn + 0.01) and
//     diagonal hip straps that catch the aft pendulum swing — the body-frame
//     suspension pattern, attached through anchorBindings so the whole rig
//     rides the wearer.
//   • Wings: one 4-node bentLink spar per side curving out/up to a tip at
//     z ≈ ±1.14 with genuinely non-planar interior vertices (the bend
//     schedule reports a nonzero dihedral). Root hinge axis +x, so the flap
//     sweeps in the frontal y–z plane. The flap drive is a cord from the
//     wearer's hand through the front frame corner (rope eyelet) to the spar
//     0.25 m from the root: swinging the arm back feeds rope out of the
//     eyelet leg and hauls the spar attachment down; swinging forward slacks
//     the cord and the antagonist — a torsion return spring at the root
//     (fiberglass-rod bias, rest at the raised end) plus a lift elastic from
//     the mast top to the spar mid — raises the wing back to its high
//     working pose. Lever amplification root-attach 0.25 m → tip ≈ 0.9 m.
//     (A mast elastic alone cannot return the wing from deep droop: its line
//     wraps under the +x hinge axis and stops restoring — hence the spring.)
//   • Neck + jaw: a condensed neck-truss — forward boom from the nose mount
//     with a sagittal pitch hinge (rope-lashing compliance limits) held up
//     by a taut cord from the mast top (rope-as-limit), plus a keel spar to
//     a crest node so the head cluster cannot roll about the boom line (the
//     anti-roll keel pattern from the full-creature neck). The beak jaw at
//     the boom tip is a welded bar + heel spur: an elastic from the crest
//     pulls the heel up (jaw falls open), a bowden cable from the belt
//     trigger pulls the heel toward the nose mount (jaw closes) on the
//     global `jaw` channel. The bowden's jaw-side casing end is the pitch
//     pivot node itself, so squeezing the trigger is decoupled from pitch.
//   • Tail: an aft boom on a torsion-sprung compliant pivot (tail-boom
//     pattern) with a 0.2 kg tip — passive bounce.
//
// Anti-roll notes: each wing-root hinge lists the shoulder cross bar AND the
// root-to-mast strut as frame-side members, so the hinge's virtual axis
// particle is tied to an off-axis frame point and the pin bracket cannot
// spin about the cross-bar line. The neck pitch hinge does the same with a
// nose strut + mast strut on the frame side and boom + keel spar on the head
// side.
//
// "Storm bird" appears only in the bundled project name (§9 creature-
// agnostic rule); identifiers use body-part/mechanical terms.
import type { AnchorBinding, Control, JointRealization, Project, Vec3 } from '../schema';
import {
  BOWDEN_CABLE,
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
  PIPE_CLS200_075,
  PIPE_CTS_075,
  partsMechanism,
  v3,
} from './shared';

/** Wing-root hinge axis: +x (wearer-front) on BOTH sides, per C2 — the flap
 * sweeps in the frontal y–z plane. */
export const WING_FLAP_AXIS: Vec3 = { x: 1, y: 0, z: 0 };

/** Flap travel relative to the drawn pose, radians about the root hinge:
 * the return spring rests at the raised end; the down-stroke is sized so the
 * hand rope's demand at the arm-swing extremes (±0.7 rad shoulder) stays
 * inside the window — the rope, not the limit, defines the stroke bottom. */
export const WING_UP_RAD = 1.2;
export const WING_DOWN_RAD = 1.05;

/** Jaw opening travel below the drawn (closed) pose; the bowden rest lengths
 * are sized at this angle so the released jaw is free to fall fully open. */
export const JAW_OPEN_RAD = 0.6;

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/** Signed pivot angle at the drawn pose: deviation of (pivot→b) from the
 * straight continuation of (a→pivot), measured about `axis` — the solver's
 * angle-limit convention, recomputed on plain vectors so the builder stays
 * off solver internals. */
function drawnPivotAngle(pivot: Vec3, a: Vec3, b: Vec3, axis: Vec3): number {
  const va = v3(pivot.x - a.x, pivot.y - a.y, pivot.z - a.z);
  const vb = v3(b.x - pivot.x, b.y - pivot.y, b.z - pivot.z);
  const cx = va.y * vb.z - va.z * vb.y;
  const cy = va.z * vb.x - va.x * vb.z;
  const cz = va.x * vb.y - va.y * vb.x;
  const crossDotAxis = cx * axis.x + cy * axis.y + cz * axis.z;
  return Math.atan2(crossDotAxis, va.x * vb.x + va.y * vb.y + va.z * vb.z);
}

// ── drawn geometry ────────────────────────────────────────────────────────
// Wearer rest numbers (DEFAULT_WEARER, 1.75 m): shoulders (0, 1.4315, ±0.23),
// hip-rect anchors x 0.12/−0.14, y 0.9275, z ±0.21, hands (0, 0.8505, ±0.23).
const N = {
  // suspension anchor nodes, drawn exactly at the wearer's rest anchors
  aShoulderL: v3(0, 1.4315, 0.23),
  aShoulderR: v3(0, 1.4315, -0.23),
  aHipFrontL: v3(0.12, 0.9275, 0.21),
  aHipFrontR: v3(0.12, 0.9275, -0.21),
  aHipBackL: v3(-0.14, 0.9275, 0.21),
  aHipBackR: v3(-0.14, 0.9275, -0.21),
  // frame rail box + mast + wing-root cross bar + nose/tail mounts
  frameFrontL: v3(0.18, 1.25, 0.24),
  frameFrontR: v3(0.18, 1.25, -0.24),
  frameBackL: v3(-0.2, 1.25, 0.24),
  frameBackR: v3(-0.2, 1.25, -0.24),
  mastTop: v3(0, 1.62, 0),
  wingRootL: v3(0, 1.44, 0.3),
  wingRootR: v3(0, 1.44, -0.3),
  noseMount: v3(0.24, 1.25, 0),
  tailMount: v3(-0.26, 1.25, 0),
  // neck + beak (sagittal plane, z = 0)
  beakBase: v3(0.68, 1.42, 0),
  crest: v3(0.66, 1.56, 0),
  beakTip: v3(0.9, 1.46, 0),
  jawTip: v3(0.9, 1.43, 0),
  jawHeel: v3(0.62, 1.45, 0),
  // belt-right trigger rail (the trigger CONTROL is mounted at beltR)
  trigBase: v3(0, 0.93, -0.26),
  casingTrig: v3(0.06, 0.93, -0.26),
  trig: v3(0.14, 0.93, -0.26),
  tailTip: v3(-0.9, 1.34, 0),
};

interface WingGeometry {
  side: 'left' | 'right';
  suffix: 'L' | 'R';
  root: Vec3;
  rootOpposite: Vec3;
  elbow: Vec3;
  mid: Vec3;
  tip: Vec3;
  eyelet: Vec3;
  hand: Vec3;
}

function wingGeometry(side: 'left' | 'right'): WingGeometry {
  const s = side === 'left' ? 1 : -1;
  return {
    side,
    suffix: side === 'left' ? 'L' : 'R',
    root: v3(0, 1.44, s * 0.3),
    rootOpposite: v3(0, 1.44, -s * 0.3),
    // 0.255 m from the root hinge — the flap-rope attachment (C2: 0.25 m)
    elbow: v3(0.05, 1.49, s * 0.545),
    mid: v3(0.1, 1.6, s * 0.86),
    tip: v3(0, 1.76, s * 1.14),
    eyelet: v3(0.18, 1.25, s * 0.24), // front frame corner
    hand: v3(0, 0.8505, s * 0.23),
  };
}

/** Bowden jaw-side rest length: the heel–nose distance with the jaw rotated
 * fully open (−JAW_OPEN_RAD about the beak-base hinge), mirroring the
 * jaw-bowden example's openHeelDistance sizing. */
export function openHeelDistanceM(): number {
  const rel = { x: N.jawHeel.x - N.beakBase.x, y: N.jawHeel.y - N.beakBase.y };
  const c = Math.cos(-JAW_OPEN_RAD);
  const s = Math.sin(-JAW_OPEN_RAD);
  const heel = v3(N.beakBase.x + c * rel.x - s * rel.y, N.beakBase.y + s * rel.x + c * rel.y, 0);
  return dist(heel, N.noseMount);
}

/** `jaw` channel max: the cable pull that closes the beak, stopping 4 mm of
 * heel travel short of the drawn (closed) pose so the cable never fights the
 * closed angle limit. */
export function jawChannelMax(): number {
  return round4(openHeelDistanceM() - dist(N.noseMount, N.jawHeel) - 0.004);
}

function link(
  id: string,
  nodeA: string,
  nodeB: string,
  pipeMaterialId: string,
  subsystemTag: string,
  endRealizationA: JointRealization = 'boltThrough',
  endRealizationB: JointRealization = 'boltThrough',
): Extract<MechParts['elements'][number], { type: 'link' }> {
  return {
    id,
    type: 'link',
    maturity: 'engineered',
    subsystemTag,
    nodeA,
    nodeB,
    pipeMaterialId,
    endRealizationA,
    endRealizationB,
    pointMasses: [],
  };
}

// ── body frame + suspension ──────────────────────────────────────────────
// Rigid by triangulation: rail box corners + mast pyramid + wing-root cross
// nodes and nose/tail mounts each strutted to three frame points.
function buildFrameParts(prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const bungee = (
    id: string,
    a: keyof typeof N,
    b: keyof typeof N,
  ): MechParts['elements'][number] => ({
    id: n(id),
    type: 'elastic',
    maturity: 'engineered',
    subsystemTag: 'suspension',
    nodeA: n(a),
    nodeB: n(b),
    restLengthM: round4(0.85 * dist(N[a], N[b])),
    stiffnessNPerM: 120,
    tensionOnly: true,
    cordageMaterialId: BUNGEE_8,
  });
  const strap = (
    id: string,
    a: keyof typeof N,
    b: keyof typeof N,
    slackM: number,
  ): MechParts['elements'][number] => ({
    id: n(id),
    type: 'rope',
    maturity: 'engineered',
    subsystemTag: 'suspension',
    path: [n(a), n(b)],
    lengthM: round4(dist(N[a], N[b]) + slackM),
    cordageMaterialId: CORD,
  });

  return {
    nodes: [
      { id: n('aShoulderL'), kind: 'anchor', position: N.aShoulderL },
      { id: n('aShoulderR'), kind: 'anchor', position: N.aShoulderR },
      { id: n('aHipFrontL'), kind: 'anchor', position: N.aHipFrontL },
      { id: n('aHipFrontR'), kind: 'anchor', position: N.aHipFrontR },
      { id: n('aHipBackL'), kind: 'anchor', position: N.aHipBackL },
      { id: n('aHipBackR'), kind: 'anchor', position: N.aHipBackR },
      { id: n('frameFrontL'), kind: 'free', position: N.frameFrontL },
      { id: n('frameFrontR'), kind: 'free', position: N.frameFrontR },
      { id: n('frameBackL'), kind: 'free', position: N.frameBackL },
      { id: n('frameBackR'), kind: 'free', position: N.frameBackR },
      { id: n('mastTop'), kind: 'free', position: N.mastTop },
      { id: n('wingRootL'), kind: 'free', position: N.wingRootL },
      { id: n('wingRootR'), kind: 'free', position: N.wingRootR },
      { id: n('noseMount'), kind: 'free', position: N.noseMount },
      { id: n('tailMount'), kind: 'free', position: N.tailMount },
    ],
    elements: [
      // corner-welded rail box (heat-wrap rigid corners)
      link(
        n('railFront'),
        n('frameFrontL'),
        n('frameFrontR'),
        PIPE_075,
        'frame',
        'heatWrapRigid',
        'heatWrapRigid',
      ),
      link(
        n('railBack'),
        n('frameBackL'),
        n('frameBackR'),
        PIPE_075,
        'frame',
        'heatWrapRigid',
        'heatWrapRigid',
      ),
      link(
        n('railSideL'),
        n('frameFrontL'),
        n('frameBackL'),
        PIPE_075,
        'frame',
        'heatWrapRigid',
        'heatWrapRigid',
      ),
      link(
        n('railSideR'),
        n('frameFrontR'),
        n('frameBackR'),
        PIPE_075,
        'frame',
        'heatWrapRigid',
        'heatWrapRigid',
      ),
      // mast pyramid
      link(n('mastLegFL'), n('mastTop'), n('frameFrontL'), PIPE_075, 'frame'),
      link(n('mastLegFR'), n('mastTop'), n('frameFrontR'), PIPE_075, 'frame'),
      link(n('mastLegBL'), n('mastTop'), n('frameBackL'), PIPE_075, 'frame'),
      link(n('mastLegBR'), n('mastTop'), n('frameBackR'), PIPE_075, 'frame'),
      // wing-root cross nodes, each strutted to front/back corners + mast
      link(n('rootStrutFrontL'), n('wingRootL'), n('frameFrontL'), PIPE_050, 'frame'),
      link(n('rootStrutBackL'), n('wingRootL'), n('frameBackL'), PIPE_050, 'frame'),
      link(n('rootStrutMastL'), n('wingRootL'), n('mastTop'), PIPE_050, 'frame'),
      link(n('rootStrutFrontR'), n('wingRootR'), n('frameFrontR'), PIPE_050, 'frame'),
      link(n('rootStrutBackR'), n('wingRootR'), n('frameBackR'), PIPE_050, 'frame'),
      link(n('rootStrutMastR'), n('wingRootR'), n('mastTop'), PIPE_050, 'frame'),
      link(n('shoulderCrossBar'), n('wingRootL'), n('wingRootR'), PIPE_075, 'frame'),
      // nose / tail mount brackets (V-struts + mast tie)
      link(n('noseStrutL'), n('noseMount'), n('frameFrontL'), PIPE_050, 'frame'),
      link(n('noseStrutR'), n('noseMount'), n('frameFrontR'), PIPE_050, 'frame'),
      link(n('noseStrutMast'), n('noseMount'), n('mastTop'), PIPE_050, 'frame'),
      link(n('tailStrutL'), n('tailMount'), n('frameBackL'), PIPE_050, 'frame'),
      link(n('tailStrutR'), n('tailMount'), n('frameBackR'), PIPE_050, 'frame'),
      link(n('tailStrutMast'), n('tailMount'), n('mastTop'), PIPE_050, 'frame'),
      // suspension: bungee carry from the shoulders …
      bungee('carryBungeeLF', 'aShoulderL', 'frameFrontL'),
      bungee('carryBungeeLB', 'aShoulderL', 'frameBackL'),
      bungee('carryBungeeRF', 'aShoulderR', 'frameFrontR'),
      bungee('carryBungeeRB', 'aShoulderR', 'frameBackR'),
      // … near-taut shoulder strap webbing in parallel with the bungees, so
      // the nose-heavy frame cannot sink/pitch and detune the flap ropes …
      strap('shoulderStrapLF', 'aShoulderL', 'frameFrontL', 0.005),
      strap('shoulderStrapLB', 'aShoulderL', 'frameBackL', 0.005),
      strap('shoulderStrapRF', 'aShoulderR', 'frameFrontR', 0.005),
      strap('shoulderStrapRB', 'aShoulderR', 'frameBackR', 0.005),
      // … + near-taut straps to the hip rect (stop it riding up or swinging)
      strap('hipStrapFL', 'aHipFrontL', 'frameFrontL', 0.01),
      strap('hipStrapFR', 'aHipFrontR', 'frameFrontR', 0.01),
      strap('hipStrapBL', 'aHipBackL', 'frameBackL', 0.01),
      strap('hipStrapBR', 'aHipBackR', 'frameBackR', 0.01),
      // … + diagonal hip straps that catch the aft pendulum swing the flap
      // ropes would otherwise wind up around the shoulder slings
      strap('hipStrapDiagL', 'aHipFrontL', 'frameBackL', 0.005),
      strap('hipStrapDiagR', 'aHipFrontR', 'frameBackR', 0.005),
    ],
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
  };
}

// ── wings (flap amplifier) ───────────────────────────────────────────────
function buildWingParts(side: 'left' | 'right', prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const g = wingGeometry(side);
  const S = g.suffix;
  const theta0 = round4(drawnPivotAngle(g.root, g.rootOpposite, g.elbow, WING_FLAP_AXIS));
  // Raising the LEFT wing decreases the signed angle (memberA continuation
  // points outboard +z; axis +x); the right wing mirrors, so the same
  // physical window lands on sign-mirrored limits.
  const s = side === 'left' ? 1 : -1;
  const minRad = round4(theta0 - (s > 0 ? WING_UP_RAD : WING_DOWN_RAD));
  const maxRad = round4(theta0 + (s > 0 ? WING_DOWN_RAD : WING_UP_RAD));
  // Return spring biased to the TOP of the stroke: max restoring moment at
  // full droop, zero at the raised end — the deep-stroke recovery a mast-top
  // elastic cannot provide (its line wraps under the +x hinge axis at big
  // droop angles and stops restoring).
  const springRestRad = round4(theta0 - s * WING_UP_RAD);

  return {
    nodes: [
      { id: n(`wingElbow${S}`), kind: 'free', position: g.elbow },
      { id: n(`wingMid${S}`), kind: 'free', position: g.mid },
      { id: n(`wingTip${S}`), kind: 'free', position: g.tip },
      { id: n(`wHand${S}`), kind: 'free', position: g.hand },
    ],
    elements: [
      {
        id: n(`wingSpar${S}`),
        type: 'bentLink',
        maturity: 'engineered',
        subsystemTag: 'wing',
        nodeIds: [n(`wingRoot${S}`), n(`wingElbow${S}`), n(`wingMid${S}`), n(`wingTip${S}`)],
        filletRadiiM: [0.08, 0.08],
        pipeMaterialId: PIPE_050,
        endRealizationA: 'boltThrough',
        endRealizationB: 'boltThrough',
        pointMasses: [],
      },
      {
        id: n(`wingRootPivot${S}`),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'wing',
        nodeId: n(`wingRoot${S}`),
        joint: { kind: 'hinge', axis: WING_FLAP_AXIS },
        // cross bar + mast strut on the frame side: the mast tie is the
        // off-axis anti-roll keel for this hinge (see header)
        memberIds: [n('shoulderCrossBar'), n(`rootStrutMast${S}`), n(`wingSpar${S}`)],
        welds: [],
        angleLimit: { memberA: n('shoulderCrossBar'), memberB: n(`wingSpar${S}`), minRad, maxRad },
        torsionSpring: {
          memberA: n('shoulderCrossBar'),
          memberB: n(`wingSpar${S}`),
          stiffnessNmPerRad: 2,
          restAngleRad: springRestRad,
        },
        realization: 'boltThrough',
      },
      // lift elastic: carries about half the tip weight at the drawn pose
      // and pins the raised wing to its upper limit when the cord is slack
      {
        id: n(`wingLift${S}`),
        type: 'elastic',
        maturity: 'engineered',
        subsystemTag: 'wing',
        nodeA: n('mastTop'),
        nodeB: n(`wingMid${S}`),
        restLengthM: round4(0.52 * dist(N.mastTop, g.mid)),
        stiffnessNPerM: 6,
        tensionOnly: true,
        cordageMaterialId: BUNGEE_8,
      },
      // the flap drive: hand → front-corner eyelet → spar attachment
      {
        id: n(`flapRope${S}`),
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'wing',
        // deliberate 2 cm slack: the raised working pose (spring/gravity
        // balance) stays clear of the cord's taut boundary at rest
        path: [n(`wingElbow${S}`), n(`frameFront${S}`), n(`wHand${S}`)],
        lengthM: round4(dist(g.elbow, g.eyelet) + dist(g.eyelet, g.hand) + 0.02),
        cordageMaterialId: CORD,
      },
    ],
    pointMasses: [
      { id: n(`wingTipMass${S}`), name: 'wing tip', massKg: 0.15, nodeId: n(`wingTip${S}`) },
      // wing skin/ribs distributed along the spar (also mass-conditions the
      // spar's rigid-body cluster so it settles coherently)
      { id: n(`wingRibElbowMass${S}`), name: 'wing rib', massKg: 0.12, nodeId: n(`wingElbow${S}`) },
      { id: n(`wingRibMidMass${S}`), name: 'wing rib', massKg: 0.12, nodeId: n(`wingMid${S}`) },
    ],
    skeletonBindings: [
      { id: n(`bindHand${S}`), point: side === 'left' ? 'handL' : 'handR', nodeId: n(`wHand${S}`) },
    ],
    inputs: [],
  };
}

// ── neck + jaw ───────────────────────────────────────────────────────────
function buildNeckJawParts(prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const pitch0 = drawnPivotAngle(N.noseMount, N.mastTop, N.beakBase, HINGE_SAGITTAL);
  const jaw0 = drawnPivotAngle(N.beakBase, N.noseMount, N.jawTip, HINGE_SAGITTAL);

  return {
    nodes: [
      { id: n('beakBase'), kind: 'free', position: N.beakBase },
      { id: n('crest'), kind: 'free', position: N.crest },
      { id: n('beakTip'), kind: 'free', position: N.beakTip },
      { id: n('jawTip'), kind: 'free', position: N.jawTip },
      { id: n('jawHeel'), kind: 'free', position: N.jawHeel },
      { id: n('trigBase'), kind: 'anchor', position: N.trigBase },
      { id: n('casingTrig'), kind: 'anchor', position: N.casingTrig },
      { id: n('trig'), kind: 'driven', position: N.trig, channelId: 'chJaw' },
    ],
    elements: [
      link(n('neckBoom'), n('noseMount'), n('beakBase'), PIPE_075, 'neck', 'ropeLashing'),
      // keel spar + braces: crest rigid with the boom cluster (anti-roll)
      link(n('keelPost'), n('noseMount'), n('crest'), PIPE_050, 'neck', 'ropeLashing'),
      link(n('keelBraceRoot'), n('crest'), n('beakBase'), PIPE_050, 'neck'),
      link(n('keelBraceTip'), n('crest'), n('beakTip'), PIPE_050, 'neck'),
      link(n('beakUpper'), n('beakBase'), n('beakTip'), PIPE_050, 'neck'),
      link(n('jawBar'), n('beakBase'), n('jawTip'), PIPE_050, 'jaw'),
      link(n('jawHeelSpur'), n('beakBase'), n('jawHeel'), PIPE_050, 'jaw'),
      {
        id: n('neckPitchPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'neck',
        nodeId: n('noseMount'),
        joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
        memberIds: [n('noseStrutL'), n('noseStrutMast'), n('neckBoom'), n('keelPost')],
        welds: [],
        angleLimit: {
          memberA: n('noseStrutMast'),
          memberB: n('neckBoom'),
          minRad: round4(pitch0 - 0.35),
          maxRad: round4(pitch0 + 0.35),
        },
        realization: 'ropeLashing',
      },
      {
        id: n('jawPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'jaw',
        nodeId: n('beakBase'),
        joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
        memberIds: [
          n('neckBoom'),
          n('keelBraceRoot'),
          n('beakUpper'),
          n('jawBar'),
          n('jawHeelSpur'),
        ],
        welds: [
          [n('neckBoom'), n('beakUpper')],
          [n('jawBar'), n('jawHeelSpur')],
        ],
        // min sits past the cable-defined open angle: the bowden, not the
        // hard stop, catches the released jaw (rope-as-limit spirit)
        angleLimit: {
          memberA: n('neckBoom'),
          memberB: n('jawBar'),
          minRad: round4(jaw0 - JAW_OPEN_RAD - 0.05),
          maxRad: round4(jaw0 + 0.02),
        },
        realization: 'boltThrough',
      },
      // hold rope: taut at drawn — the boom rests on it (rope-as-limit)
      {
        id: n('neckHoldRope'),
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'neck',
        path: [n('mastTop'), n('beakBase')],
        lengthM: round4(dist(N.mastTop, N.beakBase) + 0.002),
        cordageMaterialId: CORD,
      },
      // opening elastic: crest pulls the heel up-back, the beak falls open
      {
        id: n('jawOpenElastic'),
        type: 'elastic',
        maturity: 'engineered',
        subsystemTag: 'jaw',
        nodeA: n('crest'),
        nodeB: n('jawHeel'),
        restLengthM: round4(dist(N.crest, N.jawHeel) - 0.067),
        stiffnessNPerM: 120,
        tensionOnly: true,
        cordageMaterialId: BUNGEE_6,
      },
      // brake-cable close: trigger side on the belt rail, jaw side anchored
      // at the pitch pivot node so the bite is decoupled from neck pitch
      {
        id: n('biteCable'),
        type: 'bowden',
        maturity: 'engineered',
        subsystemTag: 'jaw',
        a1: n('casingTrig'),
        a2: n('trig'),
        b1: n('noseMount'),
        b2: n('jawHeel'),
        restLengthAM: dist(N.casingTrig, N.trig),
        restLengthBM: openHeelDistanceM(),
        cordageMaterialId: BOWDEN_CABLE,
      },
      // the trigger slides on a grip rail (sliding telescope)
      {
        id: n('trigRail'),
        type: 'telescope',
        maturity: 'engineered',
        subsystemTag: 'jaw',
        nodeA: n('trigBase'),
        nodeB: n('trig'),
        minLengthM: 0.06,
        maxLengthM: 0.22,
        lengthM: 0.14,
        sliding: true,
        outerPipeMaterialId: PIPE_CLS200_075,
        innerPipeMaterialId: PIPE_CTS_075,
        pointMasses: [],
      },
    ],
    pointMasses: [{ id: n('headMass'), name: 'head', massKg: 0.25, nodeId: n('beakBase') }],
    skeletonBindings: [],
    inputs: [
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
}

// ── tail ─────────────────────────────────────────────────────────────────
function buildTailBoomParts(prefix: string): MechParts {
  const n = (id: string) => prefix + id;
  const tail0 = drawnPivotAngle(N.tailMount, N.mastTop, N.tailTip, HINGE_SAGITTAL);
  return {
    nodes: [{ id: n('tailTip'), kind: 'free', position: N.tailTip }],
    elements: [
      link(n('tailBoom'), n('tailMount'), n('tailTip'), PIPE_050, 'tail', 'nestedSleeve'),
      {
        id: n('tailPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'tail',
        nodeId: n('tailMount'),
        joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
        memberIds: [n('tailStrutL'), n('tailStrutMast'), n('tailBoom')],
        welds: [],
        angleLimit: {
          memberA: n('tailStrutMast'),
          memberB: n('tailBoom'),
          minRad: round4(tail0 - 0.6),
          maxRad: round4(tail0 + 0.6),
        },
        torsionSpring: {
          memberA: n('tailStrutMast'),
          memberB: n('tailBoom'),
          stiffnessNmPerRad: 15,
          restAngleRad: round4(tail0),
        },
        realization: 'nestedSleeve',
      },
    ],
    pointMasses: [{ id: n('tailTipMass'), name: 'tail tip', massKg: 0.2, nodeId: n('tailTip') }],
    skeletonBindings: [],
    inputs: [],
  };
}

/** Wearer suspension (C2 shared convention 1): the grounded frame-side
 * anchor nodes ride the shoulder + hip-rect wearer anchors. */
export function buildWingedCostumeAnchorBindings(prefix = ''): AnchorBinding[] {
  const n = (id: string) => prefix + id;
  return [
    { id: n('abShoulderL'), anchor: 'shoulderL', nodeId: n('aShoulderL') },
    { id: n('abShoulderR'), anchor: 'shoulderR', nodeId: n('aShoulderR') },
    { id: n('abHipFrontL'), anchor: 'hipRectFrontL', nodeId: n('aHipFrontL') },
    { id: n('abHipFrontR'), anchor: 'hipRectFrontR', nodeId: n('aHipFrontR') },
    { id: n('abHipBackL'), anchor: 'hipRectBackL', nodeId: n('aHipBackL') },
    { id: n('abHipBackR'), anchor: 'hipRectBackR', nodeId: n('aHipBackR') },
  ];
}

/** Subsystem contribution, id-prefixable for compound reuse. */
export function buildWingedCostumeParts(prefix = ''): MechParts {
  return mergeParts(
    buildFrameParts(prefix),
    buildWingParts('left', prefix),
    buildWingParts('right', prefix),
    buildNeckJawParts(prefix),
    buildTailBoomParts(prefix),
  );
}

export function buildWingedCostumeProject(): Project {
  const frame = buildFrameParts('');
  const wingL = buildWingParts('left', '');
  const wingR = buildWingParts('right', '');
  const neck = buildNeckJawParts('');
  const tail = buildTailBoomParts('');
  const parts = mergeParts(frame, wingL, wingR, neck, tail);

  const mechanism = {
    ...partsMechanism('winged-costume', 'Winged costume', parts),
    anchorBindings: buildWingedCostumeAnchorBindings(''),
  };

  const groups = [
    groupOf('grp-frame', 'Body frame + suspension', frame.elements),
    groupOf('grp-wing-left', 'Wing (left)', wingL.elements),
    groupOf('grp-wing-right', 'Wing (right)', wingR.elements),
    groupOf('grp-neck-jaw', 'Neck + jaw', neck.elements),
    groupOf('grp-tail', 'Tail', tail.elements),
  ];

  // §4.4 trigger control riding the wearer's right belt anchor: squeeze to
  // close the beak on the global `jaw` channel.
  const trigger: Control = {
    id: 'ctrl-jaw-trigger',
    name: 'Beak trigger',
    type: 'trigger',
    mount: { kind: 'wearerAnchor', anchor: 'beltR' },
    axes: [
      {
        id: 'trigger-squeeze',
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

  return exampleProject('example-winged-costume', 'Example — Storm bird', mechanism, groups, {
    controls: [trigger],
  });
}
