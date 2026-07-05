// @vitest-environment jsdom
// Component tests for the interface-overhaul chrome (test-pyramid rule:
// behavior assertable against components stays in Vitest, not e2e):
// tool pill + shortcuts, dimension chips (edit/lock), joint popover
// (type change), selection card (pipe rows, delete), transport pill
// (gravity/forces chips), and the DOF pill conflict list.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../../bom/testHelpers';
import type { LinkElement, Project, RopeElement } from '../../schema';
import { createEmptyProject } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { DimensionChips } from './DimensionChips';
import { DofPill } from './DofPill';
import { JointPopover } from './JointPopover';
import { SelectionCard } from './SelectionCard';
import { ToolPill } from './ToolPill';
import { TransportPill } from './TransportPill';
import { initialView } from './viewTransform';

const L1: LinkElement = {
  id: 'L1',
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
};
const L2: LinkElement = { ...L1, id: 'L2', nodeA: 'n2', nodeB: 'n3' };
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
    unitsPreference: 'metric',
    materials: testMaterials(),
    mechanisms: [mech([L1, L2, R1], [node('n1', 0, 0), node('n2', 3, 4), node('n3', 6, 4)])],
  };
}

const doc = () => useAppStore.getState().current!;
const mech0 = () => doc().mechanisms[0]!;
const view = () => initialView(800, 600);
const positions = () => {
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of mech0().nodes) out[n.id] = n.position;
  return out;
};

beforeEach(() => {
  useAppStore.setState({ current: project() });
  useEditorStore.setState({
    activeMechanismId: 'm1',
    tool: 'select',
    face: 'sketch',
    selectedElementIds: [],
    openPopover: null,
    lengthEdit: null,
    pendingConnect: null,
    dof: { dof: 1, classification: 'mechanism' },
    violated: [],
  });
});

afterEach(cleanup);

describe('ToolPill', () => {
  it('clicking a row selects the tool; single-key shortcuts switch tools', () => {
    render(<ToolPill />);
    fireEvent.click(screen.getByTestId('tool-pipe'));
    expect(useEditorStore.getState().tool).toBe('pipe');
    fireEvent.keyDown(window, { key: 'r' });
    expect(useEditorStore.getState().tool).toBe('rope');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useEditorStore.getState().tool).toBe('select');
  });

  it('drags by its grip handle', () => {
    render(<ToolPill />);
    const pill = screen.getByTestId('tool-pill');
    const before = { left: pill.style.left, top: pill.style.top };
    const handle = screen.getByTestId('tool-pill-handle');
    fireEvent.pointerDown(handle, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 130, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(pill.style.left).not.toBe(before.left);
    expect(pill.style.top).not.toBe(before.top);
  });

  it('shortcuts are ignored while typing and for modifier chords', () => {
    render(
      <>
        <input data-testid="field" />
        <ToolPill />
      </>,
    );
    const field = screen.getByTestId('field');
    field.focus();
    fireEvent.keyDown(field, { key: 'p' });
    expect(useEditorStore.getState().tool).toBe('select');
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    expect(useEditorStore.getState().tool).toBe('select');
  });
});

describe('DimensionChips', () => {
  const renderChips = () =>
    render(
      <DimensionChips
        doc={doc()}
        mech={mech0()}
        view={view()}
        positions={positions()}
        hoveredElementId={null}
        endpointDrag={null}
      />,
    );

  it('shows an editable chip for the selected pipe; typing a value commits it', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'] });
    renderChips();
    // click without movement opens the inline edit
    const chip = screen.getByTestId('length-chip-value');
    fireEvent.pointerDown(chip, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(chip, { clientX: 100, pointerId: 1 });
    const input = screen.getByTestId('length-input') as HTMLInputElement;
    expect(input.value).toBe('5'); // (0,0)–(3,4) = 5 m
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const n2 = mech0().nodes.find((n) => n.id === 'n2')!;
    expect(Math.hypot(n2.position.x, n2.position.y)).toBeCloseTo(10, 9);
  });

  it('the lock button pins the length; locked pipes render the solid chip', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'] });
    const r = renderChips();
    fireEvent.click(screen.getByTestId('length-lock-toggle'));
    expect(mech0().elements.find((e) => e.id === 'L1')).toMatchObject({ lengthLocked: true });
    r.unmount();
    useEditorStore.setState({ selectedElementIds: [] });
    renderChips(); // locked chip shows even without a selection
    expect(screen.getByTestId('length-chip-locked')).toBeTruthy();
  });

  it('hovering an unselected pipe shows the faint length tag', () => {
    render(
      <DimensionChips
        doc={doc()}
        mech={mech0()}
        view={view()}
        positions={positions()}
        hoveredElementId="L2"
        endpointDrag={null}
      />,
    );
    expect(screen.getByTestId('length-hover-tag').textContent).toContain('3 m');
  });
});

describe('JointPopover', () => {
  const renderPopover = () =>
    render(
      <JointPopover
        mech={mech0()}
        view={view()}
        positions={positions()}
        size={{ w: 800, h: 600 }}
      />,
    );

  it('weld re-realizes the joint and shows as current afterwards', () => {
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    fireEvent.click(screen.getByTestId('joint-weld'));
    const pivot = mech0().elements.find((e) => e.type === 'pivot');
    expect(pivot).toMatchObject({ nodeId: 'n2' });
    expect(useEditorStore.getState().openPopover).toBeNull();
    r.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    expect(screen.getByTestId('joint-weld').textContent).toContain('✓');
  });

  it('anchor and detach rows apply their ops', () => {
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    fireEvent.click(screen.getByTestId('joint-anchor'));
    expect(mech0().nodes.find((n) => n.id === 'n2')!.kind).toBe('anchor');
    r.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    fireEvent.click(screen.getByTestId('joint-detach'));
    expect(mech0().nodes.length).toBe(4); // n2 duplicated for the second member
  });

  it('design face: a node with a joint element lists realizations instead of joint types', () => {
    // give n2 an explicit pivot via the sketch-face menu first
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    fireEvent.click(screen.getByTestId('joint-weld'));
    r.unmount();
    useEditorStore.setState({ face: 'design', openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    expect(screen.getByTestId('realization-popover')).toBeTruthy();
    expect(screen.queryByTestId('joint-weld')).toBeNull();
    // n2 is a weld, so a rigid realization (not the pivot-only heat-wrap) applies
    fireEvent.click(screen.getByTestId('realization-heatWrapRigid'));
    const pivot = mech0().elements.find((e) => e.type === 'pivot');
    expect(pivot).toMatchObject({ realization: 'heatWrapRigid', maturity: 'engineered' });
    // re-opening on the still-mounted popover: clearing drops back to sketch
    act(() => useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } }));
    fireEvent.click(screen.getByTestId('realization-clear'));
    expect(mech0().elements.find((e) => e.type === 'pivot')).toMatchObject({
      maturity: 'sketch',
    });
  });

  it('design face: an implicit free-pin node lists realizations and materializes a pivot', () => {
    // n2 joins L1 and L2 with no explicit pivot element — an implicit free pin
    expect(mech0().elements.some((e) => e.type === 'pivot')).toBe(false);
    useEditorStore.setState({ face: 'design', openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    expect(screen.getByTestId('realization-popover')).toBeTruthy();
    expect(screen.queryByTestId('joint-weld')).toBeNull();
    // the free pin is a pivot, so a pivot-native realization applies
    fireEvent.click(screen.getByTestId('realization-boltThrough'));
    const pivot = mech0().elements.find((e) => e.type === 'pivot');
    expect(pivot).toMatchObject({
      nodeId: 'n2',
      realization: 'boltThrough',
      maturity: 'engineered',
    });
    expect(pivot).toMatchObject({ welds: [] });
    // clearing the realization drops the bare pin back to the implicit state
    act(() => useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } }));
    fireEvent.click(screen.getByTestId('realization-clear'));
    expect(mech0().elements.some((e) => e.type === 'pivot')).toBe(false);
  });

  const disabled = (id: string) =>
    (screen.getByTestId(`realization-${id}`) as HTMLButtonElement).disabled;

  it('design face: realizations are gated to the joint kind (pivot vs weld)', () => {
    // implicit free pin at n2 is a pivot: pivot-native + dual-kind enabled,
    // rigid/slider-only realizations disabled
    useEditorStore.setState({ face: 'design', openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    expect(disabled('heatWrapPivot')).toBe(false);
    expect(disabled('boltThrough')).toBe(false);
    expect(disabled('nestedSleeve')).toBe(false); // dual-kind (pivot|slider)
    expect(disabled('clickDetachable')).toBe(false); // dual-kind (pivot|slider)
    expect(disabled('heatWrapRigid')).toBe(true); // weld-only
    expect(disabled('fitting')).toBe(true); // weld-only
    expect(disabled('conduitBox')).toBe(true); // slider-only
    r.unmount();

    // weld n2: the complementary set is enabled/disabled
    useEditorStore.setState({ face: 'sketch', openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r2 = renderPopover();
    fireEvent.click(screen.getByTestId('joint-weld'));
    r2.unmount();
    useEditorStore.setState({ face: 'design', openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    expect(disabled('heatWrapRigid')).toBe(false);
    expect(disabled('nestedCoupler')).toBe(false);
    expect(disabled('fitting')).toBe(false);
    expect(disabled('heatWrapPivot')).toBe(true); // pivot-only
    expect(disabled('conduitBox')).toBe(true); // slider-only
  });

  it('renders the connect menu when a draw is pending; Pivot is the default', () => {
    let chosen = '';
    useEditorStore.setState({
      pendingConnect: {
        screen: { x: 100, y: 100 },
        options: ['pivot', 'weld', 'detach'],
        choose: (o) => {
          chosen = o;
        },
        cancel: () => {},
      },
    });
    renderPopover();
    expect(screen.getByTestId('connect-menu')).toBeTruthy();
    fireEvent.click(screen.getByTestId('connect-weld'));
    expect(chosen).toBe('weld');
  });
});

describe('SelectionCard', () => {
  const renderCard = () =>
    render(
      <SelectionCard
        doc={doc()}
        mech={mech0()}
        view={view()}
        positions={positions()}
        size={{ w: 800, h: 600 }}
      />,
    );

  it('pipe selection shows the hi-fi rows; End chips open the joint popover', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'] });
    renderCard();
    expect(screen.getByTestId('card-length').textContent).toContain('5 m');
    fireEvent.click(screen.getByTestId('card-end-b'));
    expect(useEditorStore.getState().openPopover).toEqual({ kind: 'joint', nodeId: 'n2' });
  });

  it('lock row pins the length; Delete removes the selection as one entry', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'] });
    renderCard();
    fireEvent.click(screen.getByTestId('card-length-lock'));
    expect(mech0().elements.find((e) => e.id === 'L1')).toMatchObject({ lengthLocked: true });
    fireEvent.click(screen.getByTestId('selection-delete'));
    expect(mech0().elements.some((e) => e.id === 'L1')).toBe(false);
    expect(useEditorStore.getState().selectedElementIds).toEqual([]);
  });

  it('non-pipe elements embed the existing inspector body', () => {
    useEditorStore.setState({ selectedElementIds: ['R1'] });
    renderCard();
    expect(screen.getByTestId('element-inspector')).toBeTruthy();
    expect(screen.getByTestId('rope-l0-field')).toBeTruthy();
  });

  it('renders nothing in the design face (the dock owns selection there)', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'], face: 'design' });
    renderCard();
    expect(screen.queryByTestId('selection-card')).toBeNull();
  });
});

describe('TransportPill', () => {
  it('gravity chip writes the document; forces chip toggles equilibrium', () => {
    render(<TransportPill />);
    expect(mech0().gravityOn).toBe(true);
    fireEvent.click(screen.getByTestId('gravity-toggle'));
    expect(mech0().gravityOn).toBe(false);
    fireEvent.click(screen.getByTestId('equilibrium-toggle'));
    expect(useEditorStore.getState().equilibriumOn).toBe(true);
    expect(screen.getByTestId('solver-status')).toBeTruthy();
    fireEvent.click(screen.getByTestId('equilibrium-toggle'));
  });

  it('the inputs popover adds and locks channels', () => {
    render(<TransportPill />);
    fireEvent.click(screen.getByTestId('inputs-toggle'));
    fireEvent.click(screen.getByTestId('add-input'));
    expect(mech0().inputs).toHaveLength(1);
    fireEvent.click(screen.getByTestId('input-lock'));
    expect(mech0().inputs[0]!.locked).toBe(true);
  });
});

describe('DofPill', () => {
  it('healthy: green badge, no expansion', () => {
    render(<DofPill />);
    const badge = screen.getByTestId('dof-badge');
    expect(badge.textContent).toContain('DOF 1 · mechanism');
    fireEvent.click(badge);
    expect(screen.queryByTestId('dof-conflicts')).toBeNull();
  });

  it('conflicts: expands to rows; zoom sets the focus request', () => {
    useEditorStore.setState({ violated: ['L1'], dof: { dof: 0, classification: 'structure' } });
    render(<DofPill />);
    const badge = screen.getByTestId('dof-badge');
    expect(badge.textContent).toContain('1 conflict');
    fireEvent.click(badge);
    const rows = screen.getAllByTestId('conflict-row');
    expect(rows).toHaveLength(1);
    fireEvent.click(screen.getByTestId('conflict-zoom'));
    expect(useEditorStore.getState().focusElementId).toBe('L1');
  });
});
