// @vitest-environment jsdom
// Groups UI (PLANFILE-3d-conversion.md): create-from-selection, rename,
// click-to-select-members, delete, and migration-note surfacing/dismissal.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mech, node, proj } from '../../../bom/testHelpers';
import type { LinkElement } from '../../../schema';
import { useAppStore } from '../../../state/appStore';
import { useEditorStore } from '../../../state/editorStore';
import { GroupsSection } from './GroupsSection';

const link = (id: string, a: string, b: string): LinkElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA: a,
  nodeB: b,
  pointMasses: [],
});

beforeEach(() => {
  useAppStore.setState({
    current: proj(
      mech(
        [link('L1', 'n1', 'n2'), link('L2', 'n2', 'n3')],
        [node('n1', 0, 0), node('n2', 1, 0), node('n3', 2, 0)],
      ),
    ),
  });
  useEditorStore.setState({ selectedElementIds: [] });
});

afterEach(cleanup);

const doc = () => useAppStore.getState().current!;

describe('GroupsSection', () => {
  it('creates a group from the current selection', () => {
    useEditorStore.setState({ selectedElementIds: ['L1', 'L2'] });
    render(<GroupsSection />);
    fireEvent.click(screen.getByTestId('group-create'));
    expect(doc().groups).toHaveLength(1);
    expect(doc().groups[0]!.elementIds).toEqual(['L1', 'L2']);
  });

  it('create is disabled with nothing selected', () => {
    render(<GroupsSection />);
    expect((screen.getByTestId('group-create') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renames inline, selects members on click, and deletes without touching elements', () => {
    useAppStore.setState({
      current: {
        ...doc(),
        groups: [{ id: 'g1', name: 'leg', elementIds: ['L1'] }],
      },
    });
    render(<GroupsSection />);
    fireEvent.change(screen.getByTestId('group-name-input'), { target: { value: 'left leg' } });
    expect(doc().groups[0]!.name).toBe('left leg');
    fireEvent.click(screen.getByTestId('group-select'));
    expect(useEditorStore.getState().selectedElementIds).toEqual(['L1']);
    fireEvent.click(screen.getByTestId('group-delete'));
    expect(doc().groups).toHaveLength(0);
    expect(doc().mechanism.elements).toHaveLength(2);
  });

  it('surfaces a migration note and dismisses it', () => {
    useAppStore.setState({
      current: {
        ...doc(),
        groups: [
          {
            id: 'g1',
            name: 'neck',
            elementIds: ['L1'],
            note: 're-joint needed: former driven plane',
          },
        ],
      },
    });
    render(<GroupsSection />);
    expect(screen.getByTestId('group-note').textContent).toContain('re-joint needed');
    fireEvent.click(screen.getByTestId('group-note-dismiss'));
    expect(doc().groups[0]!.note).toBeUndefined();
  });
});
