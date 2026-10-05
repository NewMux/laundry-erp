import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/seed/cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // Bundle the workspace package (TypeScript sources); keep real deps external.
  noExternal: ['@laundry/shared'],
  loader: { '.json': 'json' },
});
