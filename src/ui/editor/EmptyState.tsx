// Onboarding empty-state (§5/§8.1): a fresh project has no mechanism yet, so
// there is nothing to draw on. This lands the user straight on a side-view
// silhouette with the pipe tool active — one click to start playing — and
// points to the bundled examples as the alternative path.
import { EXAMPLES } from '../../examples';
import { useAppStore } from '../../state/appStore';
import { addMechanism } from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { panelStyle, T } from './theme';

export function EmptyState() {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const createFromExample = useAppStore((s) => s.createFromExample);
  const setTool = useEditorStore((s) => s.setTool);
  const setActiveMechanism = useEditorStore((s) => s.setActiveMechanism);

  const startDrawing = () => {
    let newId = '';
    updateCurrent((d) => {
      const { doc, mechanismId } = addMechanism(d, 'side-left');
      newId = mechanismId;
      return doc;
    });
    setActiveMechanism(newId);
    setTool('pipe'); // land with the pencil ready (§8.1)
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
    >
      <div
        style={{
          ...panelStyle,
          padding: 28,
          width: 460,
          maxWidth: '90vw',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Draw your first pipe</h2>
          <p style={{ margin: '6px 0 0', color: T.muted, fontSize: 13.5, lineHeight: 1.5 }}>
            Start on a side-view silhouette with the pipe tool ready — click-drag to draw, snap ends
            together, and drag to pose. No forms, no setup.
          </p>
        </div>
        <button
          type="button"
          data-testid="empty-start-drawing"
          onClick={startDrawing}
          style={{
            border: 'none',
            background: T.accent,
            color: '#fff',
            borderRadius: 10,
            padding: '11px 16px',
            font: `600 14px ${T.sans}`,
            cursor: 'pointer',
          }}
        >
          Start drawing on a side view
        </button>

        <div style={{ borderTop: `1px solid ${T.hairline}`, paddingTop: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: T.muted,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              marginBottom: 8,
            }}
          >
            Or open an example
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {EXAMPLES.slice(0, 4).map((ex) => (
              <button
                type="button"
                key={ex.id}
                data-testid={`empty-example-${ex.id}`}
                onClick={() => void createFromExample(ex.id)}
                style={{
                  textAlign: 'left',
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  background: T.raised,
                  padding: '8px 10px',
                  cursor: 'pointer',
                  font: `500 12.5px ${T.sans}`,
                  color: T.text,
                }}
              >
                {ex.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
