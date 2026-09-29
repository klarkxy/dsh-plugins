import { describe, expect, it, vi } from 'vitest'
import type { LlmTextCaller, LlmTextRequest, LlmTextResult } from '@klarkxy/dsh-plugin-kit'
import { defaultGenerateConfig } from './contracts.ts'
import { generateCurrentTitle, systemPrompt, titleModelRoute } from './generate.ts'

const llm: LlmTextCaller = {
  prepareCall: async () => { throw new Error('unused') },
  resolveCallConfig: async () => { throw new Error('unused') },
}

async function generateWith(
  call: (request: LlmTextRequest) => Promise<LlmTextResult>,
  options: {
    host: unknown
    sessionId: string
    messages: Array<{ seq: number; text: string }>
    prompt?: string
    model?: { provider: string; model: string; reasoningEffort?: string }
    localePreference?: string
    isCurrent?: () => boolean
  },
) {
  const kit = await import('@klarkxy/dsh-plugin-kit')
  const spy = vi.spyOn(kit, 'callLlmText').mockImplementation(async (_llm, request) => call(request))
  try {
    return await generateCurrentTitle({
      llm,
      host: options.host,
      config: defaultGenerateConfig('auto'),
      sessionId: options.sessionId,
      messages: options.messages,
      prompt: options.prompt,
      model: options.model,
      localePreference: options.localePreference,
      signal: new AbortController().signal,
      isCurrent: options.isCurrent ?? (() => true),
    })
  } finally {
    spy.mockRestore()
  }
}

describe('generateCurrentTitle', () => {
  it('calls the host default model and formats a zh type prefix', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 3, 12))
    const seen: LlmTextRequest[] = []
    const result = await generateWith(async request => {
      seen.push(request)
      return { text: '{"type":"fix","summary":"登录回调失败"}', provider: 'host', model: 'chat' }
    }, {
      host: { agentDefaultModel: { currentSelection: () => ({ provider: 'host', model: 'chat' }) } },
      sessionId: 's1',
      messages: [
        { seq: 1, text: '旧任务已经完成' },
        { seq: 2, text: '现在修复登录回调失败' },
      ],
    })
    expect(result.title).toBe('0903 | 修复 | 登录回调失败')
    expect(result.messageSeqs).toEqual([1, 2])
    expect(result.model).toEqual({ provider: 'host', model: 'chat' })
    expect(seen[0]?.route).toEqual({ provider: 'host', model: 'chat' })
    expect(seen[0]?.text).toContain('现在修复登录回调失败')
    vi.useRealTimers()
  })

  it('sends the custom instruction and an explicit model', async () => {
    const seen: LlmTextRequest[] = []
    await generateWith(async request => {
      seen.push(request)
      return { text: '{"type":"docs","summary":"标题说明"}', provider: 'deepseek', model: 'chat' }
    }, {
      host: {},
      sessionId: 's1',
      messages: [{ seq: 1, text: '补标题说明' }],
      prompt: '标题要带模块名',
      model: { provider: 'deepseek', model: 'chat' },
    })
    expect(seen[0]?.system.startsWith('标题要带模块名')).toBe(true)
    expect(seen[0]?.route).toEqual({ provider: 'deepseek', model: 'chat' })
    expect(systemPrompt(defaultGenerateConfig(), '').startsWith('Name the current task')).toBe(true)
    expect(titleModelRoute({ provider: '', model: '' })).toBeUndefined()
  })

  it('never forwards reasoning effort and marks the call as a session title', async () => {
    const seen: LlmTextRequest[] = []
    const host = { agentDefaultModel: { currentSelection: () => ({ provider: 'g', model: 'm', reasoningEffort: 'high' }) } }
    await generateWith(async request => {
      seen.push(request)
      return { text: '{"type":"fix","summary":"登录修复"}', provider: 'g', model: 'm' }
    }, {
      host,
      sessionId: 's1',
      messages: [{ seq: 1, text: '修复登录' }],
    })
    // Inherited reasoning effort would let thinking consume the token cap and
    // leave an empty reply; title calls never think (bundled provider policy).
    expect(seen[0]?.route).toEqual({ provider: 'g', model: 'm' })
    expect(seen[0]?.purpose).toBe('session-title')

    seen.length = 0
    await generateWith(async request => {
      seen.push(request)
      return { text: '{"type":"fix","summary":"登录修复"}', provider: 'g', model: 'm' }
    }, {
      host,
      sessionId: 's1',
      messages: [{ seq: 1, text: '修复登录' }],
      model: { provider: 'g', model: 'm', reasoningEffort: 'low' },
    })
    expect(seen[0]?.route).toEqual({ provider: 'g', model: 'm' })
  })

  it('uses the DSH locale preference for the type label', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 3, 12))
    const result = await generateWith(async () => ({ text: '{"type":"fix","summary":"login callback"}', provider: 'p', model: 'm' }), {
      host: { agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } },
      sessionId: 's1',
      messages: [{ seq: 1, text: '现在修复登录回调失败' }],
      localePreference: 'en-US',
    })
    expect(result.title).toBe('0903 | Fix | login callback')
    vi.useRealTimers()
  })

  it('rejects stale work before calling the model', async () => {
    await expect(generateWith(async () => ({ text: '{"type":"fix","summary":"x"}', provider: 'p', model: 'm' }), {
      host: { agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } },
      sessionId: 's1',
      messages: [{ seq: 1, text: '修复登录' }],
      isCurrent: () => false,
    })).rejects.toThrow(/no longer current/)
  })

  it('fails when neither the page nor the host has a model', async () => {
    await expect(generateWith(async () => ({ text: 'unused', provider: 'p', model: 'm' }), {
      host: {},
      sessionId: 's1',
      messages: [{ seq: 1, text: '修复登录' }],
    })).rejects.toThrow(/默认对话模型/)
  })
})
