// @vitest-environment jsdom
// Component tests for the resolution checklist (§8.2): items render from the
// pure resolution module, click-to-fix selects the element / switches the
// dock tab / drops the one-shot focus hint, and zero items reads "buildable".
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../../bom/testHelpers';
import type { LinkElement, PivotElement, Project } from '../../schema';
import { createEmptyProject } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { ChecklistPanel } from './ChecklistPanel';

const L1: LinkElement = {
  id: 'L1',
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
};
const P1: PivotElement = {
  id: 'P1',
  type: 'pivot',
  maturity: 'sketch',
  nodeId: 'n2',
  joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
  memberIds: ['L1'],
  welds: [],
};

function project(elements: Array<LinkElement | PivotElement>, inputs = false): Project {
  const p = createEmptyProject('p1', 'test');
  return {
    ...p,
    materials: testMaterials(),
    mechanism: mech(elements, [node('n1', 0, 0), node('n2', 3, 4)], {
      inputs: inputs
        ? [{ id: 'ch1', name: 'steer', kind: 'angle', min: 0, max: 1, value: 0, locked: false }]
        : [],
    }),
  };
}

beforeEach(() => {
  useAppStore.setState({ current: project([L1, P1], true) });
  useEditorStore.setState({
    face: 'design',
    rightTab: 'checklist',
    focusHint: null,
    selectedElementIds: [],
    dof: { dof: 1, classification: 'mechanism' },
  });
});

afterEach(cleanup);

describe('ChecklistPanel', () => {
  it('lists every unresolved item with the progress count', () => {
    render(<ChecklistPanel />);
    const items = screen.getAllByTestId('checklist-item');
    const kinds = items.map((i) => i.getAttribute('data-kind'));
    expect(kinds).toContain('missingMaterial');
    expect(kinds).toContain('missingRealization');
    expect(kinds).toContain('unboundChannel');
    // slots: L1 material, P1 realization, ch1 binding → none resolved
    expect(screen.getByTestId('checklist-progress').textContent).toBe('0 of 3 resolved');
    expect(screen.queryByTestId('checklist-buildable')).toBeNull();
  });

  it('click-to-fix on an element item selects it, opens the inspector, sets the hint', () => {
    render(<ChecklistPanel />);
    const material = screen
      .getAllByTestId('checklist-item')
      .find((i) => i.getAttribute('data-kind') === 'missingMaterial')!;
    fireEvent.click(material);
    const s = useEditorStore.getState();
    expect(s.selectedElementIds).toEqual(['L1']);
    expect(s.rightTab).toBe('inspector');
    expect(s.focusHint).toEqual({ control: 'material' });
  });

  it('click-to-fix on an unbound channel drops a channel hint with the id', () => {
    render(<ChecklistPanel />);
    const channel = screen
      .getAllByTestId('checklist-item')
      .find((i) => i.getAttribute('data-kind') === 'unboundChannel')!;
    fireEvent.click(channel);
    expect(useEditorStore.getState().focusHint).toEqual({ control: 'channel', channelId: 'ch1' });
    // no element to select; the dock tab stays put
    expect(useEditorStore.getState().selectedElementIds).toEqual([]);
  });

  it('reads "buildable" when nothing is unresolved', () => {
    const engineered: LinkElement = { ...L1, pipeMaterialId: 'PA', maturity: 'engineered' };
    useAppStore.setState({ current: project([engineered]) });
    render(<ChecklistPanel />);
    expect(screen.getByTestId('checklist-buildable')).toBeTruthy();
    expect(screen.getByTestId('checklist-progress').textContent).toBe('1 of 1 resolved');
  });
});
