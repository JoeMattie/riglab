import type { UnitsPreference } from '../schema';

// localStorage is for UI preferences only (§3); documents live in Dexie.

const UNITS_KEY = 'rig-lab.units';
const LAST_PROJECT_KEY = 'rig-lab.lastProjectId';

export function getUnitsPref(): UnitsPreference {
  const v = localStorage.getItem(UNITS_KEY);
  return v === 'metric' ? 'metric' : 'imperial';
}

export function setUnitsPref(units: UnitsPreference): void {
  localStorage.setItem(UNITS_KEY, units);
}

export function getLastProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_KEY);
}

export function setLastProjectId(id: string | null): void {
  if (id === null) localStorage.removeItem(LAST_PROJECT_KEY);
  else localStorage.setItem(LAST_PROJECT_KEY, id);
}
