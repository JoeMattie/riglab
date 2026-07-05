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
}

export const IDLE_EQUILIBRIUM: EquilibriumReadout = {
  status: 'idle',
  elementForces: {},
  requiredInputs: {},
  ropesRequiringCompression: [],
};

export interface PendingConnect {
  /** screen position for the menu */
  screen: Vec2;
  options: Array<'pivot' | 'weld' | 'slider' | 'detach'>;
  choose(option: 'pivot' | 'weld' | 'slider' | 'detach'): void;
  cancel(): void;
}

export interface PlaybackState {
  clipName: string | null;
  playing: boolean;
  tS: number;
  speed: number;
  amplitude: number;
}

export interface EditorState {
  activeMechanismId: string | null;
  tool: Tool;
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
  pendingConnect: PendingConnect | null;
  /** ids flashed red because a limit/constraint was hit this frame */
  violated: string[];
  dof: { dof: number; classification: string } | null;
  /** equilibrium force overlays are gated behind this explicit toggle — the
   * sketch face hides forces by default (§8.1) */
  equilibriumOn: boolean;
  equilibrium: EquilibriumReadout;

  setActiveMechanism(id: string | null): void;
  setTool(tool: Tool): void;
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
  setTracing(on: boolean): void;
  appendTrace(p: Vec2): void;
  clearTrace(): void;
  setPendingConnect(pc: PendingConnect | null): void;
  setDiagnostics(dof: EditorState['dof'], violated: string[]): void;
  setEquilibriumOn(on: boolean): void;
  setEquilibrium(readout: EquilibriumReadout): void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  activeMechanismId: null,
  tool: 'select',
  face: 'sketch',
  rightTab: 'inspector',
  focusHint: null,
  selectedElementIds: [],
  posePositions: null,
  playback: { clipName: null, playing: false, tS: 0, speed: 1, amplitude: 1 },
  tracing: false,
  tracePath: [],
  pendingConnect: null,
  violated: [],
  dof: null,
  equilibriumOn: false,
  equilibrium: IDLE_EQUILIBRIUM,

  // face is deliberately kept on mechanism switch — it is a lens, not a
  // per-mechanism property (§8)
  setActiveMechanism: (id) =>
    set({ activeMechanismId: id, posePositions: null, selectedElementIds: [], tracePath: [] }),
  setTool: (tool) => set({ tool, pendingConnect: null }),
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
  setTracing: (tracing) => set({ tracing, tracePath: [] }),
  appendTrace: (p) => set((s) => ({ tracePath: [...s.tracePath, p] })),
  clearTrace: () => set({ tracePath: [] }),
  setPendingConnect: (pendingConnect) => set({ pendingConnect }),
  setDiagnostics: (dof, violated) => set({ dof, violated }),
  setEquilibriumOn: (equilibriumOn) =>
    set({
      equilibriumOn,
      equilibrium: equilibriumOn ? { ...IDLE_EQUILIBRIUM, status: 'settling' } : IDLE_EQUILIBRIUM,
    }),
  setEquilibrium: (equilibrium) => set({ equilibrium }),
}));
