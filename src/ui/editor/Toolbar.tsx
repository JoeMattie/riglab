import { useEditorStore, type Tool } from '../../state/editorStore';

const TOOLS: Array<{ id: Tool; label: string; title: string }> = [
  { id: 'select', label: 'Select / drag', title: 'drag nodes to pose; double-click toggles anchor' },
  { id: 'pipe', label: 'Pipe', title: 'click-drag a straight pipe' },
  { id: 'polyline', label: 'Polyline pipe', title: 'click vertices, double-click to finish (bent pipe)' },
  { id: 'freehand', label: 'Freehand pipe', title: 'draw a curve, it becomes a bent pipe' },
  { id: 'rope', label: 'Rope', title: 'click points to route a tension cord; double-click to finish. Points on a pipe become eyelets' },
  { id: 'elastic', label: 'Elastic', title: 'click-drag a spring between two points' },
  { id: 'bowden', label: 'Bowden', title: 'drag the first segment, then the second — a displacement coupling' },
  { id: 'torsionCable', label: 'Torsion', title: 'click one pivot, then another — an angle coupling' },
  { id: 'bind', label: 'Bind', title: 'click a node, then a silhouette point' },
];

export function Toolbar() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const tracing = useEditorStore((s) => s.tracing);
  const setTracing = useEditorStore((s) => s.setTracing);

  return (
    <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderBottom: '1px solid #ddd', alignItems: 'center' }}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          data-testid={`tool-${t.id}`}
          title={t.title}
          onClick={() => setTool(t.id)}
          style={{ fontWeight: tool === t.id ? 700 : 400 }}
        >
          {t.label}
        </button>
      ))}
      <span style={{ width: 16 }} />
      <label style={{ fontSize: 13 }}>
        <input type="checkbox" checked={tracing} onChange={(e) => setTracing(e.target.checked)} /> trace
        motion path
      </label>
    </div>
  );
}
