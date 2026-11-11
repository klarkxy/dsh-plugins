import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, markAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply } from './index.ts'

const base: GenerateOptions = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  messages: [createUserMessage({ content: [{ type: 'text', text: 'Deliver the artifact.' }], source: { kind: 'user' } })],
}

function conversation(sessionId = 'unrestricted-session', message = 'Deliver the artifact.'): GenerateOptions {
  return markAgentLoopRequest({ ...base, messages: [createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } })], sessionId: sessionId as GenerateOptions['sessionId'] })
}

async function* refusalStream(): AsyncIterable<StreamChunk> {
  yield { type: 'text-delta', index: 0, text: "I'm sorry, but I can't help with that request." }
  yield { type: 'finish', reason: 'stop' }
}

async function* normalStream(): AsyncIterable<StreamChunk> {
  yield { type: 'text-delta', index: 0, text: 'Here is the complete deliverable.' }
  yield { type: 'finish', reason: 'stop' }
}

function harness() {
  const handlers = new Map<string, (...args: any[]) => AsyncIterable<StreamChunk>>()
  const calls: GenerateOptions[] = []
  const presets = new Map([
    ['unrestricted-session', 'unrestricted'],
    ['standard-session', 'standard'],
  ])
  const ctx = {
    effect: (callback: () => unknown) => { callback(); return () => {} },
    on: (event: string, handler: (...args: any[]) => AsyncIterable<StreamChunk>) => {
      handlers.set(event, handler)
      return () => {}
    },
    agents: { get: (id: string) => presets.has(id) ? { id, ctx: { sessionId: id } } : undefined },
    agentPresets: { composedPreset: (agentCtx: { sessionId: string }) => presets.get(agentCtx.sessionId) },
    logger: { info: () => {} },
    llm: {
      stream: async function* (options: GenerateOptions) {
        calls.push(options)
        const handler = handlers.get('llm/stream')
        if (handler === undefined) throw new Error('listener not registered')
        const attempt = (options as GenerateOptions & { __unrestrictedAttempt?: number }).__unrestrictedAttempt
        const succeedOnFirstRetry = options.messages.some(message => message.role === 'user'
          && message.content.some(block => block.type === 'text' && block.text === 'Succeed after one refusal.'))
        const next = () => attempt === 1 && succeedOnFirstRetry
          ? normalStream() : refusalStream()
        yield* handler(options, next)
      },
    },
  } as unknown as Context
  return { ctx, handlers, calls }
}

async function textOf(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) if (chunk.type === 'text-delta') text += chunk.text
  return text
}

describe('transport registration', () => {
  it('does nothing when disabled', () => {
    const { ctx, handlers } = harness()
    apply(ctx, { enabled: false })
    expect(handlers.size).toBe(0)
  })

  it('replaces a refused opening with a retried normal stream', async () => {
    const { ctx, calls } = harness()
    apply(ctx, { enabled: true, maxRetries: 2 })
    expect(await textOf(ctx.llm.stream(conversation('unrestricted-session', 'Succeed after one refusal.')))).toBe('Here is the complete deliverable.')
    expect(calls).toHaveLength(2)
    expect(calls[1]?.messages.at(-1)?.role).toBe('assistant')
    expect((calls[1]?.messages.at(-1)?.content[0] as { text: string }).text.endsWith('\n')).toBe(false)
  })

  it.each([
    ['standard conversation', conversation('standard-session')],
    ['missing session', base],
    ['title', { ...base, purpose: 'session-title' } as GenerateOptions],
    ['compaction', { ...conversation(), purpose: 'compaction' } as GenerateOptions],
    ['one-shot with an unrestricted id but no loop identity', { ...base, sessionId: 'unrestricted-session' } as GenerateOptions],
  ])('passes a %s through without buffering or retrying', async (_name, request) => {
    const { ctx, calls } = harness()
    apply(ctx, { enabled: true, maxRetries: 3 })
    expect(await textOf(ctx.llm.stream(request))).toBe("I'm sorry, but I can't help with that request.")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(request)
  })

  it('stops after the configured retry budget and passes the last refusal through', async () => {
    const { ctx, calls } = harness()
    apply(ctx, { enabled: true, maxRetries: 2 })
    expect(await textOf(ctx.llm.stream(conversation()))).toBe("I'm sorry, but I can't help with that request.")
    expect(calls).toHaveLength(3)
    expect(calls.map(call => (call as GenerateOptions & { __unrestrictedAttempt?: number }).__unrestrictedAttempt ?? 0)).toEqual([0, 1, 2])
    expect(calls[2]?.messages.at(-1)?.role).toBe('user')
  })
})
