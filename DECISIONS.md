# DECISIONS.md — PVC Rig Lab

Architectural and library decisions, with reasoning. Newest entries at the
bottom of each phase section. Planfile deviations are marked **[deviation]**.

## Phase 0 — library-evaluation spike (planfile §3.1)

### Method

Throwaway harness in `spike/` (deleted from main after the Phase 0 review
sign-off on 2026-07-04; retrievable from git history — last commit containing
it is tagged by the removal commit's parent). All candidates implement one adapter interface and
run identical scenarios with analytic expectations
(`spike/harness/conformance.ts`):

- (a) four-bar drag-to-pose vs closed-form solution (≤1e-3 m),
- (b1/b2) hanging mass on tension-only rope, taut and slack cases (tension =
  m·g ±2%; slack must report ~0, never compression),
- (c) rope routed through a frictionless eyelet (analytic pose + tension ±2%),
- (d) bowden displacement coupling, 1:1 transfer both directions while taut
  **[deviation]** — §3.1 lists three benchmarks but *scores* bowden/torsion
  ergonomics; a fourth micro-benchmark makes that score measured instead of
  guessed,
- determinism (two fresh runs, identical positions ≤1e-12),
- perf probe: 100-node truss, scripted drag, 600 frames, step time only,
- interactive drag feel via `npm run spike` (spike.html; solver + renderer
  benches).

Environment: Apple Silicon macOS, Node 26.4.0, Chrome; versions pinned:
`@dimforge/rapier2d-compat@0.19.3`, `planck@1.5.0`, `konva@10.3.0`.

### Results

**Hard gates** (correctness a–d, determinism, drag stability, WASM loads from
a production Cloudflare Pages build): **all three candidates pass** — but the
engines only pass with engine-specific workarounds, each of which was a real
bug during the spike:

- Rapier: its TGS solver substeps internally, so continuous gravity produces
  ~`g·dt²·(n+1)/2n` free-fall displacement per frame, silently biasing
  λ-based tension readouts by ~47%; worked around by zeroing gravity on
  custom-pass bodies and injecting it as a pre-step velocity impulse.
- Rapier: extreme bar/node mass ratios (0.05 kg link, 5 kg load) leave
  ~1.5 mm steady-state revolute-joint stretch — fails the 1 mm acceptance
  tolerance; worked around by scaling link-body masses to their endpoint
  loads.
- planck: Box2D's 5 mm `linearSlop` game default had to be tightened, and
  sleeping disabled.

**Ropes/eyelets, bowden, and tension-only semantics had to be implemented as
a custom position-projection pass outside both engines** (neither has routed
ropes or displacement couplings). That pass is, line for line, the core of
the custom XPBD candidate — so the "engine" option in practice means
maintaining a mini-XPBD *plus* an engine integration and its impedance
mismatches.

Measured, 100-node truss drag (step only, p50/p95 ms): custom-xpbd
0.16/0.23 · planck 0.64/0.82 · rapier 2.65/2.77. All far under the 16 ms
budget. Bundle gzip delta: custom-xpbd ~0 kB · planck 45 kB ·
rapier2d-compat 636 kB (base64 WASM; the non-compat flavor is smaller but
needs wasm-aware bundler config and separate asset handling).

WASM-on-Pages: verified — the built spike served via `npx wrangler pages dev`
initializes Rapier and solves scenario (b1) to 49.046 N vs 49.05 analytic
(automated via `window.__spikeCheck`).

Force extraction: XPBD yields λ (force) for *every* constraint natively;
planck exposes `joint.getReactionForce` for pivot reactions plus our
custom-pass λ; Rapier's JS bindings do not usefully expose joint impulses —
rod/pivot reactions would need finite-difference tricks or upstream changes.

### Scores (1–5, weights as proposed to and approved by the reviewer)

| Criterion (weight) | custom-xpbd | rapier2d | planck |
|---|---|---|---|
| Custom-constraint ergonomics (30%) | 5 — native, one code path, λ readouts for free | 2 — all couplings outside the engine; TGS bias workaround | 2.5 — same custom pass; simpler integrator, fewer surprises |
| Force-extraction quality (20%) | 5 | 2 | 3.5 |
| Interactive drag stability (20%) | 5 — exact target snap, no overshoot | 4 | 4 |
| Performance (15%) | 5 | 3.5 | 4.5 |
| Bundle size (10%) | 5 | 1.5 | 4 |
| Integration friction (5%) | 5 | 3 — WASM init, flavor choice | 4 |
| **Weighted total** | **5.00** | **2.63** | **3.53** |

The §3.1 hybrid option (engine for rigid/joints + custom pass for couplings)
is exactly what the rapier/planck adapters are — its cost is visible in their
scores: the custom pass must exist anyway, and the engine adds workarounds
rather than removing work.

### DECISION: solver = custom XPBD (planfile §5 reference design)

~300 lines in the spike already pass every acceptance-shaped test, run 4–12×
faster than the engines on the target workload, extract forces for every
constraint natively, are trivially deterministic (fixed iteration count,
constraint order sorted by id, no WASM), and add zero bundle weight. The
elements that make this app unusual — routed tension-only ropes, bowden,
torsion coupling, compliant springs — are first-class in XPBD and foreign to
both engines. Risk accepted: we own solver robustness (jitter, convergence);
mitigated by the analytic acceptance tests and §12's guidance to spend the
cleverness budget here.

Consequences: no WASM asset in the app, so the CLAUDE.md WASM-on-Pages and
engine-version-pin requirements are moot (verified for Rapier anyway, above);
determinism tests target our own solver. `@dimforge/rapier2d-compat` and
`planck` are spike-only dependencies and will be removed together with
`spike/` after the Phase 0 review.

### DECISION: 2D editor = Konva (with react-konva)

Renderer bench (100-node truss + dimension labels driven live by the XPBD
candidate, 600 frames): both Konva and raw Canvas 2D hold a vsync-locked
60 fps (mean 16.67 ms; p95 17.8–18.7 ms incl. vsync wait) with the solver
step ≤0.25 ms — perf does not discriminate at this scene size, and text is
pixel-identical since Konva draws through Canvas 2D. Konva wins on editor
ergonomics: retained scene graph, per-shape hit testing and events (hover
node picking was ~5 lines vs manual distance scans + bespoke redraw
management on raw canvas), z-ordering, and transforms — exactly the
selection/snap/drag machinery Phase 1 needs. Hot paths will mutate Konva
nodes imperatively via refs + `batchDraw` (the bench pattern); react-konva is
used for structure, not per-frame reconciliation. Raw canvas remains the
documented fallback if profiling in Phase 1 says otherwise.

### DECISION: undo/redo = zundo (zustand temporal middleware)

Planfile asks for snapshot-history undo and says evaluate `zundo`. It is a
~1 kB wrapper around exactly the snapshot stack we'd hand-roll, works with
immer, supports `partialize` (only document state, not UI state) and a
history limit. Adopt `zundo@2`, limit 100 snapshots; trivially replaceable by
a hand-rolled stack if it disappoints.

### DECISION: CSV export = hand-rolled

Export-only (BOM), ~20 lines with correct quoting; import stays JSON.
PapaParse only if CSV *parsing* ever becomes a requirement.

### Process conventions approved by the user (2026-07-04)

- **[deviation]** Acceptance tests for future phases are committed
  **skip-marked** (`test.skip` + comment naming the un-skipping phase) so CI
  stays green at every commit while the tests remain the executable spec —
  reconciles planfile §11 Phase 0 ("failing or passing per TDD") with the
  CLAUDE.md green-CI rule.
- Phase 0 ships a minimal project-manager shell; the Playwright smoke test
  starts as the project-lifecycle flow and grows toward "create mechanism →
  drag → see BOM".
- Full §4 domain schema transcribed at `schemaVersion: 1` (minimizes
  migration churn; every later change still bumps + migrates).
- Phase 0 writes two solver acceptance tests (four-bar positions,
  hanging-mass tension); the rest are written at the start of their phases.
- Spike-harness settle criterion is 1e-6 m/step (engines never quiesce below
  ~1e-7); correctness is asserted on positions/forces, not on the settle
  criterion.
