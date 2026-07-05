// Bundled example: "full creature" (planfile §9 item 7) — the recreation of
// the reference build (Esmee Kramer's Project Raptor, planfile §1) as ONE
// v7 compound document: every subsystem is a named group inside a single 3D
// mechanism, actually connected in space (PLANFILE-3d-conversion.md).
// "Raptor" appears only in this bundled data (project name), per the §9
// creature-agnostic rule.
//
// The headline is the neck: the former plan-view pan mechanism and the
// elevation pitch mechanism become two REAL stacked joints sharing geometry —
//   • pan  = a hinge with vertical axis at the conduit-box base (panBase):
//     the anchored carrier spar vs the conduit pipe bundle, whose welded
//     left/right cross-bars receive the crossed mirror ropes from the steer
//     handle below;
//   • pitch = a hinge with horizontal (+z at rest) axis at the bundle's
//     front (pitchBase), the rope-lashed compliance joint between bundle and
//     neck boom. Because the pitch hinge's carrying member IS the pan-side
//     bundle, the pitch plane physically rotates with pan — no transform
//     machinery. (A spherical joint here would transmit no pan torque, so
//     the lashing keeps a hinge with its ±0.35 rad compliance limits; the
//     spherical showcase lives at the arm's rope-lashed hang instead.)
// The legs are mirror-duplicated real geometry (left/right copies across
// z = 0); the arm hangs from the front frame on a SPHERICAL rope-lashed
// pivot (§1 item 9) with the reel-up rope; jaw, tail, spine, yoke control
// and the head-sweep control clip carry over from the per-example builders.
import type { Control, ControlClip, Group, PointMass, Project } from '../schema';
import { buildJawBowdenParts } from './jawBowden';
import { buildLegExoParts } from './legExo';
import { buildSeesawSpineParts } from './seesawSpine';
import {
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
  PIPE_CTS_075,
  partsMechanism,
  v3,
} from './shared';
import { buildSteerChainParts } from './steerMirror';
import { buildTailParts } from './tailBoom';

// ── neck: pan × pitch as real stacked 3D joints ─────────────────────────
const N = {
  mount: v3(0.02, 1.43, 0),
  panBase: v3(0.19, 1.43, 0), // conduit-box base = pan bearing
  barL: v3(0.19, 1.43, 0.07),
  barR: v3(0.19, 1.43, -0.07),
  pitchBase: v3(0.4, 1.43, 0), // bundle front = pitch lashing
  head: v3(0.95, 1.72, 0),
  mastTop: v3(0.05, 1.55, 0),
  chinGuide: v3(0.28, 1.25, 0),
  handleBase: v3(0.25, 0.85, 0),
  pull: v3(0.25, 1.0, 0),
};

/** Rest deviation of the boom from the bundle axis about the pitch hinge;
 * the ±0.35 rad lashing compliance brackets it. */
const PITCH_REST =
  Math.round(Math.atan2(N.head.y - N.pitchBase.y, N.head.x - N.pitchBase.x) * 1e4) / 1e4;

export function buildNeckPanPitchParts(prefix = 'neck.'): MechParts {
  const n = (id: string) => prefix + id;
  return {
    nodes: [
      { id: n('mount'), kind: 'anchor', position: N.mount },
      { id: n('panBase'), kind: 'anchor', position: N.panBase },
      { id: n('barL'), kind: 'free', position: N.barL },
      { id: n('barR'), kind: 'free', position: N.barR },
      { id: n('pitchBase'), kind: 'free', position: N.pitchBase },
      { id: n('head'), kind: 'free', position: N.head },
      { id: n('mastTop'), kind: 'anchor', position: N.mastTop },
      { id: n('chinGuide'), kind: 'anchor', position: N.chinGuide },
      { id: n('handleBase'), kind: 'anchor', position: N.handleBase },
      { id: n('pull'), kind: 'driven', position: N.pull, channelId: 'chSteerPitch' },
    ],
    elements: [
      {
        id: n('carrier'),
        type: 'link',
        maturity: 'engineered',
        subsystemTag: 'neck',
        nodeA: n('mount'),
        nodeB: n('panBase'),
        pipeMaterialId: PIPE_075,
        endRealizationA: 'fitting',
        endRealizationB: 'boltThrough',
        pointMasses: [],
      },
      // the three-pipe conduit bundle — now the pan arm carrying the pitch
      {
        id: n('bundleCore'),
        type: 'link',
        maturity: 'engineered',
        subsystemTag: 'neck',
        nodeA: n('panBase'),
        nodeB: n('pitchBase'),
        pipeMaterialId: PIPE_075,
        endRealizationA: 'conduitBox',
        endRealizationB: 'ropeLashing',
        pointMasses: [],
      },
      {
        id: n('barLBar'),
        type: 'link',
        maturity: 'engineered',
        subsystemTag: 'neck',
        nodeA: n('panBase'),
        nodeB: n('barL'),
        pipeMaterialId: PIPE_050,
        endRealizationA: 'boltThrough',
        endRealizationB: 'boltThrough',
        pointMasses: [],
      },
      {
        id: n('barRBar'),
        type: 'link',
        maturity: 'engineered',
        subsystemTag: 'neck',
        nodeA: n('panBase'),
        nodeB: n('barR'),
        pipeMaterialId: PIPE_050,
        endRealizationA: 'boltThrough',
        endRealizationB: 'boltThrough',
        pointMasses: [],
      },
      {
        id: n('boom'),
        type: 'link',
        maturity: 'engineered',
        subsystemTag: 'neck',
        nodeA: n('pitchBase'),
        nodeB: n('head'),
        pipeMaterialId: PIPE_075,
        endRealizationA: 'ropeLashing',
        endRealizationB: 'boltThrough',
        pointMasses: [],
      },
      // PAN: vertical-axis hinge at the conduit-box base; the bundle and its
      // welded cross-bars rotate against the anchored carrier spar
      {
        id: n('panPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'neck',
        nodeId: n('panBase'),
        joint: { kind: 'hinge', axis: HINGE_PLAN },
        memberIds: [n('carrier'), n('bundleCore'), n('barLBar'), n('barRBar')],
        welds: [
          [n('bundleCore'), n('barLBar')],
          [n('bundleCore'), n('barRBar')],
        ],
        angleLimit: { memberA: n('carrier'), memberB: n('bundleCore'), minRad: -0.6, maxRad: 0.6 },
        realization: 'conduitBox',
      },
      // PITCH: horizontal-axis hinge carried by the pan-side bundle — the
      // rope-lashed compliance joint; rotates with pan because its carrying
      // member is pan-side geometry
      {
        id: n('pitchPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'neck',
        nodeId: n('pitchBase'),
        joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
        memberIds: [n('bundleCore'), n('boom')],
        welds: [],
        angleLimit: {
          memberA: n('bundleCore'),
          memberB: n('boom'),
          minRad: Math.round((PITCH_REST - 0.35) * 1e4) / 1e4,
          maxRad: Math.round((PITCH_REST + 0.35) * 1e4) / 1e4,
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
        restLengthM: 0.65,
        stiffnessNPerM: 185,
        tensionOnly: true,
        cordageMaterialId: BUNGEE_8,
      },
      // the steer grip slides on the handle pipe (sliding telescope rail)
      {
        id: n('zHandle'),
        type: 'telescope',
        maturity: 'engineered',
        subsystemTag: 'neck',
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
      // the up/down rope pair pinning head pitch to the grip position
      {
        id: n('pitchRopeDown'),
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'neck',
        path: [n('pull'), n('chinGuide'), n('head')],
        lengthM: dist(N.pull, N.chinGuide) + dist(N.chinGuide, N.head) + 0.002,
        cordageMaterialId: CORD,
      },
      {
        id: n('pitchRopeUp'),
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'neck',
        path: [n('pull'), n('handleBase'), n('mastTop'), n('head')],
        lengthM:
          dist(N.pull, N.handleBase) +
          dist(N.handleBase, N.mastTop) +
          dist(N.mastTop, N.head) +
          0.002,
        cordageMaterialId: CORD,
      },
    ],
    pointMasses: [{ id: n('headMass'), name: 'head', massKg: 1.2, nodeId: n('head') }],
    skeletonBindings: [],
    inputs: [
      {
        id: 'chSteerPitch',
        name: 'steer pitch',
        kind: 'displacement',
        min: -0.03,
        max: 0.015,
        value: 0,
        locked: false,
      },
    ],
  };
}

// ── steer handle + crossed mirror ropes to the neck's pan bars ──────────
/** Steer pan pivot position: a horizontal handle deck at grip height, aft of
 * the conduit box. Chain points aft, neck bundle points forward, ropes
 * crossed — the head pans to the same side as the steer tip (§9 item 3). */
const STEER_AT = v3(0.43, 1.1, 0);

function buildSteerRopesParts(steerPrefix: string, neckPrefix: string): MechParts {
  const sL = v3(STEER_AT.x, STEER_AT.y, STEER_AT.z + 0.07);
  const sR = v3(STEER_AT.x, STEER_AT.y, STEER_AT.z - 0.07);
  return {
    nodes: [],
    elements: [
      {
        id: `${steerPrefix}ropeCrossLtoR`,
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'steer',
        path: [`${steerPrefix}sL`, `${neckPrefix}barR`],
        lengthM: dist(sL, N.barR),
        cordageMaterialId: CORD,
      },
      {
        id: `${steerPrefix}ropeCrossRtoL`,
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'steer',
        path: [`${steerPrefix}sR`, `${neckPrefix}barL`],
        lengthM: dist(sR, N.barL),
        cordageMaterialId: CORD,
      },
    ],
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
  };
}

// ── arm: single pipe pair hung from the front frame (§1 item 9) ─────────
const A = {
  mountRoot: v3(0.18, 1.32, -0.23),
  armMount: v3(0.18, 1.25, -0.23),
  reelMount: v3(0.1, 1.45, -0.23),
  armElbow: v3(0.3, 0.95, -0.23),
  armHand: v3(0.52, 0.72, -0.23),
};

export function buildArmParts(prefix = 'arm.'): MechParts {
  const n = (id: string) => prefix + id;
  const link = (
    id: string,
    nodeA: string,
    nodeB: string,
  ): Extract<MechParts['elements'][number], { type: 'link' }> => ({
    id,
    type: 'link',
    maturity: 'engineered',
    subsystemTag: 'arm',
    nodeA,
    nodeB,
    pipeMaterialId: PIPE_050,
    endRealizationA: 'heatWrapPivot',
    endRealizationB: 'heatWrapPivot',
    pointMasses: [],
  });

  return {
    nodes: [
      { id: n('mountRoot'), kind: 'anchor', position: A.mountRoot },
      { id: n('armMount'), kind: 'anchor', position: A.armMount },
      { id: n('reelMount'), kind: 'anchor', position: A.reelMount },
      { id: n('armElbow'), kind: 'free', position: A.armElbow },
      { id: n('armHand'), kind: 'free', position: A.armHand },
    ],
    elements: [
      { ...link(n('armStub'), n('mountRoot'), n('armMount')), endRealizationA: 'boltThrough' },
      link(n('armUpper'), n('armMount'), n('armElbow')),
      link(n('armFore'), n('armElbow'), n('armHand')),
      // the rope-lashed HANG from the original build: multi-DOF, so a
      // spherical pivot — the v7 joint kind showcase
      {
        id: n('shoulderLash'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'arm',
        nodeId: n('armMount'),
        joint: { kind: 'spherical' },
        memberIds: [n('armStub'), n('armUpper')],
        welds: [],
        realization: 'ropeLashing',
      },
      {
        id: n('armElbowPivot'),
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'arm',
        nodeId: n('armElbow'),
        joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
        memberIds: [n('armUpper'), n('armFore')],
        welds: [],
        angleLimit: { memberA: n('armUpper'), memberB: n('armFore'), minRad: -0.1, maxRad: 2 },
        realization: 'heatWrapPivot',
      },
      {
        id: n('armReelRope'),
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'arm',
        path: [n('armHand'), n('reelMount')],
        lengthM: dist(A.armHand, A.reelMount) + 0.15,
        cordageMaterialId: CORD,
      },
    ],
    pointMasses: [{ id: n('armClawMass'), name: 'arm claw', massKg: 0.12, nodeId: n('armHand') }],
    // the puppet hand rides the wearer's right hand, so the walk clip's arm
    // swing animates the arm in every panel (§7.3)
    skeletonBindings: [{ id: n('bindArmHand'), point: 'handR', nodeId: n('armHand') }],
    inputs: [],
  };
}

export function buildFullCreatureProject(): Project {
  const spine = buildSeesawSpineParts('spine.');
  const neck = buildNeckPanPitchParts('neck.');
  const steer = mergeParts(
    buildSteerChainParts('steer.', STEER_AT),
    buildSteerRopesParts('steer.', 'neck.'),
  );
  const jaw = buildJawBowdenParts('jaw.');
  const legLeft = buildLegExoParts('left', 'legL.');
  const legRight = buildLegExoParts('right', 'legR.');
  const tail = buildTailParts('tail.');
  const arm = buildArmParts('arm.');

  const parts = mergeParts(spine, neck, steer, jaw, legLeft, legRight, tail, arm);

  const groups: Group[] = [
    groupOf('grp-spine', 'Spine', spine.elements),
    groupOf('grp-neck', 'Neck (pan × pitch)', neck.elements),
    groupOf('grp-steer', 'Steer', steer.elements),
    groupOf('grp-jaw', 'Jaw + Bowden', jaw.elements),
    groupOf('grp-leg-left', 'Leg (left)', legLeft.elements),
    groupOf('grp-leg-right', 'Leg (right)', legRight.elements),
    groupOf('grp-tail', 'Tail', tail.elements),
    groupOf('grp-arm', 'Arm', arm.elements),
  ];

  // body-carried masses at project level (v7): wearer-anchor riders plus the
  // head foam / tail counterweight hanging on spine nodes
  const pointMasses: PointMass[] = [
    {
      id: 'speakerMass',
      name: 'speaker',
      massKg: 0.35,
      attach: { kind: 'wearerAnchor', anchor: 'spineTop' },
    },
    {
      id: 'batteryMass',
      name: 'battery pack',
      massKg: 0.55,
      attach: { kind: 'wearerAnchor', anchor: 'beltBack' },
    },
    {
      id: 'headFoamMass',
      name: 'head + foam',
      massKg: 0.6,
      attach: { kind: 'node', nodeId: 'spine.head' },
    },
    {
      id: 'tailCounterweightMass',
      name: 'tail counterweight',
      massKg: 0.5,
      attach: { kind: 'node', nodeId: 'spine.tail' },
    },
  ];

  // §4.4 yoke: the operator's right hand holds a yoke whose tilt pitches the
  // head, twist pans it, and trigger works the jaw — three axes onto the three
  // input channels, riding hand.R through the walk clip.
  const yoke: Control = {
    id: 'ctrl-yoke',
    name: 'Head yoke',
    type: 'yoke',
    mount: { kind: 'wearerAnchor', anchor: 'handR' },
    axes: [
      {
        id: 'yoke-tilt',
        name: 'tilt',
        min: -1,
        max: 1,
        value: 0,
        channelName: 'steer pitch',
        outMin: -0.03,
        outMax: 0.015,
        invert: false,
        locked: false,
      },
      {
        id: 'yoke-twist',
        name: 'twist',
        min: -1,
        max: 1,
        value: 0,
        channelName: 'steer pan',
        outMin: -0.5,
        outMax: 0.5,
        invert: false,
        locked: false,
      },
      {
        id: 'yoke-trigger',
        name: 'trigger',
        min: 0,
        max: 1,
        value: 0,
        channelName: 'jaw trigger',
        outMin: 0,
        outMax: 0.038,
        invert: false,
        locked: false,
      },
    ],
  };

  // §9 item 7 head-sweep + jaw-snap: a looping control clip that pans the head
  // side to side and snaps the jaw, composable with the walk movement clip.
  const headSweep: ControlClip = {
    name: 'head sweep + jaw snap',
    durationS: 4,
    loop: true,
    tracks: {
      'steer pan': { timesS: [0, 1, 2, 3, 4], values: [0, 0.5, 0, -0.5, 0] },
      'jaw trigger': { timesS: [0, 1, 2, 3, 4], values: [0, 0.038, 0, 0.038, 0] },
    },
  };

  return exampleProject(
    'example-full-creature',
    'Example — Raptor (full creature)',
    partsMechanism('full-creature', 'Full creature', parts),
    groups,
    { pointMasses, controls: [yoke], controlClips: [headSweep] },
  );
}
