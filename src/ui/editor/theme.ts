// Design tokens for the "floating glass" editor chrome (design handoff:
// design_handoff_editor_overhaul/README.md §Design Tokens). One module so
// every floating panel/chip/popover shares the same numbers.
//
// Night view: every chrome color exists in a day and a night palette
// (CHROME below). applyTheme() writes the active palette onto the root
// element as --rl-* custom properties and toggles the `.dark` class (which
// also flips the vendored shadcn tokens in index.css); T references the
// variables, so all inline-styled chrome follows a theme switch without any
// component re-rendering. Renderers that cannot read CSS variables (the
// Konva sketch canvas, three.js materials) take literals from SCENE instead
// and re-render off the theme store's `night` flag.
import type { CSSProperties } from 'react';

export type ThemeName = 'day' | 'night';

const CHROME = {
  day: {
    // surfaces
    bg: '#fcfcfd',
    viewport: '#f6f7f9',
    panel: '#fff',
    raised: '#fff', // active segment on a chip track
    soft: '#fafafa', // bordered mini-buttons
    chip: '#f4f4f5', // inset segmented-control track / toggle chips
    track: '#e9e9ee', // scrubber rail
    // lines
    border: '#e4e4e7',
    hairline: '#f0f0f2',
    focus: '#7ba4d6', // kbd hints, focused-row accents
    ghost: '#c9c9d1', // grip dots, idle kbd hints
    // text
    text: '#1a1d24',
    muted: '#71717a',
    faint: '#a1a1aa',
    icon: '#52525b',
    // accent
    accent: '#2a78d6',
    accentTint: '#e9f1fb',
    accentText: '#1d5fb8',
    // status
    success: '#3d9950',
    okBorder: '#b5d6b9',
    okText: '#2b7237',
    danger: '#c33',
    dangerText: '#b32',
    dangerBorder: '#e9a4a4',
    dangerTint: '#fdf3f3',
    tension: '#036', // required-input readout; matches the canvas force arrows
    // canvas-matching chrome (selection card swatch, dimension chips)
    selected: '#d80',
    selectedText: '#b46a00',
    ink: '#324', // default element stroke; weld/anchor glyph fill
  },
  night: {
    bg: '#14161c',
    viewport: '#101218',
    panel: '#1e2128',
    raised: '#3a3f4b',
    soft: '#272b34',
    chip: '#16181e',
    track: '#33363f',
    border: '#33363f',
    hairline: '#282b33',
    focus: '#6f9ed8',
    ghost: '#565b68',
    text: '#e8eaf0',
    muted: '#9ba0ab',
    faint: '#6e737e',
    icon: '#b3b8c2',
    accent: '#3d8ae0',
    accentTint: '#1c2c42',
    accentText: '#8ec0f5',
    success: '#5cb86f',
    okBorder: '#3c5f45',
    okText: '#8fd39e',
    danger: '#e0554a',
    dangerText: '#e5766a',
    dangerBorder: '#7a3b3b',
    dangerTint: '#32211f',
    tension: '#7fb3ee',
    selected: '#d80',
    selectedText: '#e8a13d',
    ink: '#cdd2e4',
  },
} as const satisfies Record<ThemeName, Record<string, string>>;

type ChromeKey = keyof typeof CHROME.day;

/** Colors handed to renderers that cannot resolve CSS variables: Konva
 * shapes in SketchCanvas and three.js materials in AssemblyView. Bright
 * semantic colors (selection orange, actuator purple, …) read fine on both
 * grounds and stay literal in the components; only legibility-critical
 * colors live here. */
export const SCENE = {
  day: {
    gridStrong: '#c8c8d4',
    gridWeak: '#ededf2',
    silhouette: '#b9c0cc',
    ink: CHROME.day.ink,
    rope: '#557',
    label: '#222',
    tension: '#036',
    nodeFill: '#fff',
    halo: '#fff', // shadowColor lifting labels off the drawing
    dim: '#ccc',
    snap: '#bbb',
    // 3D assembly (tube render, PLANFILE-quad-workspace: shaded capsules —
    // the mannequin carries volume now and needs contrast, not hairline gray)
    grid3dCenter: CHROME.day.border,
    grid3d: CHROME.day.hairline,
    mannequin: '#565e6e',
    instance: '#5b6472',
    pvc: '#e7e9ee', // engineered tube — PVC white, reads via shading
    sketchTube: '#94a0b4', // generic-OD stand-in for sketch elements
    accent: CHROME.day.accent,
  },
  night: {
    gridStrong: '#2f323e',
    gridWeak: '#22242e',
    silhouette: '#454c5e',
    ink: CHROME.night.ink,
    rope: '#99a2c4',
    label: '#e2e4ec',
    tension: '#7fb3ee',
    nodeFill: '#1e2128',
    halo: '#14161c',
    dim: '#4a4e5a',
    snap: '#565b68',
    grid3dCenter: '#343846',
    grid3d: '#262a34',
    mannequin: '#5d6478',
    instance: '#98a0b2',
    pvc: '#c6cbd7',
    sketchTube: '#6e7890',
    accent: CHROME.night.accent,
  },
} as const satisfies Record<ThemeName, Record<string, string>>;

export function scenePalette(night: boolean) {
  return SCENE[night ? 'night' : 'day'];
}

/** Write the active palette onto the root element and toggle `.dark` (which
 * also flips the shadcn tokens). Idempotent; safe to call before render. */
export function applyTheme(name: ThemeName): void {
  const root = document.documentElement;
  root.classList.toggle('dark', name === 'night');
  for (const [key, value] of Object.entries(CHROME[name])) {
    root.style.setProperty(`--rl-${key}`, value);
  }
}

export const T = {
  ...(Object.fromEntries(Object.keys(CHROME.day).map((key) => [key, `var(--rl-${key})`])) as Record<
    ChromeKey,
    string
  >),
  // type
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};

export const PANEL_SHADOW = '0 4px 16px rgba(20,24,40,.08)';
export const MENU_SHADOW = '0 12px 32px rgba(20,24,40,.16)';
export const LOCKED_CHIP_SHADOW = '0 2px 8px rgba(42,120,214,.3)';
export const CHIP_SHADOW = '0 2px 8px rgba(20,24,40,.10)';

/** Shared floating panel/pill base (bg, border, radius 12, shadow). */
export const panelStyle: CSSProperties = {
  background: T.panel,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  boxShadow: PANEL_SHADOW,
  fontFamily: T.sans,
  fontSize: 13.5,
  color: T.text,
};

/** Menus/popovers: same panel, heavier shadow, 6px padding. */
export const menuStyle: CSSProperties = {
  ...panelStyle,
  boxShadow: MENU_SHADOW,
  padding: 6,
};

/** Uppercase group caption (tool pill groups, popover headers). */
export const captionStyle: CSSProperties = {
  font: `500 10.5px ${T.sans}`,
  letterSpacing: '.07em',
  textTransform: 'uppercase',
  color: T.faint,
};

/** Menu/popover row; pass active for the tinted state. */
export function rowStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    border: 'none',
    background: active ? T.accentTint : 'transparent',
    color: active ? T.accentText : T.text,
    borderRadius: 8,
    padding: '6px 8px',
    font: `${active ? 500 : 400} 13px ${T.sans}`,
    cursor: 'pointer',
    textAlign: 'left',
  };
}

/** Small toggle chip (gravity / forces / inputs on the transport pill). */
export function toggleChipStyle(on: boolean): CSSProperties {
  return {
    border: 'none',
    background: on ? T.accentTint : T.chip,
    color: on ? T.accentText : T.muted,
    borderRadius: 8,
    padding: '3px 10px',
    font: `${on ? 500 : 400} 12px ${T.sans}`,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

/** Bordered mini-button (mechanism switcher, clip chip, export). */
export const miniButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  border: `1px solid ${T.border}`,
  background: T.soft,
  borderRadius: 8,
  padding: '3px 10px',
  font: `500 12.5px ${T.sans}`,
  cursor: 'pointer',
  color: T.text,
  whiteSpace: 'nowrap',
};

/** Vertical hairline divider inside chips/pills. */
export const dividerStyle: CSSProperties = {
  width: 1,
  height: 18,
  background: T.border,
  flex: 'none',
};

/** 16px viewport margin for all floating chrome. */
export const EDGE = 16;
