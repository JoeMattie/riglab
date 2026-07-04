import { create } from 'zustand';
import { createAutosaver } from '../persistence/autosave';
import { importProjectJson } from '../persistence/exportImport';
import { setLastProjectId } from '../persistence/prefs';
import { ProjectStore, type ProjectSummary } from '../persistence/projectStore';
import type { Project } from '../schema';

// Phase 0 shell state: project lifecycle + autosave wiring. Document editing
// (and zundo temporal history, per DECISIONS.md) arrives in Phase 1 with the
// first editing operations.

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
}

export function createAppStore(store: ProjectStore = new ProjectStore()) {
  return create<AppState>()((set, get) => {
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
        await get().refreshProjects();
      },

      async openProject(id) {
        const doc = await store.loadProject(id);
        if (!doc) throw new Error(`no project ${id}`);
        setLastProjectId(id);
        set({ current: doc, saveState: 'saved' });
      },

      async closeProject() {
        await autosaver.flush();
        setLastProjectId(null);
        set({ current: null, saveState: 'saved' });
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
    };
  });
}

export const useAppStore = createAppStore();
