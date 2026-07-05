import { create } from 'zustand';
import type { Vec2 } from '../schema';

// Transient editor/UI state — never persisted, never in undo history.

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
 * overlays it. A transient view choice, not a document property — switching
 * mechanisms or faces never destroys data. */
export type Face = 'sketch' | 'design';

/** Top-level editor mode (§8): the 2D per-mechanism editor (with sketch/design
 * faces) vs. the global 3D Assembly viewport. Transient, never persisted. */
export type Mode = '2d' | '3d';

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
   * Rendered by the canvas while the forces overlay is on; null when the
   * solve is idle/unavailable, falling back to drawn geometry. */
  positions: Record<string, Vec2> | null;
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
 * a node, mechanism switcher, DOF conflict card, input-channel card, clip
 * picker, export menu. The snap-connect case keeps its data in
 * `pendingConnect`; opening any popover closes the others. */
export type OpenPopover =
  | { kind: 'joint'; nodeId: string }
  | { kind: 'mech' }
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
  activeMechanismId: string | null;
  tool: Tool;
  mode: Mode;
  face: Face;
  rightTab: RightTab;
  focusHint: FocusHint | null;
  /** multi-select (§8.2a): order = click order; empty = nothing selected */
  selectedElementIds: string[];
  /** live solved pose during drag/playback; null = document positions */
  posePositions: Record<string, Vec2> | null;
  playback: PlaybackState;
  tracing: boolean;
  tracePath: Vec2[];
  /** control-clip recording pass (§4.4): frames captured while it runs */
  recording: boolean;
  recordBuffer: RecordFrame[];
  /** channel names under an active control-widget drag — their live control
   * value overrides a playing control clip (manual override, §4.4/§7) */
  heldChannels: string[];
  pendingConnect: PendingConnect | null;
  openPopover: OpenPopover;
  lengthEdit: LengthEdit | null;
  /** one-shot request for the canvas to zoom to an element (DOF conflict
   * click-to-zoom); the canvas consumes and clears it */
  focusElementId: string | null;
  /** ids flashed red because a limit/constraint was hit this frame */
  violated: string[];
  dof: { dof: number; classification: string } | null;
  /** equilibrium force overlays are gated behind this explicit toggle — the
   * sketch face hides forces by default (§8.1) */
  equilibriumOn: boolean;
  equilibrium: EquilibriumReadout;
  /** the §8.3 controls dock (builder + widgets + control clips) is toggled */
  controlsOpen: boolean;

  setActiveMechanism(id: string | null): void;
  setTool(tool: Tool): void;
  setMode(mode: Mode): void;
  setFace(face: Face): void;
  setRightTab(tab: RightTab): void;
  setFocusHint(hint: FocusHint | null): void;
  /** replace the selection with one element (null clears) */
  select(elementId: string | null): void;
  /** shift/cmd-click semantics: add if absent, remove if present */
  toggleSelect(elementId: string): void;
  clearSelection(): void;
  setPosePositions(p: Record<string, Vec2> | null): void;
  setPlayback(p: Partial<PlaybackState>): void;
  startRecording(): void;
  recordFrame(frame: RecordFrame): void;
  stopRecording(): RecordFrame[];
  setHeldChannels(channels: string[]): void;
  setTracing(on: boolean): void;
  appendTrace(p: Vec2): void;
  clearTrace(): void;
  setPendingConnect(pc: PendingConnect | null): void;
  setOpenPopover(p: OpenPopover): void;
  setLengthEdit(e: LengthEdit | null): void;
  setFocusElement(elementId: string | null): void;
  setDiagnostics(dof: EditorState['dof'], violated: string[]): void;
  setEquilibriumOn(on: boolean): void;
  setEquilibrium(readout: EquilibriumReadout): void;
  setControlsOpen(open: boolean): void;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  activeMechanismId: null,
  tool: 'select',
  mode: '2d',
  face: 'sketch',
  rightTab: 'inspector',
  focusHint: null,
  selectedElementIds: [],
  posePositions: null,
  playback: {
    clipName: null,
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
  equilibrium: IDLE_EQUILIBRIUM,
  controlsOpen: false,

  // face is deliberately kept on mechanism switch — it is a lens, not a
  // per-mechanism property (§8)
  setActiveMechanism: (id) =>
    set({
      activeMechanismId: id,
      posePositions: null,
      selectedElementIds: [],
      tracePath: [],
      openPopover: null,
      lengthEdit: null,
    }),
  setTool: (tool) => set({ tool, pendingConnect: null, openPopover: null, lengthEdit: null }),
  setMode: (mode) => set({ mode, openPopover: null, lengthEdit: null, pendingConnect: null }),
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
  clearSelection: () => set({ selectedElementIds: [] }),
  setPosePositions: (posePositions) => set({ posePositions }),
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
  setEquilibrium: (equilibrium) => set({ equilibrium }),
  setControlsOpen: (controlsOpen) => set({ controlsOpen }),
}));
