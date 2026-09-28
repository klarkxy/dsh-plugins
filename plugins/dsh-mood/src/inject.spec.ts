import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { thinContract } from './analyze.ts'
import { AUTONOMY_POLICY, createMoodContextMessage, formatContract, mergeContractMessage } from './inject.ts'
import { isMoodMessage, type UserMessageLike } from './evidence.ts'

describe('bounded autonomy context', () => {
  it('uses native plugin provenance and replaces rather than appends old snapshots', () => {
    const message = createMoodContextMessage(AUTONOMY_POLICY)
    assert.equal(isMoodMessage(message as UserMessageLike), true)
    assert.equal(mergeContractMessage([message, message], message).length, 1)
  })
  it('bounds optional notes without truncating the safety disclaimer', () => {
    const contract = thinContract({ id: 'c', sessionId: 's', sourceVersion: 'u', revision: 1, goal: 'x'.repeat(2000), evidence: [], readiness: 'disclosed-assumptions', now: 1, extra: { constraints: ['x'.repeat(10000)] } })
    const text = formatContract(contract)
    assert.ok(text.length < 2600)
    assert.match(text, /不能代替文件修改或发布审批/)
    assert.match(text, /未回答的事项不等于已确认或已授权/)
  })
  it('preserves necessary questions, deliberate collaboration, and authorization boundaries', () => {
    for (const text of ['获准工具', '实质改变结果', '低风险', '共同决策', '不等于授权', '原生权限']) assert.ok(AUTONOMY_POLICY.includes(text))
    assert.ok(AUTONOMY_POLICY.length < 800)
  })
})
