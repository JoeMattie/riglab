# PLANFILE — Softer, "playable" solver (friction, hinge slop, bendable PVC)

Joe's ask (2026-07-06): moving pipes/points feels fiddly and "weird",
especially with hinge axis-lock on. He wants something to *play* with — a
semi-accurate feel of the costume moving, not AutoCAD precision. His own
suggestions: joint friction, allowed slop for axis-locked hinges, let the PVC
bend a little.

## Diagnosis (from raptor-test.riglab.json, measured)

- The rig is nearly ungrounded: 2 of 13 nodes bound to the wearer, the other
  11 free → **24 DOF**. A leg that "just bends" wants ~1–2 DOF. High DOF is
  the main reason a drag reconfigures unpredictably.
- Mixed hinge axes: 8 hinges +z, 4 hinges +y. **Correction (slice 4,
  measured from geometry):** the earlier "8 correct / 4 wrong, flip +y→+z"
  read was BACKWARDS. The foot is drawn flat in the x–z plane (most nodes sit
  at y≈0, spread in x and z); a leg rises in +y to the shoulder. So the foot's
  hinges should be +y (flex flat) and the risers' should be +z. In the file
  the two are mixed: `detectOffPlaneHinges` flags 5 hinges whose axis lies
  INSIDE their members' plane (currently +z, members flat in x–z → want +y) —
  exactly the foot links that flip out of plane when posed. The guard snaps
  each hinge's axis to its own members' plane normal, whichever way that is.
- **Axis-lock is buggy** (introduced this session): `AxisPinC` hard-pins the
  virtual axis particle every iteration. A 5 cm drag overshoots to 20 cm and
  residual jumps 1.7e-5 → 1.5e-2 (non-converged). Infinitely stiff = wrong.

## Direction (chosen): soften the current PBD solver, don't swap engines

The kinematic/equilibrium solvers are already position-based. Add XPBD-style
*compliance* so constraints give a little, plus drag damping. Keeps
determinism, the analytic DOF diagnostics, offline/zero-dependency, and the
acceptance suite (tolerances relaxed where flex is intentional).

### Slice 1 — compliant hinge axis lock (fixes the blow-up) ✅ DONE
Replaced `AxisPinC`'s hard placement with a **cone-limited** constraint
(`AxisSlopC` in both solvers, built on `coneLimitVirtual` +
`HINGE_AXIS_SLOP_RAD` ≈ 4° in hinge.ts): the virtual axis particle may deviate
from the drawn axis by up to the slop angle with no correction; only the
excess is projected back onto the cone boundary (current pivot-distance
preserved). Small drags stay inside the cone (no fight → converges), large
ones are gently limited. This IS "allowed slop for axis-locked hinges" and
kills the overshoot. Acceptance (axisLock.acceptance.test.ts): a locked hinge
pulled out of plane CONVERGES and stays within slop+ε of its plane; resists
≥3× more than unlocked; a hinge starting outside the cone still solves finite.
Logged in DECISIONS.md (2026-07-06).

Joe's scoping note: the weirdness reproduces with just **three pipes** (one
bound to the shoulder, one to the foot) — the foot he'd flip at the ankle
instead of the whole chain raising. That's the target feel for slices 3–4
(drag damping + DOF); slice 1 removes the axis-lock blow-up underneath it.

### Slice 2 — bendable pipes (soft rigid lengths)
A small global `flex` compliance on link/bentLink DistanceC so pipes flex a
few mm under load instead of being infinitely rigid. Tuned tiny by default
(barely visible) with room to increase; gated so acceptance tests that assert
rigid lengths either stay within tolerance or opt a stiffer mode. Equilibrium
first (where forces load the pipes); kinematic keeps near-rigid so dragging
still feels crisp.

### Slice 3 — joint friction / drag damping ✅ DONE
Kinematic drag is stateless/quasi-static, so "friction" = **eased drag
targets**: `SolveInputs.dragFriction` (0..0.95, default 0 = crisp) eases each
target from the node's current position toward the pointer by (1 − friction).
The editor ratchets the pose each drag frame, so this is per-frame velocity
damping — the node still reaches the pointer over frames but a single frame
stays near the current branch, so a fast pull no longer teleports across a
branch boundary and flips a distant joint. App passes DRAG_FRICTION = 0.5 on
the two constraint-on node-drag solves (SketchCanvas); endpoint length edits
stay crisp. Acceptance (dragFriction.acceptance.test.ts): crisp flips a bar
across its anchor, friction keeps it on the near branch, and friction is
lag-not-cap (walks all the way around over 60 frames, staying on the unit
sphere). Logged in DECISIONS.md (2026-07-06). Equilibrium-relaxation friction
deferred (this is the interactive-drag case Joe hits); gesture *feel* is his
to judge live.

### Slice 4 — raptor repair + off-plane-hinge guard 🚧 IN PROGRESS
Added `detectOffPlaneHinges` (src/design/hingePlaneRepair.ts) +
`repairOffPlaneHinges` docOp: a hinge axis should be perpendicular to the
plane its members span; the guard flags hinges whose drawn axis differs from
that normal by >10° and snaps it to the nearest cardinal of the normal.
Covered by hingePlaneRepair.test.ts + docOps.hingeRepair.test.ts (detects,
suggests, idempotent, skips collinear). Raptor: writing a repaired copy to
`~/Downloads/raptor-test-repaired.riglab.json` flips the 5 flat-foot hinges
+z→+y (see corrected diagnosis above — the opposite direction from the
original plan). Both original and repaired solve/converge at rest (DOF 24
either way — axis direction doesn't change DOF; the behavioural difference
shows under drag). NOT grounding the hip — that restructures Joe's bindings
and is his modeling call, not an automated repair.

Remaining: a UI affordance (conditional "Fix N off-plane hinge(s)" button) so
the guard is reachable — a proposal Joe reviews, never a silent auto-apply.

## Non-goals
- Not a physics-engine swap (assessed: multi-day, loses diagnostics /
  determinism / offline / the test suite, wouldn't fix the modeling issues).
- Not real inertia/momentum (the quasi-static feel is enough to "play").

## Verification
Each slice: acceptance/unit tests + a scripted built-app drag check. The
end-to-end proof is loading raptor-test, grounding it, and posing the leg into
the bird-leg bend from Joe's sketch without it flopping.
