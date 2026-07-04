import type { Mechanism } from '../schema';
import { solveKinematic } from './kinematic';
import type { SolveInputs, SolveMode, SolveResult } from './types';

export * from './types';

export class NotImplementedError extends Error {}

/** Custom XPBD per DECISIONS.md (Phase 0 spike). Kinematic mode landed in
 * Phase 1; equilibrium + force extraction land in Phase 2, driven by the
 * acceptance tests in src/solver/acceptance/. */
export function solve(mechanism: Mechanism, inputs: SolveInputs, mode: SolveMode): SolveResult {
  if (mode === 'kinematic') return solveKinematic(mechanism, inputs);
  throw new NotImplementedError('equilibrium mode lands in Phase 2 (see DECISIONS.md)');
}
