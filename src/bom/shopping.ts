// Consolidated shopping list (PLANFILE-bom-shopping-list.md): what to buy,
// as opposed to the cut list's what to make. Pure and framework-free like
// the rest of the BOM module.
//
// Pipe cuts are packed into purchasable stock sticks with first-fit-
// decreasing bin packing — a naive ceil(totalLength / stockLength) under-buys
// (three 6' cuts total 18' but need three 10' sticks, not two). Heat-wrap
// connector pieces are cut from the same stock, so they pack into the same
// sticks. A cut longer than a stick still counts ceil(len/stock) sticks; the
// caller raises a `cutLongerThanStock` warning for it.

/** US PVC/CPVC stock sticks are sold in 10' sections; the seeded materials DB
 * is deliberately US-inch-only (§6.1), so this is a constant, not a schema
 * field. Per-material stock lengths are deferred (see the planfile). */
export const DEFAULT_PIPE_STOCK_LENGTH_M = 3.048;

/** Fits-in-stick tolerance so a cut of exactly one stock length packs. */
const PACK_EPS_M = 1e-9;

export interface PipeShoppingLine {
  materialId: string;
  materialName: string;
  stockLengthM: number;
  /** stock sections to buy */
  sticksToBuy: number;
  /** number of cut parts packed (pipe cuts + wrap connectors) */
  cutCount: number;
  /** sum of packed cut lengths */
  totalCutM: number;
  /** sticksToBuy × stockLengthM − totalCutM */
  leftoverM: number;
  /** cuts longer than one stick (each also raises a BOM warning) */
  oversizeCuts: number[];
}

export interface ItemShoppingLine {
  id: string;
  label: string;
  quantity: number;
}

export interface LengthShoppingLine {
  id: string;
  label: string;
  lengthM: number;
}

export interface ShoppingList {
  pipes: PipeShoppingLine[];
  fittings: ItemShoppingLine[];
  hardware: ItemShoppingLine[];
  /** rope waste factor already applied to rope-kind materials */
  cordage: LengthShoppingLine[];
}

export interface PackResult {
  sticks: number;
  oversizeCuts: number[];
}

/** First-fit-decreasing packing of cut lengths into stock sticks. */
export function packSticks(cutLengthsM: number[], stockLengthM: number): PackResult {
  const oversizeCuts: number[] = [];
  let sticks = 0;
  const remaining: number[] = []; // leftover capacity of opened sticks
  const sorted = [...cutLengthsM].sort((a, b) => b - a);
  for (const len of sorted) {
    if (len > stockLengthM + PACK_EPS_M) {
      oversizeCuts.push(len);
      sticks += Math.ceil(len / stockLengthM - PACK_EPS_M);
      continue;
    }
    const slot = remaining.findIndex((cap) => cap + PACK_EPS_M >= len);
    if (slot >= 0) {
      remaining[slot] = (remaining[slot] ?? 0) - len;
    } else {
      sticks += 1;
      remaining.push(stockLengthM - len);
    }
  }
  return { sticks, oversizeCuts };
}
