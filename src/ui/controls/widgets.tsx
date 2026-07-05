// Per-type control manipulation widgets (§4.4): a 2D pad for yoke tilt /
// slider2d, a ring/dial for twist, and a slider for levers/triggers. Each is
// draggable live (during clip playback too). A widget only reads/writes axis
// VALUES; the parent brackets the drag (undo gesture + held-channel override)
// and persists through docOps.
import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import type { ControlAxis } from '../../schema';
import { T } from '../editor/theme';

export interface AxisHandlers {
  onChange(axisId: string, value: number): void;
  onGrab(axis: ControlAxis): void;
  onRelease(): void;
}

const norm = (v: number, min: number, max: number) => (max === min ? 0 : (v - min) / (max - min));
const denorm = (t: number, min: number, max: number) => min + t * (max - min);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Horizontal slider for a single axis (lever, trigger, spare axes). */
export function AxisSlider({ axis, h }: { axis: ControlAxis; h: AxisHandlers }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 52, fontSize: 11, color: T.muted }}>{axis.name}</span>
      <input
        type="range"
        min={axis.min}
        max={axis.max}
        step={(axis.max - axis.min) / 200 || 0.01}
        value={axis.value}
        disabled={axis.locked}
        onPointerDown={() => h.onGrab(axis)}
        onPointerUp={h.onRelease}
        onPointerLeave={h.onRelease}
        onChange={(e) => h.onChange(axis.id, Number(e.target.value))}
        style={{ flex: 1, accentColor: T.accent }}
      />
      <span
        style={{ width: 34, textAlign: 'right', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
      >
        {axis.value.toFixed(2)}
      </span>
    </div>
  );
}

/** Rotary dial for a twist axis. Drag around the ring to set the value. */
export function AxisDial({ axis, h }: { axis: ControlAxis; h: AxisHandlers }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: ReactPointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // angle from straight-down, −135°..+135° sweep maps to the axis range
    const ang = Math.atan2(e.clientX - cx, cy - e.clientY);
    const t = clamp01((ang + (3 * Math.PI) / 4) / ((3 * Math.PI) / 2));
    h.onChange(axis.id, denorm(t, axis.min, axis.max));
  };
  const angle = -135 + norm(axis.value, axis.min, axis.max) * 270;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <button
        type="button"
        ref={ref as never}
        aria-label={axis.name}
        disabled={axis.locked}
        onPointerDown={(e) => {
          if (axis.locked) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          h.onGrab(axis);
          set(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(e)}
        onPointerUp={h.onRelease}
        style={{
          position: 'relative',
          width: 54,
          height: 54,
          borderRadius: '50%',
          border: `2px solid ${T.border}`,
          background: '#fff',
          cursor: axis.locked ? 'not-allowed' : 'grab',
          touchAction: 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 2,
            height: 22,
            background: T.accent,
            transformOrigin: 'bottom center',
            transform: `translate(-50%,-100%) rotate(${angle}deg)`,
          }}
        />
      </button>
      <span style={{ fontSize: 11, color: T.muted }}>{axis.name}</span>
    </div>
  );
}

/** 2D pad for two axes (yoke tilt / slider2d). Drag the puck; x→axisX, y→axisY
 * (up = +). */
export function Axis2DPad({
  axisX,
  axisY,
  h,
}: {
  axisX: ControlAxis;
  axisY: ControlAxis;
  h: AxisHandlers;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: ReactPointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const tx = clamp01((e.clientX - r.left) / r.width);
    const ty = clamp01((e.clientY - r.top) / r.height);
    h.onChange(axisX.id, denorm(tx, axisX.min, axisX.max));
    h.onChange(axisY.id, denorm(1 - ty, axisY.min, axisY.max));
  };
  const px = norm(axisX.value, axisX.min, axisX.max) * 100;
  const py = (1 - norm(axisY.value, axisY.min, axisY.max)) * 100;
  const locked = axisX.locked && axisY.locked;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <button
        type="button"
        ref={ref as never}
        aria-label={`${axisX.name} / ${axisY.name} pad`}
        disabled={locked}
        onPointerDown={(e) => {
          if (locked) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          h.onGrab(axisX);
          set(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(e)}
        onPointerUp={h.onRelease}
        style={{
          position: 'relative',
          width: 96,
          height: 96,
          padding: 0,
          borderRadius: 10,
          border: `1px solid ${T.border}`,
          background: 'linear-gradient(#fafafa,#f0f0f2)',
          cursor: locked ? 'not-allowed' : 'crosshair',
          touchAction: 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: `${px}%`,
            top: `${py}%`,
            width: 14,
            height: 14,
            marginLeft: -7,
            marginTop: -7,
            borderRadius: '50%',
            background: T.accent,
            boxShadow: '0 1px 4px rgba(20,24,40,.3)',
          }}
        />
      </button>
      <span style={{ fontSize: 11, color: T.muted }}>
        {axisX.name} / {axisY.name}
      </span>
    </div>
  );
}
