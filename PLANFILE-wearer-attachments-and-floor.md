# PLANFILE — Wearer attachments, tear-off, and the floor

Feature planfile (Joe's directives, 2026-07-04) for three related editor/solver
behaviors, implemented on the `worktree-anchor-snap-drag` branch on top of the
pack-frame snap parity commit. Referenced from DECISIONS.md. The main
`PLANFILE-pvc-rig-lab.md` is unchanged — these are post-Phase-5 additions.

## Directives (verbatim intent)

1. "The pivots should snap to packframe points the same way they snap to body
   points" — **done** (commit `f2aa19a`): select-drag attracts to wearer
   anchors; a drop grounds the node there.
2. "We should be able to disconnect points from where they are snapped by
   dragging past a deadzone."
3. "Anchors attached to points on the packframe or skeleton should move with
   it."
4. "Also we need to add a ground plane that things can't fall through."

Directive 3 supersedes the static-ground decision recorded for directive 1:
grounded nodes attached to a wearer point now track that point through pose
and clip playback.

## Slice A — anchor attachments track the wearer (directive 3)

The wearer-anchor set spans both the pack frame (belt, hip rect, back rails)
and the body (thigh/calf/shoe/hand midpoints), so attaching to a `WearerAnchor`
covers "packframe or skeleton". Skeleton-point drops keep their existing
*soft* binding semantics (drag-target pull; constraints win). Anchor drops are
*hard*: the node is ground, and the ground rides the wearer.

- **Schema v6**: `Mechanism` gains `anchorBindings:
  Array<{ id, anchor: WearerAnchor, nodeId }>` (parallel to
  `skeletonBindings`). Migration v5→v6 adds `[]`. A node appears in at most
  one of `skeletonBindings`/`anchorBindings` — the ops enforce it.
- **docOps**: `groundNodeAtAnchor` gains the `anchor` name and records the
  binding (replacing any prior binding for the node). Drawing a pipe end onto
  an anchor (`EndSpec` `anchorNode`) gains `anchor` and records the binding
  too — drawn grounds track the same as dropped ones. `deleteElement`'s
  orphan cleanup prunes `anchorBindings` like `skeletonBindings`.
- **Wearer**: `anchorTargets(mechanism, params, pose)` in `src/wearer/
  bindings.ts` — projected positions of each anchor-bound node's wearer
  anchor, same shape as `bindingTargets`.
- **Solver**: `SolveInputs` gains optional `groundTargets: Record<nodeId,
  Vec2>` — prescribed positions applied ONLY to `kind: 'anchor'` nodes (both
  modes; weight stays 0; rest lengths still derive from document positions,
  so attached structure translates rigidly). Non-anchor entries are ignored.
- **Canvas**: every solve call site passes `groundTargets:
  anchorTargets(...)`; the playback gate (`skeletonBindings.length > 0`) also
  accepts `anchorBindings`; drag writes converged positions back to the doc as
  today, so an attached ground's document position converges to the current
  pose's point.

*Accept (Vitest):* solver — a link from grounded G to free F with a
`groundTargets[G]` offset solves to G exactly at the target and |F−G| at rest
length (both modes, determinism preserved); `groundTargets` on a free node is
ignored. wearer — `anchorTargets` projects bound anchors per view/pose and is
empty with no bindings. docOps — grounding records/replaces the binding and
clears skeleton bindings; drawing onto an anchor records the binding; deleting
the last element referencing the node prunes it. Migration — v5 doc upgrades
with empty `anchorBindings`.

## Slice B — tear-off deadzone (directive 2)

A select-tool drag that starts on a *connected* node — skeleton-bound,
anchor-attached, or plain grounded — holds the node at its point until the
pointer has moved ≥ `TEAR_OFF_PX = 28` screen px (2× the 14 px snap
tolerance) from mousedown. Crossing the deadzone disconnects inside the same
undo gesture (`releaseNodeConnection`: drop both binding kinds; un-ground to
`kind: 'free'`), and the drag continues live — re-dropping on a point
re-binds/re-grounds within the same gesture. A stationary click (< 4 px) still
opens the joint popover. Unconnected free nodes drag exactly as today.

*Accept (Vitest):* `releaseNodeConnection` unit tests (removes skeleton
binding / anchor binding / grounds → free; no-op on a bare free node).
Deadzone math is exercised through the existing screen-distance pattern —
gesture feel is verified by a scripted browser check (drag within deadzone: no
disconnect, node still connected; drag past: node freed and follows).

## Slice C — ground plane (directive 4)

World y = 0 is the floor — the mannequin's shoes rest exactly on it. In every
non-`top` view (elevation projections keep world y; `top` has no in-plane
gravity), free nodes may not settle or be dragged below it.

- **Solver, both modes**: a floor projection (`y = max(0, y)`) applied to
  free-node particles inside the iteration loop, like an inequality
  constraint: zero mobility cost, contributes to `residual` only while
  violated, never listed in `violated` (it has no element id). Anchor/driven
  nodes are exempt — prescribed positions are authoritative. Enabled when
  `mechanism.viewOrientation !== 'top'`. Not configurable; no schema change.
- **Canvas**: a ground line at y = 0 in the underlay for non-top views.
- Contact reaction forces are NOT added to the force readout in this slice —
  the floor is positional. Noted as a known limitation.

*Accept (Vitest, solver acceptance):* kinematic — dragging a free two-node
pipe toward y < 0 converges with both nodes ≥ 0 and rest length intact;
equilibrium — a point-massed pendulum whose rest pose would hang below y = 0
settles resting on the floor (y ≥ −1e-6), converged; `top` view is unaffected
(node may go negative); determinism holds.

## Out of scope

- Floor contact forces in the force readout / balance report.
- Configurable floor height or per-mechanism floors.
- Attachment management UI beyond the drag gestures (listing/editing
  attachments in the info panel).
- Assembly-level (`AttachmentBinding`, §4.3) changes — this is per-mechanism
  2D behavior only.
