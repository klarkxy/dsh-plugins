import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from './index.ts'
import { RPC_CHANNEL, RPC_ENDPOINTS } from './contracts.ts'

const fixtures = fileURLToPath(new URL('../test/fixtures/', import.meta.url))
const listing = JSON.parse(readFileSync(`${fixtures}models.deepseek-harness.json`, 'utf8'))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A minimal cordis-like context without connection/webServer, plus a settings store. */
function makeHost(options: { syncOnStart?: boolean; child?: Record<string, unknown> } = {}) {
  const rows = new Map<string, { base: Record<string, unknown>; user: Record<string, unknown>; revision: number }>([
    ['llm-pi-ai', { base: {}, user: {}, revision: 1 }],
    ['agent-default-model', { base: { provider: 'deepseek-official', model: 'deepseek-flash' }, user: {}, revision: 1 }],
    ['web-search-deepseek', { base: { apiKeyEnv: 'DEEPSEEK_API_KEY' }, user: {}, revision: 1 }],
    ['magpie', { base: {}, user: {}, revision: 1 }],
  ])
  const credentials = new Map<string, string>()
  const provided = new Map<string, unknown>()
  const injected: string[][] = []
  const disposers: (() => void)[] = []
  const ctx = {
    fiber: undefined,
    logger: { warn: vi.fn() },
    provide(name: string, value: unknown) { provided.set(name, value) },
    effect(run: () => unknown) {
      const dispose = run() as (() => void) | undefined
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    inject(deps: readonly string[], callback: (child: unknown) => void) {
      injected.push([...deps])
      if (options.child) callback(options.child)
      return { dispose() {} }
    },
    credentials: {
      resolve: async (ref: string) => credentials.has(ref) ? { value: credentials.get(ref)! } : undefined,
      describe: async (ref: string) => ({ configured: credentials.has(ref), writable: true }),
      set: async (ref: string, value: string) => { credentials.set(ref, value) },
      unset: async (ref: string) => { credentials.delete(ref) },
    },
    loader: { await: async () => {} },
    settings: {
      writable: true,
      configure: () => () => {},
      describe() {
        return [...rows].map(([ns, row]) => ({
          ns, user: { ...row.user }, value: { ...row.base, ...row.user }, revision: row.revision,
        }))
      },
      async mutate(ns: string, ops: { op: string; path: string[]; value?: unknown }[], expected?: number) {
        const row = rows.get(ns)
        if (!row || (expected !== undefined && expected !== row.revision)) throw new Error('settings conflict')
        for (const op of ops) {
          if (op.op === 'set') {
            let node = row.user
            for (const key of op.path.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>
            node[op.path.at(-1)!] = op.value
          }
        }
        row.revision += 1
      },
    },
  }
  const config = {
    address: 'http://127.0.0.1:3425',
    apiKeyEnv: 'MAGPIE_GATEWAY_KEY',
    syncOnStart: options.syncOnStart ?? true,
    webSearch: false,
  }
  const dispose = () => disposers.splice(0).reverse().forEach(run => run())
  return { ctx, config, rows, credentials, provided, injected, dispose }
}

function stubGateway() {
  const original = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const text = String(url)
    if (!text.startsWith('http://127.0.0.1:3425/')) return original(url, init)
    const body = text.endsWith('/v1/models') ? listing : { name: 'magpie', version: '0.1.2798' }
    return { ok: true, status: 200, json: async () => body } as Response
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

describe('host wiring without a web server', () => {
  it('requires only settings, credentials, and loader', () => {
    expect([...inject]).toEqual(['settings', 'loader'])
  })

  it('provides the service and runs startup sync in a webServer-less context', async () => {
    const restore = stubGateway()
    try {
      const host = makeHost()
      apply(host.ctx as never, host.config as never)
      expect(host.provided.has('magpie')).toBe(true)
      // The credentials and RPC children wait for optional services; on this
      // host neither fires, so the env/loopback key path is used.
      expect(host.injected).toEqual([['credentials'], ['connection', 'webServer']])
      // loader.await() resolves, then the startup sync lands asynchronously.
      await new Promise(resolve => setTimeout(resolve, 50))
      const providers = (host.rows.get('llm-pi-ai')!.user as { providers?: object }).providers
      expect(providers && Object.keys(providers)).toEqual(['magpie', 'magpie-responses', 'magpie-anthropic'])
      host.dispose()
    } finally {
      restore()
    }
  })

  it('skips startup sync when syncOnStart is off', async () => {
    const restore = stubGateway()
    try {
      const host = makeHost({ syncOnStart: false })
      apply(host.ctx as never, host.config as never)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect((host.rows.get('llm-pi-ai')!.user as { providers?: object }).providers).toBeUndefined()
      host.dispose()
    } finally {
      restore()
    }
  })
})

describe('settings-page RPC over the real transport', () => {
  async function withRpcServer(run: (call: (endpoint: string, payload?: unknown) => Promise<{ status: number; body: { result?: { ok: boolean; value?: unknown } } }>) => Promise<void>) {
    const restore = stubGateway()
    let handler: ((req: unknown, res: unknown) => void) | undefined
    const child = {
      effect(run: () => unknown) { run() },
      credentials: undefined as unknown,
      connection: { requestRejection: () => undefined },
      webServer: {
        register(route: { kind: string; path: string; handler: typeof handler }) {
          if (route.path === RPC_CHANNEL) handler = route.handler
          return () => {}
        },
      },
    }
    const host = makeHost({ syncOnStart: false, child })
    child.credentials = host.ctx.credentials
    apply(host.ctx as never, host.config as never)
    const server: Server = createServer((req, res) => {
      if (handler === undefined) { res.writeHead(404); res.end(); return }
      void handler(req, res)
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const port = (server.address() as { port: number }).port
    const call = async (endpoint: string, payload?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}${RPC_CHANNEL}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request', rpcId: 'test', method: endpoint,
          ...payload === undefined ? {} : { payload },
        }),
      })
      return { status: response.status, body: await response.json().catch(() => ({})) }
    }
    try {
      await run(call)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(done => server.close(() => done()))
      host.dispose()
      restore()
    }
  }

  it('admits every wire endpoint the settings page calls', async () => {
    await withRpcServer(async call => {
      for (const endpoint of Object.values(RPC_ENDPOINTS)) {
        const response = await call(endpoint, {})
        expect(response.status, `endpoint ${endpoint}`).toBe(200)
        expect(response.body.result?.ok, `endpoint ${endpoint}`).toBe(true)
      }
      // The old camelCase names the transport rejected with 404 stay rejected.
      for (const legacy of ['saveConnection', 'setOptions']) {
        expect((await call(legacy, {})).status, `legacy ${legacy}`).toBe(404)
      }
    })
  })
})
