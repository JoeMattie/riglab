// @vitest-environment jsdom
// Component tests for the BOM panel (§6.2, §11): partial banner counts and
// routes to the checklist, cut list renders engineered pipes, weights follow
// material edits live, and cost stays hidden until something is priced.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../../bom/testHelpers';
import type { LinkElement, Project } from '../../schema';
import { createEmptyProject } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { updateMaterialRow } from '../../state/materialsOps';
import { BomPanel } from './BomPanel';

const engineered: LinkElement = {
  id: 'L1',
  type: 'link',
  maturity: 'engineered',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
  pipeMaterialId: 'PA', // 0.5 kg/m over 5 m
};
const sketchy: LinkElement = {
  id: 'L2',
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n2',
  nodeB: 'n3',
  pointMasses: [],
};

function project(elements: LinkElement[]): Project {
  return {
    ...createEmptyProject('p1', 'test'),
    unitsPreference: 'metric',
    materials: testMaterials(),
    mechanisms: [
      mech(elements, [node('n1', 0, 0), node('n2', 3, 4), node('n3', 6, 8)], {
        subsystemTag: undefined,
      } as never),
    ],
  };
}

beforeEach(() => {
  useAppStore.setState({ current: project([engineered, sketchy]) });
  useEditorStore.setState({ activeMechanismId: 'm1', face: 'design', rightTab: 'bom' });
});

afterEach(cleanup);

describe('BomPanel', () => {
  it('shows the partial banner counting unresolved elements and routes to the checklist', () => {
    render(<BomPanel />);
    const banner = screen.getByTestId('bom-partial-banner');
    expect(banner.textContent).toContain('1 element');
    fireEvent.click(banner);
    expect(useEditorStore.getState().rightTab).toBe('checklist');
  });

  it('hides the banner when everything is engineered', () => {
    useAppStore.setState({ current: project([engineered]) });
    render(<BomPanel />);
    expect(screen.queryByTestId('bom-partial-banner')).toBeNull();
  });

  it('renders the engineered cut and the weight total', () => {
    useAppStore.setState({ current: project([engineered]) });
    render(<BomPanel />);
    expect(screen.getAllByTestId('cut-part')).toHaveLength(1);
    // 5 m × 0.5 kg/m
    expect(screen.getByTestId('bom-total-weight').textContent).toBe('2.5 kg');
  });

  it('weight updates live when the pipe density is edited (§11)', () => {
    useAppStore.setState({ current: project([engineered]) });
    render(<BomPanel />);
    act(() => {
      useAppStore.setState({
        current: updateMaterialRow(useAppStore.getState().current!, 'pipes', 'PA', {
          linearDensityKgPerM: 0.8,
        }),
      });
    });
    expect(screen.getByTestId('bom-total-weight').textContent).toBe('4 kg');
  });

  it('cost appears only once something is priced', () => {
    useAppStore.setState({ current: project([engineered]) });
    const { unmount } = render(<BomPanel />);
    expect(screen.queryByTestId('bom-total-cost')).toBeNull();
    unmount();
    const cur = useAppStore.getState().current!;
    useAppStore.setState({
      current: { ...cur, materials: { ...cur.materials, unitPrices: { PA: 2.5 } } },
    });
    render(<BomPanel />);
    expect(screen.getByTestId('bom-total-cost')).toBeTruthy();
  });
});
