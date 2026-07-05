// DOF pill (design handoff §9): healthy = green "DOF n · classification";
// conflicts = red pill that expands into a card listing each conflict with a
// click-to-zoom and, where a docOp applies, a one-click fix.
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { deriveConflicts } from './conflicts';
import { captionStyle, EDGE, menuStyle, T } from './theme';

export function DofPill() {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const dof = useEditorStore((s) => s.dof);
  const violated = useEditorStore((s) => s.violated);
  const equilibrium = useEditorStore((s) => s.equilibrium);
  const openPopover = useEditorStore((s) => s.openPopover);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const setFocusElement = useEditorStore((s) => s.setFocusElement);

  const mech = doc?.mechanism ?? null;
  if (!mech || !dof) return null;

  const conflicts = deriveConflicts(mech, dof, violated, equilibrium.ropesRequiringCompression);
  const healthy = conflicts.length === 0;
  const open = openPopover?.kind === 'dof';

  return (
    <div style={{ position: 'absolute', right: EDGE, bottom: EDGE, zIndex: 40 }}>
      {open && !healthy && (
        <div
          data-testid="dof-conflicts"
          style={{
            ...menuStyle,
            position: 'absolute',
            right: 0,
            bottom: 46,
            width: 300,
            border: `1px solid ${T.dangerBorder}`,
            zIndex: 45,
          }}
        >
          <div style={{ ...captionStyle, color: T.danger, padding: '6px 10px' }}>
            {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''} — click to zoom
          </div>
          {conflicts.map((c) => (
            <div
              key={c.key}
              data-testid="conflict-row"
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                borderRadius: 8,
                padding: '5px 10px',
              }}
            >
              <button
                type="button"
                data-testid="conflict-zoom"
                disabled={!c.elementId}
                onClick={() => {
                  if (c.elementId) setFocusElement(c.elementId);
                  setOpenPopover(null);
                }}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  cursor: c.elementId ? 'pointer' : 'default',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'baseline',
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  fontFamily: T.sans,
                }}
              >
                <span
                  style={{ fontWeight: 500, fontSize: 12.5, whiteSpace: 'nowrap', color: T.text }}
                >
                  {c.label}
                </span>
                <span style={{ color: T.muted, fontSize: 12 }}>{c.issue}</span>
              </button>
              {c.fix && (
                <button
                  type="button"
                  data-testid="conflict-fix"
                  onClick={() => {
                    const apply = c.fix!.apply;
                    updateCurrent((cur) => apply(cur));
                  }}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: 0,
                    color: T.accent,
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    fontFamily: T.sans,
                  }}
                >
                  {c.fix.label} ▸
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        data-testid="dof-badge"
        onClick={() => !healthy && setOpenPopover(open ? null : { kind: 'dof' })}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: T.panel,
          border: `1.5px solid ${healthy ? T.okBorder : T.dangerBorder}`,
          color: healthy ? T.okText : T.dangerText,
          borderRadius: 14,
          padding: '8px 14px',
          font: `500 12.5px ${T.sans}`,
          cursor: healthy ? 'default' : 'pointer',
          boxShadow: '0 4px 16px rgba(20,24,40,.10)',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: healthy ? T.success : T.danger,
          }}
        />
        DOF {dof.dof} ·{' '}
        {healthy
          ? dof.classification
          : `${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}`}
        {!healthy && <span style={{ color: T.dangerBorder }}>{open ? '▾' : '▴'}</span>}
      </button>
    </div>
  );
}
