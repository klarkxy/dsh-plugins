import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import semver from 'semver'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { callLlmText, type LlmTextCaller } from '@klarkxy/dsh-plugin-kit'
import { defaultGenerateConfig } from './contracts.ts'
import { generateCurrentTitle } from './generate.ts'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const llmPackage = '@deepseek-ai/dsh-llm'
const require = createRequire(import.meta.url)
const llmRoot = dirname(require.resolve(`${llmPackage}/package.json`))
const installed = JSON.parse(readFileSync(join(llmRoot, 'package.json'), 'utf8')).version as string

describe('current title host compatibility', () => {
  it('requires the installed LLM version that accepts configure', () => {
    const target = manifest.devDependencies[llmPackage]
    expect(manifest.engines.dsh).toBe(`>=${target}`)
    expect(manifest.peerDependencies[llmPackage]).toBe(`>=${target}`)
    expect(manifest.peerDependenciesMeta[llmPackage].optional).toBe(true)
    expect(semver.satisfies(installed, manifest.peerDependencies[llmPackage], { includePrerelease: true })).toBe(true)
  })

  it('reaches native prepareCall with the title configure callback', async () => {
    let seen: Parameters<LlmRuntime['prepareCall']>[2]
    const llm: LlmTextCaller = {
      async prepareCall(_config, _signal, configure) {
        seen = configure
        return {
          config: { provider: 'p', model: 'm', maxTokens: 80 },
          stream: async function* () {
            yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"type":"fix","summary":"login"}' } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      },
      async resolveCallConfig() { throw new Error('unused') },
    }
    const title = await generateCurrentTitle({
      llm, host: {}, model: { provider: 'p', model: 'm' }, config: defaultGenerateConfig('auto'),
      sessionId: 's', messages: [{ seq: 1, text: 'Fix login' }], signal: new AbortController().signal, isCurrent: () => true,
    })
    expect(title.title).toContain('login')
    expect(seen).toEqual(expect.any(Function))
    const request = { plugin: 'title', route: { provider: 'p', model: 'm' }, system: 's', text: 't', maxTokens: 80, signal: new AbortController().signal, configure: seen }
    let forwarded: unknown
    await callLlmText({
      async prepareCall(_config, _signal, configure) {
        forwarded = configure
        return { config: { provider: 'p', model: 'm' }, stream: async function* () {
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        } }
      },
      async resolveCallConfig() { throw new Error('unused') },
    }, request)
    expect(forwarded).toBe(seen)
  })
})
