type PluginDomainSpec = {
  version: number
  compatibleVersions?: readonly number[]
  layout?: 'single' | 'per-record'
  tables: Record<string, unknown>
  global?: never
}

type PluginDomainHandle = {
  table(name: string): { entries(): IterableIterator<[unknown, unknown]> }
  close(): Promise<void>
}

/**
 * Open table-only plugin state using the host's lossless legacy bootstrap.
 * The JSON backend ignores compatibleVersions in single layout, and treats
 * unsupported/malformed legacy files as absent in per-record layout. Probe
 * an empty result so persistent settings cannot silently become defaults.
 * A populated per-record tree is authoritative; the retained legacy source
 * is an initial backup, not a current-data rollback after subsequent writes.
 */
export async function openCompatibleDomain<S extends PluginDomainSpec, D extends PluginDomainHandle>(
  open: (spec: S) => Promise<D>, spec: S,
): Promise<D> {
  const perRecord = { ...spec, layout: 'per-record' } as S
  const domain = await open(perRecord)
  let populated = false
  try {
    populated = Object.keys(spec.tables).some(table => !domain.table(table).entries().next().done)
  } finally {
    if (!populated) await domain.close()
  }
  if (populated) return domain

  let mismatch: unknown
  for (const version of new Set([spec.version, ...spec.compatibleVersions ?? []])) {
    try {
      const legacy = await open({ ...spec, layout: 'single', version, compatibleVersions: [] } as S)
      await legacy.close()
      return open(perRecord)
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'version-mismatch') throw error
      mismatch = error
    }
  }
  throw mismatch
}
