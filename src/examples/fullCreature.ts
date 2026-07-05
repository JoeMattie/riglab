// Bundled example: "full creature" (planfile §9 item 7) — the recreation of
// the reference build (Esmee Kramer's Project Raptor, planfile §1) as one
// project: seesaw spine, neck truss, steer mirror, jaw + Bowden, both leg
// exoskeletons, tail, and the two arms, plus speaker/battery point masses on
// the wearer. The global BOM and weight rollup populate from all mechanisms.
//
// DEFERRED until Phases 4/4.5 exist (see DECISIONS.md): 3D instance
// placement/mirroring of these mechanisms on the wearer, the yoke control
// (§4.4), and the bundled head-sweep + jaw-snap control clip — the schema
// for controls and the assembly UI are not built yet. "Raptor" appears only
// in this bundled data (project name), per the §9 creature-agnostic rule.
import type { Assembly, Mechanism, MechanismElement, Project, Vec2 } from '../schema';
import { buildJawBowdenMechanism } from './jawBowden';
import { buildLegExoMechanism } from './legExo';
import { buildNeckTrussMechanism } from './neckTruss';
import { buildSeesawSpineProject } from './seesawSpine';
import { CORD, dist, exampleProject, PIPE_050 } from './shared';
import { buildSteerMirrorMechanism } from './steerMirror';
import { buildTailMechanism } from './tailBoom';

const A: Record<string, Vec2> = {
  armMount: { x: 0.18, y: 1.25 },
  reelMount: { x: 0.1, y: 1.45 },
  armElbow: { x: 0.3, y: 0.95 },
  armHand: { x: 0.52, y: 0.72 },
};

/** §1 item 9: single pipe with one joint each, hung from the front conduit
 * box, with a rope to reel them up before setting the costume down. */
export function buildArmsMechanism(): Mechanism {
  const link = (
    id: string,
    nodeA: string,
    nodeB: string,
  ): Extract<MechanismElement, { type: 'link' }> => ({
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
    id: 'arms',
    name: 'Arms',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes: [
      { id: 'armMount', kind: 'anchor', position: A.armMount! },
      { id: 'reelMount', kind: 'anchor', position: A.reelMount! },
      { id: 'armElbow', kind: 'free', position: A.armElbow! },
      { id: 'armHand', kind: 'free', position: A.armHand! },
    ],
    elements: [
      link('armUpper', 'armMount', 'armElbow'),
      link('armFore', 'armElbow', 'armHand'),
      {
        id: 'armElbowPivot',
        type: 'pivot',
        maturity: 'engineered',
        subsystemTag: 'arm',
        nodeId: 'armElbow',
        memberIds: ['armUpper', 'armFore'],
        welds: [],
        angleLimit: { memberA: 'armUpper', memberB: 'armFore', minRad: -0.1, maxRad: 2 },
        realization: 'heatWrapPivot',
      },
      {
        id: 'armReelRope',
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: 'arm',
        path: ['armHand', 'reelMount'],
        lengthM: dist(A.armHand!, A.reelMount!) + 0.15,
        cordageMaterialId: CORD,
      },
    ],
    pointMasses: [{ id: 'armClawMass', name: 'arm claw', massKg: 0.12, nodeId: 'armHand' }],
    // the puppet hand rides the wearer's right hand, so the walk clip's arm
    // swing animates the arm in 2D and in the 3D assembly (§7.3, Phase 4).
    skeletonBindings: [{ id: 'bindArmHand', point: 'handR', nodeId: 'armHand' }],
    inputs: [],
    namedStates: [],
  };
}

export function buildFullCreatureProject(): Project {
  const mechanisms: Mechanism[] = [
    buildSeesawSpineProject().mechanisms[0]!,
    buildNeckTrussMechanism(),
    buildSteerMirrorMechanism(),
    buildJawBowdenMechanism(),
    buildLegExoMechanism('left'),
    buildLegExoMechanism('right'),
    buildTailMechanism(),
    buildArmsMechanism(),
  ];

  // Instance placement (§4.3/§5.4). Sagittal (side-*) mechanisms lift local
  // (x,y) straight into the world x-y plane (identity, z=0) since their 2D
  // coordinates are already true-scale about the wearer. The right leg reuses
  // the same body plane but its mechanism is authored in the side-right view
  // (x flips), so `mirror` restores world +x while position.z drops it onto the
  // right hip. The plan-view steer mechanism rotates +90° about x so its 2D y
  // becomes world z (a horizontal deck at shoulder height).
  const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
  const YAW_X_90 = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  const hipHalf = 0.18; // ≈ DEFAULT_WEARER.hipWidthM / 2
  const shoulderHalf = 0.23; // ≈ DEFAULT_WEARER.shoulderWidthM / 2
  const shoulderY = 1.43; // ≈ shoulder height for the plan-view deck

  const assembly: Assembly = {
    instances: [
      {
        id: 'inst-spine',
        name: 'Seesaw spine',
        mechanismId: 'seesaw-spine',
        position: { x: 0, y: 0, z: 0 },
        quaternion: IDENTITY,
        mirror: false,
        transformDrive: { kind: 'fixed' },
      },
      {
        id: 'inst-neck',
        name: 'Neck truss',
        mechanismId: 'neck-truss',
        position: { x: 0, y: 0, z: 0 },
        quaternion: IDENTITY,
        mirror: false,
        transformDrive: { kind: 'fixed' },
      },
      {
        id: 'inst-jaw',
        name: 'Jaw + Bowden',
        mechanismId: 'jaw-bowden',
        position: { x: 0, y: 0, z: 0 },
        quaternion: IDENTITY,
        mirror: false,
        transformDrive: { kind: 'fixed' },
      },
      {
        id: 'inst-steer',
        name: 'Steer mirror',
        mechanismId: 'steer-mirror',
        position: { x: 0, y: shoulderY, z: 0 },
        quaternion: YAW_X_90,
        mirror: false,
        transformDrive: { kind: 'fixed' },
      },
      {
        id: 'inst-tail',
        name: 'Tail',
        mechanismId: 'tail-boom',
        position: { x: 0, y: 0, z: 0 },
        quaternion: IDENTITY,
        mirror: false,
        transformDrive: { kind: 'fixed' },
      },
      {
        id: 'inst-leg-left',
        name: 'Leg (left)',
        mechanismId: 'leg-exo-left',
        position: { x: 0, y: 0, z: hipHalf },
        quaternion: IDENTITY,
        mirror: false,
        transformDrive: { kind: 'fixed' },
      },
      {
        id: 'inst-leg-right',
        name: 'Leg (right)',
        mechanismId: 'leg-exo-right',
        position: { x: 0, y: 0, z: -hipHalf },
        quaternion: IDENTITY,
        mirror: true,
        transformDrive: { kind: 'fixed' },
      },
      {
        id: 'inst-arm',
        name: 'Arm',
        mechanismId: 'arms',
        position: { x: 0, y: 0, z: -shoulderHalf },
        quaternion: IDENTITY,
        mirror: false,
        transformDrive: { kind: 'fixed' },
      },
    ],
    bindings: [],
    pointMasses: [
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
        id: 'headMass',
        name: 'head + foam',
        massKg: 0.6,
        attach: { kind: 'instanceNode', instanceId: 'inst-spine', nodeId: 'head' },
      },
      {
        id: 'tailMass',
        name: 'tail counterweight',
        massKg: 0.5,
        attach: { kind: 'instanceNode', instanceId: 'inst-spine', nodeId: 'tail' },
      },
    ],
    foamPlates: [],
  };

  return exampleProject(
    'example-full-creature',
    'Example — Raptor (full creature)',
    mechanisms,
    assembly,
  );
}
