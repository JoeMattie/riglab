import { useState } from 'react';
import { addMechanism } from '../../state/docOps';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import type { ViewOrientation } from '../../schema';

const VIEWS: ViewOrientation[] = ['side-left', 'side-right', 'front', 'back', 'top', 'free'];

export function MechanismTabs() {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const setActiveMechanism = useEditorStore((s) => s.setActiveMechanism);
  const [picking, setPicking] = useState(false);

  if (!doc) return null;

  const create = (view: ViewOrientation) => {
    setPicking(false);
    let newId = '';
    updateCurrent((cur) => {
      const { doc: next, mechanismId } = addMechanism(cur, view);
      newId = mechanismId;
      return next;
    });
    if (newId) setActiveMechanism(newId);
  };

  return (
    <div style={{ display: 'flex', gap: 4, padding: '6px 12px', borderBottom: '1px solid #ddd', alignItems: 'center' }}>
      {doc.mechanisms.map((m) => (
        <button
          key={m.id}
          data-testid="mechanism-tab"
          onClick={() => setActiveMechanism(m.id)}
          style={{ fontWeight: m.id === activeMechanismId ? 700 : 400 }}
        >
          {m.name} <small>({m.viewOrientation})</small>
        </button>
      ))}
      {picking ? (
        <span data-testid="view-picker">
          view:{' '}
          {VIEWS.map((v) => (
            <button key={v} data-testid={`view-${v}`} onClick={() => create(v)}>
              {v}
            </button>
          ))}
          <button onClick={() => setPicking(false)}>×</button>
        </span>
      ) : (
        <button data-testid="add-mechanism" onClick={() => setPicking(true)}>
          + mechanism
        </button>
      )}
    </div>
  );
}
