// @vitest-environment jsdom
// Component tests for the info panel's logic (§8.2a, test-pyramid rule):
// selection → correct fields, edits → document updated, multi-select →
// shared/bulk properties, connections → selection navigation. Rendering
// pixel details and Radix dropdown interaction are NOT asserted — the
// assignment ops themselves are unit-tested in docOps.design.test.ts.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../../../bom/testHelpers';
import type { LinkElement, PivotElement, Project, RopeElement } from '../../../schema';
import { createEmptyProject } from '../../../schema';
import { useAppStore } from '../../../state/appStore';
import { useEditorStore } from '../../../state/editorStore';
import { InfoPanel } from './InfoPanel';

const L1: LinkElement = {
  id: 'L1',
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
};
const L2: LinkElement = {
  ...L1,
  id: 'L2',
  nodeA: 'n2',
  nodeB: 'n3',
  pipeMaterialId: 'PA',
  maturity: 'engineered',
};
const P1: PivotElement = {
  id: 'P1',
  type: 'pivot',
  maturity: 'sketch',
  nodeId: 'n2',
  memberIds: ['L1', 'L2'],
  welds: [],
};
const R1: RopeElement = {
  id: 'R1',
  type: 'rope',
  maturity: 'sketch',
  path: ['n1', 'n3'],
  lengthM: 2,
};

function project(): Project {
  const p = createEmptyProject('p1', 'test');
  return {
    ...p,
    // metric so the assertions below read in the stored SI values; the
    // imperial display path is asserted separately at the end of this file
    unitsPreference: 'metric',
    materials: testMaterials(),
    mechanisms: [
      mech([L1, L2, P1, R1], [node('n1', 0, 0), node('n2', 3, 4), node('n3', 6, 4)], {
        inputs: [
          {
            id: 'ch1',
            name: 'steer',
            kind: 'angle' as const,
            min: 0,
            max: 1,
            value: 0,
            locked: false,
          },
        ],
      }),
    ],
  };
}

const doc = () => useAppStore.getState().current!;
const mech0 = () => doc().mechanisms[0]!;

beforeEach(() => {
  useAppStore.setState({ current: project() });
  useEditorStore.setState({
    activeMechanismId: 'm1',
    face: 'sketch',
    selectedElementIds: [],
    dof: { dof: 1, classification: 'mechanism' },
  });
});

afterEach(cleanup);

describe('empty selection', () => {
  it('shows the mechanism summary: DOF, element counts, gravity, unbound channels', () => {
    render(<InfoPanel />);
    expect(screen.getByTestId('mechanism-summary')).toBeTruthy();
    expect(screen.getByTestId('summary-dof').textContent).toContain('1 · mechanism');
    expect(screen.getByText('link').nextSibling?.textContent).toBe('2');
    expect(screen.getByTestId('unbound-channel').textContent).toContain('steer');
    expect(screen.queryByTestId('summary-weight')).toBeNull(); // sketch face: no weight
  });

  it('adds weight total and resolution progress in the design face', () => {
    useEditorStore.setState({ face: 'design' });
    render(<InfoPanel />);
    // only L2 carries a material: 3 m (n2→n3) × 0.5 kg/m
    expect(screen.getByTestId('summary-weight').textContent).toBe('1.5 kg');
    // slots: L1, L2, P1, ch1 → resolved: L2 only
    expect(screen.getByTestId('summary-progress').textContent).toBe('1 of 4 items');
  });
});

describe('single selection', () => {
  it('link: geometry + no engineering fields in the sketch face', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'] });
    render(<InfoPanel />);
    expect(screen.getByTestId('element-inspector')).toBeTruthy();
    expect((screen.getByTestId('length-field') as HTMLInputElement).value).toBe('5'); // (0,0)–(3,4)
    expect(screen.queryByTestId('material-select')).toBeNull();
    expect(screen.queryByTestId('unresolved-item')).toBeNull();
  });

  it('link in the design face: material select, unresolved item, maturity badge', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'], face: 'design' });
    render(<InfoPanel />);
    expect(screen.getByTestId('material-select')).toBeTruthy();
    expect(screen.getByTestId('unresolved-item').textContent).toContain('pipe material');
    expect(screen.getByTestId('maturity-badge').textContent).toBe('sketch');
  });

  it('engineered link shows computed mass and no unresolved items', () => {
    useEditorStore.setState({ selectedElementIds: ['L2'], face: 'design' });
    render(<InfoPanel />);
    expect(screen.getByTestId('maturity-badge').textContent).toBe('engineered');
    expect(screen.getByTestId('element-mass').textContent).toBe('1.5 kg'); // 3 m × 0.5 kg/m
    expect(screen.queryByTestId('unresolved-item')).toBeNull();
  });

  it('editing the link length moves endpoint B along the current direction', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'] });
    render(<InfoPanel />);
    const field = screen.getByTestId('length-field') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '10' } });
    fireEvent.blur(field);
    const n2 = mech0().nodes.find((n) => n.id === 'n2')!;
    expect(n2.position.x).toBeCloseTo(6, 9);
    expect(n2.position.y).toBeCloseTo(8, 9);
    // endpoint A stays put
    expect(mech0().nodes.find((n) => n.id === 'n1')!.position).toEqual({ x: 0, y: 0 });
  });

  it('editing rope L₀ writes through to the document', () => {
    useEditorStore.setState({ selectedElementIds: ['R1'] });
    render(<InfoPanel />);
    const field = screen.getByTestId('rope-l0-field') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '3.5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);
    expect(mech0().elements.find((e) => e.id === 'R1')).toMatchObject({ lengthM: 3.5 });
  });

  it('pivot: joint fields and a realization select in the design face', () => {
    useEditorStore.setState({ selectedElementIds: ['P1'], face: 'design' });
    render(<InfoPanel />);
    expect(screen.getByTestId('realization-select')).toBeTruthy();
    expect(screen.getByTestId('unresolved-item').textContent).toContain('realization');
  });

  it('connections are clickable and navigate the selection', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'] });
    render(<InfoPanel />);
    const links = screen.getAllByTestId('connection-link');
    const pivotLink = links.find((b) => b.textContent?.includes('pivot'))!;
    fireEvent.click(pivotLink);
    expect(useEditorStore.getState().selectedElementIds).toEqual(['P1']);
  });
});

describe('multi-selection', () => {
  it('shows the selection composition and bulk assignment in the design face', () => {
    useEditorStore.setState({ selectedElementIds: ['L1', 'L2', 'R1'], face: 'design' });
    render(<InfoPanel />);
    expect(screen.getByTestId('selection-count').textContent).toBe('3 elements');
    expect(screen.getByTestId('bulk-material-select')).toBeTruthy();
    expect(screen.getByTestId('bulk-cordage-select')).toBeTruthy();
    expect(screen.queryByTestId('bulk-realization-select')).toBeNull(); // no joints selected
  });

  it('hides bulk assignment in the sketch face', () => {
    useEditorStore.setState({ selectedElementIds: ['L1', 'L2'] });
    render(<InfoPanel />);
    expect(screen.getByTestId('multi-inspector')).toBeTruthy();
    expect(screen.queryByTestId('bulk-material-select')).toBeNull();
  });
});

describe('units preference (§3: conversion at the display boundary only)', () => {
  it('imperial projects display and edit lengths in inches, storing metres', () => {
    useAppStore.setState({ current: { ...project(), unitsPreference: 'imperial' } });
    useEditorStore.setState({ selectedElementIds: ['L1'] });
    render(<InfoPanel />);
    // 5 m link (0,0)–(3,4) displays as inches
    const field = screen.getByTestId('length-field') as HTMLInputElement;
    expect(Number(field.value)).toBeCloseTo(5 / 0.0254, 3);
    // typing 100 in commits 2.54 m to the document
    fireEvent.change(field, { target: { value: '100' } });
    fireEvent.blur(field);
    const n2 = mech0().nodes.find((n) => n.id === 'n2')!;
    expect(Math.hypot(n2.position.x, n2.position.y)).toBeCloseTo(2.54, 9);
  });

  it('imperial projects show mass in pounds', () => {
    useAppStore.setState({ current: { ...project(), unitsPreference: 'imperial' } });
    useEditorStore.setState({ selectedElementIds: ['L2'], face: 'design' });
    render(<InfoPanel />);
    // 1.5 kg = 3.31 lb
    expect(screen.getByTestId('element-mass').textContent).toBe('3.31 lb');
  });
});

describe('panel chrome', () => {
  // the standalone collapse rail was removed by the interface overhaul — the
  // panel now always lives embedded in the design-face dock
  it('ignores stale selection ids of deleted elements', () => {
    useEditorStore.setState({ selectedElementIds: ['gone'] });
    render(<InfoPanel />);
    expect(screen.getByTestId('mechanism-summary')).toBeTruthy();
  });
});
