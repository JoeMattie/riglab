// Authoritative constructors for all seven bundled §9 example projects.
// The JSON artifacts in this directory are generated from these builders by
// `node scripts/generate-examples.mjs`; sync tests guard that they agree.
// This module deliberately imports no JSON so the generator can run before
// the artifacts exist.
import type { Project } from '../schema';
import { buildFullCreatureProject } from './fullCreature';
import { buildJawBowdenMechanism } from './jawBowden';
import { buildLegExoMechanism } from './legExo';
import { buildNeckTrussMechanism } from './neckTruss';
import { buildSeesawSpineProject } from './seesawSpine';
import { exampleProject } from './shared';
import { buildSteerMirrorMechanism } from './steerMirror';
import { buildTailMechanism } from './tailBoom';

export { buildFullCreatureProject } from './fullCreature';
export { buildSeesawSpineProject } from './seesawSpine';

export function buildNeckTrussProject(): Project {
  return exampleProject('example-neck-truss', 'Example — neck truss (pitch)', [
    buildNeckTrussMechanism(),
  ]);
}

export function buildSteerMirrorProject(): Project {
  return exampleProject('example-steer-mirror', 'Example — steer mirror (plan)', [
    buildSteerMirrorMechanism(),
  ]);
}

export function buildJawBowdenProject(): Project {
  return exampleProject('example-jaw-bowden', 'Example — jaw + Bowden', [
    buildJawBowdenMechanism(),
  ]);
}

export function buildLegExoProject(): Project {
  return exampleProject('example-leg-exoskeleton', 'Example — leg exoskeleton', [
    buildLegExoMechanism('left'),
  ]);
}

export function buildTailProject(): Project {
  return exampleProject('example-tail', 'Example — tail', [buildTailMechanism()]);
}

/** Filename → builder map consumed by the artifact generator. */
export const ARTIFACT_BUILDERS: Record<string, () => Project> = {
  'seesaw-spine.json': buildSeesawSpineProject,
  'neck-truss.json': buildNeckTrussProject,
  'steer-mirror.json': buildSteerMirrorProject,
  'jaw-bowden.json': buildJawBowdenProject,
  'leg-exoskeleton.json': buildLegExoProject,
  'tail.json': buildTailProject,
  'full-creature.json': buildFullCreatureProject,
};
