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
- Mixed hinge axes: 8 hinges are side-plane (+z, correct), 4 are top-plane
  (+y) → the leg splays/twists instead of bending.
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

### Slice 3 — joint friction / drag damping
Kinematic drag is stateless/quasi-static, so "friction" = **under-relaxed
drag targets + settle damping**: the dragged node eases toward the pointer
(a stiffness < 1) and neighbours resist sudden reconfiguration, so a drag
settles instead of springing. A per-solve `dragStiffness`/`damping` input,
defaulting to the current crisp behavior, dialed softer in the UI.

### Slice 4 — raptor repair + off-plane-hinge guard
Fix raptor-test: ground the hip, flip the 4 +y hinges to +z. Add a
`repairOffPlaneHinges` docOp + a UI nudge (checklist / one-click) that flags
hinges whose axis doesn't match the panel most of their members lie in, and
offers to snap them to the dominant plane.

## Non-goals
- Not a physics-engine swap (assessed: multi-day, loses diagnostics /
  determinism / offline / the test suite, wouldn't fix the modeling issues).
- Not real inertia/momentum (the quasi-static feel is enough to "play").

## Verification
Each slice: acceptance/unit tests + a scripted built-app drag check. The
end-to-end proof is loading raptor-test, grounding it, and posing the leg into
the bird-leg bend from Joe's sketch without it flopping.
