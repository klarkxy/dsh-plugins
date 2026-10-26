import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { CONTINUE_SUGGEST_ENDPOINT, resolveConfig } from './contracts.ts'
import { createContinueModel, type ContinueModel } from './presence-model.ts'
import { ContinueGhost } from './presence-panel.tsx'
import { PresenceSettingsStore } from './presence-settings.ts'
import { registerSessionManagerRpc } from './rpc.ts'
import type { PresenceModelHost } from './welcome-back.ts'

function settings() {
  return new PresenceSettingsStore({
    table: () => ({ get: () => undefined, entries: () => [][Symbol.iterator](), put: async () => {} }),
    close: async () => {},
  })
}

/** Real RPC registration, HTTP envelope and client unwrap, with a controlled LLM. */
async function withContinuation(
  run: (fixture: {
    model: ContinueModel
    seq: number
    prepare: ReturnType<typeof vi.fn>
    owner: AbortController
    store: PresenceSettingsStore
    restore(): void
    calls: { signal?: AbortSignal; result?: unknown }[]
    mount(): Promise<void>
    placeholder(): string | null
  }) => Promise<void>,
) {
  const ctx = new Context()
  const dom = new JSDOM('<div id="root"></div>')
  const previous = new Map<string, unknown>()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, (globalThis as Record<string, unknown>)[key])
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root')!)
  const owner = new AbortController()
  let store = settings()
  const originalStore = store
  const prepare = vi.fn(async (config: Record<string, unknown>, _signal: AbortSignal) => ({
    config,
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text: 'Retry the verification' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }))
  function capture(signal: AbortSignal): PresenceModelHost {
    const owned = store
    return {
      host: { llm: { prepareCall: prepare }, agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'same' }) } },
      signal: AbortSignal.any([signal, owned.signal]),
      suggestion: id => owned.suggestion(id),
      rememberSuggestion: (id, seq, text, requestSignal) => owned.rememberSuggestion(id, seq, text, requestSignal),
    }
  }
  let models = capture(owner.signal)
  let handler!: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  const server = createServer((req, res) => { void handler(req, res) })
  const calls: { signal?: AbortSignal; result?: unknown }[] = []
  const model = createContinueModel({ rpc: {
    async call(channel, endpoint, payload, signal) {
      const call = { signal, result: undefined as unknown }
      calls.push(call)
      // Bound a broken component retry loop so a regression fails promptly.
      if (calls.length > 3) { model.cancel(); throw new Error('automatic retry storm') }
      const port = (server.address() as { port: number }).port
      const response = await fetch(`http://127.0.0.1:${port}${channel}/${endpoint}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        body: JSON.stringify({ type: 'client-request', rpcId: String(calls.length), method: endpoint, payload }),
      })
      expect(endpoint).toBe(CONTINUE_SUGGEST_ENDPOINT)
      expect(response.status).toBe(200)
      const envelope = await response.json() as { result: unknown }
      call.result = envelope.result
      return envelope.result
    },
  } })
  let stop = () => {}
  try {
    await ctx.plugin(Sessions)
    await ctx.plugin(Query, [])
    const session = ctx.sessions.create(SessionId('rpc-continue'), { meta: { cwd: resolve('fixture') } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', {
      id: MessageId('u'), role: 'user', source: { kind: 'user' } as never, content: [{ type: 'text', text: 'Verify the repair' }],
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } } as never)
    const seq = session.snapshotEvents().at(-1)!.seq
    stop = registerSessionManagerRpc(ctx, {
      get: () => ({ dir: resolve('fixture-profile') }),
      connection: { requestRejection: () => undefined },
      webServer: { register(route: { handler: typeof handler }) { handler = route.handler; return () => {} } },
    } as never, resolveConfig({ continueMode: 'auto' }), () => models)
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    await run({
      model, seq, prepare, owner, store: originalStore, calls,
      restore() {
        store = settings()
        models = capture(new AbortController().signal)
      },
      async mount() {
        await act(async () => {
          root.render(<div data-composer-card="">
            <div data-composer-input="" data-placeholder="Native" />
            <div data-composer-placeholder="">Native</div>
            <ContinueGhost model={model} sessionId="rpc-continue" locale="en"
              useInput={select => select({ draft: '', phase: 'plain', attachmentIds: [] })}
              useSession={select => select({ blank: false })}
            />
          </div>)
        })
      },
      placeholder: () => dom.window.document.querySelector('[data-composer-placeholder]')!.textContent,
    })
  } finally {
    model.cancel()
    await act(async () => root.unmount())
    stop()
    server.closeAllConnections()
    if (server.listening) await new Promise<void>(done => server.close(() => done()))
    await originalStore.close()
    await store.close()
    await ctx.fiber.dispose()
    for (const [key, value] of previous) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
      else Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
    dom.window.close()
  }
}

describe('continuation cancellation across registered RPC', () => {
  it.each(['model', 'storage'])('retries the same cut after server %s owner cancellation without cancelling the client or auto-retrying', async cancelled => {
    await withContinuation(async f => {
      let release!: () => void
      const gate = new Promise<void>(done => { release = done })
      const original = f.prepare.getMockImplementation()!
      f.prepare.mockImplementationOnce(async (...args) => { await gate; return original(...args) })
      const initial = f.model.getSnapshot('rpc-continue')
      const changed = vi.fn()
      f.model.subscribe(changed)
      await f.mount()
      await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce())
      if (cancelled === 'model') f.owner.abort()
      else await f.store.close()
      release()
      await act(async () => {
        await vi.waitFor(() => expect(f.calls[0]?.result).toMatchObject({
          ok: false, error: { code: 'session-manager/failed', message: 'request cancelled' },
        }))
      })
      expect(f.calls[0]!.signal?.aborted).toBe(false)
      expect(f.model.getSnapshot('rpc-continue')).toBe(initial)
      expect(changed).not.toHaveBeenCalled()
      expect(f.placeholder()).toBe('Native')
      expect(f.store.suggestion('rpc-continue')).toBeUndefined()
      await act(async () => {
        await new Promise<void>(done => setImmediate(done))
        await new Promise<void>(done => setImmediate(done))
      })
      expect(f.calls).toHaveLength(1)

      f.restore()
      await act(async () => {
        f.model.load('rpc-continue')
        await vi.waitFor(() => expect(f.model.getSnapshot('rpc-continue')).toEqual({
          seq: f.seq, text: 'Retry the verification',
        }))
      })
      expect(f.calls).toHaveLength(2)
      expect(f.calls[1]!.result).toEqual({ ok: true, value: { seq: f.seq, text: 'Retry the verification' } })
      expect(f.prepare).toHaveBeenCalledTimes(2)
      expect(f.placeholder()).toBe('Retry the verification')
    })
  })

  it('generates again when a finished idle session is reopened after an empty result', async () => {
    await withContinuation(async f => {
      f.prepare.mockRejectedValueOnce(new Error('model failed'))
      await f.mount()
      await act(async () => {
        await vi.waitFor(() => expect(f.model.getSnapshot('rpc-continue')).toEqual({ seq: f.seq, text: null }))
      })
      expect(f.calls[0]!.result).toEqual({ ok: true, value: { seq: f.seq, text: null } })
      expect(f.store.suggestion('rpc-continue')).toEqual({ seq: f.seq, text: null })
      await act(async () => {
        f.model.invalidate('rpc-continue')
        f.model.load('rpc-continue')
        await vi.waitFor(() => expect(f.model.getSnapshot('rpc-continue')).toEqual({
          seq: f.seq, text: 'Retry the verification',
        }))
      })
      expect(f.calls).toHaveLength(2)
      expect(f.prepare).toHaveBeenCalledTimes(2)
      expect(f.placeholder()).toBe('Retry the verification')
    })
  })
})
