import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RapierAdapter } from './candidates/rapier';
import { settle } from './harness/run';
import { hangingTautScenario } from './harness/scenarios';
import { RendererBench } from './ui/RendererBench';
import { SolverBench } from './ui/SolverBench';

/** Automation hook for the Cloudflare Pages / WASM verification: runs the
 * hanging-mass scenario on Rapier (WASM) headlessly and returns the tension,
 * which must be ≈ 49.05 N. */
(window as unknown as { __spikeCheck: () => Promise<{ tension: number; converged: boolean }> }).__spikeCheck =
  async () => {
    const adapter = new RapierAdapter();
    await adapter.init(hangingTautScenario());
    const result = settle(adapter);
    const tension = adapter.forces().rope ?? NaN;
    adapter.dispose();
    return { tension, converged: result.converged };
  };

function App() {
  const [tab, setTab] = useState<'solver' | 'renderer'>('solver');
  return (
    <div>
      <h2>PVC Rig Lab — Phase 0 spike harness (throwaway)</h2>
      <div className="row">
        <button style={{ fontWeight: tab === 'solver' ? 'bold' : 'normal' }} onClick={() => setTab('solver')}>
          solver bench
        </button>
        <button
          style={{ fontWeight: tab === 'renderer' ? 'bold' : 'normal' }}
          onClick={() => setTab('renderer')}
        >
          renderer bench
        </button>
      </div>
      <div style={{ display: tab === 'solver' ? 'block' : 'none' }}>
        <SolverBench />
      </div>
      <div style={{ display: tab === 'renderer' ? 'block' : 'none' }}>
        <RendererBench />
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
