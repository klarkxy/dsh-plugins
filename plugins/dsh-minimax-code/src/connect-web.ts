import { discoverCli } from './cli.ts'
import { bindMiniMaxWeb, type MiniMaxWebService } from './web-provider.ts'

export function connectMiniMaxWeb(ctx: Parameters<typeof bindMiniMaxWeb>[0], service: Omit<MiniMaxWebService, 'available'>, ready: Promise<unknown>, lifetime: AbortSignal) {
  let available = false, generation = 0
  const listeners = new Set<() => void>()
  const refresh = async () => {
    const current = ++generation
    let next = false
    try { await ready; if (!lifetime.aborted) { await discoverCli(service.settings(), 'code'); next = true } } catch { /* local CLI unavailable */ }
    if (lifetime.aborted || current !== generation || available === next) return
    available = next; for (const notify of listeners) notify()
  }
  bindMiniMaxWeb(ctx, { ...service, available: () => available && !lifetime.aborted }, notify => { listeners.add(notify); return () => { listeners.delete(notify) } })
  void refresh()
  return refresh
}
