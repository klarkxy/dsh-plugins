import { collectModelSettings, type ModelSettingsDiscovery, type ModelSettingsProvider } from '@klarkxy/dsh-plugin-kit/model-settings'
import { normalizeModelRoute } from '@klarkxy/dsh-model-route'
import { listModelFields, planFieldWrite, type HubEntry, type ProbeDescriptorLike } from './probe.ts'

interface NativeSettings {
  describe(options: { redactSecrets: true }): ProbeDescriptorLike[]
  mutate(ns: string, ops: ReturnType<typeof planFieldWrite>['ops'], revision: number): Promise<void>
}
/** A commit acknowledgement contains no fallible post-save aggregate read. */
export interface FieldCommit { committed: true; ns: string }

/** Owner contributions supersede the same native namespace, never its storage. */
export function createHubSettings(events: ModelSettingsDiscovery, settings: NativeSettings, ownNamespace = '@klarkxy/dsh-model-hub') {
  const readOwner = async (owner: ModelSettingsProvider, signal: AbortSignal): Promise<HubEntry> => {
    try {
      const snapshot = await owner.read(signal)
      if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new Error('Invalid owner revision')
      return {
        ns: owner.ns, title: owner.title, source: 'owner', ownerId: owner.instanceId, revision: snapshot.revision,
        fields: snapshot.fields.map(field => ({ ...field, path: [...field.path], via: 'contribution' as const })),
        ...(snapshot.catalog !== undefined ? { catalog: snapshot.catalog } : {}),
        ...(snapshot.catalogError ? { catalogError: snapshot.catalogError } : {}),
      }
    } catch (error) {
      signal.throwIfAborted()
      return { ns: owner.ns, title: owner.title, source: 'owner', ownerId: owner.instanceId, revision: 0, fields: [],
        error: error instanceof Error ? error.message : String(error) }
    }
  }
  const list = async (signal: AbortSignal): Promise<HubEntry[]> => {
    signal.throwIfAborted()
    const owners = await collectModelSettings(events)
    const namespaces = new Set(owners.map(owner => owner.ns))
    const native = listModelFields(settings.describe({ redactSecrets: true })).filter(entry => !namespaces.has(entry.ns))
      .map(entry => ({ ...entry, fields: entry.fields.filter(field => !(
        entry.ns === ownNamespace && ['selfTestMeta', 'selfTestRole'].includes(field.path[0] ?? '')
      )) })).filter(entry => entry.fields.length > 0)
    const entries = await Promise.all(owners.map(owner => readOwner(owner, signal)))
    signal.throwIfAborted()
    return [...native, ...entries].sort((a, b) => a.ns.localeCompare(b.ns))
  }
  const set = async (payload: unknown, signal: AbortSignal): Promise<FieldCommit> => {
    signal.throwIfAborted()
    const row = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined
    if (!row || typeof row.ns !== 'string' || !Array.isArray(row.path) || !row.path.every(segment => typeof segment === 'string' && segment)) throw new Error('Invalid field reference')
    if (!Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 0) throw new Error('A valid expected revision is required; refresh and retry')
    const input = row.route && typeof row.route === 'object' && !Array.isArray(row.route) ? row.route as Record<string, unknown> : undefined
    if (!input || ['provider', 'model', 'reasoningEffort'].some(key => input[key] !== undefined && typeof input[key] !== 'string')) throw new Error('Invalid model route')
    const normalized = normalizeModelRoute(input)
    if ((Boolean(String(input.provider ?? '').trim()) || Boolean(String(input.model ?? '').trim())) && (!normalized.provider || !normalized.model)) throw new Error('Invalid model route')
    // Fresh collection rejects unloaded owners; callback guards reject references
    // that unload after collection. Never fall back from an owner to native writes.
    const owners = await collectModelSettings(events)
    const owner = owners.find(item => item.ns === row.ns)
    if (owner) {
      if (row.ownerId !== owner.instanceId) throw new Error('Model settings owner changed; refresh and retry')
      const entry = await readOwner(owner, signal)
      if (entry.error) throw new Error(typeof entry.error === 'string' ? entry.error : entry.error.en)
      if (entry.revision !== row.expectedRevision) throw new Error('Settings changed; refresh and retry')
      const field = entry.fields.find(field => JSON.stringify(field.path) === JSON.stringify(row.path))
      if (!field || field.editable === false) throw new Error('Not an editable model field')
      const route = normalized
      if (field.allowFollow === false && (!route.provider || !route.model)) throw new Error('This model setting requires a concrete model')
      await owner.write(field.path, route, row.expectedRevision as number, signal)
    } else {
      if (row.ownerId !== undefined) throw new Error('Model settings owner unloaded; refresh and retry')
      if (row.ns === ownNamespace) throw new Error('Self-test fields are diagnostic only')
      const plan = planFieldWrite(listModelFields(settings.describe({ redactSecrets: true })), payload)
      await settings.mutate(plan.ns, plan.ops, plan.expectedRevision)
    }
    return { committed: true, ns: row.ns }
  }
  return { list, set }
}
