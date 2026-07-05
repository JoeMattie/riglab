// Multi-select + face-toggle semantics (§8, §8.2a) and the v7 single-document
// transient reset (PLANFILE-3d-conversion.md: no per-mechanism activation).
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';

const state = () => useEditorStore.getState();

beforeEach(() => {
  state().clearSelection();
  state().setFace('sketch');
  state().resetTransient();
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

  it('setSelection replaces the whole selection and dedupes, keeping order', () => {
    state().select('x');
    state().setSelection(['a', 'b', 'a', 'c']);
    expect(state().selectedElementIds).toEqual(['a', 'b', 'c']);
    state().setSelection([]);
    expect(state().selectedElementIds).toEqual([]);
  });

  it('clearSelection empties; resetTransient (project switch) clears everything', () => {
    state().select('a');
    state().toggleSelect('b');
    state().clearSelection();
    expect(state().selectedElementIds).toEqual([]);
    state().select('a');
    state().setPosePositions({ n1: { x: 1, y: 2, z: 3 } });
    state().appendTrace({ x: 0, y: 0, z: 0 });
    state().resetTransient();
    expect(state().selectedElementIds).toEqual([]);
    expect(state().posePositions).toBeNull();
    expect(state().tracePath).toEqual([]);
  });
});

describe('popovers (interface overhaul: one at a time)', () => {
  it('opening a popover clears the inline length edit and pending connect', () => {
    state().setLengthEdit({ elementId: 'e1', draft: '10' });
    state().setOpenPopover({ kind: 'inputs' });
    expect(state().lengthEdit).toBeNull();
    expect(state().openPopover).toEqual({ kind: 'inputs' });
  });

  it('a pending connect closes any open popover', () => {
    state().setOpenPopover({ kind: 'dof' });
    state().setPendingConnect({
      screen: { x: 0, y: 0 },
      options: ['pivot'],
      choose: () => {},
      cancel: () => {},
    });
    expect(state().openPopover).toBeNull();
    state().setPendingConnect(null);
  });

  it('switching tools or resetting closes popovers and edits', () => {
    state().setOpenPopover({ kind: 'joint', nodeId: 'n1' });
    state().setTool('pipe');
    expect(state().openPopover).toBeNull();
    state().setLengthEdit({ elementId: 'e1', draft: '1' });
    state().resetTransient();
    expect(state().lengthEdit).toBeNull();
    state().setTool('select');
  });
});

describe('face', () => {
  it('defaults to sketch and toggles', () => {
    expect(state().face).toBe('sketch');
    state().setFace('design');
    expect(state().face).toBe('design');
  });

  it('is kept across document resets — a lens, not a document property', () => {
    state().setFace('design');
    state().resetTransient();
    expect(state().face).toBe('design');
  });
});

describe('3D pose plumbing', () => {
  it('pose positions and traces are Vec3 document coordinates', () => {
    state().setPosePositions({ n1: { x: 1, y: 2, z: -0.2 } });
    expect(state().posePositions).toEqual({ n1: { x: 1, y: 2, z: -0.2 } });
    state().setTracing(true);
    state().appendTrace({ x: 0, y: 1, z: 2 });
    state().appendTrace({ x: 0, y: 1, z: 3 });
    expect(state().tracePath).toEqual([
      { x: 0, y: 1, z: 2 },
      { x: 0, y: 1, z: 3 },
    ]);
    state().setTracing(false);
    expect(state().tracePath).toEqual([]);
  });
});
