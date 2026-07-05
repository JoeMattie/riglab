// Authoritative constructors for all seven bundled §9 example projects,
// native v7 single-compound documents (PLANFILE-3d-conversion.md).
// The JSON artifacts in this directory are generated from these builders by
// `node scripts/generate-examples.mjs`; sync tests guard that they agree.
// This module deliberately imports no JSON so the generator can run before
// the artifacts exist.
import type { Project } from '../schema';
import { buildJawBowdenParts } from './jawBowden';
import { buildLegExoParts } from './legExo';
import { buildNeckTrussParts } from './neckTruss';
import { exampleProject, groupOf, partsMechanism } from './shared';
import { buildSteerMirrorParts } from './steerMirror';
import { buildTailParts } from './tailBoom';

export { buildFullCreatureProject } from './fullCreature';
export { buildSeesawSpineProject } from './seesawSpine';

import { buildFullCreatureProject } from './fullCreature';
import { buildSeesawSpineProject } from './seesawSpine';

export function buildNeckTrussProject(): Project {
  const parts = buildNeckTrussParts();
  return exampleProject(
    'example-neck-truss',
    'Example — neck truss (pitch)',
    partsMechanism('neck-truss', 'Neck truss (pitch)', parts),
    [groupOf('grp-neck-truss', 'Neck truss (pitch)', parts.elements)],
  );
}

export function buildSteerMirrorProject(): Project {
  const parts = buildSteerMirrorParts();
  return exampleProject(
    'example-steer-mirror',
    'Example — steer mirror (plan)',
    partsMechanism('steer-mirror', 'Steer mirror (plan)', parts),
    [groupOf('grp-steer-mirror', 'Steer mirror (plan)', parts.elements)],
  );
}

export function buildJawBowdenProject(): Project {
  const parts = buildJawBowdenParts();
  return exampleProject(
    'example-jaw-bowden',
    'Example — jaw + Bowden',
    partsMechanism('jaw-bowden', 'Jaw + Bowden', parts),
    [groupOf('grp-jaw-bowden', 'Jaw + Bowden', parts.elements)],
  );
}

export function buildLegExoProject(): Project {
  const parts = buildLegExoParts('left');
  return exampleProject(
    'example-leg-exoskeleton',
    'Example — leg exoskeleton',
    partsMechanism('leg-exo-left', 'Leg exoskeleton (left)', parts),
    [groupOf('grp-leg-exo', 'Leg exoskeleton (left)', parts.elements)],
  );
}

export function buildTailProject(): Project {
  const parts = buildTailParts();
  return exampleProject(
    'example-tail',
    'Example — tail',
    partsMechanism('tail-boom', 'Tail', parts),
    [groupOf('grp-tail', 'Tail', parts.elements)],
  );
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
