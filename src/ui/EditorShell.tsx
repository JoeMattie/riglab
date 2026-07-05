import { useEffect } from 'react';
import { exportProjectJson, suggestedFileName } from '../persistence/exportImport';
import { setUnitsPref } from '../persistence/prefs';
import type { UnitsPreference } from '../schema';
import { useAppStore } from '../state/appStore';
import { type Face, useEditorStore } from '../state/editorStore';
import { Badge } from './components/badge';
import { Button } from './components/button';
import { ToggleGroup, ToggleGroupItem } from './components/toggle-group';
import { ConnectMenu } from './editor/ConnectMenu';
import { ForcesPanel } from './editor/ForcesPanel';
import { InfoPanel } from './editor/infopanel/InfoPanel';
import { MechanismTabs } from './editor/MechanismTabs';
import { SketchCanvas } from './editor/SketchCanvas';
import { Toolbar } from './editor/Toolbar';
import { TransportBar } from './editor/TransportBar';

export function EditorShell() {
  const current = useAppStore((s) => s.current);
  const saveState = useAppStore((s) => s.saveState);
  const closeProject = useAppStore((s) => s.closeProject);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const setActiveMechanism = useEditorStore((s) => s.setActiveMechanism);
  const face = useEditorStore((s) => s.face);
  const setFace = useEditorStore((s) => s.setFace);

  // keep an active mechanism selected whenever one exists
  useEffect(() => {
    if (!current) return;
    const exists = current.mechanisms.some((m) => m.id === activeMechanismId);
    if (!exists) setActiveMechanism(current.mechanisms[0]?.id ?? null);
  }, [current, activeMechanismId, setActiveMechanism]);

  // undo/redo keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // test/debug hook: lets Playwright assert on the live document. Merged (not
  // replaced) so seams published by children — e.g. SketchCanvas's getView —
  // survive this initializer regardless of effect ordering.
  useEffect(() => {
    const w = window as unknown as { __riglab?: Record<string, unknown> };
    if (!w.__riglab) w.__riglab = {};
    const hook = w.__riglab;
    hook.getDoc = () => useAppStore.getState().current;
    hook.getEditor = () => {
      const s = useEditorStore.getState();
      return {
        activeMechanismId: s.activeMechanismId,
        dof: s.dof,
        tool: s.tool,
        face: s.face,
        selectedElementIds: s.selectedElementIds,
      };
    };
    // seam for exercising the equilibrium force-overlay plumbing while the
    // solver's equilibrium mode lands in a parallel branch (§5.2)
    hook.setEquilibrium = (readout: unknown) =>
      useEditorStore.getState().setEquilibrium(readout as never);
  }, []);

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
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid #ccc',
        }}
      >
        <button type="button" data-testid="back-to-projects" onClick={() => void closeProject()}>
          ← Projects
        </button>
        <input
          data-testid="project-name-input"
          value={current.name}
          onChange={(e) => updateCurrent((doc) => ({ ...doc, name: e.target.value }))}
          style={{ fontSize: 16, fontWeight: 600 }}
        />
        <Badge data-testid="save-state" variant={saveState === 'saved' ? 'secondary' : 'outline'}>
          {saveState === 'saved' ? 'saved' : 'saving…'}
        </Badge>
        <button type="button" data-testid="undo" onClick={undo} title="Ctrl/Cmd+Z">
          ↶ undo
        </button>
        <button type="button" data-testid="redo" onClick={redo} title="Ctrl/Cmd+Shift+Z">
          ↷ redo
        </button>
        {/* Sketch/Design face toggle (§8): two lenses on one document —
            switching never destroys data */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={face}
          onValueChange={(v) => v && setFace(v as Face)}
          data-testid="face-toggle"
        >
          <ToggleGroupItem value="sketch" data-testid="face-sketch">
            Sketch
          </ToggleGroupItem>
          <ToggleGroupItem value="design" data-testid="face-design">
            Design
          </ToggleGroupItem>
        </ToggleGroup>
        <span style={{ flex: 1 }} />
        {/* units toggle (§8.3): stored on the project (display-only — all
            quantities stay SI internally), mirrored to the localStorage pref
            that seeds NEW projects */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={current.unitsPreference}
          onValueChange={(v) => {
            if (!v) return;
            const units = v as UnitsPreference;
            updateCurrent((doc) => ({ ...doc, unitsPreference: units }));
            setUnitsPref(units);
          }}
          data-testid="units-toggle"
        >
          <ToggleGroupItem value="imperial" data-testid="units-imperial">
            in/lb
          </ToggleGroupItem>
          <ToggleGroupItem value="metric" data-testid="units-metric">
            m/kg
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="export-project"
          onClick={onExport}
        >
          Export JSON
        </Button>
      </header>
      <MechanismTabs />
      <Toolbar />
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
        <SketchCanvas />
        <ConnectMenu />
        <InfoPanel />
      </div>
      <ForcesPanel />
      <TransportBar />
    </div>
  );
}
