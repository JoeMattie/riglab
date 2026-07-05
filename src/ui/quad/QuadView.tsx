// Quad workspace (PLANFILE-3d-conversion.md): the app's only workspace — a
// Rhino-style 2×2 grid of Top / Perspective / Front / Side. Every ortho panel
// hosts the FULL SketchCanvas editing experience over the whole compound
// mechanism projected into its plane, drawing at that panel's active
// work-plane depth (editable in the header chip; snapping to existing
// geometry adopts its depth). The perspective panel is the 3D preview with
// selection, node dragging and the pipe-model toggle. Double-click a panel
// header to maximize/restore; a maximized ortho panel is the old focused-2D
// feel. Selection and tools are global across panels.
//
// PLANFILE-quad-panel-controls: the grid is resizable via a shared vertical +
// horizontal splitter pair (drag; double-click resets 50/50; a center handle
// drags both), and panels can be hidden from the top-bar toggle chip — the
// pure reflow/layout math lives in quadLayout.ts.
import { type RefObject, useRef, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { type OrthoPanelId, type QuadPanelId, useEditorStore } from '../../state/editorStore';
import { PerspectiveView } from '../assembly/PerspectiveView';
import { SketchCanvas } from '../editor/SketchCanvas';
import { T } from '../editor/theme';
import { lengthFromDisplay, lengthToDisplay, lengthUnit } from '../units';
import { PANEL_ORDER, type QuadSplit, quadLayout, type SplitterCell } from './quadLayout';

const ORTHO: ReadonlySet<QuadPanelId> = new Set(['top', 'front', 'side']);

export const PANEL_TITLES: Record<QuadPanelId, string> = {
  top: 'Top',
  persp: 'Perspective',
  front: 'Front',
  side: 'Side',
};

/** Panel-header work-plane depth chip: shows the depth (project units) new
 * geometry lands at along this panel's normal; type to move the work plane. */
function DepthChip({ panelId }: { panelId: OrthoPanelId }) {
  const units = useAppStore((s) => s.current?.unitsPreference ?? 'imperial');
  const depthM = useEditorStore((s) => s.panelDepths[panelId]);
  const setPanelDepth = useEditorStore((s) => s.setPanelDepth);
  const [draft, setDraft] = useState<string | null>(null);

  const shown =
    draft ?? String(Number(lengthToDisplay(depthM, units).toFixed(units === 'imperial' ? 2 : 3)));

  const commit = () => {
    if (draft === null) return;
    const v = Number.parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(v)) setPanelDepth(panelId, lengthFromDisplay(v, units));
  };

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}
      title="active work-plane depth along this panel's normal — new geometry lands here; snapping to existing geometry adopts its depth"
    >
      <span style={{ fontSize: 9.5, color: T.faint, textTransform: 'none', letterSpacing: 0 }}>
        depth
      </span>
      <input
        data-testid={`depth-chip-${panelId}`}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
        onBlur={commit}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          width: 44,
          border: `1px solid ${T.hairline}`,
          borderRadius: 5,
          padding: '1px 4px',
          font: `500 10.5px ${T.mono}`,
          color: T.text,
          background: T.raised,
          textTransform: 'none',
          letterSpacing: 0,
        }}
      />
      <span style={{ fontSize: 9.5, color: T.faint, textTransform: 'none', letterSpacing: 0 }}>
        {lengthUnit(units)}
      </span>
    </span>
  );
}

/** One splitter bar/handle. Dragging maps the pointer position within the
 * quad container to the splitter's axis fraction(s); double-click resets its
 * axis/axes to 50/50. The visible line is 2px inside a 6px hit track. */
function Splitter({
  sp,
  containerRef,
}: {
  sp: SplitterCell;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const setQuadSplit = useEditorStore((s) => s.setQuadSplit);
  const resetQuadSplit = useEditorStore((s) => s.resetQuadSplit);
  const split = useEditorStore((s) => s.quadSplit);
  const [hot, setHot] = useState(false);

  const value = sp.axes.includes('x') ? split.x : split.y;

  const cursor = sp.id === 'v' ? 'col-resize' : sp.id === 'h' ? 'row-resize' : 'move';
  const line: React.CSSProperties =
    sp.id === 'v'
      ? { position: 'absolute', top: 0, bottom: 0, left: 2, width: 2 }
      : sp.id === 'h'
        ? { position: 'absolute', left: 0, right: 0, top: 2, height: 2 }
        : { position: 'absolute', inset: 1, borderRadius: 2 };

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> is a void element and cannot express a draggable (and here two-axis) window splitter; the focusable separator-widget pattern is the ARIA-sanctioned alternative
    <div
      role="separator"
      aria-orientation={sp.id === 'v' ? 'vertical' : sp.id === 'h' ? 'horizontal' : undefined}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-label={`resize panels (${sp.axes.join('+')})`}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        const patch: Partial<QuadSplit> = {};
        if (sp.axes.includes('x') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          patch.x = split.x + (e.key === 'ArrowLeft' ? -step : step);
        }
        if (sp.axes.includes('y') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          patch.y = split.y + (e.key === 'ArrowUp' ? -step : step);
        }
        if (Object.keys(patch).length) {
          e.preventDefault();
          setQuadSplit(patch);
        }
      }}
      data-testid={`quad-splitter-${sp.id}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setHot(true);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || rect.width < 1 || rect.height < 1) return;
        const patch: Partial<QuadSplit> = {};
        if (sp.axes.includes('x')) patch.x = (e.clientX - rect.left) / rect.width;
        if (sp.axes.includes('y')) patch.y = (e.clientY - rect.top) / rect.height;
        setQuadSplit(patch);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setHot(false);
      }}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) setHot(false);
      }}
      onDoubleClick={() => resetQuadSplit(sp.axes)}
      title="drag to resize — double-click for 50/50"
      style={{
        gridColumn: sp.gridColumn,
        gridRow: sp.gridRow,
        position: 'relative',
        cursor,
        touchAction: 'none',
        zIndex: sp.id === 'c' ? 2 : 1,
      }}
    >
      <div style={{ ...line, background: hot ? T.accent : T.border }} />
    </div>
  );
}

export function QuadView() {
  const current = useAppStore((s) => s.current);
  const quadMaximized = useEditorStore((s) => s.quadMaximized);
  const setQuadMaximized = useEditorStore((s) => s.setQuadMaximized);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setActivePanel = useEditorStore((s) => s.setActivePanel);
  const quadSplit = useEditorStore((s) => s.quadSplit);
  const panelsVisible = useEditorStore((s) => s.panelsVisible);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!current) return null;

  const visible: QuadPanelId[] = quadMaximized
    ? [quadMaximized]
    : PANEL_ORDER.filter((p) => panelsVisible[p]);
  const layout = quadLayout(visible, quadSplit);

  const body = (id: QuadPanelId) =>
    id === 'persp' ? <PerspectiveView /> : <SketchCanvas panelId={id} />;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        background: T.bg,
        gridTemplateColumns: layout.gridTemplateColumns,
        gridTemplateRows: layout.gridTemplateRows,
      }}
    >
      {layout.cells.map((cell) => (
        <div
          key={cell.panel}
          data-testid={`quad-panel-${cell.panel}`}
          onPointerDown={() => setActivePanel(cell.panel)}
          style={{
            gridColumn: cell.gridColumn,
            gridRow: cell.gridRow,
            position: 'relative',
            overflow: 'hidden',
            background: T.bg,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 10px',
              borderBottom: `1px solid ${T.hairline}`,
              flex: 'none',
            }}
          >
            <button
              type="button"
              onDoubleClick={() =>
                setQuadMaximized(quadMaximized === cell.panel ? null : cell.panel)
              }
              title="double-click to maximize / restore"
              style={{
                padding: '3px 0',
                font: `500 10.5px ${T.sans}`,
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                color: activePanel === cell.panel ? T.text : T.muted,
                border: 'none',
                background: 'none',
                textAlign: 'left',
                userSelect: 'none',
                cursor: 'default',
                flex: 1,
              }}
            >
              {PANEL_TITLES[cell.panel]}
            </button>
            {ORTHO.has(cell.panel) && <DepthChip panelId={cell.panel as OrthoPanelId} />}
          </div>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
            {body(cell.panel)}
          </div>
        </div>
      ))}
      {layout.splitters.map((sp) => (
        <Splitter key={sp.id} sp={sp} containerRef={containerRef} />
      ))}
    </div>
  );
}
