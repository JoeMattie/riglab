# CLAUDE.md — PVC Rig Lab

## Source of truth
`PLANFILE-pvc-rig-lab.md` is the authoritative spec. If anything here or in your own judgment conflicts with it, the planfile wins; if the planfile is ambiguous or seems wrong, **stop and ask** rather than choosing silently.

## Process rules
- Work strictly phase-by-phase (planfile §11). Do not begin phase N+1 until phase N's acceptance criteria pass as automated tests. **Pause for human review at the end of Phase 0 (DECISIONS.md) and Phase 2 (solver correctness)** — these are the two decisions everything downstream depends on.
- **Solver and BOM math must be covered by the phase's acceptance tests** before the phase counts as done — write the tests whenever it helps (test-first is not required). UI logic is tested in Vitest (+ Testing Library) — if a behavior can be asserted against a component or `solve()`, it must not become an e2e spec. Playwright stays a small smoke suite kept green; it is not the development verification loop.
- Log every architectural or library decision, and every deliberate deviation from the planfile, in `DECISIONS.md` with one-paragraph reasoning. Deviations must also be called out to me in your summary, not buried.
- No scope beyond the planfile without asking. No speculative abstractions, no extra features, no "while I was in there" additions. Stretch goals (§10) are off-limits until all five phases pass.
- Keep the checked-in planfile in sync: if we agree to change scope, update the planfile in the same commit.

## Engineering rules (see planfile §12 for the full list)
- Solver lives behind `solve(mechanism, inputs, mode)` in `src/solver/` — pure, deterministic, no UI or engine types in its public interface, regardless of what's inside.
- TypeScript strict; Zod schemas are the single source of truth for the project file format (`z.infer` for types); every schema change bumps `schemaVersion` and adds a migration.
- Pin exact dependency versions. If the spike selects a WASM engine, verify in Phase 0 that the WASM asset loads from a production Cloudflare Pages build (`npx wrangler pages dev` on the built output is an acceptable proxy), and add a determinism test pinned to the engine version.
- Small commits per vertical slice; CI (typecheck + lint + test + build) must be green at every commit on main. Lint/format is Biome (`npm run lint`, zero diagnostics); rule suppressions need an inline `biome-ignore` with a reason, and rule-config changes go through DECISIONS.md.
- **Browser verification is scripted, not driven**: verify the built app with a headless Playwright script against `npx vite preview`, asserting app state through the `window.__riglab` debug hook in a single evaluate — not step-by-step interactive MCP clicking (one agent round trip per click). Interactive driving is reserved for gesture-feel checks (drag, double-click, snapping) that need a human-like pointer. Details in DECISIONS.md ("browser verification is scripted, not driven").
- No network calls at runtime, no backend, no analytics. Static assets only.
- No creature-specific language in code identifiers or UI strings; raptor exists only in bundled example data files.

## Definition of done for any task
1. Acceptance/unit tests pass, including all previously passing tests.
2. `npm run build` succeeds and the built app works (not just dev server).
3. DECISIONS.md and planfile updated if anything was decided or changed.
4. A short summary of what was built, what was deferred, and any open questions.
