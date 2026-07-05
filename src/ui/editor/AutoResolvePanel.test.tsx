// @vitest-environment jsdom
// Auto-resolve UI flow (PLANFILE-marquee-autoresolve.md): run → preview →
// per-row dismiss → apply-in-one-undo-step, plus the stale-proposal guard and
// the selection-scoped entry point in the multi-inspector.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../../bom/testHelpers';
import type { LinkElement, PivotElement, Project } from '../../schema';
import { createEmptyProject } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { ChecklistPanel } from './ChecklistPanel';
import { MultiInspector } from './infopanel/MultiInspector';

// TO ⊃ TI is the one slip pair in testMaterials (clearance 1.3 mm)
const link = (id: string, a: string, b: string, pipeMaterialId?: string): LinkElement => ({
  id,
  type: 'link',
  maturity: pipeMaterialId ? 'engineered' : 'sketch',
  nodeA: a,
  nodeB: b,
  pipeMaterialId,
  pointMasses: [],
});
const pivot = (id: string, nodeId: string, memberIds: string[]): PivotElement => ({
  id,
  type: 'pivot',
  maturity: 'sketch',
  nodeId,
  memberIds,
  welds: [],
});

function project(elements: Array<LinkElement | PivotElement>): Project {
  const p = createEmptyProject('p1', 'test');
  return {
    ...p,
    materials: testMaterials(),
    mechanisms: [mech(elements, [node('n1', 0, 0), node('n2', 1, 0), node('n3', 2, 0)])],
  };
}

const els = () => useAppStore.getState().current!.mechanisms[0]!.elements;

beforeEach(() => {
  useAppStore.setState({
    current: project([
      link('L1', 'n1', 'n2'),
      link('L2', 'n2', 'n3', 'TO'),
      pivot('P1', 'n2', ['L1', 'L2']),
    ]),
  });
  useEditorStore.setState({
    activeMechanismId: 'm1',
    rightTab: 'checklist',
    autoProposal: null,
    selectedElementIds: [],
  });
});
afterEach(cleanup);

describe('AutoResolvePanel in the checklist', () => {
  it('run shows a preview; apply commits every row and clears the preview', () => {
    render(<ChecklistPanel />);
    fireEvent.click(screen.getByTestId('auto-resolve-run'));
    // L1 resized to slip-fit TO, the pivot nests, the inner end takes overlap
    expect(screen.getAllByTestId('auto-resolve-change')).toHaveLength(3);

    fireEvent.click(screen.getByTestId('auto-resolve-apply'));
    const l1 = els().find((e) => e.id === 'L1') as LinkElement;
    const p1 = els().find((e) => e.id === 'P1') as PivotElement;
    expect(l1.pipeMaterialId).toBe('TI');
    expect(l1.endRealizationB).toBe('nestedSleeve');
    expect(p1.realization).toBe('nestedSleeve');
    expect(screen.queryByTestId('auto-resolve-preview')).toBeNull();
    // the run button is back for the next round
    expect(screen.getByTestId('auto-resolve-run')).toBeTruthy();
  });

  it('a dismissed row is not applied', () => {
    render(<ChecklistPanel />);
    fireEvent.click(screen.getByTestId('auto-resolve-run'));
    // dismiss the pipe-material row (the first change)
    fireEvent.click(screen.getAllByTestId('auto-resolve-dismiss')[0]!);
    expect(screen.getAllByTestId('auto-resolve-change')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('auto-resolve-apply'));
    expect((els().find((e) => e.id === 'L1') as LinkElement).pipeMaterialId).toBeUndefined();
  });

  it('any document edit makes the preview withdraw instead of applying stale changes', () => {
    render(<ChecklistPanel />);
    fireEvent.click(screen.getByTestId('auto-resolve-run'));
    expect(screen.getByTestId('auto-resolve-preview')).toBeTruthy();
    act(() => useAppStore.getState().updateCurrent((d) => ({ ...d })));
    expect(screen.queryByTestId('auto-resolve-preview')).toBeNull();
    expect(screen.getByTestId('auto-resolve-run')).toBeTruthy();
  });

  it('re-solve opt-in proposes replacing assignments a plain run leaves alone', () => {
    const p1 = pivot('P1', 'n2', ['L1', 'L2']);
    p1.realization = 'boltThrough';
    useAppStore.setState({
      current: project([link('L1', 'n1', 'n2', 'PA'), link('L2', 'n2', 'n3', 'TO'), p1]),
    });
    render(<ChecklistPanel />);
    fireEvent.click(screen.getByTestId('auto-resolve-run'));
    expect(screen.getByText('Nothing to auto-resolve')).toBeTruthy();
    fireEvent.click(screen.getByTestId('auto-resolve-cancel'));

    fireEvent.click(screen.getByTestId('auto-resolve-reassign'));
    fireEvent.click(screen.getByTestId('auto-resolve-run'));
    const rows = screen.getAllByTestId('auto-resolve-change');
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('auto-resolve-apply'));
    expect((els().find((e) => e.id === 'P1') as PivotElement).realization).toBe('nestedSleeve');
  });
});

describe('MultiInspector entry point', () => {
  it('scopes the proposal to the selection and hands over to the checklist tab', () => {
    const doc = useAppStore.getState().current!;
    const m = doc.mechanisms[0]!;
    useEditorStore.setState({ rightTab: 'inspector' });
    render(
      <MultiInspector
        doc={doc}
        mech={m}
        els={m.elements.filter((e) => e.id === 'L1')}
        face="design"
      />,
    );
    fireEvent.click(screen.getByTestId('auto-resolve-selection'));
    const proposal = useEditorStore.getState().autoProposal;
    expect(proposal).not.toBeNull();
    expect(proposal!.changes.every((c) => c.elementId === 'L1')).toBe(true);
    expect(useEditorStore.getState().rightTab).toBe('checklist');
  });
});
