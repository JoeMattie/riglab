// @vitest-environment jsdom
// Top-bar panel visibility toggles (PLANFILE-quad-panel-controls B): buttons
// reflect + flip store state, and the refused last-panel toggle stays on.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../state/editorStore';
import { PanelToggleChip } from './PanelToggleChip';

beforeEach(() => {
  useEditorStore.setState({
    panelsVisible: { top: true, persp: true, front: true, side: true },
    quadMaximized: null,
    activePanel: 'side',
  });
});

afterEach(cleanup);

describe('PanelToggleChip', () => {
  it('shows one pressed toggle per panel', () => {
    render(<PanelToggleChip />);
    for (const id of ['top', 'persp', 'front', 'side']) {
      expect(screen.getByTestId(`panel-toggle-${id}`)).toHaveProperty('ariaPressed', 'true');
    }
  });

  it('clicking hides/shows the panel and reflects aria-pressed', () => {
    render(<PanelToggleChip />);
    const persp = screen.getByTestId('panel-toggle-persp');
    fireEvent.click(persp);
    expect(useEditorStore.getState().panelsVisible.persp).toBe(false);
    expect(persp).toHaveProperty('ariaPressed', 'false');
    fireEvent.click(persp);
    expect(useEditorStore.getState().panelsVisible.persp).toBe(true);
    expect(persp).toHaveProperty('ariaPressed', 'true');
  });

  it('the Iso button swaps the workspace to the single-panel isometric view', () => {
    render(<PanelToggleChip />);
    const iso = screen.getByTestId('workspace-iso-toggle');
    fireEvent.click(iso);
    expect(useEditorStore.getState().workspaceMode).toBe('iso');
    expect(useEditorStore.getState().activePanel).toBe('iso');
    fireEvent.click(screen.getByTestId('workspace-iso-toggle'));
    expect(useEditorStore.getState().workspaceMode).toBe('quad');
    expect(useEditorStore.getState().activePanel).not.toBe('iso');
  });

  it('the last visible panel refuses to toggle off and stays pressed', () => {
    useEditorStore.setState({
      panelsVisible: { top: false, persp: false, front: false, side: true },
    });
    render(<PanelToggleChip />);
    const side = screen.getByTestId('panel-toggle-side');
    fireEvent.click(side);
    expect(useEditorStore.getState().panelsVisible.side).toBe(true);
    expect(side).toHaveProperty('ariaPressed', 'true');
  });
});
