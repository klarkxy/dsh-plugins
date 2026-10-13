import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    contracts: 'src/contracts.ts',
    'host-rpc': 'src/host-rpc.ts',
    domain: 'src/domain.ts',
    'model-settings': 'src/model-settings.ts',
    'model-settings-client': 'src/model-settings-client.ts',
    'client-utils': 'src/client-utils.ts',
    'model-menu': 'src/model-menu.ts',
    'llm-call': 'src/llm-call.ts',
    'official-ui': 'src/official-ui.ts',
    'cli-process': 'src/cli-process.ts',
    'cli-media': 'src/cli-media.ts',
  },
  format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'neutral', target: 'es2022', sourcemap: true, hash: false,
  deps: { neverBundle: [/^node:/, '@deepseek-ai/dsh-typert-protocol', 'react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-llm'] },
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
