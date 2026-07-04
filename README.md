# PVC Rig Lab

A browser-based tool for rapidly prototyping and mechanically simulating PVC
linkage mechanisms for wearable articulated creatures / pseudo-marionettes
mounted on a pack frame — then estimating the parts list, weight, and balance
before any pipe gets cut.

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

**Phase 1 complete** (sketch & play): draw straight/polyline/freehand pipes
on the wearer silhouette, snap-connect with the pivot/weld/slider menu, drag
mechanisms through their range of motion with a live kinematic XPBD solve,
anchor nodes, bind nodes to skeleton points, and play walk / arm-swing /
lean clips that drive the bound nodes. Undo/redo, DOF badge, motion-path
tracing. Phase 0 delivered the library spike ([DECISIONS.md](DECISIONS.md) —
custom XPBD + Konva), Zod schema with migrations, Dexie persistence, and
JSON export/import.

| Phase | Scope | Status |
|---|---|---|
| 0 | Library spike + scaffold | ✅ done |
| 1 | Sketch & play: draw pipes, snap-connect, drag-to-pose, movement clips | ✅ done |
| 2 | Forces: ropes/elastics/bowden/torsion, equilibrium, tension readouts | — |
| 3 | Design face: materials DB, nesting matrix, cut list + BOM | — |
| 4 | 3D assembly: full mannequin, instance placement, mass/CG/balance | — |
| 5 | Bundled examples + polish | — |

The full specification lives in
[PLANFILE-pvc-rig-lab.md](PLANFILE-pvc-rig-lab.md) — it is the source of
truth. Process and engineering rules are in [CLAUDE.md](CLAUDE.md); every
architectural decision and deviation is logged in
[DECISIONS.md](DECISIONS.md).

## Stack

Vite · React · TypeScript (strict) · Zustand (+ zundo for undo) · Zod
(schema = single source of truth, versioned with migrations) · Dexie
(IndexedDB) · Konva (2D editor) · three.js via react-three-fiber (3D
assembly, Phase 4) · custom XPBD solver behind a pure
`solve(mechanism, inputs, mode)` interface · Vitest + Playwright.

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
npm run build      # production build to dist/
```

CI (GitHub Actions) runs typecheck, tests, build, and the Playwright smoke
on every push. Solver and BOM math are developed test-first: acceptance
tests for future phases are committed skip-marked and un-skipped at the
start of their phase.

## Layout

```
src/schema/        Zod schemas (z.infer types), schemaVersion + migrations
src/solver/        solve() interface + acceptance tests (XPBD impl: Phase 1)
src/persistence/   Dexie store, autosave, revisions, JSON export/import
src/state/         Zustand app store
src/ui/            React UI (project manager shell; editor from Phase 1)
e2e/               Playwright smoke test
```

The Phase 0 evaluation harness (three solver candidates benchmarked against
analytic solutions) was archived after review; see git history and the
"Method" section of [DECISIONS.md](DECISIONS.md).
