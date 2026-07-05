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
import seesawSpineJson from './seesaw-spine.json';
import steerMirrorJson from './steer-mirror.json';
import tailJson from './tail.json';

export {
  ARTIFACT_BUILDERS,
  buildBodyFrameProject,
  buildFullCreatureProject,
  buildJawBowdenProject,
  buildLegExoProject,
  buildNeckTrussProject,
  buildSeesawSpineProject,
  buildSteerMirrorProject,
  buildTailProject,
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

/** All bundled §9 examples, in planfile order (the original seven, then the
 * fully-3D additions from PLANFILE-3d-raptor-samples.md). */
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
];

export function loadExample(id: string): Project | undefined {
  return EXAMPLES.find((e) => e.id === id)?.load();
}

/** Load and validate the bundled seesaw-spine example (§9 item 1). */
export function loadSeesawSpine(): Project {
  return projectSchema.parse(seesawSpineJson);
}
