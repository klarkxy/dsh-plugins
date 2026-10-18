import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelSettingsChangesIdentity } from './contracts.ts'
import { MODEL_SETTINGS_CHANGED_EVENT, type ModelSettingsChange } from './model-settings.ts'
import { parseModelSettingsChangeFrame, type ModelSettingsChangeFrame } from './model-settings-client.ts'

interface ChangeEvents {
  on(name: typeof MODEL_SETTINGS_CHANGED_EVENT, callback: (change: ModelSettingsChange) => void): () => void
  on(name: 'settings/document-updated', callback: (ns: string, revision: number) => void): () => void
}

/** Attach first, then yield ready: commits during a consumer's baseline read
 * remain queued. Coalescing revisions never invents a settings snapshot.
 * `ownerNs` keeps one plugin's stream to its own settings; omit it to forward every namespace. */
export async function* watchModelSettingsChanges(events: ChangeEvents, signal: AbortSignal, ownerNs?: string): AsyncGenerator<ModelSettingsChangeFrame> {
  signal.throwIfAborted()
  const pending = new Map<string, ModelSettingsChangeFrame>()
  let full = false
  let wake: (() => void) | undefined
  const changed = (ns: string, revision: number) => {
    if (ownerNs !== undefined && ns !== ownerNs) return
    let frame: ModelSettingsChangeFrame
    try { frame = parseModelSettingsChangeFrame({ kind: 'changed', ns, revision }) } catch { return }
    if (!full) {
      if (!pending.has(ns) && pending.size >= 256) { pending.clear(); full = true }
      else pending.set(ns, frame)
    }
    wake?.()
  }
  const disposers: (() => void)[] = []
  const cleanup = () => {
    for (const off of disposers.splice(0).reverse()) off()
    pending.clear()
  }
  // Release listeners even if the consumer is paused at a yielded frame.
  const aborted = () => { cleanup(); wake?.() }
  signal.addEventListener('abort', aborted, { once: true })
  try {
    disposers.push(events.on(MODEL_SETTINGS_CHANGED_EVENT, ({ ns, revision }) => changed(ns, revision)))
    disposers.push(events.on('settings/document-updated', changed))
    signal.throwIfAborted()
    yield { kind: 'ready' }
    while (true) {
      signal.throwIfAborted()
      if (full) { full = false; yield { kind: 'ready' }; continue }
      if (pending.size) {
        const [ns, frame] = pending.entries().next().value!
        pending.delete(ns)
        yield frame
        continue
      }
      await new Promise<void>(resolve => {
        wake = resolve
        if (signal.aborted || full || pending.size) resolve()
      })
      wake = undefined
    }
  } finally {
    signal.removeEventListener('abort', aborted)
    cleanup()
  }
}

/** One owner's invalidation stream, registered on the calling plugin fiber.
 * Nothing here is stored in a module-level singleton. */
export class ModelSettingsChangesController extends TypertRemoteService {
  private readonly lifetime = new AbortController()
  private readonly ownerNs: string | undefined
  constructor(ctx: Context, identity: ModelSettingsChangesIdentity, ownerNs?: string) {
    super(ctx, identity.service, { namespace: identity.namespace })
    this.ownerNs = ownerNs
    ctx.effect(() => () => { this.lifetime.abort(new Error('Model settings sync owner unloaded')) })
  }

  @Remote({ mode: 'stream' })
  watch(signal: AbortSignal): AsyncIterable<ModelSettingsChangeFrame> {
    return watchModelSettingsChanges(this.ctx as unknown as ChangeEvents, AbortSignal.any([this.lifetime.signal, signal]), this.ownerNs)
  }
}

/** Register this owner's controller. `ownerNs` limits the stream to that settings namespace. */
export function createModelSettingsChanges(ctx: Context, identity: ModelSettingsChangesIdentity, ownerNs?: string): ModelSettingsChangesController {
  return new ModelSettingsChangesController(ctx, identity, ownerNs)
}
