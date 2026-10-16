import type { ShortcutFixedCatalogEntry, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { NormalizedBinding, ShortcutBinding, ShortcutCommandId, ShortcutPlatform } from '@deepseek-ai/dsh-client-shortcuts/protocol'

export const FIXED_BINDINGS_KEY = 'klarkxy.shortcuts.fixed-bindings.v1'
export type FixedScope = 'composer' | 'menus' | 'approval' | 'response' | 'global'
export interface EffectiveFixedRow extends Omit<ShortcutFixedCatalogEntry, 'bindings'> {
  readonly original: ShortcutFixedCatalogEntry
  /** Stable action slots; null disables just that slot. */
  readonly bindings: readonly (NormalizedBinding | null)[]
  readonly override: readonly (ShortcutBinding | null)[] | undefined
  readonly modified: boolean
  readonly scope: FixedScope
  readonly conflicts: readonly ShortcutCommandId[]
  readonly bindingKeys: readonly (readonly string[])[]
}
export interface FixedBindingsSnapshot {
  readonly revision: string
  readonly rows: readonly EffectiveFixedRow[]
  readonly error: string | null
}
export interface FixedSaveResult {
  readonly ok: boolean
  readonly message?: string
  readonly status: 'saved' | 'stale' | 'invalid' | 'conflict' | 'storage-error' | 'disposed'
  readonly snapshot: FixedBindingsSnapshot
}
export interface FixedBindingDescription {
  readonly keys: readonly string[]
  readonly issue: string | null
  readonly conflicts: readonly ShortcutCommandId[]
}
export interface FixedBindingsOptions {
  readonly shortcuts: Pick<Shortcuts, 'fixedCatalog' | 'catalog' | 'platform' | 'describeBinding'>
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>
  /** Pass a runtime/platform profile key when one origin hosts both shells. */
  readonly storageKey?: string
  readonly storageEvents?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}
type Overrides = Readonly<Record<string, readonly (ShortcutBinding | null)[]>>
interface Document { schemaVersion: 1; revision: string; overrides: Overrides }
const modifierOrder = ['control', 'alt', 'shift', 'meta'] as const
const namedCodes = new Set(['Slash', 'Comma', 'Period', 'Backslash', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Semicolon', 'Quote', 'Enter', 'Escape', 'Space', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const keyNames: Readonly<Record<string, string>> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Slash: '/', Comma: ',', Period: '.', Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'" }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Mirrors the native physical-code protocol, without importing a feature's runtime. */
export function normalizeFixedBinding(value: ShortcutBinding, platform: ShortcutPlatform): NormalizedBinding {
  if (!record(value) || Object.keys(value).some(key => !['code', 'secondCode', 'modifiers'].includes(key)) || !Array.isArray(value.modifiers)
    || value.modifiers.some(mod => !['primary', ...modifierOrder].includes(mod))) throw new Error('invalid-binding')
  const codes = [value.code, ...(value.secondCode === undefined ? [] : [value.secondCode])].sort()
  if (codes.some(code => typeof code !== 'string' || (!/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(code) && !namedCodes.has(code)))) throw new Error('unsupported-key')
  if (codes.length === 2 && codes[0] === codes[1]) throw new Error('invalid-binding')
  const modifiers = new Set(value.modifiers.map(mod => mod === 'primary' ? platform === 'macos' ? 'meta' : 'control' : mod))
  return Object.freeze({ code: codes[0]!, ...(codes[1] === undefined ? {} : { secondCode: codes[1] }), modifiers: Object.freeze(modifierOrder.filter(mod => modifiers.has(mod))) })
}
export function fixedBindingsOverlap(left: ShortcutBinding, right: ShortcutBinding, platform: ShortcutPlatform): boolean {
  const a = normalizeFixedBinding(left, platform); const b = normalizeFixedBinding(right, platform)
  if (a.modifiers.join() !== b.modifiers.join()) return false
  if (a.secondCode && b.secondCode) return a.code === b.code && a.secondCode === b.secondCode
  return [a.code, a.secondCode].some(code => code !== undefined && (code === b.code || code === b.secondCode))
}

/** Known local owners have disjoint contexts; unknown contributions are conservative/global. */
export function fixedScope(id: string): FixedScope {
  if (id === 'response.stop') return 'response'
  if (/^(approval\.|fixed\.(allow|deny|approval))/.test(id)) return 'approval'
  if (/^fixed\.(move|select|dismiss|menu)/.test(id)) return 'menus'
  if (/^fixed\.(send|newline|history|mention|command|attachment|composer|complementary|slash)/.test(id)) return 'composer'
  return 'global'
}
function scopesOverlap(a: FixedScope, b: FixedScope): boolean {
  if (a === 'global' || b === 'global' || a === b) return true
  return (a === 'response' && b === 'composer') || (a === 'composer' && b === 'response')
}
function keys(binding: NormalizedBinding | null, platform: ShortcutPlatform): readonly string[] {
  if (!binding) return Object.freeze([])
  const names = platform === 'macos' ? { control: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' } : { control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' }
  return Object.freeze([...binding.modifiers.map(mod => names[mod]), ...[binding.code, binding.secondCode].filter((code): code is string => code !== undefined).map(code => keyNames[code] ?? code.replace(/^(Key|Digit)/, ''))])
}
function copyBinding(value: ShortcutBinding, platform: ShortcutPlatform): ShortcutBinding {
  normalizeFixedBinding(value, platform)
  return Object.freeze({ code: value.code, ...(value.secondCode === undefined ? {} : { secondCode: value.secondCode }), modifiers: Object.freeze([...value.modifiers]) })
}
function parse(raw: string | null, platform: ShortcutPlatform): Document {
  if (raw === null) return { schemaVersion: 1, revision: 'default', overrides: Object.freeze({}) }
  const value: unknown = JSON.parse(raw)
  if (!record(value)) throw new Error('Invalid fixed shortcut storage')
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > 1) throw new Error('Unsupported future fixed shortcut storage schema')
  if (value.schemaVersion !== 1 || typeof value.revision !== 'string' || !value.revision || !record(value.overrides)
    || Object.keys(value).some(key => !['schemaVersion', 'revision', 'overrides'].includes(key))) throw new Error('Invalid fixed shortcut storage')
  const overrides: Record<string, readonly (ShortcutBinding | null)[]> = Object.create(null)
  for (const [id, slots] of Object.entries(value.overrides)) {
    if (!id || !Array.isArray(slots) || slots.length === 0 || slots.length > 128) throw new Error('Invalid fixed shortcut storage slots')
    overrides[id] = Object.freeze(slots.map(slot => slot === null ? null : copyBinding(slot as ShortcutBinding, platform)))
  }
  return { schemaVersion: 1, revision: value.revision, overrides: Object.freeze(overrides) }
}

/** Owns accepted preferences only. The caller owns recording and physical dispatch. */
export class FixedBindingsModel {
  private document: Document = { schemaVersion: 1, revision: 'default', overrides: Object.freeze({}) }
  private acceptedRaw: string | null = null
  private snapshot: FixedBindingsSnapshot = Object.freeze({ revision: 'default', rows: Object.freeze([]), error: null })
  private readonly listeners = new Set<() => void>()
  private readonly releases: (() => void)[] = []
  private disposed = false
  private catalogGeneration = 0
  private get storageKey(): string { return this.options.storageKey ?? `${FIXED_BINDINGS_KEY}.${this.options.shortcuts.platform}` }
  readonly state = {
    getSnapshot: (): FixedBindingsSnapshot => this.snapshot,
    subscribe: (listener: () => void): (() => void) => {
      if (this.disposed) return () => {}
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }
  constructor(private readonly options: FixedBindingsOptions) {
    this.reload()
    const catalogChanged = () => { this.catalogGeneration++; this.publish(this.snapshot.error) }
    this.releases.push(options.shortcuts.fixedCatalog.subscribe(catalogChanged), options.shortcuts.catalog.subscribe(catalogChanged))
    const changed = (event: Event) => {
      const storageEvent = event as StorageEvent
      if (storageEvent.key === null || storageEvent.key === this.storageKey) this.reload()
    }
    options.storageEvents?.addEventListener('storage', changed)
    this.releases.push(() => options.storageEvents?.removeEventListener('storage', changed))
  }
  reload(): void {
    if (this.disposed) return
    try {
      if (!this.options.storage) throw new Error('Browser storage is unavailable')
      const raw = this.options.storage.getItem(this.storageKey)
      const next = parse(raw, this.options.shortcuts.platform)
      this.document = next; this.acceptedRaw = raw
      this.publish(null)
    } catch (error) { this.publish(String(error)) }
  }
  describeSlot(id: string, slot: number, binding: ShortcutBinding | null): FixedBindingDescription {
    const row = this.snapshot.rows.find(row => row.id === id)
    if (!row || !Number.isInteger(slot) || slot < 0 || slot >= row.bindings.length) return { keys: [], issue: 'invalid-slot', conflicts: [] }
    try {
      const normalized = binding === null ? null : normalizeFixedBinding(binding, this.options.shortcuts.platform)
      if (normalized === null) return { keys: [], issue: null, conflicts: [] }
      // Each extra modifier keydown resets the native double-press sequence.
      if (id === 'response.stop' && (normalized.modifiers.length > 0 || normalized.secondCode !== undefined)) {
        return { keys: keys(normalized, this.options.shortcuts.platform), issue: 'stop-single-key-required', conflicts: [] }
      }
      const description = this.options.shortcuts.describeBinding(binding)
      // Native application-command policy rejects unmodified/local keys and browser-owned
      // combinations. Local owners legitimately use these; unsupported physical chords do not.
      if (description.issue === 'unsupported-key') return { keys: description.keys, issue: description.issue, conflicts: [] }
      const conflicts = this.conflicts(row, [normalized], this.snapshot.rows)
      for (let index = 0; index < row.bindings.length; index++) {
        const other = row.bindings[index]
        if (index === slot || !other || !fixedBindingsOverlap(normalized, other, this.options.shortcuts.platform)) continue
        const original = row.original.bindings[slot]; const originalOther = row.original.bindings[index]
        if (!original || !originalOther || !fixedBindingsOverlap(original, originalOther, this.options.shortcuts.platform)) conflicts.add(row.id)
      }
      return { keys: keys(normalized, this.options.shortcuts.platform), issue: null, conflicts: Object.freeze([...conflicts]) }
    } catch (error) { return { keys: [], issue: error instanceof Error ? error.message : String(error), conflicts: [] } }
  }
  setSlot(id: string, slot: number, binding: ShortcutBinding | null, expectedRevision: string): FixedSaveResult {
    return this.mutate(expectedRevision, () => {
      const description = this.describeSlot(id, slot, binding)
      if (description.issue) return { status: 'invalid', error: description.issue }
      if (description.conflicts.length) return { status: 'conflict', error: `Shortcut conflict: ${description.conflicts.join(', ')}` }
      const row = this.snapshot.rows.find(row => row.id === id)!
      const slots = [...(row.override ?? row.original.bindings)]
      // A newly mounted catalog may append slots; preserve those new defaults too.
      for (let index = slots.length; index < row.bindings.length; index++) slots.push(row.original.bindings[index]!)
      slots[slot] = binding === null ? null : copyBinding(binding, this.options.shortcuts.platform)
      const overrides = { ...this.document.overrides, [id]: Object.freeze(slots) }
      const isDefault = slots.length === row.original.bindings.length && slots.every((value, index) => value !== null
        && JSON.stringify(normalizeFixedBinding(value, this.options.shortcuts.platform)) === JSON.stringify(row.original.bindings[index]))
      if (isDefault) delete overrides[id]
      return { overrides }
    })
  }
  clear(id: string, expectedRevision: string): FixedSaveResult {
    return this.mutate(expectedRevision, () => {
      const row = this.snapshot.rows.find(row => row.id === id)
      if (!row) return { status: 'invalid', error: 'Unknown fixed action' }
      return { overrides: { ...this.document.overrides, [id]: Object.freeze(row.bindings.map(() => null)) } }
    })
  }
  resetSlot(id: string, slot: number, expectedRevision: string): FixedSaveResult {
    const row = this.snapshot.rows.find(row => row.id === id)
    if (!row || !Number.isInteger(slot) || slot < 0 || slot >= row.original.bindings.length) return this.fail('invalid', 'invalid-slot')
    return this.setSlot(id, slot, row.original.bindings[slot]!, expectedRevision)
  }
  reset(id: string, expectedRevision: string): FixedSaveResult {
    return this.mutate(expectedRevision, () => {
      const overrides = { ...this.document.overrides }; delete overrides[id]
      return { overrides }
    })
  }
  resetAll(expectedRevision: string): FixedSaveResult {
    return this.mutate(expectedRevision, () => ({ overrides: {} }))
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const release of this.releases) release()
    this.listeners.clear()
  }
  private mutate(expectedRevision: string, change: () => { overrides: Overrides } | { status: 'invalid' | 'conflict'; error: string }): FixedSaveResult {
    if (this.disposed) return this.fail('disposed', 'Fixed shortcuts have been disposed')
    if (expectedRevision !== this.snapshot.revision) return this.fail('stale', 'Fixed shortcuts changed; review the latest bindings')
    try {
      if (!this.options.storage) throw new Error('Browser storage is unavailable')
      const raw = this.options.storage.getItem(this.storageKey)
      // Parse before comparing: malformed/future documents must never be overwritten.
      const current = parse(raw, this.options.shortcuts.platform)
      if (raw !== this.acceptedRaw || current.revision !== this.document.revision) {
        this.document = current; this.acceptedRaw = raw
        return this.fail('stale', 'Fixed shortcuts changed in another tab; review the latest bindings')
      }
      const next = change()
      if ('status' in next) return this.fail(next.status, next.error)
      const document: Document = { schemaVersion: 1, revision: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, overrides: Object.freeze(next.overrides) }
      const serialized = JSON.stringify(document)
      // localStorage has no atomic cross-tab compare-and-swap. This synchronous
      // read/check/write catches stale drafts; storage events converge other tabs.
      try { this.options.storage.setItem(this.storageKey, serialized) }
      catch (error) {
        // A rejected write leaves the accepted state usable for another attempt.
        this.publish(null)
        return { ok: false, status: 'storage-error', message: String(error), snapshot: this.snapshot }
      }
      this.document = document; this.acceptedRaw = serialized
      this.publish(null)
      return { ok: true, status: 'saved', snapshot: this.snapshot }
    } catch (error) { return this.fail('storage-error', String(error)) }
  }
  private fail(status: Exclude<FixedSaveResult['status'], 'saved'>, error: string): FixedSaveResult {
    this.publish(status === 'storage-error' || status === 'disposed' ? error : null)
    return { ok: false, status, message: error, snapshot: this.snapshot }
  }
  private conflicts(row: Pick<EffectiveFixedRow, 'id' | 'scope'>, bindings: readonly (NormalizedBinding | null)[], rows: readonly EffectiveFixedRow[]): Set<ShortcutCommandId> {
    const result = new Set<ShortcutCommandId>()
    const overlap = (other: ShortcutBinding) => bindings.some(binding => binding && fixedBindingsOverlap(binding, other, this.options.shortcuts.platform))
    for (const other of this.options.shortcuts.catalog.getSnapshot()) {
      if (other.binding && !other.issue && overlap(other.binding)) result.add(other.id)
    }
    for (const other of rows) {
      if (other.id !== row.id && scopesOverlap(row.scope, other.scope) && other.bindings.some(binding => binding && overlap(binding))) result.add(other.id)
    }
    return result
  }
  private publish(error: string | null): void {
    const rows: EffectiveFixedRow[] = this.options.shortcuts.fixedCatalog.getSnapshot().map(original => {
      const override = Object.hasOwn(this.document.overrides, original.id) ? this.document.overrides[original.id] : undefined
      const bindings = Object.freeze(original.bindings.map((binding, index) => {
        const value = override && index < override.length ? override[index]! : binding
        return value === null ? null : normalizeFixedBinding(value, this.options.shortcuts.platform)
      }))
      return { ...original, original, bindings, override, modified: override !== undefined, scope: fixedScope(original.id), conflicts: [], bindingKeys: Object.freeze(bindings.map(binding => keys(binding, this.options.shortcuts.platform))) }
    })
    const effective = rows.map(row => Object.freeze({ ...row, conflicts: Object.freeze([...this.conflicts(row, row.bindings, rows)]) }))
    this.snapshot = Object.freeze({ revision: `${this.document.revision}:${this.catalogGeneration}`, rows: Object.freeze(effective), error })
    for (const listener of [...this.listeners]) listener()
  }
}
