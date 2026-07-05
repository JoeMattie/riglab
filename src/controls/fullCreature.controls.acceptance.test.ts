// Phase 4.5 acceptance (§11): the bundled yoke drives the full creature.
//
// TODO(3D integrator): rebuild against the v7 full-creature example once
// src/examples is rewritten as a single compound mechanism. The former
// version proved these behaviors through the (now deleted) assembly layer
// (composeProject / resolveAttach); the v7 equivalents are:
//   1. Yoke twist axis → mapped channel (invert + range via axisChannelValue /
//      projectControlChannels) → solve(project.mechanism, ...) moves the
//      steered head nodes.
//   2. A control mounted to the handR wearer anchor follows the hand through
//      the walk clip (computeSkeleton(project.wearer, pose).anchors.handR).
//   3. A control clip ('head sweep + jaw snap') composes with the walk
//      movement clip on one timeline; held channels override the clip.
//   4. A locked axis still commands its channel.
// The pure mapping/composition logic behind 1, 3, and 4 stays covered by
// mapping.test.ts; this file re-adds the bundled-example integration layer.
import { describe, it } from 'vitest';

describe('post-integration: bundled yoke drives the full creature (v7 examples pending)', () => {
  it('maps the twist axis onto the steer-pan channel range', () => {});
  it('drives the steered head through solve() when the twist axis moves', () => {});
  it('the yoke mount rides the handR anchor as the walk pose changes', () => {});
  it('a control clip drives steer-pan while walk drives the body', () => {});
  it('a held axis overrides the clip; a locked axis still drives its channel', () => {});
});
