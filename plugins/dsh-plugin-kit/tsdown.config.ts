import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig } from 'tsdown'
const require = createRequire(import.meta.url)
const typescript = require('typescript') as typeof import('typescript')
const lowered = typescript.transpileModule(readFileSync(new URL('./src/model-settings-changes.ts', import.meta.url), 'utf8'), {
  fileName: 'model-settings-changes.ts',
  compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ES2022 },
}).outputText
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    contracts: 'src/contracts.ts',
    'host-rpc': 'src/host-rpc.ts',
    domain: 'src/domain.ts',
    'model-settings': 'src/model-settings.ts',
    'model-settings-changes': 'src/model-settings-changes.ts',
    'model-settings-client': 'src/model-settings-client.ts',
    'client-utils': 'src/client-utils.ts',
    'model-menu': 'src/model-menu.ts',
    'llm-call': 'src/llm-call.ts',
    'official-ui': 'src/official-ui.ts',
    'cli-process': 'src/cli-process.ts',
    'cli-media': 'src/cli-media.ts',
  },
  format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'neutral', target: 'es2022', sourcemap: true, hash: false,
  plugins: [{ name: 'native-remote-decorators', transform: {
    order: 'pre',
    handler(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/model-settings-changes.ts')) return null
      return { code: lowered, map: null }
    },
  } }],
  deps: { neverBundle: [/^node:/, '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/cordis', 'react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-llm'] },
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
