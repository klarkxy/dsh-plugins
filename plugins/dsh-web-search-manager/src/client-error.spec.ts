import { describe, expect, it } from 'vitest'
import { localErrorText } from './client-error.ts'

describe('web search diagnostic localization', () => {
  it('translates owned failures inside provider wrappers and preserves external content', () => {
    expect(localErrorText('[search:brave] 供应商请求失败（HTTP 503）。', 'en')).toBe('[search:brave] Provider request failed (HTTP 503).')
    expect(localErrorText('设置已被其他页面修改，请刷新后重试。', 'en')).toBe('Settings changed in another page. Refresh and try again.')
    expect(localErrorText('[fetch:external] 原始供应商内容', 'en')).toBe('[fetch:external] 原始供应商内容')
    expect(localErrorText('Invalid response shape', 'zh')).toBe('响应格式无效。')
  })
})
