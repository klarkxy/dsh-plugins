import { describe, expect, it } from 'vitest'
import { collectHumanMessages } from './messages.ts'

describe('human message selection', () => {
  it('keeps real human prompts and drops plugin auxiliary messages', () => {
    const selected = collectHumanMessages([
      { type: 'user/message', seq: 0, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '旧任务已经完成' }] } },
      { type: 'user/message', seq: 1, data: { source: { kind: 'plugin:fixture-helper', plugin: 'fixture-helper' }, content: [{ type: 'text', text: '辅助摘要不应进标题' }] } },
      { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '现在修复登录回调失败' }] } },
    ])
    expect(selected.map(message => message.text)).toEqual(['旧任务已经完成', '现在修复登录回调失败'])
  })
})
