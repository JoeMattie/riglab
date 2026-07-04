// Bundled example loader. The JSON is the shipped data artifact; the loader
// validates it against projectSchema so a bad edit fails loudly. (No examples
// menu yet — that is Phase 5; this is data used by tests and, later, the UI.)
import { type Project, projectSchema } from '../schema/project';
import seesawSpineJson from './seesaw-spine.json';

export { buildSeesawSpineProject } from './seesawSpine';

/** Load and validate the bundled seesaw-spine example (§9 item 1). */
export function loadSeesawSpine(): Project {
  return projectSchema.parse(seesawSpineJson);
}
