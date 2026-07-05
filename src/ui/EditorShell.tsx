// The editor shell (interface overhaul): a full-bleed canvas with floating
// chrome — project chip (top-left), actions chip (top-right), tool pill
// (left), transport pill (bottom-center), DOF pill (bottom-right). Element
// properties live on the canvas (dimension chips, joint popover, selection
// card, all rendered inside SketchCanvas); the design face additionally docks
// the tabbed inspector/checklist/materials/BOM panel as a floating column.
import { useEffect } from 'react';
import { EXAMPLES } from '../examples';
import { useAppStore } from '../state/appStore';
import { useEditorStore } from '../state/editorStore';
import { AssemblyView } from './assembly/AssemblyView';
import { ActionsChip } from './editor/ActionsChip';
import { DofPill } from './editor/DofPill';
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

      <ProjectChip />
      <ActionsChip />
      {mode === '2d' && <ToolPill />}
      <TransportPill />
      {mode === '2d' && <DofPill />}

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
