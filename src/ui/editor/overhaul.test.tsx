// @vitest-environment jsdom
// Component tests for the interface-overhaul chrome (test-pyramid rule:
// behavior assertable against components stays in Vitest, not e2e):
// tool pill + shortcuts, dimension chips (edit/lock), joint popover
// (type change + hinge/spherical), selection card (pipe rows, delete,
// mirror-duplicate), transport pill (forces chip), and the DOF pill
// conflict list. v7: one compound Vec3 mechanism; panel positions are
// projected 2D (side panel = world x-y).
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../../bom/testHelpers';
import type { LinkElement, Project, RopeElement } from '../../schema';
import { createEmptyProject } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { PANEL_FRAME, projectPositions } from '../quad/panelProject';
import { ActionsChip } from './ActionsChip';
import { DimensionChips } from './DimensionChips';
import { DofPill } from './DofPill';
import { JointPopover } from './JointPopover';
import { ProjectChip } from './ProjectChip';
import { DesignWindow } from './RightDock';
import { SelectionCard } from './SelectionCard';
import { SnapChip } from './SnapChip';
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
    mechanism: mech([L1, L2, R1], [node('n1', 0, 0), node('n2', 3, 4), node('n3', 6, 4)]),
  };
}

const doc = () => useAppStore.getState().current!;
const mech0 = () => doc().mechanism;
const view = () => initialView(800, 600);
const FRAME = PANEL_FRAME.side; // world x-y plane — matches the old 2D canvas
const positions = () => {
  const out: Record<string, { x: number; y: number; z: number }> = {};
  for (const n of mech0().nodes) out[n.id] = n.position;
  return projectPositions(out, FRAME);
};
const lengths = () => ({
  of: (a: string, b: string) => {
    const pa = mech0().nodes.find((n) => n.id === a)!.position;
    const pb = mech0().nodes.find((n) => n.id === b)!.position;
    return Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
  },
});

beforeEach(() => {
  useAppStore.setState({ current: project() });
  useEditorStore.setState({
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

describe('Design window', () => {
  it('the top-bar Design button toggles the design face on and off', () => {
    render(<ActionsChip />);
    const btn = screen.getByTestId('face-design');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(useEditorStore.getState().face).toBe('design');
    fireEvent.click(screen.getByTestId('face-design'));
    expect(useEditorStore.getState().face).toBe('sketch');
  });

  it('renders centered/draggable with tabs; ✕ returns to sketch', () => {
    useEditorStore.setState({ face: 'design' });
    render(<DesignWindow />);
    expect(screen.getByTestId('design-window')).toBeTruthy();
    expect(screen.getByTestId('design-window-handle')).toBeTruthy();
    expect(screen.getByTestId('right-tab-materials')).toBeTruthy();
    fireEvent.click(screen.getByTestId('design-window-close'));
    expect(useEditorStore.getState().face).toBe('sketch');
  });
});

describe('SnapChip', () => {
  it('toggles each snap source in the store, defaulting all on', () => {
    render(<SnapChip />);
    expect(useEditorStore.getState().snapPrefs).toEqual({
      grid: true,
      length: true,
      ends: true,
      pipes: true,
    });
    fireEvent.click(screen.getByTestId('snap-toggle-grid'));
    fireEvent.click(screen.getByTestId('snap-toggle-pipes'));
    expect(useEditorStore.getState().snapPrefs).toMatchObject({
      grid: false,
      pipes: false,
      ends: true,
      length: true,
    });
    expect(screen.getByTestId('snap-toggle-grid').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('snap-toggle-grid'));
    expect(useEditorStore.getState().snapPrefs.grid).toBe(true);
  });
});

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
    const before = { left: pill.style.left, bottom: pill.style.bottom };
    const handle = screen.getByTestId('tool-pill-handle');
    fireEvent.pointerDown(handle, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 130, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(pill.style.left).not.toBe(before.left);
    expect(pill.style.bottom).not.toBe(before.bottom);
  });

  it('collapses to icons and back; the collapsed flag survives a remount', () => {
    render(<ToolPill />);
    expect(screen.getByText('Polyline')).toBeTruthy();
    expect(screen.getByText('Draw')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tool-pill-collapse'));
    // labels, captions, and kbd hints are gone; icon buttons still switch tools
    expect(screen.queryByText('Polyline')).toBeNull();
    expect(screen.queryByText('Draw')).toBeNull();
    expect(screen.queryByText('V')).toBeNull();
    fireEvent.click(screen.getByTestId('tool-polyline'));
    expect(useEditorStore.getState().tool).toBe('polyline');
    // collapsed is a workspace pref: a fresh mount comes up collapsed
    cleanup();
    render(<ToolPill />);
    expect(screen.queryByText('Polyline')).toBeNull();
    fireEvent.click(screen.getByTestId('tool-pill-collapse'));
    expect(screen.getByText('Polyline')).toBeTruthy();
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

describe('floating chrome drag-to-move (only the floating pills — the top-bar chips are docked)', () => {
  const dragBy = (handle: HTMLElement, dx: number, dy: number) => {
    fireEvent.pointerDown(handle, { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200 + dx, clientY: 200 + dy, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
  };

  it('DOF pill moves by its grip (conflicts card anchored to it rides along)', () => {
    render(<DofPill />);
    const handle = screen.getByTestId('dof-pill-handle');
    const container = handle.parentElement!;
    dragBy(handle, -40, -30);
    expect(container.style.transform).toBe('translate(-40px, -30px)');
  });

  it('transport pill moves by its grip', () => {
    render(<TransportPill />);
    const handle = screen.getByTestId('transport-pill-handle');
    const wrapper = screen.getByTestId('transport-pill').parentElement!;
    dragBy(handle, 80, -12);
    expect(wrapper.style.transform).toBe('translate(80px, -12px)');
  });

  it('docked top-bar chips have no grip handles', () => {
    render(
      <>
        <ProjectChip />
        <ActionsChip />
      </>,
    );
    expect(screen.queryByTestId('project-chip-handle')).toBeNull();
    expect(screen.queryByTestId('actions-chip-handle')).toBeNull();
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
        lengths={lengths()}
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

  it('a multi-selection hides the length pills — they are a single-pipe control', () => {
    useEditorStore.setState({ selectedElementIds: ['L1', 'L2'] });
    renderChips();
    expect(screen.queryByTestId('length-chip')).toBeNull();
    expect(screen.queryByTestId('length-chip-value')).toBeNull();
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
        lengths={lengths()}
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
        container={null}
        frame={FRAME}
      />,
    );

  it('weld re-realizes the joint, stays open, and shows as current afterwards', () => {
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    fireEvent.click(screen.getByTestId('joint-weld'));
    const pivot = mech0().elements.find((e) => e.type === 'pivot');
    expect(pivot).toMatchObject({ nodeId: 'n2' });
    // picking an option does NOT close the menu — the state reads back
    expect(useEditorStore.getState().openPopover).toEqual({ kind: 'joint', nodeId: 'n2' });
    r.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    expect(screen.getByTestId('joint-weld').textContent).toContain('✓');
  });

  it('closes via the ✕ button and via a pointerdown outside the menu', () => {
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    fireEvent.click(screen.getByTestId('joint-popover-close'));
    expect(useEditorStore.getState().openPopover).toBeNull();
    r.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    // a pointerdown INSIDE keeps it open; one outside dismisses
    fireEvent.pointerDown(screen.getByTestId('joint-attached-toggle'));
    expect(useEditorStore.getState().openPopover).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(useEditorStore.getState().openPopover).toBeNull();
  });

  it('the Attached toggle shows the pipe count and breaks the attachment', () => {
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    const toggle = screen.getByTestId('joint-attached-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Attached · joins 2 pipes');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(mech0().nodes.length).toBe(4); // n2 duplicated for the second member
    // breaking keeps the menu open so the new "Not attached" state reads back
    expect(useEditorStore.getState().openPopover).toEqual({ kind: 'joint', nodeId: 'n2' });
  });

  it('a free end shows the toggle disabled as "Not attached"', () => {
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n1' } });
    renderPopover();
    const toggle = screen.getByTestId('joint-attached-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Not attached');
    expect(toggle.disabled).toBe(true);
  });

  it('a body-bound end reads as attached; the toggle releases the binding', () => {
    act(() =>
      useAppStore.setState((s) => ({
        current: {
          ...s.current!,
          mechanism: {
            ...s.current!.mechanism,
            skeletonBindings: [{ id: 'b1', point: 'handR', nodeId: 'n1' }],
          },
        },
      })),
    );
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n1' } });
    renderPopover();
    const toggle = screen.getByTestId('joint-attached-toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Attached · body · handR');
    fireEvent.click(toggle);
    expect(mech0().skeletonBindings).toHaveLength(0);
    expect(mech0().nodes).toHaveLength(3); // no pipe split — only the binding broke
  });

  it('anchor row applies its op', () => {
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    fireEvent.click(screen.getByTestId('joint-anchor'));
    expect(mech0().nodes.find((n) => n.id === 'n2')!.kind).toBe('anchor');
  });

  it('the combined menu shows joint types and realizations side by side', () => {
    // give n2 an explicit weld first
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    fireEvent.click(screen.getByTestId('joint-weld'));
    r.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    // both halves live in ONE popover now (no design-face swap)
    expect(screen.getByTestId('joint-weld')).toBeTruthy();
    expect(screen.getByTestId('realization-rows')).toBeTruthy();
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

  it('an implicit free-pin node lists realizations and materializes a pivot', () => {
    // n2 joins L1 and L2 with no explicit pivot element — an implicit free pin
    expect(mech0().elements.some((e) => e.type === 'pivot')).toBe(false);
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    expect(screen.getByTestId('realization-rows')).toBeTruthy();
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

  it('realizations are gated to the joint kind (pivot vs weld)', () => {
    // implicit free pin at n2 is a pivot: pivot-native + dual-kind enabled,
    // rigid/slider-only realizations disabled
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
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
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r2 = renderPopover();
    fireEvent.click(screen.getByTestId('joint-weld'));
    r2.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    expect(disabled('heatWrapRigid')).toBe(false);
    expect(disabled('nestedCoupler')).toBe(false);
    expect(disabled('fitting')).toBe(false);
    expect(disabled('heatWrapPivot')).toBe(true); // pivot-only
    expect(disabled('conduitBox')).toBe(true); // slider-only
  });

  it('Weld + pivot: disabled at 2 members; welds only the through pair at 3', () => {
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    // n2 joins two pipes — the mixed junction needs a third member
    expect((screen.getByTestId('joint-weldPivot') as HTMLButtonElement).disabled).toBe(true);
    r.unmount();
    // a third pipe arrives at n2 from n4, well off the L1→L2 line
    act(() =>
      useAppStore.setState((s) => ({
        current: {
          ...s.current!,
          mechanism: {
            ...s.current!.mechanism,
            nodes: [
              ...s.current!.mechanism.nodes,
              { id: 'n4', kind: 'free', position: { x: 3, y: 0, z: 0 } },
            ],
            elements: [
              ...s.current!.mechanism.elements,
              { ...L1, id: 'L3', nodeA: 'n2', nodeB: 'n4' },
            ],
          },
        },
      })),
    );
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    fireEvent.click(screen.getByTestId('joint-weldPivot'));
    const pivot = mech0().elements.find((e) => e.type === 'pivot');
    expect(pivot?.type === 'pivot' && pivot.welds).toHaveLength(1);
    if (pivot?.type === 'pivot') {
      expect(new Set(pivot.welds[0])).toEqual(new Set(['L1', 'L2'])); // through pair
      expect(new Set(pivot.memberIds)).toEqual(new Set(['L1', 'L2', 'L3']));
    }
  });

  it('a mixed junction reads as Weld + pivot and keeps the hinge controls', () => {
    act(() =>
      useAppStore.setState((s) => ({
        current: {
          ...s.current!,
          mechanism: {
            ...s.current!.mechanism,
            nodes: [
              ...s.current!.mechanism.nodes,
              { id: 'n4', kind: 'free', position: { x: 3, y: 0, z: 0 } },
            ],
            elements: [
              ...s.current!.mechanism.elements,
              { ...L1, id: 'L3', nodeA: 'n2', nodeB: 'n4' },
              {
                id: 'P1',
                type: 'pivot',
                maturity: 'sketch',
                nodeId: 'n2',
                joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
                memberIds: ['L1', 'L2', 'L3'],
                welds: [['L1', 'L2']],
              },
            ],
          },
        },
      })),
    );
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    expect(screen.getByTestId('joint-weldPivot').textContent).toContain('✓');
    // the junction still pivots, so the hinge/axis controls stay visible
    expect(screen.getByTestId('pivot-joint-controls')).toBeTruthy();
    expect(screen.getByTestId('realization-rows')).toBeTruthy();
  });

  it('hinge controls are pivot-only: hidden once the joint is a weld', () => {
    // pivot at n2 → controls visible
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    fireEvent.click(screen.getByTestId('joint-pivot'));
    r.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r2 = renderPopover();
    expect(screen.getByTestId('pivot-joint-controls')).toBeTruthy();
    // weld it → the same node's menu hides the hinge/spherical controls
    fireEvent.click(screen.getByTestId('joint-weld'));
    r2.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    expect(screen.queryByTestId('pivot-joint-controls')).toBeNull();
    expect(screen.getByTestId('realization-rows')).toBeTruthy();
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

describe('JointPopover hinge controls (v7)', () => {
  const renderPopover = () =>
    render(
      <JointPopover
        mech={mech0()}
        view={view()}
        positions={positions()}
        container={null}
        frame={FRAME}
      />,
    );

  it('a pivot node shows hinge/spherical controls; spherical writes the joint', () => {
    // materialize a pivot at n2 (hinge ⊥ side panel = +z)
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    fireEvent.click(screen.getByTestId('joint-pivot'));
    r.unmount();
    const pivot = () => mech0().elements.find((e) => e.type === 'pivot')!;
    expect(pivot()).toMatchObject({ joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } } });

    // the popover reads `mech` as a prop, so re-render between edits (the
    // hosting panel re-renders on every document change in the app)
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r2 = renderPopover();
    expect(screen.getByTestId('pivot-joint-controls')).toBeTruthy();
    fireEvent.click(screen.getByTestId('joint-kind-spherical'));
    expect(pivot()).toMatchObject({ joint: { kind: 'spherical' } });
    r2.unmount();
    // back to hinge, then snap the axis to ⊥ Top (the top panel's normal)
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r3 = renderPopover();
    fireEvent.click(screen.getByTestId('joint-kind-hinge'));
    expect(pivot().joint.kind).toBe('hinge');
    r3.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    fireEvent.click(screen.getByTestId('axis-preset-top'));
    expect(pivot()).toMatchObject({ joint: { kind: 'hinge', axis: { x: 0, y: -1, z: 0 } } });
  });

  it('numeric axis entry normalizes before writing the joint', () => {
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    const r = renderPopover();
    fireEvent.click(screen.getByTestId('joint-pivot'));
    r.unmount();
    useEditorStore.setState({ openPopover: { kind: 'joint', nodeId: 'n2' } });
    renderPopover();
    const ax = screen.getByTestId('axis-x') as HTMLInputElement;
    fireEvent.change(ax, { target: { value: '2' } });
    fireEvent.keyDown(ax, { key: 'Enter' });
    const pivot = mech0().elements.find((e) => e.type === 'pivot')!;
    expect(pivot.type === 'pivot' && pivot.joint.kind === 'hinge').toBe(true);
    if (pivot.type === 'pivot' && pivot.joint.kind === 'hinge') {
      // (2, 0, 1) normalized
      expect(pivot.joint.axis.x).toBeCloseTo(2 / Math.hypot(2, 0, 1), 6);
      expect(pivot.joint.axis.z).toBeCloseTo(1 / Math.hypot(2, 0, 1), 6);
    }
  });
});

describe('SelectionCard mirror-duplicate (v7)', () => {
  it('Mirror duplicates the selection across the sagittal plane and selects the copies', () => {
    useEditorStore.setState({ selectedElementIds: ['L1'] });
    render(
      <SelectionCard
        doc={doc()}
        mech={mech0()}
        view={view()}
        positions={positions()}
        size={{ w: 800, h: 600 }}
      />,
    );
    const before = mech0().elements.length;
    fireEvent.click(screen.getByTestId('selection-mirror'));
    expect(mech0().elements.length).toBe(before + 1);
    const newIds = useEditorStore.getState().selectedElementIds;
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe('L1');
    // a group over the copies was created
    expect(doc().groups.length).toBe(1);
  });
});

describe('TransportPill', () => {
  it('gravity chip is gone (global −y, PLANFILE-3d decision 4); forces chip toggles equilibrium', () => {
    render(<TransportPill />);
    expect(screen.queryByTestId('gravity-toggle')).toBeNull();
    fireEvent.click(screen.getByTestId('equilibrium-toggle'));
    expect(useEditorStore.getState().equilibriumOn).toBe(true);
    expect(screen.getByTestId('solver-status')).toBeTruthy();
    fireEvent.click(screen.getByTestId('equilibrium-toggle'));
  });

  it('constraints chip is unchecked by default and drives drag-time enforcement', () => {
    useEditorStore.setState({ constraintsOn: false });
    render(<TransportPill />);
    const chip = screen.getByTestId('constraints-toggle');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(useEditorStore.getState().constraintsOn).toBe(true);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(useEditorStore.getState().constraintsOn).toBe(false);
  });

  it('the inputs popover adds and locks channels', () => {
    render(<TransportPill />);
    fireEvent.click(screen.getByTestId('inputs-toggle'));
    fireEvent.click(screen.getByTestId('add-input'));
    expect(mech0().inputs).toHaveLength(1);
    fireEvent.click(screen.getByTestId('input-lock'));
    expect(mech0().inputs[0]!.locked).toBe(true);
  });

  it('the controls chip (left of the clip selector) toggles the controls dock', () => {
    useEditorStore.setState({ controlsOpen: false });
    render(<TransportPill />);
    fireEvent.click(screen.getByTestId('controls-toggle'));
    expect(useEditorStore.getState().controlsOpen).toBe(true);
    fireEvent.click(screen.getByTestId('controls-toggle'));
    expect(useEditorStore.getState().controlsOpen).toBe(false);
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
