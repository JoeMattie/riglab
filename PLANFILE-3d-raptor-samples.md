# PLANFILE — Fully-3D raptor sample projects

Extension of `PLANFILE-pvc-rig-lab.md` §9, requested by Joe 2026-07-05 ("design some
fully 3d raptor sample projects", with Esmée Kramer's body-frame sketch as reference).
Where this file and the main planfile overlap, this file governs the *set* of bundled
examples (it grows from seven to ten); everything else — creature-agnostic rule, JSON
artifacts generated from builders, test conventions — is unchanged.

## Motivation

The seven §9 examples were rebuilt as v7 single-compound documents, but six of them are
planar sketches lifted into one world plane; the genuinely spatial v7 vocabulary lives
only inside full-creature. Three new examples make the fully-3D capabilities first-class
sample content, each anchored in the reference build:

1. **Body frame (suspended)** — Esmée's sketch: the closed torso box frame with lashed
   corners, an over-the-back bent hoop, and a bungee/strap harness to the wearer.
   Unrepresentable in v6 (closed 3D frame, out-of-plane bends, 3D suspension).
2. **Splayed legs (3D gait)** — the planfile's own motivating case ("legs meeting the
   hip rectangle out-of-plane"): mirrored gait-driven legs whose hinge axes are NOT a
   panel normal, plus a sprung hip-yaw joint stacked on the swing linkage.
3. **Tail gimbal (wag × lift)** — stacked non-parallel hinges (vertical wag carrying a
   horizontal lift, the neck pan×pitch trick applied aft), rope-driven from two
   channels, with a looping "swish" control clip tracing a genuinely 3D tip path.

## Shared conventions

- Same pipeline as the existing seven: authoritative builder in `src/examples/`,
  JSON artifact regenerated via `node scripts/generate-examples.mjs`, registered in
  `builders.ts` (`ARTIFACT_BUILDERS`) and `index.ts` (`EXAMPLES`, appended after the
  seven, planfile order as above), covered in `bundledExamples.test.ts` (registry count
  7 → 10, `FILE_BY_ID` entries, per-example structural describe + post-integration
  solve tests).
- Creature-agnostic rule: "Raptor" may appear ONLY in the project `name` field of the
  JSON data (the existing test blanks `name` and asserts no "raptor" anywhere else).
  Menu labels/descriptions in `index.ts`, mechanism names, ids, group names, mass
  names: all generic.
  - Project names: `Example — Raptor body frame`, `Example — Raptor splayed legs`,
    `Example — Raptor tail gimbal`.
  - Menu entries: `Body frame (suspended)`, `Splayed legs (3D gait)`,
    `Tail gimbal (wag × lift)` with one-line "what this demonstrates" descriptions.
- All elements `maturity: 'engineered'` with materials + realizations assigned so each
  example's BOM is fully resolved (assert `bom.unresolved.count === 0`).
- Rope/elastic rest lengths derived from drawn geometry via `dist()` (never hand-typed)
  so artifacts can't drift from coordinates.
- Wearer numbers (DEFAULT_WEARER, 1.75 m): hipY 0.9275, shoulderY ≈ 1.4315, shoulder
  z ±0.23, hip-rect anchors x 0.12/−0.14, z ±0.21.
- No schema changes; schemaVersion stays 7.

## Example 8 — Body frame (suspended)

id `example-body-frame`, file `body-frame.json`, builder `bodyFrame.ts`.
Demonstrates: closed rigid 3D frame (welded corner pivots), non-planar `bentLink`
(exercises the 3D-3 dihedral bend schedule), `anchorBinding` suspension to 3D wearer
points, whole-rig equilibrium under global gravity, driven-node interaction.

Frame (all free nodes; one rigid body via welded pivots, realization `fitting` at
elbow corners, `ropeLashing` at the prow nose — the sketch's blue lashings):

| node | position |
|---|---|
| FL / FR | (0.42, 1.00, ±0.27) |
| BL / BR | (−0.38, 1.00, ±0.27) |
| ML / MR (side-rail midpoints) | (0.02, 1.00, ±0.27) |
| nose (prow tip, below rail plane) | (0.72, 0.82, 0) |
| hoopL / apex / hoopR | (−0.02, 1.45, 0.14) / (−0.10, 1.56, 0) / (−0.02, 1.45, −0.14) |

- Rails: `railFront` FL–FR, `railBack` BL–BR, side rails split at the midpoints
  (FL–ML, ML–BL; FR–MR, MR–BR), all PIPE_075. Corner pivots at FL/FR/BL/BR weld the
  meeting rails; mid pivots at ML/MR weld rail-halves + hoop end.
- Prow: `prowL` FL–nose, `prowR` FR–nose (PIPE_050), welded pivot at nose; prow roots
  welded into the FL/FR corner pivots. The nose sits below the rail plane — the frame
  is not a planar figure.
- Spine hoop: 5-node `bentLink` ML→hoopL→apex→hoopR→MR (PIPE_050,
  `filletRadiiM` [0.10, 0.15, 0.10]). The three interior xy-projections are
  non-collinear, so the polyline is genuinely non-planar and the bend schedule must
  report nonzero dihedral angles (assert this through the BOM).
- Suspension: anchor nodes with `anchorBinding`s at shoulderL/R and the four hip-rect
  anchors. Four BUNGEE_8 elastics shoulderAnchL→{FL, BL}, shoulderAnchR→{FR, BR},
  rest ≈ 0.85 × drawn distance (pretension carries the frame weight); four CORD strap
  ropes hipRect corner → nearest frame corner, length = drawn + 0.01 (near-taut sway
  stabilizers). Tune stiffness so the equilibrium settle stays within a few cm of the
  drawn pose.
- Tuck control (the one interactive channel): anchor `cinchBase` (0.72, 0.45, 0),
  sliding telescope up to driven node `cinchPull` (0.72, 0.60, 0) on channel
  `nose tuck` (displacement, min −0.10, max 0.02), CORD rope nose→cinchPull at drawn
  + 0.002. Pulling the grip down pitches the prow down against the bungees.
- Masses: `nose block` 0.5 kg at nose (mount point for a future head/neck).
- Groups: `Frame`, `Suspension`, `Tuck control` (cover all elements exactly once).

Solve acceptance: equilibrium at rest converges (or residual < 1e-3 with honest
assertions per the calibration note in `bundledExamples.test.ts`), no
ropes-requiring-compression, frame corners settle within ~0.05 m of drawn; `nose tuck`
at −0.08 lowers the nose y measurably (> 0.02) versus rest and the frame stays intact
(link lengths within 2 mm). BOM: fully resolved, bend schedule for the hoop carries
nonzero dihedrals, grand total plausible (1–15 kg).

## Example 9 — Splayed legs (3D gait)

id `example-splayed-legs`, file `splayed-legs.json`, builder `splayedLegs.ts`.
Demonstrates: hinge axes that are unit vectors off every panel normal, a stacked
sprung yaw joint, mirror-duplicated spatial geometry, gait drive in 3D.

Build per side (left shown; right is the true mirror across z = 0):

- Reuse the leg-exo linkage topology (`legExo.ts` is the reference; copying its node
  table into a new builder with a transform is fine — do NOT modify legExo.ts).
  Rotate the entire sagittal leg geometry about the **vertical axis through its hip
  point** by a toe-out splay of ~0.22 rad (≈ 12.5°, outward per side), and push the
  leg plane outward to z ≈ ±0.30 (outside the body-frame rail line). Hinge axes at
  knee/ankle/toe rotate with the geometry — assert they are unit and have |x| > 0.2
  (visibly not a panel normal).
- Stacked hip yaw: anchored `hipMount` (0.02, 0.98, ±0.25) with a short post link down
  to `hipYoke` (the rotated frameHip point); pivot at the yoke with axis (0, −1, 0),
  members [post, femur], torsion spring (~40 N·m/rad, rest 0) centering the splay,
  angle limit ±0.35. The swing linkage hangs off the yaw joint, so during gait the paw
  can wander in/out — a real spatial articulation no v6 document could express.
  (Watch for the bracket-spin DOF on hinge-on-bar joints; use the anti-roll keel
  pattern from `fullCreature.ts` / the 2026-07-04 examples commit if the yaw or knee
  needs an off-axis tie.)
- Keep the leg-exo skeleton bindings (hipL/kneeL/shoeL and mirrored) — the sagittal
  gait targets pulling on a splayed linkage IS the demo.
- Keep heel-lift elastic + toe rope-as-limit per side (anchor `frameSide` rotated with
  the geometry). Masses: paw claw 0.1 kg per side.
- Groups: `Leg (left)`, `Leg (right)`.

Solve acceptance: rest-pose mirror symmetry (every `legL.*`/`legR.*` node pair matches
across z with axes mirrored correctly); a 12-sample walk-cycle kinematic solve (same
harness as the leg-exo test) keeps femur length within tolerance AND the paw traces an
out-of-plane path: z-range of each paw tip > 0.02 over the cycle and mean |z| greater
than the hip half-width (the paw lives outside the sagittal plane). Left/right paw z
excursions mirror each other.

## Example 10 — Tail gimbal (wag × lift)

id `example-tail-gimbal`, file `tail-gimbal.json`, builder `tailGimbal.ts`.
Demonstrates: stacked non-parallel hinges (lift carried by the wag-side member),
crossed-rope drive of a vertical-axis joint, torsion-sprung compliance, a control clip
whose two tracks produce a genuinely 3D tip orbit.

- Anchored `carrierMount` (−0.10, 1.05, 0); `carrier` link back to `tailBase`
  (−0.26, 1.05, 0). **Wag** pivot at tailBase: hinge axis (0, −1, 0), members
  [carrier, tailRoot, wagBarL, wagBarR], cross-bars welded to tailRoot (the steer-
  mirror lever pattern), limit ±0.6, realization `conduitBox`. Crossed CORD ropes from
  a steer-style driven grip (sliding telescope + driven node, channel `tail wag`,
  displacement) to the bar tips — tip wags to the same side as the grip, like the
  steer example.
- `tailRoot` link tailBase→`liftBase` (−0.50, 1.05, 0). **Lift** pivot at liftBase:
  hinge axis (0, 0, 1), members [tailRoot, boom1, keelPost], realization `ropeLashing`,
  limit bracketing the drawn rest deviation. Anti-roll keel: `keelPost` liftBase→
  `keelTop` (−0.50, 1.25, 0) braced to the wag bar tips — rigid to the WAG cluster, so
  the lift plane rotates with wag (the fullCreature.ts keel note applies verbatim).
- Boom: `boom1` liftBase→`j1` (−0.80, 1.02, 0), `boom2` j1→`tailTip` (−1.10, 0.98, 0),
  torsion-sprung compliant pivot at j1 (per tailBoom.ts). Masses: 0.3 kg at j1's
  segment end region and 0.4 kg at tailTip (tune for a stable settle).
- Lift drive: anchored mast `liftMast` (−0.10, 1.35, 0); CORD rope
  [liftPull, liftMast, j1] (drawn + 0.002) from a driven grip (sliding telescope,
  channel `tail lift`, displacement min −0.05 max 0.02) — slack lets the tail sag onto
  its springs, pull raises it.
- Control clip `tail swish` (durationS 4, loop): `tail wag` sweeping full range and
  back, `tail lift` phase-shifted (peaks at the wag zero-crossings) so the tip orbits
  a 3D loop over the walk.
- Groups: `Gimbal`, `Boom`, `Drives` (or similar; full cover, no overlap).

Solve acceptance: rest equilibrium honest-converges with no compressed ropes and tip
near the sagittal plane; `tail wag` ± swings tailTip z by > 0.05 with the sign
following the grip side; **lift rides wag**: at wag +, applying `tail lift` pull
raises tailTip y measurably while |z| keeps its wagged sign and magnitude; heavier tip
mass sags the tip lower (torsion compliance). Clip sanity: sampling `tail swish` at
quarter points yields distinct (y, z) tip states through solve, or at minimum the two
tracks cover both channels (cheap assertion acceptable if solve-per-sample is slow).

## Registry, docs, process

- `bundledExamples.test.ts`: registry test expects 10; the every-example integrity
  block picks the new ones up automatically; add the three structural describes + the
  solve tests above to the post-integration block (respect the converged-vs-residual
  calibration note).
- Check for other hardcoded example counts/lists: e2e specs, onboarding/menu UI,
  README, docs/. Update in the same slice as the registry change.
- Perf: `perf.test.ts` bounds solve time on examples — verify the new ones either fall
  under its existing generic iteration or add them consistently with its pattern; the
  <16 ms drag-solve budget applies.
- DECISIONS.md: one entry — three post-conversion fully-3D samples added at Joe's
  request, this planfile governs, §9 count now ten.
- `PLANFILE-pvc-rig-lab.md` §9: append one sync line pointing at this planfile.
- CI green at the end state (typecheck + lint + test + build); artifacts regenerated;
  small commits per example. Branch `3d-raptor-samples` stays unmerged for Joe's
  review.

## Deferred / out of scope

- No new schema, solver, or UI work. If a design above cannot converge without solver
  changes, simplify the example (drop the yaw spring, stiffen a member) and log the
  deviation in DECISIONS.md rather than touching the solver.
- Strap/foam visual dressing from the sketch (loops, pool-noodle padding) is not
  representable as mechanism elements and is out of scope.
