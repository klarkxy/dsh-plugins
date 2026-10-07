/**
 * Pure probe-report builder for the model hub. Takes the host's
 * `settings.describe()` output and reports every detected model-route field,
 * plus whether this plugin's own self-test markers survived projection.
 */
import { detectModelFields, modelRouteOverride, normalizeModelRoute, type ModelRoute } from '@klarkxy/dsh-model-route'

/** Structural subset of the host SettingsDescriptor the probe needs. */
export interface ProbeDescriptorLike {
  ns: string
  schema: unknown
  value: unknown
  revision?: number
}

export interface ProbeField {
  path: string[]
  via: 'marker' | 'shape'
  marker?: Record<string, unknown>
  current?: ModelRoute
  editable?: false
  arrayItem?: true
}

export interface ProbeEntry {
  ns: string
  fields: ProbeField[]
}

export type SelfTestChannel = 'marker' | 'shape' | 'absent'

export interface ProbeReport {
  generatedAt: string
  totalNamespaces: number
  namespacesWithModelFields: number
  entries: ProbeEntry[]
  selfTest: {
    /** How the custom-key marked field was detected (or not). */
    extraKey: SelfTestChannel
    /** How the renderer-role marked field was detected (or not). */
    role: SelfTestChannel
    /** Raw projection of the hub's own namespace, for key inspection. */
    ownSchema: unknown
  }
}

export const SELF_TEST_EXTRA_KEY_PATH = 'selfTestMeta'
export const SELF_TEST_ROLE_PATH = 'selfTestRole'

function channelOf(fields: ProbeField[], firstSegment: string): SelfTestChannel {
  const hit = fields.find(field => field.path[0] === firstSegment)
  return hit ? hit.via : 'absent'
}

export function buildProbeReport(descriptors: readonly ProbeDescriptorLike[], now = new Date()): ProbeReport {
  const entries: ProbeEntry[] = listModelFields(descriptors).map(({ ns, fields }) => ({ ns, fields }))
  let ownSchema: unknown
  for (const descriptor of descriptors) {
    if (descriptor.ns.includes('model-hub')) ownSchema = descriptor.schema
  }
  const own = entries.find(entry => entry.ns.includes('model-hub'))
  return {
    generatedAt: now.toISOString(),
    totalNamespaces: descriptors.length,
    namespacesWithModelFields: entries.length,
    entries,
    selfTest: {
      extraKey: own ? channelOf(own.fields, SELF_TEST_EXTRA_KEY_PATH) : 'absent',
      role: own ? channelOf(own.fields, SELF_TEST_ROLE_PATH) : 'absent',
      ownSchema,
    },
  }
}

/** One namespace's detected fields plus the CAS revision a write must carry. */
export interface HubEntry {
  ns: string
  revision: number
  fields: ProbeField[]
}

/** The field matrix the hub page edits: every detected model-route field. */
export function listModelFields(descriptors: readonly ProbeDescriptorLike[]): HubEntry[] {
  const entries: HubEntry[] = []
  for (const descriptor of descriptors) {
    const fields = detectModelFields(descriptor.schema, { value: descriptor.value })
    if (!fields.length) continue
    entries.push({
      ns: descriptor.ns,
      revision: typeof descriptor.revision === 'number' ? descriptor.revision : 0,
      fields: fields.map(field => ({
        path: [...field.path],
        via: field.via,
        ...(field.marker ? { marker: field.marker as Record<string, unknown> } : {}),
        ...(field.current ? { current: field.current } : {}),
        ...(field.editable === false ? { editable: false as const } : {}),
        ...(field.arrayItem ? { arrayItem: true as const } : {}),
      })),
    })
  }
  return entries
}

/** One validated write against a detected field: path ops plus the CAS revision. */
export interface FieldWritePlan {
  ns: string
  ops: ReadonlyArray<{ op: 'set'; path: readonly string[]; value: ModelRoute } | { op: 'unset'; path: readonly string[] }>
  expectedRevision?: number
}

/**
 * Validate a hub-page write against a fresh detection pass: the target must be
 * a currently detected model-route field, so the page can never write a
 * non-model key. An empty route unsets the field back to its schema default
 * ("follow the host default"); a concrete route is set normalized.
 */
export function planFieldWrite(entries: readonly HubEntry[], payload: unknown): FieldWritePlan {
  const row = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined
  const ns = typeof row?.ns === 'string' ? row.ns : ''
  const path = Array.isArray(row?.path) && row.path.length > 0 && row.path.every(s => typeof s === 'string' && s) ? row.path as string[] : undefined
  if (!ns || !path) throw new Error('Invalid field reference')
  const entry = entries.find(item => item.ns === ns)
  const field = entry?.fields.find(item => item.path.length === path.length && item.path.every((segment, index) => segment === path[index]))
  if (!entry || !field) throw new Error('Not a detected model field')
  if (field.editable === false) throw new Error('No collection item to edit')
  const override = modelRouteOverride(normalizeModelRoute(row?.route))
  if (row?.expectedRevision !== undefined && (!Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 0)) throw new Error('Invalid revision')
  const expectedRevision = typeof row?.expectedRevision === 'number' ? row.expectedRevision : entry.revision
  // Native unset on an array index splices the element. Follow mode preserves it.
  return { ns, expectedRevision, ops: override || field.arrayItem
    ? [{ op: 'set', path, value: override ?? { provider: '', model: '' } }]
    : [{ op: 'unset', path }] }
}
