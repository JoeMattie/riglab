// The editor shell (interface overhaul): a full-bleed canvas with floating
// chrome — project chip (top-left), actions chip (top-right), tool pill
// (left), transport pill (bottom-center), DOF pill (bottom-right). Element
// properties live on the canvas (dimension chips, joint popover, selection
// card, all rendered inside SketchCanvas); the design face additionally docks
// the tabbed inspector/checklist/materials/BOM panel as a floating column.
import { useEffect } from 'react';
import { EXAMPLES } from '../examples';
import { useAppStore } from '../state/appStore';
import { deleteElement, duplicateElement } from '../state/docOps';
import { useEditorStore } from '../state/editorStore';
import { AssemblyView } from './assembly/AssemblyView';
import { ControlsDock } from './controls/ControlsDock';
import { ActionsChip } from './editor/ActionsChip';
import { DofPill } from './editor/DofPill';
import { EmptyState } from './editor/EmptyState';
import { ProjectChip } from './editor/ProjectChip';
import { RightDock } from './editor/RightDock';
import { SketchCanvas } from './editor/SketchCanvas';
import { ToolPill } from './editor/ToolPill';
import { TransportPill } from './editor/TransportPill';
import { EDGE, panelStyle, T } from './editor/theme';

export function EditorShell() {
  const current = useAppStore((s) => s.current);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const setActiveMechanism = useEditorStore((s) => s.setActiveMechanism);
  const face = useEditorStore((s) => s.face);
  const mode = useEditorStore((s) => s.mode);
  const controlsOpen = useEditorStore((s) => s.controlsOpen);
  const setControlsOpen = useEditorStore((s) => s.setControlsOpen);

  // keep an active mechanism selected whenever one exists
  useEffect(() => {
    if (!current) return;
    const exists = current.mechanisms.some((m) => m.id === activeMechanismId);
    if (!exists) setActiveMechanism(current.mechanisms[0]?.id ?? null);
  }, [current, activeMechanismId, setActiveMechanism]);

  // keyboard shortcuts (§5): undo/redo, delete, duplicate, esc, space=play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const ed = useEditorStore.getState();

      if (mod && key === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (typing) return;

      // space toggles the transport
      if (key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        ed.setPlayback({ playing: !ed.playback.playing });
        return;
      }
      // escape clears selection / closes floating UI
      if (key === 'escape') {
        ed.setOpenPopover(null);
        ed.setPendingConnect(null);
        ed.clearSelection();
        return;
      }
      // delete / duplicate act on the 2D selection
      if (ed.mode !== '2d' || ed.selectedElementIds.length === 0) return;
      const mechId = ed.activeMechanismId;
      if (!mechId) return;
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        const ids = ed.selectedElementIds;
        useAppStore.getState().updateCurrent((d) => {
          let next = d;
          for (const id of ids) next = deleteElement(next, mechId, id);
          return next;
        });
        ed.clearSelection();
      } else if (mod && key === 'd') {
        e.preventDefault();
        const ids = ed.selectedElementIds;
        const newIds: string[] = [];
        useAppStore.getState().updateCurrent((d) => {
          let next = d;
          for (const id of ids) {
            const r = duplicateElement(next, mechId, id);
            next = r.doc;
            if (r.newElementId) newIds.push(r.newElementId);
          }
          return next;
        });
        if (newIds.length) useEditorStore.setState({ selectedElementIds: newIds });
      }
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
        mode: s.mode,
        face: s.face,
        selectedElementIds: s.selectedElementIds,
        rightTab: s.rightTab,
        openPopover: s.openPopover,
      };
    };
    // seam for exercising the equilibrium force-overlay plumbing while the
    // solver's equilibrium mode lands in a parallel branch (§5.2)
    hook.setEquilibrium = (readout: unknown) =>
      useEditorStore.getState().setEquilibrium(readout as never);
    // seam for scripted verification of a bundled example (the user-facing
    // "New from example" menu lands in the Phase 5 finishing slice); loads the
    // example as the live document without persisting it
    hook.loadExample = (id: string) => {
      const ex = EXAMPLES.find((e) => e.id === id);
      if (ex) useAppStore.setState({ current: ex.load(), saveState: 'saved' });
    };
  }, []);

  if (!current) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: T.bg,
        fontFamily: T.sans,
        fontSize: 13.5,
        color: T.text,
      }}
    >
      {/* full-bleed canvas; all chrome floats above it. 3D Assembly mode
          (§8.3) swaps the 2D sketch canvas for the orbit viewport; the clip
          transport stays mounted so playback drives both. */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        {mode === '3d' ? <AssemblyView /> : <SketchCanvas />}
      </div>

      {/* onboarding: a brand-new project has no mechanism to draw on yet */}
      {mode === '2d' && current.mechanisms.length === 0 && <EmptyState />}

      <ProjectChip />
      <ActionsChip />
      {mode === '2d' && current.mechanisms.length > 0 && <ToolPill />}
      <TransportPill />
      {mode === '2d' && <DofPill />}

      {/* controls dock (§4.4): a toggled bottom panel once a mechanism exists
          (controls map onto input channels); in 2D it clears the left tool pill */}
      {current.mechanisms.length === 0 ? null : controlsOpen ? (
        <ControlsDock left={mode === '2d' ? 196 : EDGE} />
      ) : (
        <button
          type="button"
          data-testid="controls-toggle"
          onClick={() => setControlsOpen(true)}
          style={{
            ...panelStyle,
            position: 'absolute',
            left: mode === '2d' ? 196 : EDGE,
            bottom: 76,
            padding: '7px 12px',
            font: `500 12.5px ${T.sans}`,
            color: T.text,
            cursor: 'pointer',
            zIndex: 45,
          }}
        >
          Controls
        </button>
      )}

      {/* design face: the tabbed inspector/checklist/materials/BOM dock
          floats as a right-hand column (its feature scope is unchanged by
          the overhaul — see DECISIONS.md) */}
      {mode === '2d' && face === 'design' && (
        <div
          style={{
            ...panelStyle,
            position: 'absolute',
            top: 64,
            right: EDGE,
            bottom: 76,
            width: 384,
            overflow: 'hidden',
            display: 'flex',
            zIndex: 30,
          }}
        >
          <RightDock />
        </div>
      )}
    </div>
  );
}
