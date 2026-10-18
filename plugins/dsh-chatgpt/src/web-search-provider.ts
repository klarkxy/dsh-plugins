import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import { WEB_PROVIDER_AVAILABILITY_EVENT, type DshWebManagementDescriptor } from '@klarkxy/dsh-plugin-kit/contracts'
import { ChatGptError, PLUGIN_NAME, type Request, type Result } from './contracts.ts'
import { discoverExecutable } from './process.ts'

export const CHATGPT_WEB_SEARCH_ID = 'chatgpt'
export const CHATGPT_WEB_SEARCH_DESCRIPTOR: DshWebManagementDescriptor = {
  id: CHATGPT_WEB_SEARCH_ID,
  label: 'ChatGPT (Codex)',
  description: 'Search public web sources through local Codex using your ChatGPT account.',
  billing: 'model-and-tools',
  configurationOwner: PLUGIN_NAME,
}
export type ChatGptWebSearchHost = {
  run(request: Request, workspace: string, signal: AbortSignal): Promise<Result>
  available(): boolean
}
export function createChatGptWebSearchProvider(host: ChatGptWebSearchHost): WebSearchProvider & { dshWebManagement: DshWebManagementDescriptor } {
  return {
    id: CHATGPT_WEB_SEARCH_ID, dshWebManagement: CHATGPT_WEB_SEARCH_DESCRIPTOR,
    available: () => host.available(),
    async search(request, signal = new AbortController().signal) {
      signal.throwIfAborted()
      if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 100_000) throw new ChatGptError('bad-request', '搜索内容不能为空或超过 100,000 字符。')
      if (request.maxResults !== undefined && (!Number.isSafeInteger(request.maxResults) || request.maxResults < 1)) throw new ChatGptError('bad-request', '搜索结果数量必须是正整数。')
      const workspace = await mkdtemp(join(tmpdir(), 'dsh-chatgpt-search-'))
      try {
        signal.throwIfAborted()
        // Search has no session, attachments or publication. The shared runner still
        // enforces ephemeral threads, read-only sandbox and native web-only tools.
        const result = await host.run({ mode: 'search', prompt: request.query }, workspace, signal)
        signal.throwIfAborted()
        const sources = request.maxResults === undefined ? result.sources : result.sources.slice(0, request.maxResults)
        return { content: result.answer, sources, truncated: sources.length < result.sources.length }
      } finally { await rm(workspace, { recursive: true, force: true }) }
    },
  }
}
type WebRegistry = { registerSearchProvider(provider: ReturnType<typeof createChatGptWebSearchProvider>): () => void }
export function registerChatGptGlobalSearchProvider(web: WebRegistry, host: ChatGptWebSearchHost): () => void {
  return web.registerSearchProvider(createChatGptWebSearchProvider(host))
}
type BindingContext = {
  get(name: string): unknown
  emit?(event: typeof WEB_PROVIDER_AVAILABILITY_EVENT, kind: 'search', id: string): void
}
/** Optional service binding: standalone tools keep working without ctx.web. */
export function bindChatGptWebSearch(
  ctx: { inject(deps: readonly string[], apply: (inner: BindingContext) => (() => void) | void): unknown },
  options: Omit<ChatGptWebSearchHost, 'available'> & { executable(): Promise<string> },
  discover = discoverExecutable,
): () => Promise<void> {
  let refresh = async () => {}
  ctx.inject(['web'], inner => {
    const web = inner.get('web') as Partial<WebRegistry> | undefined
    if (typeof web?.registerSearchProvider !== 'function') return
    let installed = false, alive = true, revision = 0
    refresh = async () => {
      const current = ++revision
      let next = false
      try { await discover(await options.executable()); next = true } catch { /* local installation unavailable */ }
      if (!alive || current !== revision) return
      if (installed !== next) {
        installed = next
        inner.emit?.(WEB_PROVIDER_AVAILABILITY_EVENT, 'search', CHATGPT_WEB_SEARCH_ID)
      }
    }
    const off = registerChatGptGlobalSearchProvider(web as WebRegistry, { run: options.run, available: () => alive && installed })
    void refresh()
    return () => { alive = false; revision++; installed = false; off() }
  })
  return () => refresh()
}
