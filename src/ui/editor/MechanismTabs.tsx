import { useState } from 'react';
import type { ViewOrientation } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { addMechanism } from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';

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
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: '6px 12px',
        borderBottom: '1px solid #ddd',
        alignItems: 'center',
      }}
    >
      {doc.mechanisms.map((m) => (
        <button
          type="button"
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
            <button type="button" key={v} data-testid={`view-${v}`} onClick={() => create(v)}>
              {v}
            </button>
          ))}
          <button type="button" onClick={() => setPicking(false)}>
            ×
          </button>
        </span>
      ) : (
        <button type="button" data-testid="add-mechanism" onClick={() => setPicking(true)}>
          + mechanism
        </button>
      )}
    </div>
  );
}
