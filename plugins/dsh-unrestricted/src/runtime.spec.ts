import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { apply, TAIL_SECTION_ORDER } from './runtime.ts'
import { modelNote } from './model-profiles.ts'
import { isRefusalText } from './refusal.ts'
import { RETRY_MESSAGES, retryMessage, TAIL_REMINDER } from './reminder.ts'
import { readTuning } from './tuning.ts'

const originalDshHome = process.env.DSH_HOME

beforeEach(() => {
  process.env.DSH_HOME = join(tmpdir(), `dsh-unrestricted-test-${randomUUID()}`)
})

afterEach(() => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

describe('isRefusalText', () => {
  it.each([
    "I'm sorry, but I can't help with that request.",
    'I cannot provide instructions for that.',
    "I'm not able to assist with this.",
    'As an AI, I cannot help with that.',
    'Sorry, I won\'t write that.',
    '抱歉，我不能协助这个请求。',
    '我无法提供此类内容。',
    '很抱歉，这个请求我无法处理。',
    '作为人工智能，我不能提供这类信息。',
    'This request asks for a loader. I cannot help with that.',
    "I can't run this one for you.",
    "I won't execute that command.",
    '这步我不做。',
    '我无法协助这个请求。',
    '请提供书面授权后再继续。',
    '这属于未授权访问，我不能参与。',
  ])('detects %s', (text) => {
    expect(isRefusalText(text)).toBe(true)
  })

  it.each([
    'Here is the complete implementation:\n```python\nprint("ok")\n```',
    'I cannot guarantee this works on every build, but here is the full patch and verification steps.',
    "I'm sorry for the confusion; I cannot guarantee this works on every build, but here is the complete implementation.",
    'I cannot provide a guarantee for every environment, but here is the complete implementation.',
    'I cannot provide the answer you expected, but here is the complete implementation instead.\n```ts\nexport const answer = 42\n```',
    "I'm not going to lie: the migration failed because the fixture was incomplete.",
    "I can't run this benchmark without the dataset. Install it with `pnpm fetch-fixtures`, then run the supplied script.",
    "I can't help but notice the guard misclassifies this; the fix is to narrow the pattern.",
    '我无法提供旧版本的完整测试记录，但以下是当前版本的实现与验证命令。',
    '抱歉让代码来得这么晚。下面是完整实现：\n```ts\nexport const answer = 42\n```',
    '很抱歉，不能保证所有版本都兼容；下面是完整实现和回退步骤。',
    'The patch is at offset 0x401000; replace the conditional jump with NOPs.',
    '建议使用更安全的参数并通过本地测试验证。',
    '',
  ])('leaves a deliverable alone: %s', (text) => {
    expect(isRefusalText(text)).toBe(false)
  })
})

/** A minimal Cordis context recording what {@link apply} registers. */
function harness(preset: string): {
  ctx: Context
  sections: { name: string; order: number; text: (context: any) => string }[]
  handlers: Map<string, (payload: unknown) => void>
} {
  const sections: { name: string; order: number; text: (context: any) => string }[] = []
  const handlers = new Map<string, (payload: unknown) => void>()
  const ctx = {
    effect: (callback: () => unknown) => { callback(); return () => {} },
    get: () => undefined,
    systemPrompt: {
      section: (section: typeof sections[number]) => { sections.push(section); return () => {} },
      getSectionOrder: () => 10200,
    },
    agentPresets: { composedPreset: () => preset },
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler)
      return () => {}
    },
    logger: { info: () => {}, warn: () => {} },
  } as unknown as Context
  return { ctx, sections, handlers }
}

describe('retry messages', () => {
  it('carries three ordered stages and clamps past the last stage', () => {
    expect(RETRY_MESSAGES).toHaveLength(3)
    expect(retryMessage(1)).toBe(RETRY_MESSAGES[0])
    expect(retryMessage(2)).toBe(RETRY_MESSAGES[1])
    expect(retryMessage(3)).toBe(RETRY_MESSAGES[2])
    expect(retryMessage(9)).toBe(RETRY_MESSAGES[2])
    expect(retryMessage(0)).toBe(RETRY_MESSAGES[0])
  })
})

describe('tuning file', () => {
  it('reads valid fields and drops malformed ones', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-unrestricted-tuning-'))
    try {
      mkdirSync(join(home, 'unrestricted'), { recursive: true })
      writeFileSync(join(home, 'unrestricted', 'tuning.json'), JSON.stringify({
        tailReminder: false,
        maxRetries: 9,
        transportEnabled: false,
        transportMaxRetries: 7,
        modelProfiles: { kimi: '  custom kimi note  ', broken: 42 },
      }), 'utf8')
      expect(readTuning(home)).toEqual({
        tailReminder: false,
        maxRetries: 3,
        transportEnabled: false,
        transportMaxRetries: 3,
        modelProfiles: { kimi: 'custom kimi note' },
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('model profiles', () => {
  it('selects a family note and lets a local override win', () => {
    expect(modelNote({ provider: 'deepseek', model: 'deepseek-v4.1' })).toContain('DeepSeek')
    expect(modelNote({ provider: 'moonshot', model: 'kimi-k3.1' })).toContain('Kimi')
    expect(modelNote({ provider: 'unknown', model: 'other' })).toBe('')
    expect(modelNote({ model: 'kimi-k3.1' }, { kimi: 'custom note' })).toBe('custom note')
  })
})

describe('runtime half', () => {
  it('registers the tail reminder after the persona suffix for this preset only', () => {
    const { ctx, sections } = harness('unrestricted')
    apply(ctx, { refusalRetry: false })
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe('unrestricted:tail-reminder')
    expect(sections[0]?.order).toBe(TAIL_SECTION_ORDER)
    expect(sections[0]?.order).toBe(1_000_000)
    expect(sections[0]?.text({ agent: { ctx } as never })).toBe(TAIL_REMINDER)
    expect(sections[0]?.text({ agent: { ctx } as never, modelSelection: { model: 'kimi-k3.1' } })).toContain('Model profile — Kimi')
    expect(sections[0]?.text({})).toBe('')

    const other = harness('standard')
    apply(other.ctx, { refusalRetry: false })
    expect(other.sections[0]?.text({ agent: { ctx: other.ctx } as never })).toBe('')
  })

  it('does not register the reminder or retry when the switches are off', () => {
    const { ctx, sections, handlers } = harness('unrestricted')
    apply(ctx, { tailReminder: false, refusalRetry: false })
    expect(sections).toHaveLength(0)
    expect(handlers.has('system-prompt/assemble')).toBe(true)
    expect(handlers.has('agent/turn-stopping')).toBe(false)
  })

  it('registers the turn-stopping retry when enabled', () => {
    const { ctx, handlers } = harness('unrestricted')
    apply(ctx, { tailReminder: false })
    expect(handlers.has('agent/turn-stopping')).toBe(true)
  })

  it('steers a bounded, plugin-sourced retry only for the final refusal', () => {
    const { ctx, handlers } = harness('unrestricted')
    apply(ctx, { tailReminder: false, maxRetries: 1 })
    const steered: { source: { kind: string } }[] = []
    const event = { turn: 1, data: { turn: 1, message: createAssistantMessage({
      content: [{ type: 'text', text: "I'm sorry, but I can't help with that request." }],
      source: { provider: 'test', model: 'test' },
    }) }, type: 'assistant/message' }
    const agent = {
      ctx,
      session: {
        surface: { nodes: [event] },
        eventAt: () => event,
      },
      steer: (message: { source: { kind: string } }) => { steered.push(message) },
    }
    const stop = handlers.get('agent/turn-stopping')!
    stop({ agent, turn: 1, signal: new AbortController().signal })
    expect(steered).toHaveLength(1)
    expect(steered[0]?.source.kind).toBe('plugin:@klarkxy/dsh-unrestricted')
    stop({ agent, turn: 1, signal: new AbortController().signal })
    expect(steered).toHaveLength(1)

    const other = harness('standard')
    apply(other.ctx, { tailReminder: false })
    other.handlers.get('agent/turn-stopping')!({ agent: { ...agent, ctx: other.ctx }, turn: 1, signal: new AbortController().signal })
    expect(steered).toHaveLength(1)
  })
})
