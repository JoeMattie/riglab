# PLANFILE — Multi-select group drag + constraints toggle

## Problem
Two UX gaps in the select tool:

1. **You cannot drag pipes.** Clicking a pipe body only selects it; dragging
   on it draws a marquee. Moving anything means grabbing individual nodes.
   Multi-select (shift-click, marquee) exists but there is no way to move the
   selection as a group.
2. **Every node drag is solver-mediated.** Dragging a node always runs the
   kinematic solve, which holds every pipe rigid at its current length. Free
   re-sketching (move points around, let pipe lengths follow) is only
   possible through the narrow endpoint-drag path (endpoint of a *selected,
   unlocked* pipe).

## Feature A — body drag / group drag (select tool)

- Mousedown on a pipe **body** (the `onPipe` snap on a link/telescope span)
  starts a **body drag** instead of a marquee.
- Dragged set: if the hit element is in the current selection, the whole
  selection moves; otherwise just the hit element. In the second case the
  selection updates to the hit element once the drag actually moves
  (modifier click adds to the selection instead of replacing).
- Every node touched by the dragged elements (via `elementNodeIds`)
  translates together by the pointer delta in the panel plane; out-of-plane
  depth per node is preserved (delta is built from the panel frame axes).
- **Constraints ON:** the translation is fed to the kinematic solver as
  `dragTargets` for every dragged node; only converged poses are written
  (existing drag-ratchet invariant). Connections to non-dragged geometry are
  respected.
- **Constraints OFF:** node positions are written directly (`moveNodes`);
  pipe lengths follow because link length is derived from node positions.
- A stationary click on a pipe body stays a click (selection semantics
  unchanged). One undo entry per drag gesture.

## Feature B — "constraints" toggle (bottom transport strip)

- New editor-store boolean `constraintsOn`, **default false**, setter
  `setConstraintsOn`. Not part of the document; not reset per project
  (a lens, like `equilibriumOn`).
- Rendered as a `ToggleChip` (`constraints-toggle`) in the transport pill
  next to forces/trace.
- Semantics — it gates **drag-time constraint enforcement**:
  - **ON:** today's behavior. Node drags run the kinematic solve (lengths
    rigid, limits enforced, only converged poses written); endpoint
    length-edit remains restricted to endpoints of selected, unlocked pipes;
    `lengthLocked` is honored.
  - **OFF (default):** dragging any node moves it directly and every
    incident pipe's length changes accordingly. The endpoint-drag affordance
    (ghost + length readout + length ticks) applies to any link/telescope
    endpoint regardless of selection or `lengthLocked`. Nodes without an
    incident link/telescope (bentLink vertices, bare joint nodes) free-move
    through the plain drag path without solving.
- Unchanged either way: DOF/diagnostics pill (global solve loop still runs —
  it never writes geometry), equilibrium overlay toggle, wearer tear-off and
  drop-to-bind behavior, typed length edits and the lock in dimension chips,
  draw tools, undo granularity.

## Follow-up scope (same session, user-requested)

- **Length pills are a single-pipe control.** With more than one element
  selected, the editable length chips (and the unlock button on locked
  chips) hide; locked pipes keep their passive locked chip and hover tags
  stay display-only.
- **Arrow keys nudge the selection** in the active panel's plane: one
  length-snap step (½ in imperial / 1 cm metric) per press, one undo entry
  per press, same constraint regime as drags (off = direct move, on =
  solver, converged poses only).
- **Selection highlight on nodes:** every node the selection touches gets a
  soft persistent orange halo, matching the orange stroke selected pipes
  already have — selected joints/points now read as selected.
- **Right-click never starts a marquee** (or node/body drag) in the select
  tool.
- **The selection card opens in the nearest other viewport.** It was
  covering the geometry being worked on; `selectionCardHost` (quadLayout)
  picks the nearest other on-screen ortho panel by grid distance (reading
  order breaks ties), falling back to the working panel only when it is the
  sole ortho panel on screen. It also hides during cross-panel drags.

## Deliberate behavior change
The app default flips from constrained drag to free drag. The e2e sketch
spec ("drag it — DOF 1 and lengths hold") now clicks `constraints-toggle`
before dragging; it also gains coverage for free drag (length changes) and
group body drag. Logged in DECISIONS.md.

## Tests
- `src/design/groupDrag.test.ts` — pure group-translate target math
  (shared nodes deduped, rope/pivot/bentLink nodes included, delta applied).
- `editorStore.test.ts` — `constraintsOn` default + setter.
- `overhaul.test.tsx` — constraints chip renders unchecked by default and
  drives the store.
- `e2e/sketch.spec.ts` — constrained drag (toggle on), free drag, group drag.
