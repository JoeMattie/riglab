import { defineConfig } from '@playwright/test';

// Ports are overridable so parallel worktree sessions don't reuse each
// other's servers (reuseExistingServer + a fixed port silently runs the
// suite against ANOTHER checkout's build).
const port = Number(process.env.RIGLAB_E2E_PORT ?? 4173);
const devPort = Number(process.env.RIGLAB_E2E_DEV_PORT ?? 4199);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  projects: [
    {
      // smoke-test the BUILT app, not the dev server (definition of done)
      name: 'built',
      testIgnore: /console-clean/,
      use: { baseURL: `http://localhost:${port}` },
    },
    {
      // console-cleanliness sweep runs against the DEV server: React only
      // emits render warnings (duplicate keys, invalid props, setState-in-
      // render) in development builds, so the built app can't surface them
      name: 'dev-console',
      testMatch: /console-clean/,
      use: { baseURL: `http://localhost:${devPort}` },
    },
  ],
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${devPort} --strictPort`,
      url: `http://localhost:${devPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
