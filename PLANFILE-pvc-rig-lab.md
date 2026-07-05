# PLANFILE — PVC Rig Lab

A browser-based tool for rapidly prototyping and mechanically simulating PVC linkage mechanisms for wearable articulated creatures/pseudo-marionettes mounted on a pack frame, then estimating parts lists and weight for physical prototyping.

Working name: **PVC Rig Lab** (rename freely).

**Important framing**: the app is **creature-agnostic**. Esmee Kramer's Project Raptor is the *reference build* that defines the required mechanism vocabulary and fabrication techniques (§1), and it ships as bundled example content (§9) — but the user's actual first target is a different bipedal creature design (for a Burning Man project). No raptor-specific terminology, assumptions, or kinematic constraints may appear in the app's UI language, data model, or code identifiers. Use generic mechanism/anatomy-neutral terms (boom, truss, limb, mechanism, instance); "raptor" appears only inside the bundled example project names.

---

## 1. Background: the physical system being modeled

Reference build: Esmee Kramer's Project Raptor (https://esmeekramer.com/projects/project-raptor-in-depth/) — a full-size wearable raptor built from PVC pipe, rope, elastics, and EVA foam. The app must be able to represent every mechanism in that build. Understanding them defines the required element vocabulary:

1. **Harness/frame**: two PVC pipes bent over the wearer's shoulders join a horizontal rectangle around the hips, secured with a belt, padded with foam pipe insulation. Diagonal pipes route most of the load to the hips rather than the shoulders. Extra chest pipes add stiffness/shape, and two side pipes act as a ground stand for donning/doffing. This frame is the "ground" that everything else attaches to.
2. **Seesaw body**: the creature's spine is a long truss pivoting on the hip rectangle at **four rotating points**. The wearer is the fulcrum; pushing the neck down raises the tail and vice versa. Head side and tail side must be approximately moment-balanced about the pivot (the tail's rearward push partly balances the neck), or counterweighted. The most stressed members are the neck attachment and the front frame pipe.
3. **Rope-braced trusses**: long spans (neck, spine, tail boom) are not single pipes — they are two or more parallel light pipes cross-braced with tensioned rope in X patterns to form a stiff, very light beam. Tension-only bracing is a first-class structural element.
4. **Neck base joint**: a bundle of pipes passes through an electrical conduit box and is lashed with rope, producing a compliant multi-DOF joint (pan + tilt + some roll). Elastics counterbalance head weight so the neck's rest pose is up.
5. **Steer**: a control handle whose two joints (vertical positioning first, then horizontal attached to it) are mirrored on the head end; rope pairs running along the neck synchronize steer pose to head pose. The up/down rope runs through the neck's top pipe; the left/right ropes are **crossed** (steer-left rope attaches head-right and vice versa).
6. **Jaw**: driven by a bicycle brake cable (Bowden cable) with both casing ends fixed and flexibility in the middle, so jaw state is independent of neck/head pose. The jaw **opens by elastic and closes by pulling the cable** (force-controllable bite for picking things up), with a set screw on the handle to lock the mouth closed.
7. **Legs**: external raptor legs are a linkage strapped parallel to the wearer's leg (knee/hip points tie to the body frame, paws attach to the shoes). An elastic from the heel to the side of the body pulls the heel up; a rope limits how far the toes can bend upward and an elastic returns them down. Driven by the wearer's gait, not free-swinging.
8. **Tail**: detachable boom that **nests inside the body-frame pipe** with retaining screws; two flex points (garden-hose segments acting as compliant joints) and a fiberglass rod **inside the pipe** acting as a return-to-straight spring; a rope holds one section vertical; it swings passively from body motion.
9. **Arms**: single pipe with one joint each, hung from the front conduit box, with a rope to reel them up before setting the costume down. Mechanically trivial but present in the assembly and BOM.
10. **Cosmetics**: EVA foam plates attached at discrete points — mechanically inert but significant for weight and CG.
11. **Twist transmission** (user addition, not in original build): a sheathed cable/rod that transmits rotation — twist one end, the far end rotates a joint — routing-independent, like a torsion Bowden.

**Fabrication techniques** (these must be reflected in the domain model and BOM, not just the geometry):
- **Heat-bending**: pipes are bent with a heat gun into curves and angles, so a "link" is not necessarily straight — it can be a rigid polyline/arc body. Bends replace fittings (saving weight and money) but cost shop labor.
- **Heat-formed wrap joints**: a heated pipe end is flattened/wrapped around another pipe, creating either a **rotatable pin joint** or a **rigid perpendicular attachment** — both with zero fitting hardware. These wraps are typically fabricated as **separate short bent connector pieces** (easier to get lengths right than bending the ends of long structural pipes), so they appear on the cut list as their own small parts.
- **Nested/telescoping pipe**: in the original (EU metric) build, complementary 5/8" and 3/4" pipe OD/IDs let one pipe slide inside another to make custom couplers, sleeve (axial-rotation) joints, telescoping adjustable links, and detachable connections (the tail nests into the body frame). US NPS PVC does not nest cleanly, but **CPVC (CTS sizing) mixed with PVC (NPS sizing)** may — the app must treat nesting compatibility as data computed from OD/ID, never as an assumption (§6.1).
- **Iterate-then-commit workflow**: the original build held joints with duct tape during testing and committed with glue/screws once satisfied. The app is the digital analogue of the duct-tape phase; telescoping links and editable dimensions exist to serve it.

The constant engineering constraint in the original build was **weight** — every design decision traded stiffness against grams. The app exists to let the user iterate on linkage geometry quickly and to answer "how much will this weigh, is it balanced, what do I need to buy" before cutting pipe.

## 2. Product principle, goals and non-goals

### Product principle: play first, engineer second
The primary loop is **sketching and playing**, not CAD. The user selects a view orientation, sees a human + pack-frame silhouette, draws pipes directly on it, snaps them together, and immediately drags/animates the wireframe to feel the motion. Engineering data (pipe sizes, joint realizations, forces, BOM) is **progressive refinement** applied later in a guided design view — never a prerequisite for drawing or playing. Every feature decision should be tested against: "does this let the user play with the design sooner, or does it put a form in front of them?"

### Goals
- Sketch 2D linkage mechanisms fast on a silhouette underlay (lines **and** curves/splines → heat-bent pipe), with snapping and a lightweight contextual menu for connections (rigid, pivot, multi-pivot, slider), plus ropes, elastics, and cables — then interactively drag them through their range of motion in wireframe.
- Animate the wearer silhouette with a library of movement clips (walk, dance, arm swing, sit, lean, crouch) and bind body points (e.g., hands) to puppet nodes, so playing a clip drives the mechanism and visualizes overall creature movement.
- Simulate at the level of **kinematics + linkage constraints + static forces**: pose solving, DOF analysis, joint limits, gravity/spring equilibrium, balance about a pivot, rope tensions, spring loads, required control forces.
- Guide refinement from wireframe sketch to buildable design: a design view with a resolution checklist (assign materials, choose joint realizations, fix impossible constraints) that turns the sketch into an engineered linkage.
- Assemble 2D mechanisms into a **3D whole creature** attached to the poseable wearer; compute global weight, CG, and seesaw balance; scrub control inputs and movement clips to see the composed pose.
- Generate a **BOM**: pipe cut list (with per-realization allowances and bend schedules), fittings count, rope/elastic lengths, foam area, estimated weights per subsystem and total, CG report, optional cost from editable unit prices.
- Save/load designs locally (IndexedDB app database); export/import JSON.

### Non-goals (v1)
- No full rigid-body dynamics engine, no collision detection, no inertia/momentum simulation.
- No FEA or pipe stress analysis. (Stretch goal: closed-form cantilever sag estimate per span — see §10.)
- No electronics modeling (a speaker/battery is just a user-defined point mass).
- No backend, accounts, or collaboration. Single-user, fully client-side.
- No CAD-grade dimensioning/drawing export.

## 3. Tech stack and conventions

- **Vite + React + TypeScript**, strict mode.
- **Zustand** for app state (undo/redo via snapshot history — evaluate `zundo`; `immer` for ergonomic updates).
- **2D editor**: evaluate **Konva (react-konva)** vs raw Canvas 2D in the Phase 0 spike. Criteria: 60fps drag-solve on a 100-node mechanism, hit-testing/selection ergonomics, overlay text (dimensions/forces) quality. SVG is the fallback only if both disappoint.
- **Canvas navigation**: **zoompinch** (https://github.com/ElyaConrad/zoompinch) for pan/zoom/pinch/trackpad navigation of the 2D editor — its gesture feel is the reason it's chosen. Integration constraint: do **not** CSS-transform the Konva `<canvas>` (bitmap scaling blurs); use zoompinch's gesture/transform layer (`@zoompinch/core` or the React wrapper's transform state) as the input source and apply the resulting translate/scale to the Konva Stage transform so content re-renders vector-sharp. Rotation locked off. If a short integration spike shows its DOM-wrapper model can't cleanly drive an external canvas transform, fall back to hand-rolled wheel/pinch handlers and record why in DECISIONS.md.
- **UI components**: **shadcn/ui** (Radix primitives + Tailwind, components vendored into `src/ui/components/`) for all panel/form/chrome UI — inspector, checklist, materials tables, dialogs, menus, transport controls. Adopted at the start of Phase 3 (the first form-heavy phase). *(Amended 2026-07-04, user directive: the design handoff arrived early — `design_handoff_editor_overhaul`, the "floating glass" editor — and was implemented mid-Phase 3 rather than as the Phase 5 polish pass. The editor chrome is now a full-bleed canvas with floating pills/chips per that handoff; canvas-anchored popovers and chips are bespoke-styled to the handoff's tokens, with shadcn primitives retained for the design-face dock and forms. See DECISIONS.md "Interface overhaul".)*
- **3D mode**: three.js via **@react-three/fiber** + **drei** (OrbitControls, TransformControls/gizmos).
- **Solver**: §5 specifies constraint *semantics*; the *implementation* is chosen in the Phase 0 spike (§3.1) — either a small custom XPBD solver or an off-the-shelf 2D engine (Rapier2D WASM or planck.js) run in damped/static mode with custom constraints layered on. Whichever wins, it must live behind a pure interface `solve(mechanism, inputs, mode) → {positions, forces, diagnostics}` in `src/solver/`, UI-independent and deterministic.
- **Schema/validation**: **Zod** schemas for the project file format (single source of truth for types via `z.infer`), with `schemaVersion` + migration functions.
- **Persistence**: **IndexedDB via Dexie** as the application database — multiple named projects, autosave (debounced), a small rolling revision history per project (e.g., last 20 saves), and materials-DB overrides. Plus explicit JSON file export/import for backup/sharing. localStorage only for UI preferences (units, last-open project).
- **CSV export**: PapaParse (or hand-rolled — it's trivial; decide in spike).
- **Testing**: **Vitest** throughout. **Test-driven for the solver and BOM math**: the acceptance tests in §11 (four-bar analytic positions, lever balance, hanging-mass tension, counterbalanced boom angle, bowden/torsion transfer, cut-list arithmetic, nesting-matrix classification) are written *first*, as the executable spec, and drive implementation. UI gets lighter treatment: **@testing-library/react + jsdom** (installed, not optional) for component logic, one Playwright smoke suite (create mechanism → drag → see BOM) run in CI. **Test-pyramid policy**: any UI behavior expressible as a component/unit test lives in Vitest, not Playwright; the e2e suite stays a handful of smoke journeys and is not the development verification loop (no growing per-feature e2e specs, no manual browser-driving where a unit test would do). GitHub Actions: typecheck + lint + test + build on every push.
- **Lint/format**: **Biome** (one tool for both), zero diagnostics enforced in CI via `npm run lint`. Config in `biome.json`: recommended preset plus the **react** and **test** domains (hook-dependency and rules-of-hooks checks are the point), organize-imports assist on; `noNonNullAssertion` off (TypeScript strict already guards those, and the solver uses `!` idiomatically after existence checks). Formatter codifies the existing style: 2-space indent, single quotes, line width 100. Rule suppressions require an inline `biome-ignore` with a reason.
- **Deploy**: static build to **Cloudflare Pages**. No server code, no API keys, no network calls at runtime; the app must work offline once loaded.
- **Units**: internal SI (meters, kg, N, radians). UI default **imperial** (inches/feet, lb, degrees) with a metric toggle. Conversion at the UI boundary only (hand-rolled; the unit set is small).

### 3.1 Phase 0 library-evaluation spike (do this before committing architecture)

Build one throwaway harness that implements three micro-benchmarks in each candidate solver: (a) four-bar drag-to-pose, (b) hanging mass on a tension-only rope with force readout, (c) a rope routed through one eyelet. Candidates: **custom XPBD (~500 lines)**, **Rapier2D (@dimforge/rapier2d)**, **planck.js**. Score on: correctness vs analytic results, determinism, force-extraction quality (joint reactions / λ), ergonomics of adding the custom constraints (bowden displacement coupling, torsion angle coupling, routed ropes, tension-only springs), interactive stability while dragging, bundle size, and WASM friction (loading, Cloudflare Pages compatibility). Also settle the Konva-vs-canvas choice here. Record the outcome and reasoning in **`DECISIONS.md`** in the repo root, then delete or archive the harness. If an engine wins for rigid bodies/joints but the couplings are awkward, a hybrid (engine + custom constraint pass between steps) is acceptable — document it.

## 4. Domain model

### 4.1 Documents
- `Project` — name, units preference, materials DB overrides, list of `Mechanism`s, one `Assembly`, list of `Wearer` anchor overrides.
- `Mechanism` — a 2D planar linkage: nodes, elements, inputs, named state.
- `Assembly` — 3D placements of mechanism instances + wearer + point masses + foam plates.

### 4.2 Mechanism (2D) primitives

Each mechanism has a **view orientation** (`side-left`, `side-right`, `front`, `back`, `top`, `free`) which selects the wearer-silhouette projection drawn as an underlay, sets the default gravity direction (on and −Y for elevation views, off for `top`), and later informs the default plane placement in 3D assembly.

Every element carries a **maturity state**, the backbone of progressive refinement: `sketch` (idealized wireframe — no material, default joint behavior, fully solvable and playable) → `engineered` (material assigned, joint realization chosen, allowances computable). Mixed-maturity mechanisms are normal; only BOM generation and force readouts that depend on mass require engineering data, and the design view (§8) tracks what remains unresolved. Sketch links default to a configurable "generic pipe" linear density so equilibrium mode still behaves plausibly before materials are assigned.

**Nodes** (2D points, the solver particles):
- `free` — solved position.
- `anchor` — fixed to mechanism ground (which in assembly maps to a wearer anchor or another mechanism's node).
- `driven` — position or angle prescribed by an input channel (e.g., "steer handle angle").

**Elements** (constraints/bodies between nodes):
- `link` — rigid bar between two nodes. Carries a material reference (pipe size) and computed mass from length × linear density, applied as distributed mass (half to each endpoint is acceptable for statics). Optional extra point masses at parametric positions along the link (e.g., head foam, speaker).
- `bentLink` — a single rigid body whose shape is a polyline or drawn curve/spline (splines are fitted to a polyline-with-fillet-radii representation for fabrication) through 3+ nodes. All member nodes move as one rigid body: implement as pairwise distance constraints over a triangulated node graph (or a rigid-body entity with position + angle — implementer's choice, but test that it stays rigid under load). Mass from **developed (arc) length** × linear density. Represents heat-bent pipe; BOM emits one cut at developed length plus a bend schedule (vertex angles/radii).
- `telescope` — a link whose length is a **design-time parameter** adjustable within [min, max] via the inspector or a drag handle (not a runtime DOF unless its `sliding` flag is set, in which case it behaves as a prismatic joint with travel limits). Carries two material references (outer + inner pipe) and a required overlap parameter (default 2× inner OD); mass accounts for the overlap region counting both pipes. Warn if the chosen material pair is not nesting-compatible per §6.1.
- `pivot` — pin joint: nodes coincide (implemented as shared particle or zero-distance constraint). Supports **multi-pivot**: three or more links sharing one pin, each pair rotating freely (or selectively welded pairwise). Optional angle limits (min/max relative angle between two designated links) and optional torsion spring (stiffness + rest angle) — this models the garden-hose flex joints and fiberglass return rod.
- `slider` — point-on-line constraint (node constrained to a link's axis, with travel limits). Models the conduit-box pass-through in 2D.
- `rope` — tension-only constraint: total path length ≤ L₀. Supports routing through intermediate nodes acting as frictionless eyelets/pulleys (path = polyline through waypoints; constraint on summed segment length). Reports tension.
- `elastic` — linear spring: force = k·(len − rest), tension-only flag (default true, since bungee/rubber can't push). Parameters: rest length, stiffness k, optional pretension. Reports force.
- `bowden` — displacement coupling between two node-pairs (A₁A₂, B₁B₂): (lenA − lenA₀) + (lenB − lenB₀) = 0, tension-only, routing-independent. Models brake-cable jaw drive. Reports cable tension.
- `torsionCable` — angle coupling between two pivots: (θ_B − θ_B₀) = ratio·(θ_A − θ_A₀), default ratio 1, optional backlash dead-zone parameter. Routing-independent. Reports transmitted torque at equilibrium.
- `gravity` — global, on/off per mechanism (a mechanism designed in plan view, e.g. neck pan, should have gravity off; elevation-view mechanisms have it on). Direction is −Y in mechanism space.

**Inputs**: named scalar channels (angle or displacement) with min/max, bound to driven nodes/joints. Shown as sliders. Channels have a **lock toggle** (freeze at current value — models the original build's set-screw jaw lock and generally useful for isolating one mechanism while scrubbing another). Multiple mechanisms may bind to the same global channel name (e.g., `steer.pitch` drives both the steer mechanism and, via ropes already modeled, is verified against head pitch).

### 4.3 Assembly (3D)
- `MechanismInstance` — reference to a mechanism + a 3D transform (position, quaternion, uniform scale = 1 only) + optional mirror flag (for left/right legs). The mechanism solves in its own 2D plane; its solved node positions are lifted into 3D by the transform.
- `AttachmentBinding` — maps a mechanism anchor node to a wearer anchor or to a node of another instance (rigid weld in v1; the composition is kinematic layering, not a global 3D solve — see §5.4).
- `Wearer` — simplified poseable mannequin (see §7) exposing named anchors: `shoulderL/R`, `spineTop`, `beltL/R/back`, `hipRectCorners`, `thighL/R`, `calfL/R`, `shoeL/R`, `handL/R`.
- `PointMass` — name, mass, attach target (instance node or wearer anchor), for speakers/batteries/hardware.
- `FoamPlate` — name, area (or simple polygon), material (foam type → kg/m²), attach target. Weight/CG only.

### 4.4 Controls (virtual input devices)

Skeleton bindings (§7.3) cover motions the wearer's body produces directly (hands, gait). They cannot express operated controls — the reference build's control yoke is *held* by the hands but its **own DOFs** do the puppeteering: pull/push the yoke to pitch the head, twist it to roll the head side to side, swing it to pan, squeeze the trigger to work the jaw. Controls model that layer:

- `Control` — a named virtual input device with a **type** (`lever` 1-axis, `yoke` 2-axis tilt + twist, `twistGrip`, `trigger`, `slider2d`), an optional **mount** (wearer anchor or instance node — a yoke mounted to `hand.R` rides the hand through movement clips while its axes remain independently driven), and a set of **axes**.
- `ControlAxis` — named axis with range/limits and a **mapping to an existing input channel** (§4.2): channel name, output range, invert flag. Controls are a grouping-and-manipulation layer over the channel machinery, not a parallel input system; channel lock toggles apply per-axis.
- **Manipulation**: each control gets an on-screen widget matched to its type (2D pad for yoke tilt, ring/dial for twist, lever/slider for the rest) in the bottom panel — draggable live during clip playback, so "walk while swinging the head and snapping the jaw" is a two-hand desk gesture. Individual channel sliders remain available as the fallback.
- **Channel animation (control clips)**: named keyframe tracks over input channels — recorded live (scrub widgets while the transport records) or keyed manually — with the same play/scrub/loop transport as movement clips and composable with them (movement clip drives the body, control clip drives the channels, both against one timeline). Same JSON-track format family as §7.2 movement clips. This promotes the relevant slice of the former "animation timeline" stretch goal into scope; full multi-track choreography editing (per-key easing curves, track blending) stays out of v1.

## 5. Solver design

This section specifies **behavioral semantics**, written in XPBD terms as the reference design. If the Phase 0 spike (§3.1) selects an off-the-shelf engine instead, these same behaviors and readouts must be reproduced through that engine (its joints, motors, and a custom-constraint pass), and the §11 acceptance tests apply unchanged.

### 5.1 Core: XPBD constraint projection
Particles = mechanism nodes (position, inverse mass). Each element contributes constraints with compliance α (0 for rigid, 1/k for springs). Iterate Gauss–Seidel projection (default 30 iterations/frame, configurable). Inequality constraints (ropes, tension-only elastics, bowden slack) project only when violated in the tension direction.

Two operating modes:

1. **Kinematic drag mode** (gravity/springs ignored or frozen): the user drags a node; dragged node is a temporary high-priority target; projection satisfies rigid constraints and limits. This gives instant "move the linkage with the mouse" behavior and traces motion paths.
2. **Static equilibrium mode**: pseudo-dynamic relaxation — integrate particles under gravity + spring forces with heavy damping (e.g., velocity ×0.85/step) and XPBD projection each step, run until max particle speed < ε or iteration cap. This settles the pose the real rig would sag into. Must run fast enough to re-settle live while the user drags a slider (target < 16 ms for ≤ 200 particles; if not, settle asynchronously with a "settling…" indicator).

### 5.2 Force extraction
XPBD accumulates Lagrange multipliers λ per constraint; force = λ / (Δt²) per unit gradient. After equilibrium, report:
- rope/elastic/bowden tensions (N and lbf),
- pivot reaction forces,
- torsion spring moments,
- **required input force/torque**: for each driven channel, the constraint force needed to hold it — this is "how hard does the operator's hand work."
Flag any rope whose solution requires compression (means the design relies on a rope pushing — impossible; show warning).

### 5.3 Mobility / diagnostics
- Grübler–Kutzbach 2D count: DOF = 3(n−1) − 2j₁ − j₂ (links n incl. ground, full joints j₁, higher pairs j₂), adjusted for rope/elastic (they don't reduce DOF; they add forces) — display "mechanism DOF: k" and classify: structure (0), mechanism (1+), overconstrained (<0 → warn, still attempt solve).
- Non-convergence detection: if projection residual stays high, highlight the offending constraints in red.
- Joint limit hits highlighted during drag.

### 5.4 3D composition (explicitly not a 3D solver)
Each mechanism solves independently in its plane. The assembly composes results hierarchically: wearer pose → instance transforms (some transforms can be *driven by* a parent mechanism's solved node pair, e.g., the neck-pan mechanism's output angle rotates the plane of the neck-pitch mechanism). Implement transform-drive as: an instance may bind its transform to (a) a wearer anchor frame, or (b) two solved nodes of another instance defining origin + axis. This layered approach captures pan×pitch neck behavior without a general 3D constraint solver.

Global outputs in 3D: total mass, CG position (rendered as a marker + vertical line to ground), per-side moment about any user-selected pivot axis (the seesaw report: head-side moment, tail-side moment, imbalance, suggested counterweight mass at a chosen point).

## 6. Materials database and BOM

### 6.1 Materials DB
Seed an **editable** table (user can adjust every number; persist overrides in project). Seed with published US catalog/standard values; rows keep an internal `approximate: true` flag until the user edits a number (no UI badge — removed by decision, see DECISIONS.md):

- **PVC pipe, Schedule 40 (NPS sizing)** (nominal size → OD, ID, linear density lb/ft): 1/2", 3/4", 1", 1¼", 1½". Also **PVC thin-wall/Class 200/SDR** rows as lighter alternates.
- **CPVC pipe (CTS sizing)**: 1/2", 3/4", 1" — CTS OD/ID run on a different schedule than NPS, which is what makes PVC↔CPVC nesting combinations possible in the US. Include OD, ID, linear density.
- **Fittings** per size *and sizing system* (NPS vs CTS — they are not interchangeable): elbow 90°, elbow 45°, tee, cross, coupling, cap — each with mass and **socket depth** (for cut-length allowance).

**Nesting compatibility matrix** (derived, not stored): for every ordered pipe pair, compute diametral clearance = ID(outer) − OD(inner) and classify: `press` (< 0 mm, interference — glue-free rigid coupler after heat), `snug` (0–0.5 mm — sleeve bearing / glued coupler), `slip` (0.5–1.5 mm — telescoping, detachable joints), `sloppy` (> 1.5 mm — usable only with shimming; flag it). Render this as a matrix view in the materials panel, recomputed live when the user edits dimensions (important: real PVC ID tolerance is loose, so the user will overwrite seed values with calipered measurements from purchased stock — the matrix must follow). The `telescope` element and the `nested sleeve` / `nested coupler` joint realizations validate against this matrix and warn on `sloppy`/incompatible pairs.
- **Rope** (paracord, 4mm nylon) g/m; **bungee/elastic** g/m + default stiffness presets; **Bowden cable + housing** g/m.
- **EVA foam** (e.g., 10–12 mm floor tile) kg/m².
- **Hardware** generic point masses (bolt sets, conduit box, garden-hose joint sleeve, fiberglass rod g/m).

### 6.2 BOM generation
From the assembly (or a single mechanism):
- **Cut list**: every link grouped by pipe size, cut length = node-to-node length (or developed length for `bentLink`) ± per-end allowances determined by the joint realization at each end: fitting socket depth (−), nesting overlap (+, added to the inner member), heat-wrap allowance (+, default 1.5× partner OD, editable), bolt-through (0). `telescope` links list both members with overlap included. Group identical cuts with quantities (mirrored instances double automatically). `bentLink`s additionally emit a **bend schedule** (per-vertex angle and radius).
- **Joint realization** — every pivot/junction has a user-selected "physical realization" chosen in the inspector: **heat-wrapped pivot** (default for pivots — zero hardware mass, heat-gun labor), **heat-wrapped rigid attachment** (default for rigid perpendicular junctions), **nested sleeve** (axial-rotation bearing from a nesting-compatible pair), **nested coupler** (glued rigid splice, no fitting), **bolt-through-pipes**, **tee/elbow/cross fitting**, **conduit box**, **rope lashing**, **click/detachable** (nested slip fit + retaining screw, for the transportable tail). Each realization contributes its own mass, cut allowances, and hardware line items; heat-wrap realizations emit their short connector pieces as separate cut-list parts.
- **Fittings count** by type/size/sizing-system, plus a **technique summary** ("14 heat-formed joints, 6 bends, 4 nested sleeves") so shop time is visible alongside the shopping list.
- **Consumables**: rope total (path lengths × 1.2 waste factor, editable), elastic lengths, cable lengths, foam area.
- **Weight rollup**: per mechanism, per subsystem tag (user-assignable tags like "neck", "tail"), grand total; wearer-carried weight = total; head-side vs tail-side table.
- **Cost** (optional column): editable unit prices, default 0/hidden until user enters prices.
- Export BOM as CSV and as a printable HTML view.

## 7. Wearer silhouette and movement clips

Parametric stick-figure/capsule mannequin: height, shoulder width, hip width, segment lengths (defaults from standard anthropometry, editable). It serves three roles:

1. **2D silhouette underlay**: each mechanism's view orientation projects the mannequin (plus a schematic pack frame) into the editor as a dimmed, non-selectable underlay at true scale — the drawing reference. All named anchors (§4.3) and skeleton points (hands, elbows, knees, head, feet) appear as snappable points in 2D.
2. **Movement clip library**: canned keyframe clips on the mannequin skeleton — `walk` (phase-scrubbed, left/right offset half a phase), `idle sway`, `arm swing`, `dance` (loose loop), `sit down / stand up`, `lean forward/back`, `crouch`. Clips are data (JSON keyframe tracks over named joints), editable in amplitude/speed, and the format is documented so new clips can be added without code changes. Clips play in both 2D (projected onto the mechanism's view plane, driving any nodes bound to skeleton points) and 3D (driving the full mannequin and all bound mechanisms).
3. **Drive source**: any wearer skeleton point or joint angle can be bound to a mechanism's driven node or input channel — e.g., bind `hand.R` to the end of a puppet-arm control rope so the walk clip's arm swing animates the puppet arms; bind hip/knee angles to the leg-exoskeleton inputs. This is the same binding machinery as §4.3, available in 2D sketch mode from day one.

**Playback transport**: play/pause/scrub bar for the active clip, speed control, and per-clip amplitude sliders, available in both 2D and 3D. A movement clip and a control clip (§4.4) can play together against the same timeline; control widgets stay live-draggable during playback (manual input overrides the track while held). During playback the solver runs in kinematic mode each frame (equilibrium overlays optional and off by default during play).

## 8. UI

Desktop-first; usable at laptop widths; mobile out of scope. The 2D editor has two faces of the same document — **Sketch** and **Design** — plus the global 3D **Assembly** mode. Switching faces never destroys data; they are lenses on one model at different maturity.

### 8.1 Sketch face (the default — optimized for play)
- **Setup**: pick a view orientation (side/front/top/…) → the wearer + pack-frame silhouette appears as a scaled underlay (§7). Silhouette pose selectable from clip poses or manual joint tweaks.
- **Draw**: pencil-like tools — straight pipe (click-drag), polyline pipe, curve/spline pipe (freehand or control points → `bentLink`). No property dialogs on creation; everything is wireframe with sensible defaults.
- **Snap + connect**: endpoints snap to other pipes (ends, midpoints, arbitrary along-pipe points), to silhouette skeleton points/anchors, and to grid (0.5" default). On snap-connect, a compact radial/context menu asks what the connection is: **pivot / multi-pivot / rigid weld / slider / detach**, with pivot as the one-click default. Ropes, elastics, bowden, torsion cable are drawn the same way with their own tools; eyelets are droppable on any pipe point.
- **Play**: always live. Drag any node and the wireframe solves in real time; motion-path tracing toggle; joint-limit flashes; DOF badge. Bind silhouette points to nodes (drag from a skeleton point to a node) and use the playback transport (§7) to run walk/dance/sit/lean clips and watch the puppet move. Input-channel sliders appear as they're created.
- The sketch face intentionally hides: materials, realizations, forces, BOM. Zero forms. (The info panel (§8.2a) is selection-reactive and collapsible, never a prerequisite for drawing — it doesn't violate this.)

### 8.2a Info panel (selection inspector)

A right-side panel, present in both faces, that reacts to the current selection — select a pipe, joint, rope, control, node, instance, or anything else and it shows **editable properties plus helpful derived information** for that thing. It is the single inspector surface; the design face's "opens the right inspector" flows land here.

- **Sketch face scope**: identity (name, element type), geometry (length / developed length, endpoint coordinates, vertex angles), behavior parameters (joint type and angle limits, torsion spring, rope L₀ and eyelets, elastic k/rest/pretension, telescope range, channel bindings), and derived info (DOF contribution, current motion range, what it's connected to — each connection clickable to navigate). No engineering fields.
- **Design face scope**: everything above plus material assignment, joint realization, allowances, computed mass, nesting-compatibility status, current force readouts (when equilibrium is on), and this element's unresolved checklist items.
- **Multi-select**: shows the shared editable properties across the selection — this is the surface bulk assignment (§8.2) acts through.
- **Empty selection**: mechanism-level summary (DOF, element counts, gravity state, unbound channels; plus weight and checklist progress in the design face).
- Editing a dimension here is the same inline dimension-edit machinery (§8.2); geometry updates live.

### 8.2 Design face (guided refinement)
A toggle on the same canvas that overlays engineering state and opens the right inspector:
- **Resolution checklist** (persistent panel): every unresolved item as a clickable to-do — links without materials, joints without physical realizations, `telescope` pairs failing nesting compatibility, ropes required to push, over/under-constrained warnings, unbound input channels. Clicking an item selects the element and opens exactly the needed control. The checklist reaching zero means "buildable"; a progress indicator shows it.
- **Bulk assignment**: select-many → assign material/realization in one action (most pipes in a build share one size); "apply to similar" affordance.
- **Force overlays**: equilibrium mode toggle; tensions/loads/reactions rendered on the elements; required-input-force per channel.
- Dimension labels editable inline (type a length, geometry updates).

### 8.3 Global chrome
- **Top bar**: project name + project switcher (Dexie-backed list), 2D/3D mode, mechanism tabs (in 2D), Sketch/Design face toggle, units toggle, undo/redo, save state indicator, export/import.
- **Bottom panel**: playback transport + clip picker, input channel sliders (with lock toggles), control widgets (§4.4) grouped per control, control-clip record/play, gravity toggle, solver status.
- **Right panel**: the info panel (§8.2a); in the design face the resolution checklist (§8.2) docks alongside it.
- **3D Assembly mode**: viewport with orbit controls; scene tree (wearer, mechanism instances, point masses, foam); placement gizmos + mirroring (view orientation provides the default plane); binding editor; playback transport drives the full creature; analysis sidebar (mass, CG marker, seesaw balance report); BOM tab with the printable view.
- **Examples menu**: "New from example" (§9).

Interaction priorities, in order: (1) draw-snap-drag must feel instant and forgiving — this is a toy that happens to be an engineering tool; (2) the sketch→design transition must never feel like a wall — refine one element at a time and return to playing; (3) numbers (lengths, forces, weights) always visible near the thing they describe once in the design face.

## 9. Bundled example content (seed templates)

Ship these as bundled JSON example projects in a "New from example" menu, so the tool is immediately useful and they double as documentation of each element type. They are **content, not product identity** — the app itself stays creature-agnostic (the user's first real design will be a different biped). Each is a simplified, dimensionally-plausible version of a Project Raptor mechanism:

1. **Seesaw spine** — elevation view: hip-rect anchor with the four-point rotating attachment, forward neck boom + aft tail boom as rope-braced trusses, point masses for head/tail, gravity on. Demonstrates balance report + counterweight suggestion.
2. **Neck truss (pitch)** — elevation view: conduit-box slider base (three-pipe bundle lashed with rope, modeled as slider + limited pivot), elastic counterbalance biasing neck-up/steer-down, head mass; input = steer pitch via rope through the top pipe.
3. **Steer mirror (plan)** — plan view, gravity off: steer handle 2-joint chain rope-mirrored to head 2-joint chain, with the left/right ropes **crossed** as in the original build.
4. **Jaw + Bowden** — head-local elevation: jaw pivot with **opening elastic**, bowden from a driven trigger node that **closes** the jaw; trigger channel demonstrates the input lock toggle (set-screw analogue).
5. **Leg exoskeleton** — elevation: wearer thigh/calf/shoe anchors (driven by gait channels), external raptor femur/tibiotarsus/foot links, heel-lift elastic anchored to the body frame, toe travel-limit rope + toe return elastic. Demonstrates driven-anchor mechanisms and rope-as-limit.
6. **Tail** — elevation: boom with two torsion-spring pivots (hose joints) + fiberglass return stiffness, vertical-hold rope, tip mass, gravity on; root joint uses the click/detachable realization.
7. **Full raptor assembly** — all of the above placed on the wearer with mirrored legs, plus the two arms (single pipe + joint with reel-up rope) and speaker/battery point masses; global CG and BOM populated. Includes a **yoke control** (§4.4) mounted to the hands mapping tilt→head pitch, twist→head roll, swing→head pan, trigger→jaw, and a short bundled control clip (head sweep + jaw snap) that plays over `walk` — demonstrating the full control layer.

## 10. Stretch goals (only after all phases pass)
- Cantilever sag estimate per pipe span (E·I from pipe size, closed-form point/distributed-load deflection) with a "sag > 2 cm" warning.
- Shareable URL (design compressed into URL fragment).
- Full choreography timeline editor (multi-track view, per-key easing, track blending) — the basic keyframe channel tracks ("control clips") were promoted into scope as §4.4; this is the editing UI beyond record/scrub.
- SVG/PNG export of 2D mechanism drawings with dimensions.

## 11. Phases and acceptance criteria

Work in vertical slices; each phase ends with passing tests + a usable app.

**Phase 0 — Spike + scaffold.** Run the §3.1 library-evaluation spike and record choices in `DECISIONS.md`. Then scaffold: Vite/React/TS/Zustand/r3f + chosen libs; Zod schema types defined; Dexie project store with autosave + revision history; JSON export/import; CI (typecheck/test/build) green with the first solver acceptance tests written (failing or passing per TDD). *Accept: `DECISIONS.md` exists with benchmark notes; two projects can be created, autosaved, listed, reopened after reload; exported JSON re-imports identically; CI runs on push.*

**Phase 1 — Sketch & play.** View orientation + wearer silhouette underlay with snappable skeleton points; draw straight/polyline/spline pipes (`link`/`bentLink`/`telescope`); snap-connect with the pivot/multi-pivot/weld/slider context menu; drag-to-pose kinematic solve; joint limits; DOF badge; motion-path tracing; skeleton-point→node bindings; movement clip playback (at minimum `walk`, `arm swing`, `lean`) driving bound nodes in 2D; undo/redo. *Accept: build a four-bar in <2 min without opening any property panel; dragging the coupler traces the correct coupler curve (unit test: four-bar positions match analytic solution within 1e-3 m); a bentLink stays rigid while dragged (vertex distances constant within 1e-4 m under test); binding a hand point to a node and playing `walk` animates the node along the projected hand path; over/under-constraint cases flagged.*

**Phase 2 — Forces.** Ropes (with eyelets), elastics, bowden, torsion cable; gravity + equilibrium relaxation; force readouts from multipliers; rope-compression warnings; required-input-force display; input lock toggles. *Accept unit tests: (a) hanging mass on rope reports tension = m·g ±2%; (b) lever balance: 2 kg at 0.5 m vs 1 kg at 1.0 m about a pivot settles level and pivot reaction = 3 kg·g; (c) spring-counterbalanced boom settles at the analytically computed angle ±1°; (d) bowden transfers displacement 1:1; (e) torsion cable transfers angle with configured ratio and respects backlash.*

**Phase 3 — Design face: materials + BOM + inspector.** Entry tasks: adopt shadcn/ui + Tailwind (§3) for all new panel UI, and integrate zoompinch canvas navigation (§3 — transform-state → Konva Stage; includes the go/no-go integration spike). Then: Design/Sketch face toggle; **info panel (§8.2a) in both faces**; resolution checklist with click-to-fix; bulk material/realization assignment (through the info panel's multi-select); editable materials DB (PVC NPS + CPVC CTS); derived nesting compatibility matrix; cut list with per-realization allowances + bend schedule; consumables; weight rollup + per-tag subtotals; technique summary; CSV export. *Accept: seesaw-spine example produces a cut list whose total pipe length equals Σ(link/developed lengths ± allowances) exactly; a freshly sketched mechanism shows a correct checklist that empties as items are resolved, and BOM is gated on (or clearly partial until) checklist completion; changing a pipe size updates weights, balance report, and nesting matrix live; a `telescope` link with an incompatible material pair shows a warning; editing an outer pipe's ID flips a pair's classification in the matrix; selecting any element type populates the info panel with its editable properties, and editing a link length there moves the geometry; pinch/wheel zoom keeps the content vector-sharp (no bitmap scaling) and pointer-anchored.*

**Phase 4 — 3D assembly.** Full mannequin in 3D with clip playback; instance placement with gizmos + mirroring (defaults from view orientation); transform-driven instances (pan drives pitch plane); attachment + skeleton bindings in 3D; global mass/CG marker; seesaw balance report about a selected axis. *Accept: full-example assembly renders; playing `walk` animates mirrored legs and swings bound puppet arms; CG marker moves plausibly when tail mass is edited; head/tail moment report matches hand calculation on the example ±2%.*

**Phase 4.5 — Controls & channel animation.** The §4.4 control layer: `Control`/`ControlAxis` schema (+ version bump/migration); control builder UI (create a control, pick type, map axes to channels, optional mount); per-type manipulation widgets in the bottom panel, live during clip playback; control clips (record by scrubbing, play/scrub/loop, composable with a movement clip on one timeline); manual override while a track plays. *Accept: define a yoke with tilt/twist/trigger axes mapped to three channels and scrub each axis to drive a mechanism (unit test: axis value → mapped channel value → solve() input, including invert and range mapping); a control mounted to `hand.R` follows the hand during `walk` while its axes stay independently drivable; record a control clip and play it simultaneously with `walk` — both drive the same solve; axis lock freezes its channel; control-clip round-trips through JSON export/import.*

**Phase 5 — Examples + polish.** All seven examples bundled (incl. the example-7 yoke + control clip); remaining movement clips (`dance`, `sit down / stand up`, `crouch`, `idle sway`) + documented clip JSON format (movement + control tracks); onboarding empty-state that opens straight into a silhouette with the pipe tool active and points to examples; printable BOM view; performance pass (drag-solve and clip playback <16 ms on examples); keyboard shortcuts (delete, duplicate, esc, space = play/pause); **visual polish pass applying the design handoff document (§3) across the shadcn-based UI**, completing migration of any remaining pre-shadcn chrome. *Accept: a new user can draw a two-link arm on the silhouette, pivot it, bind it to a hand, and watch it swing during `walk` within their first five minutes and without documentation; the full-creature example opens with working sliders, control widgets, weight total, and cut list.*

*Agreed sequencing (2026-07-04, see DECISIONS.md): Phase 5 runs as two slices. The **examples slice** (done, ahead of Phases 4/4.5 at Joe's direction) delivered the seven example projects as data + the remaining movement clips + the clip-format doc; example 7 ships in 2D scope until Phases 4/4.5 supply the yoke control, control clip, and 3D placement. The **finishing slice** (after the interface-overhaul pass lands) delivers the "New from example" menu, onboarding empty-state, printable BOM view, performance pass, keyboard shortcuts, the visual polish pass, and the §9-item-7 deferrals once 4/4.5 exist.*

## 12. Engineering guidance for the implementer

- Keep the solver behind a pure, framework-free interface: `solve(mechanism, inputs, mode) → {positions, forces, diagnostics}` — regardless of whether the internals are custom XPBD or a wrapped engine. All tests target this function; the UI never talks to engine objects directly.
- **Work test-first on solver and BOM math**: for each phase, write the §11 acceptance tests (and the analytic unit cases) before the implementation. UI code doesn't need TDD rigor, but the smoke test must stay green.
- Determinism matters: fixed iteration counts, fixed constraint ordering (sorted by id), fixed timestep, no `Math.random` in the solve path. If a WASM engine is used, pin its version and verify run-to-run reproducibility in a test.
- No creature-specific language anywhere in code or UI strings (see framing note at top); the raptor examples are data files only.
- Prefer boring code over cleverness in the editor; put the cleverness budget into solver robustness (ropes through eyelets and tension-only springs are the classic sources of jitter — use compliance/soft-constraint parameters and clamped projections, and test them).
- When numeric seed data is uncertain (pipe weights, fitting masses, anthropometry), pick a reasonable value and mark it `approximate: true` in the DB rather than guessing silently (internal bookkeeping only; the UI badge was removed by decision once seed values were re-sourced to published catalog figures — see DECISIONS.md).
- Do not add a backend, analytics, external state services, or any network calls. The app must work offline once loaded and deploy as pure static assets to Cloudflare Pages (verify any WASM asset loads correctly from Pages in Phase 0).
