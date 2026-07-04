// Builds ONLY the spike page, for the Cloudflare Pages / WASM verification
// (`npm run spike:pages`). The production app build (root config) does not
// include the spike.
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'spike-dist',
    rollupOptions: {
      input: fileURLToPath(new URL('../spike.html', import.meta.url)),
      output: {
        // separate chunks so per-candidate bundle cost is measurable
        manualChunks(id: string) {
          if (id.includes('rapier2d-compat')) return 'rapier';
          if (id.includes('node_modules/planck')) return 'planck';
          if (id.includes('node_modules/konva')) return 'konva';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
});
