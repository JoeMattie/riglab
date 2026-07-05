// @vitest-environment jsdom
// Walk clip default + global spacebar toggle (PLANFILE-walk-default-spacebar):
// the transport pre-selects the bundled walk clip, and space toggles playback
// via the window-level shortcut regardless of what has focus.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// the quad workspace hosts Konva + WebGL canvases that jsdom can't create;
// these tests exercise the shell's transport shortcuts, not the panels
vi.mock('./quad/QuadView', () => ({ QuadView: () => <div data-testid="quad-stub" /> }));

import { createEmptyProject } from '../schema';
import { useAppStore } from '../state/appStore';
import { DEFAULT_CLIP_NAME, useEditorStore } from '../state/editorStore';
import { getClip } from '../wearer';
import { EditorShell } from './EditorShell';

// jsdom has no ResizeObserver; the canvas containers observe their size
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

beforeEach(() => {
  useAppStore.setState({ current: createEmptyProject('p1', 'test') });
  useEditorStore.setState({
    playback: { ...useEditorStore.getInitialState().playback },
  });
});

afterEach(cleanup);

describe('default clip', () => {
  it('pre-selects the walk clip, and it resolves to a bundled clip', () => {
    const initial = useEditorStore.getInitialState().playback;
    expect(initial.clipName).toBe(DEFAULT_CLIP_NAME);
    expect(initial.playing).toBe(false);
    expect(DEFAULT_CLIP_NAME).toBe('walk');
    expect(getClip(DEFAULT_CLIP_NAME)).toBeDefined();
  });
});

describe('spacebar transport toggle', () => {
  it('toggles play/pause from a window-level keydown', () => {
    render(<EditorShell />);
    fireEvent.keyDown(window, { key: ' ' });
    expect(useEditorStore.getState().playback.playing).toBe(true);
    expect(useEditorStore.getState().playback.clipName).toBe(DEFAULT_CLIP_NAME);
    fireEvent.keyDown(window, { key: ' ' });
    expect(useEditorStore.getState().playback.playing).toBe(false);
  });

  it('starts the default clip when the rest pose is selected', () => {
    render(<EditorShell />);
    useEditorStore.getState().setPlayback({ clipName: null, tS: 3, playing: false });
    fireEvent.keyDown(window, { key: ' ' });
    const { playback } = useEditorStore.getState();
    expect(playback.clipName).toBe(DEFAULT_CLIP_NAME);
    expect(playback.playing).toBe(true);
    expect(playback.tS).toBe(0);
  });

  it('ignores OS key-repeat while space is held (pan modifier)', () => {
    render(<EditorShell />);
    fireEvent.keyDown(window, { key: ' ', repeat: true });
    expect(useEditorStore.getState().playback.playing).toBe(false);
  });

  it('leaves space alone while typing in a field', () => {
    render(<EditorShell />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: ' ' });
    expect(useEditorStore.getState().playback.playing).toBe(false);
    input.remove();
  });
});
