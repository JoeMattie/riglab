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

### DECISION: dependency versions = latest stable at adoption, pinned exact (2026-07-04, user directive)

New dependencies are added at their most recent stable release and pinned to
that exact version (no `^`/`~`), per the CLAUDE.md pinning rule. Companion
`@types/*` packages track the version of the library they type (e.g.
`@types/three@0.185.x` for `three@0.185.x`), not the absolute newest.
Upgrades thereafter are deliberate, not automatic.

## Phase 1 — sketch & play

### DECISION: joint-limit angle convention

The planfile says "min/max relative angle between two designated links"
without defining zero. Chosen: the signed deviation from the straight
continuation of memberA through the pivot into memberB (0 = straight, like a
knee). This puts the atan2 discontinuity at the physically implausible
fully-folded pose instead of at straight, where serial joints (neck, tail,
legs) actually operate. Documented on the schema.

### DECISION: DOF displayed as particle-space mobility

`dof = 2·(free nodes) − (independent equality constraints touching a free
node)` — equivalent to the Grübler–Kutzbach count for this shared-pin
lattice model (four-bar → 1, braced triangle → 0, double-braced → −1), and
it is exactly what the solver solves, so the badge can never disagree with
behavior. Classic Grübler caveats (paradoxical/redundant geometries) apply
equally to both forms.

### Solver robustness findings (the drag-ratchet postmortem)

Playwright drags with coarse pointer steps exposed a compounding failure:
(1) the drag/constraint projection cycle never converges when the target is
far from feasible, so the returned pose carried real constraint violation;
(2) the UI recomputes rest lengths from the previous solution every frame,
so that violation compounded — a four-bar's coupler shrank 40% in six
frames. Fixes, in depth: constraint-only settle sweeps after the drag loop
(output always lands on the constraint manifold); a deterministic
golden-angle micro-nudge (no Math.random, §12) to escape degenerate
collinear configurations Gauss–Seidel cannot leave; and the UI never writes
a non-converged pose into the document. Regression-tested with unreachable
drag targets + position feedback (kinematic acceptance suite).

### DECISION: undo gestures bracket to the pre-gesture state

zundo history pauses during a drag; on release the store silently rewinds to
the gesture-start document and replays the final state with recording on —
one history entry per gesture, none for click-without-change. (The naive
"record on release" version recorded the post-drag state, making drag-undo a
no-op.)

### Deferred / simplifications (to revisit)

- **Driven-node input channels**: schema carries `driven` nodes + channels
  with lock toggles, but channel→geometry semantics (what a scalar angle
  drives) are deferred to Phase 2, where the first force examples (jaw
  trigger, steer) give them concrete meaning. Phase 1 acceptance needs only
  drag targets and skeleton bindings, which share the same solve() path.
- **Connect menu on the finishing end only**: a drawn pipe's starting end
  auto-pivots when it lands on existing geometry; the pivot/weld/slider/
  detach menu appears only where the stroke ends. One menu per stroke keeps
  the draw loop fast; revisit if weld-at-start turns out to be common.
- Konva is rendered declaratively through react-konva at Phase 1 scene
  sizes; the imperative-refs hot path from the spike remains the plan for
  the Phase 5 performance pass if profiling demands it.

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

## Phase 2 — forces

Static equilibrium mode + force extraction now live behind the same
`solve(mechanism, inputs, 'equilibrium')` interface. Implementation in
`src/solver/equilibrium.ts`; acceptance/unit tests in
`src/solver/acceptance/{hangingMass,forces}.acceptance.test.ts`.

### Equilibrium settle (§5.1 mode 2)

Pseudo-dynamic relaxation: each step applies gravity + spring forces to the
free particles' velocities, integrates, projects the rigid constraints
(Gauss–Seidel, constraints in id order), then recomputes velocity from the
position change and multiplies by the damping factor. Runs until the fastest
particle drops below ε or the step cap. Fixed constants (all chosen for a
stable, deterministic settle, not tuned per-scenario): `DT = 0.01 s`,
`DAMPING = 0.85/step` (planfile's suggested value), `ITERS = 40`,
`MAX_STEPS = 6000`, `SETTLE_SPEED_EPS = 1e-6 m/s`, `RESIDUAL_TOL = 1e-4 m`
(a rigid constraint above this at the settled pose ⇒ not `converged`). The
equilibrium pose is Δt-independent (it is a force balance), so `DT` only sets
the convergence rate.

**Constraint-only warm start.** Before the dynamic phase the solver runs
`WARM_ITERS = 200` pure position-projection iterations (no gravity, no
velocity). This propagates driven-input steps and any drawn rigid-constraint
violation onto the constraint manifold *without* the velocity ringing a hard
step would otherwise inject — the ringing was sending a torsion-cable output
clear across its backlash dead-zone to clamp on the wrong edge. Gauss–Seidel
projection approaches each coupling's near boundary monotonically, so the warm
start lands on the physically correct side.

### [deviation] Springs modelled as explicit forces, not compliant constraints

§5.1 describes two things: elements as "constraints with compliance α (0 for
rigid, 1/k for springs)" **and** mode 2 as "integrate under gravity + spring
forces." I implement elastics and pivot torsion springs as explicit **forces**
(velocity impulses each step), reacted by the rigid XPBD projection — not as
compliant position constraints. Reason: a compliant spring in an
un-substepped relaxation is very soft and creeps so slowly the relaxation can
quiesce (`maxSpeed < ε`) before reaching equilibrium, giving a wrong pose; as
a force the spring injects real velocity and the settle is well-behaved. This
also makes force read-out work for gravity-free coupling mechanisms (the load
on a torsion cable is its return spring, not gravity). Flagged as a deviation
from the literal "compliance for springs" phrasing, though consistent with the
"+ spring forces" phrasing in the same section.

### Force extraction (§5.2)

Forces are read from the XPBD Lagrange multipliers via **one loaded
measurement substep** from the settled pose (`force = λ/Δt²` per unit
gradient): at equilibrium the present gravity + spring loads are exactly what
the rigid constraints react, so their λ is the static force. Reported:
element axial tensions (links, telescopes, taut ropes — tension positive),
elastic force (`k·(len−rest_eff)` from geometry, clamped ≥0 when tension-only),
bowden cable tension, torsion-cable transmitted torque, and torsion-spring
moment — all keyed by element id in `forces.elements` (unit is N for linear
elements, N·m for the rotational ones). **Pivot reaction** =
−(net constraint force on the pivot node). **Required input** per driven
channel = the holding force/torque the operator must supply to keep the driven
node at its prescribed value (net constraint force + gravity on the held node,
projected onto the channel's drive DOF — a force for `displacement`, a moment
about the rail pivot for `angle`). Massless free nodes take unit
inverse-mass for conditioning but **zero** gravity, so keel/geometry-only
nodes never corrupt a reaction (the lever settles to a 3·g reaction exactly).

### [deviation] Rope-compression diagnostic uses the as-drawn pose

`diagnostics.ropesRequiringCompression` cannot come from the free
tension-only settle: a tension-only rope is always either slack (0 tension) or
taut (≥0 tension), so the settle *by construction* never shows compression —
it just collapses into a different pose. "The design relies on a rope pushing"
is therefore evaluated against the **as-drawn pose**: a least-squares nodal
static force balance over the two-force members (links, telescopes, and ropes
drawn taut, i.e. path length ≥ L0), with gravity + elastic loads as the
right-hand side. A taut rope whose axial force comes out compressive (< −1e-3 N)
is flagged; a rope drawn slack carries nothing and is never flagged (this is
what keeps the hanging-mass-on-a-rigid-rod case clean). Deviation noted because
the planfile implies the flag falls out of "the solution"; in a pure static
tool it has to be computed against the intended (drawn) geometry. **Open
question for review below.**

### Driven-node input channels (deferred from Phase 1 — semantics chosen here)

A `driven` node is a **prescribed particle**, held (inverse mass 0) at a
position computed from its channel value, in *both* solve modes (drag and
settle share one `drivenTargets()` helper, so a channel drives identical
geometry either way). The value maps to a position through a reference frame:
the lowest-id `link`/`telescope` incident to the node gives a rail — its far
endpoint is the pivot (for `angle`) / axis origin (for `displacement`);
failing that, the lowest-id anchor node; failing that, world +x through the
drawn point.
- `angle` channel: the node is rotated about the pivot by `value` radians from
  its drawn position (0 ⇒ drawn pose). Models the steer-handle joint.
- `displacement` channel: the node slides along the rail axis by `value`
  metres from drawn. Models the jaw trigger / linear actuator.
A **locked** channel ignores `inputs.channelValues` and holds its stored
`value` (the set-screw / jaw-lock analogue, §4.2); an unlocked channel takes
the override for its name, else its stored value. **Open question for review
below** (the schema does not carry an explicit drive axis/pivot, so the "rail"
convention is my choice).

### [deviation] `SolveInputs.linkDensityKgPerM` added (backward-compatible)

Link self-weight is `developed length × linear density`, half to each
endpoint (§5.1). The materials DB (which holds the generic-pipe default
density) lives in the `Project`, outside the pure `solve()` interface, so the
caller passes the configured generic density as a new **optional** field on
`SolveInputs`. Omitted ⇒ links carry no self-weight and all mass comes from
explicit point masses — which is what keeps the §11 analytic values exact (a
massless-armed lever reacts exactly 3·g). This is an additive, non-breaking
extension of the frozen interface (the `SolveForces`/`SolveDiagnostics` output
shapes are untouched); kinematic mode ignores it. Per-material (engineered)
densities need the full DB and are deferred to the Phase 3 materials
integration.

### Open questions for the Phase 2 solver-correctness review

1. **Rope-compression semantics** — is "as-drawn static force balance"
   (above) the intended meaning of `ropesRequiringCompression`, or should it
   be evaluated at a driven/held pose, or against the free-settle collapse?
2. **Driven-node drive frame** — is the "lowest-id incident link ⇒ rail,
   else lowest-id anchor" convention acceptable, or should the schema gain an
   explicit drive axis/pivot per driven node (schema change, would bump to v3)?
3. **Springs-as-forces** — confirm the deviation from compliant-constraint
   springs is acceptable (it is what makes the relaxation converge without
   substepping).
4. **Backlash under an unloaded output** is indeterminate within the dead
   band; the torsion acceptance test loads the output with a light return
   spring so it resolves to the physical trailing edge. Confirm this is the
   intended modelling of backlash.

## Phase 2 — forces (UI)

_This heading is kept separate from the solver agent's Phase 2 notes to ease
merging the two worktrees._

### Element rendering vocabulary (wireframe-simple, §8.1)

- **rope**: thin (1.5 px) grey dashed polyline through its path nodes; interior
  path nodes are eyelets. **elastic**: green triangle-wave "coil" hint between
  its two ends (amplitude in screen px so it stays legible at any zoom).
  **bowden**: two dash-dot purple segments (the two coupled node-pairs) plus a
  faint dotted tie between their midpoints to signal they are coupled but
  routing-independent. **torsionCable**: magenta dotted line between the two
  coupled pivots' nodes. A cord highlights red when selected-violated or (rope)
  required to carry compression.

### Force labels anchor at the element, gated behind an explicit toggle

- The sketch face hides forces (§8.1), so all force UI is behind the bottom-bar
  **Equilibrium (forces)** toggle. When on, `solve(mechanism, inputs,
  'equilibrium')` runs on edit/scrub (not per drag frame — labels refresh on
  release) and readouts render as small Konva labels near each rope/elastic/
  bowden (elastic/rope at path midpoint, bowden at segment-A midpoint), with a
  white halo for legibility. Forces are drawn at the current sketch/pose
  positions, **not** re-rendered into the settled equilibrium pose — full
  design-face force treatment is Phase 3; this keeps Phase 2 minimal.
- Units follow the project preference: newtons always, plus lbf when imperial
  (§5.2 "N and lbf"); required-input is torque (N·m) for angle channels.

### Solver status + `unavailable` degradation

- Bottom-bar status shows converged / settling / non-converged (§8.3). A fourth
  `unavailable` status is shown when `solve('equilibrium')` throws — this
  worktree's solver equilibrium mode lands in a parallel branch, so the UI
  degrades gracefully (`readEquilibrium` catches and returns empty forces)
  instead of crashing. Once merged, real data drives the same code path.

### Input channels: a minimal generic authoring affordance

- Phase 2 requires input-channel sliders with lock toggles (§8.3, §11). Nothing
  created channels yet (channel→driven-node geometry is deferred to the example
  phase, per the Phase 1 note). To make the required slider/lock/required-force
  UI usable and testable, a minimal **+ input** button adds a generic
  displacement channel (name, range, value, lock); binding a channel to
  geometry remains deferred. Channel values are passed to `solve()` for both
  modes. Value-slider drags bracket one undo entry via begin/endGesture (the
  DECISIONS drag-gesture convention); single-commit tools (rope/elastic/bowden/
  torsion draws, add/lock/remove channel, gravity) are one `updateCurrent` =
  one undo entry, matching the pipe tool.

### Rope finish vs Konva's time-based double-click (interaction bug fixed)

- Konva's `dblclick` is purely time-based (any two clicks within its ~400 ms
  window, regardless of position), so rapid sequential rope-waypoint clicks each
  fired `onDblClick` and prematurely committed/reset the draft — interior
  waypoints were lost. Fix: rope finishes only when the last two clicks are
  **coincident** (a genuine same-spot double-click); a time-based dblclick
  between two distinct waypoints is ignored and drafting continues. (The Phase 1
  polyline tool finishes the same way and likely shares this latent bug; left
  untouched as out-of-scope, flagged here.)

### Test seam

- `window.__riglab.setEquilibrium(readout)` (alongside the existing debug hook)
  lets the Playwright forces spec exercise the force-overlay plumbing with a
  mocked readout while the real equilibrium solver is unavailable in this
  worktree. UI logic is otherwise unit-tested with mocked `SolveResult` values
  (`forces.test.ts`) since no React testing-library dependency is available and
  none may be added. *(Superseded 2026-07-04: @testing-library/react is now
  sanctioned — see scope amendments below.)*

## Scope amendments — 2026-07-04 (user directive)

Five additions slotted into the remaining phases; planfile updated in the
same change (§3, §4.4, §7, §8.2a, §8.3, §9, §10, §11).

### DECISION: UI components = shadcn/ui (Tailwind + Radix, vendored)

User directive. Adopted at the start of Phase 3, the first form-heavy phase
(inspector, checklist, materials tables) — retrofitting Phase 1–2's small
chrome earlier would be churn for no user value. Components are vendored via
the shadcn CLI into `src/ui/components/` (no runtime component-lib
dependency; Tailwind + Radix primitives pinned exact per the pinning rule).
A design handoff document, produced by a separate design pass once the app
is feature-complete (~end of Phase 4), drives the Phase 5 polish; until then
shadcn defaults, no bespoke styling.

### DECISION: canvas navigation = zoompinch (gesture layer → Konva Stage transform)

User directive, chosen for gesture feel. `@zoompinch/react@0.0.18` supports
React 19, MIT, actively maintained (May 2026), with a framework-agnostic
`@zoompinch/core`. Known integration constraint recorded in the planfile:
zoompinch's native model CSS-transforms wrapped DOM content, which would
bitmap-scale (blur) a Konva canvas — so we consume its gesture/transform
state and apply translate/scale to the Konva Stage (the existing
`viewTransform.ts` seam), rotation locked. Pre-1.0 risk accepted; a go/no-go
integration spike opens Phase 3, with hand-rolled wheel/pinch handlers as
the documented fallback.

### DECISION: info panel (selection inspector), both faces — planfile §8.2a

User directive; largely a concretization of §8.2's "opens the right
inspector" rather than new machinery. One selection-reactive right panel
serves both faces with face-appropriate scope (sketch: geometry/behavior/
derived info; design: + materials, realizations, forces, checklist items);
multi-select becomes the bulk-assignment surface. Reconciled with the
sketch face's "zero forms" principle: the panel is reactive and collapsible,
never a creation prerequisite. Slotted into Phase 3.

### DECISION: control layer (virtual input devices + control clips) — planfile §4.4, new Phase 4.5

User directive, motivated by the reference build's control yoke (twist →
head roll, swing → pan, trigger via cable → jaw): skeleton bindings cover
body-driven motion but not operated controls. Designed as a thin layer over
the existing input-channel machinery — a `Control` groups typed axes, each
axis maps (range + invert) onto a channel — rather than a parallel input
system, so solver and lock semantics are untouched. Includes per-type
manipulation widgets and "control clips" (keyframe tracks over channels,
recordable by scrubbing, composable with movement clips on one timeline) —
this promotes the minimal slice of the §10 animation-timeline stretch goal;
the full choreography editor stays stretch. Slotted as Phase 4.5 (after 3D
assembly, before examples): controls shine when the composed creature
exists, and example 7 now demonstrates a yoke + bundled control clip.

### DECISION: test-pyramid policy — RTL in, Playwright capped at smoke

User directive ("use a real testing library; manual Playwright is taking a
long time"). Vitest was already the test runner (14 unit/acceptance files),
so the real change is policy: add **@testing-library/react + jsdom** (the
planfile always named Testing Library; it was never installed, and one
worktree note above barred it — now reversed) and cap Playwright at a small
smoke suite. Rule of thumb: if a behavior can be asserted against a
component or `solve()` in Vitest, it must not become an e2e spec; Playwright
verifies wiring (project lifecycle, sketch, forces smoke), not logic, and
interactive browser-driving is not the development verification loop.
