import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { boundQuestions } from './analyze.ts'
import { classifyRequest, isContinuationRequest, shouldAnalyze, shouldWriteClearContract, type TriggerKind } from './trigger.ts'

describe('non-blocking request classification compatibility', () => {
  for (const text of ['继续', '继续。', 'continue', '你决定', '看着办', '都行', '好的！', '按你的建议来']) {
    it(`treats ${text} as continuation without requiring a confirmed contract`, () => {
      assert.equal(isContinuationRequest(text), true)
      assert.equal(classifyRequest(text), 'skip')
      assert.equal(classifyRequest(text, { hasConfirmedContract: false }), 'skip')
    })
  }
  it('retains diagnostic labels without triggering automatic analysis or thin contracts', () => {
    assert.equal(classifyRequest('帮我改一下'), 'material')
    assert.equal(classifyRequest('删除全部并发布到生产'), 'risk')
    assert.equal(classifyRequest('解释什么是闭包'), 'clear')
    for (const kind of ['skip', 'clear', 'mild', 'material', 'risk'] as TriggerKind[]) {
      for (const mode of ['auto', 'manual', 'strict'] as const) {
        assert.equal(shouldAnalyze(kind, mode, false), false)
        assert.equal(shouldAnalyze(kind, mode, true), true)
        assert.equal(shouldWriteClearContract(kind, false, mode), false)
      }
    }
  })
  it('never fabricates a fallback question, including risk or material requests', () => {
    for (const kind of ['clear', 'mild', 'material', 'risk'] as TriggerKind[]) {
      assert.deepEqual(boundQuestions([], kind), [])
      assert.deepEqual(boundQuestions([' ', ''], kind), [])
    }
  })
  it('deduplicates and caps only questions actually produced', () => {
    assert.deepEqual(boundQuestions([' A ', 'A', 'B', 'C', 'D'], 'material'), ['A', 'B', 'C'])
    assert.equal(boundQuestions(['x'.repeat(1000)], 'risk')[0]!.length, 400)
  })
})
