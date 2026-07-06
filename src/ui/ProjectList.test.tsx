// @vitest-environment jsdom
// Landing page: the bundled examples live behind the "New from example"
// dropdown, not in an always-visible grid. Covers open/close (button toggle,
// Escape, outside pointerdown) and that picking an item creates and opens a
// project seeded from that example.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../examples';
import { useAppStore } from '../state/appStore';
import { ProjectList } from './ProjectList';

// localStorage is undefined under vitest's jsdom (see the note in
// src/persistence/prefs.ts); the store's last-project bookkeeping needs one,
// so install a minimal in-memory Storage.
const mem = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  } satisfies Storage,
});

afterEach(cleanup);

const openMenu = () => fireEvent.click(screen.getByTestId('examples-menu-button'));

describe('ProjectList examples menu', () => {
  it('keeps examples hidden until the menu button is clicked, then lists them all', () => {
    render(<ProjectList />);
    expect(screen.queryByTestId('examples-menu')).toBeNull();

    openMenu();
    expect(screen.getByTestId('examples-menu')).toBeTruthy();
    for (const ex of EXAMPLES) {
      expect(screen.getByTestId(`example-${ex.id}`)).toBeTruthy();
    }
  });

  it('closes on Escape and on a pointerdown outside the menu', () => {
    render(<ProjectList />);

    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('examples-menu')).toBeNull();

    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('examples-menu')).toBeNull();
  });

  it('picking an example closes the menu and opens a project seeded from it', async () => {
    render(<ProjectList />);

    openMenu();
    const ex = EXAMPLES[0]!;
    fireEvent.click(screen.getByTestId(`example-${ex.id}`));
    expect(screen.queryByTestId('examples-menu')).toBeNull();

    await waitFor(() => {
      expect(useAppStore.getState().current?.name).toBe(ex.load().name);
    });
  });
});
