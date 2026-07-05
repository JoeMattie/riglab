// Regenerates the bundled example JSON artifacts in src/examples/ from their
// authoritative builders (src/examples/builders.ts). Run after editing any
// example builder:
//
//   node scripts/generate-examples.mjs
//
// Uses rolldown (vite's bundler, already installed) to bundle the TS
// builders for node, then serializes each project with 2-space indentation.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'node_modules', '.cache', 'riglab-example-builders.mjs');

const bundle = await rolldown({
  input: join(root, 'src', 'examples', 'builders.ts'),
  platform: 'node',
  logLevel: 'silent',
});
await bundle.write({ file: outfile, format: 'esm' });
await bundle.close();

const { ARTIFACT_BUILDERS } = await import(pathToFileURL(outfile).href);

for (const [filename, builder] of Object.entries(ARTIFACT_BUILDERS)) {
  const path = join(root, 'src', 'examples', filename);
  writeFileSync(path, `${JSON.stringify(builder(), null, 2)}\n`);
  console.log(`wrote ${filename}`);
}
