import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    contracts: 'src/contracts.ts',
    'host-rpc': 'src/host-rpc.ts',
    domain: 'src/domain.ts',
    'client-utils': 'src/client-utils.ts',
    'model-menu': 'src/model-menu.ts',
    'model-menu-ui': 'src/model-menu-ui.tsx',
    'llm-call': 'src/llm-call.ts',
    'official-ui': 'src/official-ui.ts',
  },
  format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'neutral', target: 'es2022', sourcemap: true, hash: false,
  deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-llm'] },
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
