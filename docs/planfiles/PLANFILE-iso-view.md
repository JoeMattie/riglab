# PLANFILE — First-class isometric editor view

Joe's ask (2026-07-06): "support a fully first class isometric
non-perspective editor view (single panel layout) that can be toggled."

## What it is

A fourth ORTHO editing frame — a true axonometric (isometric) orthographic
projection, not the r3f perspective panel — hosted by the same SketchCanvas
that powers Top/Front/Side. Toggling "Iso" in the top bar swaps the quad
grid for one full-workspace iso panel; toggling back restores the quad. All
editing is first-class because the whole editing stack (projection, snap,
draw, drag, joint menus, marquee, view transforms) is already parameterized
by an `OrientationFrame`; iso is one more frame.

## The frame

Classic isometric, viewer at +(1,1,1), world +y up-ish on screen:

- xAxis (screen right): (1, 0, −1)/√2
- yAxis (screen up):    (−1, 2, −1)/√6
- zAxis (normal):       (1, 1, 1)/√3

Orthonormal, right-handed; `projectToPanel`/`panelToWorld` round-trip
exactly like the other frames.

## Slices

1. **Frame + types.** `OrthoPanelId` gains `'iso'`; `PANEL_FRAME.iso` gets
   the basis above (defined in panelProject.ts — placement.ts's
   `ViewOrientation` frames stay document-schema concerns). `panelDepths`
   gains `iso: 0` (defaults + resetTransient). `activePanel` widens to
   `QuadPanelId | 'iso'`; `selectionCardHost` returns null for an iso active
   panel (the iso layout hosts its own card — see 3).
2. **Workspace mode.** `workspaceMode: 'quad' | 'iso'` in the editor store
   (session lens, like constraintsOn). QuadView renders the single iso panel
   (title bar + depth chip + SketchCanvas panelId 'iso') when mode is 'iso'.
   The toggle is an "Iso" button in the top-bar Panels chip; the per-panel
   toggles dim while it is on (they describe the quad).
3. **Canvas details.** The selection card hosts in the iso panel itself
   (single-panel layout — there is no "other viewport"). The world y=0
   ground reads as the two projected ground axes (±x and ±z through the
   origin, dashed) instead of the flat horizontal line the upright panels
   draw — a horizontal line is wrong under an axonometric projection.
4. **Verification.** Unit: the iso frame is orthonormal and round-trips
   panelToWorld∘projectToPanel; quadLayout host returns null for iso.
   Component: toggling mode renders exactly one sketch canvas with the iso
   testid. Scripted built-app check: toggle iso, draw a pipe, assert the
   document geometry lies in the iso work plane (dot with (1,1,1)/√3 =
   depth) and that drag/zoom still work; toggle back to quad.

## Accepted for v1 (called out, not hidden)

- Drawing in iso lifts strokes into the tilted iso work plane (⊥ (1,1,1))
  at the panel depth, and new pivots hinge about that normal — geometrically
  consistent, but unusual next to principal-plane sketching. Iso's primary
  value is selecting/dragging/inspecting with depth legible; principal-plane
  drawing stays the job of Top/Front/Side.
- The square view-space grid is kept as-is (it is the sketch grid of the
  iso work plane, matching what drawing produces there).
- The wearer silhouette, snapping, joint menus, shift plane-lock, and the
  debug seams (getView('iso'), panelDepths.iso) all come along for free via
  the shared frame parameterization.
