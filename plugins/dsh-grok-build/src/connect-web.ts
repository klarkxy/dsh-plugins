import { discoverGrok } from './process.ts'
import { bindGrokWeb, type GrokWebService } from './web-provider.ts'
import type { Settings } from './contracts.ts'

export function connectGrokWeb(ctx: Parameters<typeof bindGrokWeb>[0], service: Omit<GrokWebService, 'available'>, settings: () => Settings, ready: Promise<unknown>, lifetime: AbortSignal) {
  let available = false, generation = 0
  const listeners = new Set<() => void>()
  const refresh = async () => {
    const current = ++generation
    let next = false
    try { await ready; if (!lifetime.aborted) { await discoverGrok(settings().executable); next = true } } catch { /* local CLI unavailable */ }
    if (lifetime.aborted || current !== generation || available === next) return
    available = next; for (const notify of listeners) notify()
  }
  bindGrokWeb(ctx, { ...service, available: () => available && !lifetime.aborted }, notify => { listeners.add(notify); return () => { listeners.delete(notify) } })
  void refresh()
  return refresh
}
