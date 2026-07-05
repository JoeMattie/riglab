// Bundled example: "tail gimbal (wag × lift)" (PLANFILE-3d-raptor-samples.md
// example 10). Stacked NON-parallel hinges: a vertical-axis WAG pivot at the
// carrier's end turns the whole tail cluster left/right, and a horizontal
// LIFT pivot carried by the wag-side member raises/drops the boom — the
// neck's pan × pitch trick applied aft, so lift physically rides wag.
//
// Wag: the pivot node (tailBase) is ANCHORED, so the wag axis is frame-
// pinned (the ground-hinge rule, solver/hinge.ts) — the same pattern as the
// steer-mirror pan joints — and the welded cross-bars give the drive ropes
// their lever arms. The wag grip is a driven node sliding LATERALLY on a
// telescope rail AFT of the bars: moving the grip wearer-left engages the
// rope to the RIGHT bar tip (the crossed, contralateral action of the steer
// example's rope pair), rotating the cluster so the tail tip swings to the
// SAME side as the grip. Each rope carries 2 mm of slack: a straight rail
// cannot keep both ropes of a crossed pair exactly taut through travel —
// without the slack the pair fights itself and the solve cannot close.
//
// Lift: hinge axis +z at rest, members [tailRoot, boom1, keelPost]. The
// anti-roll keel from fullCreature.ts applies verbatim: a hinge carried by
// a 2-node bar keeps a bracket-spin DOF about the bar's own line, so the
// keel post over the lashing — braced to the wag bar tips, rigid to the WAG
// cluster, not the world — ties the lift axis to an off-line point while
// still riding the wag joint. A rope from a second sliding grip over the
// mast to the boom joint drives lift: slack lets the tail sag onto its
// springs, pull raises it. The compliant torsion-sprung joint at j1 is the
// tail example's hose-flex pattern (tailBoom.ts).
import type { ControlClip, MechanismElement, Project, Vec3 } from '../schema';
import {
  CORD,
  dist,
  exampleProject,
  groupOf,
  type MechParts,
  PIPE_050,
  PIPE_075,
  PIPE_CLS200_075,
  PIPE_CTS_075,
  partsMechanism,
  v3,
} from './shared';

const P: Record<string, Vec3> = {
  carrierMount: v3(-0.1, 1.05, 0),
  tailBase: v3(-0.26, 1.05, 0),
  wagL: v3(-0.26, 1.05, 0.09),
  wagR: v3(-0.26, 1.05, -0.09),
  liftBase: v3(-0.5, 1.05, 0),
  keelTop: v3(-0.5, 1.25, 0),
  j1: v3(-0.8, 1.02, 0),
  tailTip: v3(-1.1, 0.98, 0),
  liftMast: v3(-0.1, 1.35, 0),
  liftGripBase: v3(-0.1, 1.13, 0),
  liftPull: v3(-0.1, 1.25, 0),
  wagGripBase: v3(-0.44, 0.82, -0.14),
  wagPull: v3(-0.44, 0.82, 0),
};

/** Crossed-pair slack per wag rope (see header). */
const WAG_ROPE_SLACK_M = 0.002;

/** Drawn rest deviation of boom1 from the tailRoot continuation about the
 * lift axis (+z); the lift limit brackets it (the fullCreature PITCH_REST
 * pattern). */
const LIFT_REST_RAD = (() => {
  const va = { x: P.liftBase!.x - P.tailBase!.x, y: P.liftBase!.y - P.tailBase!.y };
  const vb = { x: P.j1!.x - P.liftBase!.x, y: P.j1!.y - P.liftBase!.y };
  return Math.round(Math.atan2(va.x * vb.y - va.y * vb.x, va.x * vb.x + va.y * vb.y) * 1e4) / 1e4;
})();
const LIFT_TRAVEL_RAD = 0.5;

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

function bar(
  id: string,
  nodeA: string,
  nodeB: string,
  materialId: string,
  tag: string,
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

export function buildTailGimbalParts(prefix = ''): MechParts {
  const n = (id: string) => prefix + id;

  const gimbalElements: MechanismElement[] = [
    {
      ...bar(n('carrier'), n('carrierMount'), n('tailBase'), PIPE_075, 'gimbal'),
      endRealizationA: 'fitting',
      endRealizationB: 'conduitBox',
    },
    {
      ...bar(n('tailRoot'), n('tailBase'), n('liftBase'), PIPE_075, 'gimbal'),
      endRealizationA: 'conduitBox',
      endRealizationB: 'ropeLashing',
    },
    bar(n('wagBarL'), n('tailBase'), n('wagL'), PIPE_050, 'gimbal'),
    bar(n('wagBarR'), n('tailBase'), n('wagR'), PIPE_050, 'gimbal'),
    // anti-roll keel: rigid to the WAG cluster via the bar-tip braces, so
    // the lift plane rotates with wag (fullCreature.ts keel note verbatim)
    {
      ...bar(n('keelPost'), n('liftBase'), n('keelTop'), PIPE_050, 'gimbal'),
      endRealizationA: 'ropeLashing',
    },
    bar(n('keelBraceL'), n('keelTop'), n('wagL'), PIPE_050, 'gimbal'),
    bar(n('keelBraceR'), n('keelTop'), n('wagR'), PIPE_050, 'gimbal'),
    // WAG: vertical-axis hinge at the anchored tailBase (frame-pinned axis);
    // cross-bars welded to the root — the steer-mirror lever pattern
    {
      id: n('wagPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'gimbal',
      nodeId: n('tailBase'),
      joint: { kind: 'hinge', axis: { x: 0, y: -1, z: 0 } },
      memberIds: [n('carrier'), n('tailRoot'), n('wagBarL'), n('wagBarR')],
      welds: [
        [n('tailRoot'), n('wagBarL')],
        [n('tailRoot'), n('wagBarR')],
      ],
      angleLimit: { memberA: n('carrier'), memberB: n('tailRoot'), minRad: -0.6, maxRad: 0.6 },
      realization: 'conduitBox',
    },
    // LIFT: horizontal-axis hinge carried by the wag-side tailRoot — the
    // rope-lashed joint whose plane physically rides the wag
    {
      id: n('liftPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'gimbal',
      nodeId: n('liftBase'),
      joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
      memberIds: [n('tailRoot'), n('boom1'), n('keelPost')],
      welds: [],
      angleLimit: {
        memberA: n('tailRoot'),
        memberB: n('boom1'),
        minRad: round4(LIFT_REST_RAD - LIFT_TRAVEL_RAD),
        maxRad: round4(LIFT_REST_RAD + LIFT_TRAVEL_RAD),
      },
      realization: 'ropeLashing',
    },
  ];

  const boomElements: MechanismElement[] = [
    {
      ...bar(n('boom1'), n('liftBase'), n('j1'), PIPE_075, 'boom'),
      endRealizationA: 'ropeLashing',
      endRealizationB: 'nestedSleeve',
    },
    {
      ...bar(n('boom2'), n('j1'), n('tailTip'), PIPE_050, 'boom'),
      endRealizationA: 'nestedSleeve',
    },
    // hose-flex compliance at the boom joint (tailBoom.ts pattern)
    {
      id: n('flexPivot'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'boom',
      nodeId: n('j1'),
      joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
      memberIds: [n('boom1'), n('boom2')],
      welds: [],
      angleLimit: { memberA: n('boom1'), memberB: n('boom2'), minRad: -0.6, maxRad: 0.6 },
      torsionSpring: {
        memberA: n('boom1'),
        memberB: n('boom2'),
        stiffnessNmPerRad: 20,
        restAngleRad: 0,
      },
      realization: 'nestedSleeve',
    },
  ];

  const driveElements: MechanismElement[] = [
    // wag grip: slides laterally on its rail aft of the bars; the two ropes
    // act contralaterally (crossed) so the tip follows the grip side
    {
      id: n('wagRail'),
      type: 'telescope',
      maturity: 'engineered',
      subsystemTag: 'drive',
      nodeA: n('wagGripBase'),
      nodeB: n('wagPull'),
      minLengthM: 0.05,
      maxLengthM: 0.3,
      lengthM: 0.14,
      sliding: true,
      outerPipeMaterialId: PIPE_CLS200_075,
      innerPipeMaterialId: PIPE_CTS_075,
      pointMasses: [],
    },
    {
      id: n('wagRopeL'),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'drive',
      path: [n('wagPull'), n('wagL')],
      lengthM: round4(dist(P.wagPull!, P.wagL!) + WAG_ROPE_SLACK_M),
      cordageMaterialId: CORD,
    },
    {
      id: n('wagRopeR'),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'drive',
      path: [n('wagPull'), n('wagR')],
      lengthM: round4(dist(P.wagPull!, P.wagR!) + WAG_ROPE_SLACK_M),
      cordageMaterialId: CORD,
    },
    // lift grip: slides vertically under the mast; pulling down pays rope
    // over the mast eyelet and hoists the boom joint
    {
      id: n('liftRail'),
      type: 'telescope',
      maturity: 'engineered',
      subsystemTag: 'drive',
      nodeA: n('liftGripBase'),
      nodeB: n('liftPull'),
      minLengthM: 0.05,
      maxLengthM: 0.3,
      lengthM: 0.12,
      sliding: true,
      outerPipeMaterialId: PIPE_CLS200_075,
      innerPipeMaterialId: PIPE_CTS_075,
      pointMasses: [],
    },
    {
      id: n('liftRope'),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'drive',
      path: [n('liftPull'), n('liftMast'), n('j1')],
      lengthM: round4(dist(P.liftPull!, P.liftMast!) + dist(P.liftMast!, P.j1!) + 0.002),
      cordageMaterialId: CORD,
    },
  ];

  return {
    nodes: [
      { id: n('carrierMount'), kind: 'anchor', position: P.carrierMount! },
      { id: n('tailBase'), kind: 'anchor', position: P.tailBase! },
      { id: n('wagL'), kind: 'free', position: P.wagL! },
      { id: n('wagR'), kind: 'free', position: P.wagR! },
      { id: n('liftBase'), kind: 'free', position: P.liftBase! },
      { id: n('keelTop'), kind: 'free', position: P.keelTop! },
      { id: n('j1'), kind: 'free', position: P.j1! },
      { id: n('tailTip'), kind: 'free', position: P.tailTip! },
      { id: n('liftMast'), kind: 'anchor', position: P.liftMast! },
      { id: n('liftGripBase'), kind: 'anchor', position: P.liftGripBase! },
      { id: n('liftPull'), kind: 'driven', position: P.liftPull!, channelId: 'chTailLift' },
      { id: n('wagGripBase'), kind: 'anchor', position: P.wagGripBase! },
      { id: n('wagPull'), kind: 'driven', position: P.wagPull!, channelId: 'chTailWag' },
    ],
    elements: [...gimbalElements, ...boomElements, ...driveElements],
    pointMasses: [
      { id: n('jointMass'), name: 'boom joint', massKg: 0.3, nodeId: n('j1') },
      { id: n('tipMass'), name: 'boom tip', massKg: 0.4, nodeId: n('tailTip') },
    ],
    skeletonBindings: [],
    inputs: [
      {
        id: 'chTailWag',
        name: 'tail wag',
        kind: 'displacement',
        min: -0.05,
        max: 0.05,
        value: 0,
        locked: false,
      },
      {
        id: 'chTailLift',
        name: 'tail lift',
        kind: 'displacement',
        min: -0.05,
        max: 0.01,
        value: 0,
        locked: false,
      },
    ],
  };
}

export function buildTailGimbalProject(): Project {
  const parts = buildTailGimbalParts();
  const byTag = (tag: string) =>
    parts.elements.filter((e) => 'subsystemTag' in e && e.subsystemTag === tag);
  // the swish clip: wag sweeps full range and back while lift is phase-
  // shifted to peak (full pull) at the wag zero-crossings — the tip orbits
  // a genuinely 3D loop
  const swish: ControlClip = {
    name: 'tail swish',
    durationS: 4,
    loop: true,
    tracks: {
      'tail wag': { timesS: [0, 1, 2, 3, 4], values: [0, 0.05, 0, -0.05, 0] },
      'tail lift': { timesS: [0, 1, 2, 3, 4], values: [-0.05, 0.01, -0.05, 0.01, -0.05] },
    },
  };
  return exampleProject(
    'example-tail-gimbal',
    'Example — Raptor tail gimbal',
    partsMechanism('tail-gimbal', 'Tail gimbal (wag × lift)', parts),
    [
      groupOf('grp-gimbal', 'Gimbal', byTag('gimbal')),
      groupOf('grp-boom', 'Boom', byTag('boom')),
      groupOf('grp-drives', 'Drives', byTag('drive')),
    ],
    { controlClips: [swish] },
  );
}
