// Top-bar panel visibility toggles (PLANFILE-quad-panel-controls B): docked
// in the top bar's center slot between the project chip and the actions
// chip, with one toggle per quad panel. Hiding a panel reflows the remaining
// ones (quadLayout.ts); the store refuses to hide the last visible panel.
import { type QuadPanelId, useEditorStore } from '../../state/editorStore';
import { T, toggleChipStyle } from '../editor/theme';

/** Compact labels — "Perspective" is the 3D preview. */
const SHORT_TITLES: Record<QuadPanelId, string> = {
  top: 'Top',
  persp: '3D',
  front: 'Front',
  side: 'Side',
};

/** Menu order (Joe's request): ortho views reading left to right, 3D last —
 * intentionally NOT quadLayout's PANEL_ORDER, which encodes grid slots. */
const TOGGLE_ORDER: readonly QuadPanelId[] = ['top', 'front', 'side', 'persp'];

export function PanelToggleChip() {
  const panelsVisible = useEditorStore((s) => s.panelsVisible);
  const togglePanelVisible = useEditorStore((s) => s.togglePanelVisible);
  const quadMaximized = useEditorStore((s) => s.quadMaximized);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const setWorkspaceMode = useEditorStore((s) => s.setWorkspaceMode);
  const iso = workspaceMode === 'iso';

  return (
    <div
      data-testid="panel-toggles"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span
        style={{
          font: `500 10.5px ${T.sans}`,
          letterSpacing: '.07em',
          textTransform: 'uppercase',
          color: T.faint,
          padding: '0 4px',
        }}
      >
        Panels
      </span>
      {TOGGLE_ORDER.map((id) => {
        const on = panelsVisible[id];
        return (
          <button
            key={id}
            type="button"
            data-testid={`panel-toggle-${id}`}
            aria-pressed={on}
            title={on ? `hide the ${SHORT_TITLES[id]} panel` : `show the ${SHORT_TITLES[id]} panel`}
            onClick={() => togglePanelVisible(id)}
            style={{
              ...toggleChipStyle(on),
              // a maximized panel (or the iso workspace) covers the grid;
              // dim the toggles that aren't what's on screen
              opacity: iso ? 0.55 : quadMaximized && quadMaximized !== id ? 0.55 : 1,
            }}
          >
            {SHORT_TITLES[id]}
          </button>
        );
      })}
      {/* single-panel isometric editor (PLANFILE-iso-view.md): swaps the
          quad grid for one full-workspace axonometric SketchCanvas */}
      <button
        type="button"
        data-testid="workspace-iso-toggle"
        aria-pressed={iso}
        title={iso ? 'back to the quad view' : 'single-panel isometric view'}
        onClick={() => setWorkspaceMode(iso ? 'quad' : 'iso')}
        style={{ ...toggleChipStyle(iso), marginLeft: 6 }}
      >
        Iso
      </button>
    </div>
  );
}
