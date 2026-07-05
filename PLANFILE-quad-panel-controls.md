# PLANFILE — Quad panel controls: resizing, visibility toggles, copy/paste

Extension of `PLANFILE-3d-conversion.md` (quad-only editor), agreed 2026-07-05.
Where this file and the main planfile overlap, this file governs the quad
workspace layout chrome and the selection clipboard; everything else is
unchanged and still governed by the main planfile and CLAUDE.md.

## Motivation

The quad workspace is a fixed 50/50 2×2 grid: panels cannot be resized, a
panel that is momentarily irrelevant cannot be dismissed short of maximizing
another, and the only way to duplicate geometry is Cmd+D's link-only
`duplicateElement` (joints, ropes, and whole sub-assemblies cannot be
duplicated at all). Three sub-features, one branch:

1. **Panel resizing** — draggable splitters between the four panels.
2. **Per-panel visibility toggles** — a compact top-bar toggle group.
3. **Copy/paste** — clipboard for the current selection with full reference
   remapping, Cmd/Ctrl+C/V.

## Non-goals

- No tearing panels out, reordering quadrants, or adding new panel kinds.
- No OS-clipboard interchange (copy/paste is app state within a session;
  cross-project paste is out of scope and the clipboard clears on project
  switch).
- No cut (Cmd+X) — delete + paste-elsewhere is not a requested workflow.
- No schema change, no `schemaVersion` bump — the clipboard is transient app
  state, never part of the file format.

## Design

### A. Panel resizing (shared splitter pair — classic quad-CAD pattern)

- One **vertical + one horizontal splitter fraction** shared by all four
  panels: `quadSplit: { x, y }` in the transient editor store (each 0–1, the
  fraction given to the left column / top row).
- Splitters are thin grid tracks between the panel cells; dragging one sets
  the fraction from the pointer position within the quad container. A small
  **center handle** at the intersection drags both at once. Double-click any
  splitter resets its axis to 0.5.
- **Min sizes**: fractions clamp to [0.15, 0.85] in the store setter, so no
  panel collapses below ~15% of the workspace.
- A pure layout function `quadLayout(visiblePanels, split)` in
  `src/ui/quad/quadLayout.ts` maps visibility + fractions to CSS-grid
  templates, per-panel grid areas, and the splitter set — unit-testable
  without DOM.
- `quadMaximized` (double-click header) is unchanged and takes precedence:
  a maximized panel fills the grid, no splitters.
- **Persistence**: `quadSplit` and `panelsVisible` are UI preferences (like
  units/night), persisted to localStorage via `src/persistence/prefs.ts` and
  restored at store init. They survive reloads and project switches; they are
  not in the document and never in undo history.

### B. Per-panel visibility toggles (top bar)

- `panelsVisible: Record<QuadPanelId, boolean>` in the editor store, all true
  by default.
- A compact **top-center floating chip** (the app's chrome is floating chips,
  not a menu bar) with one toggle per panel — Top / 3D / Front / Side —
  `aria-pressed`, matching the ActionsChip segmented style.
- **At least one panel always on**: toggling the last visible panel off is
  refused (no-op).
- Hiding the currently maximized panel clears the maximization; hiding the
  `activePanel` moves activation to the first visible panel.
- **Reflow rules** (all driven by `quadLayout`):
  - 4 visible → 2×2, both splitters + center handle.
  - 3 visible → the hidden panel's **column-mate spans both rows** (one large
    + two stacked); vertical splitter full-height, horizontal splitter only
    across the two-panel column.
  - 2 visible, same column → stacked, horizontal splitter only.
  - 2 visible, same row or diagonal → side-by-side full-height, vertical
    splitter only (canonical panel order decides left/right for diagonals).
  - 1 visible → full-bleed, no splitters.

### C. Copy/paste (selection clipboard)

- Pure functions in `src/state/clipboard.ts`:
  - `copyPayload(doc, elementIds)` → `{ elements, nodes } | null` — a full
    **snapshot** of the selected elements plus every node they reference
    (paste keeps working after the originals are deleted).
  - `pastePayload(doc, payload, offset)` → `{ doc, newElementIds }` — deep
    clone with fresh ids for every node, element, and attached point mass,
    remapping **all** internal references.
- **Copyability closure** (same policy as `mirrorDuplicate`, and the clone
  remap machinery is **extracted from `mirrorDuplicate` and shared** so both
  paths stay correct together): a pivot is copied only with ≥2 in-selection
  members (member list filtered to the selection; welds/angleLimit/
  torsionSpring dropped if a referenced member is not copied); a slider needs
  its rail; a torsion cable needs both pivots (checked after pivot filtering).
- **Remap coverage**: link/telescope/elastic `nodeA`/`nodeB`, bentLink
  `nodeIds`, pivot `nodeId`/`memberIds`/`welds`/`angleLimit`/`torsionSpring`,
  slider `nodeId`/`alongElementId`, rope `path`, bowden `a1/a2/b1/b2`,
  torsionCable `pivotA`/`pivotB`, attached point masses get fresh ids.
- **Channel bindings: pasted driven nodes KEEP their `channelId`** when the
  channel still exists in the document (channels are global, shared-by-design
  — a mirrored limb driven by the same walk channel is the expected outcome);
  if the channel is gone the node demotes to `free`. Wearer bindings
  (skeleton/anchor bindings) are **not** copied — same rule as
  `mirrorDuplicate`; node kinds otherwise carry over (an anchored node pastes
  anchored at the offset position).
- Pasted elements join **no group** and inherit their source `subsystemTag`.
- **Offset**: paste lands slightly offset **in the active panel's plane**
  (+0.1 m panel-x, −0.1 m panel-y via `PANEL_FRAME`; the perspective panel
  falls back to the side frame). The pasted element set becomes the selection.
- **Wiring**: clipboard payload lives in the editor store (cleared on project
  switch via `resetTransient`). Cmd/Ctrl+C/V in the EditorShell keydown
  handler (skipped while typing); copy/paste icon buttons next to undo/redo in
  the ActionsChip (the app's toolbar equivalent — there is no Edit menu).
- **Undo**: paste is one `updateCurrent` call → one zundo history entry;
  Cmd+Z removes the pasted set. Copy touches no document state.

## Acceptance criteria

Vitest (all UI logic; clipboard remapping is the correctness-critical part):

- `quadLayout`: all visibility cardinalities (4/3×4 hidden-choices/2 same
  column/2 same row/2 diagonal/1), split fractions land in the templates,
  splitter sets per case, maximized short-circuit.
- Editor store: split clamping to [0.15, 0.85], double-click reset, last
  visible panel cannot be hidden, hiding the maximized/active panel clears/
  moves it, layout prefs round-trip through localStorage.
- Panel toggle chip (Testing Library): buttons reflect + flip state,
  `aria-pressed`, refused last-panel toggle stays pressed.
- Clipboard: fresh ids for every node/element/point mass (no id collision
  with the source doc); shared nodes deduplicated; every remap in the
  coverage list above asserted individually; partial-selection drops (pivot
  <2 members, slider without rail, torsion cable without both pivots, weld/
  limit/spring pruning); driven-node channel keep + missing-channel demote;
  bindings not copied; offset applied to every pasted node; paste twice →
  disjoint id sets; paste after deleting the source still works; group
  membership of the paste is empty; `mirrorDuplicate` behavior unchanged
  (existing tests keep passing over the shared clone core).
- EditorShell shortcuts (Testing Library, QuadView stubbed): Cmd+C stores the
  selection payload, Cmd+V pastes + selects the copies, typing targets are
  exempt, paste is one undo step.

Playwright (smoke-suite conventions; splitter drag is a genuine pointer
gesture): one spec — drag the vertical splitter and assert the fraction moved
via `__riglab.getEditor()`, double-click resets to 0.5, toggle a panel off/on
through the top-bar chip and assert the panel count.

Scripted browser verification per DECISIONS.md ("scripted, not driven"):
built app under `vite preview`, one Playwright evaluate against
`window.__riglab` — load an example, copy/paste via synthesized key events,
assert element count + selection + layout state.

## Slices (each a small green commit)

1. This planfile.
2. Layout engine + splitters + persistence (sub-feature A).
3. Visibility toggles + top-bar chip (sub-feature B).
4. Clipboard + shortcuts + ActionsChip buttons (sub-feature C).
5. e2e spec + scripted verification + DECISIONS/doc sync.
