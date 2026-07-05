# PVC Rig Lab

A browser-based tool for rapidly prototyping and mechanically simulating PVC
linkage mechanisms for wearable articulated creatures / pseudo-marionettes
mounted on a pack frame — then estimating the parts list, weight, and balance
before any pipe gets cut.

**Live at [riglab.pages.dev](https://riglab.pages.dev)** — fully client-side,
works offline once loaded.

**Play first, engineer second**: sketch pipes on a wearer silhouette, snap
them together, and drag the wireframe through its range of motion
immediately. Materials, joint realizations, forces, and the bill of materials
are progressive refinement, never a prerequisite for playing.

The app is creature-agnostic. [Esmee Kramer's Project
Raptor](https://esmeekramer.com/projects/project-raptor-in-depth/) is the
reference build that defines the mechanism vocabulary (rope-braced trusses,
seesaw spine, bowden-driven jaw, heat-formed PVC joints, …) and ships as
bundled example content only.

## Status

**Complete.** All planned phases have shipped; the specs that drove them are
archived in [docs/planfiles/](docs/planfiles/), with the founding spec at
[PLANFILE-pvc-rig-lab.md](docs/planfiles/PLANFILE-pvc-rig-lab.md).

**Fully 3D** (2026-07-04,
[PLANFILE-3d-conversion.md](docs/planfiles/PLANFILE-3d-conversion.md)):
the project is one compound 3D mechanism edited in a Rhino-style quad
workspace (Top / Front / Side orthographic panels + perspective). Drawing in
a panel sketches into that panel's plane at an adjustable work-plane depth;
pivots default to hinges whose axis is the panel normal (spherical
optional — the rope-lashed conduit joint); double-click anchoring creates
frame-fixed ground hinges so panel sketches stay planar. The former
per-plane mechanisms are now named groups; the assembly/instance layer is
gone — one global XPBD solve covers the whole creature, so multi-plane
couplings (neck pan carrying pitch) are real shared geometry instead of
transform layering. Mass/CG/seesaw balance read from `src/analysis`; the
bend schedule gained per-vertex dihedral ("twist") angles for out-of-plane
heat bends.

All five original phases (0–5, incl. 4.5 controls) shipped before the
conversion: sketch & play, forces (ropes/elastics/bowden/torsion +
equilibrium readouts), the design face (materials DB, nesting matrix,
resolution checklist, BOM + CSV + printable view), controls & control
clips, the fifteen bundled examples (seven §9 items + three fully-3D
samples + five complete-costume samples), movement-clip library
([docs/movement-clips.md](docs/movement-clips.md)), onboarding, and the
floating-glass interface overhaul.

## Stack

Vite · React · TypeScript (strict) · Zustand (+ zundo for undo) · Zod
(schema = single source of truth, versioned with migrations) · Dexie
(IndexedDB) · Konva (ortho panel editors) · three.js via
react-three-fiber (perspective panel) · custom 3D XPBD solver behind a pure
`solve(mechanism, inputs, mode)` interface · Vitest + Testing Library, with
a small Playwright smoke suite · Biome (lint + format) · Tailwind v4 +
shadcn/ui (vendored) for panel UI. Canvas pan/zoom/pinch is hand-rolled in
`src/ui/editor/gesture.ts` (zoompinch's gesture model, vendored after a
NO-GO integration spike — see DECISIONS.md).

Fully client-side: no backend, no network calls at runtime, works offline
once loaded; deploys as static assets to Cloudflare Pages. Internal units are
SI; the UI defaults to imperial with a metric toggle.

## Development

```sh
npm install
npm run dev        # dev server
npm test           # unit + acceptance tests (Vitest)
npm run e2e        # Playwright smoke test against the built app
npm run typecheck  # tsc --noEmit
npm run lint       # Biome (lint + format check); lint:fix applies fixes
npm run build      # production build to dist/
```

CI (GitHub Actions) runs typecheck, lint, tests, build, and the Playwright
smoke on every push to main, then deploys the tested build to Cloudflare
Pages. Solver and BOM math are covered by acceptance tests; UI logic is
tested in Vitest (Testing Library); the Playwright suite stays smoke-level.

## Layout

```
src/schema/        Zod schemas (z.infer types), schemaVersion + migrations
src/solver/        solve() — XPBD kinematic + equilibrium modes, acceptance tests
src/geometry/      shared 3D math (vec/quat, panel frames) + pipe geometry
src/bom/           BOM computation, nesting compatibility, bend schedule, CSV export
src/analysis/      mass inventory, CG, seesaw balance (pure, over solve() output)
src/design/        pure design-face logic: resolution checklist, element info, densities
src/persistence/   Dexie store, autosave, revisions, JSON export/import
src/state/         Zustand app store + document operations
src/ui/            React UI (quad workspace, panel editors, perspective view, docks)
src/wearer/        mannequin, panel-basis silhouette projection, movement clips
src/examples/      bundled example content (all fifteen examples, builder-generated)
e2e/               Playwright smoke suite
docs/planfiles/    archived specs for the shipped phases and features
```

The Phase 0 evaluation harness (three solver candidates benchmarked against
analytic solutions) was archived after review; see git history and the
"Method" section of [DECISIONS.md](DECISIONS.md).
