# PLANFILE — Forces-playback performance

## Problem

Clip playback with the forces overlay on (`equilibriumOn`) is extremely laggy.
The cause is architectural, not the solver's authorship: during playback the
equilibrium readout effect (`src/ui/editor/useGlobalSolve.ts`) runs a **full
static-equilibrium settle from scratch, synchronously on the main thread,
every animation frame**, on top of the per-frame kinematic solve. The settle
(`src/solver/equilibrium.ts`) is bounded only by `MAX_STEPS = 6000` substeps
× `ITERS = 40` Gauss–Seidel sweeps and has no frame budget; `perf.test.ts`
only covers the kinematic path, so nothing enforced one. (The comment claiming
equilibrium is "not per drag frame" is true for drags but false for playback —
`pose` is an effect dependency.)

## Approach

Exploit temporal coherence instead of swapping solvers: consecutive playback
frames differ by a tiny pose delta, so a settle **seeded from the previous
frame's settled positions** converges in a handful of substeps. Combined with
a **per-call substep budget**, the per-frame cost becomes small and bounded,
and a frame that runs out of budget reports `converged: false` honestly and
finishes over the next frames (the seed carries progress forward).

Scope is deliberately phase 1 of two:

- **Phase 1 (this planfile)**: warm-start + budget in the solver, seeded/
  budgeted invocation during playback in the UI, allocation-churn fix, missing
  equilibrium perf test.
- **Phase 2 (only if phase-1 measurement still misses budget)**: island
  decomposition for equilibrium mode (kinematic already has it), further
  render-path work (per-frame three.js geometry rebuilds). Not started without
  a measurement that demands it.

## Changes

### Solver (`src/solver/types.ts`, `src/solver/equilibrium.ts`)

`SolveInputs` gains two optional, equilibrium-only, plain-data fields (public
interface stays pure and framework-free):

- `seedPositions?: Record<string, Vec3>` — starting positions for **free**
  nodes (typically a previous solve's `positions`). Held/prescribed nodes
  ignore it; rest lengths and constraint targets still derive from drawn
  document positions, so the seed changes only where the relaxation starts,
  never what it converges to. Applied in `build()`
  (`pos = prescribed ?? seed ?? n.position` for free nodes). Hinge virtual
  axis particles already spawn relative to the (now seeded) pivot particle and
  are pulled onto the manifold by the existing `WARM_ITERS` projection pass.
- `maxSubsteps?: number` — cap on relaxation substeps for this call, clamped
  to `[1, MAX_STEPS]`. Hitting the cap before quiescence reports
  `converged: false` with the partial (still constraint-projected) pose.

Determinism is unchanged: the seed and cap are part of the inputs, so same
inputs ⇒ identical output. No schema change (SolveInputs is not persisted).

Also: `RopeC.grads()` currently allocates a fresh array-of-tuples on every
projection call inside the innermost loop — preallocate the gradient buffer in
the constructor and reuse it.

### UI (`src/ui/editor/useGlobalSolve.ts`)

- Keep the last equilibrium `positions` in a ref; invalidate on doc change.
- While `playback.playing`: pass `seedPositions` from the ref and a fixed
  substep budget (`PLAYBACK_EQ_SUBSTEP_BUDGET = 10`, measured ≈5 ms on the
  full creature). Present a budget-truncated result as status `settling` (it
  is mid-relaxation), not `nonConverged`.
- Add `playback.playing` to the effect deps so pausing runs one final seeded
  solve with a generous bounded budget (`PAUSED_EQ_SUBSTEP_BUDGET = 1200`,
  three pose-quiescence windows, ≈330 ms worst case).
  **Measurement-driven deviation from the original draft** (which said
  uncapped on pause): the full-creature equilibrium solve never converges —
  it burns the full 6000-substep cap (~1.7 s) at rest and walk poses alike
  and reports `converged: false`. That is the entire pre-change lag (~1.7 s
  × every playback frame), and it means "uncapped on pause" would be a 1.7 s
  UI freeze for the same non-converged verdict. Bounded pause budget returns
  the same honest answer in ≈330 ms; the never-converging full creature is a
  pre-existing solver-robustness item (see DECISIONS.md "honest-solve
  calibration"), out of scope here.
- Memoize `elementLinearDensities(mech, doc.materials)` (currently recomputed
  every frame).
- Fix the stale "not per drag frame" comment.

Mid-playback readout semantics, decided by measurement: the budgeted seeded
settle is a damped transient tracking the animation, not the fully-settled
statics answer for each frozen frame (which the old code also never reached —
it showed the 6000-step non-converged pose at ~0.5 fps). Labels are
approximate while status is `settling`; the settled readout lands on pause.

### Tests

- New solver acceptance file (`src/solver/acceptance/` style, targeting
  `solve()`): (1) seeding a solve with its own settled output reproduces the
  cold result within existing tolerances and converges within a small budget;
  (2) seeded solves are deterministic; (3) an under-budgeted cold solve
  reports `converged: false` without throwing; (4) seed entries for held
  nodes / unknown ids are ignored.
- `src/examples/perf.test.ts` gains the missing equilibrium case: full
  creature at walk pose, frame *i* seeded from frame *i−1* with the playback
  budget, median of 60 < 16 ms (same CI-robust median statistic as the
  kinematic cases).

## Verification

1. `npm run lint`, full Vitest suite, `npm run build`.
2. Scripted (not driven) browser check per DECISIONS.md: headless Playwright
   against `npx vite preview` — load an example, enable forces, play a clip,
   sample rAF deltas for ~2 s in one evaluate, assert the median frame time is
   interactive (< ~33 ms) and the forces readout reaches a settled status
   after pause.

## Non-goals

Dynamics (momentum/inertia/collision) — separate future decision. Solver
replacement — rejected; see DECISIONS.md entry accompanying this planfile.
Web-worker offload and equilibrium island decomposition — phase 2, only on
measured need.
