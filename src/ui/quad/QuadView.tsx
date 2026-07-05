// Quad workspace (PLANFILE-3d-conversion.md): the app's only workspace — a
// Rhino-style 2×2 grid of Top / Perspective / Front / Side. Every ortho panel
// hosts the FULL SketchCanvas editing experience over the whole compound
// mechanism projected into its plane, drawing at that panel's active
// work-plane depth (editable in the header chip; snapping to existing
// geometry adopts its depth). The perspective panel is the 3D preview with
// selection, node dragging and the pipe-model toggle. Double-click a panel
// header to maximize/restore; a maximized ortho panel is the old focused-2D
// feel. Selection and tools are global across panels.
import { useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { type OrthoPanelId, type QuadPanelId, useEditorStore } from '../../state/editorStore';
import { PerspectiveView } from '../assembly/PerspectiveView';
import { SketchCanvas } from '../editor/SketchCanvas';
import { T } from '../editor/theme';
import { lengthFromDisplay, lengthToDisplay, lengthUnit } from '../units';

const ORTHO: ReadonlySet<QuadPanelId> = new Set(['top', 'front', 'side']);

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

export function QuadView() {
  const current = useAppStore((s) => s.current);
  const quadMaximized = useEditorStore((s) => s.quadMaximized);
  const setQuadMaximized = useEditorStore((s) => s.setQuadMaximized);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setActivePanel = useEditorStore((s) => s.setActivePanel);

  if (!current) return null;

  const panels: { id: QuadPanelId; title: string; body: React.ReactNode }[] = [
    { id: 'top', title: 'Top', body: <SketchCanvas panelId="top" /> },
    { id: 'persp', title: 'Perspective', body: <PerspectiveView /> },
    { id: 'front', title: 'Front', body: <SketchCanvas panelId="front" /> },
    { id: 'side', title: 'Side', body: <SketchCanvas panelId="side" /> },
  ];
  const visible = quadMaximized ? panels.filter((p) => p.id === quadMaximized) : panels;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gap: 2,
        background: T.border,
        gridTemplateColumns: quadMaximized ? '1fr' : '1fr 1fr',
        gridTemplateRows: quadMaximized ? '1fr' : '1fr 1fr',
      }}
    >
      {visible.map((p) => (
        <div
          key={p.id}
          data-testid={`quad-panel-${p.id}`}
          onPointerDown={() => setActivePanel(p.id)}
          style={{
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
              onDoubleClick={() => setQuadMaximized(quadMaximized === p.id ? null : p.id)}
              title="double-click to maximize / restore"
              style={{
                padding: '3px 0',
                font: `500 10.5px ${T.sans}`,
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                color: activePanel === p.id ? T.text : T.muted,
                border: 'none',
                background: 'none',
                textAlign: 'left',
                userSelect: 'none',
                cursor: 'default',
                flex: 1,
              }}
            >
              {p.title}
            </button>
            {ORTHO.has(p.id) && <DepthChip panelId={p.id as OrthoPanelId} />}
          </div>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
            {p.body}
          </div>
        </div>
      ))}
    </div>
  );
}
