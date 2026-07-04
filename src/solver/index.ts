import type { Mechanism } from '../schema';
import { solveEquilibrium } from './equilibrium';
import { solveKinematic } from './kinematic';
import type { SolveInputs, SolveMode, SolveResult } from './types';

export { channelValue, drivenTargets } from './equilibrium';
export * from './types';

/** Retained from Phase 1 for consumers that referenced it; no longer thrown
 * now that equilibrium mode is implemented. */
export class NotImplementedError extends Error {}

/** Custom XPBD per DECISIONS.md (Phase 0 spike). Kinematic drag mode landed in
 * Phase 1; static equilibrium mode + force extraction (§5.1, §5.2) land in
 * Phase 2, driven by the acceptance tests in src/solver/acceptance/. */
export function solve(mechanism: Mechanism, inputs: SolveInputs, mode: SolveMode): SolveResult {
  if (mode === 'kinematic') return solveKinematic(mechanism, inputs);
  return solveEquilibrium(mechanism, inputs);
}
