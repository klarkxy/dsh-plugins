import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PostToolDecision, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { REDACTION_MARKER } from './contracts.ts'
import {
  Redactor,
  SAFE_BLOCK_TEXT,
  containsValue,
  createRedactionListener,
  guardDecision,
  maskValues,
  sanitizeValue,
} from './redact.ts'

const SECRET = 'dummy-secret-value'

const text = (value: string): ContentBlock => ({ type: 'text', text: value })

function success(overrides: Partial<ToolExecutionResult> = {}): ToolExecutionResult {
  return {
    isError: false,
    value: { output: 'clean' },
    content: [text('clean output')],
    ...overrides,
  } as ToolExecutionResult
}

function failure(overrides: Partial<ToolExecutionResult> = {}): ToolExecutionResult {
  return {
    isError: true,
    error: { code: 'FAILED', message: 'tool failed' },
    content: [text('tool failed')],
    ...overrides,
  } as unknown as ToolExecutionResult
}

const acceptDefault: PostToolDecision = { kind: 'accept' }
const acceptContent = (content: ContentBlock[]): PostToolDecision => ({ kind: 'accept', content })

describe('maskValues', () => {
  it('replaces every occurrence of a value', () => {
    expect(maskValues(`a ${SECRET} b ${SECRET} c`, [SECRET])).toBe(`a ${REDACTION_MARKER} b ${REDACTION_MARKER} c`)
  })

  it('masks the longest value first so a containing value cannot leak through', () => {
    const masked = maskValues('token abcdefghij-end', ['abcdefghij', 'abcdefghij-end'])
    expect(masked).toBe(`token ${REDACTION_MARKER}`)
  })

  it('masks any non-empty accepted value, with no length exemption', () => {
    expect(maskValues('x abc y', ['abc'])).toBe(`x ${REDACTION_MARKER} y`)
  })

  it('does not touch text without a match', () => {
    expect(maskValues('nothing here', [SECRET])).toBe('nothing here')
    expect(maskValues('', [SECRET])).toBe('')
  })
})

describe('JSON helpers', () => {
  it('finds a value at any depth', () => {
    expect(containsValue({ a: [1, { b: `x${SECRET}` }] }, [SECRET])).toBe(true)
    expect(containsValue({ a: [1, { b: 'x' }] }, [SECRET])).toBe(false)
  })

  it('masks every string and preserves the shape', () => {
    expect(sanitizeValue({ a: [SECRET, 2, { c: `p${SECRET}q` }] }, [SECRET]))
      .toEqual({ a: [REDACTION_MARKER, 2, { c: `p${REDACTION_MARKER}q` }] })
  })
})

describe('guardDecision — default accept', () => {
  it('masks the content when the canonical value is clean', () => {
    const result = success({ content: [text(`the value is ${SECRET}`)] })
    const guarded = guardDecision(acceptDefault, result, [SECRET])
    expect(guarded).toEqual({ kind: 'accept', content: [text(`the value is ${REDACTION_MARKER}`)] })
  })

  it('replaces the canonical value when that is what leaks', () => {
    const result = success({ value: { output: `echo ${SECRET}` }, content: [text('clean')] })
    const guarded = guardDecision(acceptDefault, result, [SECRET])
    expect(guarded).toEqual({ kind: 'accept', value: { output: `echo ${REDACTION_MARKER}` } })
  })

  it('leaves a clean result and decision untouched', () => {
    const result = success()
    expect(guardDecision(acceptDefault, result, [SECRET])).toBe(acceptDefault)
  })
})

describe('guardDecision — unrewritable surfaces', () => {
  it('blocks when an error result carries the value', () => {
    const guarded = guardDecision(acceptDefault, failure({ content: [text(`failed with ${SECRET}`)] }), [SECRET])
    expect(guarded).toEqual({ kind: 'block', feedback: [text(SAFE_BLOCK_TEXT)] })
  })

  it('blocks when only the canonical error message carries the value', () => {
    const result = failure({
      content: [text('operation failed')],
      error: { message: `operation failed for ${SECRET}` },
    })
    expect(guardDecision(acceptDefault, result, [SECRET])).toEqual({ kind: 'block', feedback: [text(SAFE_BLOCK_TEXT)] })
  })

  it('blocks when the structured error info carries the value', () => {
    const result = failure({
      content: [text('operation failed')],
      error: { message: 'operation failed', info: { name: 'HarnessError', code: 'FAILED', reason: SECRET } },
    })
    expect(guardDecision(acceptDefault, result, [SECRET])).toEqual({ kind: 'block', feedback: [text(SAFE_BLOCK_TEXT)] })
  })

  it('blocks when meta carries the value', () => {
    const result = success({ meta: { presentation: `x${SECRET}` } })
    expect(guardDecision(acceptDefault, result, [SECRET])).toEqual({ kind: 'block', feedback: [text(SAFE_BLOCK_TEXT)] })
  })

  it('blocks when the result own additionalContexts carry the value', () => {
    const result = success({ additionalContexts: [{ role: 'user', content: [text(SECRET)] }] as never })
    expect(guardDecision(acceptDefault, result, [SECRET])).toEqual({ kind: 'block', feedback: [text(SAFE_BLOCK_TEXT)] })
  })
})

describe('guardDecision — downstream decisions', () => {
  it('keeps a block and masks its feedback', () => {
    const decision: PostToolDecision = { kind: 'block', feedback: [text(`no: ${SECRET}`)] }
    expect(guardDecision(decision, success(), [SECRET]))
      .toEqual({ kind: 'block', feedback: [text(`no: ${REDACTION_MARKER}`)] })
  })

  it('masks a replacement content instead of discarding it', () => {
    const decision = acceptContent([text(`replaced ${SECRET}`)])
    expect(guardDecision(decision, success(), [SECRET])).toEqual(acceptContent([text(`replaced ${REDACTION_MARKER}`)]))
  })

  it('masks a replacement value instead of discarding it', () => {
    const decision: PostToolDecision = { kind: 'accept', value: { out: SECRET } }
    expect(guardDecision(decision, success(), [SECRET])).toEqual({ kind: 'accept', value: { out: REDACTION_MARKER } })
  })

  it('sanitizes the decision own contexts without repeating the result ones', () => {
    const decision: PostToolDecision = {
      kind: 'accept',
      content: [text('clean')],
      additionalContexts: [{ role: 'user', content: [text(`ctx ${SECRET}`)] }] as never,
    }
    const guarded = guardDecision(decision, success(), [SECRET]) as { additionalContexts?: unknown }
    expect(JSON.stringify(guarded)).not.toContain(SECRET)
    expect(JSON.stringify(guarded)).toContain(REDACTION_MARKER)
  })
})

describe('createRedactionListener', () => {
  it('passes a decision through when this call resolved no value', async () => {
    const redactor = new Redactor()
    const listener = createRedactionListener(redactor)
    const decision: PostToolDecision = { kind: 'accept', content: [text(`untouched ${SECRET}`)] }
    const guarded = await listener({ callId: 'call-1' }, success(), async () => decision)
    expect(guarded).toBe(decision)
  })

  it('uses this execution snapshot and consumes it', async () => {
    const redactor = new Redactor()
    redactor.record('call-1', [SECRET])
    const listener = createRedactionListener(redactor)
    const result = success({ content: [text(`out ${SECRET}`)] })
    const guarded = await listener({ callId: 'call-1' }, result, async () => acceptDefault)
    expect(guarded).toEqual({ kind: 'accept', content: [text(`out ${REDACTION_MARKER}`)] })
    // A second result for the same call cannot reuse the snapshot.
    expect(await listener({ callId: 'call-1' }, result, async () => acceptDefault)).toBe(acceptDefault)
  })

  it('does not apply another call snapshot', async () => {
    const redactor = new Redactor()
    redactor.record('call-1', [SECRET])
    const listener = createRedactionListener(redactor)
    const result = success({ content: [text(`out ${SECRET}`)] })
    expect(await listener({ callId: 'call-2' }, result, async () => acceptDefault)).toBe(acceptDefault)
  })
})
