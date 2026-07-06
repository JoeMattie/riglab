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

// ── Quad workspace layout (PLANFILE-quad-panel-controls.md) ────────────────
// Splitter fractions + per-panel visibility are workspace preferences (like
// units/night), not document state: they survive reloads and project
// switches and never enter undo history. Read at editor-store module load,
// so they use the guarded accessor like the night pref.

const QUAD_LAYOUT_KEY = 'rig-lab.quadLayout';

/** Kept literal (not imported from state/) so prefs stays dependency-free. */
export type QuadPanelPrefId = 'top' | 'persp' | 'front' | 'side';

export interface QuadLayoutPref {
  /** fraction of the workspace given to the left column / top row */
  split: { x: number; y: number };
  visible: Record<QuadPanelPrefId, boolean>;
}

const PANEL_PREF_IDS: QuadPanelPrefId[] = ['top', 'persp', 'front', 'side'];

export function getQuadLayoutPref(): QuadLayoutPref | null {
  const s = safeStorage();
  const raw = s instanceof Map ? (s.get(QUAD_LAYOUT_KEY) ?? null) : s.getItem(QUAD_LAYOUT_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<QuadLayoutPref>;
    const frac = (v: unknown): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(0.85, Math.max(0.15, v)) : 0.5;
    const visible = Object.fromEntries(
      PANEL_PREF_IDS.map((id) => [id, p.visible?.[id] !== false]),
    ) as Record<QuadPanelPrefId, boolean>;
    // a corrupt pref must never produce an all-hidden workspace
    if (!PANEL_PREF_IDS.some((id) => visible[id])) {
      for (const id of PANEL_PREF_IDS) visible[id] = true;
    }
    return { split: { x: frac(p.split?.x), y: frac(p.split?.y) }, visible };
  } catch {
    return null;
  }
}

export function setQuadLayoutPref(pref: QuadLayoutPref): void {
  const s = safeStorage();
  const raw = JSON.stringify(pref);
  if (s instanceof Map) s.set(QUAD_LAYOUT_KEY, raw);
  else s.setItem(QUAD_LAYOUT_KEY, raw);
}

// ── Tool pill collapsed-to-icons ────────────────────────────────────────────
// Workspace pref like night/quad layout: survives reloads and project
// switches, never enters undo history. Uses the guarded accessor because
// component tests render without a working localStorage.

const TOOL_PILL_COLLAPSED_KEY = 'rig-lab.toolPillCollapsed';

export function getToolPillCollapsedPref(): boolean {
  const s = safeStorage();
  return (
    (s instanceof Map
      ? (s.get(TOOL_PILL_COLLAPSED_KEY) ?? null)
      : s.getItem(TOOL_PILL_COLLAPSED_KEY)) === '1'
  );
}

export function setToolPillCollapsedPref(collapsed: boolean): void {
  const s = safeStorage();
  if (s instanceof Map) {
    if (collapsed) s.set(TOOL_PILL_COLLAPSED_KEY, '1');
    else s.delete(TOOL_PILL_COLLAPSED_KEY);
  } else {
    if (collapsed) s.setItem(TOOL_PILL_COLLAPSED_KEY, '1');
    else s.removeItem(TOOL_PILL_COLLAPSED_KEY);
  }
}

export function getLastProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_KEY);
}

export function setLastProjectId(id: string | null): void {
  if (id === null) localStorage.removeItem(LAST_PROJECT_KEY);
  else localStorage.setItem(LAST_PROJECT_KEY, id);
}
