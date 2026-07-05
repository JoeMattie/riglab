# PLANFILE — Fully-3D conversion (single compound mechanism)

Extension of `PLANFILE-pvc-rig-lab.md`, agreed 2026-07-04 (Joe, via plan-mode Q&A).
Where this file and the main planfile overlap, **this file governs**: the 2D-planar
mechanism model, the mechanism/assembly split, §5.4 layered composition, and the
2D/3D/quad mode trio are all superseded as described below. Everything else (BOM
allowance math, materials DB, controls/clips, persistence, process rules) is unchanged
and still governed by the main planfile and CLAUDE.md.

**Process note (Joe, 2026-07-04):** the two human-review gates in the phase table
(planfile review, solver correctness review) are **waived for the initial autonomous
run** — Joe directed the conversion be executed end-to-end on the worktree branch
without pausing; he reviews the whole branch before merge instead. The gates remain
the default for any future work under this planfile.

## Motivation

Mechanisms are strictly 2D planar linkages, lifted into 3D only by rigid instance
transforms (§5.4 "explicitly not a 3D solver"). That was a mistake: real rigs have
joints and connection points in more than one plane (neck pan × pitch, legs meeting the
hip rectangle out-of-plane), and the layered-kinematics composition cannot express force
coupling or true multi-plane geometry. The project becomes **fully 3D**.

## Decisions (all confirmed by Joe)

1. **Single compound mechanism.** The whole project is one 3D mechanism with one global
   solve. Mechanism/assembly split, `MechanismInstance`, `AttachmentBinding`, and
   transform-drive are removed. "Mechanisms" survive as named **groups** — selection
   sets that also drive BOM rollup (alongside `subsystemTag`). Mirroring becomes a
   **mirror-duplicate command** at creation time (real duplicated geometry, no live
   link); live mirror-groups are deferred.
2. **Hinge-by-default joints.** A pivot created while sketching in an ortho panel is a
   hinge whose axis is that panel's normal — identical feel to today's 2D pivots. The
   axis is editable afterward; **spherical** is a per-joint option (models the
   rope-lashed conduit joint natively). Angle limits and torsion springs exist only on
   hinges (measured about the axis); spherical joints carry neither (v1 parity).
3. **Quad becomes the app.** The quad workspace (Top / Front / Side / Perspective) is
   the only workspace; a maximized ortho panel is the old focused-2D feel; the
   perspective panel replaces 3D assembly mode. Dedicated 2D and 3D modes are removed.
4. **Gravity is global −Y**, always available; the per-mechanism `gravityOn` flag and
   the "plan view = gravity off" hack disappear (a top-view mechanism now genuinely lies
   in a horizontal plane — correct physics). Equilibrium remains an explicit solve mode.
   The floor constraint (free nodes ≥ 0) applies to world y.

## Schema (v7, one bump + migration)

- `vec2Schema` → `vec3Schema` for node positions, named-state positions, drag targets.
- `pivotElementSchema` gains
  `joint: { kind: 'hinge', axis: vec3 (unit, document space) } | { kind: 'spherical' }`.
  Multi-pivots share one axis across all member pairs. Welds unchanged.
- `Project` holds **one** compound `mechanism` plus
  `groups: { id, name, elementIds }[]`. `assembly` is deleted; `PointMass` / `FoamPlate`
  move to project level with `attach: { kind: 'node', nodeId } | { kind: 'wearerAnchor', anchor }`.
- `viewOrientation` and `gravityOn` removed from the mechanism. `anchorBinding` (v6) and
  `skeletonBinding` carry over unchanged — they now drive nodes to true 3D wearer points
  (the per-view projection indirection is deleted).
- Channels: already global by name; the compound mechanism has one flat channel list
  (migration dedupes by name, first definition wins).

### Migration v6 → v7 (`src/schema/migrations.ts`)

For each mechanism × each assembly instance referencing it (or one synthetic instance at
`defaultPlacement(viewOrientation)` when unplaced — the existing lifting math in
`src/assembly/placement.ts` / `compose.ts` **is** the migration function):

- Lift every node/named-state position through the instance transform (mirror flips
  local x before rotation, exactly as `liftNode` did). Node/element ids are suffixed
  `@<instanceId>` when a mechanism has >1 instance; otherwise kept.
- Pivots: hinge axis = instance rotation applied to local +z (the 2D plane normal).
- `AttachmentBinding` → wearer-anchor targets become `anchorBinding`s; instance-node
  targets merge the two nodes (the anchor node's id is rewritten to the target node id —
  a weld by unification).
- Assembly `PointMass`/`FoamPlate` → project level; instance-node attaches resolve to
  the lifted node id.
- `transformDrive: instanceNodes` (pan-drives-pitch-plane) cannot be expressed as a
  static bake without losing the coupling: migrate at the current pose and emit a
  **checklist warning** ("re-joint needed: former driven plane") on the group. The
  bundled examples are rebuilt properly from their builders instead (see Examples).
- Old per-mechanism `gravityOn:false` is dropped (see decision 4).
- Round-trip + fixture tests; BOM totals for migrated fixtures must equal their
  pre-migration totals (cut lengths are transform-invariant).

## Solver (rewrite, same public shape)

`solve(mechanism, inputs, mode)` keeps its signature; positions and pivot reactions
become `Vec3`. Both `kinematic.ts` and `equilibrium.ts` generalize: particles gain z;
distance / rope / elastic / bowden / point-on-line constraints and λ-force extraction
port mechanically. New machinery:

- **Hinge**: per hinged member pair, a **virtual particle pair along the axis**
  distance-tied rigidly into each member's node set (the classic two-shared-points
  particle hinge). Spherical = today's single shared node. Virtual particles are solver
  internals — never in the schema or the returned positions.
- Angle limit / torsion spring: signed angle about the hinge axis (member directions
  projected onto the axis-normal plane; same "0 = straight continuation" convention).
- `bentLink`: all-pairs distances still rigidify in 3D; mobility bookkeeping
  2k−3 → **3k−6** (k ≥ 3; a 2-node body is 3·2−5... n/a, bentLink is ≥3 nodes).
- DOF = 3·(non-anchor nodes) − independent equalities touching a free node;
  classification thresholds unchanged.
- Drag targets are `Vec3` (the UI supplies panel-plane-constrained targets).
- Floor: free particles projected to y ≥ 0 (port of the v6 ground plane).
- Determinism rules unchanged (§12): fixed iterations, id-sorted constraints, no
  randomness; the golden-angle degeneracy nudge gains a z component.

**Acceptance tests** (coverage before phase-done; ordering free per the 2026-07-04
process change): every existing analytic case re-expressed in 3D **on a tilted plane**
must reproduce its 2D result (parity regression) — four-bar coupler curve, lever
balance, hanging-mass tension, counterbalanced boom angle, bowden 1:1, torsion
ratio/backlash. New 3D cases: hinge holds under out-of-plane load; spherical joint
swings freely out-of-plane; a genuinely spatial four-bar; torsion transfer between
non-parallel hinge axes; floor contact.

## Editor (quad-only)

- App mode state collapses to quad; `QuadView` is the shell. Transport / DOF / tool
  pills, info panel, checklist, BOM all stay.
- **Ortho panels are fully editable**: every sketch tool works in-panel, drawing into
  the panel plane at an **active work-plane depth** (default 0; set by typing or by
  clicking existing geometry; snapping to an existing node adopts that node's depth).
  Panel-frame math in `src/ui/quad/panelProject.ts` + `src/assembly/placement.ts`
  (relocated once `src/assembly` dissolves) is the single projection source of truth.
- `SketchCanvas` + snapping/marquee/gestures/dimension chips operate on projected
  coordinates; document space is Vec3. The joint popover gains the hinge-axis /
  spherical choice (default: hinge ⊥ panel). Selection is global across panels.
- Perspective panel: selection + node drag (screen-parallel plane drag), pipe-model
  toggle, orbit. No drawing in perspective (deferred), no rotate gizmo (deferred).
- Wearer silhouette underlay per panel = existing skeleton projection; bindings drive
  nodes to 3D points directly.

## Dissolution + downstream

- Delete `src/assembly/compose.ts`, instance/binding schema + docOps, assembly scene
  tree. Mass/CG/seesaw rollup becomes a small pure module (`src/analysis/`) reading
  global solve output; `balanceReport` ports nearly as-is.
- BOM: unchanged except the `bentLink` bend schedule gains a per-vertex **dihedral
  (bend-plane rotation) angle** for out-of-plane bends.
- Groups UI: create/rename/assign in the info panel; checklist + BOM roll up per group.
- Examples: all 7 rebuilt from their builders as single 3D compounds (full-creature
  becomes one document — pan/pitch as real 3D hinges, legs mirror-duplicated). e2e smoke
  + `__riglab` hooks updated.

## Phases (worktree branch; WIP checkpoints allowed, final state green)

| Phase | Content |
|---|---|
| 3D-0 | This planfile + DECISIONS + schema v7 + migration + fixtures |
| 3D-1 | Solver 3D (kinematic, equilibrium, forces, diagnostics, floor); parity + new tests |
| 3D-2 | Quad-only editor: editable ortho panels, work-plane depth, hinge-axis UI, perspective drag |
| 3D-3 | Assembly dissolution, groups, project-level masses, analysis module, bend-schedule dihedral |
| 3D-4 | Examples rebuild, e2e smoke, perf (<16 ms drag-solve on full creature), removed-mode chrome cleanup |

CI-green-at-every-commit applies to `main`; this branch may carry WIP checkpoint
commits but must end green (typecheck + lint + test + build) before review.

## Verification

- Vitest: migration round-trips every bundled example; solver acceptance suite incl.
  2D-parity; BOM-total invariance across migration.
- Scripted Playwright against `npx vite preview` via `window.__riglab` (one evaluate):
  load full-creature → drag a node in an ortho panel → solve converges → BOM totals +
  balance report present. Gesture-feel checks reserved for Joe.

## Known tradeoffs / deferred

- Mirrored limbs are duplicated geometry (mirror-duplicate at creation); live
  mirror-groups deferred.
- Perspective-panel drawing, rotate gizmos, spherical-joint cone limits deferred.
- bentLinks are drawn planar (in one panel); vertex depth editable afterward.
- `transformDrive` migrations bake statically with a checklist warning.
