// The joint popover (design handoff §6 + storyboard 1f): opened by clicking
// any node — rows re-realize the joint via docOps. The same component is the
// snap-connect menu when a drawn pipe end lands on existing geometry
// (pendingConnect): Pivot is the default, Enter accepts it, Esc cancels.
// v7 (PLANFILE-3d-conversion.md): a pivot additionally carries its 3D joint —
// hinge (with an editable axis + ⊥-panel presets) or spherical.
import { useEffect, useRef, useState } from 'react';
import type { OrientationFrame } from '../../geometry/placement';
import type { JointRealization, Mechanism, PivotElement, PivotJoint, Vec2 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import {
  assignNodeRealization,
  detachNode,
  setNodeJoint,
  setNodePivotJoint,
} from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { PANEL_FRAME } from '../quad/panelProject';
import { JointGlyph, type JointGlyphName } from './icons';
import { REALIZATION_OPTIONS } from './infopanel/fields';
import { captionStyle, menuStyle, rowStyle, T } from './theme';
import { toScreen, type ViewTransform } from './viewTransform';

const CONNECT_LABELS: Record<string, string> = {
  pivot: 'Pivot',
  weld: 'Weld',
  slider: 'Slider',
  detach: 'Detach',
};

interface Size {
  w: number;
  h: number;
}

const WIDTH = 178;

function clampedPos(anchor: Vec2, size: Size): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(anchor.x, size.w - WIDTH - 8)),
    top: Math.max(8, Math.min(anchor.y, size.h - 200)),
  };
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
  size,
  frame,
}: {
  mech: Mechanism;
  view: ViewTransform;
  /** node positions projected into the hosting panel's plane */
  positions: Record<string, Vec2>;
  size: Size;
  /** the hosting panel's frame — its normal is the default hinge axis */
  frame: OrientationFrame;
}) {
  const pending = useEditorStore((s) => s.pendingConnect);
  const openPopover = useEditorStore((s) => s.openPopover);
  const face = useEditorStore((s) => s.face);

  if (pending) return <ConnectMenu size={size} />;
  if (openPopover?.kind !== 'joint') return null;
  const node = mech.nodes.find((n) => n.id === openPopover.nodeId);
  if (!node) return null;
  const p2 = positions[node.id];
  if (!p2) return null;
  const p = toScreen(view, p2);
  const anchor = { x: p.x - 33, y: p.y + 20 };
  // design face: every pivot-like joint (pivot, weld, or slider) gets the
  // realization picker — the engineering question at that point — even when
  // it is an implicit free pin with no explicit element yet. Anchors and free
  // ends, and the whole sketch face, still get the joint-type menu.
  const kind = jointKindAtNode(mech, node.id);
  if (face === 'design' && (kind === 'pivot' || kind === 'weld' || kind === 'slider')) {
    return (
      <RealizationMenu
        mech={mech}
        nodeId={node.id}
        kind={kind}
        anchor={anchor}
        size={size}
        frame={frame}
      />
    );
  }
  return <JointMenu mech={mech} nodeId={node.id} anchor={anchor} size={size} frame={frame} />;
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

/** Design-face variant: the joint's physical realization (heat-wrap, fitting,
 * bolt-through, …) instead of joint types. Works on any pivot-like node — an
 * implicit free pin materializes a pivot element when realized. Assigning
 * re-derives maturity. */
function RealizationMenu({
  mech,
  nodeId,
  kind,
  anchor,
  size,
  frame,
}: {
  mech: Mechanism;
  nodeId: string;
  kind: 'pivot' | 'weld' | 'slider';
  anchor: Vec2;
  size: Size;
  frame: OrientationFrame;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const ref = useRef<HTMLDivElement>(null);

  // the explicit joint element, if any — carries the current realization;
  // absent for an implicit free pin (realized on first pick)
  const joint = mech.elements.find(
    (e): e is Extract<Mechanism['elements'][number], { type: 'pivot' | 'slider' }> =>
      (e.type === 'pivot' || e.type === 'slider') && e.nodeId === nodeId,
  );
  const current = joint?.realization;
  const allowed = REALIZATIONS_BY_KIND[kind];

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  const choose = (realization: JointRealization | undefined) => {
    setOpenPopover(null);
    // a materialized free pin hinges about the hosting panel's normal
    updateCurrent((cur) =>
      assignNodeRealization(cur, nodeId, realization, { kind: 'hinge', axis: { ...frame.zAxis } }),
    );
  };

  const pos = clampedPos(anchor, size);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard roving-focus container, not an interactive control
    <div
      ref={ref}
      data-testid="realization-popover"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpenPopover(null);
        onMenuKeyDown(e);
      }}
      style={{ ...menuStyle, position: 'absolute', ...pos, width: 196, zIndex: 30 }}
    >
      <div style={{ ...captionStyle, padding: '4px 8px 6px' }}>
        Realization · {kind} {nodeId.slice(0, 4)}
      </div>
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
function ConnectMenu({ size }: { size: Size }) {
  const pending = useEditorStore((s) => s.pendingConnect)!;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);

  const pos = clampedPos({ x: pending.screen.x + 10, y: pending.screen.y - 10 }, size);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard roving-focus container, not an interactive control
    <div
      ref={ref}
      data-testid="connect-menu"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) pending.choose('pivot');
        if (e.key === 'Escape') pending.cancel();
        onMenuKeyDown(e);
      }}
      style={{ ...menuStyle, position: 'absolute', ...pos, width: WIDTH, zIndex: 30 }}
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
    </div>
  );
}

type JointChoice = 'pivot' | 'weld' | 'slider' | 'anchor' | 'detach';

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
        </>
      )}
    </div>
  );
}

/** Joint-change variant: current type checked; rows that cannot apply to
 * this node are disabled rather than hidden, keeping the menu stable. */
function JointMenu({
  mech,
  nodeId,
  anchor,
  size,
  frame,
}: {
  mech: Mechanism;
  nodeId: string;
  anchor: Vec2;
  size: Size;
  frame: OrientationFrame;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  const members = memberCountAtNode(mech, nodeId);
  const kind = jointKindAtNode(mech, nodeId);
  const current: JointChoice = kind === 'end' ? 'pivot' : kind;
  const pivot = mech.elements.find(
    (e): e is PivotElement => e.type === 'pivot' && e.nodeId === nodeId,
  );

  const choose = (kind: JointChoice) => {
    setOpenPopover(null);
    if (kind === 'slider') return; // shown only as the current state
    if (kind === 'detach') {
      updateCurrent((cur) => detachNode(cur, nodeId));
      useEditorStore.getState().clearSelection();
      return;
    }
    if (kind === 'anchor') {
      updateCurrent((cur) => setNodeJoint(cur, nodeId, kind));
      return;
    }
    // pivot/weld materialized here hinge about the hosting panel's normal
    updateCurrent((cur) =>
      setNodeJoint(cur, nodeId, kind, { kind: 'hinge', axis: { ...frame.zAxis } }),
    );
  };

  const rows: Array<{ kind: JointChoice; glyph: JointGlyphName; disabled: boolean }> = [
    { kind: 'pivot', glyph: 'pivot', disabled: members < 2 && current !== 'anchor' },
    { kind: 'weld', glyph: 'weld', disabled: members < 2 },
    { kind: 'slider', glyph: 'slider', disabled: current !== 'slider' },
    { kind: 'anchor', glyph: 'anchor', disabled: false },
    { kind: 'detach', glyph: 'detach', disabled: members < 2 },
  ];
  const labels: Record<JointChoice, string> = {
    pivot: 'Pivot',
    weld: 'Weld',
    slider: 'Slider',
    anchor: 'Anchor',
    detach: 'Detach',
  };

  const pos = clampedPos(anchor, size);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard roving-focus container, not an interactive control
    <div
      ref={ref}
      data-testid="joint-popover"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpenPopover(null);
        onMenuKeyDown(e);
      }}
      style={{ ...menuStyle, position: 'absolute', ...pos, width: WIDTH + 26, zIndex: 30 }}
    >
      <div style={{ ...captionStyle, padding: '4px 8px 6px' }}>
        Joint · node {nodeId.slice(0, 4)}
      </div>
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
      {/* hinge / spherical choice + axis for the pivot living here (v7) */}
      {pivot && (
        <>
          <div style={{ borderTop: `1px solid ${T.hairline}`, margin: '5px 4px' }} />
          <PivotJointControls pivot={pivot} />
        </>
      )}
    </div>
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
 * End A/B chips and the canvas glyphs' popover checkmark. */
export function jointKindAtNode(mech: Mechanism, nodeId: string): JointChoice | 'end' {
  const node = mech.nodes.find((n) => n.id === nodeId);
  if (!node) return 'end';
  if (node.kind === 'anchor') return 'anchor';
  if (mech.elements.some((e) => e.type === 'slider' && e.nodeId === nodeId)) return 'slider';
  const pivot = mech.elements.find((e) => e.type === 'pivot' && e.nodeId === nodeId);
  if (pivot && pivot.type === 'pivot' && pivot.welds.length > 0) return 'weld';
  return pivot || memberCountAtNode(mech, nodeId) >= 2 ? 'pivot' : 'end';
}
