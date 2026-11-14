import type { PluginLogger } from './log-shared.ts'

type PluginDomainSpec = {
  name?: string
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
 * The JSON backend treats unsupported/malformed legacy files as absent in
 * per-record layout; the probe below opens `single` with compatibleVersions
 * emptied so a legacy stamp reports `version-mismatch` (whether or not the
 * installed backend accepts compatible stamps in single layout, which
 * storage-json began doing at 0.2.2). Probe an empty result so persistent
 * settings cannot silently become defaults.
 * A populated per-record tree is authoritative; the retained legacy source
 * is an initial backup, not a current-data rollback after subsequent writes.
 */
export async function openCompatibleDomain<S extends PluginDomainSpec, D extends PluginDomainHandle>(
  open: (spec: S) => Promise<D>, spec: S,
  options?: { logger?: PluginLogger; domainName?: string },
): Promise<D> {
  const log = options?.logger
  const domainName = options?.domainName ?? (typeof spec.name === 'string' ? spec.name : 'plugin-domain')
  const perRecord = { ...spec, layout: 'per-record' } as S
  const domain = await open(perRecord)
  let populated = false
  try {
    populated = Object.keys(spec.tables).some(table => !domain.table(table).entries().next().done)
  } finally {
    if (!populated) await domain.close()
  }
  if (populated) {
    log?.debug('domain.opened', 'Opened populated per-record storage domain.', { domain: domainName, version: spec.version })
    return domain
  }

  let mismatch: unknown
  for (const version of new Set([spec.version, ...spec.compatibleVersions ?? []])) {
    try {
      const legacy = await open({ ...spec, layout: 'single', version, compatibleVersions: [] } as S)
      await legacy.close()
      log?.info('domain.probed', 'Opened storage domain after legacy probe.', {
        domain: domainName, probedVersion: version, targetVersion: spec.version,
      })
      return open(perRecord)
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'version-mismatch') {
        log?.error('domain.open-failed', 'Storage domain open failed during legacy probe.', error, {
          domain: domainName, probedVersion: version,
        })
        throw error
      }
      mismatch = error
    }
  }
  log?.error('domain.version-mismatch', 'Storage domain version is incompatible.', mismatch, {
    domain: domainName, targetVersion: spec.version,
  })
  throw mismatch
}
