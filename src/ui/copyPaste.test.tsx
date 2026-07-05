// @vitest-environment jsdom
// Copy/paste wiring (PLANFILE-quad-panel-controls C): ⌘C/⌘V through the
// EditorShell window shortcut, the ActionsChip buttons, the active-panel
// paste offset, and one-undo-step paste. The remap correctness itself is
// covered in src/state/clipboard.test.ts.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// the quad workspace hosts Konva + WebGL canvases that jsdom can't create;
// these tests exercise the shell's clipboard shortcuts, not the panels
vi.mock('./quad/QuadView', () => ({ QuadView: () => <div data-testid="quad-stub" /> }));

import { mech, node, projectWith } from '../design/testFixtures';
import type { LinkElement, Project } from '../schema';
import { useAppStore } from '../state/appStore';
import { useEditorStore } from '../state/editorStore';
import { EditorShell } from './EditorShell';
import { ActionsChip } from './editor/ActionsChip';
import { pasteOffset } from './editor/clipboardActions';
import { PANEL_FRAME } from './quad/panelProject';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const L1: LinkElement = {
  id: 'L1',
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
};

function project(): Project {
  return projectWith(mech([L1], [node('n1', 0, 0), node('n2', 1, 0)]));
}

beforeEach(() => {
  useAppStore.setState({ current: project(), saveState: 'saved' });
  useAppStore.temporal.getState().clear();
  useEditorStore.setState({ selectedElementIds: [], clipboard: null, activePanel: 'side' });
});

afterEach(cleanup);

const doc = () => useAppStore.getState().current!;
const ed = () => useEditorStore.getState();

describe('keyboard copy/paste', () => {
  it('⌘C captures the selection; ⌘V pastes a fresh copy and selects it', () => {
    render(<EditorShell />);
    ed().setSelection(['L1']);
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    expect(ed().clipboard?.elements.map((e) => e.id)).toEqual(['L1']);
    fireEvent.keyDown(window, { key: 'v', metaKey: true });
    expect(doc().mechanism.elements).toHaveLength(2);
    const newId = ed().selectedElementIds[0]!;
    expect(newId).not.toBe('L1');
    expect(doc().mechanism.elements.some((e) => e.id === newId)).toBe(true);
  });

  it('⌘C with nothing selected leaves the clipboard alone; ⌘V with an empty clipboard is a no-op', () => {
    render(<EditorShell />);
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    expect(ed().clipboard).toBeNull();
    fireEvent.keyDown(window, { key: 'v', metaKey: true });
    expect(doc().mechanism.elements).toHaveLength(1);
  });

  it('typing targets are exempt (native copy/paste in inputs still works)', () => {
    render(
      <div>
        <EditorShell />
        <input data-testid="field" />
      </div>,
    );
    ed().setSelection(['L1']);
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'c', metaKey: true });
    expect(ed().clipboard).toBeNull();
  });

  it('paste is ONE undo step', () => {
    render(<EditorShell />);
    ed().setSelection(['L1']);
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });
    expect(doc().mechanism.elements).toHaveLength(2);
    useAppStore.getState().undo();
    expect(doc().mechanism.elements).toHaveLength(1);
    expect(doc().mechanism.elements[0]!.id).toBe('L1');
  });
});

describe('paste offset', () => {
  it('lands ~10 cm down-right in the active panel plane; perspective falls back to side', () => {
    for (const [panel, frame] of [
      ['top', PANEL_FRAME.top],
      ['front', PANEL_FRAME.front],
      ['side', PANEL_FRAME.side],
      ['persp', PANEL_FRAME.side],
    ] as const) {
      const o = pasteOffset(panel);
      expect(o.x).toBeCloseTo(0.1 * (frame.xAxis.x - frame.yAxis.x), 12);
      expect(o.y).toBeCloseTo(0.1 * (frame.xAxis.y - frame.yAxis.y), 12);
      expect(o.z).toBeCloseTo(0.1 * (frame.xAxis.z - frame.yAxis.z), 12);
    }
  });

  it('pasting offsets the copy in the active panel plane', () => {
    render(<EditorShell />);
    useEditorStore.setState({ activePanel: 'top' });
    ed().setSelection(['L1']);
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });
    const copy = doc().mechanism.elements.find(
      (e): e is LinkElement => e.type === 'link' && e.id !== 'L1',
    )!;
    const a = doc().mechanism.nodes.find((n) => n.id === copy.nodeA)!;
    const expected = pasteOffset('top');
    expect(a.position.x).toBeCloseTo(0 + expected.x, 12);
    expect(a.position.y).toBeCloseTo(0 + expected.y, 12);
    expect(a.position.z).toBeCloseTo(0 + expected.z, 12);
  });
});

describe('ActionsChip buttons', () => {
  it('copy/paste buttons mirror the shortcuts and disable when inapplicable', () => {
    render(<ActionsChip />);
    const copy = screen.getByTestId('copy-selection') as HTMLButtonElement;
    const paste = screen.getByTestId('paste-clipboard') as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    expect(paste.disabled).toBe(true);

    act(() => ed().setSelection(['L1']));
    expect(copy.disabled).toBe(false);
    fireEvent.click(copy);
    expect(ed().clipboard?.elements.map((e) => e.id)).toEqual(['L1']);
    expect(paste.disabled).toBe(false);
    fireEvent.click(paste);
    expect(doc().mechanism.elements).toHaveLength(2);
    expect(ed().selectedElementIds).toHaveLength(1);
    expect(ed().selectedElementIds[0]).not.toBe('L1');
  });
});
