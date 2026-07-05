// The editor shell (interface overhaul + v7 quad-only conversion): the quad
// workspace IS the app — a full-bleed 2×2 Top/Perspective/Front/Side grid
// with floating chrome above it: project chip (top-left), actions chip
// (top-right), tool pill (left), transport pill (bottom-center), DOF pill
// (bottom-right). Element properties live on the panels (dimension chips,
// joint popover, selection card, all rendered inside each SketchCanvas); the
// design face additionally docks the tabbed inspector/checklist/materials/
// BOM panel as a floating column. One global solve loop feeds diagnostics,
// playback pose and equilibrium for every panel.
import { useEffect } from 'react';
import { massInventory } from '../analysis';
import { EXAMPLES } from '../examples';
import { useAppStore } from '../state/appStore';
import { deleteElement, duplicateElement } from '../state/docOps';
import { DEFAULT_CLIP_NAME, useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/themeStore';
import { computeSkeleton, REST_POSE } from '../wearer';
import { buildPipeModel } from './assembly/pipeModel';
import { ControlsDock } from './controls/ControlsDock';
import { ActionsChip } from './editor/ActionsChip';
import { DofPill } from './editor/DofPill';
import { EmptyState } from './editor/EmptyState';
import { pickRenderPositions } from './editor/forces';
import { ProjectChip } from './editor/ProjectChip';
import { RightDock } from './editor/RightDock';
import { publishedViews } from './editor/SketchCanvas';
import { ToolPill } from './editor/ToolPill';
import { TransportPill } from './editor/TransportPill';
import { EDGE, panelStyle, T } from './editor/theme';
import { useGlobalSolve } from './editor/useGlobalSolve';
import { QuadView } from './quad/QuadView';

/** Document render positions (drawn geometry / playback pose / settled sag)
 * — the same choice every panel makes, for the debug hook. */
function currentRenderPositions() {
  const doc = useAppStore.getState().current;
  const ed = useEditorStore.getState();
  const docPositions: Record<string, { x: number; y: number; z: number }> = {};
  for (const n of doc?.mechanism.nodes ?? []) docPositions[n.id] = n.position;
  return pickRenderPositions({
    docPositions,
    posePositions: ed.posePositions,
    settledPositions: ed.equilibriumOn ? ed.equilibrium.positions : null,
    dragging: ed.dragNodeId !== null,
  });
}

export function EditorShell() {
  const current = useAppStore((s) => s.current);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const face = useEditorStore((s) => s.face);
  const controlsOpen = useEditorStore((s) => s.controlsOpen);
  const setControlsOpen = useEditorStore((s) => s.setControlsOpen);

  // one global solve loop: diagnostics + playback pose + equilibrium overlay
  useGlobalSolve();

  // opening a different project clears document-scoped transient state
  // (selection, pose, trace, popovers, work-plane depths) — replaces the v6
  // keep-an-active-mechanism effect
  const projectId = current?.id;
  useEffect(() => {
    if (projectId) useEditorStore.getState().resetTransient();
  }, [projectId]);

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

      // space toggles the transport from anywhere; from the rest pose it
      // starts the default clip instead of silently playing nothing. OS
      // key-repeat is ignored so holding space (the canvas pan modifier)
      // toggles at most once.
      if (key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (e.repeat) return;
        if (ed.playback.clipName) ed.setPlayback({ playing: !ed.playback.playing });
        else ed.setPlayback({ clipName: DEFAULT_CLIP_NAME, tS: 0, playing: true });
        return;
      }
      // escape clears selection / closes floating UI
      if (key === 'escape') {
        ed.setOpenPopover(null);
        ed.setPendingConnect(null);
        ed.clearSelection();
        return;
      }
      // delete / duplicate act on the global selection
      if (ed.selectedElementIds.length === 0) return;
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        const ids = ed.selectedElementIds;
        useAppStore.getState().updateCurrent((d) => {
          let next = d;
          for (const id of ids) next = deleteElement(next, id);
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
            const r = duplicateElement(next, id);
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
  // replaced) so seams published by children survive this initializer
  // regardless of effect ordering.
  useEffect(() => {
    const w = window as unknown as { __riglab?: Record<string, unknown> };
    if (!w.__riglab) w.__riglab = {};
    const hook = w.__riglab;
    hook.getDoc = () => useAppStore.getState().current;
    hook.getEditor = () => {
      const s = useEditorStore.getState();
      return {
        dof: s.dof,
        tool: s.tool,
        face: s.face,
        selectedElementIds: s.selectedElementIds,
        rightTab: s.rightTab,
        openPopover: s.openPopover,
        playback: s.playback,
        activePanel: s.activePanel,
        quadMaximized: s.quadMaximized,
        panelDepths: s.panelDepths,
        night: useThemeStore.getState().night,
      };
    };
    // seam for exercising the equilibrium force-overlay plumbing (§5.2)
    hook.setEquilibrium = (readout: unknown) =>
      useEditorStore.getState().setEquilibrium(readout as never);
    // scripted-verification seam: loads a bundled example as the live
    // document without persisting it
    hook.loadExample = (id: string) => {
      const ex = EXAMPLES.find((e) => e.id === id);
      if (ex) {
        useAppStore.setState({ current: ex.load(), saveState: 'saved' });
        useEditorStore.getState().resetTransient();
      }
    };
    // the pose every panel is rendering (drawn geometry, playback pose, or
    // settled equilibrium sag) — Vec3 document space
    hook.getRenderPositions = () => currentRenderPositions();
    // per-panel view transforms published by the sketch canvases
    hook.getView = (panel?: 'top' | 'front' | 'side') =>
      publishedViews[
        panel ?? (useEditorStore.getState().activePanel as 'top' | 'front' | 'side')
      ] ?? publishedViews.side;
    // scripted-verification seam for the compound 3D world: node/element
    // counts, render mode, pipe model stats, total mass from src/analysis
    hook.getAssemblyStats = () => {
      const doc = useAppStore.getState().current;
      if (!doc) return null;
      const positions = currentRenderPositions();
      const frame = computeSkeleton(doc.wearer, REST_POSE);
      const inventory = massInventory(doc, positions, frame.anchors);
      const model = buildPipeModel(doc.mechanism, positions, doc.materials);
      return {
        render: useEditorStore.getState().assemblyRender,
        nodeCount: doc.mechanism.nodes.length,
        elementCount: doc.mechanism.elements.length,
        groupCount: doc.groups.length,
        totalMassKg: inventory.totalMassKg,
        primCount: model.prims.length,
        pipeCount: model.pipeCount,
        fittingCount: model.fittingCount,
      };
    };
  }, []);

  if (!current) return null;

  const hasElements = current.mechanism.elements.length > 0;

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
      {/* full-bleed quad workspace; all chrome floats above it. The clip
          transport stays mounted so playback drives every panel. */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        <QuadView />
      </div>

      {/* onboarding: a brand-new project has nothing drawn yet */}
      {!hasElements && <EmptyState />}

      <ProjectChip />
      <ActionsChip />
      <ToolPill />
      <TransportPill />
      <DofPill />

      {/* controls dock (§4.4): a toggled bottom panel (controls map onto
          input channels); it clears the left tool pill */}
      {controlsOpen ? (
        <ControlsDock left={196} />
      ) : (
        <button
          type="button"
          data-testid="controls-toggle"
          onClick={() => setControlsOpen(true)}
          style={{
            ...panelStyle,
            position: 'absolute',
            left: 196,
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
      {face === 'design' && (
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
