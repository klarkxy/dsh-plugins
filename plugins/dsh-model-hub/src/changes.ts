import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { MODEL_SETTINGS_CHANGES_REMOTE } from '@klarkxy/dsh-plugin-kit/contracts'
import { MODEL_SETTINGS_CHANGED_EVENT, type ModelSettingsChange } from '@klarkxy/dsh-plugin-kit/model-settings'
import { parseModelSettingsChangeFrame, type ModelSettingsChangeFrame } from '@klarkxy/dsh-plugin-kit/model-settings-client'

declare module '@deepseek-ai/cordis' {
  interface Context { modelSettingsChangesController: ModelSettingsChangesController }
}

interface ChangeEvents {
  on(name: typeof MODEL_SETTINGS_CHANGED_EVENT, callback: (change: ModelSettingsChange) => void): () => void
  on(name: 'settings/document-updated', callback: (ns: string, revision: number) => void): () => void
}

/** Attach first, then yield ready: commits during a consumer's baseline read
 * remain queued. Coalescing revisions never invents a settings snapshot. */
export async function* watchModelSettingsChanges(events: ChangeEvents, signal: AbortSignal): AsyncGenerator<ModelSettingsChangeFrame> {
  signal.throwIfAborted()
  const pending = new Map<string, ModelSettingsChangeFrame>()
  let full = false
  let wake: (() => void) | undefined
  const changed = (ns: string, revision: number) => {
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

export class ModelSettingsChangesController extends TypertRemoteService {
  private readonly lifetime = new AbortController()
  constructor(ctx: Context) {
    super(ctx, MODEL_SETTINGS_CHANGES_REMOTE.descriptors[0].service, { namespace: MODEL_SETTINGS_CHANGES_REMOTE.descriptors[0].namespace })
    ctx.effect(() => () => { this.lifetime.abort(new Error('Model settings sync owner unloaded')) })
  }

  @Remote({ mode: 'stream' })
  watch(signal: AbortSignal): AsyncIterable<ModelSettingsChangeFrame> {
    return watchModelSettingsChanges(this.ctx as unknown as ChangeEvents, AbortSignal.any([this.lifetime.signal, signal]))
  }
}
