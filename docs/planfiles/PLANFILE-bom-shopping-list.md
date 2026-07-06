# PLANFILE — BOM consolidated shopping list

## Ask (Joe, 2026-07-06)
The BOM should have a consolidated shopping list as well: if the cut segments
of a given pipe stock (e.g. 1/2" PVC) add up to 9 feet, it should suggest
buying 1 × 10' section.

## Scope
One new BOM section, `shoppingList`, computed inside `computeBom()` (pure,
same partial-BOM semantics as the rest) and surfaced everywhere the BOM
already renders: BomPanel, CSV export, printable shop sheet. It consolidates
what to actually buy:

- **Pipe stock** — per pipe material, the number of stock sticks to buy.
  Cut parts (pipe cuts **and** heat-wrap connector pieces, which are cut from
  the same stock) are packed into sticks with first-fit-decreasing bin
  packing, not a naive `ceil(total / stockLength)` — three 6' cuts need three
  10' sticks, not two. Each line reports sticks to buy, cut count, total cut
  length, and leftover.
- **Fittings** — quantity per type/size (same counts as the fittings
  section, restated as purchase lines).
- **Hardware** — quantity per hardware item (bolt sets, conduit boxes);
  previously counted internally for mass/cost but never listed.
- **Cordage** — total length per cordage material, with the rope waste
  factor applied to rope-kind materials (matching consumables semantics).

## Stock length
US PVC/CPVC sticks are sold in 10' sections, and the seeded materials DB is
deliberately US-inch-only, so the stock length is a module constant
`DEFAULT_PIPE_STOCK_LENGTH_M = 3.048` (10'), not a schema field — no
schemaVersion bump. Per-material stock lengths (5'/2' big-box sections) are
deferred until someone needs them; they would ride on `pipeMaterialSchema`
with a migration.

A cut longer than the stock length can't be bought as one piece: it still
counts `ceil(len / stock)` sticks and raises a new BOM warning kind
`cutLongerThanStock` telling the builder to plan a coupling or longer stock.

## Out of scope / deferred
- Saw kerf allowance in packing (cuts are packed at exact length).
- Configurable/per-material stock lengths (see above).
- Prices for sticks — cost stays per-metre via the existing `unitPrices`.

## Acceptance
- Packing math unit-tested in `src/bom/shopping.test.ts`, including the
  9'→one-10'-stick example, the FFD-beats-naive-ceiling case, connector
  pieces packing into leftover, the oversize-cut warning, and the
  fittings/hardware/cordage lines (rope waste factor applied).
- BomPanel renders the section (Vitest + Testing Library); CSV export
  includes it (`csv.test.ts`). Playwright untouched.
