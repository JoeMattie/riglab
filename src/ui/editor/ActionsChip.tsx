// Actions chip (design handoff §4, v7): undo/redo · copy/paste ·
// Sketch/Design segmented control · units · Export. The 2D/3D/Quad mode
// toggle is gone — the quad workspace IS the app (PLANFILE-3d-conversion.md
// decision 3). Docked in the top bar (right slot), not floating.
import { ClipboardPasteIcon, CopyIcon } from 'lucide-react';
import { exportProjectJson, suggestedFileName } from '../../persistence/exportImport';
import { setUnitsPref } from '../../persistence/prefs';
import type { UnitsPreference } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { type Face, useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { copySelection, pasteClipboard } from './clipboardActions';
import { ThemeIcon } from './icons';
import { dividerStyle, T } from './theme';

export function ActionsChip() {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const face = useEditorStore((s) => s.face);
  const setFace = useEditorStore((s) => s.setFace);
  const hasSelection = useEditorStore((s) => s.selectedElementIds.length > 0);
  const hasClipboard = useEditorStore((s) => s.clipboard !== null);
  const night = useThemeStore((s) => s.night);
  const toggleNight = useThemeStore((s) => s.toggleNight);

  if (!doc) return null;

  const onExport = () => {
    const blob = new Blob([exportProjectJson(doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedFileName(doc);
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleUnits = () => {
    const units: UnitsPreference = doc.unitsPreference === 'imperial' ? 'metric' : 'imperial';
    updateCurrent((d) => ({ ...d, unitsPreference: units }));
    setUnitsPref(units);
  };

  const segStyle = (active: boolean): React.CSSProperties => ({
    border: 'none',
    background: active ? T.raised : 'none',
    borderRadius: 6,
    padding: '3px 12px',
    font: `${active ? 500 : 400} 12.5px ${T.sans}`,
    color: active ? T.text : T.muted,
    cursor: 'pointer',
    boxShadow: active ? '0 1px 3px rgba(20,24,40,.12)' : 'none',
  });

  const segment = (value: Face, label: string) => (
    <button
      type="button"
      data-testid={`face-${value}`}
      aria-pressed={face === value}
      onClick={() => setFace(value)}
      style={segStyle(face === value)}
    >
      {label}
    </button>
  );

  const iconButton: React.CSSProperties = {
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: T.icon,
    padding: '0 2px',
  };

  return (
    <div
      data-testid="actions-chip"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <button type="button" data-testid="undo" title="undo ⌘Z" onClick={undo} style={iconButton}>
        ↶
      </button>
      <button type="button" data-testid="redo" title="redo ⇧⌘Z" onClick={redo} style={iconButton}>
        ↷
      </button>
      <span style={dividerStyle} />
      <button
        type="button"
        data-testid="copy-selection"
        title="copy selection ⌘C"
        disabled={!hasSelection}
        onClick={() => copySelection()}
        style={{ ...iconButton, opacity: hasSelection ? 1 : 0.4, display: 'grid' }}
      >
        <CopyIcon size={14} />
      </button>
      <button
        type="button"
        data-testid="paste-clipboard"
        title="paste ⌘V"
        disabled={!hasClipboard}
        onClick={() => pasteClipboard()}
        style={{ ...iconButton, opacity: hasClipboard ? 1 : 0.4, display: 'grid' }}
      >
        <ClipboardPasteIcon size={14} />
      </button>
      <span style={dividerStyle} />
      <span
        data-testid="face-toggle"
        style={{ display: 'inline-flex', background: T.chip, borderRadius: 8, padding: 2 }}
      >
        {segment('sketch', 'Sketch')}
        {segment('design', 'Design')}
      </span>
      <span style={dividerStyle} />
      <button
        type="button"
        data-testid="units-toggle"
        title={
          doc.unitsPreference === 'imperial'
            ? 'units: inches / pounds — click for metric'
            : 'units: metres / kilograms — click for imperial'
        }
        onClick={toggleUnits}
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          font: `500 12px ${T.mono}`,
          color: T.muted,
          padding: 0,
        }}
      >
        {doc.unitsPreference === 'imperial' ? 'in/lb' : 'm/kg'}
      </button>
      <button
        type="button"
        data-testid="night-toggle"
        title={night ? 'switch to day view' : 'switch to night view'}
        aria-pressed={night}
        onClick={toggleNight}
        style={{ ...iconButton, display: 'grid', placeItems: 'center' }}
      >
        <ThemeIcon night={night} />
      </button>
      <button
        type="button"
        data-testid="export-project"
        onClick={onExport}
        style={{
          border: `1px solid ${T.border}`,
          background: T.raised,
          borderRadius: 8,
          padding: '3px 12px',
          font: `500 12.5px ${T.sans}`,
          cursor: 'pointer',
          color: T.text,
        }}
      >
        Export
      </button>
    </div>
  );
}
