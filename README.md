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

**Phase 5 examples slice done** (out of order, ahead of Phases 4/4.5): all
seven §9 example projects now ship as bundled, builder-generated JSON —
seesaw spine, neck truss (pitch), steer mirror (plan) with crossed ropes,
jaw + Bowden with lockable trigger, gait-driven leg exoskeleton, tail, and
the full-creature Project Raptor recreation (2D scope: its yoke control,
control clip, and 3D placement wait on Phases 4/4.5). The movement-clip
library is complete (`walk`, `arm swing`, `lean`, `dance`,
`sit down / stand up`, `crouch`, `idle sway`; format documented in
[docs/movement-clips.md](docs/movement-clips.md)). Examples are data-side
only for now — loaded via the `EXAMPLES` registry in `src/examples/` — the
"New from example" menu, onboarding, shortcuts, printable BOM, perf pass,
and visual polish land in a **finishing slice** after the in-flight
interface overhaul.

**Phase 3 complete** (design face): a Sketch/Design face toggle with
element multi-select; a right dock with a selection inspector (info panel),
a per-element/mechanism resolution checklist with click-to-fix, an editable
materials DB with a live pipe-nesting (telescoping) matrix, and a BOM panel
with partial-data banner and CSV export; material densities now feed the
equilibrium solve, and a units toggle switches length/mass display between
imperial and metric. The seesaw-spine example ships as bundled content.
Canvas pan/zoom/pinch landed via a hand-rolled gesture layer after the
zoompinch integration spike came back NO-GO (its gesture model was vendored
with tests — see [DECISIONS.md](DECISIONS.md)).

Phase 2 delivered forces: ropes with eyelet routing, elastics, bowden and
torsion-cable couplings, gravity + static-equilibrium relaxation, force
readouts (tensions, pivot reactions, required input force/torque),
rope-compression warnings, and input channels with lock toggles. Phase 1
delivered sketch & play (draw pipes on the wearer silhouette, snap-connect,
drag-to-pose with a live kinematic XPBD solve, skeleton bindings, movement
clips, undo/redo); Phase 0 the library spike
([DECISIONS.md](DECISIONS.md) — custom XPBD + Konva), Zod schema with
migrations, Dexie persistence, and JSON export/import.

| Phase | Scope | Status |
|---|---|---|
| 0 | Library spike + scaffold | ✅ done |
| 1 | Sketch & play: draw pipes, snap-connect, drag-to-pose, movement clips | ✅ done |
| 2 | Forces: ropes/elastics/bowden/torsion, equilibrium, tension readouts | ✅ done |
| 3 | Design face: info panel, materials DB, nesting matrix, BOM; panel UI + canvas navigation | ✅ done |
| 4 | 3D assembly: full mannequin, instance placement, mass/CG/balance | — |
| 4.5 | Controls: virtual input devices (yoke/lever/trigger) + control clips | — |
| 5 | Bundled examples + polish (design-handoff visual pass) | 🔶 examples + clips done; menu, onboarding, shortcuts, printable BOM, perf + visual pass pending |

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
smoke on every push. Solver and BOM math are developed test-first:
acceptance tests for future phases are committed skip-marked and un-skipped
at the start of their phase. UI logic is tested in Vitest (Testing Library);
the Playwright suite stays smoke-level.

## Layout

```
src/schema/        Zod schemas (z.infer types), schemaVersion + migrations
src/solver/        solve() — XPBD kinematic + equilibrium modes, acceptance tests
src/geometry/      shared pipe geometry (diameters, wall, nesting clearance)
src/bom/           BOM computation, nesting compatibility, CSV export
src/design/        pure design-face logic: resolution checklist, element info, densities
src/persistence/   Dexie store, autosave, revisions, JSON export/import
src/state/         Zustand app store + document operations
src/ui/            React UI (project manager shell, sketch editor, design-face panels)
src/wearer/        mannequin, view projections, movement clips
src/examples/      bundled example content (all seven §9 examples, builder-generated)
e2e/               Playwright smoke suite
```

The Phase 0 evaluation harness (three solver candidates benchmarked against
analytic solutions) was archived after review; see git history and the
"Method" section of [DECISIONS.md](DECISIONS.md).
