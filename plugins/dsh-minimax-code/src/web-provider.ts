import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import { WEB_PROVIDER_AVAILABILITY_EVENT, type DshWebManagementDescriptor } from '@klarkxy/dsh-plugin-kit/contracts'
import type { Settings } from './contracts.ts'
import { miniMaxSearch } from './search.ts'

export const MINIMAX_WEB_ID = 'minimax-code'
export const MINIMAX_WEB_DESCRIPTOR: DshWebManagementDescriptor = {
  id: MINIMAX_WEB_ID, label: 'MiniMax Code', description: '通过本机 MiniMax Code 搜索公开网页。',
  billing: 'model-and-tools', configurationOwner: '@klarkxy/dsh-minimax-code',
}
export type MiniMaxWebRegistry = { registerSearchProvider(provider: WebSearchProvider & { dshWebManagement: DshWebManagementDescriptor }): () => void }
export type MiniMaxWebService = {
  available(): boolean
  settings(): Settings
  run<T>(signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T>
  search?: typeof miniMaxSearch
}
export function registerMiniMaxWebProvider(web: MiniMaxWebRegistry, service: MiniMaxWebService): () => void {
  return web.registerSearchProvider({
    id: MINIMAX_WEB_ID, dshWebManagement: MINIMAX_WEB_DESCRIPTOR, available: () => service.available(),
    search(request, signal) {
      const limit = request.maxResults ?? 5
      if (!request.query.trim() || !Number.isInteger(limit) || limit < 1) return Promise.reject(new Error('Invalid search request.'))
      // This adapter owns its isolated CLI directory. No DSH session is available
      // on the web seam, so do not construct a fake MediaExec or borrow a session.
      return service.run(signal ?? new AbortController().signal, async combined => {
        const result = await (service.search ?? miniMaxSearch).run({ query: request.query, count: Math.min(limit, 10) }, undefined, service.settings(), combined)
        combined.throwIfAborted()
        return { sources: result.data.sources, truncated: result.data.truncated === true }
      })
    },
  })
}
type Binding = { get(name: string): unknown; emit?(event: typeof WEB_PROVIDER_AVAILABILITY_EVENT, kind: 'search', id: string): void }
export function bindMiniMaxWeb(ctx: { inject(deps: readonly string[], apply: (inner: Binding) => (() => void) | void): unknown }, service: MiniMaxWebService, subscribe: (notify: () => void) => () => void): void {
  ctx.inject(['web'], inner => {
    const web = inner.get('web') as Partial<MiniMaxWebRegistry> | undefined
    if (typeof web?.registerSearchProvider !== 'function') return
    const off = registerMiniMaxWebProvider(web as MiniMaxWebRegistry, service)
    const unlisten = subscribe(() => inner.emit?.(WEB_PROVIDER_AVAILABILITY_EVENT, 'search', MINIMAX_WEB_ID))
    return () => { unlisten(); off() }
  })
}
