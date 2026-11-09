import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig } from 'tsdown'
const require = createRequire(import.meta.url)
const typescript = require('typescript') as typeof import('typescript')
// ES decorators (Typert Remote methods) need lowering for the host runtime;
// transpile each decorated entry the same way model-settings-changes is.
const loweredSources = ['src/model-settings-changes.ts'] as const
const lowered = Object.fromEntries(loweredSources.map(file => [file, typescript.transpileModule(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), {
  fileName: file.split('/').pop()!,
  compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ES2022 },
}).outputText]))
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
    'model-picker': 'src/model-picker.tsx',
    'llm-call': 'src/llm-call.ts',
    'auxiliary-model': 'src/auxiliary-model.ts',
    'auxiliary-context': 'src/auxiliary-context.ts',
    'auxiliary-model-client': 'src/auxiliary-model-client.tsx',
    'official-ui': 'src/official-ui.ts',
    'cli-process': 'src/cli-process.ts',
    'cli-media': 'src/cli-media.ts',
  },
  format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'neutral', target: 'es2022', sourcemap: true, hash: false,
  plugins: [{ name: 'native-remote-decorators', transform: {
    order: 'pre',
    handler(code, id) {
      const file = loweredSources.find(source => id.replaceAll('\\', '/').endsWith(`/${source}`))
      if (!file) return null
      return { code: lowered[file]!, map: null }
    },
  } }],
  // zod is bundled: consumers importing auxiliary-model must not need to declare it.
  deps: { neverBundle: [/^node:/, '@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/cordis', '@deepseek-ai/dsh-storage-domain', 'react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-llm'] },
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
