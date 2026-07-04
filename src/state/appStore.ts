import { temporal } from 'zundo';
import { create } from 'zustand';
import { createAutosaver } from '../persistence/autosave';
import { importProjectJson } from '../persistence/exportImport';
import { setLastProjectId } from '../persistence/prefs';
import { ProjectStore, type ProjectSummary } from '../persistence/projectStore';
import type { Project } from '../schema';

// Project lifecycle + the single document-mutation path (updateCurrent).
// Undo/redo: zundo temporal history over the document only (per
// DECISIONS.md), limit 100; history pauses during drag gestures so a drag
// is one undo step, and clears when switching projects.

export type SaveState = 'saved' | 'saving';

export interface AppState {
  projects: ProjectSummary[];
  current: Project | null;
  saveState: SaveState;
  refreshProjects(): Promise<void>;
  createProject(name: string): Promise<void>;
  openProject(id: string): Promise<void>;
  closeProject(): Promise<void>;
  renameProject(id: string, name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** Apply a document change; persisted via debounced autosave. */
  updateCurrent(update: (doc: Project) => Project): void;
  importProject(fileText: string): Promise<void>;
  undo(): void;
  redo(): void;
  /** batch many updates (e.g. a drag gesture) into one undo step */
  beginGesture(): void;
  endGesture(): void;
}

export function createAppStore(store: ProjectStore = new ProjectStore()) {
  const useStore = create<AppState>()(
    temporal(
      (set, get) => {
        let gestureStart: Project | null = null;

        const autosaver = createAutosaver(async (doc) => {
          await store.saveProject(doc);
          // only report "saved" if no newer edit got scheduled meanwhile
          if (!autosaver.hasPending()) {
            set({ saveState: 'saved' });
            void get().refreshProjects();
          }
        });

        return {
          projects: [],
          current: null,
          saveState: 'saved',

          async refreshProjects() {
            set({ projects: await store.listProjects() });
          },

          async createProject(name) {
            const doc = await store.createProject(name);
            setLastProjectId(doc.id);
            set({ current: doc, saveState: 'saved' });
            useStore.temporal.getState().clear();
            await get().refreshProjects();
          },

          async openProject(id) {
            const doc = await store.loadProject(id);
            if (!doc) throw new Error(`no project ${id}`);
            setLastProjectId(id);
            set({ current: doc, saveState: 'saved' });
            useStore.temporal.getState().clear();
          },

          async closeProject() {
            await autosaver.flush();
            setLastProjectId(null);
            set({ current: null, saveState: 'saved' });
            useStore.temporal.getState().clear();
            await get().refreshProjects();
          },

          async renameProject(id, name) {
            await store.renameProject(id, name);
            await get().refreshProjects();
          },

          async deleteProject(id) {
            await store.deleteProject(id);
            const cur = get().current;
            if (cur?.id === id) set({ current: null });
            await get().refreshProjects();
          },

          updateCurrent(update) {
            const cur = get().current;
            if (!cur) return;
            const next = update(cur);
            set({ current: next, saveState: 'saving' });
            autosaver.schedule(next);
          },

          async importProject(fileText) {
            const doc = importProjectJson(fileText);
            await store.saveProject(doc);
            await get().refreshProjects();
          },

          undo() {
            useStore.temporal.getState().undo();
            const cur = get().current;
            if (cur) {
              set({ saveState: 'saving' });
              autosaver.schedule(cur);
            }
          },

          redo() {
            useStore.temporal.getState().redo();
            const cur = get().current;
            if (cur) {
              set({ saveState: 'saving' });
              autosaver.schedule(cur);
            }
          },

          beginGesture() {
            gestureStart = get().current;
            useStore.temporal.getState().pause();
          },

          endGesture() {
            const final = get().current;
            const temporal = useStore.temporal.getState();
            if (gestureStart && final && final !== gestureStart) {
              // one history entry for the whole gesture, restoring to the
              // PRE-gesture state: silently rewind while paused, then replay
              // the final state with history recording on
              set({ current: gestureStart });
              temporal.resume();
              set({ current: final });
            } else {
              // click without change — no history entry
              temporal.resume();
            }
            gestureStart = null;
          },
        };
      },
      {
        partialize: (s) => ({ current: s.current }),
        equality: (past, cur) => past.current === cur.current,
        limit: 100,
      },
    ),
  );
  return useStore;
}

export const useAppStore = createAppStore();
