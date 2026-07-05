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
    skeletonBindings: [],
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

  const assembly: Assembly = {
    instances: [],
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
