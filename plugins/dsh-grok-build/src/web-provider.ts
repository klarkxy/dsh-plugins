import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import type { WebSearchProvider, WebFetchProvider } from '@deepseek-ai/dsh-web'
import { WEB_PROVIDER_AVAILABILITY_EVENT, type DshWebManagementDescriptor } from '@klarkxy/dsh-plugin-kit/contracts'
import type { GrokRuntime } from './runtime.ts'

export const GROK_WEB_ID = 'grok-build'
export const GROK_WEB_DESCRIPTOR: DshWebManagementDescriptor = {
  id: GROK_WEB_ID, label: 'Grok Build', description: '通过本机 Grok Build 搜索和读取网页。',
  billing: 'model-and-tools', configurationOwner: '@klarkxy/dsh-grok-build',
}
export type GrokWebRegistry = {
  registerSearchProvider(provider: WebSearchProvider & { dshWebManagement: DshWebManagementDescriptor }): () => void
  registerFetchProvider(provider: WebFetchProvider & { dshWebManagement: DshWebManagementDescriptor }): () => void
}
export type GrokWebService = {
  available(): boolean
  runtime(): Pick<GrokRuntime, 'run'>
  run<T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T>
}
export function registerGrokWebProviders(web: GrokWebRegistry, service: GrokWebService): () => void {
  // The seam has no DSH session. The runner owns a fresh isolated native session
  // and never needs MediaExec, workspace attachments or a borrowed tool context.
  const execute = (capability: 'search' | 'fetch', prompt: string, signal?: AbortSignal) => service.run(signal ?? new AbortController().signal, async combined => {
    const result = await service.runtime().run({ capability, prompt, ...(capability === 'fetch' ? { nativeInput: { url: prompt } } : {}), inputs: [], jobId: randomUUID(), jobDirectory: '', workspace: tmpdir() }, combined)
    combined.throwIfAborted()
    if (result.state !== 'completed') throw new Error(result.error?.message ?? 'Grok did not complete the native web operation.')
    return result
  })
  const offSearch = web.registerSearchProvider({
    id: GROK_WEB_ID, dshWebManagement: GROK_WEB_DESCRIPTOR, available: () => service.available(),
    async search(request, signal) {
      if (!request.query.trim()) throw new Error('A search query is required.')
      const limit = request.maxResults
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('Invalid result limit.')
      const result = await execute('search', request.query, signal)
      return { content: result.answer, sources: result.sources.slice(0, limit), truncated: result.truncated === true || (limit !== undefined && result.sources.length > limit) }
    },
  })
  try {
    const offFetch = web.registerFetchProvider({
      id: GROK_WEB_ID, dshWebManagement: GROK_WEB_DESCRIPTOR, available: () => service.available(),
      async fetch(request, signal) {
        const url = new URL(request.url)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('A public HTTP(S) URL without credentials is required.')
        const result = await execute('fetch', request.url, signal)
        if (!result.fetch) throw new Error('Grok returned no native fetched resource.')
        return result.fetch
      },
    })
    return () => { offFetch(); offSearch() }
  } catch (error) { offSearch(); throw error }
}

type Binding = { get(name: string): unknown; emit?(event: typeof WEB_PROVIDER_AVAILABILITY_EVENT, kind: 'search' | 'fetch', id: string): void }
export function bindGrokWeb(ctx: { inject(deps: readonly string[], apply: (inner: Binding) => (() => void) | void): unknown }, service: GrokWebService, subscribe: (notify: () => void) => () => void): void {
  ctx.inject(['web'], inner => {
    const web = inner.get('web') as Partial<GrokWebRegistry> | undefined
    if (typeof web?.registerSearchProvider !== 'function' || typeof web.registerFetchProvider !== 'function') return
    const off = registerGrokWebProviders(web as GrokWebRegistry, service)
    const unlisten = subscribe(() => { inner.emit?.(WEB_PROVIDER_AVAILABILITY_EVENT, 'search', GROK_WEB_ID); inner.emit?.(WEB_PROVIDER_AVAILABILITY_EVENT, 'fetch', GROK_WEB_ID) })
    return () => { unlisten(); off() }
  })
}
