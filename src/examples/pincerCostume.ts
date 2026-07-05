// Bundled example: "pincer costume — twin trigger claws" (C3,
// PLANFILE-fun-costume-samples.md). A complete wearable rig: a wide
// horizontal bent-pipe hoop shell around the wearer (suspended from the
// shoulders by bungee carry and strapped near-taut to the four hip-rect
// anchors via anchorBindings), two forward claw booms on sagittal-axis root
// hinges, each boom marionetted to the wearer's hand through a lift-post
// eyelet rope (hand back = claw rises, hand forward = rope slack and the
// claw settles onto its droop limit), and a trigger-grip pincer at each boom
// tip: fixed jaw welded to the boom, moving jaw on a hinge, opened by an
// elastic and closed by a Bowden cable on the `grip left` / `grip right`
// channels (trigger controls ride the wearer's hands). Two eye-stalk posts
// bobble on sprung spherical bases at the hoop nose. "Crab" appears only in
// the bundled project name, per the creature-agnostic rule.
import type {
  AnchorBinding,
  Control,
  ControlClip,
  Group,
  MechanismElement,
  Project,
  Vec3,
} from '../schema';
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
  PIPE_CTS_050,
  PIPE_CTS_075,
  partsMechanism,
  v3,
} from './shared';

// ── wearer-frame constants (planfile "shared conventions", DEFAULT_WEARER
// 1.75 m): shoulder/hip-rect anchors the suspension binds to, and the rest
// position of the hands the boom ropes are strapped to (shoulderY − (upper
// arm + forearm) = 1.4315 − (0.3255 + 0.2555)). ─────────────────────────────
const SHOULDER_Y = 1.4315;
const HIP_Y = 0.9275;
const HAND_REST_Y = 0.8505;
const HAND_Z = 0.23;

/** Hoop working height — the shell rides at chest level. */
export const HOOP_Y = 1.2;

/** Grip channel travel (m). Two ceilings: the jaws-touching Bowden travel is
 * 0.0362 at the drawn geometry (jawBowden pattern — never fight the closed
 * stop), and the equilibrium warm start projects the whole travel in one
 * constraint step, which above ~0.029 throws the moving jaw across its
 * mirror branch (heel radius 0.072 m). 0.026 closes the gap by ~2/3 with
 * deterministic margin below both. */
export const GRIP_TRAVEL = 0.026;

/** Drawn moving-jaw pose: the claw is drawn fully OPEN, i.e. the closed jaw
 * geometry rotated by −OPEN_ROT about the claw hinge; closing rotates it back
 * by +OPEN_ROT until the jaws meet. */
export const OPEN_ROT = 0.55;

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Rotate a claw-local (x, y) offset about the sagittal (+z) hinge axis. */
const rotZ = (p: { x: number; y: number }, a: number): { x: number; y: number } => ({
  x: r4(p.x * Math.cos(a) - p.y * Math.sin(a)),
  y: r4(p.x * Math.sin(a) + p.y * Math.cos(a)),
});

/** Signed hinge angle about +z, solver convention (hinge.ts drawnAngle3 with
 * axis +z and planar members): deviation of memberB from the straight
 * continuation of memberA through the pivot. */
const angleZ = (va: Vec3, vb: Vec3): number =>
  Math.atan2(va.x * vb.y - va.y * vb.x, va.x * vb.x + va.y * vb.y + va.z * vb.z);

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

// ── shell hoop + suspension ───────────────────────────────────────────────
// Wide horizontal bent-pipe hoop around the wearer (open at the back, closed
// by a rear cross bar), bungee-carried from both shoulders and strapped
// near-taut to the four hip-rect anchors below — the standard body-frame
// suspension pattern expressed with anchorBindings.
const hoopAt = (x: number, z: number): Vec3 => v3(x, HOOP_Y, z);
const SHELL = {
  hoopBackL: hoopAt(-0.28, 0.35),
  hoopSideL: hoopAt(0.02, 0.5),
  hoopFrontL: hoopAt(0.32, 0.3),
  hoopNoseL: hoopAt(0.38, 0.12),
  hoopNoseR: hoopAt(0.38, -0.12),
  hoopFrontR: hoopAt(0.32, -0.3),
  hoopSideR: hoopAt(0.02, -0.5),
  hoopBackR: hoopAt(-0.28, -0.35),
  aShoulderL: v3(0, SHOULDER_Y, 0.23),
  aShoulderR: v3(0, SHOULDER_Y, -0.23),
  aHipFrontL: v3(0.12, HIP_Y, 0.21),
  aHipFrontR: v3(0.12, HIP_Y, -0.21),
  aHipBackL: v3(-0.14, HIP_Y, 0.21),
  aHipBackR: v3(-0.14, HIP_Y, -0.21),
};

export function buildShellParts(): MechParts {
  const bungee = (
    id: string,
    nodeA: keyof typeof SHELL,
    nodeB: keyof typeof SHELL,
  ): Extract<MechanismElement, { type: 'elastic' }> => ({
    id,
    type: 'elastic',
    maturity: 'engineered',
    subsystemTag: 'shell',
    nodeA,
    nodeB,
    // bungee carry: pretensioned to 90% of the drawn hang (body-frame
    // pattern; kept gentle so the standing tension through the hoop stays
    // small and the rest settle reaches the converged gate)
    restLengthM: r4(0.9 * dist(SHELL[nodeA], SHELL[nodeB])),
    stiffnessNPerM: 150,
    tensionOnly: true,
    cordageMaterialId: BUNGEE_8,
  });
  const strap = (
    id: string,
    nodeA: keyof typeof SHELL,
    nodeB: keyof typeof SHELL,
  ): Extract<MechanismElement, { type: 'rope' }> => ({
    id,
    type: 'rope',
    maturity: 'engineered',
    subsystemTag: 'shell',
    path: [nodeA, nodeB],
    // near-taut strap: 1 cm of working slack over the drawn run
    lengthM: r4(dist(SHELL[nodeA], SHELL[nodeB]) + 0.01),
    cordageMaterialId: CORD,
  });

  return {
    nodes: [
      { id: 'aShoulderL', kind: 'anchor', position: SHELL.aShoulderL },
      { id: 'aShoulderR', kind: 'anchor', position: SHELL.aShoulderR },
      { id: 'aHipFrontL', kind: 'anchor', position: SHELL.aHipFrontL },
      { id: 'aHipFrontR', kind: 'anchor', position: SHELL.aHipFrontR },
      { id: 'aHipBackL', kind: 'anchor', position: SHELL.aHipBackL },
      { id: 'aHipBackR', kind: 'anchor', position: SHELL.aHipBackR },
      { id: 'hoopBackL', kind: 'free', position: SHELL.hoopBackL },
      { id: 'hoopSideL', kind: 'free', position: SHELL.hoopSideL },
      { id: 'hoopFrontL', kind: 'free', position: SHELL.hoopFrontL },
      { id: 'hoopNoseL', kind: 'free', position: SHELL.hoopNoseL },
      { id: 'hoopNoseR', kind: 'free', position: SHELL.hoopNoseR },
      { id: 'hoopFrontR', kind: 'free', position: SHELL.hoopFrontR },
      { id: 'hoopSideR', kind: 'free', position: SHELL.hoopSideR },
      { id: 'hoopBackR', kind: 'free', position: SHELL.hoopBackR },
    ],
    elements: [
      {
        id: 'shellHoop',
        type: 'bentLink',
        maturity: 'engineered',
        subsystemTag: 'shell',
        nodeIds: [
          'hoopBackL',
          'hoopSideL',
          'hoopFrontL',
          'hoopNoseL',
          'hoopNoseR',
          'hoopFrontR',
          'hoopSideR',
          'hoopBackR',
        ],
        filletRadiiM: [0.15, 0.12, 0.1, 0.1, 0.12, 0.15],
        pipeMaterialId: PIPE_075,
        endRealizationA: 'heatWrapRigid',
        endRealizationB: 'heatWrapRigid',
        pointMasses: [],
      },
      // rear cross bar closes the hoop behind the wearer
      link('shellCross', 'hoopBackL', 'hoopBackR', 'shell', PIPE_075),
      bungee('suspBungeeFrontL', 'aShoulderL', 'hoopFrontL'),
      bungee('suspBungeeBackL', 'aShoulderL', 'hoopBackL'),
      bungee('suspBungeeFrontR', 'aShoulderR', 'hoopFrontR'),
      bungee('suspBungeeBackR', 'aShoulderR', 'hoopBackR'),
      strap('suspStrapFrontL', 'aHipFrontL', 'hoopFrontL'),
      strap('suspStrapBackL', 'aHipBackL', 'hoopBackL'),
      strap('suspStrapFrontR', 'aHipFrontR', 'hoopFrontR'),
      strap('suspStrapBackR', 'aHipBackR', 'hoopBackR'),
    ],
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
  };
}

/** The suspension's wearer attachments — the whole rig hangs on these. */
export function pincerAnchorBindings(): AnchorBinding[] {
  return [
    { id: 'abShoulderL', anchor: 'shoulderL', nodeId: 'aShoulderL' },
    { id: 'abShoulderR', anchor: 'shoulderR', nodeId: 'aShoulderR' },
    { id: 'abHipFrontL', anchor: 'hipRectFrontL', nodeId: 'aHipFrontL' },
    { id: 'abHipFrontR', anchor: 'hipRectFrontR', nodeId: 'aHipFrontR' },
    { id: 'abHipBackL', anchor: 'hipRectBackL', nodeId: 'aHipBackL' },
    { id: 'abHipBackR', anchor: 'hipRectBackR', nodeId: 'aHipBackR' },
  ];
}

// ── claw boom + trigger pincer (per side) ─────────────────────────────────
export function buildClawParts(side: 'left' | 'right'): MechParts {
  const S = side === 'left' ? 'L' : 'R';
  const s = side === 'left' ? 1 : -1; // wearer-left is +z; right mirrors z
  const n = (id: string) => id + S;

  // boom: bent pipe from the hoop front corner, knee raised off the root→tip
  // chord (the anti-roll keel idea folded into the body itself: the off-line
  // knee is what the hinge machinery ties, so the boom cannot roll about its
  // own line) out to the claw at x ≈ 0.7, z ≈ ±0.55
  const root = hoopAt(0.32, s * 0.3);
  const boomKnee = v3(0.5, 1.3, s * 0.42);
  const clawBase = v3(0.68, 1.16, s * 0.55);
  const eyeMast = v3(0.32, 1.55, s * 0.3);

  // claw-local sagittal geometry at the boom tip (jawBowden layout): drawn
  // fully OPEN = the closed pose rotated by −OPEN_ROT about the claw hinge
  const local = (dx: number, dy: number): Vec3 => v3(clawBase.x + dx, clawBase.y + dy, clawBase.z);
  const movTipRel = rotZ({ x: 0.24, y: 0 }, -OPEN_ROT);
  const movHeelRel = rotZ({ x: -0.065, y: 0.03 }, -OPEN_ROT);
  const fixTip = local(0.24, 0.02);
  const movTip = local(movTipRel.x, movTipRel.y);
  const movHeel = local(movHeelRel.x, movHeelRel.y);
  const crest = local(0.02, 0.16);
  const casingClaw = local(-0.1, -0.09);

  // trigger grip under the hoop front rail (jawBowden sliding-trigger rig)
  const triggerBase = v3(0.25, 0.95, s * 0.35);
  const casingTrigger = v3(0.25, 1.01, s * 0.35);
  const trigger = v3(0.25, 1.09, s * 0.35);

  const wHand = v3(0, HAND_REST_Y, s * HAND_Z);
  const channelId = `chGrip${S}`;
  const channelName = side === 'left' ? 'grip left' : 'grip right';

  // hinge rest angles in the solver's signed-deviation convention; geometry
  // lies in z-normal planes, so left and right share angles and limits
  // (mirror invariance about +z, see legExo.ts)
  const boomRest = r4(
    angleZ(
      v3(root.x - eyeMast.x, root.y - eyeMast.y, 0),
      v3(boomKnee.x - root.x, boomKnee.y - root.y, 0),
    ),
  );
  const clawRest = r4(angleZ(v3(-0.02, -0.16, 0), v3(movTipRel.x, movTipRel.y, 0)));

  const elements: MechanismElement[] = [
    // lift post: eyelet mast welded upright on the hoop corner — the boom
    // rope's high point, and the reference member for the boom droop limits
    link(n('liftPost'), `hoopFront${S}`, n('eyeMast'), 'claw', PIPE_050),
    // diagonal stay: the weld's lever arm at the pivot is short, so the mast
    // gets a real brace to a far hoop point — the anti-roll-keel tie pattern
    // (fullCreature.ts) — making it rigid to the hoop with honest geometry
    link(n('mastStay'), n('eyeMast'), `hoopSide${S}`, 'claw', PIPE_050),
    {
      id: n('boom'),
      type: 'bentLink',
      maturity: 'engineered',
      subsystemTag: 'claw',
      nodeIds: [`hoopFront${S}`, n('boomKnee'), n('clawBase')],
      filletRadiiM: [0.1],
      pipeMaterialId: PIPE_050,
      endRealizationA: 'boltThrough',
      endRealizationB: 'boltThrough',
      pointMasses: [],
    },
    // boom root hinge (axis +z: sagittal pitch) on the hoop front corner
    {
      id: n('boomRootPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'claw',
      nodeId: `hoopFront${S}`,
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: ['shellHoop', n('liftPost'), n('boom')],
      welds: [['shellHoop', n('liftPost')]],
      angleLimit: {
        memberA: n('liftPost'),
        memberB: n('boom'),
        minRad: r4(boomRest - 0.5),
        maxRad: r4(boomRest + 0.95),
      },
      realization: 'boltThrough',
    },
    // marionette tie: hand → lift-post eyelet → boom knee, 2 cm working
    // slack. Swinging the hand back lengthens the hand leg, shortening the
    // knee leg — the claw boom pitches up; hand forward slackens the rope and
    // the claw settles onto its droop limit.
    {
      id: n('boomTieRope'),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'claw',
      path: [n('boomKnee'), n('eyeMast'), n('wHand')],
      lengthM: r4(dist(boomKnee, eyeMast) + dist(eyeMast, wHand) + 0.02),
      cordageMaterialId: CORD,
    },
    {
      ...link(n('fixedJaw'), n('clawBase'), n('fixTip'), 'claw', PIPE_CTS_050),
      endRealizationB: 'heatWrapRigid',
    },
    {
      ...link(n('movJaw'), n('clawBase'), n('movTip'), 'claw', PIPE_CTS_050),
      endRealizationB: 'heatWrapRigid',
    },
    link(n('heelSpur'), n('clawBase'), n('movHeel'), 'claw', PIPE_CTS_050),
    link(n('crestPost'), n('clawBase'), n('crest'), 'claw', PIPE_CTS_050),
    link(n('casingPost'), n('clawBase'), n('casingClaw'), 'claw', PIPE_CTS_050),
    // claw hinge: fixed jaw / crest / casing posts welded to the boom, moving
    // jaw + heel spur welded together and free to swing between the stops
    {
      id: n('clawPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'claw',
      nodeId: n('clawBase'),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [
        n('boom'),
        n('fixedJaw'),
        n('crestPost'),
        n('casingPost'),
        n('movJaw'),
        n('heelSpur'),
      ],
      welds: [
        [n('boom'), n('fixedJaw')],
        [n('boom'), n('crestPost')],
        [n('boom'), n('casingPost')],
        [n('movJaw'), n('heelSpur')],
      ],
      angleLimit: {
        memberA: n('crestPost'),
        memberB: n('movJaw'),
        minRad: r4(clawRest - 0.05),
        maxRad: r4(clawRest + OPEN_ROT), // jaws-touching mechanical stop
      },
      realization: 'boltThrough',
    },
    // opening elastic: heel pulled toward the crest holds the pincer open
    {
      id: n('openElastic'),
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'claw',
      nodeA: n('crest'),
      nodeB: n('movHeel'),
      restLengthM: r4(dist(crest, movHeel) - 0.02),
      stiffnessNPerM: 150,
      tensionOnly: true,
      cordageMaterialId: BUNGEE_6,
    },
    // brake-cable grip drive: squeezing the trigger lengthens the trigger-side
    // run, shortening heel→casing — the pincer closes (jawBowden pattern)
    {
      id: n('gripCable'),
      type: 'bowden',
      maturity: 'engineered',
      subsystemTag: 'claw',
      a1: n('casingTrigger'),
      a2: n('trigger'),
      b1: n('casingClaw'),
      b2: n('movHeel'),
      restLengthAM: dist(casingTrigger, trigger),
      restLengthBM: dist(casingClaw, movHeel),
      cordageMaterialId: BOWDEN_CABLE,
    },
    // the trigger slides on the grip pipe (sliding telescope rail)
    {
      id: n('gripRail'),
      type: 'telescope',
      maturity: 'engineered',
      subsystemTag: 'claw',
      nodeA: n('triggerBase'),
      nodeB: n('trigger'),
      minLengthM: 0.08,
      maxLengthM: 0.2,
      lengthM: dist(triggerBase, trigger),
      sliding: true,
      outerPipeMaterialId: PIPE_CLS200_075,
      innerPipeMaterialId: PIPE_CTS_075,
      pointMasses: [],
    },
  ];

  return {
    nodes: [
      { id: n('eyeMast'), kind: 'free', position: eyeMast },
      { id: n('boomKnee'), kind: 'free', position: boomKnee },
      { id: n('clawBase'), kind: 'free', position: clawBase },
      { id: n('fixTip'), kind: 'free', position: fixTip },
      { id: n('movTip'), kind: 'free', position: movTip },
      { id: n('movHeel'), kind: 'free', position: movHeel },
      { id: n('crest'), kind: 'free', position: crest },
      { id: n('casingClaw'), kind: 'free', position: casingClaw },
      { id: n('wHand'), kind: 'free', position: wHand },
      { id: n('triggerBase'), kind: 'anchor', position: triggerBase },
      { id: n('casingTrigger'), kind: 'anchor', position: casingTrigger },
      { id: n('trigger'), kind: 'driven', position: trigger, channelId },
    ],
    elements,
    pointMasses: [{ id: n('clawPodMass'), name: 'claw pod', massKg: 0.15, nodeId: n('clawBase') }],
    skeletonBindings: [
      { id: n('bindHand'), point: side === 'left' ? 'handL' : 'handR', nodeId: n('wHand') },
    ],
    inputs: [
      {
        id: channelId,
        name: channelName,
        kind: 'displacement',
        min: 0,
        max: GRIP_TRAVEL,
        value: 0,
        locked: false,
      },
    ],
  };
}

// ── eye stalks (per side) ─────────────────────────────────────────────────
// Short posts on the hoop nose, each on a sprung spherical base: a 3-elastic
// nest (two hoop points below, the lift-post eyelet above) recenters the
// weighted tip after any shove — the bobble.
export function buildEyeStalkParts(side: 'left' | 'right'): MechParts {
  const S = side === 'left' ? 'L' : 'R';
  const O = side === 'left' ? 'R' : 'L'; // cross-nest partner side
  const s = side === 'left' ? 1 : -1;
  const n = (id: string) => id + S;

  const tip = v3(0.38, 1.38, s * 0.12);
  const eyeMast = v3(0.32, 1.55, s * 0.3);
  const hoopFront = hoopAt(0.32, s * 0.3);
  const hoopNoseOther = hoopAt(0.38, -s * 0.12);

  const nest = (
    id: string,
    other: string,
    otherPos: Vec3,
  ): Extract<MechanismElement, { type: 'elastic' }> => ({
    id,
    type: 'elastic',
    maturity: 'engineered',
    subsystemTag: 'eyes',
    nodeA: n('eyeTip'),
    nodeB: other,
    restLengthM: dist(tip, otherPos), // neutral at the drawn pose
    // stiff enough that the 0.05 kg tip sags millimetres, not centimetres —
    // the bobble recenters crisply instead of wandering the nest's flat valley
    stiffnessNPerM: 200,
    tensionOnly: true,
    cordageMaterialId: BUNGEE_6,
  });

  return {
    nodes: [{ id: n('eyeTip'), kind: 'free', position: tip }],
    elements: [
      {
        ...link(n('stalk'), `hoopNose${S}`, n('eyeTip'), 'eyes', PIPE_CTS_050),
        endRealizationA: 'ropeLashing',
        endRealizationB: 'heatWrapRigid',
      },
      {
        id: n('stalkBase'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'eyes',
        nodeId: `hoopNose${S}`,
        joint: { kind: 'spherical' },
        memberIds: ['shellHoop', n('stalk')],
        welds: [],
        realization: 'ropeLashing',
      },
      nest(n('nestElasticFront'), `hoopFront${S}`, hoopFront),
      nest(n('nestElasticCross'), `hoopNose${O}`, hoopNoseOther),
      nest(n('nestElasticMast'), `eyeMast${S}`, eyeMast),
    ],
    pointMasses: [{ id: n('eyeTipMass'), name: 'eye tip', massKg: 0.05, nodeId: n('eyeTip') }],
    skeletonBindings: [],
    inputs: [],
  };
}

// ── project ───────────────────────────────────────────────────────────────
export function buildPincerCostumeProject(): Project {
  const shell = buildShellParts();
  const clawLeft = buildClawParts('left');
  const clawRight = buildClawParts('right');
  const eyes = mergeParts(buildEyeStalkParts('left'), buildEyeStalkParts('right'));
  const parts = mergeParts(shell, clawLeft, clawRight, eyes);

  const mechanism = {
    ...partsMechanism('pincer-costume', 'Pincer costume', parts),
    anchorBindings: pincerAnchorBindings(),
  };

  const groups: Group[] = [
    groupOf('grp-shell', 'Shell + suspension', shell.elements),
    groupOf('grp-claw-left', 'Claw (left)', clawLeft.elements),
    groupOf('grp-claw-right', 'Claw (right)', clawRight.elements),
    groupOf('grp-eyes', 'Eye stalks', eyes.elements),
  ];

  // trigger controls riding the wearer's hands (§4.4 mounts)
  const triggerControl = (side: 'left' | 'right'): Control => ({
    id: `ctrl-grip-${side}`,
    name: `Grip trigger (${side})`,
    type: 'trigger',
    mount: { kind: 'wearerAnchor', anchor: side === 'left' ? 'handL' : 'handR' },
    axes: [
      {
        id: `grip-${side}-squeeze`,
        name: 'squeeze',
        min: 0,
        max: 1,
        value: 0,
        channelName: `grip ${side}`,
        outMin: 0,
        outMax: GRIP_TRAVEL,
        invert: false,
        locked: false,
      },
    ],
  });

  // alternating left/right grip closes — composable with any movement clip
  const snapSnap: ControlClip = {
    name: 'snap snap',
    durationS: 4,
    loop: true,
    tracks: {
      'grip left': {
        timesS: [0, 0.4, 1, 1.6, 4],
        values: [0, GRIP_TRAVEL, GRIP_TRAVEL, 0, 0],
      },
      'grip right': {
        timesS: [0, 2, 2.4, 3, 3.6, 4],
        values: [0, 0, GRIP_TRAVEL, GRIP_TRAVEL, 0, 0],
      },
    },
  };

  return exampleProject('example-pincer-costume', 'Example — Crab colossus', mechanism, groups, {
    controls: [triggerControl('left'), triggerControl('right')],
    controlClips: [snapSnap],
  });
}
