import { defineConfig } from 'tsup';

// Inline the workspace packages' code so the published bundle is self-contained; they are never published on their own. Types are rolled up separately by api-extractor.
const shared = { format: 'esm', dts: false, shims: false, splitting: false, noExternal: [/^@sprintster\//] } as const;

export default defineConfig([
  { ...shared, entry: { s8r: 'src/s8r.ts', index: 'src/index.ts' }, platform: 'node', target: 'node22' },
  {
    ...shared,
    entry: { cloudflare: 'src/cloudflare.ts' },
    platform: 'neutral',
    target: 'es2022',
    esbuildOptions(options) {
      options.mainFields = ['module', 'main'];
      options.conditions = ['workerd', 'worker'];
    },
  },
]);
