import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import {
  addInputChannel,
  removeInputChannel,
  setGravity,
  setInputChannel,
} from '../../state/docOps';
import type { InputChannel, UnitsPreference } from '../../schema';
import { formatForce, solverStatusLabel } from './forces';

const STATUS_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  idle: { bg: '#eee', fg: '#666', border: '#ccc' },
  settling: { bg: '#fef6e0', fg: '#8a6d00', border: '#e6c65a' },
  converged: { bg: '#e8f2e8', fg: '#262', border: '#9c9' },
  nonConverged: { bg: '#fdd', fg: '#a00', border: '#e99' },
  unavailable: { bg: '#eee', fg: '#666', border: '#ccc' },
};

/** Required holding effort for a channel: force (N/lbf) for displacement
 * channels, torque (N·m) for angle channels (§5.2). */
function formatRequiredInput(value: number, channel: InputChannel, units: UnitsPreference): string {
  if (channel.kind === 'angle') return `${value.toFixed(2)} N·m`;
  return formatForce(value, units);
}

/** Bottom panel (§8.3): input-channel sliders with lock toggles, per-mechanism
 * gravity toggle, the equilibrium (forces) toggle, and the solver status. */
export function ForcesPanel() {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const beginGesture = useAppStore((s) => s.beginGesture);
  const endGesture = useAppStore((s) => s.endGesture);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const equilibriumOn = useEditorStore((s) => s.equilibriumOn);
  const setEquilibriumOn = useEditorStore((s) => s.setEquilibriumOn);
  const equilibrium = useEditorStore((s) => s.equilibrium);

  const mech = doc?.mechanisms.find((m) => m.id === activeMechanismId) ?? null;
  if (!doc || !mech) return null;

  const units = doc.unitsPreference;
  const status = STATUS_COLOR[equilibrium.status] ?? STATUS_COLOR.idle!;
  const compressionCount = equilibrium.ropesRequiringCompression.length;

  return (
    <div
      data-testid="forces-panel"
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '6px 12px',
        borderTop: '1px solid #ddd',
        fontSize: 13,
        background: '#fafafb',
      }}
    >
      <label data-testid="equilibrium-toggle-label" style={{ fontWeight: 600 }}>
        <input
          type="checkbox"
          data-testid="equilibrium-toggle"
          checked={equilibriumOn}
          onChange={(e) => setEquilibriumOn(e.target.checked)}
        />{' '}
        Equilibrium (forces)
      </label>

      <label>
        <input
          type="checkbox"
          data-testid="gravity-toggle"
          checked={mech.gravityOn}
          onChange={(e) => updateCurrent((cur) => setGravity(cur, mech.id, e.target.checked))}
        />{' '}
        gravity
      </label>

      {equilibriumOn && (
        <span
          data-testid="solver-status"
          style={{
            padding: '2px 10px',
            borderRadius: 10,
            background: status.bg,
            color: status.fg,
            border: `1px solid ${status.border}`,
          }}
        >
          solver: {solverStatusLabel(equilibrium.status)}
        </span>
      )}

      {equilibriumOn && compressionCount > 0 && (
        <span data-testid="compression-warning" style={{ color: '#c00' }}>
          ⚠ {compressionCount} rope{compressionCount > 1 ? 's' : ''}{' '}
          {compressionCount > 1 ? 'require' : 'requires'} compression
        </span>
      )}

      <span style={{ flex: 1 }} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {mech.inputs.map((ch) => {
          const required = equilibrium.requiredInputs[ch.name];
          return (
            <div
              key={ch.id}
              data-testid="input-channel"
              style={{ display: 'flex', gap: 5, alignItems: 'center', border: '1px solid #e2e2e8', borderRadius: 6, padding: '2px 6px' }}
            >
              <input
                data-testid="input-name"
                value={ch.name}
                onChange={(e) => updateCurrent((cur) => setInputChannel(cur, mech.id, ch.id, { name: e.target.value }))}
                style={{ width: 72, fontSize: 12, border: 'none', borderBottom: '1px solid #ccc', background: 'transparent' }}
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
                onChange={(e) => updateCurrent((cur) => setInputChannel(cur, mech.id, ch.id, { value: Number(e.target.value) }))}
                style={{ width: 90 }}
              />
              <span style={{ width: 34, textAlign: 'right', color: '#555', fontVariantNumeric: 'tabular-nums' }}>
                {ch.value.toFixed(2)}
              </span>
              <button
                data-testid="input-lock"
                title={ch.locked ? 'unlock channel' : 'lock channel (freeze value)'}
                aria-pressed={ch.locked}
                onClick={() => updateCurrent((cur) => setInputChannel(cur, mech.id, ch.id, { locked: !ch.locked }))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}
              >
                {ch.locked ? '🔒' : '🔓'}
              </button>
              {equilibriumOn && required !== undefined && (
                <span data-testid="required-input" style={{ color: '#036', whiteSpace: 'nowrap' }}>
                  needs {formatRequiredInput(required, ch, units)}
                </span>
              )}
              <button
                data-testid="input-remove"
                title="remove channel"
                onClick={() => updateCurrent((cur) => removeInputChannel(cur, mech.id, ch.id))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#a55' }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          data-testid="add-input"
          onClick={() => updateCurrent((cur) => addInputChannel(cur, mech.id).doc)}
          title="add an input channel"
        >
          + input
        </button>
      </div>
    </div>
  );
}
