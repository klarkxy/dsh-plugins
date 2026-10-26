// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { looksLikeZhihuPublisherGrant, parseZhihuPublisherGrant, ZHIHU_APP_KEY_REF, ZHIHU_APP_SECRET_REF, ZhihuSyncCredentials } from './client-sync-credentials.tsx'

const GRANT = '帮我配置 zhihu-publisher Skill 授权\nZHIHU_OPENAPI_APP_KEY:"klarkxy";\nZHIHU_OPENAPI_APP_SECRET:"quoted-secret"'

type Credentials = {
  key: { configured: boolean; writable: boolean }
  secret: { configured: boolean; writable: boolean }
}

/** 挂载凭据表单，返回容器与被 spy 的凭据 API。 */
async function mount(credentials: Credentials) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const set = vi.fn(async () => ({ ok: true as const, value: {} }))
  const unset = vi.fn(async () => ({ ok: true as const, value: {} }))
  const describe = vi.fn(async () => ({
    ok: true as const,
    value: {
      credentials: {
        [ZHIHU_APP_KEY_REF]: credentials.key,
        [ZHIHU_APP_SECRET_REF]: credentials.secret,
      },
    },
  }))
  await act(async () => root.render(<ZhihuSyncCredentials credentials={{ describe, set, unset }} />))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const save = async (label: string) => {
    const field = input(label).closest('.dsh-ui-field')!
    await act(async () => [...field.querySelectorAll('button')].find(node => node.textContent === '保存')!.click())
  }
  const saveBoth = async () => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === '保存两项')
    expect(button).toBeTruthy()
    await act(async () => button!.click())
  }
  const type = async (label: string, value: string) => {
    await act(async () => Simulate.change(input(label), { target: { value } }))
  }
  return {
    container, set, unset,
    input, save, saveBoth, type,
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    },
  }
}

describe('publisher credentials', () => {
  it('splits Zhihu’s authorization text and leaves a single credential unchanged', () => {
    const grant = [
      '帮我配置 zhihu-publisher Skill 授权',
      'ZHIHU_OPENAPI_APP_KEY:"klarkxy";',
      'ZHIHU_OPENAPI_APP_SECRET:"quoted-secret"',
    ].join('\n')
    expect(parseZhihuPublisherGrant(grant)).toEqual({ appKey: 'klarkxy', appSecret: 'quoted-secret' })
    expect(parseZhihuPublisherGrant('plain-secret')).toBeNull()
    expect(parseZhihuPublisherGrant('ZHIHU_OPENAPI_APP_KEY:"only-key"')).toBeNull()
  })

  it('flags authorization text it cannot read as a credential', () => {
    expect(looksLikeZhihuPublisherGrant(GRANT)).toBe(true)
    expect(looksLikeZhihuPublisherGrant('ZHIHU_OPENAPI_APP_KEY=klarkxy')).toBe(true)
    expect(looksLikeZhihuPublisherGrant('plain-secret')).toBe(false)
  })

  it('saves both credentials when either field receives the authorization text', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const set = vi.fn(async () => ({ ok: true as const, value: {} }))
    const describe = vi.fn(async () => ({
      ok: true as const,
      value: { credentials: { [ZHIHU_APP_KEY_REF]: { configured: false, writable: true }, [ZHIHU_APP_SECRET_REF]: { configured: false, writable: true } } },
    }))
    try {
      await act(async () => root.render(<ZhihuSyncCredentials credentials={{ describe, set, unset: vi.fn() }} />))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      const labels = [...container.querySelectorAll('.dsh-ui-label')].map(node => node.textContent)
      expect(labels).toEqual(['App Secret', 'App Key'])
      const input = container.querySelector<HTMLInputElement>('input[aria-label="App Secret"]')
      await act(async () => Simulate.change(input!, { target: { value: '说明 ZHIHU_OPENAPI_APP_KEY:"klarkxy"; ZHIHU_OPENAPI_APP_SECRET:"quoted-secret"' } }))
      expect(container.querySelector<HTMLInputElement>('input[aria-label="App Key"]')!.value).toBe('klarkxy')
      expect(input!.value).toBe('quoted-secret')
      // 写两项的按钮单独标出来。
      const both = [...container.querySelectorAll('button')].find(node => node.textContent === '保存两项')!
      expect(both).toBeTruthy()
      await act(async () => both.click())
      expect(set.mock.calls).toEqual([
        [{ ref: ZHIHU_APP_KEY_REF, value: 'klarkxy' }],
        [{ ref: ZHIHU_APP_SECRET_REF, value: 'quoted-secret' }],
      ])
      // 单个「保存」只写自己那一项。
      await act(async () => Simulate.change(input!, { target: { value: 'another-secret' } }))
      const field = input!.closest('.dsh-ui-field')!
      await act(async () => [...field.querySelectorAll('button')].find(node => node.textContent === '保存')!.click())
      expect(set.mock.calls.slice(2)).toEqual([
        [{ ref: ZHIHU_APP_SECRET_REF, value: 'another-secret' }],
      ])
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })

  it('saves a credential and clears it again, but never offers to clear an env-provided one', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const set = vi.fn(async () => ({ ok: true as const, value: {} }))
    const unset = vi.fn(async () => ({ ok: true as const, value: {} }))
    const describe = vi.fn(async () => ({
      ok: true as const,
      value: {
        credentials: {
          [ZHIHU_APP_KEY_REF]: { configured: true, writable: true },
          [ZHIHU_APP_SECRET_REF]: { configured: true, writable: false },
        },
      },
    }))
    try {
      await act(async () => root.render(<ZhihuSyncCredentials credentials={{ describe, set, unset }} />))
      // 凭据状态是异步读回来的：等一次宏任务，字段才渲染出来。
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      const input = container.querySelector<HTMLInputElement>('input[aria-label="App Key"]')
      expect(input).not.toBeNull()
      expect(input!.type).toBe('text')
      expect(container.querySelector<HTMLInputElement>('input[aria-label="App Secret"]')!.type).toBe('password')
      await act(async () => Simulate.change(input!, { target: { value: 'my-token' } }))
      const field = input!.closest('.dsh-ui-field')!
      await act(async () => [...field.querySelectorAll('button')].find(node => node.textContent === '保存')!.click())
      expect(set).toHaveBeenCalledWith({ ref: ZHIHU_APP_KEY_REF, value: 'my-token' })

      // 只有可写的凭据有清除按钮；只读的那份来自环境变量。
      const clears = [...container.querySelectorAll('button')].filter(node => node.textContent === '清除')
      expect(clears).toHaveLength(1)
      await act(async () => clears[0].click())
      const confirmed = [...document.querySelectorAll('button')].filter(node => node.textContent === '清除').at(-1)!
      await act(async () => confirmed.click())
      expect(unset).toHaveBeenCalledWith({ ref: ZHIHU_APP_KEY_REF })
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })

  it('never writes an env-provided credential when the authorization text is pasted', async () => {
    const ui = await mount({
      key: { configured: true, writable: false },
      secret: { configured: false, writable: true },
    })
    try {
      await ui.type('App Secret', GRANT)
      // 只读的 App Key 不接受粘贴出来的用户名，界面也说明它是只读的。
      expect(ui.input('App Key').value).toBe('')
      expect(ui.container.querySelector('.dsh-ui-notice')?.textContent).toContain('只读')
      // 两项凑不齐，就没有「保存两项」可点。
      expect([...ui.container.querySelectorAll('button')].some(node => node.textContent === '保存两项')).toBe(false)
      await ui.save('App Secret')
      expect(ui.set.mock.calls).toEqual([
        [{ ref: ZHIHU_APP_SECRET_REF, value: 'quoted-secret' }],
      ])
    } finally {
      await ui.unmount()
    }
  })

  it('keeps the pair after the other field is edited', async () => {
    const ui = await mount({
      key: { configured: false, writable: true },
      secret: { configured: false, writable: true },
    })
    try {
      await ui.type('App Secret', GRANT)
      // 编辑其中一项不再拆散这一对：「保存两项」仍在，两项一起保存。
      await ui.type('App Key', 'edited-name')
      await ui.saveBoth()
      expect(ui.set.mock.calls).toEqual([
        [{ ref: ZHIHU_APP_KEY_REF, value: 'edited-name' }],
        [{ ref: ZHIHU_APP_SECRET_REF, value: 'quoted-secret' }],
      ])
    } finally {
      await ui.unmount()
    }
  })

  it('stops pairing the two fields once one of them is cleared', async () => {
    const ui = await mount({
      key: { configured: false, writable: true },
      secret: { configured: false, writable: true },
    })
    try {
      await ui.type('App Secret', GRANT)
      await ui.type('App Key', '')
      expect([...ui.container.querySelectorAll('button')].some(node => node.textContent === '保存两项')).toBe(false)
      await ui.save('App Secret')
      expect(ui.set.mock.calls).toEqual([
        [{ ref: ZHIHU_APP_SECRET_REF, value: 'quoted-secret' }],
      ])
    } finally {
      await ui.unmount()
    }
  })

  it('refuses authorization text it cannot parse instead of storing the whole block', async () => {
    const ui = await mount({
      key: { configured: false, writable: true },
      secret: { configured: false, writable: true },
    })
    try {
      // 有凭据标记但格式不受支持：整段原文不能落进密钥框。
      await ui.type('App Secret', 'ZHIHU_OPENAPI_APP_KEY=klarkxy')
      expect(ui.input('App Secret').value).toBe('')
      expect(ui.input('App Key').value).toBe('')
      expect(ui.container.querySelector('.dsh-ui-error')?.textContent).toContain('ZHIHU_OPENAPI_APP_KEY')
      await ui.save('App Secret')
      expect(ui.set).not.toHaveBeenCalled()
    } finally {
      await ui.unmount()
    }
  })

  it('ends the pair after a successful save', async () => {
    const ui = await mount({
      key: { configured: false, writable: true },
      secret: { configured: false, writable: true },
    })
    try {
      await ui.type('App Secret', GRANT)
      await ui.saveBoth()
      expect(ui.input('App Secret').value).toBe('')
      expect(ui.input('App Key').value).toBe('')
      // 配对已结束：再改一项只写这一项。
      await ui.type('App Key', 'later-name')
      expect([...ui.container.querySelectorAll('button')].some(node => node.textContent === '保存两项')).toBe(false)
      await ui.save('App Key')
      expect(ui.set.mock.calls.slice(-1)).toEqual([
        [{ ref: ZHIHU_APP_KEY_REF, value: 'later-name' }],
      ])
    } finally {
      await ui.unmount()
    }
  })
})
