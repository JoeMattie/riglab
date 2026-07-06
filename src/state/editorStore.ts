import { create } from 'zustand';
import type { ProposedChange } from '../design/autoResolve';
import { getQuadLayoutPref, setQuadLayoutPref } from '../persistence/prefs';
import type { Vec2, Vec3 } from '../schema';
import { clampSplit, PANEL_ORDER, type QuadSplit } from '../ui/quad/quadLayout';
import type { ClipboardPayload } from './clipboard';

// workspace layout prefs (splitter fractions + panel visibility) restore at
// module load and re-persist on every change — like the night pref
const storedLayout = getQuadLayoutPref();

// Transient editor/UI state — never persisted, never in undo history.
//
// v7 (PLANFILE-3d-conversion.md): the quad workspace IS the app — the 2d/3d
// mode switch and per-mechanism activation are gone (one compound mechanism
// per project). Solved poses, traces, and equilibrium readouts are Vec3
// document coordinates; panels project them for display.

export type Tool =
  | 'select'
  | 'pipe'
  | 'polyline'
  | 'freehand'
  | 'bind'
  | 'rope'
  | 'elastic'
  | 'bowden'
  | 'torsionCable';

/** The two lenses on one document (§8): sketch hides engineering, design
 * overlays it. A transient view choice, not a document property. */
export type Face = 'sketch' | 'design';

/** Quad-workspace panels; `persp` is the 3D perspective preview. */
export type QuadPanelId = 'top' | 'front' | 'side' | 'persp';

/** The three editable orthographic panels (perspective has no work plane). */
export type OrthoPanelId = 'top' | 'front' | 'side';

/** Work-plane depth along each ortho panel's normal, metres. Default 0;
 * edited via the panel-header chip, and adopted from clicked/snapped
 * geometry so connections land exactly (PLANFILE-3d-conversion.md). */
export type PanelDepths = Record<OrthoPanelId, number>;

/** Design-face right-dock tabs (§8.2/§8.3): inspector + checklist docked
 * alongside, materials (incl. nesting matrix) and BOM as siblings. */
export type RightTab = 'inspector' | 'checklist' | 'materials' | 'bom';

/** Checklist click-to-fix routing (§8.2 "opens exactly the needed control"):
 * a transient one-shot hint the target control consumes (scroll + highlight)
 * then clears. */
export interface FocusHint {
  control: 'material' | 'realization' | 'channel';
  channelId?: string;
}

/** Equilibrium (§5.2) settle state for the force overlays. `unavailable`
 * covers the pre-merge worktree where the solver's equilibrium mode is not yet
 * implemented — the UI degrades gracefully rather than throwing. */
export type SolverStatus = 'idle' | 'settling' | 'converged' | 'nonConverged' | 'unavailable';

export interface EquilibriumReadout {
  status: SolverStatus;
  /** signed axial force per element id, N (tension positive) */
  elementForces: Record<string, number>;
  /** required holding force/torque per input-channel name */
  requiredInputs: Record<string, number>;
  ropesRequiringCompression: string[];
  /** settled pose per node id — the sag the real rig relaxes into (§5.2).
   * Rendered by the panels while the forces overlay is on; null when the
   * solve is idle/unavailable, falling back to drawn geometry. */
  positions: Record<string, Vec3> | null;
}

export const IDLE_EQUILIBRIUM: EquilibriumReadout = {
  status: 'idle',
  elementForces: {},
  requiredInputs: {},
  ropesRequiringCompression: [],
  positions: null,
};

export interface PendingConnect {
  /** screen position for the menu */
  screen: Vec2;
  options: Array<'pivot' | 'weld' | 'slider' | 'detach'>;
  choose(option: 'pivot' | 'weld' | 'slider' | 'detach'): void;
  cancel(): void;
}

/** One floating popover/menu at a time (interface overhaul): joint popover at
 * a node, DOF conflict card, input-channel card, clip picker, export menu.
 * The snap-connect case keeps its data in `pendingConnect`; opening any
 * popover closes the others. (The v6 mechanism switcher is gone — one
 * compound mechanism per project.) */
export type OpenPopover =
  | { kind: 'joint'; nodeId: string }
  | { kind: 'dof' }
  | { kind: 'inputs' }
  | { kind: 'clip' }
  | { kind: 'export' }
  | null;

/** Inline length-chip edit on the canvas: which pipe, and the field draft. */
export interface LengthEdit {
  elementId: string;
  draft: string;
}

/** A pending auto-resolve preview (PLANFILE-marquee-autoresolve.md). `docRef`
 * is the document object the proposal was computed from — any edit produces a
 * new document object, so `docRef !== current` marks the proposal stale and
 * the preview hides itself rather than applying against moved ground. */
export interface AutoProposalState {
  docRef: unknown;
  changes: ProposedChange[];
}

/** Movement clip pre-selected on launch and started by the global spacebar
 * toggle when the rest pose is active. A test pins this to a bundled clip. */
export const DEFAULT_CLIP_NAME = 'walk';

export interface PlaybackState {
  /** active movement clip (§7.2) */
  clipName: string | null;
  /** active control clip (§4.4), driven on the same timeline as clipName */
  controlClipName: string | null;
  playing: boolean;
  tS: number;
  speed: number;
  amplitude: number;
}

/** One captured frame of live control channel values during a recording pass
 * (§4.4 "record by scrubbing"). */
export interface RecordFrame {
  tS: number;
  values: Record<string, number>;
}

export interface EditorState {
  tool: Tool;
  face: Face;
  rightTab: RightTab;
  focusHint: FocusHint | null;
  /** multi-select (§8.2a): order = click order; empty = nothing selected.
   * Selection is global across quad panels. */
  selectedElementIds: string[];
  /** live solved pose during drag/playback (document space); null = document
   * positions */
  posePositions: Record<string, Vec3> | null;
  /** node under an active pointer drag (any panel); the global solve loop
   * defers to the gesture's own solves while set */
  dragNodeId: string | null;
  playback: PlaybackState;
  tracing: boolean;
  /** traced node path in document space; panels project it for display */
  tracePath: Vec3[];
  /** control-clip recording pass (§4.4): frames captured while it runs */
  recording: boolean;
  recordBuffer: RecordFrame[];
  /** channel names under an active control-widget drag — their live control
   * value overrides a playing control clip (manual override, §4.4/§7) */
  heldChannels: string[];
  pendingConnect: PendingConnect | null;
  openPopover: OpenPopover;
  lengthEdit: LengthEdit | null;
  /** one-shot request for the panels to zoom to an element (DOF conflict
   * click-to-zoom); the consumer clears it */
  focusElementId: string | null;
  /** ids flashed red because a limit/constraint was hit this frame */
  violated: string[];
  dof: { dof: number; classification: string } | null;
  /** equilibrium force overlays are gated behind this explicit toggle — the
   * sketch face hides forces by default (§8.1) */
  equilibriumOn: boolean;
  /** drag-time constraint enforcement (PLANFILE-multiselect-drag-constraints):
   * on = node drags run the kinematic solve (pipe lengths rigid, locks
   * honored); off (default) = drags move nodes directly and pipe lengths
   * follow. A lens like equilibriumOn — not document state, not reset per
   * project. */
  constraintsOn: boolean;
  equilibrium: EquilibriumReadout;
  /** pending auto-resolve preview; null = none */
  autoProposal: AutoProposalState | null;
  /** perspective-panel render: wireframe tubes vs the solved pipe-and-fittings
   * model (PLANFILE-quad-workspace slice 3) */
  assemblyRender: 'wire' | 'pipe';
  /** the panel currently maximized (double-click header); a maximized ortho
   * panel is the old focused-2D feel */
  quadMaximized: QuadPanelId | null;
  /** shared splitter fractions: workspace share of the left column (x) and
   * top row (y). Clamped to [0.15, 0.85]; persisted as a UI pref
   * (PLANFILE-quad-panel-controls A) */
  quadSplit: QuadSplit;
  /** per-panel visibility (top-bar toggles); at least one stays true.
   * Persisted with the splitter fractions (PLANFILE-quad-panel-controls B) */
  panelsVisible: Record<QuadPanelId, boolean>;
  /** per-panel active work-plane depth along the panel normal (m) */
  panelDepths: PanelDepths;
  /** the panel that last received pointer input — floating per-selection UI
   * (joint popover, selection card) renders only in this panel */
  activePanel: QuadPanelId;
  /** the §8.3 controls dock (builder + widgets + control clips) is toggled */
  controlsOpen: boolean;
  /** selection clipboard (PLANFILE-quad-panel-controls C) — a full snapshot
   * of copied elements + referenced nodes. Transient app state, never in the
   * file format; cleared on project switch (its ids/materials/channels are
   * document-scoped) */
  clipboard: ClipboardPayload | null;
  setClipboard(payload: ClipboardPayload | null): void;

  /** onboarding empty-state dismissed for the current document ("Start
   * drawing" must actually clear the overlay so the canvas gets the pointer) */
  onboardingDismissed: boolean;
  dismissOnboarding(): void;

  /** Clear document-scoped transient state (selection, pose, trace,
   * popovers, proposal) — call when a different project is opened. Replaces
   * the v6 setActiveMechanism(id). */
  resetTransient(): void;
  setTool(tool: Tool): void;
  setFace(face: Face): void;
  setRightTab(tab: RightTab): void;
  setFocusHint(hint: FocusHint | null): void;
  /** replace the selection with one element (null clears) */
  select(elementId: string | null): void;
  /** shift/cmd-click semantics: add if absent, remove if present */
  toggleSelect(elementId: string): void;
  /** replace the whole selection at once (marquee); deduped, order kept */
  setSelection(elementIds: string[]): void;
  clearSelection(): void;
  setPosePositions(p: Record<string, Vec3> | null): void;
  setDragNode(nodeId: string | null): void;
  setPlayback(p: Partial<PlaybackState>): void;
  startRecording(): void;
  recordFrame(frame: RecordFrame): void;
  stopRecording(): RecordFrame[];
  setHeldChannels(channels: string[]): void;
  setTracing(on: boolean): void;
  appendTrace(p: Vec3): void;
  clearTrace(): void;
  setPendingConnect(pc: PendingConnect | null): void;
  setOpenPopover(p: OpenPopover): void;
  setLengthEdit(e: LengthEdit | null): void;
  setFocusElement(elementId: string | null): void;
  setDiagnostics(dof: EditorState['dof'], violated: string[]): void;
  setEquilibriumOn(on: boolean): void;
  setConstraintsOn(on: boolean): void;
  setEquilibrium(readout: EquilibriumReadout): void;
  setAutoProposal(p: AutoProposalState | null): void;
  setAssemblyRender(render: 'wire' | 'pipe'): void;
  setQuadMaximized(panel: QuadPanelId | null): void;
  /** drag a splitter: set either/both fractions (clamped, persisted) */
  setQuadSplit(split: Partial<QuadSplit>): void;
  /** double-click a splitter: reset its axis/axes to 50/50 */
  resetQuadSplit(axes: ReadonlyArray<'x' | 'y'>): void;
  /** top-bar visibility toggle; refuses to hide the last visible panel */
  togglePanelVisible(panel: QuadPanelId): void;
  setPanelDepth(panel: OrthoPanelId, depthM: number): void;
  setActivePanel(panel: QuadPanelId): void;
  setControlsOpen(open: boolean): void;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  tool: 'select',
  face: 'sketch',
  rightTab: 'inspector',
  focusHint: null,
  selectedElementIds: [],
  posePositions: null,
  dragNodeId: null,
  playback: {
    clipName: DEFAULT_CLIP_NAME,
    controlClipName: null,
    playing: false,
    tS: 0,
    speed: 1,
    amplitude: 1,
  },
  tracing: false,
  tracePath: [],
  recording: false,
  recordBuffer: [],
  heldChannels: [],
  pendingConnect: null,
  openPopover: null,
  lengthEdit: null,
  focusElementId: null,
  violated: [],
  dof: null,
  equilibriumOn: false,
  constraintsOn: false,
  equilibrium: IDLE_EQUILIBRIUM,
  autoProposal: null,
  assemblyRender: 'wire',
  quadMaximized: null,
  quadSplit: storedLayout?.split ?? { x: 0.5, y: 0.5 },
  panelsVisible: storedLayout?.visible ?? { top: true, persp: true, front: true, side: true },
  panelDepths: { top: 0, front: 0, side: 0 },
  activePanel: 'side',
  controlsOpen: false,
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
  onboardingDismissed: false,
  dismissOnboarding: () => set({ onboardingDismissed: true }),

  // face is deliberately kept across documents — it is a lens, not a
  // document property (§8)
  resetTransient: () =>
    set({
      posePositions: null,
      selectedElementIds: [],
      tracePath: [],
      openPopover: null,
      lengthEdit: null,
      autoProposal: null,
      clipboard: null,
      panelDepths: { top: 0, front: 0, side: 0 },
      onboardingDismissed: false,
    }),
  setTool: (tool) => set({ tool, pendingConnect: null, openPopover: null, lengthEdit: null }),
  setFace: (face) => set({ face }),
  setRightTab: (rightTab) => set({ rightTab }),
  setFocusHint: (focusHint) => set({ focusHint }),
  select: (elementId) => set({ selectedElementIds: elementId === null ? [] : [elementId] }),
  toggleSelect: (elementId) =>
    set((s) => ({
      selectedElementIds: s.selectedElementIds.includes(elementId)
        ? s.selectedElementIds.filter((id) => id !== elementId)
        : [...s.selectedElementIds, elementId],
    })),
  setSelection: (elementIds) => set({ selectedElementIds: [...new Set(elementIds)] }),
  clearSelection: () => set({ selectedElementIds: [] }),
  setPosePositions: (posePositions) => set({ posePositions }),
  setDragNode: (dragNodeId) => set({ dragNodeId }),
  setPlayback: (p) => set((s) => ({ playback: { ...s.playback, ...p } })),
  // recording resets the timeline and starts the transport so live control
  // scrubbing is captured against a movement clip on the same timeline (§4.4)
  startRecording: () =>
    set((s) => ({
      recording: true,
      recordBuffer: [],
      playback: { ...s.playback, tS: 0, playing: true },
    })),
  recordFrame: (frame) => set((s) => ({ recordBuffer: [...s.recordBuffer, frame] })),
  stopRecording: () => {
    const frames = get().recordBuffer;
    set((s) => ({ recording: false, playback: { ...s.playback, playing: false } }));
    return frames;
  },
  setHeldChannels: (heldChannels) => set({ heldChannels }),
  setTracing: (tracing) => set({ tracing, tracePath: [] }),
  appendTrace: (p) => set((s) => ({ tracePath: [...s.tracePath, p] })),
  clearTrace: () => set({ tracePath: [] }),
  // opening the connect menu closes any other popover (one at a time)
  setPendingConnect: (pendingConnect) =>
    set(pendingConnect ? { pendingConnect, openPopover: null } : { pendingConnect }),
  setOpenPopover: (openPopover) =>
    set((s) => ({
      openPopover,
      // opening a popover cancels a pending connect and an inline edit
      pendingConnect: openPopover ? null : s.pendingConnect,
      lengthEdit: openPopover ? null : s.lengthEdit,
    })),
  setLengthEdit: (lengthEdit) => set({ lengthEdit }),
  setFocusElement: (focusElementId) => set({ focusElementId }),
  setDiagnostics: (dof, violated) => set({ dof, violated }),
  setEquilibriumOn: (equilibriumOn) =>
    set({
      equilibriumOn,
      equilibrium: equilibriumOn ? { ...IDLE_EQUILIBRIUM, status: 'settling' } : IDLE_EQUILIBRIUM,
    }),
  setConstraintsOn: (constraintsOn) => set({ constraintsOn }),
  setEquilibrium: (equilibrium) => set({ equilibrium }),
  setAutoProposal: (autoProposal) => set({ autoProposal }),
  setAssemblyRender: (assemblyRender) => set({ assemblyRender }),
  setQuadMaximized: (quadMaximized) => set({ quadMaximized }),
  setQuadSplit: (split) =>
    set((s) => {
      const quadSplit: QuadSplit = {
        x: clampSplit(split.x ?? s.quadSplit.x),
        y: clampSplit(split.y ?? s.quadSplit.y),
      };
      setQuadLayoutPref({ split: quadSplit, visible: s.panelsVisible });
      return { quadSplit };
    }),
  resetQuadSplit: (axes) =>
    set((s) => {
      const quadSplit: QuadSplit = {
        x: axes.includes('x') ? 0.5 : s.quadSplit.x,
        y: axes.includes('y') ? 0.5 : s.quadSplit.y,
      };
      setQuadLayoutPref({ split: quadSplit, visible: s.panelsVisible });
      return { quadSplit };
    }),
  togglePanelVisible: (panel) =>
    set((s) => {
      const panelsVisible = { ...s.panelsVisible, [panel]: !s.panelsVisible[panel] };
      // at least one panel always on: hiding the last visible one is refused
      if (!PANEL_ORDER.some((p) => panelsVisible[p])) return {};
      const patch: Partial<EditorState> = { panelsVisible };
      if (!panelsVisible[panel]) {
        // hiding the maximized panel restores the grid; hiding the active
        // panel moves activation to the first visible one
        if (s.quadMaximized === panel) patch.quadMaximized = null;
        if (s.activePanel === panel) {
          patch.activePanel = PANEL_ORDER.find((p) => panelsVisible[p])!;
        }
      }
      setQuadLayoutPref({ split: s.quadSplit, visible: panelsVisible });
      return patch;
    }),
  setPanelDepth: (panel, depthM) =>
    set((s) => ({ panelDepths: { ...s.panelDepths, [panel]: depthM } })),
  setActivePanel: (activePanel) => set({ activePanel }),
  setControlsOpen: (controlsOpen) => set({ controlsOpen }),
}));
