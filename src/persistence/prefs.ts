import type { UnitsPreference } from '../schema';

// localStorage is for UI preferences only (§3); documents live in Dexie.

const UNITS_KEY = 'rig-lab.units';
const LAST_PROJECT_KEY = 'rig-lab.lastProjectId';
const NIGHT_KEY = 'rig-lab.night';

export function getUnitsPref(): UnitsPreference {
  const v = localStorage.getItem(UNITS_KEY);
  return v === 'metric' ? 'metric' : 'imperial';
}

export function setUnitsPref(units: UnitsPreference): void {
  localStorage.setItem(UNITS_KEY, units);
}

// The night pref is read at store-module load, which tests reach without a
// working localStorage (Node's built-in shadows jsdom's and is undefined by
// default), so these two go through a guarded accessor with an in-memory
// fallback instead of the bare global the other prefs use.
const memoryFallback = new Map<string, string>();
function safeStorage(): Storage | Map<string, string> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // security errors (opaque origin) fall through to the in-memory store
  }
  return memoryFallback;
}

export function getNightPref(): boolean {
  const s = safeStorage();
  return (s instanceof Map ? (s.get(NIGHT_KEY) ?? null) : s.getItem(NIGHT_KEY)) === '1';
}

export function setNightPref(night: boolean): void {
  const s = safeStorage();
  if (s instanceof Map) {
    if (night) s.set(NIGHT_KEY, '1');
    else s.delete(NIGHT_KEY);
  } else {
    if (night) s.setItem(NIGHT_KEY, '1');
    else s.removeItem(NIGHT_KEY);
  }
}

export function getLastProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_KEY);
}

export function setLastProjectId(id: string | null): void {
  if (id === null) localStorage.removeItem(LAST_PROJECT_KEY);
  else localStorage.setItem(LAST_PROJECT_KEY, id);
}
