import type { Mechanism } from '../schema';
import type { SolveInputs, SolveMode, SolveResult } from './types';

export * from './types';

export class NotImplementedError extends Error {}

/** Custom XPBD per DECISIONS.md (Phase 0 spike). Implementation lands in
 * Phase 1 (kinematic mode) and Phase 2 (equilibrium + forces), driven by the
 * acceptance tests in src/solver/acceptance/. */
export function solve(_mechanism: Mechanism, _inputs: SolveInputs, _mode: SolveMode): SolveResult {
  throw new NotImplementedError('solver lands in Phase 1 (see DECISIONS.md)');
}
