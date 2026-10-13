import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { GitCommitAction } from './client.tsx'

describe('Git Commit partial outcome interaction', () => {
  it.each(['commit-failed', 'cancelled', 'hash-unavailable', 'uncertain-empty', 'uncertain-known'])('shows durable commits and refreshes remaining changes after %s', async code => {
    const dom = new JSDOM('<div id="root"></div>')
    const previous = new Map<string, unknown>()
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
      Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, (globalThis as Record<string, unknown>)[key])
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    let statusReads = 0
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint === 'status') return { ok: true, value: { available: true, branch: 'main', workspace: { files: ++statusReads === 1 ? 2 : 1 } } }
      return { ok: false, error: { code, message: 'second group diagnostic', partial: {
        branch: 'main', commits: code === 'uncertain-empty' ? [] : [{ hash: code === 'hash-unavailable' ? '' : 'abc1234', message: 'first durable', files: ['a.txt'] }],
        fallback: false, failure: { code, message: 'second group diagnostic' }, remaining: [{ message: 'second pending', files: ['b.txt'] }],
        ...(code.startsWith('uncertain') ? { uncertain: [{ message: 'uncertain group', files: ['c.txt'] }] } : {}),
      } } }
    })
    const text: Record<string, string> = { partial: 'Partial commits kept', hashUnavailable: 'Commit created; hash unavailable',
      stopped: 'Run did not finish with a confirmed result', uncertain: 'Outcome uncertain. Check Git log and status before acting.',
      remaining: 'Groups not committed: {n}', filesCount: ' ({n} files)', cancelled: 'Commit run cancelled' }
    const t = (key: string) => text[key] ?? key
    const useSession = () => false
    try {
      await act(async () => root.render(<GitCommitAction sessionId="s1" call={call} useSession={useSession} t={t} />))
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click())
      const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.startsWith(label))!
      await act(async () => button('commitAction').click())
      await act(async () => button('confirm').click())
      const body = dom.window.document.body.textContent!
      expect(body).toContain(code === 'uncertain-empty' ? 'Run did not finish with a confirmed result' : 'Partial commits kept')
      if (code === 'uncertain-empty') {
        expect(body).not.toContain('first durable')
        expect(body).not.toContain('abc1234')
      } else {
        expect(body).toContain('first durable')
        expect(body).toContain('a.txt')
        expect(body).toContain(code === 'hash-unavailable' ? 'Commit created; hash unavailable' : 'abc1234')
      }
      if (code.startsWith('uncertain')) {
        expect(body).toContain('Outcome uncertain. Check Git log and status before acting.')
        expect(body).toContain('uncertain group')
        const lists = [...dom.window.document.querySelectorAll('.gcm-commits')]
        expect(lists[1]!.textContent).toContain('c.txt')
        expect(lists[2]!.textContent).not.toContain('c.txt')
      }
      expect(body).toContain('second pending')
      expect(body).toContain('b.txt')
      expect(body).toContain('Groups not committed: 1')
      expect(body).toContain('commitAction (1 files)')
      expect(dom.window.document.querySelector('[role="alert"]')!.textContent).toBe(code === 'cancelled' ? 'Commit run cancelled' : 'second group diagnostic')
      expect(call.mock.calls.filter(([endpoint]) => endpoint === 'commit')).toHaveLength(1)
      expect(statusReads).toBe(2)
    } finally {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, value] of previous) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })
})
