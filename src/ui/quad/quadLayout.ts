// Pure layout math for the quad workspace grid (PLANFILE-quad-panel-controls
// sub-features A + B): panel visibility + the shared splitter-fraction pair
// → CSS-grid templates, per-panel grid areas, and the splitter set. The
// classic quad-CAD model: ONE vertical and ONE horizontal splitter shared by
// all four panels, so quadrant edges always stay aligned.
import type { QuadPanelId } from '../../state/editorStore';

/** Fraction of the workspace given to the left column (x) / top row (y). */
export interface QuadSplit {
  x: number;
  y: number;
}

/** Splitter grid-track thickness (px). */
export const SPLIT_PX = 6;
/** Splitter fractions clamp here — no panel below ~15% of the workspace. */
export const MIN_SPLIT = 0.15;
export const MAX_SPLIT = 0.85;

export function clampSplit(f: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, f));
}

/** Fixed quadrant of each panel in the 2×2 grid (Rhino order). */
const SLOT: Record<QuadPanelId, { row: 0 | 1; col: 0 | 1 }> = {
  top: { row: 0, col: 0 },
  persp: { row: 0, col: 1 },
  front: { row: 1, col: 0 },
  side: { row: 1, col: 1 },
};

/** Canonical panel order — reading order of the quadrants. */
export const PANEL_ORDER: readonly QuadPanelId[] = ['top', 'persp', 'front', 'side'];

export interface PanelCell {
  panel: QuadPanelId;
  gridColumn: string;
  gridRow: string;
}

export interface SplitterCell {
  /** 'v' vertical bar, 'h' horizontal bar, 'c' the center both-axes handle */
  id: 'v' | 'h' | 'c';
  /** which split fraction(s) dragging this splitter adjusts */
  axes: ReadonlyArray<'x' | 'y'>;
  gridColumn: string;
  gridRow: string;
}

export interface QuadLayoutResult {
  gridTemplateColumns: string;
  gridTemplateRows: string;
  cells: PanelCell[];
  splitters: SplitterCell[];
}

/** 4 decimals is ~1px precision on any real viewport; keeps 1−f exact. */
const fr = (v: number): number => Number(v.toFixed(4));
const splitTracks = (f: number): string => `${fr(f)}fr ${SPLIT_PX}px ${fr(1 - f)}fr`;
/** grid track of a slot column/row index in a split template (1 or 3) */
const track = (i: 0 | 1): string => (i === 0 ? '1' : '3');

/**
 * Lay out the visible panels. Reflow rules (planfile B):
 * - 4 → 2×2, vertical + horizontal splitters + center handle;
 * - 3 → the hidden panel's column-mate spans both rows (one large + two
 *   stacked); the horizontal splitter only crosses the two-panel column;
 * - 2 same column → stacked (horizontal splitter only);
 * - 2 same row / diagonal → side-by-side full height (vertical splitter);
 * - 1 → full-bleed, no splitters.
 * A maximized panel is the caller's concern: pass `[panel]`.
 */
export function quadLayout(visible: readonly QuadPanelId[], split: QuadSplit): QuadLayoutResult {
  const panels = PANEL_ORDER.filter((p) => visible.includes(p));
  const x = clampSplit(split.x);
  const y = clampSplit(split.y);

  if (panels.length <= 1) {
    return {
      gridTemplateColumns: '1fr',
      gridTemplateRows: '1fr',
      cells: panels.map((panel) => ({ panel, gridColumn: '1', gridRow: '1' })),
      splitters: [],
    };
  }

  if (panels.length === 2) {
    const [a, b] = panels as [QuadPanelId, QuadPanelId];
    if (SLOT[a].col === SLOT[b].col) {
      // stacked: a is the top-row panel by canonical order
      return {
        gridTemplateColumns: '1fr',
        gridTemplateRows: splitTracks(y),
        cells: [
          { panel: a, gridColumn: '1', gridRow: '1' },
          { panel: b, gridColumn: '1', gridRow: '3' },
        ],
        splitters: [{ id: 'h', axes: ['y'], gridColumn: '1', gridRow: '2' }],
      };
    }
    // same row or diagonal: side by side, each full height, in slot columns
    const left = SLOT[a].col === 0 ? a : b;
    const right = left === a ? b : a;
    return {
      gridTemplateColumns: splitTracks(x),
      gridTemplateRows: '1fr',
      cells: [
        { panel: left, gridColumn: '1', gridRow: '1' },
        { panel: right, gridColumn: '3', gridRow: '1' },
      ],
      splitters: [{ id: 'v', axes: ['x'], gridColumn: '2', gridRow: '1' }],
    };
  }

  if (panels.length === 3) {
    const hidden = PANEL_ORDER.find((p) => !visible.includes(p))!;
    // the hidden quadrant's column-mate takes the whole column
    const spanning = PANEL_ORDER.find((p) => p !== hidden && SLOT[p].col === SLOT[hidden].col)!;
    const pairCol = SLOT[hidden].col === 0 ? 1 : 0;
    return {
      gridTemplateColumns: splitTracks(x),
      gridTemplateRows: splitTracks(y),
      cells: panels.map((panel) =>
        panel === spanning
          ? { panel, gridColumn: track(SLOT[panel].col), gridRow: '1 / -1' }
          : { panel, gridColumn: track(SLOT[panel].col), gridRow: track(SLOT[panel].row) },
      ),
      splitters: [
        { id: 'v', axes: ['x'], gridColumn: '2', gridRow: '1 / -1' },
        { id: 'h', axes: ['y'], gridColumn: track(pairCol as 0 | 1), gridRow: '2' },
      ],
    };
  }

  // all four: full 2×2 with the shared splitter pair + center handle
  return {
    gridTemplateColumns: splitTracks(x),
    gridTemplateRows: splitTracks(y),
    cells: panels.map((panel) => ({
      panel,
      gridColumn: track(SLOT[panel].col),
      gridRow: track(SLOT[panel].row),
    })),
    splitters: [
      { id: 'v', axes: ['x'], gridColumn: '2', gridRow: '1 / -1' },
      { id: 'h', axes: ['y'], gridColumn: '1 / -1', gridRow: '2' },
      { id: 'c', axes: ['x', 'y'], gridColumn: '2', gridRow: '2' },
    ],
  };
}
