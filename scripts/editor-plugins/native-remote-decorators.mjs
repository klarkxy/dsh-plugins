/**
 * Shared tsdown plugin: lower ES decorators in bundled plugin-kit sources.
 *
 * Consumers that bundle kit host subpaths (auxiliary-model pulls
 * model-settings-changes.ts) re-inline the SOURCE, not the precompiled
 * lib/*.js — so the kit's own tsdown transform never applies and rolldown
 * emits a bare `@Remote({ mode: 'stream' })` method decorator that Node's
 * parser rejects at plugin load. Transpiling the raw source text with the
 * workspace TypeScript mirrors the kit's own 'native-remote-decorators'
 * plugin (ES2022 emit with __esDecorate helpers).
 *
 * Matching is by resolved file id suffix so it also hits files that arrive
 * through ../dsh-plugin-kit workspace paths or package subpath imports.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

/** Decorated kit sources that must never reach the bundle unlowered. */
const DEFAULT_LOWERED_SOURCES = ['src/model-settings-changes.ts']

/**
 * @param {{ sources?: string[] }} [options] Extra source suffixes to lower.
 * @returns a tsdown plugin (pre transform)
 */
export function lowerNativeRemoteDecorators(options = {}) {
  const sources = [...DEFAULT_LOWERED_SOURCES, ...(options.sources ?? [])]
  const lowered = new Map()
  return {
    name: 'native-remote-decorators',
    transform: {
      order: 'pre',
      handler(code, id) {
        const file = sources.find(source => id.replaceAll('\\', '/').endsWith(`/${source}`))
        if (!file) return null
        if (!lowered.has(file)) lowered.set(file, transpileDecoratedSource(code, file.split('/').pop()))
        return { code: lowered.get(file), map: null }
      },
    },
  }
}

/** Exposed for tests: transpile a decorated source exactly like the plugin. */
export function transpileDecoratedSource(code, fileName = 'model-settings-changes.ts') {
  return typescript.transpileModule(code, {
    fileName,
    compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ES2022 },
  }).outputText
}

export { DEFAULT_LOWERED_SOURCES }
