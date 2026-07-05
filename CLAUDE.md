# CLAUDE.md — PVC Rig Lab

## Source of truth
The original spec and all feature planfiles shipped and are archived under
`docs/planfiles/` (the founding spec is
`docs/planfiles/PLANFILE-pvc-rig-lab.md`). The project is now in maintenance:
the current behavior of the app plus `DECISIONS.md` is the source of truth.
New feature work gets its own planfile in `docs/planfiles/` first; if existing
behavior and a planfile disagree, **stop and ask** rather than choosing
silently.

## Process rules
- **Solver and BOM math must be covered by acceptance tests** before a change
  counts as done — write the tests whenever it helps (test-first is not
  required). UI logic is tested in Vitest (+ Testing Library) — if a behavior
  can be asserted against a component or `solve()`, it must not become an e2e
  spec. Playwright stays a small smoke suite kept green; it is not the
  development verification loop.
- Log every architectural or library decision, and every deliberate deviation
  from an agreed plan, in `DECISIONS.md` with one-paragraph reasoning.
  Deviations must also be called out to me in your summary, not buried.
- No scope beyond what was asked. No speculative abstractions, no extra
  features, no "while I was in there" additions.
- If we agree to change the scope of planned work, update its planfile in the
  same commit.

## Engineering rules
- Solver lives behind `solve(mechanism, inputs, mode)` in `src/solver/` — pure, deterministic, no UI or engine types in its public interface, regardless of what's inside.
- TypeScript strict; Zod schemas are the single source of truth for the project file format (`z.infer` for types); every schema change bumps `schemaVersion` and adds a migration.
- Pin exact dependency versions.
- Small commits per vertical slice; CI (typecheck + lint + test + build) must be green at every commit on main. Lint/format is Biome (`npm run lint`, zero diagnostics); rule suppressions need an inline `biome-ignore` with a reason, and rule-config changes go through DECISIONS.md.
- **Browser verification is scripted, not driven**: verify the built app with a headless Playwright script against `npx vite preview`, asserting app state through the `window.__riglab` debug hook in a single evaluate — not step-by-step interactive MCP clicking (one agent round trip per click). Interactive driving is reserved for gesture-feel checks (drag, double-click, snapping) that need a human-like pointer. Details in DECISIONS.md ("browser verification is scripted, not driven").
- No network calls at runtime, no backend, no analytics. Static assets only.
- No creature-specific language in code identifiers or UI strings; raptor exists only in bundled example data files.

## Definition of done for any task
1. Acceptance/unit tests pass, including all previously passing tests.
2. `npm run build` succeeds and the built app works (not just dev server).
3. DECISIONS.md (and the relevant planfile, if any) updated if anything was decided or changed.
4. A short summary of what was built, what was deferred, and any open questions.
