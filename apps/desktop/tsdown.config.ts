import { defineConfig } from 'tsdown'

/**
 * The desktop shell ships one entry: the Electron main process referenced by
 * package.json `main`. The root tsdown builds only `lib/types/index.js`, so
 * this override points at `lib/types/main.js` instead, matching how apps/cli
 * selects its bin. Bundling keeps the packaged app.asar self-contained —
 * `electron` is the runtime's own module and stays external.
 */
export default defineConfig({
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  deps: { neverBundle: ['electron'] },
  fixedExtension: false,
  dts: false,
  clean: false,
})
