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
  selectedElementId: string | null;
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
  select(elementId: string | null): void;
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
  selectedElementId: null,
  posePositions: null,
  playback: { clipName: null, playing: false, tS: 0, speed: 1, amplitude: 1 },
  tracing: false,
  tracePath: [],
  pendingConnect: null,
  violated: [],
  dof: null,
  equilibriumOn: false,
  equilibrium: IDLE_EQUILIBRIUM,

  setActiveMechanism: (id) =>
    set({ activeMechanismId: id, posePositions: null, selectedElementId: null, tracePath: [] }),
  setTool: (tool) => set({ tool, pendingConnect: null }),
  select: (selectedElementId) => set({ selectedElementId }),
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
