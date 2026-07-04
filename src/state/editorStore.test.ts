// Multi-select + face-toggle semantics (§8, §8.2a).
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';

const state = () => useEditorStore.getState();

beforeEach(() => {
  state().clearSelection();
  state().setFace('sketch');
  state().setActiveMechanism(null);
});

describe('selection', () => {
  it('select replaces the selection; null clears it', () => {
    state().select('a');
    expect(state().selectedElementIds).toEqual(['a']);
    state().select('b');
    expect(state().selectedElementIds).toEqual(['b']);
    state().select(null);
    expect(state().selectedElementIds).toEqual([]);
  });

  it('toggleSelect adds absent ids and removes present ones, keeping click order', () => {
    state().select('a');
    state().toggleSelect('b');
    state().toggleSelect('c');
    expect(state().selectedElementIds).toEqual(['a', 'b', 'c']);
    state().toggleSelect('b');
    expect(state().selectedElementIds).toEqual(['a', 'c']);
  });

  it('clearSelection empties; switching mechanisms clears the selection', () => {
    state().select('a');
    state().toggleSelect('b');
    state().clearSelection();
    expect(state().selectedElementIds).toEqual([]);
    state().select('a');
    state().setActiveMechanism('m2');
    expect(state().selectedElementIds).toEqual([]);
  });
});

describe('face', () => {
  it('defaults to sketch and toggles', () => {
    expect(state().face).toBe('sketch');
    state().setFace('design');
    expect(state().face).toBe('design');
  });

  it('is kept across mechanism switches — a lens, not a document property', () => {
    state().setFace('design');
    state().setActiveMechanism('m2');
    expect(state().face).toBe('design');
  });
});
