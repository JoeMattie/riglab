// Bundled example loader (§9). The JSON files are the shipped data
// artifacts; each is generated from its builder (`node
// scripts/generate-examples.mjs`), validated here against projectSchema so a
// bad edit fails loudly, and listed in EXAMPLES for the "New from example"
// menu. Deep-clone on load so callers can't mutate the parsed module
// singleton.
import { type Project, projectSchema } from '../schema/project';
import bodyFrameJson from './body-frame.json';
import fullCreatureJson from './full-creature.json';
import jawBowdenJson from './jaw-bowden.json';
import legExoskeletonJson from './leg-exoskeleton.json';
import neckTrussJson from './neck-truss.json';
import pincerCostumeJson from './pincer-costume.json';
import seesawSpineJson from './seesaw-spine.json';
import serpentCostumeJson from './serpent-costume.json';
import splayedLegsJson from './splayed-legs.json';
import steerMirrorJson from './steer-mirror.json';
import tailJson from './tail.json';
import tailGimbalJson from './tail-gimbal.json';
import tallQuadrupedJson from './tall-quadruped.json';
import toweringFigureJson from './towering-figure.json';
import wingedCostumeJson from './winged-costume.json';

export {
  ARTIFACT_BUILDERS,
  buildBodyFrameProject,
  buildFullCreatureProject,
  buildJawBowdenProject,
  buildLegExoProject,
  buildNeckTrussProject,
  buildPincerCostumeProject,
  buildSeesawSpineProject,
  buildSerpentCostumeProject,
  buildSplayedLegsProject,
  buildSteerMirrorProject,
  buildTailGimbalProject,
  buildTailProject,
  buildTallQuadrupedProject,
  buildToweringFigureProject,
  buildWingedCostumeProject,
} from './builders';

export interface BundledExample {
  /** project id inside the artifact, stable across releases */
  id: string;
  /** menu label */
  name: string;
  /** one-line "what this demonstrates" (§9) */
  description: string;
  load: () => Project;
}

const load = (json: unknown) => (): Project => projectSchema.parse(structuredClone(json));

/** All fifteen bundled examples: the seven §9 items in planfile order,
 * the three fully-3D additions (PLANFILE-3d-raptor-samples.md), then the
 * five complete-costume samples (PLANFILE-fun-costume-samples.md). */
export const EXAMPLES: BundledExample[] = [
  {
    id: 'example-seesaw-spine',
    name: 'Seesaw spine',
    description: 'Hip-pivoting spine truss with head/tail masses — balance and counterweights.',
    load: load(seesawSpineJson),
  },
  {
    id: 'example-neck-truss',
    name: 'Neck truss (pitch)',
    description: 'Conduit-box slider base, elastic counterbalance, rope-driven head pitch.',
    load: load(neckTrussJson),
  },
  {
    id: 'example-steer-mirror',
    name: 'Steer mirror (plan)',
    description: 'Horizontal pan joints rope-mirrored steer-to-head with crossed left/right ropes.',
    load: load(steerMirrorJson),
  },
  {
    id: 'example-jaw-bowden',
    name: 'Jaw + Bowden',
    description: 'Elastic-opened jaw closed by a brake cable; lockable trigger channel.',
    load: load(jawBowdenJson),
  },
  {
    id: 'example-leg-exoskeleton',
    name: 'Leg exoskeleton',
    description: 'External leg driven by the wearer’s gait, with rope-as-limit toes.',
    load: load(legExoskeletonJson),
  },
  {
    id: 'example-tail',
    name: 'Tail',
    description: 'Detachable boom with compliant spring joints and a vertical-hold rope.',
    load: load(tailJson),
  },
  {
    id: 'example-full-creature',
    name: 'Full creature',
    description:
      'One compound mechanism: pan × pitch neck joints, mirrored legs, global weight and cut list.',
    load: load(fullCreatureJson),
  },
  {
    id: 'example-body-frame',
    name: 'Body frame (suspended)',
    description:
      'Closed rigid 3D box frame with a non-planar bent hoop, bungee/strap suspension to the wearer, and a nose-tuck cinch.',
    load: load(bodyFrameJson),
  },
  {
    id: 'example-splayed-legs',
    name: 'Splayed legs (3D gait)',
    description:
      'Mirrored gait-driven legs with off-panel hinge axes and a sprung hip-yaw joint — the paw wanders in 3D.',
    load: load(splayedLegsJson),
  },
  {
    id: 'example-tail-gimbal',
    name: 'Tail gimbal (wag × lift)',
    description:
      'Stacked non-parallel hinges: rope-driven wag carries a sprung lift, and the swish clip orbits the tip in 3D.',
    load: load(tailGimbalJson),
  },
  // Complete-costume examples C1–C5 (PLANFILE-fun-costume-samples.md): full
  // wearable rigs — suspension harness + body structure + several subsystems.
  {
    id: 'example-towering-figure',
    name: 'Towering figure (dance mirror)',
    description:
      '9 ft backpack figure whose marionette arms mirror your hands through the dance clip.',
    load: load(toweringFigureJson),
  },
  {
    id: 'example-winged-costume',
    name: 'Winged costume (arm-flap wings)',
    description:
      'Bent-spar wings flap ~4× your arm swing; trigger-fired jaw, sprung tail, hung body frame.',
    load: load(wingedCostumeJson),
  },
  {
    id: 'example-pincer-costume',
    name: 'Pincer costume (twin trigger claws)',
    description:
      'Wide shell hoop with two Bowden-trigger claws that wave with your arms; sprung eye stalks.',
    load: load(pincerCostumeJson),
  },
  {
    id: 'example-serpent-costume',
    name: 'Serpent costume (pan head, wave tail)',
    description:
      'Steerable pan head + jaw, and a torsion-cable tail chain that whips a wave down four joints.',
    load: load(serpentCostumeJson),
  },
  {
    id: 'example-tall-quadruped',
    name: 'Tall quadruped (gait legs, sky neck)',
    description:
      '10 ft sprung neck with bobble head, walk-driven front legs, counterweight tail for balance.',
    load: load(tallQuadrupedJson),
  },
];

export function loadExample(id: string): Project | undefined {
  return EXAMPLES.find((e) => e.id === id)?.load();
}

/** Load and validate the bundled seesaw-spine example (§9 item 1). */
export function loadSeesawSpine(): Project {
  return projectSchema.parse(seesawSpineJson);
}
