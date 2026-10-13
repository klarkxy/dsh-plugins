import type { ModelRoute } from '@klarkxy/dsh-model-route'

/** Built-in display copy; plain strings preserve third-party and user-provided text. */
export type ModelSettingsText = string | { zh: string; en: string }

/** Plugin-owned model settings, independent of native volatile Config forms. */
export interface ModelSettingsField {
  path: string[]
  label: ModelSettingsText
  description?: ModelSettingsText
  current?: ModelRoute
  editable?: false
  allowFollow?: boolean
  followLabel?: ModelSettingsText
}
export interface ModelSettingsSnapshot {
  revision: number
  fields: ModelSettingsField[]
  /** A separate model domain, e.g. external Codex; never use the DSH catalog here. */
  catalog?: unknown
  catalogError?: ModelSettingsText
}
export interface ModelSettingsProvider {
  ns: string
  title: ModelSettingsText
  instanceId?: string
  read(signal: AbortSignal): ModelSettingsSnapshot | Promise<ModelSettingsSnapshot>
  write(path: readonly string[], route: ModelRoute, expectedRevision: number, signal: AbortSignal): Promise<unknown>
}

export const MODEL_SETTINGS_EVENT = 'model-settings/collect'
export const MODEL_SETTINGS_CHANGED_EVENT = 'model-settings/changed'
export interface ModelSettingsChange { ns: string; revision: number }

/** Publish only after the owner's save commits. A failed observer must never
 * turn an already committed write into an apparent save failure. */
export function notifyModelSettingsChanged(ctx: {
  parallel(name: typeof MODEL_SETTINGS_CHANGED_EVENT, change: ModelSettingsChange): Promise<void>
}, ns: string, revision: number): void {
  try {
    // Cordis emit returns void and cannot contain an async observer rejection.
    void ctx.parallel(MODEL_SETTINGS_CHANGED_EVENT, { ns, revision }).catch(() => {})
  } catch { /* The save has already committed. */ }
}
type Collector = (provider: ModelSettingsProvider) => void
export interface ModelSettingsEvents {
  on(name: typeof MODEL_SETTINGS_EVENT, callback: (collect: Collector) => void): () => void
}
export interface ModelSettingsDiscovery {
  parallel(name: typeof MODEL_SETTINGS_EVENT, collect: Collector): Promise<void>
}

/** Cordis disposes the listener with its fiber. In-flight references also fail closed. */
export function registerModelSettings(ctx: ModelSettingsEvents, provider: ModelSettingsProvider): () => void {
  let active = true
  const requireActive = (signal: AbortSignal) => {
    signal.throwIfAborted()
    if (!active) throw new Error('Model settings owner unloaded; refresh and retry')
  }
  const guarded: ModelSettingsProvider = {
    ns: provider.ns, title: provider.title, instanceId: globalThis.crypto.randomUUID(),
    async read(signal) {
      requireActive(signal)
      const value = await provider.read(signal)
      requireActive(signal)
      return value
    },
    async write(path, route, revision, signal) {
      requireActive(signal)
      return provider.write(path, route, revision, signal)
    },
  }
  const off = ctx.on(MODEL_SETTINGS_EVENT, collect => { if (active) collect(guarded) })
  // Call this disposer from ctx.effect as well: listener removal alone does not
  // revoke a reference captured just before the owning plugin was unloaded.
  return () => { active = false; off() }
}

export async function collectModelSettings(ctx: ModelSettingsDiscovery): Promise<ModelSettingsProvider[]> {
  const providers: ModelSettingsProvider[] = []
  const duplicates: string[] = []
  await ctx.parallel(MODEL_SETTINGS_EVENT, provider => {
    if (!provider.ns || providers.some(item => item.ns === provider.ns)) { duplicates.push(provider.ns); return }
    providers.push(provider)
  })
  if (duplicates.length) throw new Error(`Duplicate model settings owner: ${duplicates.join(', ')}`)
  return providers.sort((a, b) => a.ns.localeCompare(b.ns))
}
