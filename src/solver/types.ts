import type { Mechanism, Vec3 } from '../schema';

// The solver's public interface (§12): pure, deterministic, framework-free.
// It consumes schema types (plain data) and returns plain data — the UI
// never talks to solver internals, and all acceptance tests target solve().

export type SolveMode = 'kinematic' | 'equilibrium';

export interface SolveInputs {
  /** input channel values keyed by channel NAME (channels are global across
   * mechanisms, §4.2) */
  channelValues: Record<string, number>;
  /** transient drag targets keyed by node id (kinematic drag, §5.1) */
  dragTargets?: Record<string, Vec3>;
  /** Drag "friction" (kinematic only), 0..~0.95, default 0 = crisp/current.
   * Each drag target is eased from the node's CURRENT position toward the
   * requested target by a factor (1 − dragFriction), so per solve the dragged
   * node closes only part of the gap to the pointer. Because the caller
   * ratchets the solved pose back into the document each drag frame, this is a
   * per-frame lag (velocity damping): the node still reaches the pointer over
   * frames, but a fast pull no longer teleports across a branch boundary and
   * flips a distant joint — it drags there continuously instead. A UI gesture
   * knob; excluded from residual/DOF. Ignored in equilibrium mode. */
  dragFriction?: number;
  /** Transient drag-time plane locks keyed by node id (shift-drag in an
   * ortho panel): the node is projected onto its plane every iteration —
   * with and after the geometry — so the drag cannot pull it out of the
   * view plane while lengths/joints still resolve. Like dragTargets, a UI
   * gesture: excluded from residual/DOF/violated reporting. Kinematic only. */
  planeLocks?: Record<string, { point: Vec3; normal: Vec3 }>;
  /** Prescribed positions for kind-'anchor' nodes attached to the wearer
   * (anchorBindings): the pack frame / body carries the ground point through
   * pose and clip playback. Applied in both modes; entries for non-anchor
   * nodes are ignored. Rest lengths still derive from document positions
   * (PLANFILE-wearer-attachments-and-floor, slice A). */
  groundTargets?: Record<string, Vec3>;
  /** Generic-pipe linear density (kg/m) used for sketch-maturity link
   * self-weight in equilibrium mode (§4.2, §5.1). The materials DB lives in
   * the Project (outside this pure interface), so the caller passes the
   * configured generic default here; omitted ⇒ links carry no self-weight and
   * mass comes only from explicit point masses. Ignored in kinematic mode. */
  linkDensityKgPerM?: number;
  /** Per-element linear-density override (kg/m) for engineered links/bentLinks/
   * telescopes, keyed by element id (§4.2 maturity). Falls back to
   * linkDensityKgPerM when an element is absent. The BOM/materials layer feeds
   * these from assigned pipe materials. Additive, equilibrium-only. */
  elementLinearDensityKgPerM?: Record<string, number>;
  /** Warm-start seed for equilibrium mode: starting positions for FREE nodes,
   * typically a previous solve's `positions` (PLANFILE-forces-playback-perf).
   * Held/prescribed nodes and unknown ids are ignored; rest lengths and
   * constraint targets still derive from drawn document positions, so the
   * seed changes where the relaxation starts, never what it converges to.
   * Part of the inputs, so determinism holds: same seed ⇒ identical output.
   * Ignored in kinematic mode. */
  seedPositions?: Record<string, Vec3>;
  /** Cap on equilibrium relaxation substeps for this call, clamped to
   * [1, MAX_STEPS] (PLANFILE-forces-playback-perf). Hitting the cap before
   * quiescence returns the partial (constraint-projected) pose with
   * `converged: false`; a caller seeding from the previous result carries the
   * settle forward across calls. Ignored in kinematic mode. */
  maxSubsteps?: number;
}

export interface SolveForces {
  /** signed axial force per element id, newtons, tension positive */
  elements: Record<string, number>;
  /** reaction force per pivot element id */
  pivotReactions: Record<string, Vec3>;
  /** required holding force/torque per channel name — "how hard does the
   * operator's hand work" (§5.2) */
  requiredInputs: Record<string, number>;
}

export interface SolveDiagnostics {
  /** particle-space spatial mobility: 3·(non-anchor nodes) − independent equalities (PLANFILE-3d-conversion.md) */
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
  positions: Record<string, Vec3>;
  forces: SolveForces;
  diagnostics: SolveDiagnostics;
}

export type Solve = (mechanism: Mechanism, inputs: SolveInputs, mode: SolveMode) => SolveResult;
