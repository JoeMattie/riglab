import { useEffect, useRef, useState } from 'react';
import { EXAMPLES } from '../examples';
import { useAppStore } from '../state/appStore';
import { PANEL_SHADOW, T } from './editor/theme';

export function ProjectList() {
  const projects = useAppStore((s) => s.projects);
  const createProject = useAppStore((s) => s.createProject);
  const createFromExample = useAppStore((s) => s.createFromExample);
  const openProject = useAppStore((s) => s.openProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const renameProject = useAppStore((s) => s.renameProject);
  const importProject = useAppStore((s) => s.importProject);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const examplesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!examplesOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!examplesRef.current?.contains(e.target as Node)) setExamplesOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExamplesOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [examplesOpen]);

  const onCreate = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    void createProject(name);
  };

  const onImportFile = async (file: File) => {
    setError(null);
    try {
      await importProject(await file.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const primaryBtn: React.CSSProperties = {
    border: 'none',
    background: T.accent,
    color: '#fff',
    borderRadius: 9,
    padding: '9px 16px',
    font: `600 13.5px ${T.sans}`,
    cursor: 'pointer',
  };
  const ghostBtn: React.CSSProperties = {
    border: `1px solid ${T.border}`,
    background: T.panel,
    color: T.text,
    borderRadius: 9,
    padding: '9px 14px',
    font: `500 13px ${T.sans}`,
    cursor: 'pointer',
  };
  const smallBtn: React.CSSProperties = {
    border: `1px solid ${T.border}`,
    background: T.panel,
    color: T.text,
    borderRadius: 7,
    padding: '4px 10px',
    font: `500 12px ${T.sans}`,
    cursor: 'pointer',
  };
  const caption: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: T.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    margin: '0 0 10px',
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        background: T.bg,
        fontFamily: T.sans,
        color: T.text,
        padding: '56px 24px',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, margin: '0 0 4px' }}>PVC Rig Lab</h1>
        <p style={{ color: T.muted, margin: '0 0 28px', fontSize: 14 }}>
          Sketch wearable PVC mechanisms, play them against a movement clip, and get a build sheet.
        </p>

        <div
          style={{
            background: T.panel,
            border: `1px solid ${T.border}`,
            borderRadius: 14,
            boxShadow: PANEL_SHADOW,
            padding: 18,
            marginBottom: 28,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              data-testid="new-project-name"
              placeholder="Name a new project…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onCreate()}
              style={{
                flex: 1,
                border: `1px solid ${T.border}`,
                borderRadius: 9,
                padding: '9px 12px',
                font: `14px ${T.sans}`,
                color: T.text,
              }}
            />
            <button
              type="button"
              data-testid="create-project"
              onClick={onCreate}
              disabled={!newName.trim()}
              style={{ ...primaryBtn, opacity: newName.trim() ? 1 : 0.5 }}
            >
              Create
            </button>
            <button
              type="button"
              data-testid="import-project"
              onClick={() => fileRef.current?.click()}
              style={ghostBtn}
            >
              Import…
            </button>
            {/* flex wrapper so the button stretches to the row height like its siblings */}
            <div ref={examplesRef} style={{ position: 'relative', display: 'flex' }}>
              <button
                type="button"
                data-testid="examples-menu-button"
                aria-haspopup="menu"
                aria-expanded={examplesOpen}
                onClick={() => setExamplesOpen((o) => !o)}
                style={ghostBtn}
              >
                New from example{' '}
                <span aria-hidden="true" style={{ fontSize: 10 }}>
                  ▾
                </span>
              </button>
              {examplesOpen && (
                <div
                  data-testid="examples-menu"
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    width: 380,
                    maxHeight: '60vh',
                    overflowY: 'auto',
                    margin: 0,
                    padding: 5,
                    background: T.panel,
                    border: `1px solid ${T.border}`,
                    borderRadius: 12,
                    boxShadow: PANEL_SHADOW,
                    zIndex: 30,
                  }}
                >
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.id}
                      type="button"
                      role="menuitem"
                      data-testid={`example-${ex.id}`}
                      onClick={() => {
                        setExamplesOpen(false);
                        void createFromExample(ex.id);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '9px 11px',
                        border: 'none',
                        borderRadius: 8,
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <strong style={{ fontSize: 13.5, color: T.text }}>{ex.name}</strong>
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 3, lineHeight: 1.45 }}>
                        {ex.description}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f);
                e.target.value = '';
              }}
            />
          </div>
          {error && (
            <p data-testid="import-error" style={{ color: T.dangerText, margin: '10px 0 0' }}>
              import failed: {error}
            </p>
          )}
        </div>

        <section>
          <h2 style={caption}>Your projects</h2>
          {projects.length === 0 && (
            <p style={{ color: T.muted, fontSize: 13.5 }}>
              No projects yet — create one above or pick “New from example”.
            </p>
          )}
          <ul data-testid="project-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {projects.map((p) => (
              <li
                key={p.id}
                data-testid="project-row"
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  padding: '11px 4px',
                  borderBottom: `1px solid ${T.hairline}`,
                }}
              >
                <span data-testid="project-name" style={{ flex: 1, fontWeight: 500 }}>
                  {p.name}
                </span>
                <small style={{ color: T.faint }}>{new Date(p.updatedAt).toLocaleString()}</small>
                <button
                  type="button"
                  data-testid="open-project"
                  onClick={() => void openProject(p.id)}
                  style={{
                    ...smallBtn,
                    background: T.accentTint,
                    color: T.accentText,
                    border: 'none',
                  }}
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const name = window.prompt('Rename project', p.name);
                    if (name?.trim()) void renameProject(p.id, name.trim());
                  }}
                  style={smallBtn}
                >
                  Rename
                </button>
                <button
                  type="button"
                  data-testid="delete-project"
                  onClick={() => {
                    if (window.confirm(`Delete "${p.name}"?`)) void deleteProject(p.id);
                  }}
                  style={{ ...smallBtn, color: T.dangerText }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
