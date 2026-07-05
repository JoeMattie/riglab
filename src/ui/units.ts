// Length/mass unit conversion at the UI display boundary (§3): all stored
// quantities are SI; the project's unitsPreference only changes what the user
// sees and types. Force (N/lbf) already lives in editor/forces.ts.
import type { UnitsPreference } from '../schema';

/** 1 inch in metres (exact, international yard and pound agreement). */
export const M_PER_IN = 0.0254;
/** 1 avoirdupois pound in kilograms (exact). */
export const KG_PER_LB = 0.45359237;

export const lengthUnit = (units: UnitsPreference): string => (units === 'imperial' ? 'in' : 'm');

/** SI metres → the number the user sees/edits (inches when imperial). */
export const lengthToDisplay = (m: number, units: UnitsPreference): number =>
  units === 'imperial' ? m / M_PER_IN : m;

/** The number the user typed → SI metres. */
export const lengthFromDisplay = (v: number, units: UnitsPreference): number =>
  units === 'imperial' ? v * M_PER_IN : v;

export const massUnit = (units: UnitsPreference): string => (units === 'imperial' ? 'lb' : 'kg');

/** SI kilograms → the number the user sees/edits (pounds when imperial). */
export const massToDisplay = (kg: number, units: UnitsPreference): number =>
  units === 'imperial' ? kg / KG_PER_LB : kg;

/** The number the user typed → SI kilograms. */
export const massFromDisplay = (v: number, units: UnitsPreference): number =>
  units === 'imperial' ? v * KG_PER_LB : v;

const trim = (v: number, dp: number): string => String(Number(v.toFixed(dp)));

export function formatLength(m: number, units: UnitsPreference): string {
  return units === 'imperial' ? `${trim(m / M_PER_IN, 2)} in` : `${trim(m, 4)} m`;
}

export function formatMass(kg: number, units: UnitsPreference): string {
  return units === 'imperial' ? `${trim(kg / KG_PER_LB, 2)} lb` : `${trim(kg, 3)} kg`;
}
