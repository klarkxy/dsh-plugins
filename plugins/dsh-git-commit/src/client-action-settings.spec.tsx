import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { GitCommitAction } from './client.tsx'

const ok = (value: unknown) => ({ ok: true, value })
const catalog = { groups: [{ id: 'p', models: ['a', 'b'].map(id => ({ id })) }] }

// Only the keys this flow reads; filesCount keeps the real interpolation.
const text: Record<string, string> = {
  commitAction: 'Commit all',
  filesCount: ' ({n} files)',
  confirm: 'Commit now',
  cancel: 'Cancel',
  confirmPrompt: 'Will commit {n} files.',
}
const t = (key: string) => text[key] ?? key

interface StoredRow {
  revision: number
  model: { provider: string; model: string }
  allowFallback: boolean
}

function deferred() {
  let resolve!: (value?: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

interface Harness {
  dom: JSDOM
  stored: StoredRow
  rpc: ReturnType<typeof vi.fn>
  commits: unknown[]
  settingsReads: number
  /** Present when mounted with holdSettings: gates the stored-row read. */
  settingsGate?: ReturnType<typeof deferred>
  open: () => Promise<void>
  close: () => Promise<void>
  commitButton: () => HTMLButtonElement
  /** Every button in the jsdom document, including portaled popover content. */
  buttons: () => HTMLButtonElement[]
}

async function mount(run: (h: Harness) => Promise<void>, options: {
  model?: string
  holdSettings?: boolean
} = {}) {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>')
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  // jsdom ships no layout; the drilled model pane scrolls the selected row.
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}
  const root = createRoot(dom.window.document.getElementById('root')!)
  const stored: StoredRow = { revision: 1, model: { provider: 'p', model: options.model ?? 'a' }, allowFallback: false }
  const commits: unknown[] = []
  const settingsGate = options.holdSettings ? deferred() : undefined
  let settingsReads = 0
  const rpc = vi.fn(async (_channel: string, endpoint: string, payload?: { settings?: Partial<StoredRow>; expectedRevision?: number }) => {
    switch (endpoint) {
      case 'status': return ok({ available: true, branch: 'main', workspace: { files: 2 } })
      case 'settings':
        settingsReads += 1
        if (settingsGate) await settingsGate.promise
        return ok(structuredClone(stored))
      case 'settings.update': {
        const patch = payload?.settings
        if (!patch || payload?.expectedRevision !== stored.revision) {
          return { ok: false, error: { code: 'stale', message: 'settings changed' } }
        }
        stored.revision += 1
        if (patch.model) stored.model = structuredClone(patch.model) as StoredRow['model']
        if (patch.allowFallback !== undefined) stored.allowFallback = patch.allowFallback
        return ok(structuredClone(stored))
      }
      case 'commit': {
        commits.push(payload)
        return ok({ branch: 'main', commits: [{ hash: 'abc1234', message: 'one', files: ['a.txt'] }], fallback: false })
      }
      default: return { ok: false, error: { code: 'not-found', message: endpoint } }
    }
  })
  const client = {
    connection: {
      rpc: { call: (channel: string, endpoint: string, payload?: unknown) => rpc(channel, endpoint, payload) },
      generation: { subscribe: () => () => {} },
    },
    remote: { session: { modelCatalog: async () => catalog } },
    locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
  }
  const useSession = () => false
  try {
    await act(async () => root.render(
      <GitCommitAction
        sessionId="s1"
        call={(_endpoint, payload) => rpc('ignored', _endpoint, payload)}
        useSession={useSession}
        t={t}
        client={client as never}
      />,
    ))
    const trigger = () => dom.window.document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!
    const h: Harness = {
      dom, stored, rpc, commits, settingsGate,
      get settingsReads() { return settingsReads },
      open: async () => { await act(async () => trigger().click()); await act(async () => {}) },
      close: async () => { await act(async () => trigger().click()) },
      commitButton: () => h.buttons().find(item => item.textContent === 'Commit all (2 files)')!,
      buttons: () => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')],
    }
    await h.open()
    await run(h)
  } finally {
    await act(async () => root.unmount())
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
}

/** Drills the model pane and picks the row whose trailing model name matches.
 * When `pointerdown` is true the pick click is preceded by a real pointerdown,
 * matching the browser event order that used to close the parent popover. */
async function pickModel(dom: JSDOM, name: string, pointerdown = false) {
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!.click())
  await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  const row = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    .find(item => item.textContent?.endsWith(` ${name}`) || item.textContent === name)
  expect(row, `model row ${name}`).toBeTruthy()
  if (pointerdown) {
    await act(async () => {
      row!.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    })
  }
  await act(async () => row!.click())
}

describe('Git Commit popover model settings', () => {
  it('locks commit while a pick saves, commits only after the default is stored, and restores it on reopen', async () => {
    await mount(async h => {
      expect(h.dom.window.document.querySelector('.dsh-model-menu-trigger')).toBeTruthy()
      expect(h.commitButton().disabled).toBe(false)
      // Gate the write so the commit button must visibly lock mid-save.
      const save = deferred()
      const original = h.rpc.getMockImplementation()!
      h.rpc.mockImplementation(async (channel, endpoint, payload) => {
        if (endpoint === 'settings.update') await save.promise
        return original(channel, endpoint, payload)
      })
      await pickModel(h.dom, 'b')
      expect(h.commitButton().disabled).toBe(true)
      expect(h.commits).toHaveLength(0)
      await act(async () => { save.resolve() })
      await act(async () => {})
      expect(h.commitButton().disabled).toBe(false)
      expect(h.stored.model).toEqual({ provider: 'p', model: 'b' })
      expect(h.dom.window.document.body.textContent).toContain('Saved.')
      await act(async () => h.commitButton().click())
      await act(async () => h.buttons().find(item => item.textContent === 'Commit now')!.click())
      expect(h.commits).toHaveLength(1)
      // Reopen: the embedded block remounts and reads the stored row back.
      await h.close()
      await h.open()
      expect(h.dom.window.document.querySelector('.dsh-model-menu-triggerLabel')?.textContent).toContain('b')
    })
  })

  it('keeps the popover open when a pointerdown inside the model menu precedes the pick', async () => {
    await mount(async h => {
      // Browsers dispatch pointerdown before click; the menu is portaled to
      // document.body outside the commit dialog, so dismissal once treated a
      // pick as an outside click and closed the popover before onPick ran.
      await pickModel(h.dom, 'b', true)
      expect(h.dom.window.document.querySelector('[role="dialog"]')).toBeTruthy()
      expect(h.stored.model.model).toBe('b')
    })
  })

  it('still closes the popover on a genuine outside pointerdown', async () => {
    await mount(async h => {
      expect(h.dom.window.document.querySelector('[role="dialog"]')).toBeTruthy()
      await act(async () => {
        h.dom.window.document.body.dispatchEvent(new h.dom.window.MouseEvent('pointerdown', { bubbles: true }))
      })
      expect(h.dom.window.document.querySelector('[role="dialog"]')).toBeNull()
    })
  })

  it('locks commit after a rejected write until the row reloads and the pick is retried', async () => {
    await mount(async h => {
      const original = h.rpc.getMockImplementation()!
      let rejected = true
      h.rpc.mockImplementation(async (channel, endpoint, payload) => {
        if (rejected && endpoint === 'settings.update') {
          return { ok: false, error: { code: 'internal', message: 'disk full' } }
        }
        return original(channel, endpoint, payload)
      })
      await pickModel(h.dom, 'b')
      expect(h.dom.window.document.body.textContent).toContain('could not be saved')
      expect(h.commitButton().disabled).toBe(true)
      expect(h.stored.model.model).toBe('a')
      expect(h.commits).toHaveLength(0)
      // Recovery path: refresh rereads the stored row, the pick is retried.
      await act(async () => h.buttons().find(item => item.textContent === 'Refresh settings')!.click())
      expect(h.dom.window.document.body.textContent).not.toContain('could not be saved')
      rejected = false
      await pickModel(h.dom, 'b')
      await act(async () => {})
      expect(h.commitButton().disabled).toBe(false)
      expect(h.stored.model).toEqual({ provider: 'p', model: 'b' })
    })
  })

  it('refuses to close the popover while a write is pending, then shows the saved pick and commits', async () => {
    await mount(async h => {
      const save = deferred()
      const original = h.rpc.getMockImplementation()!
      h.rpc.mockImplementation(async (channel, endpoint, payload) => {
        if (endpoint === 'settings.update') await save.promise
        return original(channel, endpoint, payload)
      })
      await pickModel(h.dom, 'b')
      // The trigger click is ignored while the write is in flight: the panel
      // stays mounted so its settle can display the row it actually stored.
      await h.close()
      expect(h.dom.window.document.querySelector('[role="dialog"]')).toBeTruthy()
      expect(h.commitButton().disabled).toBe(true)
      await act(async () => h.commitButton().click())
      expect(h.commits).toHaveLength(0)
      await act(async () => { save.resolve() })
      await act(async () => {})
      expect(h.commitButton().disabled).toBe(false)
      // The picker shows the stored model — never the pre-write value — before
      // the commit button unlocks.
      expect(h.dom.window.document.querySelector('.dsh-model-menu-triggerLabel')?.textContent).toContain('b')
      expect(h.stored.model.model).toBe('b')
      await act(async () => h.commitButton().click())
      await act(async () => h.buttons().find(item => item.textContent === 'Commit now')!.click())
      expect(h.commits).toHaveLength(1)
      // Closing is allowed again once no write is pending.
      await h.close()
      expect(h.dom.window.document.querySelector('[role="dialog"]')).toBeNull()
    })
  })

  it('locks commit until the settings read resolves, on the first open and every reopen', async () => {
    await mount(async h => {
      // Status arrived but the stored row has not: no model pick is visible
      // yet, so committing would bypass the saved default entirely.
      expect(h.dom.window.document.body.textContent).toContain('Commit all')
      expect(h.commitButton().disabled).toBe(true)
      expect(h.dom.window.document.querySelector('.dsh-model-menu-trigger')).toBeNull()
      await act(async () => { h.settingsGate!.resolve() })
      await act(async () => {})
      expect(h.dom.window.document.querySelector('.dsh-model-menu-trigger')).toBeTruthy()
      expect(h.commitButton().disabled).toBe(false)

      // Reopening remounts the block: the previous proof is discarded and the
      // commit locks again until this open's own read lands.
      const secondRead = deferred()
      const original = h.rpc.getMockImplementation()!
      let gated = true
      h.rpc.mockImplementation(async (channel, endpoint, payload) => {
        if (gated && endpoint === 'settings') await secondRead.promise
        return original(channel, endpoint, payload)
      })
      await h.close()
      await h.open()
      expect(h.commitButton().disabled).toBe(true)
      expect(h.dom.window.document.querySelector('.dsh-model-menu-trigger')).toBeNull()
      await act(async () => { secondRead.resolve() })
      await act(async () => {})
      expect(h.commitButton().disabled).toBe(false)
    }, { holdSettings: true })
  })

  it('keeps the fallback switch and locks model controls while a commit run is in flight', async () => {
    await mount(async h => {
      const gate = deferred()
      const original = h.rpc.getMockImplementation()!
      h.rpc.mockImplementation(async (channel, endpoint, payload) => {
        if (endpoint === 'commit') {
          // Record the dispatch before the gate, then hold the result so the
          // UI stays in its running state while assertions run.
          h.commits.push(payload)
          await gate.promise
          return ok({ branch: 'main', commits: [{ hash: 'abc', message: 'm', files: ['a.txt'] }], fallback: false })
        }
        return original(channel, endpoint, payload)
      })
      const toggle = h.dom.window.document.querySelector<HTMLButtonElement>('[role="switch"]')
      expect(toggle).toBeTruthy()
      await act(async () => toggle!.click())
      expect(h.stored.allowFallback).toBe(true)
      await act(async () => h.commitButton().click())
      await act(async () => h.buttons().find(item => item.textContent === 'Commit now')!.click())
      expect(h.commits).toHaveLength(1)
      expect(h.dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!.disabled).toBe(true)
      expect(h.dom.window.document.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true)
      await act(async () => { gate.resolve() })
      await act(async () => {})
      expect(h.dom.window.document.querySelector<HTMLButtonElement>('.dsh-model-menu-trigger')!.disabled).toBe(false)
    })
  })

  it('renders no settings block without an injected client', async () => {
    const dom = new JSDOM('<div id="root"></div>')
    const previous = new Map<string, PropertyDescriptor | undefined>()
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, Node: dom.window.Node,
      Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
      HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    const root = createRoot(dom.window.document.getElementById('root')!)
    try {
      const call = vi.fn(async (endpoint: string) => endpoint === 'status'
        ? ok({ available: true, branch: 'main', workspace: { files: 1 } })
        : { ok: false, error: { code: 'unexpected', message: endpoint } })
      await act(async () => root.render(
        <GitCommitAction sessionId="s" call={call} useSession={() => false} t={t} />,
      ))
      await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click())
      await act(async () => {})
      expect(dom.window.document.querySelector('[data-testid="git-commit-settings"]')).toBeNull()
      expect(call.mock.calls.filter(([endpoint]) => endpoint === 'settings')).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
      dom.window.close()
    }
  })
})
