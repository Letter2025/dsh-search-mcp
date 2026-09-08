/**
 * Browser client bundle for dsh-search-mcp, mirroring the DeepSeek Harness
 * client preset (packages/client/tsdown.client.ts) for an external package:
 * a closure-factory artifact that calls
 * window.__ModuleLoader__.load({ id, factory }) and resolves externals
 * through the injected require (loader module table).
 *
 * dsh 0.1.2 module table: react family + cordis + dsh-client-store +
 * dsh-client-ui-slots + dsh-client-ui-primitives. This bundle requires only
 * `react` at runtime; every settings/locale access goes through services.
 */
import { defineConfig } from 'tsdown'

const id = 'dsh-search-mcp'

export default defineConfig({
  entry: { client: 'client-src/index.js' },
  // The published artifact location: package.json exports "./client" points
  // at lib/client.browser.js, so the bundle lands there directly.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: false,
  external: ['react'],
  noExternal: (source) => (source === 'react' ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.browser.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})