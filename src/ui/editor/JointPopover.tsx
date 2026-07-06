// The joint popover (design handoff §6 + storyboard 1f): opened by clicking
// any node — rows re-realize the joint via docOps. The same component is the
// snap-connect menu when a drawn pipe end lands on existing geometry
// (pendingConnect): Pivot is the default, Enter accepts it, Esc cancels.
// v7 (PLANFILE-3d-conversion.md): a pivot additionally carries its 3D joint —
// hinge (with an editable axis + ⊥-panel presets) or spherical.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OrientationFrame } from '../../geometry/placement';
import type { JointRealization, Mechanism, PivotElement, PivotJoint, Vec2 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import {
  assignNodeRealization,
  detachNode,
  releaseNodeConnection,
  setNodeJoint,
  setNodePivotJoint,
  setPivotAngleLimit,
  setPivotAxisLocked,
} from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { PANEL_FRAME } from '../quad/panelProject';
import { useMenuDrag, useOnscreenPosition } from './floatingMenu';
import { JointGlyph, type JointGlyphName } from './icons';
import { REALIZATION_OPTIONS } from './infopanel/fields';
import { GripHandle } from './pillDrag';
import { captionStyle, menuStyle, rowStyle, T } from './theme';
import { toScreen, type ViewTransform } from './viewTransform';

const CONNECT_LABELS: Record<string, string> = {
  pivot: 'Pivot',
  weld: 'Weld',
  slider: 'Slider',
  detach: 'Detach',
};

const WIDTH = 178;

/** Menus portal to document.body and position fixed in PAGE coordinates, so
 * they float over the whole window instead of clipping at the hosting
 * panel's overflow:hidden edge; clamp against the window with a per-menu
 * height estimate. */
function clampedPos(anchor: Vec2, w: number, h: number): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(anchor.x, window.innerWidth - w - 8)),
    top: Math.max(8, Math.min(anchor.y, window.innerHeight - h - 8)),
  };
}

/** Page-coordinate offset of the hosting panel (null container → 0,0). */
function pageOrigin(container: HTMLElement | null): Vec2 {
  const r = container?.getBoundingClientRect();
  return { x: r?.left ?? 0, y: r?.top ?? 0 };
}

/** Roving arrow-key focus across the option buttons (storyboard 1f·1). */
function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
  next?.focus();
}

export function JointPopover({
  mech,
  view,
  positions,
  container,
  frame,
}: {
  mech: Mechanism;
  view: ViewTransform;
  /** node positions projected into the hosting panel's plane */
  positions: Record<string, Vec2>;
  /** hosting panel's DOM element — its page offset anchors the portaled menu */
  container: HTMLElement | null;
  /** the hosting panel's frame — its normal is the default hinge axis */
  frame: OrientationFrame;
}) {
  const pending = useEditorStore((s) => s.pendingConnect);
  const openPopover = useEditorStore((s) => s.openPopover);

  if (pending) return <ConnectMenu container={container} />;
  if (openPopover?.kind !== 'joint') return null;
  const node = mech.nodes.find((n) => n.id === openPopover.nodeId);
  if (!node) return null;
  const p2 = positions[node.id];
  if (!p2) return null;
  const p = toScreen(view, p2);
  const origin = pageOrigin(container);
  const anchor = { x: origin.x + p.x - 33, y: origin.y + p.y + 20 };
  // ONE combined menu on every face (Joe's request — the old design-face
  // realization popover is folded in as the right-hand column)
  return <JointMenu mech={mech} nodeId={node.id} anchor={anchor} frame={frame} />;
}

/** Which physical realizations can actually produce each joint kind's
 * kinematics (planfile §172 descriptions, §100 conduit-box slider, §231/§235).
 * Rows outside the kind's set are shown disabled rather than hidden, so the
 * menu stays positionally stable like JointMenu. `nestedSleeve` (a bearing/slip
 * pair) and `clickDetachable` (slip fit + retaining screw) work as either a
 * pivot or a slider, so they appear under both. */
const REALIZATIONS_BY_KIND: Record<'pivot' | 'weld' | 'slider', ReadonlySet<JointRealization>> = {
  pivot: new Set([
    'heatWrapPivot',
    'boltThrough',
    'nestedSleeve',
    'ropeLashing',
    'clickDetachable',
  ]),
  weld: new Set(['heatWrapRigid', 'nestedCoupler', 'fitting']),
  slider: new Set(['conduitBox', 'nestedSleeve', 'clickDetachable']),
};

/** Realization column of the combined joint menu (formerly the design-face
 * popover): the joint's physical realization (heat-wrap, fitting,
 * bolt-through, …). Works on any pivot-like node — an implicit free pin
 * materializes a pivot element when realized. Assigning re-derives maturity. */
function RealizationRows({
  mech,
  nodeId,
  kind,
  frame,
}: {
  mech: Mechanism;
  nodeId: string;
  kind: 'pivot' | 'weld' | 'slider';
  frame: OrientationFrame;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);

  // the explicit joint element, if any — carries the current realization;
  // absent for an implicit free pin (realized on first pick)
  const joint = mech.elements.find(
    (e): e is Extract<Mechanism['elements'][number], { type: 'pivot' | 'slider' }> =>
      (e.type === 'pivot' || e.type === 'slider') && e.nodeId === nodeId,
  );
  const current = joint?.realization;
  const allowed = REALIZATIONS_BY_KIND[kind];

  const choose = (realization: JointRealization | undefined) => {
    // a materialized free pin hinges about the hosting panel's normal; the
    // hosting menu stays open — the picked row's checkmark reads back
    updateCurrent((cur) =>
      assignNodeRealization(cur, nodeId, realization, { kind: 'hinge', axis: { ...frame.zAxis } }),
    );
  };

  return (
    <div data-testid="realization-rows">
      <div style={{ ...captionStyle, padding: '4px 8px 6px' }}>Realization</div>
      {REALIZATION_OPTIONS.map((opt) => {
        // gate rows to the kind's physically-valid realizations; a currently
        // set-but-incompatible realization stays visible (disabled, checked) so
        // the mismatch reads rather than silently vanishing.
        const disabled = !allowed.has(opt.id as JointRealization);
        return (
          <button
            type="button"
            key={opt.id}
            data-testid={`realization-${opt.id}`}
            disabled={disabled}
            onClick={() => choose(opt.id as JointRealization)}
            style={{
              ...rowStyle(current === opt.id),
              ...(disabled ? { opacity: 0.4, cursor: 'default' } : {}),
            }}
          >
            {opt.label}
            {current === opt.id && <span style={{ marginLeft: 'auto' }}>✓</span>}
          </button>
        );
      })}
      <div style={{ borderTop: `1px solid ${T.hairline}`, margin: '5px 4px' }} />
      <button
        type="button"
        data-testid="realization-clear"
        onClick={() => choose(undefined)}
        style={{ ...rowStyle(current === undefined), color: T.muted }}
      >
        unset (sketch)
        {current === undefined && <span style={{ marginLeft: 'auto' }}>✓</span>}
      </button>
    </div>
  );
}

/** Snap-connect variant: choices come from the pending draw; Pivot default. */
function ConnectMenu({ container }: { container: HTMLElement | null }) {
  const pending = useEditorStore((s) => s.pendingConnect)!;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);

  const origin = pageOrigin(container);
  const pos = clampedPos(
    { x: origin.x + pending.screen.x + 10, y: origin.y + pending.screen.y - 10 },
    WIDTH,
    160,
  );
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard roving-focus container, not an interactive control
    <div
      ref={ref}
      data-testid="connect-menu"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) pending.choose('pivot');
        if (e.key === 'Escape') pending.cancel();
        onMenuKeyDown(e);
      }}
      style={{ ...menuStyle, position: 'fixed', ...pos, width: WIDTH, zIndex: 60 }}
    >
      <div style={{ ...captionStyle, padding: '4px 8px 6px' }}>Connect end</div>
      {pending.options.map((o, i) => (
        <button
          type="button"
          key={o}
          data-testid={`connect-${o}`}
          onClick={() => pending.choose(o)}
          style={rowStyle(i === 0)}
        >
          <span style={{ display: 'grid', placeItems: 'center', width: 18 }}>
            <JointGlyph name={o as JointGlyphName} />
          </span>
          {CONNECT_LABELS[o]}
          {i === 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: T.focus }}>⏎</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}

type JointChoice = 'pivot' | 'weldPivot' | 'weld' | 'slider' | 'anchor';

/** Quick hinge-axis presets: perpendicular to each ortho panel. */
export const AXIS_PRESETS: Array<{ key: string; label: string; axis: () => PivotJoint }> = [
  {
    key: 'top',
    label: '⊥ Top',
    axis: () => ({ kind: 'hinge', axis: { ...PANEL_FRAME.top.zAxis } }),
  },
  {
    key: 'front',
    label: '⊥ Front',
    axis: () => ({ kind: 'hinge', axis: { ...PANEL_FRAME.front.zAxis } }),
  },
  {
    key: 'side',
    label: '⊥ Side',
    axis: () => ({ kind: 'hinge', axis: { ...PANEL_FRAME.side.zAxis } }),
  },
];

const fmtAxis = (v: number): string => String(Number(v.toFixed(3)));

/** Hinge/spherical section shared by the joint popover and the pivot
 * inspector: kind toggle, ⊥-panel presets, numeric axis entry. Edits go
 * through setNodePivotJoint (normalizes and preserves welds/limits). */
export function PivotJointControls({ pivot }: { pivot: PivotElement }) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const joint = pivot.joint;
  const [draftAxis, setDraftAxis] = useState<{ x: string; y: string; z: string } | null>(null);

  const apply = (j: PivotJoint) => {
    setDraftAxis(null);
    updateCurrent((cur) => setNodePivotJoint(cur, pivot.nodeId, j));
  };

  const axis = joint.kind === 'hinge' ? joint.axis : null;
  const shown =
    draftAxis ?? (axis ? { x: fmtAxis(axis.x), y: fmtAxis(axis.y), z: fmtAxis(axis.z) } : null);

  const commitDraft = () => {
    if (!draftAxis) return;
    const x = Number.parseFloat(draftAxis.x);
    const y = Number.parseFloat(draftAxis.y);
    const z = Number.parseFloat(draftAxis.z);
    const len = Math.hypot(x, y, z);
    if (![x, y, z].every(Number.isFinite) || len < 1e-9) {
      setDraftAxis(null);
      return;
    }
    // the schema stores a unit axis — normalize typed input here
    apply({ kind: 'hinge', axis: { x: x / len, y: y / len, z: z / len } });
  };

  const isPreset = (j: PivotJoint): boolean =>
    axis !== null &&
    j.kind === 'hinge' &&
    Math.abs(j.axis.x - axis.x) < 1e-6 &&
    Math.abs(j.axis.y - axis.y) < 1e-6 &&
    Math.abs(j.axis.z - axis.z) < 1e-6;

  return (
    <div
      data-testid="pivot-joint-controls"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 8px' }}
    >
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          data-testid="joint-kind-hinge"
          aria-pressed={joint.kind === 'hinge'}
          onClick={() =>
            joint.kind !== 'hinge' && apply({ kind: 'hinge', axis: { x: 0, y: 0, z: 1 } })
          }
          style={segStyle(joint.kind === 'hinge')}
        >
          Hinge
        </button>
        <button
          type="button"
          data-testid="joint-kind-spherical"
          aria-pressed={joint.kind === 'spherical'}
          onClick={() => joint.kind !== 'spherical' && apply({ kind: 'spherical' })}
          style={segStyle(joint.kind === 'spherical')}
        >
          Spherical
        </button>
      </div>
      {joint.kind === 'hinge' && shown && (
        <>
          <div style={{ display: 'flex', gap: 4 }}>
            {AXIS_PRESETS.map((p) => {
              const j = p.axis();
              return (
                <button
                  type="button"
                  key={p.key}
                  data-testid={`axis-preset-${p.key}`}
                  onClick={() => apply(j)}
                  style={segStyle(isPreset(j))}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: T.muted }}>axis</span>
            {(['x', 'y', 'z'] as const).map((k) => (
              <input
                key={k}
                data-testid={`axis-${k}`}
                value={shown[k]}
                onChange={(e) => setDraftAxis({ ...(draftAxis ?? shown), [k]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitDraft();
                  if (e.key === 'Escape') setDraftAxis(null);
                }}
                onBlur={commitDraft}
                style={{
                  width: 0,
                  flex: 1,
                  border: `1px solid ${T.border}`,
                  borderRadius: 5,
                  padding: '2px 4px',
                  font: `500 11.5px ${T.mono}`,
                  color: T.text,
                  background: T.raised,
                }}
              />
            ))}
          </div>
          {/* lock the axis DIRECTION world-fixed so the hinge plane is
              honored during simulation (Joe's request) */}
          <button
            type="button"
            data-testid="axis-lock-toggle"
            aria-pressed={pivot.axisLocked === true}
            onClick={() =>
              updateCurrent((cur) => setPivotAxisLocked(cur, pivot.nodeId, !pivot.axisLocked))
            }
            style={{
              ...segStyle(pivot.axisLocked === true),
              width: '100%',
              padding: '4px 0',
            }}
          >
            {pivot.axisLocked ? '🔒 Axis locked' : 'Lock axis'}
          </button>
          <AngleLimitControls pivot={pivot} />
        </>
      )}
    </div>
  );
}

const DEG = 180 / Math.PI;

/** Segmented-control button style shared by the hinge/axis controls. */
const segStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  border: 'none',
  borderRadius: 6,
  padding: '3px 0',
  cursor: 'pointer',
  fontSize: 11.5,
  fontFamily: T.sans,
  background: active ? T.accentTint : T.chip,
  color: active ? T.accentText : T.muted,
});

/** Min/max hinge-angle limit editor (Joe's request): a toggle that
 * enables/clears the limit and two degree inputs, measured about the axis
 * between the pivot's first two members (0 = straight continuation). */
function AngleLimitControls({ pivot }: { pivot: PivotElement }) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const lim = pivot.angleLimit;
  const [draft, setDraft] = useState<{ min: string; max: string } | null>(null);
  const shown = draft ?? {
    min: lim ? String(Math.round(lim.minRad * DEG)) : '-45',
    max: lim ? String(Math.round(lim.maxRad * DEG)) : '45',
  };

  const commit = (next: { min: string; max: string }) => {
    setDraft(null);
    const min = Number.parseFloat(next.min);
    const max = Number.parseFloat(next.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    updateCurrent((cur) =>
      setPivotAngleLimit(cur, pivot.nodeId, { minRad: min / DEG, maxRad: max / DEG }),
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        data-testid="angle-limit-toggle"
        aria-pressed={lim !== undefined}
        onClick={() =>
          updateCurrent((cur) =>
            lim
              ? setPivotAngleLimit(cur, pivot.nodeId, null)
              : setPivotAngleLimit(cur, pivot.nodeId, {
                  minRad: -45 / DEG,
                  maxRad: 45 / DEG,
                }),
          )
        }
        style={{ ...segStyle(lim !== undefined), width: '100%', padding: '4px 0' }}
      >
        {lim ? 'Angle limited' : 'Limit angle'}
      </button>
      {lim && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: T.muted }}>min</span>
          <input
            data-testid="angle-min"
            value={shown.min}
            onChange={(e) => setDraft({ ...shown, min: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && commit({ ...shown, min: e.currentTarget.value })}
            onBlur={(e) => commit({ ...shown, min: e.target.value })}
            style={angleInputStyle}
          />
          <span style={{ fontSize: 11, color: T.muted }}>max</span>
          <input
            data-testid="angle-max"
            value={shown.max}
            onChange={(e) => setDraft({ ...shown, max: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && commit({ ...shown, max: e.currentTarget.value })}
            onBlur={(e) => commit({ ...shown, max: e.target.value })}
            style={angleInputStyle}
          />
          <span style={{ fontSize: 11, color: T.muted }}>°</span>
        </div>
      )}
    </div>
  );
}

const angleInputStyle: React.CSSProperties = {
  width: 0,
  flex: 1,
  border: `1px solid ${T.border}`,
  borderRadius: 5,
  padding: '2px 4px',
  font: `500 11.5px ${T.mono}`,
  color: T.text,
  background: T.raised,
};

/** The combined joint menu (Joe's request): attachment state on top, joint
 * types on the left, the pivot's hinge controls and the realization picker
 * side by side on the right — one menu on both faces, floating over the
 * whole page. Rows that cannot apply to this node are disabled rather than
 * hidden, keeping the menu stable. */
function JointMenu({
  mech,
  nodeId,
  anchor,
  frame,
}: {
  mech: Mechanism;
  nodeId: string;
  /** page coordinates */
  anchor: Vec2;
  frame: OrientationFrame;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const drag = useMenuDrag();

  const members = memberCountAtNode(mech, nodeId);
  const kindNow = jointKindAtNode(mech, nodeId);
  // measured clamp keeps the WHOLE menu on-screen (its height varies with
  // the pivot controls / realization column); re-measures as the joint kind
  // changes the layout, or the user drags it
  const { ref, left, top } = useOnscreenPosition(anchor, drag.offset, [kindNow, members]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [ref]);

  // the menu stays open while options are clicked (state edits read back
  // live); it closes on ✕, Escape, or any pointerdown OUTSIDE it — the
  // portal floats over the whole page, so listen at the document. Pointerdowns
  // on a SKETCH CANVAS are exempt: that surface has the enlarged angle-limit
  // arc whose handles must stay grabbable (SketchCanvas's own mousedown
  // closes the menu for genuine empty-canvas clicks; Joe's request).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current || ref.current.contains(target)) return;
      if (target.closest('[data-testid^="sketch-canvas-"]')) return;
      setOpenPopover(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [setOpenPopover]);

  const kind = kindNow;
  const current: JointChoice = kind === 'end' ? 'pivot' : kind;
  const pivot = mech.elements.find(
    (e): e is PivotElement => e.type === 'pivot' && e.nodeId === nodeId,
  );

  const choose = (kind: JointChoice) => {
    if (kind === 'slider') return; // shown only as the current state
    // anchor/pivot/weld materialized here hinge about the panel's normal
    // (grounding creates a ground hinge, keeping panel sketches planar);
    // the menu stays open — the row's checkmark moves to the new state
    updateCurrent((cur) =>
      setNodeJoint(cur, nodeId, kind, { kind: 'hinge', axis: { ...frame.zAxis } }),
    );
  };

  /** the "Attached" toggle: this node joins ≥2 pipes and/or rides a wearer
   * point (skeleton binding / pack-frame anchor); clicking breaks every
   * attachment so the end moves freely again */
  const attachedPipes = members >= 2;
  const skeletonBinding = mech.skeletonBindings.find((b) => b.nodeId === nodeId);
  const anchorBinding = mech.anchorBindings.find((b) => b.nodeId === nodeId);
  const attachedWearer = skeletonBinding !== undefined || anchorBinding !== undefined;
  const attached = attachedPipes || attachedWearer;
  const attachedLabel = attachedPipes
    ? `Attached · joins ${members} pipes${attachedWearer ? ' + wearer' : ''}`
    : skeletonBinding
      ? `Attached · body · ${skeletonBinding.point}`
      : anchorBinding
        ? `Attached · frame · ${anchorBinding.anchor}`
        : 'Not attached';
  const breakAttachment = () => {
    // the menu stays open and now reads "Not attached"
    updateCurrent((cur) => {
      let next = cur;
      if (attachedWearer) next = releaseNodeConnection(next, nodeId);
      if (attachedPipes) next = detachNode(next, nodeId);
      return next;
    });
    useEditorStore.getState().clearSelection();
  };

  const rows: Array<{ kind: JointChoice; glyph: JointGlyphName; disabled: boolean }> = [
    { kind: 'pivot', glyph: 'pivot', disabled: members < 2 && current !== 'anchor' },
    // the mid-pipe junction default: straight-through pair welded (one
    // physical pipe), every other member pivots — needs a 3rd member
    { kind: 'weldPivot', glyph: 'weldPivot', disabled: members < 3 },
    { kind: 'weld', glyph: 'weld', disabled: members < 2 },
    { kind: 'slider', glyph: 'slider', disabled: current !== 'slider' },
    { kind: 'anchor', glyph: 'anchor', disabled: false },
  ];
  const labels: Record<JointChoice, string> = {
    pivot: 'Pivot',
    weldPivot: 'Weld + pivot',
    weld: 'Weld',
    slider: 'Slider',
    anchor: 'Anchor',
  };

  // right column: realizations for any pivot-like joint; hinge/spherical
  // controls for joints that PIVOT (incl. the weld+pivot junction) — a full
  // WELD is rigid, so axis controls make no sense there (hidden, Joe's
  // request)
  const showRealizations =
    kind === 'pivot' || kind === 'weldPivot' || kind === 'weld' || kind === 'slider';
  const showPivotControls = pivot !== undefined && (kind === 'pivot' || kind === 'weldPivot');
  const twoCol = showRealizations || showPivotControls;

  const width = twoCol ? 396 : WIDTH + 26;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard roving-focus container, not an interactive control
    <div
      ref={ref}
      data-testid="joint-popover"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpenPopover(null);
        onMenuKeyDown(e);
      }}
      style={{ ...menuStyle, position: 'fixed', left, top, width, zIndex: 60 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 6px' }}>
        <GripHandle testid="joint-popover-handle" drag={drag} vertical />
        <span style={captionStyle}>Joint · node {nodeId.slice(0, 4)}</span>
        <button
          type="button"
          data-testid="joint-popover-close"
          title="close"
          onClick={() => setOpenPopover(null)}
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'none',
            color: T.faint,
            cursor: 'pointer',
            fontSize: 13,
            padding: '0 2px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      <button
        type="button"
        data-testid="joint-attached-toggle"
        aria-pressed={attached}
        disabled={!attached}
        onClick={breakAttachment}
        title={attached ? 'break the attachment — the ends move freely again' : undefined}
        style={{
          display: 'block',
          width: 'calc(100% - 8px)',
          margin: '0 4px 6px',
          border: 'none',
          borderRadius: 8,
          padding: '6px 8px',
          font: `500 12px ${T.sans}`,
          textAlign: 'center',
          cursor: attached ? 'pointer' : 'default',
          background: attached ? T.accentTint : T.chip,
          color: attached ? T.accentText : T.muted,
        }}
      >
        {attachedLabel}
      </button>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <div style={{ flex: `0 0 ${WIDTH - 24}px` }}>
          {rows.map((r) => (
            <button
              type="button"
              key={r.kind}
              data-testid={`joint-${r.kind}`}
              disabled={r.disabled}
              onClick={() => choose(r.kind)}
              style={{
                ...rowStyle(current === r.kind),
                ...(r.disabled ? { opacity: 0.4, cursor: 'default' } : {}),
              }}
            >
              <span style={{ display: 'grid', placeItems: 'center', width: 18 }}>
                <JointGlyph name={r.glyph} />
              </span>
              {labels[r.kind]}
              {current === r.kind && <span style={{ marginLeft: 'auto' }}>✓</span>}
            </button>
          ))}
          {/* hinge / spherical choice + axis for the pivot living here (v7) —
              pivots only; a weld is rigid so the controls are hidden */}
          {showPivotControls && pivot && (
            <>
              <div style={{ borderTop: `1px solid ${T.hairline}`, margin: '5px 4px' }} />
              <PivotJointControls pivot={pivot} />
            </>
          )}
        </div>
        {showRealizations && (
          <>
            <div style={{ borderLeft: `1px solid ${T.hairline}`, margin: '0 6px' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* a weld+pivot junction MOVES as a pivot, so it gets the
                  pivot realization set (heat-wrapped pivot, rope lashing, …) */}
              <RealizationRows
                mech={mech}
                nodeId={nodeId}
                kind={kind === 'weldPivot' ? 'pivot' : (kind as 'pivot' | 'weld' | 'slider')}
                frame={frame}
              />
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function memberCountAtNode(mech: Mechanism, nodeId: string): number {
  let members = 0;
  for (const el of mech.elements) {
    if (el.type === 'link' || el.type === 'telescope') {
      if (el.nodeA === nodeId || el.nodeB === nodeId) members++;
    } else if (el.type === 'bentLink' && el.nodeIds.includes(nodeId)) members++;
  }
  return members;
}

/** The joint kind rendered at a node — shared with the selection card's
 * End A/B chips and the canvas glyphs' popover checkmark. A PARTIAL weld set
 * (mid-pipe junction: split halves welded, arrivals pivoting) reads as
 * 'weldPivot'; 'weld' is reserved for a fully-welded junction. */
export function jointKindAtNode(mech: Mechanism, nodeId: string): JointChoice | 'end' {
  const node = mech.nodes.find((n) => n.id === nodeId);
  if (!node) return 'end';
  if (node.kind === 'anchor') return 'anchor';
  if (mech.elements.some((e) => e.type === 'slider' && e.nodeId === nodeId)) return 'slider';
  const pivot = mech.elements.find((e) => e.type === 'pivot' && e.nodeId === nodeId);
  if (pivot && pivot.type === 'pivot' && pivot.welds.length > 0) {
    return pivot.welds.length >= pivot.memberIds.length - 1 ? 'weld' : 'weldPivot';
  }
  return pivot || memberCountAtNode(mech, nodeId) >= 2 ? 'pivot' : 'end';
}
