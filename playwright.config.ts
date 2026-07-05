import { defineConfig } from '@playwright/test';

// The port is overridable so parallel worktree sessions don't reuse each
// other's preview server (reuseExistingServer + a fixed port silently runs
// the suite against ANOTHER checkout's build).
const port = Number(process.env.RIGLAB_E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${port}`,
  },
  webServer: {
    // smoke-test the BUILT app, not the dev server (definition of done)
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
