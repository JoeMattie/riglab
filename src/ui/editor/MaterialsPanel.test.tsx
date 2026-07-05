// @vitest-environment jsdom
// Component tests for the materials editor + nesting matrix (§6.1, §11):
// edits write through to the document, numeric edits clear the approximate
// badge, editing an outer pipe's ID flips a pair's classification live, and
// referenced materials cannot be deleted.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../../bom/testHelpers';
import type { LinkElement, Project } from '../../schema';
import { createEmptyProject } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { MaterialsPanel } from './MaterialsPanel';

function project(): Project {
  const link: LinkElement = {
    id: 'L1',
    type: 'link',
    maturity: 'engineered',
    nodeA: 'n1',
    nodeB: 'n2',
    pointMasses: [],
    pipeMaterialId: 'PA',
  };
  return {
    ...createEmptyProject('p1', 'test'),
    unitsPreference: 'metric', // SI in the fields below
    materials: testMaterials(),
    mechanism: mech([link], [node('n1', 0, 0), node('n2', 3, 4)]),
  };
}

const doc = () => useAppStore.getState().current!;

beforeEach(() => {
  useAppStore.setState({ current: project() });
});

afterEach(cleanup);

describe('MaterialsPanel', () => {
  it('renders a row per pipe, with no approximate badge (removed by decision)', () => {
    render(<MaterialsPanel />);
    expect(screen.getAllByTestId('pipe-row')).toHaveLength(5);
    expect(screen.queryByTestId('material-approx-badge')).toBeNull();
  });

  it('numeric edit writes through and clears the approximate flag', () => {
    render(<MaterialsPanel />);
    const paDensity = screen.getAllByTestId('pipe-density')[0]!; // PA is first
    fireEvent.change(paDensity, { target: { value: '0.42' } });
    fireEvent.blur(paDensity);
    const pa = doc().materials.pipes.find((p) => p.id === 'PA')!;
    expect(pa.linearDensityKgPerM).toBe(0.42);
    expect(pa.approximate).toBe(false);
  });

  it('editing an outer pipe ID flips the pair classification in the matrix (§11)', () => {
    render(<MaterialsPanel />);
    // TO over TI: ID 23.3 mm − OD 22 mm = 1.3 mm → slip
    expect(screen.getByTestId('nesting-cell-TO-TI').getAttribute('data-fit')).toBe('slip');
    // measure TO's ID at 22.3 mm → clearance 0.3 mm → snug
    const toId = screen.getAllByTestId('pipe-id')[2]!; // pipes order: PA, PB, TO, ...
    fireEvent.change(toId, { target: { value: '0.0223' } });
    fireEvent.blur(toId);
    expect(screen.getByTestId('nesting-cell-TO-TI').getAttribute('data-fit')).toBe('snug');
  });

  it('disables delete for referenced materials, allows it for unreferenced ones', () => {
    render(<MaterialsPanel />);
    const pipeRows = screen.getAllByTestId('pipe-row');
    const deleteOf = (row: HTMLElement) =>
      row.querySelector('[data-testid="material-delete"]') as HTMLButtonElement;
    expect(deleteOf(pipeRows[0]!).disabled).toBe(true); // PA referenced by L1
    expect(deleteOf(pipeRows[1]!).disabled).toBe(false); // PB unreferenced
    fireEvent.click(deleteOf(pipeRows[1]!));
    expect(doc().materials.pipes.some((p) => p.id === 'PB')).toBe(false);
  });

  it('adds a new pipe row flagged approximate', () => {
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByTestId('add-pipe'));
    expect(doc().materials.pipes).toHaveLength(6);
    expect(doc().materials.pipes[5]!.approximate).toBe(true);
  });

  it('edits bom settings and the generic density', () => {
    render(<MaterialsPanel />);
    const waste = screen.getByTestId('bom-waste');
    fireEvent.change(waste, { target: { value: '1.4' } });
    fireEvent.blur(waste);
    expect(doc().bomSettings.ropeWasteFactor).toBe(1.4);
    const generic = screen.getByTestId('generic-density');
    fireEvent.change(generic, { target: { value: '0.3' } });
    fireEvent.blur(generic);
    expect(doc().materials.genericPipeLinearDensityKgPerM).toBe(0.3);
  });
});
