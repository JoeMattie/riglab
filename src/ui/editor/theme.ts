// Design tokens for the "floating glass" editor chrome (design handoff:
// design_handoff_editor_overhaul/README.md §Design Tokens). One module so
// every floating panel/chip/popover shares the same numbers.
import type { CSSProperties } from 'react';

export const T = {
  // chrome colors
  bg: '#fcfcfd',
  panel: '#fff',
  border: '#e4e4e7',
  hairline: '#f0f0f2',
  text: '#1a1d24',
  muted: '#71717a',
  faint: '#a1a1aa',
  icon: '#52525b',
  accent: '#2a78d6',
  accentTint: '#e9f1fb',
  accentText: '#1d5fb8',
  success: '#3d9950',
  dangerText: '#b32',
  danger: '#c33',
  dangerBorder: '#e9a4a4',
  dangerTint: '#fdf3f3',
  // canvas colors (SketchCanvas keeps its own literals; these are for chrome
  // that must match the canvas, e.g. the selection card swatch)
  selected: '#d80',
  selectedText: '#b46a00',
  // type
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

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
    background: on ? T.accentTint : '#f4f4f5',
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
  background: '#fafafa',
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
