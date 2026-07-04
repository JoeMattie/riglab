// Nesting compatibility (§6.1). Derived, never stored: diametral clearance and
// its classification are computed live from OD/ID so the matrix follows the
// user's calipered edits. Pure functions — no UI, no engine types.
import type { PipeMaterial } from '../schema';

export type NestingClass = 'press' | 'snug' | 'slip' | 'sloppy';

// Band edges in metres (§6.1: press <0, snug 0–0.5 mm, slip 0.5–1.5 mm,
// sloppy >1.5 mm). Upper edges are inclusive (snug owns exactly 0.5 mm, slip
// owns exactly 1.5 mm) — documented in DECISIONS.md.
const SNUG_MAX_M = 0.0005;
const SLIP_MAX_M = 0.0015;

/** Diametral clearance = ID(outer) − OD(inner). Negative ⇒ interference. */
export function nestingClearanceM(outer: PipeMaterial, inner: PipeMaterial): number {
  return outer.innerDiameterM - inner.outerDiameterM;
}

/** Classify a diametral clearance (metres) into a fit band (§6.1). */
export function classifyNesting(clearanceM: number): NestingClass {
  if (clearanceM < 0) return 'press';
  if (clearanceM <= SNUG_MAX_M) return 'snug';
  if (clearanceM <= SLIP_MAX_M) return 'slip';
  return 'sloppy';
}

export interface NestingPair {
  outerId: string;
  innerId: string;
  clearanceM: number;
  classification: NestingClass;
}

/** Every ordered pair of distinct pipes (outer, inner). Ordered because
 * nesting is asymmetric: A-inside-B differs from B-inside-A. */
export function nestingMatrix(pipes: PipeMaterial[]): NestingPair[] {
  const out: NestingPair[] = [];
  for (const outer of pipes) {
    for (const inner of pipes) {
      if (outer.id === inner.id) continue;
      const clearanceM = nestingClearanceM(outer, inner);
      out.push({
        outerId: outer.id,
        innerId: inner.id,
        clearanceM,
        classification: classifyNesting(clearanceM),
      });
    }
  }
  return out;
}

export interface TelescopeFitValidation {
  classification: NestingClass;
  clearanceM: number;
  /** true only for a slip fit — the one band that telescopes/detaches cleanly */
  acceptable: boolean;
  severity: 'ok' | 'warn';
  reason?: string;
}

// A telescoping / detachable joint wants a *slip* fit: it must slide but not
// wobble. 'snug' is a sleeve bearing or glued coupler — too tight to travel;
// 'press' is an interference coupler — will not slide; 'sloppy' needs shimming.
// So only 'slip' is accepted for a telescope; everything else warns (§6.2).
const TELESCOPE_WARN_REASON: Record<Exclude<NestingClass, 'slip'>, string> = {
  snug: 'snug fit binds when sliding — better as a fixed sleeve/coupler',
  press: 'interference fit will not slide — this is a rigid coupler, not a telescope',
  sloppy: 'loose fit wobbles — shim it or pick a closer-fitting pair',
};

/** Validate a telescope's outer/inner pipe pair against the nesting bands. */
export function validateTelescopePair(
  outer: PipeMaterial,
  inner: PipeMaterial,
): TelescopeFitValidation {
  const clearanceM = nestingClearanceM(outer, inner);
  const classification = classifyNesting(clearanceM);
  if (classification === 'slip') {
    return { classification, clearanceM, acceptable: true, severity: 'ok' };
  }
  return {
    classification,
    clearanceM,
    acceptable: false,
    severity: 'warn',
    reason: TELESCOPE_WARN_REASON[classification],
  };
}
