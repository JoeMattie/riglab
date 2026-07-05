# PLANFILE — Marquee selection + auto-resolve

Feature planfile for two additions agreed 2026-07-04. Extends `PLANFILE-pvc-rig-lab.md`
(§8.2/§8.2a); on conflict the main planfile's engineering rules win.

## Goal

1. **Marquee selection**: drag a selection box on the canvas to select many elements,
   feeding the existing multi-select inspector (§8.2a) and bulk assignment (§8.2).
2. **Auto-resolve**: one action that proposes joint/end **realizations** and **pipe
   materials (diameters)** for unresolved slots, minimizing purchased parts by
   exploiting nesting — complementary pipe sizes slip together (nested sleeve/coupler
   = zero hardware) before bolts or fittings are reached for.

## Decisions (from Joe, 2026-07-04)

- **Marquee gesture**: plain drag on empty canvas with the select tool draws the box
  (replacing empty-drag pan). Panning remains on trackpad/wheel and moves to
  **space+drag** and **middle-mouse drag** for mouse users.
- **Hit rule**: crossing semantics — touching the box selects. Shift/cmd at release
  unions with the current selection; plain drag replaces it.
- **Autosolver scope**: fills unassigned slots by default; an explicit opt-in toggle
  ("may change existing assignments") allows re-solving assigned slots when that
  eliminates parts.
- **Size palette**: prefer pipe sizes already in use in the project (fewest distinct
  sizes to buy); reach into the rest of the materials DB only when a
  nesting-compatible partner is needed.
- **Apply UX**: preview-then-apply. A readable proposal list (grouped, per-row
  before → after + reason, per-row dismiss); Apply is one undoable step. It is a
  stated heuristic — no structural/strength reasoning.

## Design

### Marquee
- `src/design/marquee.ts` — pure `elementIdsInRect(mech, positions, rect)` +
  `segmentIntersectsRect`. Segment/polyline intersection for links, telescopes,
  elastics, bentLinks, ropes, bowdens; point-in-rect on the carrying node for
  pivots/sliders and on either pivot node for torsion cables. World coordinates,
  posed positions.
- `editorStore.setSelection(ids)` — replace-selection primitive.
- `SketchCanvas`: select-tool mousedown on empty space starts the marquee unless
  space is held or the middle button is used (those pan). <4 px drag counts as the
  existing click-clears-selection path. Marquee rect drawn on the top Konva layer.

### Auto-resolve engine
- `src/design/autoResolve.ts` — pure, deterministic, tests written first.
  `autoResolve(project, mechId, {elementIds?, resolveAssigned}) →
  { changes: ProposedChange[], summary }` where a change is
  `{elementId, slot, before?, after, reason}` and `slot` ∈ pipeMaterial ·
  outerPipeMaterial · innerPipeMaterial · realization · endRealizationA/B.
- Greedy passes: (1) palette = in-use pipe materials by use count, DB as fallback
  tier; (2) unassigned links/bentLinks → dominant palette size, or the DB pipe with
  the most slip partners when nothing is assigned yet; (3) telescopes → partner
  making a slip fit; (4) explicit pivots → `nestedSleeve` when a joined pair is
  slip-compatible, `heatWrapRigid` when fully welded, else `heatWrapPivot`; with
  `resolveAssigned`, may resize one member within the palette to unlock a slip pair
  (single pass, no backtracking, never breaking a fit chosen earlier in the run);
  (5) sliders → `conduitBox`; (6) link ends meeting a realized joint get the matching
  end realization; open ends stay butt cuts.
- Preference order (unit-tested): nested slip pair ≻ heat-wrap ≻ bolt-through ≻
  fitting. Implicit shared-node pins carry no realization slot (matches
  `resolution.ts`/BOM) and are skipped.
- No schema changes; proposals are transient. No `schemaVersion` bump.

### Apply + UI (design face)
- `docOps.applyAutoResolve(doc, mechId, changes)` folds through the existing
  `assign*` ops inside one `updateCurrent` — one undo step, maturity stays derived.
- Transient `autoProposal` in `editorStore`; cleared on mechanism switch and any
  document edit.
- Entry points: "Auto-resolve…" button in the checklist header (mechanism scope,
  with the re-solve checkbox); "Auto-resolve selection…" in the multi-inspector
  (selection scope).
- Preview card above the checklist list: grouped counts, per-row before → after +
  reason, row click selects the element, per-row ✕, Apply N / Cancel.

## Slices (CI green at each commit)

1. Marquee: `marquee.ts` + tests, `setSelection`, canvas gesture + space/middle pan.
2. `autoResolve.ts` engine + acceptance tests.
3. `applyAutoResolve` + preview UI + entry points.
Each slice updates `PLANFILE-pvc-rig-lab.md` §8.2/§8.2a and `DECISIONS.md` where it
changes agreed scope.

## Verification

- Vitest: marquee hit-testing per element type; autoResolve fixtures (dominant-size
  fill, slip→nestedSleeve, welded→heatWrapRigid, slider→conduitBox, end realizations
  match joints, fill-gaps never touches assigned slots, resolveAssigned resize,
  determinism); applyAutoResolve; checklist/inspector UI flows.
- Scripted headless check against `vite preview` via `window.__riglab`: run
  auto-resolve on an example, apply, assert the to-do count drops.
- Interactive gesture-feel pass for marquee drag + space-pan (sanctioned case).
- `npm run build` + lint clean.

## Out of scope

Structural/strength-based sizing; price-weighted or global (ILP) optimization; bulk
numeric-field editing in the multi-inspector; cross-mechanism auto-resolve.
