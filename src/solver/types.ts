import type { Mechanism, Vec2 } from '../schema';

// The solver's public interface (§12): pure, deterministic, framework-free.
// It consumes schema types (plain data) and returns plain data — the UI
// never talks to solver internals, and all acceptance tests target solve().

export type SolveMode = 'kinematic' | 'equilibrium';

export interface SolveInputs {
  /** input channel values keyed by channel NAME (channels are global across
   * mechanisms, §4.2) */
  channelValues: Record<string, number>;
  /** transient drag targets keyed by node id (kinematic drag, §5.1) */
  dragTargets?: Record<string, Vec2>;
  /** Generic-pipe linear density (kg/m) used for sketch-maturity link
   * self-weight in equilibrium mode (§4.2, §5.1). The materials DB lives in
   * the Project (outside this pure interface), so the caller passes the
   * configured generic default here; omitted ⇒ links carry no self-weight and
   * mass comes only from explicit point masses. Ignored in kinematic mode. */
  linkDensityKgPerM?: number;
}

export interface SolveForces {
  /** signed axial force per element id, newtons, tension positive */
  elements: Record<string, number>;
  /** reaction force per pivot element id */
  pivotReactions: Record<string, Vec2>;
  /** required holding force/torque per channel name — "how hard does the
   * operator's hand work" (§5.2) */
  requiredInputs: Record<string, number>;
}

export interface SolveDiagnostics {
  /** Grübler–Kutzbach 2D mobility (§5.3) */
  dof: number;
  classification: 'structure' | 'mechanism' | 'overconstrained';
  converged: boolean;
  residual: number;
  /** element ids whose constraints could not be satisfied */
  violated: string[];
  /** rope element ids whose solution would require compression (§5.2) */
  ropesRequiringCompression: string[];
}

export interface SolveResult {
  positions: Record<string, Vec2>;
  forces: SolveForces;
  diagnostics: SolveDiagnostics;
}

export type Solve = (mechanism: Mechanism, inputs: SolveInputs, mode: SolveMode) => SolveResult;
