// The floating tool pill (design handoff §2): labeled rows in captioned
// groups with single-key shortcuts, draggable by its grip handle (wireframe
// 1c's "drag to move" pill). Replaces Toolbar.tsx. Collapsible to an
// icons-only rail via the header chevron; the collapsed flag is a workspace
// pref (prefs.ts), unlike the transient drag offset.
import { useEffect, useState } from 'react';
import { getToolPillCollapsedPref, setToolPillCollapsedPref } from '../../persistence/prefs';
import { type Tool, useEditorStore } from '../../state/editorStore';
import { ToolIcon, type ToolIconName } from './icons';
import { GripHandle, usePillDrag } from './pillDrag';
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
  const drag = usePillDrag();
  const { offset } = drag;
  // collapsed-to-icons is a workspace pref (like night mode) and survives reloads
  const [collapsed, setCollapsed] = useState(getToolPillCollapsedPref);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      setToolPillCollapsedPref(!c);
      return !c;
    });
  };

  // single-key shortcuts (V P L F R E B T N); Esc returns to Select.
  // Skipped while typing and for modifier chords (⌘Z etc., and Shift chords —
  // Shift+G/E/P drive the snap toggles).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
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
        width: collapsed ? 56 : 158,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        zIndex: 40,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* grid wrapper keeps the grip's hit area at full remaining width */}
        <div style={{ flex: 1, display: 'grid' }}>
          <GripHandle testid="tool-pill-handle" drag={drag} />
        </div>
        <button
          type="button"
          data-testid="tool-pill-collapse"
          title={collapsed ? 'expand tool labels' : 'collapse to icons'}
          aria-label={collapsed ? 'expand tool labels' : 'collapse to icons'}
          onClick={toggleCollapsed}
          style={{
            border: 'none',
            background: 'transparent',
            color: T.ghost,
            cursor: 'pointer',
            padding: '0 1px 2px',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
            <path
              d={collapsed ? 'M5.2 3.5 L8.8 7 L5.2 10.5' : 'M8.8 3.5 L5.2 7 L8.8 10.5'}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {GROUPS.map((g) => (
        <div key={g.caption ?? 'main'} style={{ display: 'contents' }}>
          {g.caption &&
            (collapsed ? (
              <div style={{ height: 1, background: T.hairline, margin: '4px 5px' }} />
            ) : (
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
            ))}
          {g.items.map((t) => {
            const active = tool === t.id;
            return (
              <button
                type="button"
                key={t.id}
                data-testid={`tool-${t.id}`}
                title={collapsed ? `${t.label} (${t.kbd}) — ${t.title}` : t.title}
                onClick={() => setTool(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: collapsed ? 'center' : undefined,
                  gap: 9,
                  border: 'none',
                  background: active ? T.accentTint : 'transparent',
                  color: active ? T.accentText : T.text,
                  borderRadius: 8,
                  padding: collapsed ? '6px 0' : '6px 8px',
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
                {!collapsed && t.label}
                {!collapsed && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      font: `500 10.5px ${T.mono}`,
                      color: active ? T.focus : T.ghost,
                    }}
                  >
                    {t.kbd}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
