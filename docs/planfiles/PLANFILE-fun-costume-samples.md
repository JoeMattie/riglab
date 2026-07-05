# PLANFILE — Complete-costume sample projects ("fun samples")

Extension of `PLANFILE-pvc-rig-lab.md` §9, requested by Joe 2026-07-05: "Create a number
of fun sample projects to show off what you can do … a large stick figure or robot with
super long arms maybe 8-10 feet tall that mimics your dancing movements in a fun way. Or
some strange animal. Make like 5." Steer during kickoff: **"these examples should be
sort of complete costumes"** — each sample is a full wearable rig (suspension harness +
body structure + several articulated subsystems), in the spirit of `full-creature`, not
a single-subsystem demo like §9 items 1–6.

Where this file and the main planfile overlap, this file governs the *set* of bundled
examples (it grows from seven to twelve). Everything else — creature-agnostic rule,
JSON artifacts generated from builders, test conventions — is unchanged.

Note for review: the unmerged `3d-raptor-samples` branch independently grows the set
7 → 10. The two branches will conflict on registry counts/lists; whichever merges
second rebases those counts. Flagged to Joe rather than resolved here.

## Shared conventions (same pipeline as the existing seven)

- Authoritative builder in `src/examples/<name>.ts`; JSON artifact regenerated via
  `node scripts/generate-examples.mjs`; registered in `builders.ts`
  (`ARTIFACT_BUILDERS`) and `index.ts` (`EXAMPLES`, appended after the seven, in C1–C5
  order); registry count test 7 → 12 in `bundledExamples.test.ts` (`FILE_BY_ID` grows;
  the every-example integrity block picks new entries up automatically).
- Per-costume structural + behavioral tests live in that costume's own
  `src/examples/<camelName>.test.ts` (per-example test files are established precedent:
  `seesawSpine.test.ts`). Respect the converged-vs-residual calibration note at the top
  of `bundledExamples.test.ts`'s post-integration block: prefer
  `diagnostics.converged === true`; where a massy compound honestly cannot reach the
  1e-4 m gate, assert `residual < 1e-3` **plus the behavior** (positions, lengths,
  no `ropesRequiringCompression`) — never a vacuous residual-only test.
- Creature-agnostic rule: species/character names may appear ONLY in the JSON project
  `name` field. Code identifiers, mechanism/group names, menu labels, descriptions use
  body-part/mechanical terms (jaw, wing, claw, tail, neck, leg, mast, boom — all fine;
  existing examples use these freely).
- All elements `maturity: 'engineered'` with pipe/cordage materials and joint
  realizations assigned; assert the BOM is fully resolved
  (`computeBom(...).unresolved` empty) and grand total plausible (2–20 kg).
- Rope/elastic rest lengths derived from drawn geometry via `dist()` (never hand-typed)
  so artifacts can't drift from coordinates. Small deliberate deltas (pretension, slack,
  rope-as-limit) are expressed as `dist(...) ± constant`.
- World frame: +y up, +x wearer-front, +z wearer-left; gravity −y. Wearer numbers
  (DEFAULT_WEARER, 1.75 m): hipY 0.9275, shoulderY ≈ 1.4315, shoulder z ±0.23,
  hip-rect anchors x 0.12/−0.14, z ±0.21.
- Watch the bracket-spin DOF on hinge-on-bar joints; use the anti-roll keel pattern
  from `fullCreature.ts` (2026-07-04 examples commit) wherever a hinge cluster needs an
  off-axis tie.
- No schema changes; schemaVersion stays 7. No solver changes — if a design cannot
  converge, simplify the costume (stiffen, drop a spring, shorten a boom) and log the
  deviation in DECISIONS.md.

**Every costume MUST include:**
1. Suspension to the wearer via `anchorBinding`s (shoulder + hip-rect anchors, the
   body-frame pattern: bungee carry + near-taut strap ropes) so the whole rig hangs on
   the wearer and rides movement clips.
2. At least two articulated subsystems; at least one driven by wearer skeleton bindings
   during a bundled movement clip (mimicry), or by input channels with a shipped
   control clip.
3. Groups covering all elements exactly once, one per subsystem.
4. Structural asserts (bindings, hinge axes, id namespace) + behavioral solve asserts
   (below) in its own test file.

Clip-driven solve tests use the leg-exo walk-cycle harness pattern in
`bundledExamples.test.ts` (~line 518): `samplePose(getClip(...), t)` → drive bound
nodes → kinematic solve → assert geometry.

## C1 — Towering figure (dance mirror)

id `example-towering-figure`, file `towering-figure.json`, builder `toweringFigure.ts`,
project name `Example — Towering dance figure`, menu label `Towering figure (dance
mirror)`. The user-requested centerpiece: a ~2.8 m (9 ft) backpack-mounted stick figure
whose super-long arms mirror the wearer's dancing.

- Mast: anchor nodes bound to spineTop + beltBack + all four hip-rect anchors; rigid
  mast up to a shoulder cross-bar at y ≈ 2.3 (tips z ± 0.35), short head post to
  y ≈ 2.7. PIPE_075 mast, PIPE_050 elsewhere.
- Head: 0.8 kg head mass on a post carried by a **spherical** pivot at y ≈ 2.45 with a
  3-elastic guy nest (120° spread to spreader-bar tips) — a bobble head that jiggles
  with the dance. Elastics BUNGEE_6, rest = dist (neutral at drawn pose).
- Arms (per side): `upperArm` (shoulder-bar tip → elbow, 0.6 m), `foreArm` (elbow →
  armTip, 0.6 m). Shoulder pivot hinge, axis +z (sagittal swing like the dance clip's
  shoulder tracks), limits ≈ [−0.4, 2.9] rad from hanging; elbow pivot with torsion
  spring (soft, ~8 N·m/rad, rest slightly bent) so the forearm flops expressively.
  Elastic return shoulder-bar → upperArm mid keeps arms hanging at rest.
- Marionette drive (the mimic): free node strapped to each wearer hand
  (skeletonBinding handL/handR), CORD rope path
  [elbow, barEyelet(shoulder-bar tip), mastBeltEyelet(mast at belt height), wHand] with
  length = drawn + 0.002. Raising the hand lengthens the hand→belt-eyelet leg, pulling
  the elbow up — the giant raises its arm the same direction, amplified by reach.
- Legs: one hanging leg link per side (hip pivot on a low mast cross-bar, limits) tied
  to the wearer's knee (skeletonBinding kneeL/kneeR via short tie link, legExo tie
  pattern) so the figure steps along during gait/dance.
- Groups: `Mast + head`, `Arm (left)`, `Arm (right)`, `Legs`, `Suspension`.
- Solve acceptance: rest equilibrium honest-converges, no compressed ropes, mast top
  within 0.05 m of drawn. Dance mimicry: sample the `dance` clip at t = 0.6 (shoulderL
  1.4 = left hand high) and t = 1.8 (−0.4) → giant **left armTip y differs by
  > 0.5 m** between the two, right arm mirrors at opposite phase; all link lengths
  within 2 mm. Bobble: displacing the head node 0.1 m in +z and re-solving equilibrium
  returns it within 0.04 m of rest (restoring nest).

## C2 — Winged costume (flap amplifier)

id `example-winged-costume`, file `winged-costume.json`, builder `wingedCostume.ts`,
project name `Example — Storm bird`, menu label `Winged costume (arm-flap wings)`.

- Compact body frame: front/back rails around the wearer at y ≈ 1.25 (body-frame
  pattern, corner-welded), suspended from shoulders (BUNGEE_8, rest ≈ 0.85 × drawn) +
  hip-rect straps (CORD, drawn + 0.01).
- Wings (per side): 4-node `bentLink` spar from a root at the frame's shoulder cross
  region curving out/up to tip z ≈ ±1.15 (nonzero fillet radii; make the interior
  vertices genuinely non-collinear so the bend schedule is 3D). Root hinge axis +x
  (flap sweeps in the y–z frontal plane), limits ≈ [−0.5, 1.2]. Tip mass 0.15 kg.
  Elastic from mast/frame top to spar mid balances gravity.
- Flap drive: wearer hand nodes (skeletonBinding handL/handR) tied by CORD rope to the
  spar 0.25 m from the root hinge — lever amplification ≈ 4× to the 1.15 m tip. Elastic
  antagonist keeps the rope taut through the swing.
- Head/neck: short forward boom with a pitch hinge and rope hold (condensed neck-truss
  pattern), jaw at the tip opened by elastic, closed by a bowden on channel `jaw`
  (trigger control mounted at wearer anchor beltR).
- Tail: aft boom on a torsion-sprung compliant pivot (tailBoom pattern), 0.2 kg tip —
  passive bounce.
- Groups: `Body frame + suspension`, `Wing (left)`, `Wing (right)`, `Neck + jaw`,
  `Tail`.
- Solve acceptance: rest honest-converges. Flap mimicry: `arm-swing` clip extremes →
  each wingtip y range > 0.6 m, left/right symmetric (same-phase clip ⇒ same-sign
  motion; assert z signs stay mirrored). `jaw` channel sweep closes the beak gap
  monotonically. Bend schedule for each spar reports nonzero dihedrals via the BOM.

## C3 — Pincer costume (twin claws)

id `example-pincer-costume`, file `pincer-costume.json`, builder `pincerCostume.ts`,
project name `Example — Crab colossus`, menu label `Pincer costume (twin trigger
claws)`.

- Shell: wide horizontal `bentLink` hoop around the wearer at y ≈ 1.2 reaching
  z ≈ ±0.5 (5+ nodes, closed feel via a rear cross link), suspended shoulders +
  hip-rect (standard pattern).
- Claw booms (per side): boom from the hoop's front-corner region angling forward-out
  to a claw at x ≈ 0.7, z ≈ ±0.55. Boom root pivot (hinge, axis +z) tied by rope to
  the wearer's hand skeleton node so the claws wave/pitch as the arms move. Claw =
  fixed jaw welded to the boom + moving jaw on a hinge, opened by elastic, closed by
  bowden on channels `grip left` / `grip right`; trigger controls mounted at wearer
  anchors handL / handR.
- Eye stalks: two short posts on the hoop front on sprung spherical bases (small
  elastic nests), 0.05 kg tips — bobble on the move.
- Control clip `snap snap` (durationS 4, loop): alternating left/right grip closes.
- Groups: `Shell + suspension`, `Claw (left)`, `Claw (right)`, `Eye stalks`.
- Solve acceptance: rest honest-converges. Each grip channel closes its claw gap
  independently (left sweep moves only the left gap beyond tolerance). Boom mimicry:
  hand-node displacement (arm-swing sample) pitches the boom tip y by > 0.15 m. Eye
  stalks restore after displacement (as C1 bobble).

## C4 — Serpent costume (head + wave tail)

id `example-serpent-costume`, file `serpent-costume.json`, builder `serpentCostume.ts`,
project name `Example — Parade dragon`, menu label `Serpent costume (pan head, wave
tail)`.

- Body hoop harness around the wearer (compact, suspended as usual).
- Head: forward boom rising to y ≈ 2.2 carrying a head mass (0.6 kg); **pan** hinge
  (axis (0,−1,0)) at the boom base driven by crossed CORD ropes from a steer-style
  driven grip (sliding telescope + driven node, channel `head pan`, steer-mirror
  pattern) — head looks where you steer. Jaw at the head: elastic-open, bowden-close,
  channel `jaw`, trigger control at beltR.
- Tail: 4 segments × 0.45 m aft chain, plan hinges (axis (0,−1,0)) at each junction,
  torsion springs centering each; successive joints coupled by `torsionCable`s
  (joint1→2, 2→3, 3→4; ratio 0.8, backlashRad 0.15) so a single root drive whips down
  the chain with lag. Root joint driven by crossed ropes from a grip on channel
  `tail wave`. Anti-roll keels wherever the plan hinges need them. Tip mass 0.25 kg.
- Control clip `slither` (durationS 4, loop): `head pan` and `tail wave` full-range
  sweeps phase-shifted by a quarter period — the whole costume S-curves.
- Groups: `Body + suspension`, `Head + jaw`, `Tail chain`, `Drives`.
- Solve acceptance: rest honest-converges, tip near sagittal plane. `tail wave` sweep
  moves tail tip |z| > 0.15 with sign following the drive; the coupled chain curls:
  each successive joint deflects with ratio ≈ 0.8 (backlash tolerance) at full drive.
  `head pan` swings the head z with the correct sign while tail holds. Quarter-point
  samples of `slither` yield distinct (head z, tip z) states.

## C5 — Tall quadruped (strange animal)

id `example-tall-quadruped`, file `tall-quadruped.json`, builder `tallQuadruped.ts`,
project name `Example — Skyline grazer`, menu label `Tall quadruped (gait legs, sky
neck)`.

- The "strange animal": a giraffe-legged thing ~3 m (10 ft) at the head.
- Body frame: hip-rect + shoulder suspended rail box (body-frame pattern, compact).
- Neck: long boom from the frame front rising to y ≈ 2.9; a mid-neck compliant
  torsion-sprung pivot (tailBoom pattern, stiff) gives it sway; head 0.6 kg on a sprung
  spherical bobble at the top (C1 nest pattern). A CORD hold rope frame → mid-neck
  limits droop (rope-as-limit).
- Legs: front pair reusing the leg-exo linkage topology bound to the wearer's gait
  (copy the node table into this builder with an outward transform — do NOT modify
  `legExo.ts`), z ≈ ±0.30.
- Tail/counterweight: aft boom with 1.2 kg counterweight sized so the standing moment
  about the pack roughly balances the neck (seesaw-spine trick); torsion-sprung droop
  pivot.
- Groups: `Body frame + suspension`, `Neck + head`, `Leg (left)`, `Leg (right)`,
  `Tail counterweight`.
- Solve acceptance: rest honest-converges with head y > 2.7 held. Walk mimicry: 12
  walk-cycle kinematic samples keep femur/boom lengths within 2 mm (leg-exo harness).
  Balance: net gravity moment of neck+head vs tail masses about the pack x within a
  stated tolerance (compute from the builder's masses/geometry — a design assert, not
  a solver assert). Bobble restore as C1.

## Registry, docs, process (integration — main session)

- `index.ts` EXAMPLES 7 → 12 (C1–C5 appended in order, one-line "what this
  demonstrates" descriptions), `builders.ts` ARTIFACT_BUILDERS + project builders,
  `bundledExamples.test.ts` FILE_BY_ID + count expectation, artifacts regenerated.
- Check hardcoded example counts/lists: e2e specs, `ProjectList.tsx`,
  `EditorShell.tsx`, `EmptyState.tsx`, `appStore.ts`, README, docs/. Update in the same
  slice as the registry change.
- `perf.test.ts`: verify the new examples fall under its generic iteration or add them
  per its pattern; the <16 ms drag-solve budget applies.
- DECISIONS.md: one entry — five complete-costume samples added at Joe's request, this
  planfile governs, §9 count now twelve, raptor-branch conflict flagged.
- `PLANFILE-pvc-rig-lab.md` §9: append one sync line pointing here.
- CI green at the end state (typecheck + lint + test + build); small commits: one per
  costume (builder + its test file), then one integration commit (registry + artifacts
  + docs). Branch `fun-samples` stays unmerged for Joe's review.

## Deferred / out of scope

- No new schema, solver, or UI work. Convergence trouble ⇒ simplify the costume and
  log in DECISIONS.md.
- Foam/fabric dressing (shells, feathers, scales) is not representable as mechanism
  elements; foam plates may be used only if they already carry mass semantics — else
  skip.
- Image-generation-based concept art: no such service is available in this
  environment; designs derive from the mechanism vocabulary instead (noted for Joe).
