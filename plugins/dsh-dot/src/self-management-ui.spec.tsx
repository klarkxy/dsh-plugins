import { act, useState } from 'react'
import { JSDOM } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type DotSettings } from './contracts.ts'
import { ContextPanel } from './context-panel.tsx'
import { PersonaPanel } from './persona-panel.tsx'
import { SettingsPanel } from './settings-panel.tsx'
import { TrajectoryPanel } from './trajectory-panel.tsx'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://local.test' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
vi.stubGlobal('navigator', dom.window.navigator)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let createRoot: typeof import('react-dom/client').createRoot
beforeAll(async () => { createRoot = (await import('react-dom/client')).createRoot })
afterEach(() => { document.body.innerHTML = '<div id="root"></div>' })

function changeValue(element: HTMLElement, value: string): void {
  ;(element as HTMLInputElement | HTMLTextAreaElement).value = value
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps'))
  const props = propsKey ? (element as unknown as Record<string, { onChange?: (event: { target: HTMLElement }) => void }>)[propsKey] : undefined
  props?.onChange?.({ target: element })
}

describe('Dorothy self-management controls', () => {
  it('locks a setting, renders readable proposal chips, switches segmented choices, and filters task models', async () => {
    const decisions: Array<{ id: string; allow: boolean }> = []
    let current: DotSettings = { ...DEFAULT_SETTINGS }
    const makeHarness = () => {
      const api = {
        models: async () => ({
          groups: [
            { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
            { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
          ],
        }),
        settings: async () => current,
        settingProposals: async () => [{ id: 'setting-1', field: 'scope' as const, before: 'all', after: 'tracked', reason: 'less noise', createdAt: 1 }],
        decideSetting: async (id: string, allow: boolean) => { decisions.push({ id, allow }); return 'Approved' },
        setSettings: async (patch: Partial<DotSettings>) => {
          current = { ...current, ...patch } as DotSettings
          return current
        },
      }
      return function Harness() {
        const [settings, setSettings] = useState<DotSettings>(current)
        return <SettingsPanel locale="zh" api={api as never} settings={settings} onSaved={setSettings} />
      }
    }
    const Harness = makeHarness()
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<Harness />))
    await act(async () => { await Promise.resolve() })

    expect(document.body.textContent).toContain('待确认的修改')
    expect(document.body.textContent).toContain('less noise')
    const chips = [...document.querySelectorAll('.dsh-dot-proposal-chip')].map(node => node.textContent)
    expect(chips).toEqual(['所有会话', '仅她跟进的任务'])

    const lock = document.querySelector<HTMLButtonElement>('button[aria-label="禁止桃乐丝修改：桃乐丝的模型"]')!
    expect(lock.getAttribute('title')).toContain('允许她提议修改')
    await act(async () => lock.click())
    expect(current.locks).toEqual({ model: true })
    const unlock = document.querySelector<HTMLButtonElement>('button[aria-label="允许桃乐丝申请修改：桃乐丝的模型"]')!
    expect(unlock.hasAttribute('data-locked')).toBe(true)
    expect(unlock.getAttribute('title')).toContain('已锁定')

    await act(async () => document.querySelector<HTMLButtonElement>('.dsh-dot-proposal button')!.click())
    expect(decisions).toEqual([{ id: 'setting-1', allow: true }])

    expect(document.body.textContent).not.toContain('默认任务权限')
    const tabLabels = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map(node => node.textContent)
    expect(tabLabels).toEqual(expect.arrayContaining(['桃乐丝管', '用户管', '一律不许', '一律允许']))
    const allowAllTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(node => node.textContent === '一律允许')!
    await act(async () => allowAllTab.click())
    expect(current.approvals).toBe('allow')
    expect(document.body.textContent).toContain('新任务以完全访问运行')

    const allowTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(node => node.textContent === '仅允许所选')!
    await act(async () => allowTab.click())
    expect(current.taskModels.mode).toBe('allow')
    expect(document.body.textContent).toContain('尚未勾选任何模型')

    const filterInput = document.querySelector<HTMLInputElement>('input[aria-label="筛选模型…"]')!
    await act(async () => { changeValue(filterInput, 'DeepSeek') })
    const checkboxes = [...document.querySelectorAll<HTMLInputElement>('.dsh-dot-model-list input[type="checkbox"]')]
    expect(checkboxes.length).toBe(1)
    await act(async () => checkboxes[0]!.click())
    expect(current.taskModels.list).toEqual(['deepseek/deepseek-chat'])

    await act(async () => root.unmount())
  })

  it('edits, discards and saves the persona, and keeps agreements and cognition apart', async () => {
    let current: DotSettings = { ...DEFAULT_SETTINGS }
    let knowledge = {
      agreements: { text: '- 先给结论', maxChars: 4000, canUndo: true },
      cognition: { text: '他偏好先看结论。', maxChars: 4000, history: [{ text: '旧的一版。', at: 1_700_000_000_000 }] },
    }
    const restores: number[] = []
    function Harness() {
      const [settings, setSettings] = useState<DotSettings>(current)
      const api = {
        setSettings: async (patch: Record<string, unknown>) => {
          current = {
            ...current,
            ...(patch.persona === null ? { persona: undefined } : patch.persona !== undefined ? { persona: String(patch.persona) } : {}),
            ...(patch.address === null ? { address: undefined } : patch.address !== undefined ? { address: String(patch.address) } : {}),
            ...(patch.locks !== undefined ? { locks: patch.locks as DotSettings['locks'] } : {}),
          }
          setSettings(current)
          return current
        },
        knowledge: async () => knowledge,
        setAgreements: async (text: string) => {
          knowledge = { ...knowledge, agreements: { ...knowledge.agreements, text, canUndo: true } }
          return knowledge
        },
        undoAgreements: async () => {
          knowledge = { ...knowledge, agreements: { ...knowledge.agreements, text: '', canUndo: false } }
          return knowledge
        },
        setCognition: async (text: string) => {
          knowledge = { ...knowledge, cognition: { ...knowledge.cognition, text } }
          return knowledge
        },
        restoreCognition: async (at: number) => {
          restores.push(at)
          const hit = knowledge.cognition.history.find(item => item.at === at)
          knowledge = { ...knowledge, cognition: { ...knowledge.cognition, text: hit?.text ?? '' } }
          return knowledge
        },
      }
      return <PersonaPanel locale="zh" api={api} settings={settings} onSaved={setSettings} />
    }
    const root = createRoot(document.getElementById('root')!)
    await act(async () => root.render(<Harness />))
    await act(async () => { await Promise.resolve() })

    const personaBox = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="性格与说话方式"]')!
    await act(async () => { changeValue(personaBox, '沉稳干练') })
    const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')]
    await act(async () => buttons().find(btn => btn.textContent === '放弃改动')!.click())
    expect(personaBox.value).not.toBe('沉稳干练')

    await act(async () => { changeValue(personaBox, '沉稳干练') })
    await act(async () => buttons().find(btn => btn.textContent === '保存修改')!.click())
    expect(current.persona).toBe('沉稳干练')
    expect(document.body.textContent).toContain('已自定义')

    await act(async () => buttons().filter(btn => btn.textContent === '恢复默认')[1]!.click())
    expect(current.persona).toBeUndefined()

    // The two knowledge blocks are separate and carry their own copy.
    const agreementsBox = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="约定"]')!
    const cognitionBox = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="认知"]')!
    expect(agreementsBox.value).toBe('- 先给结论')
    expect(cognitionBox.value).toBe('他偏好先看结论。')
    expect(document.body.textContent).toContain('与认知冲突时，一律以约定为准')

    // The agreements keep a lock toggle, so an existing lock can be lifted here.
    const lock = document.querySelector<HTMLButtonElement>('button[aria-label="禁止桃乐丝修改：约定"]')!
    await act(async () => lock.click())
    expect(current.locks).toEqual({ memory: true })
    const unlock = document.querySelector<HTMLButtonElement>('button[aria-label="允许桃乐丝申请修改：约定"]')!
    expect(unlock.hasAttribute('data-locked')).toBe(true)

    // Saving the agreements calls the agreements endpoint only.
    await act(async () => { changeValue(agreementsBox, '- 先给结论\n- 少说废话') })
    await act(async () => buttons().find(btn => btn.textContent === '保存修改' && btn.closest('.dsh-ui-field')?.textContent?.includes('约定'))!.click())
    expect(knowledge.agreements.text).toContain('- 少说废话')
    expect(knowledge.cognition.text).toBe('他偏好先看结论。')

    // One step of undo on the agreements.
    await act(async () => buttons().find(btn => btn.textContent === '回退上次保存')!.click())
    expect(knowledge.agreements.text).toBe('')

    // The cognition history lists an earlier version and restores it by its timestamp.
    expect(document.body.textContent).toContain('历史版本')
    await act(async () => buttons().find(btn => btn.textContent === '回到这一版')!.click())
    expect(restores).toEqual([1_700_000_000_000])
    expect(knowledge.cognition.text).toBe('旧的一版。')

    await act(async () => root.unmount())
  })

  it('switches directly from the context page and reports a refusal', async () => {
    const root = createRoot(document.getElementById('root')!)
    let view = {
      live: true,
      compactions: 0,
      contextWindow: 1_000_000,
      rolloverAt: 700_000,
      compactAt: 900_000,
      breakdown: { system: 1_200, tools: 1_800, messages: 400 },
      surface: {
        nodes: [{ id: 'pre:system:0', seq: 0, at: 0, category: 'system' as const, name: 'dsh-dot:persona', tokens: 1_200, text: 'Persona' }],
        parts: { system: 1_200, tools: 1_800, user: 0, inject: 400, skill: 0, assistant: 0, tool: 0 },
      },
      usage: { input: 2_000, cacheRead: 6_000, cacheWrite: 500, output: 1_500 },
      sections: {
        persona: '[persona] 你是桃乐丝',
        agreements: '[agreements]\n- 推送到个人仓库可直接放行',
        cognition: '[cognition]\n他偏好先看结论。',
        handoff: '[handoff] 上文已交接',
      },
    }
    const api = {
      context: vi.fn(async () => view),
      newSegment: vi.fn(async () => { throw new Error('stop the current turn first') }),
      clearUsage: vi.fn(async () => {
        view = { ...view, usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } }
        return view
      }),
    }
    await act(async () => root.render(<ContextPanel locale="zh" api={api} />))
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain('3.4K')
    expect(document.body.textContent).toContain('提示词明细')
    expect(document.body.textContent).toContain('10K')

    // The frozen prompt blocks of this segment are shown as their own zones.
    expect(document.body.textContent).toContain('提示词分区')
    expect(document.body.textContent).toContain('约定')
    expect(document.body.textContent).toContain('认知')
    expect(document.body.textContent).toContain('- 推送到个人仓库可直接放行')
    expect(document.body.textContent).toContain('他偏好先看结论。')
    const zones = [...document.querySelectorAll('.dsh-dot-ctx-section-row > dt')].map(node => node.textContent)
    expect(zones).toEqual(['人设', '约定', '认知', '交接'])

    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '开启新分段')!
    await act(async () => button.click())
    expect(api.newSegment).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('stop the current turn first')

    const clearButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '清零')!
    expect(clearButton.disabled).toBe(false)
    await act(async () => clearButton.click())
    expect(api.clearUsage).toHaveBeenCalledOnce()
    expect(clearButton.disabled).toBe(true)
    await act(async () => root.unmount())
  })

  it('renders localized tool names and localized turn end states in trajectory view', async () => {
    const root = createRoot(document.getElementById('root')!)
    const api = {
      trajectory: async () => ({
        earlier: 0,
        turns: [{
          turn: 1,
          startedAt: 1_700_000_000_000,
          endedAt: 1_700_000_001_500,
          end: 'cancelled',
          records: [],
          steps: [{
            step: 1,
            model: 'deepseek-chat',
            startedAt: 1_700_000_000_000,
            durationMs: 1200,
            records: [{
              kind: 'call' as const,
              id: 'call-1',
              name: 'dot_overview',
              args: '{}',
              result: '{"ok":true}',
              status: 'done' as const,
              at: 1_700_000_000_100,
              endedAt: 1_700_000_000_400,
            }],
          }],
        }],
      }),
    }
    await act(async () => root.render(<TrajectoryPanel locale="zh" api={api} />))
    await act(async () => { await Promise.resolve() })

    expect(document.body.textContent).toContain('查看全局 · dot_overview')
    expect(document.body.textContent).toContain('结束：已停止')
    await act(async () => root.unmount())
  })
})
