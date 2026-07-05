// Project chip (design handoff §3, v7): back · project name · saved
// indicator. The v6 mechanism switcher is gone — one compound mechanism per
// project (PLANFILE-3d-conversion.md).
import { useAppStore } from '../../state/appStore';
import { dividerStyle, EDGE, panelStyle, T } from './theme';

export function ProjectChip() {
  const doc = useAppStore((s) => s.current);
  const saveState = useAppStore((s) => s.saveState);
  const closeProject = useAppStore((s) => s.closeProject);
  const updateCurrent = useAppStore((s) => s.updateCurrent);

  if (!doc) return null;

  const saved = saveState === 'saved';

  return (
    <div style={{ position: 'absolute', left: EDGE, top: EDGE, zIndex: 40 }}>
      <div
        style={{
          ...panelStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
        }}
      >
        <button
          type="button"
          data-testid="back-to-projects"
          title="back to projects"
          onClick={() => void closeProject()}
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: 15,
            color: T.muted,
            padding: '0 2px',
          }}
        >
          ←
        </button>
        <span style={dividerStyle} />
        <input
          data-testid="project-name-input"
          value={doc.name}
          onChange={(e) => updateCurrent((d) => ({ ...d, name: e.target.value }))}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            font: `600 13.5px ${T.sans}`,
            color: T.text,
            width: Math.max(60, Math.min(220, doc.name.length * 8 + 16)),
            padding: 0,
          }}
        />
        <span
          data-testid="save-state"
          title={saved ? 'saved' : 'saving…'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            color: saved ? T.success : T.faint,
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: saved ? T.success : T.faint,
              display: 'inline-block',
            }}
          />
          {saved ? 'saved' : 'saving…'}
        </span>
      </div>
    </div>
  );
}
