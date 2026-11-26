// @vitest-environment jsdom
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { OFFICIAL_THEME_TOKEN_NAMES } from '@klarkxy/dsh-plugin-kit/official-ui'
import { SHORTCUTS_STYLES } from './styles.ts'
import {
  FIND_COMMAND_ID,
  FIND_SHORTCUT_DEFAULTS,
  MAX_HISTORY_CACHE_BYTES,
  SCOPE_EXTRA_KEYS,
  assembleSearchableItems,
  clampOverlayPosition,
  conversationContextKey,
  createFindController,
  createHistoryCache,
  extractMarkdownVisibleText,
  extractPageFromEvents,
  matchItems,
  pickVerifiedHitRange,
  readSavedOverlayPosition,
  resolveSessionAddress,
  writeSavedOverlayPosition,
} from './conversation-find.ts'
import { FindBarOverlay } from './conversation-find-ui.tsx'

function makeObservable<T>(initial: T) {
  let val = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => val,
    set(next: T) {
      val = next
      for (const fn of [...listeners]) fn()
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

function makeMsgEvent(seq: number, turn: number, text: string, kind: 'user' | 'response' = 'user') {
  return {
    type: 'event',
    event: kind === 'user'
      ? { seq, type: 'user/message', surfaceOp: 'append', data: { id: `m${seq}`, source: { kind: 'user' }, content: [{ type: 'text', text }] } }
      : { seq, type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 1, message: { id: `a${seq}`, content: [{ type: 'text', text }] } } },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  window.localStorage?.clear()
})

describe('conversation-find stylesheet scope and official token guard', () => {
  it('uses only whitelisted official theme tokens with zero literal color fallbacks', () => {
    const allowed = new Set<string>(OFFICIAL_THEME_TOKEN_NAMES)
    const tokens = [...SHORTCUTS_STYLES.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map(m => m[1]!)
    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) {
      expect(allowed.has(token), `unexpected token ${token}`).toBe(true)
    }
    expect(SHORTCUTS_STYLES).not.toMatch(/var\(\s*--[a-z0-9-]+\s*,\s*(#|rgb|hsl|\d)/i)
  })
})

describe('conversation-find extraction, scopes, and 8 MiB history cache', () => {
  it('extracts durable & streaming events, deduplicates replacements, redacts raw error secrets, and strips Markdown syntax', () => {
    expect(extractMarkdownVisibleText('[one.html](./reports/one.html) / [two.html](./reports/two.html)')).toBe('one.html / two.html')
    expect(extractMarkdownVisibleText('report.**html** and `raw.**md**`')).toBe('report.html and raw.**md**')

    const events = [
      { seq: 0, type: 'turn/start', data: { turn: 2 } },
      { seq: 1, type: 'user/message', surfaceOp: 'append', data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'user needle' }] } },
      { seq: 2, type: 'assistant/message', surfaceOp: { op: 'replace', seq: 2 }, data: { turn: 2, step: 1, message: { id: 'a0', content: [{ type: 'text', text: 'replaced needle' }] } } },
      { seq: 3, type: 'assistant/message', surfaceOp: 'append', data: { turn: 2, step: 1, message: { id: 'a1', content: [{ type: 'reasoning', text: 'thought needle' }, { type: 'text', text: 'settled [needle.html](./needle.html)' }] } } },
      { seq: 4, type: 'tool/result', surfaceOp: 'append', data: { error: { code: 'EFAIL', message: 'tool needle', token: 'secret-omit' }, message: { source: { callId: 'tc1' }, content: [{ type: 'text', text: 'out needle' }] } } },
    ]
    const page = extractPageFromEvents(events)
    const items = assembleSearchableItems(page.boundaries, page.rawItems, [])
    expect(items.some(it => it.fields.some(f => f.text.includes('replaced') || f.text.includes('secret-omit')))).toBe(false)
    const hits = matchItems(items, 'needle', false)
    expect(hits.map(h => h.sourceKind)).toEqual(['user', 'reasoning', 'response', 'tool', 'tool'])
  })

  it('defaults to body-only scope and scans older pages with 8 MiB LRU eviction + loadThrough jump', async () => {
    expect(MAX_HISTORY_CACHE_BYTES).toBe(8 * 1024 * 1024)
    expect(FIND_COMMAND_ID).toBe('conversation.findInSession')
    expect(FIND_SHORTCUT_DEFAULTS['desktop:windows']).toEqual({ code: 'KeyF', modifiers: ['primary'] })
    expect(FIND_SHORTCUT_DEFAULTS['web:windows']).toEqual({ code: 'KeyF', modifiers: ['primary', 'alt'] })
    expect(resolveSessionAddress({ subagentAddress: () => ({ parentSessionId: 'wsl:p', childSessionId: 'wsl:c' }) }, null, 'wsl:c')).toEqual({
      parentSessionId: 'wsl:p',
      childSessionId: 'wsl:c',
      kind: 'subagent',
    })

    const cache = createHistoryCache(400)
    const big = `${'x'.repeat(150)} needle ${'y'.repeat(150)}`
    cache.setCompactEvaluator(p => matchItems(assembleSearchableItems(p.boundaries, p.extracted.rawItems, []), 'needle', false, { includeExcerpts: false }))
    cache.putPage({ minSeq: 0, maxSeq: 0, reqThroughSeq: 1, reqBeforeSeq: 1, extracted: extractPageFromEvents([makeMsgEvent(0, 0, big).event]) })
    cache.putPage({ minSeq: 1, maxSeq: 1, reqThroughSeq: 1, reqBeforeSeq: 2, extracted: extractPageFromEvents([makeMsgEvent(1, 1, big).event]) })
    expect(cache.pages.get('0..0')?.evicted).toBe(true)
    expect(cache.pages.get('0..0')?.compactHits).toHaveLength(1)

    document.body.innerHTML = `
      <div data-conversation-session="s1">
        <div data-conversation-scroll="true">
          <div data-chat-flow="true">
            <div data-chat-node-key="${conversationContextKey('assistant-step', '1:1')}" data-chat-group-part="reasoning">thought targetToken</div>
            <div data-chat-node-key="${conversationContextKey('assistant-step', '1:1')}" data-chat-group-part="response">reply <strong>targetToken</strong></div>
          </div>
        </div>
      </div>
    `
    const fullLog = [
      makeMsgEvent(0, 0, 'ancient targetToken').event,
      {
        seq: 1,
        type: 'assistant/message',
        surfaceOp: 'append',
        data: {
          turn: 1,
          step: 1,
          message: {
            id: 'a1',
            content: [
              { type: 'reasoning', text: 'thought targetToken' },
              { type: 'text', text: 'reply **targetToken**' },
            ],
          },
        },
      },
    ]
    const evSource = makeObservable({ entries: [{ type: 'event', event: fullLog[1] }], hasMore: true, revision: 1 })
    const jumpTargets: number[] = []
    const session = {
      ...makeObservable({ sessionId: 's1', blank: false, removed: false, loadingOlder: false, hasMore: true }),
      async loadThrough(seq: number) {
        jumpTargets.push(seq)
        evSource.set({ entries: fullLog.map(event => ({ type: 'event', event })), hasMore: false, revision: 2 })
        const flow = document.querySelector('[data-chat-flow]')!
        const older = document.createElement('div')
        older.setAttribute('data-chat-node-key', conversationContextKey('input-message', 'm0'))
        older.textContent = 'ancient targetToken'
        flow.prepend(older)
      },
    }
    const sessions = {
      list: makeObservable({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }),
      binding: (id: string) => (id === 's1' ? { sessionId: 's1', session, eventSource: evSource } : null),
    }
    const remoteSession = {
      async events(req: Record<string, unknown>) {
        if ((typeof req.beforeSeq === 'number' ? req.beforeSeq : 99) >= 1) {
          return { ok: true, value: { cursor: 1, records: [{ type: 'event', event: fullLog[0] }], hasMore: false } }
        }
        return { ok: true, value: { cursor: 1, records: [], hasMore: false } }
      },
    }
    const ctrl = createFindController({ sessions, remoteSession })
    ctrl.openFind()
    ctrl.setQuery('targetToken')
    ctrl.recomputeLocal()

    expect(ctrl.getSnapshot().scope.body).toBe(true)
    for (const k of SCOPE_EXTRA_KEYS) expect(ctrl.getSnapshot().scope[k]).toBe(false)
    expect(ctrl.getSnapshot().hits.map(h => h.sourceKind)).toEqual(['response'])

    ctrl.toggleScopeKey('reasoning')
    expect(ctrl.getSnapshot().hits.map(h => h.sourceKind)).toEqual(['reasoning', 'response'])
    ctrl.resetScope()

    await ctrl.startOrResumeScan()
    expect(ctrl.getSnapshot().scanState).toBe('done')
    expect(ctrl.getSnapshot().hits.map(h => h.seq)).toEqual([0, 1])
    await ctrl.jumpToHit(0)
    expect(jumpTargets).toEqual([0])
    ctrl.dispose()
  })

  it('matches across inline Markdown elements and renders draggable/IME-safe FindBarOverlay', async () => {
    const part = document.createElement('div')
    part.append('report.')
    const strong = document.createElement('strong')
    strong.textContent = 'html'
    part.appendChild(strong)
    const range = pickVerifiedHitRange(part, { blockOrdinal: 0 }, 'report.html', true, 1)
    expect(range?.toString()).toBe('report.html')

    expect(clampOverlayPosition({ left: -40, top: 900 }, { width: 420, height: 48 }, { width: 1000, height: 700 })).toEqual({ left: 8, top: 644 })
    // Use an explicit memory store: newer Node versions expose their own
    // global window/localStorage in the jsdom environment without a backing
    // file, so the ambient browser store cannot be relied on in tests.
    const memoryStorage = new Map<string, string>()
    const storage = {
      getItem: (key: string) => memoryStorage.get(key) ?? null,
      setItem: (key: string, value: string) => { memoryStorage.set(key, value) },
      removeItem: (key: string) => { memoryStorage.delete(key) },
    } as unknown as Storage
    writeSavedOverlayPosition({ left: 180, top: 90 }, storage)
    expect(readSavedOverlayPosition(storage)).toEqual({ left: 180, top: 90 })

    document.body.innerHTML = `<button id="trig">Find</button><div data-conversation-session="s1"><div data-chat-flow="true"><div data-chat-node-key="${conversationContextKey('input-message', 'm0')}">hello world</div></div></div><div id="mount"></div>`
    const trigger = document.getElementById('trig')!
    const sessions = {
      list: makeObservable({ byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } } }),
      binding: () => ({
        sessionId: 's1',
        session: makeObservable({ sessionId: 's1', blank: false, removed: false, hasMore: false }),
        eventSource: makeObservable({ entries: [makeMsgEvent(0, 0, 'hello world')], hasMore: false, revision: 1 }),
      }),
    }
    const ctrl = createFindController({ sessions })
    trigger.focus()
    ctrl.openFind(trigger)

    const root = createRoot(document.getElementById('mount')!)
    await act(async () => {
      root.render(<FindBarOverlay controller={ctrl} />)
    })

    const bar = document.querySelector('.sc-find-bar')!
    await act(async () => {
      bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(ctrl.getSnapshot().scopeMenuOpen).toBe(true)

    const input = document.querySelector<HTMLInputElement>('[data-shortcuts-find-input="true"]')!
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(ctrl.getSnapshot().scopeMenuOpen).toBe(false)
    expect(ctrl.getSnapshot().open).toBe(true)

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(ctrl.getSnapshot().open).toBe(false)
    expect(document.activeElement).toBe(trigger)

    await act(async () => {
      root.unmount()
    })
    ctrl.dispose()
  })
})
