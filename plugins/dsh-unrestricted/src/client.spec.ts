// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'
import { apply, WARNING_CSS } from './client.ts'
import { PRESET_COPY, WARNING_ATTRIBUTE, WARNING_MARKS } from './contracts.ts'

/** Frames scheduled by the half under test, run explicitly by {@link settle}. */
const frames: FrameRequestCallback[] = []

/** Locale listeners the half subscribed, and the language the stub reports. */
const listeners: (() => void)[] = []
let active = 'zh-CN'

/** Let the observer deliver its records, then run the frame it scheduled. */
async function settle(): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, 0) })
  for (const callback of frames.splice(0)) callback(0)
}

/** Mount the browser half over a locale stub. */
function mount(locale = 'zh-CN'): { dispose: () => void; switchTo: (next: string) => void } {
  active = locale
  let disposer: (() => void) | undefined
  const ctx = {
    effect: (callback: () => (() => void) | void) => { disposer = callback() as () => void },
    locale: {
      getSnapshot: () => ({ active }),
      subscribe: (listener: () => void) => {
        listeners.push(listener)
        return () => { listeners.splice(listeners.indexOf(listener), 1) }
      },
    },
  } as unknown as Context
  apply(ctx)
  return {
    dispose: () => { disposer?.() },
    switchTo: (next: string) => {
      active = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** One preset card as the picker renders it: a menu row, name over description. */
function card(name: string, description: string): { row: HTMLElement; name: HTMLElement; text: HTMLElement } {
  const row = document.createElement('button')
  row.setAttribute('role', 'menuitem')
  const label = document.createElement('span')
  const itemName = document.createElement('span')
  itemName.textContent = name
  const itemDesc = document.createElement('span')
  itemDesc.textContent = description
  label.append(itemName, itemDesc)
  row.append(label)
  document.body.append(row)
  return { row, name: itemName, text: itemDesc }
}

/** The bundle publishes the Chinese copy; the picker therefore starts there. */
const card0 = (): ReturnType<typeof card> => card(PRESET_COPY.zh.name, PRESET_COPY.zh.description)

/** @param root - a surface showing the preset copy.
 * @returns the warning sentences it currently carries. */
function warnings(root: ParentNode): string[] {
  return [...root.querySelectorAll(`[${WARNING_ATTRIBUTE}]`)].map(node => node.textContent ?? '')
}

beforeEach(() => {
  frames.length = 0
  listeners.length = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('unrestricted preset card copy', () => {
  it('paints the warning through a host token and nothing else', () => {
    mount()
    const style = document.querySelector('style[data-plugin="@klarkxy/dsh-unrestricted"]')
    expect(style?.textContent).toBe(WARNING_CSS)
    const allowed = new Set<string>(OFFICIAL_THEME_TOKEN_NAMES)
    const used = [...WARNING_CSS.matchAll(/var\((--[A-Za-z0-9-]+)/g)].map(match => match[1])
    expect(used.length).toBeGreaterThan(0)
    for (const token of used) expect(allowed.has(token), `${token} is not a host token`).toBe(true)
  })

  it('marks the Chinese warning without changing the published text', async () => {
    const { text } = card0()
    mount()
    await settle()
    expect(warnings(text)).toEqual([WARNING_MARKS.zh])
    expect(text.textContent).toBe(PRESET_COPY.zh.description)
    // The renderer's own node stays first and keeps the run before the warning;
    // everything this half added comes after it.
    expect(text.firstChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(text.firstChild?.nodeValue).toBe(PRESET_COPY.zh.description.replace(WARNING_MARKS.zh, ''))
  })

  it('shows the English copy alone when the interface is not Chinese', async () => {
    const { name, text } = card0()
    mount('en-US')
    await settle()
    expect(name.textContent).toBe(PRESET_COPY.en.name)
    expect(text.textContent).toBe(PRESET_COPY.en.description)
    expect(warnings(text)).toEqual([WARNING_MARKS.en])
    // The published Chinese half is not left anywhere on the card.
    expect(name.parentElement?.textContent).not.toContain('破限模式')
  })

  it('swaps both the copy and the warning when the language changes', async () => {
    const { name, text } = card0()
    const { switchTo } = mount()
    await settle()
    switchTo('en-US')
    await settle()
    expect(name.textContent).toBe(PRESET_COPY.en.name)
    expect(text.textContent).toBe(PRESET_COPY.en.description)
    expect(warnings(text)).toEqual([WARNING_MARKS.en])
    switchTo('zh-CN')
    await settle()
    expect(name.textContent).toBe(PRESET_COPY.zh.name)
    expect(text.textContent).toBe(PRESET_COPY.zh.description)
    expect(warnings(text)).toEqual([WARNING_MARKS.zh])
  })

  it('marks a card that appears after the half is already watching', async () => {
    mount()
    await settle()
    const { text } = card0()
    await settle()
    expect(warnings(text)).toEqual([WARNING_MARKS.zh])
  })

  it('marks the settings card by its preset id', async () => {
    mount()
    await settle()
    const item = document.createElement('li')
    item.setAttribute('data-agent-preset-id', 'unrestricted')
    const description = document.createElement('span')
    description.textContent = PRESET_COPY.zh.description
    item.append(description)
    document.body.append(item)
    await settle()
    expect(warnings(item)).toEqual([WARNING_MARKS.zh])
    expect(description.textContent).toBe(PRESET_COPY.zh.description)
  })

  it('localizes the session-header label and the description tooltip', async () => {
    const label = document.createElement('span')
    label.setAttribute('title', PRESET_COPY.zh.description)
    label.textContent = PRESET_COPY.zh.name
    const bubble = document.createElement('div')
    bubble.setAttribute('role', 'tooltip')
    const bubbleText = document.createElement('span')
    bubbleText.textContent = PRESET_COPY.zh.description
    bubble.append(bubbleText)
    document.body.append(label, bubble)
    mount('en-US')
    await settle()
    expect(label.textContent).toBe(PRESET_COPY.en.name)
    expect(label.getAttribute('title')).toBe(PRESET_COPY.en.description)
    expect(bubbleText.textContent).toBe(PRESET_COPY.en.description)
    expect(warnings(bubble)).toEqual([WARNING_MARKS.en])
  })

  it('leaves another preset card and unrelated text alone', async () => {
    const other = card('标准模式', '处理代码、文件和资料，适合大多数任务。')
    mount()
    await settle()
    const paragraph = document.createElement('p')
    paragraph.textContent = `⚠ 可能导致账号被封禁。${PRESET_COPY.zh.name}`
    document.body.append(paragraph, document.createTextNode(PRESET_COPY.zh.name))
    await settle()
    expect(warnings(other.text)).toEqual([])
    expect(other.text.textContent).toBe('处理代码、文件和资料，适合大多数任务。')
    expect(paragraph.querySelectorAll(`[${WARNING_ATTRIBUTE}]`).length).toBe(0)
  })

  it('repairs its markup instead of duplicating it when the copy is rendered again', async () => {
    const { text } = card0()
    mount()
    await settle()
    const owned = text.firstChild as Text
    expect(owned.nodeType).toBe(Node.TEXT_NODE)
    // A re-render writes the whole description back into the node it owns.
    owned.nodeValue = PRESET_COPY.zh.description
    await settle()
    expect(warnings(text)).toEqual([WARNING_MARKS.zh])
    expect(text.textContent).toBe(PRESET_COPY.zh.description)
  })

  it('stops watching, unsubscribes, and drops its stylesheet once disposed', async () => {
    const { dispose } = mount()
    await settle()
    expect(listeners).toHaveLength(1)
    dispose()
    expect(listeners).toHaveLength(0)
    expect(document.querySelector('style[data-plugin="@klarkxy/dsh-unrestricted"]')).toBeNull()
    const { text } = card0()
    await settle()
    expect(warnings(text)).toEqual([])
  })
})
