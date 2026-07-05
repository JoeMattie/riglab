// Layout engine for the resizable/toggleable quad grid
// (PLANFILE-quad-panel-controls A + B): every visibility cardinality, the
// split fractions landing in the grid templates, and the splitter sets.
import { describe, expect, it } from 'vitest';
import type { QuadPanelId } from '../../state/editorStore';
import { clampSplit, MAX_SPLIT, MIN_SPLIT, PANEL_ORDER, quadLayout } from './quadLayout';

const HALF = { x: 0.5, y: 0.5 };
const cellOf = (r: ReturnType<typeof quadLayout>, panel: QuadPanelId) =>
  r.cells.find((c) => c.panel === panel)!;
const splitterIds = (r: ReturnType<typeof quadLayout>) => r.splitters.map((s) => s.id).sort();

describe('clampSplit', () => {
  it('clamps to the min-size band', () => {
    expect(clampSplit(0)).toBe(MIN_SPLIT);
    expect(clampSplit(1)).toBe(MAX_SPLIT);
    expect(clampSplit(0.42)).toBe(0.42);
  });
});

describe('quadLayout: 4 visible', () => {
  it('is a 2×2 with both splitters and the center handle', () => {
    const r = quadLayout(PANEL_ORDER, { x: 0.3, y: 0.7 });
    expect(r.gridTemplateColumns).toBe('0.3fr 6px 0.7fr');
    expect(r.gridTemplateRows).toBe('0.7fr 6px 0.3fr');
    expect(cellOf(r, 'top')).toMatchObject({ gridColumn: '1', gridRow: '1' });
    expect(cellOf(r, 'persp')).toMatchObject({ gridColumn: '3', gridRow: '1' });
    expect(cellOf(r, 'front')).toMatchObject({ gridColumn: '1', gridRow: '3' });
    expect(cellOf(r, 'side')).toMatchObject({ gridColumn: '3', gridRow: '3' });
    expect(splitterIds(r)).toEqual(['c', 'h', 'v']);
    const v = r.splitters.find((s) => s.id === 'v')!;
    const h = r.splitters.find((s) => s.id === 'h')!;
    const c = r.splitters.find((s) => s.id === 'c')!;
    expect(v).toMatchObject({ axes: ['x'], gridColumn: '2', gridRow: '1 / -1' });
    expect(h).toMatchObject({ axes: ['y'], gridColumn: '1 / -1', gridRow: '2' });
    expect(c).toMatchObject({ axes: ['x', 'y'], gridColumn: '2', gridRow: '2' });
  });

  it('clamps out-of-band fractions in the templates', () => {
    const r = quadLayout(PANEL_ORDER, { x: 0, y: 1 });
    expect(r.gridTemplateColumns).toBe('0.15fr 6px 0.85fr');
    expect(r.gridTemplateRows).toBe('0.85fr 6px 0.15fr');
  });
});

describe('quadLayout: 3 visible (one large + two stacked)', () => {
  it.each([
    // hidden panel → its column-mate spans both rows; h splitter crosses the other column
    ['side', 'persp', '3', '1'],
    ['persp', 'side', '3', '1'],
    ['top', 'front', '1', '3'],
    ['front', 'top', '1', '3'],
  ] as const)('hidden %s → %s spans its column', (hidden, spanning, spanCol, pairColTrack) => {
    const visible = PANEL_ORDER.filter((p) => p !== hidden);
    const r = quadLayout(visible, HALF);
    expect(r.cells).toHaveLength(3);
    expect(cellOf(r, spanning)).toMatchObject({ gridColumn: spanCol, gridRow: '1 / -1' });
    // the other two panels stay in their own quadrant rows
    for (const p of visible.filter((p) => p !== spanning)) {
      expect(cellOf(r, p).gridRow).not.toBe('1 / -1');
      expect(cellOf(r, p).gridColumn).toBe(pairColTrack);
    }
    expect(splitterIds(r)).toEqual(['h', 'v']);
    expect(r.splitters.find((s) => s.id === 'h')).toMatchObject({
      gridColumn: pairColTrack,
      gridRow: '2',
    });
    expect(r.splitters.find((s) => s.id === 'v')).toMatchObject({
      gridColumn: '2',
      gridRow: '1 / -1',
    });
  });
});

describe('quadLayout: 2 visible', () => {
  it('same column → stacked with only the horizontal splitter', () => {
    const r = quadLayout(['top', 'front'], { x: 0.5, y: 0.25 });
    expect(r.gridTemplateColumns).toBe('1fr');
    expect(r.gridTemplateRows).toBe('0.25fr 6px 0.75fr');
    expect(cellOf(r, 'top')).toMatchObject({ gridColumn: '1', gridRow: '1' });
    expect(cellOf(r, 'front')).toMatchObject({ gridColumn: '1', gridRow: '3' });
    expect(splitterIds(r)).toEqual(['h']);
  });

  it('same row → side-by-side with only the vertical splitter', () => {
    const r = quadLayout(['persp', 'top'], { x: 0.6, y: 0.5 });
    expect(r.gridTemplateColumns).toBe('0.6fr 6px 0.4fr');
    expect(r.gridTemplateRows).toBe('1fr');
    expect(cellOf(r, 'top')).toMatchObject({ gridColumn: '1', gridRow: '1' });
    expect(cellOf(r, 'persp')).toMatchObject({ gridColumn: '3', gridRow: '1' });
    expect(splitterIds(r)).toEqual(['v']);
  });

  it('diagonal → side-by-side full height in slot columns', () => {
    const r = quadLayout(['side', 'top'], HALF);
    expect(cellOf(r, 'top')).toMatchObject({ gridColumn: '1', gridRow: '1' });
    expect(cellOf(r, 'side')).toMatchObject({ gridColumn: '3', gridRow: '1' });
    expect(splitterIds(r)).toEqual(['v']);
    const r2 = quadLayout(['front', 'persp'], HALF);
    expect(cellOf(r2, 'front')).toMatchObject({ gridColumn: '1', gridRow: '1' });
    expect(cellOf(r2, 'persp')).toMatchObject({ gridColumn: '3', gridRow: '1' });
  });
});

describe('quadLayout: 1 visible', () => {
  it('is full-bleed with no splitters (the maximized case)', () => {
    for (const p of PANEL_ORDER) {
      const r = quadLayout([p], { x: 0.2, y: 0.8 });
      expect(r.gridTemplateColumns).toBe('1fr');
      expect(r.gridTemplateRows).toBe('1fr');
      expect(r.cells).toEqual([{ panel: p, gridColumn: '1', gridRow: '1' }]);
      expect(r.splitters).toEqual([]);
    }
  });
});

describe('quadLayout: input order', () => {
  it('normalizes visible panels to canonical order', () => {
    const r = quadLayout(['side', 'front', 'persp', 'top'], HALF);
    expect(r.cells.map((c) => c.panel)).toEqual(['top', 'persp', 'front', 'side']);
  });
});
