# PLANFILE — Quad workspace, 3D synthesis, and pipe-model render

Extension of `PLANFILE-pvc-rig-lab.md` §8.3, agreed 2026-07-04. Where this file
and the main planfile overlap, this file governs the quad workspace, the 3D
synthesis behavior, and the pipe-model render; everything else (solver, BOM,
schema rules, process rules) is unchanged and still governed by the main
planfile and CLAUDE.md.

## Motivation

The 3D Assembly view only draws explicitly placed `assembly.instances`, and
only bundled examples create those — a normal project shows nothing but the
mannequin. All geometry renders as 1-px `lineSegments` (WebGL ignores
`lineBasicMaterial.linewidth`) in pale gray on a pale background, so even the
mannequin is hard to see. And the 2D editor is locked to one mechanism at a
time, so there is no place to see the whole creature while editing.

Goals:
1. The 3D view shows a **synthesis of all mechanisms**, placed or not.
2. A **"Pipe model" button** renders the composed creature as actual pipe and
   fittings (true outer diameters, fitting bodies at joints).
3. A **quad workspace** (Rhino-style Top / Front / Side orthographic panels +
   perspective panel) added as a **third mode** alongside the existing 2D and
   3D modes.

## Agreed decisions (Joe, 2026-07-04)

- Ortho panels use **click-to-activate** in-place editing (not read-only, not
  fully-editable-everywhere).
- Unplaced mechanisms render as **ghosts** at a default plane derived from
  `viewOrientation`, with a one-click **Place** that creates a real instance.
  Nothing mutates the document silently; ghosts are excluded from mass/CG.
- In the pipe model, sketch-maturity elements render as **translucent
  generic-diameter tubes**; engineered elements get true-OD pipe + fittings.
- Quad is a **third mode**; 2D and 3D modes remain as they are.

## Non-goals

- No global 3D solve (composition stays kinematic layering, §5.4).
- Pipe model is composed primitives (cylinders, bands, boxes), not CAD-accurate
  fittings; no socket-depth cut trimming in the visual — BOM owns cut math.
- Rotate gizmo and in-3D binding editor stay deferred (existing DECISIONS.md
  deviation).
- Fully-editable-everywhere ortho panels (full Rhino parity).

## Slices (each a small green commit, in order)

### Slice 1 — 3D visibility overhaul
- `src/ui/assembly/scene.ts` emits typed primitives instead of bare segments:
  tubes (`a`, `b`, `radiusM`, engineered/sketch style) for link / telescope /
  bentLink segments — radius from the element's pipe material OD/2 when
  engineered, a generic-OD constant otherwise — and cables (rope / elastic /
  bowden polylines). Pure, unit-tested without WebGL.
- Render tubes as cylinder meshes; cables via drei `<Line>` (Line2 — real
  pixel width). Mannequin becomes capsule limbs + joint spheres in dark slate
  so it reads against the light background; darker grid.
- Extract the scene content from `AssemblyView` into a reusable component the
  quad perspective panel mounts in Slice 4.

### Slice 2 — synthesis: default placement, ghosts, one-click Place
- New `src/assembly/placement.ts` (pure): `defaultPlacement(viewOrientation)`
  → `{position, quaternion}` per orientation (`side-*` → lateral offset ±z,
  `front`/`back` → transverse plane, `top` → horizontal plane, `free` → front),
  built on `quatFromBasis`. Also exports the orientation → world-basis panel
  frames Slice 4 reuses — one source of truth.
- `useAssemblyScene` composes mechanisms with **no** instance at their default
  placement as ghost entries (excluded from mass/CG/seesaw).
- `addInstance` docOp; scene tree gains an "Unplaced" section with a Place
  button (creates an instance at the default placement; existing gizmo/mirror
  machinery then applies).

### Slice 3 — pipe-and-fittings model + button
- New pure `src/assembly/pipeModel.ts`: (mechanisms, composed/ghost node
  worlds, materials DB) → flat primitive list:
  - Engineered link/bentLink segments → true-OD cylinders; telescope →
    coaxial outer/inner cylinders using `overlapM` (default 2× inner OD).
  - Pivot joints by realization: `fitting` → body by member count/geometry
    (2 collinear → coupling, 2 angled → elbow, 3 → tee, 4 → cross) as
    socket-depth cylinders along member directions; `nestedSleeve`/`
    nestedCoupler` → sleeve cylinder; `heatWrap*` / `ropeLashing` /
    `clickDetachable` → contrasting band; `boltThrough` → perpendicular pin;
    `conduitBox` → small box.
  - Sketch elements → translucent generic-OD tubes; bare engineered junctions
    → sphere blob.
- `src/ui/assembly/PipeModelLayer.tsx` renders the list in r3f.
- "Pipe model" toggle button in the 3D viewport chrome; recomputes from the
  composed pose via memo, so it stays live during clip playback.
- `__riglab.getAssemblyStats()` seam (render mode, tube/fitting counts, total
  mass) for scripted verification.

### Slice 4 — quad workspace (third mode)
- `mode: '2d' | '3d' | 'quad'`; `quadMaximized: panel | null`; per-panel
  pan/zoom.
- `QuadView`: 2×2 grid — Top, Perspective, Front, Side — with panel headers;
  double-click maximizes/restores. Perspective panel mounts the Slice-1 scene
  (with the pipe-model toggle). Transport/DOF/tool pills stay mounted.
- `OrthoPanel`: draws all mechanisms projected into the panel plane —
  in-plane mechanisms (viewOrientation matches, via `placement.ts` frames)
  editable/ghost; out-of-plane mechanisms as non-editable ghost polylines from
  composed `nodeWorld`. Clicking an in-plane ghost activates it; the active
  mechanism renders through the existing SketchCanvas machinery offset by its
  placement projected to a 2D rigid transform (translation + rotation +
  mirror), with pointer coordinates inverse-mapped — SketchCanvas's
  mechanism-local logic is otherwise untouched.

## Acceptance

- Unit (written first for the pure math): placement mapping per orientation;
  pipe-model tube radii from material OD, fitting selection by member
  count/angle, telescope coaxial pair, sketch-ghost styling; scene-primitive
  extraction; ghosts excluded from mass/CG.
- e2e smoke additions: load full creature → 3D → toggle pipe model →
  `getAssemblyStats()` reports pipe mode with tubes > 0 and fittings > 0;
  quad mode mounts 4 panels and click-to-activate switches
  `activeMechanismId`.
- Scripted browser verification per DECISIONS.md ("scripted, not driven"):
  built app under `vite preview`, one Playwright evaluate against
  `window.__riglab`.
- No schema change, no `schemaVersion` bump (ghost placement is derived;
  Place uses the existing instance schema).
