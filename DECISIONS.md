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

### Phase 2 solver-correctness review: SIGNED OFF (2026-07-04)

All four questions answered by the user: (1) as-drawn static balance IS the
intended meaning of `ropesRequiringCompression`; (2) the inferred drive
frame (lowest-id incident link → rail, else lowest-id anchor, else world
+x) is accepted — no schema drive-frame field for now; (3) springs-as-
forces deviation accepted; (4) backlash-resolved-by-return-spring modelling
accepted. One robustness item carried forward out of the review: a rope
loaded exactly at its taut limit reports "non-converged" while extracting
the correct tension (inequality limit-cycles at the active boundary) —
scheduled as a solver-robustness fix alongside Phase 3, per §12's guidance
that tension-only constraints get the cleverness budget.

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

### DECISION: browser verification is scripted, not driven (2026-07-04, user directive)

The slow part of browser verification is interactive driving — each MCP
click costs an agent round trip plus an accessibility snapshot; the same
journey as a headless Playwright script runs in seconds (the committed
3-spec suite: ~4.4 s). Policy for end-of-phase "built app works"
verification and any ad-hoc browser checking:

1. Write a throwaway headless Playwright script (or temporary spec) for the
   journey and run it once against `npx vite preview` on the production
   build; collect screenshots/console logs as artifacts to eyeball.
2. Assert app state through the `window.__riglab` debug hook in a single
   `evaluate` (solver status, forces, document state) instead of parsing
   snapshots/pixels.
3. Anything expressible as a `solve()`/component assertion belongs in
   Vitest, per the test-pyramid decision above — the browser pass confirms
   wiring only.
4. Interactive MCP driving is reserved for gesture-feel checks that
   genuinely need a human-like pointer (drag feel, double-click semantics,
   snap behavior).

Throwaway verification scripts that prove durable may graduate into the
committed smoke suite; otherwise they are deleted, not accumulated.

### DECISION: lint/format = Biome (2026-07-04, user directive)

User directive ("biome for linting and formatting to help avoid react
pitfalls and keep everything looking nice"). `@biomejs/biome@2.5.2` pinned
exact; one tool replaces the ESLint+Prettier pair, and its **react domain**
supplies the pitfall rules that motivated the ask (exhaustive hook
dependencies, rules of hooks, no array-index keys, button types). Config
choices, each deliberate:

- **recommended preset + react + test domains**, organize-imports assist on.
- **`noNonNullAssertion` off** — 245 hits, nearly all in the solver where
  `!` follows an existence-checked map/find lookup; TypeScript strict
  already polices null soundness, and rewriting the solver for a style rule
  is churn with regression risk.
- **Formatter codifies the existing style** (2-space, single quotes) with
  **line width 100** — the code base wasn't wrapped at Biome's default 80
  (102 lines over 100 chars), and 100 wraps JSX less aggressively.
- Suppressions require inline `biome-ignore` with a reason; the only two in
  the sweep are `noArrayIndexKey` on the sketch canvas grid/silhouette
  layers, where the lists are positional projections regenerated wholesale
  and never reordered.

One-time sweep across 66 files: formatting + import organization, plus real
fixes — 19 `<button>`s given `type="button"` (they were submit-typed by
default), 3 iterable callbacks returning `Set.add`'s value, 2 unused
`export`s removed from test files, 2 `!x || x.y !== z` chains converted to
optional chaining. `npm run lint` added to package scripts and as a CI step
between typecheck and test; typecheck, all 84 unit/acceptance tests, and the
production build verified green after the sweep.

## Phase 3 — solver robustness

### The rope taut-limit non-convergence (carried forward from the Phase 2 review)

**Failure mode.** A mass hanging on a rope that settles to exactly its taut
limit (path length == L0 under load) reported `diagnostics.converged === false`
while still extracting the correct tension (m·g) and the correct pose. Root
cause, confirmed by instrumenting `settle()`: at the active boundary the
relaxation *creeps* instead of quiescing. Each substep gravity re-tautens the
rope (`RopeC.project` is skipped when the path is marginally slack, `C ≤ 0`, and
applied when marginally taut, `C > 0`), so the free particle crawls along the
constraint boundary toward equilibrium at a near-constant, heavily-overdamped
rate. That crawl velocity plateaus just above `SETTLE_SPEED_EPS = 1e-6 m/s`, so
the speed-based settle test never fires within `MAX_STEPS = 6000` — even though
the pose is, for reporting purposes, already at rest and the measured tension is
exact. The effect is length-driven, not mass-driven (the settle step count is
independent of the point mass and grows with rope length: the near-plumb
pendulum mode is overdamped and its time constant scales with the arm). A
**rigid link** of the same length exhibits the identical slow mode, which
confirms the problem is the boundary creep / overdamped swing, not a compression
artifact of the rope inequality.

**Regression test (written first).** `src/solver/acceptance/ropeTautLimit.acceptance.test.ts`:
a 5 kg mass on a 4 m rope, drawn a touch off-plumb on the taut circle, must
settle plumb at exactly the taut length, report `converged === true`, tension
= m·g ±2%, and residual ≤ 1e-4. Verified **failing on the pre-fix code**
(`expected false to be true` on `converged`, with tension already correct)
and passing after the fix.

**Fix chosen: a pose-quiescence fallback settle criterion.** Alongside the
existing max-speed test, `settle()` now also declares the pose settled when no
free particle drifts more than `POSE_QUIESCENCE_EPS` over a rolling
`POSE_QUIESCENCE_WINDOW`-substep window (net drift per window, so it is robust
to the boundary's slack/taut alternation). This changes only the *stop
criterion* — not the dynamics, projection, or force extraction — so every
converging mechanism reaches the identical equilibrium pose by the identical
relaxation; the fallback only ever ends a settle that the speed test would
otherwise run to the step cap. Considered and rejected: (a) a position/deadband
hysteresis on rope activation — risks changing rope-compression semantics and
the analytic slack cases; (b) latching a persistently-active inequality to an
equality — attacks the wrong cause (a rigid link fails identically, so latching
the rope to a rod would not help) and can clamp a rope that should go slack at
equilibrium; (c) retuning `DAMPING` — a fixed coefficient cannot critically-damp
every arm length, and it is the planfile's suggested 0.85.

**Constants introduced** (both fixed, deterministic — no `Math.random`, no time,
fixed window/iteration counts, constraint order unchanged):
- `POSE_QUIESCENCE_EPS = 1e-4 m` — max free-particle drift over the window that
  counts as "at rest." Chosen 10× finer than the tightest equilibrium position
  assertion in the suite (1e-3 m in the hanging-mass / eyelet cases), so a pose
  this still is settled at the reporting scale; the fix's returned pose for the
  regression case is within ~7e-5 m of the fully-relaxed pose.
- `POSE_QUIESCENCE_WINDOW = 400 substeps` (= 4.0 s at `DT = 0.01`) — long enough
  that a genuinely transient (still-swinging) pose drifts well past the eps, so
  the fallback never pre-empts a normal settle. Verified against every
  equilibrium acceptance case: for the ones that take > 400 steps to settle
  (e.g. the counter-balanced boom, ~1181 steps) the window drift stays above
  the eps until the speed test fires first, so their results are unchanged; the
  faster cases settle in far fewer than 400 steps and never reach a window
  check. All 92 unit/acceptance tests pass, build green.

Semantics note (not a deviation): for arms long enough that the pose is *still
meaningfully moving* at the step cap (drift > eps over the window, e.g. a rope
well over ~5 m), the solver still reports `converged === false` — which is
honest, because such a pose has not actually settled. The fix resolves the
"settled-but-mis-flagged" cases; it does not paper over genuinely unfinished
relaxations.

### Incidental: pre-existing Biome formatting error fixed to keep the lint gate green

`src/ui/editor/SketchCanvas.tsx` carried a pre-existing over-wrapped condition
(a two-line `||` that Biome's 100-col formatter collapses to one) that failed
`npm run lint` at clean `HEAD`, unrelated to this solver change. Fixed with
`biome check --write` on that file only (formatting, zero logic change) so the
definition-of-done lint gate passes; called out here and in the summary rather
than folded silently into the solver commit.

## Phase 3 — UI infrastructure

The two Phase 3 entry tasks (planfile §11): adopt shadcn/ui + Tailwind for
panel UI, and integrate zoompinch canvas navigation behind a go/no-go spike.
Infrastructure only — no feature UI (info panel/checklist/BOM land later).

### DECISION: Tailwind v4 via the `@tailwindcss/vite` plugin

`tailwindcss@4.3.2` + `@tailwindcss/vite@4.3.2`, pinned exact. The first-party
Vite plugin is Tailwind v4's recommended integration (no `tailwind.config.js`,
no PostCSS chain, no `content` globs — v4 auto-detects sources). Theme lives in
CSS: `src/index.css` holds `@import 'tailwindcss'`, the shadcn design tokens on
`:root`/`.dark` (oklch), and an `@theme inline` block mapping them to
`--color-*`. Imported once from `src/main.tsx`. `tw-animate-css@1.4.0` (the
Tailwind-v4 successor to the deprecated `tailwindcss-animate`) supplies the
enter/exit keyframes shadcn overlays use.

### DECISION: shadcn/ui vendored via CLI, base color neutral, into `src/ui/components/`

Ran `shadcn@4.13.0 add …` against a hand-written `components.json` (style
`new-york`, `baseColor: neutral`, `cssVariables: true`, `iconLibrary: lucide`,
aliases pointing at `@/ui/components` + `@/ui/lib/utils`). Vendored the working
set the later feature slices need: button, input, label, select, tabs,
checkbox, table, dialog, dropdown-menu, tooltip, separator, badge, scroll-area,
toggle, toggle-group. Per the scope-amendment decision there is **no runtime
component-library dependency**: the components are source in the repo; their
only npm deps are the consolidated `radix-ui@1.6.1` (current shadcn imports
from the single `radix-ui` package, not per-primitive `@radix-ui/react-*`),
`class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.6.0`, and
`lucide-react@1.23.0` — all pinned exact. The CLI added no dependency ranges
(everything was pre-installed exact) and did not modify `index.css`.

A `@/*` → `./src/*` path alias was added in both `tsconfig.json` (`paths`, no
`baseUrl` — it's deprecated in TS 6) and `vite.config.ts` (`resolve.alias`), so
the vendored components' `@/ui/lib/utils` imports resolve under tsc, Vite, and
Vitest. Existing relative imports are untouched.

### DECISION: vendored code is formatted to our Biome style, not exempted from lint

The shadcn CLI emits double-quoted, semicolon-free source. Rather than relax or
scope-off any lint rule for `src/ui/components/`, the vendored files were run
through `biome check --write` once (→ single quotes, semicolons, organized
imports). After formatting they pass `biome check` with **zero diagnostics and
no rule suppressions** — shadcn's model is that you own these components, so
treating them as first-party code (not vendored exceptions) is the lower-churn
choice and keeps one consistent style.

### DECISION [biome config change]: exclude the Tailwind entry CSS from Biome

`biome.json` gains `files.includes: ["**", "!src/index.css"]`. Biome 2.5.2's
CSS parser rejects Tailwind v4 at-rules (`@custom-variant`, `@theme`, `@apply`,
`@import 'tailwindcss'`) — it emitted "Tailwind-specific syntax is disabled" and
aborted. `src/index.css` is a Tailwind-v4/shadcn artifact that Biome would only
mangle, so it is excluded from Biome entirely (any future *plain* CSS still gets
linted). No lint *rule* was changed. Logged here per the CLAUDE.md rule that
biome-config changes go through DECISIONS.md.

### DECISION: preflight regression compensated with scoped base styles, not a redesign

Tailwind v4's preflight strips the UA button/input/select affordances the
inline-styled Phase 1–2 chrome (EditorShell, ProjectList, Toolbar,
MechanismTabs, ForcesPanel, TransportBar, ConnectMenu) relied on — bare
`<button>`/`<input>` lose padding, border, and background. Rather than restyle
each component, `index.css` adds a small `@layer base` block restoring neutral
affordances to native controls, scoped with `:not([data-slot])` so it never
touches vendored shadcn components (all of which carry `data-slot`); inline
styles on legacy elements still win, so icon buttons keep `border:none`. This is
the planfile §3 "pre-existing chrome migrates opportunistically … fully
converged by Phase 5" posture — deliberately minimal, no design pass (that is
Phase 5, driven by the design handoff doc). One reference migration proves the
stack: EditorShell's header Export button → shadcn `Button` (outline/sm) and the
save-state indicator → shadcn `Badge`.

Verification: `npm run e2e` (builds + runs the production build) — all 3 smoke
specs green after preflight + the reference migration. (Incidentally corrected a
pre-existing Biome format drift in `SketchCanvas.tsx` that was failing
`npm run lint` on `main`, so the green gate could pass.)

### DECISION: zoompinch integration spike — **NO-GO** → vendor its gesture model

Spike verdict for the planfile §3 / §11 go/no-go: **NO-GO** on integrating the
`@zoompinch/react` / `@zoompinch/core` library as a gesture/transform *source*
for our Konva canvas. Evidence, read from the installed 0.0.18/0.0.42 source:

1. **No headless gesture layer.** `@zoompinch/core`'s only output is a side
   effect: `update()` (core `zoompinch.es.js:254`) unconditionally does
   `element.querySelector('.canvas').style.transform = translate/scale/rotate`
   on a `.canvas` child it *requires*. There is no API that yields raw pan/zoom
   deltas or an absolute transform decoupled from a DOM node it mutates — the
   "gesture math" is not exposed separately from the DOM-transform. Its
   `"update"` event carries no payload; the readable `translateX/translateY/
   scale/rotate` are expressed relative to the canvas element's natural-fit
   `naturalScale` and a top-left origin, not our absolute px/m
   `ViewTransform{scale,cx,cy}`, and its `min/maxScale` is a normalized clamp,
   not our 40–3000 px/m — a lossy impedance layer either way.
2. **Its interactive layer swallows pointer events.** The React wrapper attaches
   mouse/touch/wheel listeners on the `.zoompinch` wrapper (`touch-action:none`)
   and its only non-transformed overlay, `.matrix`, is `pointer-events:none`.
   An interactive editor needs pointer events to reach individual Konva shapes
   (node drag, draw tools, snapping); routing the Stage through zoompinch would
   intercept those at the wrapper (breaking the behavior contract), and routing
   through `.matrix` makes the content non-interactive.
3. The only "consume state only" path is a throwaway hidden `.canvas` that it
   CSS-transforms invisibly while we harvest `translateX/scale` per `update` —
   i.e. carry a parallel DOM node + 2 ResizeObservers + ancestor-motion
   listeners and reconcile two coordinate models, to replace ~4 pure functions
   already in `viewTransform.ts`. Strictly more complexity/risk than the
   documented fallback, discarding zoompinch's only real feature (the CSS
   transform we must not use). The planfile §3 anticipated exactly this.

**Resolution (per user steer "rip out the secret sauce and use that").** Rather
than a from-scratch fallback *or* a literal copy, the reusable model of
zoompinch's `handleWheel` is re-implemented in `src/ui/editor/gesture.ts` and
applied to our own `ViewTransform` (never a CSS transform), so Konva stays
vector-sharp. Re-implemented, **not copied**, because of a license finding
below. The `@zoompinch/react`/`@zoompinch/core` deps were **removed** (nothing
imports them), per the planfile's "remove the dependency again if no-go".

**[correction] License.** The earlier scope-amendment entry recorded zoompinch
as "MIT". That is inaccurate for the published artifacts: `@zoompinch/react`
declares **ISC** and `@zoompinch/core` declares **no license** (GitHub's license
endpoint 404s for the repo). Copying the core gesture source verbatim would be
legally unclear, so `gesture.ts` re-expresses the *technique* (which is standard
and non-proprietary — see the heuristic below) in our own code with attribution,
rather than lifting bytes. Flagged to the user.

### Wheel-mode heuristic (the fallback's gesture model)

`gesture.ts` classifies each wheel event, all pointer-anchored, all via the pure
`viewTransform.ts` helpers (`zoomAt` cursor-anchored + clamp 40–3000, `panBy`):

- **`ctrlKey` ⇒ zoom.** The browser encodes a trackpad **pinch** as a wheel
  event with `ctrlKey` set (every platform); an explicit Ctrl/⌘+wheel on a mouse
  is the same intent. This is zoompinch's own heuristic and the Figma/Maps
  idiom. Cursor-anchored via `zoomAt`.
- **otherwise ⇒ pan.** A two-finger trackpad scroll (or a plain mouse wheel)
  pans by `(deltaX, deltaY)` so content follows the fingers. (Deliberate
  trackpad-first tradeoff: a mouse-wheel notch pans rather than zooms; the mouse
  zoom path is Ctrl+wheel. This is what the planfile's "plain wheel without ctrl
  → pan" calls for.)
- `deltaMode === 0` (pixel) is the trackpad/precision signal — it selects
  sensitivity only, never the pan-vs-zoom decision.
- **Zoom factor is our own curve, not zoompinch's:** `exp(-notches · 0.5)`
  clamped to `[0.5, 2]` per event (notches = pixel `deltaY/100`, else raw). The
  library's linear `1 + k·Δ` goes **negative** for a coarse ctrl+wheel-down
  (Chrome reports mouse wheels as pixel-mode ±100/notch), slamming zoom to the
  floor — the scripted check below caught this; the exponential is always
  positive, symmetric, and bounded.

**Touch:** a two-finger pinch is added via native pointer listeners on the
canvas container (`pinchStep`: finger-distance ratio → zoom, midpoint → anchor +
pan). It only acts on ≥2 touch pointers, so single-pointer draw/drag/select
still flows to Konva (behavior contract preserved); `touch-action:none` on the
container keeps the browser from hijacking the gesture.

**§11 acceptance line served — "pinch/wheel zoom keeps the content vector-sharp
(no bitmap scaling) and pointer-anchored."** Gestures drive `view` React state;
SketchCanvas converts world→screen per point every render, so there is never a
CSS/bitmap scale — content re-renders vector-sharp at any zoom. `zoomAt` anchors
at the cursor. Unit-tested in `gesture.test.ts` + `viewTransform.test.ts` (the
factor stays positive/bounded for any delta; the world point under the cursor is
invariant across zoom). Scripted browser check (throwaway headless Playwright vs
`vite preview`, per the scripted-verification rule, asserting `window.__riglab.
getView()`): ctrl+wheel zooms in/out symmetrically (227→414→227 px/m),
pointer-anchor drift `0`, plain wheel pans without changing scale, no console
errors. **Human gesture-feel check still owed:** real trackpad pinch/two-finger
pan and touchscreen pinch *feel* (momentum, direction sign) on hardware — a
synthetic wheel/pointer stream can't stand in for that.

A tiny durable debug seam `window.__riglab.getView()` (SketchCanvas publishes
its view; EditorShell's hook now *merges* rather than replaces so child seams
survive) makes pan/zoom scriptable without parsing canvas pixels, matching the
existing `getDoc`/`getEditor`/`setEquilibrium` seams.

## Phase 3 — materials + BOM math

This slice is pure data + pure functions + tests (no UI; that lands in a
later slice). BOM lives in `src/bom/` mirroring the solver's purity: inputs
are `Mechanism[] + MaterialsDb + BomSettings` (plain schema data), outputs are
plain data. Shared pipe geometry (`polylineLengthM`, fillet-aware
`developedLengthM`) is extracted to `src/geometry/pipe.ts` and used by both the
solver and the BOM so "developed length" has one definition.

### bomSettings (schema v3)

`projectSchema` gains `bomSettings { heatWrapAllowanceFactor (1.5),
ropeWasteFactor (1.2) }` — the two planfile §6.2 tuning factors, editable, with
those defaults. SCHEMA_VERSION → 3; `migrations[2]` backfills the defaults on
old docs; `createEmptyProject` seeds them. A v2 fixture was added and the v1
fixture strips bomSettings so the full 1→3 chain is tested.

### Seed materials (§6.1, §12)

`seedMaterialsDb()` ships approximate US stock: PVC Sch 40 NPS (1/2"–1-1/2"),
PVC Class 200 thin-wall alternates (3/4", 1"), CPVC CTS (1/2"–1"), fittings for
every NPS and CTS size × six types (mass + socket depth), cordage (paracord,
4 mm nylon, two bungee presets, bowden cable), EVA foam sheets, and hardware
point masses (bolt set, conduit box, garden-hose sleeve, fiberglass rod as a
per-metre reference entry). Dimensions convert published inch/lb-ft catalogue
figures to SI in code (auditable); **every row is `approximate: true`** so the
UI badges them and the user overwrites with calipered stock. Each project owns
its complete seeded DB (§6.1 "overrides persist in the project"); `createEmptyProject`
now seeds instead of shipping empty. The Class 200 3/4" / CPVC CTS 3/4" pair is
a genuine slip fit (≈1.4 mm) — a real telescoping combination.

### Nesting classification + telescope accept/warn set (§6.1)

`nestingClearanceM = ID(outer) − OD(inner)`; bands press `<0`, snug `0–0.5 mm`,
slip `0.5–1.5 mm`, sloppy `>1.5 mm`. **Upper edges are inclusive** (snug owns
exactly 0.5 mm, slip owns exactly 1.5 mm). `nestingMatrix` covers every ordered
distinct pipe pair (nesting is asymmetric). **Telescope accept/warn set:** a
telescope needs to *slide*, so only `slip` is accepted; `snug` (bearing-tight,
binds), `press` (interference, won't slide), and `sloppy` (loose, needs
shimming) all warn. `validateTelescopePair` returns `acceptable = (class ===
'slip')` with a per-class reason.

### Cut-list allowance sign conventions (§6.2)

Per end, applied to the node-to-node (link) or developed (bentLink) base:
`fitting` → **−**socket depth of the matching size/system fitting;
`nestedSleeve`/`nestedCoupler`/`clickDetachable` → **+**2×(this pipe's OD)
added to the member (treated as the inner/inserting member);
`heatWrapPivot`/`heatWrapRigid` → **+**`heatWrapAllowanceFactor` × **partner**
pipe OD; `boltThrough`/`ropeLashing`/`conduitBox` → 0. Net cut length is
clamped ≥ 0. **Partner OD** is the OD of another structural pipe sharing that
end node (lowest element id), falling back to the pipe's own OD when none — the
schema does not pair joint members, so this is a heuristic. **Nested caveat:**
each nested-marked end adds overlap independently; mark only the inserting end
as nested to avoid double-counting across a joint.

### Heat-wrap connector pieces (§1)

Heat-wrap realizations also emit their short bent connectors as separate
cut-list parts (kind `heatWrapConnector`), one per heat-wrap end, material = the
structural member's pipe, **default length `HEATWRAP_CONNECTOR_LENGTH_M = 0.1 m`**
(a fixed reasonable default, editable later). Their (small) mass is included in
the weight rollup's pipe category.

### Telescope member split

A telescope of node-to-node length `L` with overlap `ov = overlapM ?? 2×(inner
OD)` lists **outer = L/2** and **inner = L/2 + ov** (overlap on the inner,
§6.2). Sum = L + ov, so the overlap region counts both pipes (§4.2). Weight
uses these member lengths × their densities.

### Weight vs. cut length

The weight rollup uses each member's **geometric/developed length × density**
(plus connector mass, fitting/cordage/hardware/point masses), while the cut
list uses **length ± allowances**. They differ on purpose: allowances are
fabrication cut adjustments (socket insertion, wrap consumption), not mass
changes. This keeps weight a clean function of member geometry — a swapped pipe
material changes weight by exactly `length × Δdensity` (tested on the example).
Rollups are keyed per mechanism id and per subsystem tag (untagged → `''`).

### Fitting typing + technique summary

The schema records only that a realization is `'fitting'`, not which fitting,
so type is inferred: a link/bentLink end → `coupling`; a pivot → by member
count (2 → elbow90, 3 → tee, ≥4 → cross); a slider is counted in the technique
summary only. Fittings are grouped by type/size/sizing-system with resolved
unit mass. Hardware from realizations maps `conduitBox → hw-conduitbox`,
`boltThrough`/`clickDetachable → hw-boltset`. Technique summary counts every
realization occurrence plus `bends` (heat-bent vertices across bentLinks) and
`telescopes`.

### Partial BOM (unresolved)

Links/bentLinks without a pipe material and telescopes missing either member
material are **excluded** from the cut list and pipe weight but **counted and
reported** in `unresolved { count, elementIds }` so the UI can show a partial
BOM. Their explicit point masses still count (material-independent). Cordage
resolution is separate and does not feed `unresolved`.

### Consumables + [deviation] foam deferred

Rope consumable = Σ rope `lengthM` × `ropeWasteFactor`; elastic = Σ
`restLengthM`; bowden = Σ (`restLengthAM` + `restLengthBM`). **[deviation]**
Foam area (§6.2 lists it under consumables) is **omitted here** — it comes from
assembly `FoamPlate`s (Phase 4), which the single-mechanism/`Mechanism[]` BOM
does not see yet. Noted in code and to be added when the assembly feeds the BOM.
Likewise **mirrored-instance doubling** ("mirrored instances double
automatically", §6.2) is deferred to the Phase 4 assembly BOM; this slice sums
mechanisms as authored.

### Cost + CSV shape

Cost is emitted only for materials carrying a `unitPrices` entry (pipe/cordage
priced per metre of cut length, fittings/hardware per unit); `totalCost` is
`undefined` when nothing is priced (cost column hidden, §6.2). `bomToCsv` is
hand-rolled (per the Phase 0 CSV decision), RFC 4180 quoting (comma/quote/CR/LF
→ wrapped, embedded quotes doubled), CRLF line endings, four labelled sections:
Cut list, Fittings, Consumables, Weights.

### [deviation] Solver `elementLinearDensityKgPerM` (additive)

`SolveInputs` gains optional `elementLinearDensityKgPerM: Record<string,number>`
— a per-element (engineered) linear-density override keyed by element id,
falling back to the Phase 2 generic `linkDensityKgPerM`. Wired into
`accumulateMasses`; output shapes untouched, kinematic mode unaffected. This is
the Phase 3 continuation of the Phase 2 `linkDensityKgPerM` note (per-material
densities were explicitly deferred to here). The BOM/materials UI layer will
feed these from assigned pipe materials. Marked a deviation only in that it
extends the otherwise-frozen `solve()` interface, additively.

### Bundled seesaw-spine example (§9 item 1)

`src/examples/seesaw-spine.json` is the shipped data artifact, generated from
the authoritative builder `buildSeesawSpineProject()`; `loadSeesawSpine()`
validates it via `projectSchema`, and a test asserts the two agree (no drift).
It is an elevation rope-braced truss (parallel chords + tension X-braces),
hip-rect four-point anchors, neck + tail booms, head/tail point masses, gravity
on, every pipe engineered with a seed material + realization and tagged
neck/spine/tail. All structural pipes share one size so a heat-wrap partner OD
equals the pipe's own OD, which keeps the §11 acceptance arithmetic clean. The
example's display name may reference the reference build; no creature term
appears in any identifier or string (asserted in a test). The §11 headline test
computes the expected cut-list total **independently** (reimplementing the
allowance arithmetic from geometry + realizations, not by calling `computeBom`)
and asserts it equals the summed structural-pipe cut parts exactly.

## Phase 3 — design face UI (stage 2a)

Face toggle, multi-select, the info panel (§8.2a), and the pure resolution
module. The docked checklist PANEL, materials editor, nesting matrix view,
BOM panel/CSV button, and units toggle land in the next slice.

### DECISION: face is transient editor state, not a document property

`editorStore.face: 'sketch' | 'design'` (default sketch), toggled from the
top bar (§8.3), kept across mechanism switches and never persisted — the two
faces are lenses on one model (§8 "switching never destroys data"), so a
document field would be wrong and a per-mechanism field would make the
toggle feel modal. `window.__riglab.getEditor()` exposes it for scripted
verification.

### DECISION: multi-select semantics

`selectedElementIds: string[]` replaces the single id. Plain click replaces
the selection; shift/⌘/ctrl-click toggles membership (click order kept);
a stationary click on empty canvas clears (modifier-clicks don't, so
accumulation survives a missed shift-click); Delete/Backspace deletes the
whole selection as ONE `updateCurrent` = one undo entry. Since pivots and
sliders have no clickable stroke of their own, a stationary click on a node
selects the joint element living there — that plus the info panel's
clickable connections list makes joints reachable for realization
assignment. The single-select path behaves exactly as before (sketch e2e
spec unchanged and green).

### DECISION: resolution-item taxonomy (src/design/resolution.ts)

Pure, framework-free, shared by the info panel now and the checklist panel
next slice. Kinds (per §8.2's checklist list):
`missingMaterial` (link/bentLink without pipe material; telescope emits one
item per missing member), `missingRealization` (explicit pivot/slider
without realization), `telescopeNestingIncompatible` (both members assigned
but not a slip fit, via validateTelescopePair), `ropeRequiresCompression`
(from solve diagnostics when available), `overconstrained` (diagnostics
classification), `unboundChannel` (input channel with no driven node whose
`channelId` references it). Severity: `todo` = an assignment the user must
make (counts toward the "K of N resolved" progress, where N = material +
realization + channel-binding slots); `warning` = a computed problem with
no slot. Both kinds must clear for "buildable" (§8.2 checklist-zero).
Two scoping decisions: **link END realizations are optional refinements**
(a butt cut is valid; the joint's requirement lives on the pivot/slider
element) and do not create items; **implicit shared-node pivots** (plain
pivot connections create no PivotElement) carry no realization slot,
matching computeBom. Open question carried to the checklist slice: should
the checklist offer "materialize a pivot element at this junction" so those
joints can get realizations/BOM mass?

### DECISION: maturity auto-flips with assignments (derivedMaturity)

link/bentLink → engineered when a pipe material is assigned; telescope →
both members assigned; pivot/slider → realization assigned; rope/elastic/
bowden/torsionCable → cordage material assigned. Symmetric: unassigning
drops back to sketch. Applied inside every assignment docOp so maturity can
never disagree with the data. End realizations don't participate (optional,
above). Assigning a cordage with a stiffness preset to an elastic adopts
the preset k (§4.2 "materials with presets").

### DECISION: setLinkLength convention (§11 "editing a link length moves the geometry")

Endpoint A stays fixed; B moves along the current A→B direction to the new
length (degenerate zero-length links extend along +x). Telescopes clamp to
[min, max] and update their `lengthM` parameter too. Only node B is
written; connected geometry is NOT propagated by the op — the next
kinematic solve reconciles the mechanism onto the constraint manifold,
which is the same convention node-dragging already uses. Each field commit
(blur/Enter) is a single `updateCurrent` = one undo entry.

### Info panel notes (§8.2a)

- One right-docked collapsible panel for both faces; sketch face shows
  identity/geometry/behavior/connections only (zero engineering fields,
  §8.1); design face adds materials, realizations, computed mass (telescope
  overlap counts both members, matching the BOM split), nesting badge,
  force readout (element force from the equilibrium overlay state), and the
  element's unresolved items. Multi-select is the §8.2 bulk-assignment
  surface (bulk pipe/cordage/realization; "apply to similar" assigns the
  current material to all same-type elements without one).
- Elements have no `name` in the schema; identity shows type + short id.
  No schema bump for a name field in this slice (planfile §8.2a lists
  "name" — deferred until something needs it; flagged to the user).
- Panel shows SI metres/kg; the §8.3 units toggle (and imperial conversion
  at the UI boundary) is next-slice scope, matching the rest of the app.
- Resolution warnings consume a diagnostics view assembled from readouts
  the UI already has (DOF badge + equilibrium overlay) — no extra solve.
- Component tests (Testing Library + jsdom, per the test-pyramid decision)
  assert selection→fields, edit→document, multi-select→bulk surface, and
  connection navigation. Radix Select dropdown interaction is deliberately
  not driven in jsdom (portal/pointer-capture friction for no coverage
  gain); the assignment ops are unit-tested in docOps.design.test.ts.

## Phase 3 — design face UI (stage 2b)

The remaining Phase 3 feature scope, implemented in the main session after
the user retired the subagent workflow mid-phase: units toggle + conversion,
material-density plumbing into equilibrium, the docked resolution checklist
with click-to-fix, the editable materials panel with the live nesting
matrix, and the BOM panel with CSV export.

### DECISION: units conversion at the display boundary; toggle on the project

`src/ui/units.ts` (exact factors: 1 in = 0.0254 m, 1 lb = 0.45359237 kg)
converts for display/editing only — every stored quantity stays SI, per the
schema policy. The top-bar toggle (§8.3) writes `Project.unitsPreference`
and mirrors to the localStorage pref, which now seeds NEW projects (the
previously dead `prefs.getUnitsPref` seam). Length-dimensioned inspector
fields display and edit in the preferred unit through `LengthField`/
`MassField` wrappers (typing 100 in an imperial length field commits
2.54 m). Deliberately still SI regardless of preference: linear densities
(kg/m), spring rates (N/m), pressures/none — converting shop-familiar
lengths and weights covers the §11 need without inventing lb/ft plumbing;
revisit if real use asks for it.

### DECISION: engineered densities reach solve() via the caller

`elementLinearDensities` (src/design/densities.ts, pure) maps engineered
pipes to their material's kg/m — a telescope gets the effective density
reproducing computeBom's member split (outer L/2, inner L/2 + overlap) —
and SketchCanvas passes it with the generic-pipe fallback into
`solve('equilibrium')` only. The kinematic drag path is untouched (mass is
irrelevant there and the drag loop is the hot path). bentLink densities
integrate over the polyline length inside the solver while the BOM uses
fillet-aware developed length — an accepted small approximation for
equilibrium mass, noted here rather than papered over.

### DECISION: checklist click-to-fix via a one-shot transient focusHint

The design face docks a tabbed right panel (Inspector | Checklist |
Materials | BOM — §8.2's "docks alongside" reading at laptop widths).
Checklist items come from the shared resolution module; clicking one
selects the element, switches to the Inspector tab, and sets
`editorStore.focusHint` ({control: material|realization|channel}); the
matching `FocusTarget` wrapper (or the ForcesPanel channel chip) scrolls
into view, ring-highlights, and clears the hint after ~1.6 s. Warning-only
items with no element (overconstrained) are informational, not clickable.

### DECISION: BOM is partial-with-banner, not gated (§11 "gated on (or
clearly partial until) checklist completion")

Hard-gating the BOM on checklist completion would punish the play-first
loop (§2) — a half-engineered sketch still has a useful shopping list. The
BOM tab renders everything resolvable and shows a prominent "Partial BOM —
N elements without engineering data excluded" banner that routes to the
checklist; the banner disappears at zero unresolved. computeBom already
reported the unresolved set, so the UI adds no second bookkeeping.

### DECISION: approximate-flag clearing rule

Editing any NUMERIC field of a materials row clears its `approximate` flag
(the user is presumed to have entered a measured value — §6.1 calipered
overrides); renames and enum changes keep it. Add-row defaults are plausible
placeholders flagged approximate. Delete is disabled while
`materialReferenceCount` > 0, so the panel cannot produce dangling material
references.

### "balance report" in the §11 live-update acceptance — Phase 3 reading

§11 asks that a pipe-size change updates "weights, balance report, and
nesting matrix live". The seesaw balance report proper is a Phase 4 3D
assembly output (§5.4); in Phase 3 the equilibrium force readouts are the
balance-shaped consumer of mass, and they re-solve on every document edit
(now with real material densities). Weights (BOM tab + design-face summary)
and the nesting matrix recompute live from the same document change.

### Materials panel layout note

Rows are card-shaped (name line + labelled numeric grid) rather than wide
tables — the dock is 384 px and OD/ID/density/socket fields would not fit
legible table columns. The nesting matrix is a real table (outer rows ×
inner columns, §6.1) with per-cell classification badges and mm-clearance
tooltips, horizontally scrollable past ~6 pipes.

### Seed pipe values re-sourced to published catalog/standard figures

Joe asked for the default library (kept to US-inch PVC and CPVC, which is
what it already contained) to carry actual vendor values, pointing first at
mcmaster.com. McMaster-Carr login-walls unauthenticated browsing, so at his
direction the values come from published standard tables instead: PVC Sch 40
OD/ID/lb-ft per the ASTM D1785 table (engineeringtoolbox.com d_795), Class
200 dimensions per the ASTM D2241 SDR-21 column with lb/ft from the Cresline
CNWPVC-21 catalog sheet, and CPVC CTS per the ASTM D2846 SDR-11 table
(engineeringtoolbox.com d_1664). Net effect: Sch 40 1"/1-1/4"/1-1/2" got
~5% heavier; Class 200 and CTS CPVC got 7–25% lighter. Dimensions were
already the standard values and are unchanged, so the nesting matrix and the
seeded slip-fit pair (CTS 3/4" in Class 200 3/4", 1.40 mm clearance) are
unaffected. Rows stay `approximate: true` — extrusion tolerance still makes
calipered overrides the real source of truth (§12). Fitting masses remain
estimates; no per-fitting mass data was reachable without a McMaster login.

## Phase 5 (examples slice, started 2026-07-04)

### Phase 5 examples started before Phases 4/4.5, at Joe's direction

Joe asked for the examples part of Phase 5 while the interface-overhaul pass
runs, with UI polish deferred. Phases 4 (3D assembly) and 4.5 (controls) are
not built, so §9 examples 2–6 ship complete but example 7 ships in **2D
scope**: all eight mechanisms (spine, neck, steer, jaw, both legs, tail,
arms) in one project with speaker/battery masses and a fully resolved global
BOM. Its yoke control (§4.4), the head-sweep + jaw-snap control clip, and 3D
instance placement are deferred until their schema exists; the same applies
to the control-tracks section of docs/movement-clips.md. Per Joe's request
the full-creature project doubles as the Project Raptor recreation — named
"Raptor" in its data file only, which §9 explicitly permits.

### Example JSON artifacts are generated, builders are authoritative

Each example has a typed builder (src/examples/*.ts) and a committed JSON
artifact; `node scripts/generate-examples.mjs` bundles the builders with
rolldown (vite's bundler — the repo has no esbuild/tsx) and rewrites the
JSONs; sync tests fail on drift. Rope/elastic rest lengths derive from drawn
node positions (rounded to 0.1 mm) so geometry edits can't desync them.

### Example modeling decisions forced by solver semantics

- **Driven displacement nodes ride sliding telescopes** (steer grip, jaw
  trigger): a rigid rail link contradicts the prescribed position and blows
  up the solve. Bonus: the examples now demonstrate the telescope element.
  Both use the seeded CTS-in-Class-200 slip-fit pair.
- **Rope-coupled behaviors are channel-driven, not drag-driven**: kinematic
  mode leaves rope/elastic/bowden inert by design, and equilibrium mode
  ignores dragTargets, so the steer mirror gets a "steer pan" angle channel
  and the neck a "steer pitch" displacement channel. Open UX question for
  Joe: dragging the steer tip in sketch mode will NOT mirror the head until
  equilibrium overlay runs — if drag-time rope coupling matters, kinematic
  mode needs rope max-length constraints (a solver-semantics change I did
  not make unilaterally).
- **Neck pitch uses the original build's up/down rope pair** (chin eyelet +
  over-mast return): a single rope leaves the boom resting on its lashing
  angle limit, which XPBD reports as violated; the taut pair pins the
  attitude in the limit interior and converges cleanly.
- **Channel ranges are sized to stop short of hard limits** (jaw closes at
  0.038 of a geometric 0.0447; neck pitch min −0.03) so slider extremes
  never drive an inextensible cable into an angle stop.
- **The toe pivot has a mechanical stop behind the travel-limit rope**: the
  rope engages first (~0.29 rad) whenever forces are simulated, preserving
  the §9 rope-as-limit demonstration, while the stop keeps the toe sane
  during kinematic clip playback where ropes are inert.
- The full-creature solve test excludes seesaw-spine: its settle residual
  under gravity predates this slice and is covered by its own Phase 3 suite.

### Movement clip library completed

`dance`, `sit down / stand up`, `crouch`, `idle sway` join walk/arm swing/
lean. All loop seamlessly; sit and crouch hold their low pose mid-cycle so a
paused scrub reads correctly. The "New from example" menu itself is UI and
lands in the Phase 5 **finishing slice** (menu, onboarding, shortcuts,
printable BOM, perf, visual polish) after the interface-overhaul pass — Joe
confirmed this sequencing 2026-07-04; the planfile §11 Phase 5 entry records
the two-slice split. The EXAMPLES registry in src/examples/index.ts is ready
for the menu.

## Interface overhaul — "floating glass" editor (2026-07-04, user directive)

Implemented from the design handoff `design_handoff_editor_overhaul` (dropped
into the repo as "Riglab interface overhaul.zip"), ahead of the planfile's
"design handoff drives Phase 5 polish" schedule — user directive ("implement
all of those changes before continuing with any of the other phases");
planfile §3 amended in the same change. The hi-fi file is the visual spec;
wireframes 1e/1f are the normative interaction storyboards.

### What replaced what

Full-bleed canvas; all chrome floats above it at the handoff's 16 px margins:
`EditorShell` (rewritten) hosts `ProjectChip` (← header + MechanismTabs),
`ActionsChip` (← header right half), `ToolPill` (← Toolbar), `TransportPill`
(← TransportBar + ForcesPanel), `DofPill` (← DOF badge). On-canvas overlays
inside SketchCanvas: `DimensionChips` (length chips per storyboard 1e),
`JointPopover` (← ConnectMenu, doubling as the snap-connect menu per 1f), and
`SelectionCard` (← the sketch face's docked InfoPanel). The design-face
RightDock (inspector/checklist/materials/BOM) keeps its full feature scope,
floating as a right-hand column — the overhaul spec is chrome + interaction,
not design-face features. Old components deleted; IBM Plex Sans/Mono
self-hosted via @fontsource (pinned exact; no runtime network). Design tokens
live in `src/ui/editor/theme.ts`.

### DECISION: canvas-anchored popovers/chips are bespoke divs, not Radix

The handoff suggests shadcn Popover/DropdownMenu. Canvas-anchored surfaces
(joint popover at a node, dimension chips, DOF card, transport menus) are
positioned from the view transform and must be pixel-faithful to the handoff;
Radix anchoring wants a DOM trigger, and portal/pointer-capture friction makes
jsdom component tests flaky (same reasoning as the earlier "Radix Select not
driven in jsdom" note). They are plain positioned divs styled from theme.ts;
shadcn primitives remain in the design dock and forms. One popover at a time
via `editorStore.openPopover`; canvas mousedown or Esc dismisses.

### DECISION: lengthLocked is a document property (schema v4) that guards
### geometry edits; posing already preserves lengths

`link`/`telescope` gain optional `lengthLocked` (SCHEMA_VERSION 3→4,
stamp-only migration — the field is optional). Locks undo/redo and persist,
per the handoff. Semantics: the kinematic solver has always held every pipe
length rigid while posing ("pipe lengths always win over the pointer"), so
the lock's operational meaning is to refuse *direct geometry edits* — the
endpoint-handle drag, chip scrub, and typed values — and to render the solid
blue chip. It does not add a solver constraint (none is needed for posing).

### DECISION: endpoint-handle drag is a direct geometry edit

Dragging a selected, unlocked pipe's white endpoint handle moves that ONE
node directly (document write per frame, one undo entry via the gesture
bracket), with node/skeleton/anchor snaps first, then length ticks at ½ in
(imperial) / 1 cm (metric), else the raw pointer — storyboard 1e·2, with
dashed ghost + live readout chip. Connected geometry is not propagated; the
next kinematic solve reconciles (same convention as setLinkLength). Two
oscillation bugs found and fixed during verification (one reported live by
Joe as "endpoints jump all over"): (a) `findSnap` could snap the dragged
endpoint onto its own pipe's span — a target that moves with the pointer —
fixed with `SnapContext.excludeElements` (every element incident to the
dragged node); (b) the HTML chip/card overlays sit above the Konva stage and
swallowed mid-drag pointer events — fixed by making chips click-through
(`pointer-events:none`) during any drag and unmounting the selection card
while dragging. Regression-covered in snapping.test.ts and by the scripted
browser check (node must track the pointer ≤20 px at every waypoint).

### DECISION: joint popover actions map to new pure docOps

`setNodeJoint(pivot|weld|anchor)` (weld = pivot element with every member
pair welded; pivot = clear welds; anchor = ground the node, un-anchoring on
pivot/weld), `detachNode` (each incident element beyond the first gets its
own node copy; joint elements at the node removed), `setLengthLocked`,
`reverseLink`, `splitLinkAtMidpoint` (reuses splitLink's weld-at-split
convention). Simplifications, deliberately: the Slider row is shown but only
as the *current* state (converting an existing junction to a slider needs an
along-pipe host and is out of the handoff's scope — sliders are still created
by drawing onto a pipe); a detached rope eyelet keeps its own node. In the
**design face** (user follow-up during the pass), clicking a node that owns a
pivot/slider element opens the same popover listing **realizations** (via
`assignRealization`, maturity auto-flips) instead of joint types — the
engineering question at that point; joint-less nodes still get the type menu.

### DECISION: conflicts pill derives from existing diagnostics only

`deriveConflicts` (pure, tested) folds what the store already has — violated
element ids, `ropesRequiringCompression`, the DOF classification — into rows
with honest wording; no second solve. One-click fixes are wired only where a
concrete docOp exists today: "unlock length" on a violated locked pipe and
"unlock a length" on over-constrained-with-a-locked-pipe. Other rows (angle
limit, taut limit, requires compression) are click-to-zoom only — the
handoff's richer fix set (merge pivots, set rest length, reroute eyelet)
needs ops that don't exist yet and was not invented speculatively. Zoom is a
one-shot `focusElementId` request the canvas consumes.

### Smaller notes / deviations

- **Esc + single-key tool shortcuts** (V P L F R E B T N) land now (they are
  the handoff's §Interactions), overlapping the Phase 5 "keyboard shortcuts"
  line; space=play/pause and duplicate remain Phase 5.
- The old toolbar's **trace-motion-path** checkbox survives as a `trace`
  chip on the transport pill (the handoff omits it; dropping a working
  feature wasn't warranted).
- **Units toggle** is now a single mono chip cycling in/lb ↔ m/kg (the
  handoff shows a static "in/lb" label; the old two-segment control's
  function is kept, its form is the handoff's).
- **Export** is a direct button (single action today) rather than the
  handoff's "Export ▾" menu; the caret returns when a second export exists.
- The **tool pill** gained a grip drag-handle (user follow-up; wireframe
  1c's pill is annotated "drag to move") — transient offset, like the card.
- The **selection card** natively implements the handoff's pipe rows
  (length+lock, End A/B joint chips, Split/Reverse/Delete) and embeds the
  existing ElementInspector/MultiInspector for every other element type and
  multi-select, so no §8.2a capability was lost with the docked sketch-face
  panel. It is draggable by its header (the handoff marks the card
  "draggable/pinnable"); pinning across selections is not kept.
- InfoPanel's standalone collapse rail was removed (it now only lives inside
  the design dock); its component tests were updated accordingly.
- e2e specs updated for the new chrome (mechanism menu, inputs popover);
  suite stays at 3 smoke specs, all green against the production build.
- Incidental: a pre-existing `lint/a11y/noLabelWithoutControl` error on
  MaterialsPanel's `Labeled` helper (unmodified since stage 2b) failed the
  lint gate at HEAD; suppressed with an inline reason (the input association
  is by nesting through `children`, invisible to static analysis).

### "approximate — edit me" badge removed (planfile deviation, user-directed)

With seed pipe values re-sourced to published catalog/standard figures, Joe
asked to drop the badge — flagging real D1785/D2241/D2846 numbers as "edit
me" was noise. The §12 badge mandate is updated in the planfile in the same
change. The `approximate` field STAYS in the schema and keeps its semantics
(seeded/added rows true, cleared by any numeric edit): it costs nothing,
avoids a schemaVersion bump + migration, and preserves the "which rows has
the user actually measured" signal should a future consumer (e.g. the
resolution checklist) want it. Only the MaterialsPanel badge rendering and
its test assertion were removed.

### Settled equilibrium pose renders on canvas (forces overlay on)

Joe expected his sketch to hang under gravity and the canvas never moved:
the equilibrium solver already computed the settled sag (§5.2 pseudo-dynamic
relaxation) but `readEquilibrium` kept only the force numbers and threw the
positions away. We read the planfile's "must run fast enough to re-settle
live while the user drags a slider" (§5.2) as intending the settled *pose*
to be displayed, not just its force labels, so this is completing planned
behavior rather than a scope change. `EquilibriumReadout` now carries
`positions` and the canvas prefers them via a pure `pickRenderPositions`
helper: a live node drag always wins (the readout is frozen mid-gesture, so
it would be stale), then the settled pose while the forces chip is on
(merged over drawn geometry so nodes added since the last solve still
render), then the kinematic playback pose, then drawn geometry. Gravity
alone still moves nothing — the sag display is gated behind the explicit
forces toggle, keeping the sketch face's drawn-geometry editing predictable
(§8.1). A `getRenderPositions` debug seam joins `getView` on `__riglab` so
the scripted browser check asserts the actual render path; verified against
the production build (tail example sags 0.27 m converged, reverts exactly
on toggle-off).

### Design-face joint popover always offers realizations, even for implicit pins

The joint popover already swapped joint-type rows for the realization picker
in the design face — but only when the node carried an *explicit* pivot or
slider element. Ordinary free-pin pivots are stored as implicit joints (a node
with ≥2 members and no pivot element; see `setNodeJoint`'s "no explicit pivot
element = an implicit free pin already"), so the common case still showed
joint types in design mode. Joe asked for the joint dropdown to show
realization types instead of joint types in design mode, so the gate now keys
off `jointKindAtNode` (pivot/weld/slider → realizations) rather than the
presence of an element. Anchors and free ends keep the joint-type menu —
`JointRealization` describes how a *joint* is physically made, so it has no
meaning there. To let an implicit pin be realized, a new
`assignNodeRealization` docOp finds-or-materializes the pivot element:
choosing a realization creates a bare free-pin pivot (`welds: []`) carrying
it, and clearing the realization on a bare pin removes the element again so no
redundant free-pin pivot lingers (welded pins, angle limits, and torsion
springs are preserved on clear, matching the prior `assignRealization`
behavior). This is a UI-behavior refinement within the §6 design-handoff
scope, not a schema or planfile change. Note: switching a joint's *type*
(weld ↔ pivot, detach, anchor) now lives only in the sketch face, consistent
with the sketch=topology / design=realization split the overhaul already
established for welded pivots and sliders.

### Design-face realizations are gated to the joint kind (2026-07-04, user directive)

Joe noted that "some of the realization types should be gated based on the
type (pivot, slider, weld, anchor, etc)": the realization picker was offering
all nine `JointRealization` values for every pivot/weld/slider node, including
physically-impossible pairings (a heat-wrapped *pivot* on a rigid weld, a
rigid *fitting* on a pivot). A realization is the physical way a joint is
built, and each one only produces certain kinematics, so the menu now gates by
`jointKindAtNode`. Chosen policy (confirmed with Joe: "physical-native"):
each realization is shown only for the kind(s) it can actually produce, with
the rest rendered disabled/greyed rather than hidden so the menu stays
positionally stable (matching the existing `JointMenu` disabled-row pattern).
Mapping, derived from the planfile §172 realization descriptions plus §100
(conduit-box = slider) and §231/§235:

- **pivot** (rotates): `heatWrapPivot`, `boltThrough`, `nestedSleeve`,
  `ropeLashing`, `clickDetachable`
- **weld** (rigid): `heatWrapRigid`, `nestedCoupler`, `fitting`
- **slider**: `conduitBox`, `nestedSleeve`, `clickDetachable`

`nestedSleeve` (a bearing/slip pair) and `clickDetachable` (slip fit +
retaining screw) are the two dual-kind realizations — each works as either a
pivot or a slider, so they appear (enabled) under both. A currently-set but
now-incompatible realization stays visible disabled-with-checkmark so a
mismatch reads instead of vanishing; the user can pick a valid one or unset.
This is a UI-gating refinement within the §6/§8 design-handoff scope, not a
schema change (the enum and BOM allowance math are untouched). Encoded as
`REALIZATIONS_BY_KIND` in `JointPopover.tsx`. **Deferred:** the per-element
realization selects in the info-panel `ElementInspector`/`MultiInspector` are
*not* yet gated — they still offer all nine. Left alone to avoid scope creep
beyond the popover Joe pointed at; flag for a follow-up if consistency there is
wanted.

### Wearer-bound nodes are moving anchors in equilibrium (drag-held nodes)

Joe's shoulder-mounted linkage didn't dangle with forces on: equilibrium
mode ignored `inputs.dragTargets` entirely (only `anchor`/`driven` nodes
were held), so a skeleton-bound node was just a free particle and the whole
chain free-fell instead of hanging off the body. Marking the node `anchor`
pinned it to the world and broke clip playback. Now a drag-targeted free
node is held AT its target in the equilibrium build — the drag is an
external holder (the wearer's body via a binding, §7, or a hand) that
supplies whatever reaction the pose demands — so bound linkages dangle and
re-settle as the clip moves the body. Anchor/driven nodes ignore drags,
mirroring kinematic mode. Drag-held nodes are likewise excluded from the
rope-compression static balance (the holder takes the load, so members are
never asked to push to support them). DOF/mobility counting is unchanged:
drags are transient inputs, not topology. Acceptance tests in
`heldDangle.acceptance.test.ts` (dangle geometry + link tensions ±2%,
moving target, anchor parity, no compression false-flag). Note: the
leg-exoskeleton example now reports ~0.2 mm of violation at the ankle — it
pins the exo to both world anchors and three body points, and its drawn
geometry can't satisfy both exactly; it was already non-converged before
this change (settle timeout).

### Transport pill wraps instead of sliding under the DOF pill

`e2e/forces.spec.ts` went red on a layout race, not solver behavior: at a
1280 px viewport with the forces overlay on, a long solver status
("non-converged") widened the centered transport pill until its trailing
"inputs" toggle sat underneath the bottom-right DOF pill, which intercepted
the click. The spec only ever passed by clicking during the brief
"settling…" window. Pre-existing fragility, surfaced by this session's e2e
reruns. Fix: the pill gets `flexWrap` + `maxWidth: calc(100vw - 360px)`
(360 = symmetric clearance for the DOF pill + edge margins), so on narrow
windows it wraps to a second row and every control stays clickable.

### Binding points always visible; drag-to-bind a pivot in the select tool

Two friction points around wearer bindings (planfile §7.1/§7.3): the silhouette
skeleton points and structural anchors were only drawn when the tool was not
`select` (or mid-Bind-gesture), so in the default pose tool the bind targets
were invisible; and the only way to bind an existing node was the modal Bind
tool's two-click gesture. Joe asked that the binding points always be visible
and that a pivot always be snappable/bindable to them. The silhouette points
and anchors now render whenever a silhouette exists — matching §7.1 ("named
anchors and skeleton points appear as snappable points"). And the select-tool
node drag now snaps to a skeleton point when the pointer lands within snap
tolerance (targeting the point so the pivot visually locks on) and, on release,
creates the skeleton binding via `addSkeletonBinding` — the "drag from a
skeleton point to a node" gesture §7.3/§197 calls for, reachable from day one in
select without switching tools. The dedicated Bind tool stays as-is; this is an
additive gesture. `findSnap` already ranks skeleton points at priority 1 (above
pipe spans/grid, below a coincident live node), so no snap-resolution change was
needed — only the drag wiring. Pure coverage: `findSnap` skeleton-snap tests
(priority + self-exclusion) in snapping.test.ts; the gesture itself is verified
against the production build via the scripted `__riglab` hook (dragging the
example's pivot onto `handL` produced one skeletonBinding), per the "browser
verification is scripted" rule for drag/snap feel.

## Phase 4 — 3D assembly composition (§5.4)

### DECISION: composition is a separate pure module (`src/assembly/`), not part of solve()
§5.4 composition is explicitly *not* a 3D solver — it is kinematic layering over
per-mechanism `solve()` results. Keeping it out of the solver preserves the
`solve(mechanism, inputs, mode)` contract (§12: no assembly types in the solver
interface) while still being pure and framework-free. `compose.ts` consumes plain
`solve()` output + a wearer `SkeletonFrame` and returns plain records; `math3.ts`
provides dependency-free vec3/quaternion helpers (no three.js) so the layer is
fast to unit-test. `orchestrate.ts` (`composeProject`) ties `solve()` + skeleton
bindings + `composeAssembly` into the driver the 3D viewport reads each frame.
The r3f UI converts these plain records to three objects only at the boundary.

### DECISION: instance lift + mirror convention
An instance lifts a solved 2D node `(x,y)` to world via
`origin + rot·(mirror ? −x : x, y, 0)`. `mirror` reflects the *local x axis*
(not world z), which composes cleanly with the side-left/side-right view
projection: the right leg reuses the same body plane but its mechanism is
authored in `side-right` (x already flips), so `mirror:true` restores world +x
while `position.z` drops it onto the right hip. The unit tests pin this; the
full-creature acceptance confirms left/right shoes end up mirror-imaged.

### DECISION: transform-drive frame for `instanceNodes` (pan × pitch)
When an instance is driven by two of a parent instance's solved nodes, the base
frame is: origin = origin-node world; local +x → the origin→axis heading; local
+y → world up (kept upright so a rope-pitched head plane driven by a pan
mechanism stands vertical). Degenerate heading∥up falls back to a fixed z axis.
Authored `position`/`quaternion` then compose on top as a local offset. This
captures the §5.4 neck pan×pitch layering without a general 3D solver.

### DECISION: full-creature example placed in 3D (Phase 4 promotes it out of "2D scope")
The example (§9 item 7) now places all eight mechanisms as assembly instances:
sagittal mechanisms lift with identity at z=0 (their 2D coords are already true
scale about the wearer); the plan-view steer mechanism rotates +90° about x into
a horizontal deck; legs offset to ±hipWidth/2 with the right leg mirrored. Body
masses (speaker, battery, head+foam, tail counterweight) attach to wearer
anchors / seesaw instance nodes so the CG and seesaw balance report have clear
front/back arms. The yoke control + control clip (§4.4) still await Phase 4.5.

### Balance report: horizontal-arm formulation
`balanceReport` sums `m·g·|arm|` where `arm` is the mass's projection on the
horizontal `frontDir` (⊥ the pivot axis). Moment about a horizontal axis under
gravity depends only on horizontal distance, so vertical offsets contribute
nothing — pinned by a unit test. Counterweight suggestion returns the mass at a
chosen light-side point that zeroes the imbalance. The §11 ±2% acceptance checks
the report against an independent hand sum of the composed masses' world x.

## Phase 4 — 3D Assembly viewport (§8.3)

### DECISION: `mode: '2d' | '3d'` is transient editor state orthogonal to face
The global 3D Assembly mode (§8) is a top-level `mode` on the editor store,
independent of the sketch/design `face` (faces are 2D-only lenses). The
ActionsChip carries a 2D/3D segmented toggle; the face toggle hides in 3D. The
shell swaps SketchCanvas for AssemblyView and drops the 2D-only chrome (tool
pill, DOF pill, design dock). The clip transport stays mounted in both modes —
its raf loop advances `playback.tS` in the store, so a movement clip animates
the 2D canvas and the 3D assembly from one timeline with no second loop.

### DECISION: r3f viewport reads the pure composition each frame
`useAssemblyScene` samples the current clip pose, runs `composeProject`, and
derives world-space line segments (mechanism elements + mannequin bones), the
mass markers, and the balance report — all from the pure assembly layer. The
composition is computed once in AssemblyView and passed into the in-Canvas
Scene3D (not recomputed there) to avoid double-solving per frame. Instances draw
as `lineSegments`; the CG is a sphere with a drop line to the ground grid.

### DECISION: 3D CG/mass includes engineered-pipe self-weight
`composeProject` feeds per-instance distributed pipe masses (each drawn segment
= developed-length × the same material linear density the equilibrium solver and
BOM use, at its midpoint) into the composition, so the 3D CG reflects the PVC
rather than only bolt-on point/foam masses (the full creature reads ~6.3 kg, in
line with its BOM). Toggleable via `includePipeMass` (default on). The §11 ±2%
moment acceptance stays valid — it compares the report against a hand sum over
whatever masses compose produces.

### [deviation] Placement gizmo + binding editor scope for Phase 4
§8.3 lists "placement gizmos + mirroring" and a "binding editor". Delivered:
mirroring (per-instance checkbox), a translate gizmo (drei TransformControls)
for fixed-drive instances committing through the `setInstanceTransform` docOp,
a scene tree, editable point-mass masses, a pivot-axis picker, and the live
mass/CG/seesaw analysis sidebar. **Deferred:** the rotate gizmo, gizmos for
driven (`wearerAnchor`/`instanceNodes`) instances whose transform is computed
rather than authored, and an in-3D attachment/skeleton **binding editor** —
instance placement and bindings are authored in the example builders and the 2D
sketch face for now. This does not affect the §11 Phase-4 acceptance (which is
green as automated tests); it trims §8.3 chrome polish, to be revisited in the
Phase 5 finishing slice alongside the visual pass. Called out per CLAUDE.md.

### Scripted verification: `__riglab.loadExample` seam + assembly e2e smoke
A dev-only `__riglab.loadExample(id)` seam (sibling of the existing
`setEquilibrium` seam) loads a bundled example as the live document so the
Phase-4 UI is verifiable before the Phase-5 "New from example" menu exists.
`e2e/assembly.spec.ts` loads the full creature, switches to 3D, and asserts the
WebGL viewport mounts, the mass readout is a plausible creature weight, and the
seesaw readout renders with no page errors.

### DECISION: Quad-workspace extension gets its own planfile
Joe's 2026-07-04 direction (visible 3D synthesis of all mechanisms, a
pipe-and-fittings model render, and a Rhino-style quad workspace) extends §8.3
beyond its committed scope. Rather than inline a large amendment, the scope
lives in `PLANFILE-quad-workspace.md` (agreed decisions, slices, acceptance),
cross-referenced from §8.3; that file governs where the two overlap. Agreed
choices recorded there: click-to-activate ortho editing, ghost + one-click
Place for unplaced mechanisms (ghosts excluded from mass/CG), translucent
generic tubes for sketch elements in the pipe model, and quad as a third mode
alongside 2D/3D. No schema change is expected — ghost placement is derived
from `viewOrientation`, and Place uses the existing instance schema.
