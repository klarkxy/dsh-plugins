import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    contracts: 'src/contracts.ts',
    'host-rpc': 'src/host-rpc.ts',
    'client-utils': 'src/client-utils.ts',
    'model-menu': 'src/model-menu.ts',
    'llm-call': 'src/llm-call.ts',
    'official-ui': 'src/official-ui.ts',
  },
  format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'neutral', target: 'es2022', sourcemap: true, hash: false,
  deps: { neverBundle: ['react', '@deepseek-ai/dsh-llm'] },
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
