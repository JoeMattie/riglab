// Controls dock (§4.4/§8.3 bottom panel): build controls, map their axes to
// input channels, work them with per-type widgets (live during playback), and
// record/play control clips composed with a movement clip on one timeline.
import { useEffect } from 'react';
import { buildControlClip, controlChannelValues } from '../../controls';
import type { Control, ControlType } from '../../schema';
import { wearerAnchorSchema } from '../../schema';
import { useAppStore } from '../../state/appStore';
import {
  addControl,
  addControlAxis,
  deleteControlClip,
  patchControlAxis,
  removeControl,
  removeControlAxis,
  renameControl,
  setControlMount,
  upsertControlClip,
} from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { getClip } from '../../wearer';
import { EDGE, panelStyle, T } from '../editor/theme';
import { Axis2DPad, AxisDial, type AxisHandlers, AxisSlider } from './widgets';

const CONTROL_TYPES: ControlType[] = ['lever', 'yoke', 'twistGrip', 'trigger', 'slider2d'];
const ANCHORS = wearerAnchorSchema.options;
// records with no movement clip advance the timeline freely up to this cap
const RECORD_MAX_S = 10;

export function ControlsDock({ left = EDGE }: { left?: number }) {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const beginGesture = useAppStore((s) => s.beginGesture);
  const endGesture = useAppStore((s) => s.endGesture);
  const playback = useEditorStore((s) => s.playback);
  const setPlayback = useEditorStore((s) => s.setPlayback);
  const recording = useEditorStore((s) => s.recording);
  const startRecording = useEditorStore((s) => s.startRecording);
  const stopRecording = useEditorStore((s) => s.stopRecording);
  const recordFrame = useEditorStore((s) => s.recordFrame);
  const setHeldChannels = useEditorStore((s) => s.setHeldChannels);
  const setControlsOpen = useEditorStore((s) => s.setControlsOpen);

  // Timeline driver for control-only playback + recording capture. When a
  // movement clip is active, TransportPill owns tS; here we only capture record
  // frames. Otherwise (control clip / recording alone) we advance tS.
  useEffect(() => {
    if (!playback.playing) return;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useEditorStore.getState();
      const cur = useAppStore.getState().current;
      if (!s.playback.clipName) {
        const clip = cur?.controlClips.find((c) => c.name === s.playback.controlClipName);
        const dur = clip?.durationS ?? RECORD_MAX_S;
        const next = (s.playback.tS + dt * s.playback.speed) % dur;
        setPlayback({ tS: next });
      }
      if (s.recording && cur) {
        recordFrame({ tS: s.playback.tS, values: controlChannelValues(cur.controls) });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playback.playing, setPlayback, recordFrame]);

  if (!doc) return null;

  const channelNames = [...new Set(doc.mechanism.inputs.map((i) => i.name))];

  const grabAxis = (control: Control) => {
    beginGesture();
    setHeldChannels(control.axes.map((a) => a.channelName));
  };
  const release = () => {
    endGesture();
    setHeldChannels([]);
  };
  const handlersFor = (control: Control): AxisHandlers => ({
    onChange: (axisId, value) =>
      updateCurrent((d) => patchControlAxis(d, control.id, axisId, { value })),
    onGrab: () => grabAxis(control),
    onRelease: release,
  });

  const onRecord = () => {
    if (recording) {
      const frames = stopRecording();
      const name = `control clip ${doc.controlClips.length + 1}`;
      const clip = buildControlClip(name, frames);
      if (clip) {
        updateCurrent((d) => upsertControlClip(d, clip));
        setPlayback({ controlClipName: name });
      }
    } else {
      startRecording();
    }
  };

  return (
    <div
      style={{
        ...panelStyle,
        position: 'absolute',
        left,
        bottom: 76,
        width: 340,
        maxHeight: '58vh',
        overflowY: 'auto',
        padding: 12,
        zIndex: 45,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
      data-testid="controls-dock"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: T.muted,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Controls
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            data-testid="add-control"
            onClick={() =>
              updateCurrent((d) => addControl(d, 'lever', channelNames[0] ?? 'channel').doc)
            }
            style={addBtn}
          >
            + control
          </button>
          <button
            type="button"
            data-testid="controls-close"
            title="close"
            onClick={() => setControlsOpen(false)}
            style={{ ...addBtn, background: 'transparent', color: T.muted }}
          >
            ✕
          </button>
        </div>
      </div>

      {doc.controls.length === 0 && (
        <div style={{ fontSize: 12, color: T.muted }}>
          No controls yet. Add one to map a widget onto your input channels.
        </div>
      )}

      {doc.controls.map((control) => (
        <ControlCard
          key={control.id}
          control={control}
          channelNames={channelNames}
          handlers={handlersFor(control)}
          onType={(type) =>
            updateCurrent((d) => ({
              ...d,
              controls: d.controls.map((c) => (c.id === control.id ? { ...c, type } : c)),
            }))
          }
          onName={(name) => updateCurrent((d) => renameControl(d, control.id, name))}
          onMount={(mount) => updateCurrent((d) => setControlMount(d, control.id, mount))}
          onAddAxis={() =>
            updateCurrent((d) => addControlAxis(d, control.id, channelNames[0] ?? 'channel'))
          }
          onRemoveAxis={(axisId) => updateCurrent((d) => removeControlAxis(d, control.id, axisId))}
          onPatchAxis={(axisId, patch) =>
            updateCurrent((d) => patchControlAxis(d, control.id, axisId, patch))
          }
          onRemove={() => updateCurrent((d) => removeControl(d, control.id))}
        />
      ))}

      {/* control-clip transport */}
      <div
        style={{
          borderTop: `1px solid ${T.hairline}`,
          paddingTop: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: T.muted,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Control clip
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            data-testid="control-clip-select"
            value={playback.controlClipName ?? ''}
            onChange={(e) => setPlayback({ controlClipName: e.target.value || null })}
            style={selectStyle}
          >
            <option value="">none</option>
            {doc.controlClips.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="record-control-clip"
            onClick={onRecord}
            style={{
              ...addBtn,
              background: recording ? T.dangerTint : T.chip,
              color: recording ? T.dangerText : T.text,
            }}
          >
            {recording ? '■ stop' : '● record'}
          </button>
          {playback.controlClipName && (
            <button
              type="button"
              title="delete clip"
              onClick={() => {
                const name = playback.controlClipName!;
                setPlayback({ controlClipName: null });
                updateCurrent((d) => deleteControlClip(d, name));
              }}
              style={{ ...addBtn, background: 'transparent', color: T.muted }}
            >
              🗑
            </button>
          )}
        </div>
        {recording && (
          <div style={{ fontSize: 11, color: T.dangerText }}>
            Recording — work the widgets
            {playback.clipName ? ` while ${playback.clipName} plays` : ''}.
          </div>
        )}
        <div style={{ fontSize: 11, color: T.muted }}>
          {getClip(playback.clipName ?? '') && playback.controlClipName
            ? `${playback.clipName} + ${playback.controlClipName} play on one timeline.`
            : 'A control clip plays on the shared transport, composable with a movement clip.'}
        </div>
      </div>
    </div>
  );
}

function ControlCard({
  control,
  channelNames,
  handlers,
  onType,
  onName,
  onMount,
  onAddAxis,
  onRemoveAxis,
  onPatchAxis,
  onRemove,
}: {
  control: Control;
  channelNames: string[];
  handlers: AxisHandlers;
  onType: (t: ControlType) => void;
  onName: (n: string) => void;
  onMount: (m: Control['mount']) => void;
  onAddAxis: () => void;
  onRemoveAxis: (axisId: string) => void;
  onPatchAxis: (axisId: string, patch: Partial<Control['axes'][number]>) => void;
  onRemove: () => void;
}) {
  const mountValue = control.mount?.kind === 'wearerAnchor' ? control.mount.anchor : '';
  return (
    <div
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          value={control.name}
          onChange={(e) => onName(e.target.value)}
          style={{
            flex: 1,
            border: 'none',
            font: `600 13px ${T.sans}`,
            color: T.text,
            background: 'transparent',
          }}
        />
        <select
          value={control.type}
          onChange={(e) => onType(e.target.value as ControlType)}
          style={selectStyle}
        >
          {CONTROL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="remove control"
          onClick={onRemove}
          style={{ ...addBtn, background: 'transparent', color: T.muted }}
        >
          ✕
        </button>
      </div>

      {/* manipulation widget */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          padding: '4px 0',
        }}
      >
        <ControlWidget control={control} h={handlers} />
      </div>

      {/* mount */}
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.muted }}
      >
        mount
        <select
          data-testid="control-mount"
          value={mountValue}
          onChange={(e) =>
            onMount(
              e.target.value
                ? { kind: 'wearerAnchor', anchor: e.target.value as never }
                : undefined,
            )
          }
          style={selectStyle}
        >
          <option value="">none (desk-fixed)</option>
          {ANCHORS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      {/* axis → channel mappings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {control.axes.map((axis) => (
          <div
            key={axis.id}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
          >
            <input
              value={axis.name}
              onChange={(e) => onPatchAxis(axis.id, { name: e.target.value })}
              style={{
                width: 52,
                border: `1px solid ${T.border}`,
                borderRadius: 5,
                padding: '2px 4px',
                fontSize: 11,
              }}
            />
            <span style={{ color: T.muted }}>→</span>
            <select
              value={axis.channelName}
              onChange={(e) => onPatchAxis(axis.id, { channelName: e.target.value })}
              style={{ ...selectStyle, flex: 1 }}
            >
              {[...new Set([axis.channelName, ...channelNames])].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="invert"
              onClick={() => onPatchAxis(axis.id, { invert: !axis.invert })}
              style={{ ...miniBtn, color: axis.invert ? T.accentText : T.muted }}
            >
              ±
            </button>
            <button
              type="button"
              title={axis.locked ? 'unlock channel' : 'lock channel'}
              data-testid={`axis-lock-${axis.id}`}
              onClick={() => onPatchAxis(axis.id, { locked: !axis.locked })}
              style={{ ...miniBtn, color: axis.locked ? T.accentText : T.muted }}
            >
              {axis.locked ? '🔒' : '🔓'}
            </button>
            {control.axes.length > 1 && (
              <button
                type="button"
                title="remove axis"
                onClick={() => onRemoveAxis(axis.id)}
                style={miniBtn}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={onAddAxis} style={{ ...addBtn, alignSelf: 'flex-start' }}>
          + axis
        </button>
      </div>
    </div>
  );
}

/** Compose the widget for a control from its type + available axes. */
function ControlWidget({ control, h }: { control: Control; h: AxisHandlers }) {
  const a = control.axes;
  if (control.type === 'twistGrip' && a[0]) return <AxisDial axis={a[0]} h={h} />;
  if (control.type === 'slider2d' && a[0] && a[1])
    return <Axis2DPad axisX={a[0]} axisY={a[1]} h={h} />;
  if (control.type === 'yoke') {
    // tilt + twist on the 2D pad (push/pull vs. left/right); further axes
    // (e.g. trigger) as sliders alongside
    return (
      <>
        {a[0] && a[1] && <Axis2DPad axisX={a[1]} axisY={a[0]} h={h} />}
        <div style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {a.slice(2).map((axis) => (
            <AxisSlider key={axis.id} axis={axis} h={h} />
          ))}
        </div>
      </>
    );
  }
  // lever / trigger / fallback: a slider per axis
  return (
    <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {a.map((axis) => (
        <AxisSlider key={axis.id} axis={axis} h={h} />
      ))}
    </div>
  );
}

const addBtn: React.CSSProperties = {
  border: 'none',
  background: T.chip,
  borderRadius: 7,
  padding: '4px 10px',
  font: `500 12px ${T.sans}`,
  color: T.text,
  cursor: 'pointer',
};

const miniBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 12,
  padding: '0 2px',
  color: T.muted,
};

const selectStyle: React.CSSProperties = {
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  padding: '3px 6px',
  fontSize: 12,
  background: T.panel,
  color: T.text,
};
