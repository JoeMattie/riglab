// Per-element linear densities fed into SolveInputs.elementLinearDensityKgPerM
// (§4.2 materials integration). Pure: Mechanism + MaterialsDb → record. An
// element absent from the record falls back to the generic density inside the
// solver, so sketch-maturity members keep behaving plausibly (§4.2).
import type { MaterialsDb, Mechanism } from '../schema';

/**
 * Densities for engineered pipe elements. A telescope gets the effective
 * density that reproduces its BOM member masses when the solver multiplies by
 * the element length: outer member spans L/2, the inner L/2 + overlap
 * (overlapM ?? 2× inner OD — the same split computeBom uses), overlap
 * counting both pipes (§4.2). bentLink uses its material density directly;
 * the solver integrates it over the polyline length (fillet arcs shorten
 * that slightly — an accepted approximation for equilibrium mass).
 */
export function elementLinearDensities(
  mechanism: Mechanism,
  materials: MaterialsDb,
): Record<string, number> {
  const pipe = (id: string | undefined) => materials.pipes.find((p) => p.id === id);
  const out: Record<string, number> = {};

  for (const el of mechanism.elements) {
    if (el.type === 'link' || el.type === 'bentLink') {
      const mat = pipe(el.pipeMaterialId);
      if (mat) out[el.id] = mat.linearDensityKgPerM;
    } else if (el.type === 'telescope') {
      const outer = pipe(el.outerPipeMaterialId);
      const inner = pipe(el.innerPipeMaterialId);
      if (!outer || !inner || el.lengthM <= 0) continue;
      const overlap = el.overlapM ?? 2 * inner.outerDiameterM;
      const massKg =
        (el.lengthM / 2) * outer.linearDensityKgPerM +
        (el.lengthM / 2 + overlap) * inner.linearDensityKgPerM;
      out[el.id] = massKg / el.lengthM;
    }
  }
  return out;
}
