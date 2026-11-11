import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { guardStream, GUARD_REASONING_CHARS, type GuardResult } from './monitor.ts'

async function* source(chunks: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk
}

async function run(chunks: readonly StreamChunk[]): Promise<{ chunks: StreamChunk[]; result: GuardResult }> {
  const iterator = guardStream(source(chunks))
  const out: StreamChunk[] = []
  while (true) {
    const step = await iterator.next()
    if (step.done) return { chunks: out, result: step.value }
    out.push(step.value)
  }
}

describe('guardStream', () => {
  it('passes a short normal answer through after the finish chunk', async () => {
    const { chunks, result } = await run([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Here is the complete patch and verification steps.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Here is the complete patch and verification steps.' } },
      { type: 'finish', reason: 'stop' },
    ])
    expect(result.refused).toBe(false)
    expect(chunks.map(chunk => chunk.type)).toContain('text-delta')
    expect(chunks.map(chunk => chunk.type)).toContain('finish')
  })

  it('discards a refusal opening and reports refused', async () => {
    const { chunks, result } = await run([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: "I'm sorry, but I can't help with that request." },
      { type: 'finish', reason: 'stop' },
    ])
    expect(result.refused).toBe(true)
    expect(chunks).toHaveLength(0)
  })

  it('commits as soon as a tool call begins', async () => {
    const { chunks, result } = await run([
      { type: 'text-delta', index: 0, text: 'I will check the local file.' },
      { type: 'tool-call-delta', index: 0, id: 'call-1' as never, argumentsDelta: '{}' },
    ])
    expect(result.refused).toBe(false)
    expect(chunks.some(chunk => chunk.type === 'tool-call-delta')).toBe(true)
  })

  it('commits long reasoning instead of buffering it forever', async () => {
    const { chunks, result } = await run([
      { type: 'reasoning-delta', index: 0, text: 'r'.repeat(GUARD_REASONING_CHARS) },
      { type: 'text-delta', index: 1, text: 'Here is the complete implementation.' },
      { type: 'finish', reason: 'stop' },
    ])
    expect(result.refused).toBe(false)
    expect(chunks[0]?.type).toBe('reasoning-delta')
    expect(chunks.some(chunk => chunk.type === 'text-delta')).toBe(true)
  })

  it('keeps a concrete answer that mentions a limitation', async () => {
    const { chunks, result } = await run([
      { type: 'text-delta', index: 0, text: 'I cannot provide the answer you expected, but here is the complete implementation.\n```ts\nexport const answer = 42\n```' },
      { type: 'finish', reason: 'stop' },
    ])
    expect(result.refused).toBe(false)
    expect(chunks.some(chunk => chunk.type === 'text-delta')).toBe(true)
  })
})
