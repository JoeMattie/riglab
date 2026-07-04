import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../state/editorStore';
import { CLIPS, getClip } from '../../wearer';

export function TransportBar() {
  const playback = useEditorStore((s) => s.playback);
  const setPlayback = useEditorStore((s) => s.setPlayback);
  const setPosePositions = useEditorStore((s) => s.setPosePositions);
  const dof = useEditorStore((s) => s.dof);
  const violated = useEditorStore((s) => s.violated);
  const rafRef = useRef(0);

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

  const overOrBroken =
    dof !== null && (dof.classification === 'overconstrained' || violated.length > 0);

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '8px 12px',
        borderTop: '1px solid #ddd',
        fontSize: 13,
      }}
    >
      <select
        data-testid="clip-select"
        value={playback.clipName ?? ''}
        onChange={(e) => {
          const name = e.target.value || null;
          setPlayback({ clipName: name, tS: 0, playing: false });
          if (!name) setPosePositions(null);
        }}
      >
        <option value="">silhouette: rest pose</option>
        {CLIPS.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        data-testid="play-pause"
        disabled={!clip}
        onClick={() => setPlayback({ playing: !playback.playing })}
      >
        {playback.playing ? '⏸ pause' : '▶ play'}
      </button>
      <input
        type="range"
        min={0}
        max={clip?.durationS ?? 1}
        step={0.01}
        value={playback.tS}
        disabled={!clip}
        onChange={(e) => setPlayback({ tS: Number(e.target.value), playing: false })}
        style={{ width: 180 }}
      />
      <label>
        speed{' '}
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.1}
          value={playback.speed}
          onChange={(e) => setPlayback({ speed: Number(e.target.value) })}
          style={{ width: 80 }}
        />
      </label>
      <label>
        amplitude{' '}
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={playback.amplitude}
          onChange={(e) => setPlayback({ amplitude: Number(e.target.value) })}
          style={{ width: 80 }}
        />
      </label>
      <span style={{ flex: 1 }} />
      {dof && (
        <span
          data-testid="dof-badge"
          style={{
            padding: '2px 10px',
            borderRadius: 10,
            background: overOrBroken ? '#fdd' : '#e8f2e8',
            color: overOrBroken ? '#a00' : '#262',
            border: `1px solid ${overOrBroken ? '#e99' : '#9c9'}`,
          }}
        >
          DOF {dof.dof} · {dof.classification}
          {violated.length > 0 ? ` · ${violated.length} conflict(s)` : ''}
        </span>
      )}
    </div>
  );
}
