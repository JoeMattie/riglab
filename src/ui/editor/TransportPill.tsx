// Transport pill (design handoff §8): clip chip · play · scrubber · time ·
// speed/amp scrub labels · gravity/forces/trace chips · inputs popover.
// Replaces TransportBar.tsx and ForcesPanel.tsx (the input-channel rows and
// solver status move into the inputs popover / inline status).
import { useEffect, useRef } from 'react';
import type { InputChannel, UnitsPreference } from '../../schema';
import { useAppStore } from '../../state/appStore';
import {
  addInputChannel,
  removeInputChannel,
  setGravity,
  setInputChannel,
} from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { CLIPS, getClip } from '../../wearer';
import { formatForce, solverStatusLabel } from './forces';
import {
  captionStyle,
  dividerStyle,
  EDGE,
  menuStyle,
  miniButtonStyle,
  panelStyle,
  rowStyle,
  T,
  toggleChipStyle,
} from './theme';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** Required holding effort for a channel: force (N/lbf) for displacement
 * channels, torque (N·m) for angle channels (§5.2). */
function formatRequiredInput(value: number, channel: InputChannel, units: UnitsPreference): string {
  if (channel.kind === 'angle') return `${value.toFixed(2)} N·m`;
  return formatForce(value, units);
}

/** Toggle chip (gravity / forces / trace). Both the checked ("label ✓", bold)
 * and unchecked ("label") states are stacked in one grid cell so the button
 * always sizes to the wider checked state — toggling swaps visibility without
 * reflowing neighbours. */
function ToggleChip({
  label,
  on,
  onClick,
  testId,
  title,
}: {
  label: string;
  on: boolean;
  onClick(): void;
  testId: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      title={title}
      onClick={onClick}
      style={{ ...toggleChipStyle(on), display: 'inline-grid', placeItems: 'center' }}
    >
      <span
        aria-hidden={!on}
        style={{
          gridArea: '1 / 1',
          font: `500 12px ${T.sans}`,
          visibility: on ? 'visible' : 'hidden',
        }}
      >
        {label} ✓
      </span>
      <span
        aria-hidden={on}
        style={{
          gridArea: '1 / 1',
          font: `400 12px ${T.sans}`,
          visibility: on ? 'hidden' : 'visible',
        }}
      >
        {label}
      </span>
    </button>
  );
}

/** Drag-to-scrub numeric label (speed / amplitude). */
function ScrubLabel({
  text,
  title,
  value,
  min,
  max,
  perPx,
  onChange,
}: {
  text: string;
  title: string;
  value: number;
  min: number;
  max: number;
  perPx: number;
  onChange(v: number): void;
}) {
  const ref = useRef<{ startX: number; startV: number } | null>(null);
  return (
    <span
      title={title}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        ref.current = { startX: e.clientX, startV: value };
      }}
      onPointerMove={(e) => {
        const s = ref.current;
        if (!s) return;
        onChange(Math.min(max, Math.max(min, s.startV + (e.clientX - s.startX) * perPx)));
      }}
      onPointerUp={() => {
        ref.current = null;
      }}
      style={{
        font: `500 11.5px ${T.mono}`,
        color: T.icon,
        cursor: 'ew-resize',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

export function TransportPill() {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const beginGesture = useAppStore((s) => s.beginGesture);
  const endGesture = useAppStore((s) => s.endGesture);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const playback = useEditorStore((s) => s.playback);
  const setPlayback = useEditorStore((s) => s.setPlayback);
  const setPosePositions = useEditorStore((s) => s.setPosePositions);
  const tracing = useEditorStore((s) => s.tracing);
  const setTracing = useEditorStore((s) => s.setTracing);
  const equilibriumOn = useEditorStore((s) => s.equilibriumOn);
  const setEquilibriumOn = useEditorStore((s) => s.setEquilibriumOn);
  const equilibrium = useEditorStore((s) => s.equilibrium);
  const openPopover = useEditorStore((s) => s.openPopover);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const rafRef = useRef(0);
  const scrubberRef = useRef<HTMLSpanElement>(null);

  const clip = playback.clipName ? getClip(playback.clipName) : undefined;

  useEffect(() => {
    if (!playback.playing || !clip) return;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const state = useEditorStore.getState().playback;
      const next = (state.tS + dt * state.speed) % clip.durationS;
      setPlayback({ tS: next });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playback.playing, clip, setPlayback]);

  const mech = doc?.mechanisms.find((m) => m.id === activeMechanismId) ?? null;
  if (!doc || !mech) return null;

  const units = doc.unitsPreference;
  const progress = clip ? playback.tS / clip.durationS : 0;
  const clipOpen = openPopover?.kind === 'clip';
  const inputsOpen = openPopover?.kind === 'inputs';
  const compressionCount = equilibrium.ropesRequiringCompression.length;

  const scrubTo = (clientX: number) => {
    if (!clip || !scrubberRef.current) return;
    const r = scrubberRef.current.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setPlayback({ tS: t * clip.durationS, playing: false });
  };

  return (
    // full-width bottom strip that stops short of the DOF pill (bottom-right),
    // so the pill can grow as wide as the window allows without ever sliding
    // under it; the pill centers itself within the strip
    <div
      style={{
        position: 'absolute',
        left: EDGE,
        right: 240,
        bottom: EDGE,
        zIndex: 40,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div style={{ position: 'relative', maxWidth: '100%', pointerEvents: 'auto' }}>
        {clipOpen && (
          <div
            data-testid="clip-menu"
            style={{ ...menuStyle, position: 'absolute', left: 0, bottom: 46, width: 200 }}
          >
            <div style={{ ...captionStyle, padding: '4px 8px 6px' }}>Movement clip</div>
            <button
              type="button"
              data-testid="clip-option-rest"
              onClick={() => {
                setPlayback({ clipName: null, tS: 0, playing: false });
                setPosePositions(null);
                setOpenPopover(null);
              }}
              style={rowStyle(playback.clipName === null)}
            >
              rest pose
            </button>
            {CLIPS.map((c) => (
              <button
                type="button"
                key={c.name}
                data-testid={`clip-option-${c.name}`}
                onClick={() => {
                  setPlayback({ clipName: c.name, tS: 0, playing: false });
                  setOpenPopover(null);
                }}
                style={rowStyle(playback.clipName === c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {inputsOpen && (
          <div
            data-testid="inputs-panel"
            style={{ ...menuStyle, position: 'absolute', right: 0, bottom: 46, width: 320 }}
          >
            <div style={{ ...captionStyle, padding: '4px 8px 6px' }}>Input channels</div>
            {mech.inputs.map((ch) => {
              const required = equilibrium.requiredInputs[ch.name];
              return (
                <div
                  key={ch.id}
                  data-testid="input-channel"
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    padding: '4px 8px',
                    borderRadius: 8,
                  }}
                >
                  <input
                    data-testid="input-name"
                    value={ch.name}
                    onChange={(e) =>
                      updateCurrent((cur) =>
                        setInputChannel(cur, mech.id, ch.id, { name: e.target.value }),
                      )
                    }
                    style={{
                      width: 64,
                      font: `400 12px ${T.sans}`,
                      border: 'none',
                      borderBottom: `1px solid ${T.border}`,
                      background: 'transparent',
                      outline: 'none',
                      padding: 0,
                    }}
                  />
                  <input
                    type="range"
                    data-testid="input-slider"
                    min={ch.min}
                    max={ch.max}
                    step={(ch.max - ch.min) / 100 || 0.01}
                    value={ch.value}
                    disabled={ch.locked}
                    onPointerDown={beginGesture}
                    onPointerUp={endGesture}
                    onChange={(e) =>
                      updateCurrent((cur) =>
                        setInputChannel(cur, mech.id, ch.id, { value: Number(e.target.value) }),
                      )
                    }
                    style={{ width: 80 }}
                  />
                  <span
                    style={{
                      width: 34,
                      textAlign: 'right',
                      font: `500 11.5px ${T.mono}`,
                      color: T.muted,
                    }}
                  >
                    {ch.value.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    data-testid="input-lock"
                    title={ch.locked ? 'unlock channel' : 'lock channel (freeze value)'}
                    aria-pressed={ch.locked}
                    onClick={() =>
                      updateCurrent((cur) =>
                        setInputChannel(cur, mech.id, ch.id, { locked: !ch.locked }),
                      )
                    }
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: 13,
                      padding: 0,
                    }}
                  >
                    {ch.locked ? '🔒' : '🔓'}
                  </button>
                  {equilibriumOn && required !== undefined && (
                    <span
                      data-testid="required-input"
                      style={{ color: '#036', whiteSpace: 'nowrap', fontSize: 11.5 }}
                    >
                      needs {formatRequiredInput(required, ch, units)}
                    </span>
                  )}
                  <button
                    type="button"
                    data-testid="input-remove"
                    title="remove channel"
                    onClick={() => updateCurrent((cur) => removeInputChannel(cur, mech.id, ch.id))}
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      color: '#a55',
                      marginLeft: 'auto',
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              data-testid="add-input"
              title="add an input channel"
              onClick={() => updateCurrent((cur) => addInputChannel(cur, mech.id).doc)}
              style={{ ...rowStyle(false), color: T.accent }}
            >
              + input
            </button>
          </div>
        )}

        <div
          data-testid="transport-pill"
          style={{
            ...panelStyle,
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '9px 14px',
            // last-resort fallback: on very narrow windows the pill wraps to a
            // second row instead of overflowing the strip
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: '100%',
          }}
        >
          <button
            type="button"
            data-testid="clip-select"
            onClick={() => setOpenPopover(clipOpen ? null : { kind: 'clip' })}
            style={{ ...miniButtonStyle, fontWeight: 400 }}
          >
            {playback.clipName ?? 'rest pose'} ▾
          </button>
          <button
            type="button"
            data-testid="play-pause"
            title={playback.playing ? 'pause' : 'play'}
            disabled={!clip}
            onClick={() => setPlayback({ playing: !playback.playing })}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: T.text,
              border: 'none',
              cursor: clip ? 'pointer' : 'default',
              display: 'grid',
              placeItems: 'center',
              opacity: clip ? 1 : 0.4,
              padding: 0,
              flex: 'none',
            }}
          >
            {playback.playing ? (
              <svg width={9} height={11} viewBox="0 0 9 11" aria-hidden="true">
                <rect x={0.5} y={0.5} width={2.8} height={10} fill="#fff" />
                <rect x={5.7} y={0.5} width={2.8} height={10} fill="#fff" />
              </svg>
            ) : (
              <svg width={10} height={12} viewBox="0 0 10 12" aria-hidden="true">
                <path d="M1 1 L9 6 L1 11 Z" fill="#fff" />
              </svg>
            )}
          </button>
          <span
            ref={scrubberRef}
            data-testid="clip-scrubber"
            onPointerDown={(e) => {
              if (!clip) return;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              scrubTo(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) scrubTo(e.clientX);
            }}
            style={{
              position: 'relative',
              width: 210,
              height: 18,
              display: 'flex',
              alignItems: 'center',
              cursor: clip ? 'pointer' : 'default',
              opacity: clip ? 1 : 0.5,
            }}
          >
            <span style={{ width: '100%', height: 4, borderRadius: 2, background: '#e9e9ee' }} />
            <span
              style={{
                position: 'absolute',
                left: 0,
                width: `${progress * 100}%`,
                height: 4,
                borderRadius: 2,
                background: T.accent,
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: `calc(${progress * 100}% - 7px)`,
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#fff',
                border: `2px solid ${T.accent}`,
                boxShadow: '0 1px 3px rgba(20,24,40,.2)',
                boxSizing: 'border-box',
              }}
            />
          </span>
          <span style={{ font: `500 11.5px ${T.mono}`, color: T.muted, whiteSpace: 'nowrap' }}>
            {fmtTime(playback.tS)} / {fmtTime(clip?.durationS ?? 0)}
          </span>
          <span style={{ ...dividerStyle, height: 20 }} />
          <ScrubLabel
            text={`${playback.speed.toFixed(1)}×`}
            title="speed — drag to scrub"
            value={playback.speed}
            min={0.2}
            max={3}
            perPx={0.01}
            onChange={(v) => setPlayback({ speed: v })}
          />
          <ScrubLabel
            text={`amp ${Math.round(playback.amplitude * 100)}%`}
            title="amplitude — drag to scrub"
            value={playback.amplitude}
            min={0}
            max={1.5}
            perPx={0.005}
            onChange={(v) => setPlayback({ amplitude: v })}
          />
          <span style={{ ...dividerStyle, height: 20 }} />
          <ToggleChip
            testId="gravity-toggle"
            label="gravity"
            on={mech.gravityOn}
            onClick={() => updateCurrent((cur) => setGravity(cur, mech.id, !mech.gravityOn))}
          />
          <ToggleChip
            testId="equilibrium-toggle"
            label="forces"
            title="equilibrium force overlays"
            on={equilibriumOn}
            onClick={() => setEquilibriumOn(!equilibriumOn)}
          />
          <ToggleChip
            testId="trace-toggle"
            label="trace"
            title="trace the dragged node's motion path"
            on={tracing}
            onClick={() => setTracing(!tracing)}
          />
          <span
            data-testid="solver-status"
            title="equilibrium solver status"
            style={{
              font: `500 11px ${T.mono}`,
              color: T.muted,
              whiteSpace: 'nowrap',
              width: 108,
              flex: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {equilibriumOn ? solverStatusLabel(equilibrium.status) : ''}
          </span>
          {equilibriumOn && compressionCount > 0 && (
            <span
              data-testid="compression-warning"
              style={{ color: '#c00', fontSize: 11.5, whiteSpace: 'nowrap' }}
            >
              ⚠ {compressionCount} rope{compressionCount > 1 ? 's' : ''}{' '}
              {compressionCount > 1 ? 'require' : 'requires'} compression
            </span>
          )}
          <button
            type="button"
            data-testid="inputs-toggle"
            onClick={() => setOpenPopover(inputsOpen ? null : { kind: 'inputs' })}
            style={toggleChipStyle(inputsOpen)}
          >
            inputs ({mech.inputs.length}) ▾
          </button>
        </div>
      </div>
    </div>
  );
}
