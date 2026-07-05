// Project chip (design handoff §3): back · project name · mechanism switcher
// · saved indicator, with the mechanism menu (incl. "+ New mechanism…" and
// its view picker). Replaces MechanismTabs.tsx and the old header strip.
import { useState } from 'react';
import type { ViewOrientation } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { addMechanism } from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import {
  captionStyle,
  dividerStyle,
  EDGE,
  menuStyle,
  miniButtonStyle,
  panelStyle,
  rowStyle,
  T,
} from './theme';

const VIEWS: ViewOrientation[] = ['side-left', 'side-right', 'front', 'back', 'top', 'free'];

export function ProjectChip() {
  const doc = useAppStore((s) => s.current);
  const saveState = useAppStore((s) => s.saveState);
  const closeProject = useAppStore((s) => s.closeProject);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const setActiveMechanism = useEditorStore((s) => s.setActiveMechanism);
  const openPopover = useEditorStore((s) => s.openPopover);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const [picking, setPicking] = useState(false);

  if (!doc) return null;
  const active = doc.mechanisms.find((m) => m.id === activeMechanismId) ?? null;
  const menuOpen = openPopover?.kind === 'mech';

  const create = (view: ViewOrientation) => {
    setPicking(false);
    setOpenPopover(null);
    let newId = '';
    updateCurrent((cur) => {
      const { doc: next, mechanismId } = addMechanism(cur, view);
      newId = mechanismId;
      return next;
    });
    if (newId) setActiveMechanism(newId);
  };

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
        <button
          type="button"
          data-testid="mechanism-menu-button"
          onClick={() => {
            setPicking(false);
            setOpenPopover(menuOpen ? null : { kind: 'mech' });
          }}
          style={miniButtonStyle}
        >
          {active ? (
            <>
              {active.name} <span style={{ color: T.faint }}>{active.viewOrientation}</span>
            </>
          ) : (
            'No mechanism'
          )}{' '}
          ▾
        </button>
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

      {menuOpen && (
        <div
          data-testid="mechanism-menu"
          style={{ ...menuStyle, position: 'absolute', left: 60, top: 44, width: 230, zIndex: 50 }}
        >
          {doc.mechanisms.map((m) => {
            const isActive = m.id === activeMechanismId;
            return (
              <button
                type="button"
                key={m.id}
                data-testid="mechanism-tab"
                onClick={() => {
                  setActiveMechanism(m.id);
                  setOpenPopover(null);
                }}
                style={rowStyle(isActive)}
              >
                {m.name}
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    color: isActive ? T.focus : T.faint,
                  }}
                >
                  {m.viewOrientation}
                </span>
              </button>
            );
          })}
          {doc.mechanisms.length > 0 && (
            <div style={{ borderTop: `1px solid ${T.hairline}`, margin: '5px 4px' }} />
          )}
          {picking ? (
            <div data-testid="view-picker" style={{ padding: '2px 4px 4px' }}>
              <div style={{ ...captionStyle, padding: '2px 6px 4px' }}>View</div>
              {VIEWS.map((v) => (
                <button
                  type="button"
                  key={v}
                  data-testid={`view-${v}`}
                  onClick={() => create(v)}
                  style={rowStyle(false)}
                >
                  {v}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              data-testid="add-mechanism"
              onClick={() => setPicking(true)}
              style={{ ...rowStyle(false), color: T.accent }}
            >
              + New mechanism…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
