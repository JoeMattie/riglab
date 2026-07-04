import { exportProjectJson, suggestedFileName } from '../persistence/exportImport';
import { useAppStore } from '../state/appStore';

/** Phase 0 editor placeholder: top bar with name (autosaved on edit), save
 * indicator, export. The sketch canvas arrives in Phase 1. */
export function EditorShell() {
  const current = useAppStore((s) => s.current);
  const saveState = useAppStore((s) => s.saveState);
  const closeProject = useAppStore((s) => s.closeProject);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  if (!current) return null;

  const onExport = () => {
    const blob = new Blob([exportProjectJson(current)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedFileName(current);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <header
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid #ccc',
        }}
      >
        <button data-testid="back-to-projects" onClick={() => void closeProject()}>
          ← Projects
        </button>
        <input
          data-testid="project-name-input"
          value={current.name}
          onChange={(e) => updateCurrent((doc) => ({ ...doc, name: e.target.value }))}
          style={{ fontSize: 16, fontWeight: 600 }}
        />
        <span data-testid="save-state" style={{ color: saveState === 'saved' ? '#282' : '#a60' }}>
          {saveState === 'saved' ? 'saved' : 'saving…'}
        </span>
        <span style={{ flex: 1 }} />
        <button data-testid="export-project" onClick={onExport}>
          Export JSON
        </button>
      </header>
      <main style={{ padding: 24, color: '#666' }}>
        <p>Sketch editor arrives in Phase 1.</p>
        <p>
          {current.mechanisms.length} mechanism(s) · units: {current.unitsPreference}
        </p>
      </main>
    </div>
  );
}
