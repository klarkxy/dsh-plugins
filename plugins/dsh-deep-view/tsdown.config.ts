import { defineConfig } from 'tsdown'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const vegaCanvasBrowser = join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/vega-canvas/build/vega-canvas.browser.js')
const vegaLoaderBrowser = join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/vega-loader/build/vega-loader.browser.js')
export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      contracts: 'src/contracts.ts',
      core: 'src/core.ts',
      'answer-text': 'src/answer-text.ts',
      answers: 'src/answers.ts',
      widget: 'src/widget.tsx',
      copy: 'src/copy.ts',
    },
    format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
    // The shared RPC helper is embedded so a linked package reload has one atomic Host generation.
    deps: {
      neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime', 'react-dom'],
      alwaysBundle: ['@klarkxy/dsh-plugin-kit/host-rpc', '@klarkxy/dsh-plugin-kit/logger', '@klarkxy/dsh-plugin-kit/log-shared'],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client.tsx' }, format: ['cjs'], dts: false, clean: false, outDir: 'lib',
    platform: 'browser', target: 'es2022', sourcemap: true, hash: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    // DSH advertises one client module per package. Inline lazy component chunks
    // into that artifact so no relative CJS requests escape its module table.
    outputOptions: options => ({ ...options, inlineDynamicImports: true }),
    plugins: [{ name: 'deep-view-browser-canvas', resolveId(id) {
      // vega-canvas publishes only a Node condition; Web bundles must use its
      // shipped browser build even when Rolldown chooses the Node condition.
      if (id === 'vega-canvas') return vegaCanvasBrowser
      if (id === 'vega-loader') return vegaLoaderBrowser
    } }],
    deps: {
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
      alwaysBundle: ['@klarkxy/dsh-plugin-kit/official-ui', '@klarkxy/dsh-plugin-kit/client-logger', '@klarkxy/dsh-plugin-kit/log-shared', '@xyflow/react', 'mafs', 'maplibre-gl', 'vega', 'vega-embed', 'vega-lite'],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
