import { useRef, useState } from 'react';
import { useAppStore } from '../state/appStore';

export function ProjectList() {
  const projects = useAppStore((s) => s.projects);
  const createProject = useAppStore((s) => s.createProject);
  const openProject = useAppStore((s) => s.openProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const renameProject = useAppStore((s) => s.renameProject);
  const importProject = useAppStore((s) => s.importProject);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>PVC Rig Lab</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          data-testid="new-project-name"
          placeholder="new project name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onCreate()}
        />
        <button
          type="button"
          data-testid="create-project"
          onClick={onCreate}
          disabled={!newName.trim()}
        >
          Create
        </button>
        <button type="button" data-testid="import-project" onClick={() => fileRef.current?.click()}>
          Import…
        </button>
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
        <p data-testid="import-error" style={{ color: '#b00' }}>
          import failed: {error}
        </p>
      )}
      <ul data-testid="project-list" style={{ listStyle: 'none', padding: 0 }}>
        {projects.map((p) => (
          <li
            key={p.id}
            data-testid="project-row"
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              padding: '6px 0',
              borderBottom: '1px solid #ddd',
            }}
          >
            <span data-testid="project-name" style={{ flex: 1 }}>
              {p.name}
            </span>
            <small>{new Date(p.updatedAt).toLocaleString()}</small>
            <button type="button" data-testid="open-project" onClick={() => void openProject(p.id)}>
              Open
            </button>
            <button
              type="button"
              onClick={() => {
                const name = window.prompt('Rename project', p.name);
                if (name?.trim()) void renameProject(p.id, name.trim());
              }}
            >
              Rename
            </button>
            <button
              type="button"
              data-testid="delete-project"
              onClick={() => {
                if (window.confirm(`Delete "${p.name}"?`)) void deleteProject(p.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {projects.length === 0 && <p>No projects yet — create one above.</p>}
    </main>
  );
}
