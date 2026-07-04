import { useEditorStore } from '../../state/editorStore';

const LABELS: Record<string, string> = {
  pivot: 'Pivot',
  weld: 'Rigid weld',
  slider: 'Slider',
  detach: 'Keep separate',
};

/** The snap-connect menu (§8.1): appears where a drawn pipe end lands on
 * existing geometry; pivot is the first (default) choice. */
export function ConnectMenu() {
  const pending = useEditorStore((s) => s.pendingConnect);
  if (!pending) return null;
  return (
    <div
      data-testid="connect-menu"
      style={{
        position: 'absolute',
        left: pending.screen.x + 10,
        top: pending.screen.y - 10,
        background: '#fff',
        border: '1px solid #aaa',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
      }}
    >
      {pending.options.map((o, i) => (
        <button
          key={o}
          data-testid={`connect-${o}`}
          onClick={() => pending.choose(o)}
          style={{
            border: 'none',
            background: 'none',
            padding: '6px 14px',
            textAlign: 'left',
            fontWeight: i === 0 ? 700 : 400,
            cursor: 'pointer',
          }}
        >
          {LABELS[o]}
        </button>
      ))}
    </div>
  );
}
