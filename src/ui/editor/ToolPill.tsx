// The floating tool pill (design handoff §2): labeled rows in captioned
// groups with single-key shortcuts, draggable by its grip handle (wireframe
// 1c's "drag to move" pill). Replaces Toolbar.tsx.
import { useEffect, useRef, useState } from 'react';
import { type Tool, useEditorStore } from '../../state/editorStore';
import { ToolIcon, type ToolIconName } from './icons';
import { captionStyle, EDGE, panelStyle, T } from './theme';

interface ToolDef {
  id: Tool;
  label: string;
  kbd: string;
  title: string;
}

const GROUPS: Array<{ caption: string | null; items: ToolDef[] }> = [
  {
    caption: null,
    items: [
      {
        id: 'select',
        label: 'Select / pose',
        kbd: 'V',
        title: 'drag nodes to pose; click elements to inspect',
      },
    ],
  },
  {
    caption: 'Draw',
    items: [
      { id: 'pipe', label: 'Pipe', kbd: 'P', title: 'click-drag a straight pipe' },
      {
        id: 'polyline',
        label: 'Polyline',
        kbd: 'L',
        title: 'click vertices, double-click to finish',
      },
      { id: 'freehand', label: 'Freehand', kbd: 'F', title: 'draw a curve — becomes a bent pipe' },
    ],
  },
  {
    caption: 'Forces',
    items: [
      { id: 'rope', label: 'Rope', kbd: 'R', title: 'route a tension cord through eyelets' },
      { id: 'elastic', label: 'Elastic', kbd: 'E', title: 'drag a spring between two points' },
      { id: 'bowden', label: 'Bowden', kbd: 'B', title: 'two segments — displacement coupling' },
      { id: 'torsionCable', label: 'Torsion', kbd: 'T', title: 'couple two pivots by angle' },
    ],
  },
  {
    caption: 'Wearer',
    items: [{ id: 'bind', label: 'Bind', kbd: 'N', title: 'attach a node to the silhouette' }],
  },
];

const BY_KEY = new Map<string, Tool>(
  GROUPS.flatMap((g) => g.items.map((t) => [t.kbd.toLowerCase(), t.id])),
);

export function ToolPill() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  // drag-to-move offset from the default dock (transient, like the card's)
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; base: { x: number; y: number } } | null>(
    null,
  );

  // single-key shortcuts (V P L F R E B T N); Esc returns to Select.
  // Skipped while typing and for modifier chords (⌘Z etc.).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      if (e.key === 'Escape') {
        useEditorStore.getState().setTool('select');
        return;
      }
      const next = BY_KEY.get(e.key.toLowerCase());
      if (next) {
        e.preventDefault();
        useEditorStore.getState().setTool(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      data-testid="tool-pill"
      style={{
        ...panelStyle,
        position: 'absolute',
        left: Math.max(0, EDGE + offset.x),
        // docked bottom-left, above the transport strip (~40px pill + EDGE)
        bottom: Math.max(0, EDGE + 56 - offset.y),
        width: 158,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        zIndex: 40,
      }}
    >
      <div
        data-testid="tool-pill-handle"
        title="drag to move"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          dragRef.current = { startX: e.clientX, startY: e.clientY, base: offset };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          setOffset({ x: d.base.x + e.clientX - d.startX, y: d.base.y + e.clientY - d.startY });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        style={{
          display: 'grid',
          placeItems: 'center',
          padding: '1px 0 3px',
          cursor: 'grab',
          color: T.ghost,
          touchAction: 'none',
        }}
      >
        <svg width={20} height={5} viewBox="0 0 20 5" aria-hidden="true">
          {[1, 7, 13, 19].map((x) => (
            <circle key={x} cx={x} cy={1.5} r={1.2} fill="currentColor" />
          ))}
          {[4, 10, 16].map((x) => (
            <circle key={x} cx={x} cy={4} r={1.2} fill="currentColor" />
          ))}
        </svg>
      </div>
      {GROUPS.map((g) => (
        <div key={g.caption ?? 'main'} style={{ display: 'contents' }}>
          {g.caption && (
            <div
              style={{
                ...captionStyle,
                font: `500 10px ${T.sans}`,
                letterSpacing: '.09em',
                padding: '8px 8px 3px',
              }}
            >
              {g.caption}
            </div>
          )}
          {g.items.map((t) => {
            const active = tool === t.id;
            return (
              <button
                type="button"
                key={t.id}
                data-testid={`tool-${t.id}`}
                title={t.title}
                onClick={() => setTool(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  border: 'none',
                  background: active ? T.accentTint : 'transparent',
                  color: active ? T.accentText : T.text,
                  borderRadius: 8,
                  padding: '6px 8px',
                  font: `${active ? 500 : 400} 13px ${T.sans}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 18,
                    color: active ? T.accentText : T.icon,
                  }}
                >
                  <ToolIcon name={t.id as ToolIconName} />
                </span>
                {t.label}
                <span
                  style={{
                    marginLeft: 'auto',
                    font: `500 10.5px ${T.mono}`,
                    color: active ? T.focus : T.ghost,
                  }}
                >
                  {t.kbd}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
