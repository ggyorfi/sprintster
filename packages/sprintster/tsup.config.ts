import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { s8r: 'src/s8r.ts', index: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  shims: false,
  splitting: false,
  // Inline the workspace packages' code so the published bundle is self-contained; they are never published on their own. Types are rolled up separately by api-extractor.
  noExternal: [/^@sprintster\//],
});
