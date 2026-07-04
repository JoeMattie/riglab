import type { Project } from '../schema';

export interface Autosaver {
  /** (Re)schedule a save of this document after the debounce delay. */
  schedule(doc: Project): void;
  /** Save immediately if a save is pending. */
  flush(): Promise<void>;
  cancel(): void;
  /** True while a save is scheduled or running (drives the save indicator). */
  isDirty(): boolean;
  /** True if an edit newer than the currently running save is scheduled —
   * usable from inside the save callback, where isDirty() is always true. */
  hasPending(): boolean;
}

export function createAutosaver(
  save: (doc: Project) => Promise<void>,
  delayMs = 1000,
): Autosaver {
  let pending: Project | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const fire = async (): Promise<void> => {
    timer = null;
    const doc = pending;
    pending = null;
    if (!doc) return;
    inFlight = save(doc);
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  };

  return {
    schedule(doc) {
      pending = doc;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void fire(), delayMs);
    },
    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        await fire();
      }
      if (inFlight) await inFlight;
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    isDirty() {
      return pending !== null || timer !== null || inFlight !== null;
    },
    hasPending() {
      return pending !== null || timer !== null;
    },
  };
}
