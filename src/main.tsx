import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// self-hosted IBM Plex (design handoff type ramp; no network at runtime)
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/500.css';
import './index.css';
import { App } from './ui/App';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
