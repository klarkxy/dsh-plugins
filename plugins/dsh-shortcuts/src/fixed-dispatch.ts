import type { NormalizedBinding } from '@deepseek-ai/dsh-client-shortcuts/protocol'

/** Structural subset of the fixed store row; the catalog remains the whitelist. */
export interface FixedDispatchMapping {
  readonly id: string
  readonly group: 'application' | 'input' | 'menus' | 'approval'
  readonly original: { readonly bindings: readonly NormalizedBinding[] }
  readonly bindings: readonly (NormalizedBinding | null)[]
  readonly modified: boolean
  readonly conflicts?: readonly string[]
}
export interface FixedDispatcherOptions {
  readonly window: Window
  readonly getMappings: () => readonly FixedDispatchMapping[]
  readonly isRecording?: () => boolean
  readonly onError?: (error: Error) => void
}
const editable = 'input,textarea,select,[contenteditable="true"],[contenteditable=""]'
const composerSelector = '[data-composer-input][data-lexical-editor="true"][contenteditable="true"]'
const modalSelector = '[role="dialog"][aria-modal="true"],[role="menu"]'
const modifiers = ['control', 'alt', 'shift', 'meta'] as const
const native: Record<string, { group: FixedDispatchMapping['group']; bindings: readonly [string, ...string[]] }> = {
  'fixed.send': { group: 'input', bindings: ['Enter'] },
  'fixed.newline': { group: 'input', bindings: ['shift:Enter'] },
  'fixed.complementary': { group: 'input', bindings: ['control:Enter', 'meta:Enter'] },
  'fixed.slash': { group: 'input', bindings: ['Slash'] },
  'fixed.mention': { group: 'input', bindings: ['shift:Digit2'] },
  'fixed.move': { group: 'menus', bindings: ['ArrowUp', 'ArrowDown'] },
  'fixed.select': { group: 'menus', bindings: ['Enter'] },
  'fixed.dismiss': { group: 'menus', bindings: ['Escape'] },
  'approval.allow': { group: 'approval', bindings: ['Enter'] },
  'approval.reject': { group: 'approval', bindings: ['Escape'] },
  // This ONE binding is pressed TWICE. The host owns timing and turn identity.
  'response.stop': { group: 'input', bindings: ['Escape'] },
}
function signature(binding: NormalizedBinding): string {
  return [...modifiers.filter(modifier => binding.modifiers.includes(modifier)), binding.code, ...(binding.secondCode ? [binding.secondCode] : [])].join(':')
}
/** UI/save preflight: a group is not enough to infer an unknown owner's sequence semantics. */
export function fixedDispatchIssue(row: Pick<FixedDispatchMapping, 'id' | 'group' | 'original'> & Partial<Pick<FixedDispatchMapping, 'bindings'>>): string | null {
  const adapter = native[row.id]
  if (!adapter || adapter.group !== row.group || row.original.bindings.length !== adapter.bindings.length || row.original.bindings.some((binding, index) => signature(binding) !== adapter.bindings[index])) {
    return 'No verified adapter for this fixed catalog signature; its original behavior remains active.'
  }
  // Native stop sequences reset on EVERY non-Escape keydown, including a modifier
  // pressed again for the second chord. Swallowing it also resets the native capture
  // timer. A plain single key preserves the native turn/lifecycle-aware sequence.
  if (row.id === 'response.stop' && row.bindings?.some(binding => binding && (binding.modifiers.length > 0 || binding.secondCode))) {
    return 'The double-press stop sequence requires one key without modifiers or a second key; its original behavior remains active.'
  }
  return null
}
function matches(event: KeyboardEvent, binding: NormalizedBinding, held: ReadonlySet<string>): boolean {
  if (binding.secondCode ? !((event.code === binding.code && held.has(binding.secondCode)) || (event.code === binding.secondCode && held.has(binding.code))) : event.code !== binding.code) return false
  return event.ctrlKey === binding.modifiers.includes('control') && event.altKey === binding.modifiers.includes('alt') && event.shiftKey === binding.modifiers.includes('shift') && event.metaKey === binding.modifiers.includes('meta')
}
function keyFor(binding: NormalizedBinding): { key: string; keyCode: number } | null {
  const known: Record<string, [string, number]> = { Enter: ['Enter', 13], Escape: ['Escape', 27], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Tab: ['Tab', 9], Space: [' ', 32], Home: ['Home', 36], End: ['End', 35], Delete: ['Delete', 46], Backspace: ['Backspace', 8], Slash: ['/', 191], Digit2: [binding.modifiers.includes('shift') ? '@' : '2', 50] }
  const result = known[binding.code]
  return result ? { key: result[0], keyCode: result[1] } : null
}
/** Rewrite only this event, retaining target, trust and the native propagation path. */
function rewrite(event: KeyboardEvent, binding: NormalizedBinding): void {
  const key = keyFor(binding)
  if (!key || binding.secondCode) throw new Error('The original fixed key has no verified keyboard adapter.')
  const values = { ...key, which: key.keyCode, code: binding.code, ctrlKey: binding.modifiers.includes('control'), altKey: binding.modifiers.includes('alt'), shiftKey: binding.modifiers.includes('shift'), metaKey: binding.modifiers.includes('meta') }
  const before = Object.getOwnPropertyDescriptors(event)
  try {
    for (const [name, value] of Object.entries(values)) Object.defineProperty(event, name, { configurable: true, value })
    const previous = event.getModifierState.bind(event)
    Object.defineProperty(event, 'getModifierState', { configurable: true, value: (name: string) => name === 'Control' ? values.ctrlKey : name === 'Alt' ? values.altKey : name === 'Shift' ? values.shiftKey : name === 'Meta' ? values.metaKey : previous(name) })
  } catch (error) {
    for (const name of [...Object.keys(values), 'getModifierState']) {
      const descriptor = before[name]
      if (descriptor) Object.defineProperty(event, name, descriptor)
      else Reflect.deleteProperty(event, name)
    }
    throw error
  }
}
function visible(element: Element): boolean {
  return element.isConnected && !element.closest('[hidden],[inert],[aria-hidden="true"]')
}
function selectionInside(document: Document, root: Element): boolean {
  const selection = document.getSelection()
  return selection !== null && selection.rangeCount > 0 && selection.anchorNode !== null && selection.focusNode !== null && root.contains(selection.anchorNode) && root.contains(selection.focusNode)
}

/**
 * Compatibility adapter for owner-local fixed handlers, not a replacement command service.
 * Known catalog signatures are checked before touching input. Newline and text triggers use
 * Lexical's controlled beforeinput branches: insertText alone may defer to a browser default
 * that synthetic events cannot perform. insertReplacementText and insertLineBreak instead
 * update the original editor/undo history and notify its input-trigger observers. The owner
 * must cancel beforeinput to acknowledge handling; no DOM mutation fallback is permitted.
 */
export function installFixedDispatcher(options: FixedDispatcherOptions): () => void {
  const win = options.window as Window & typeof globalThis
  const document = win.document
  const held = new Set<string>()
  const handled = new WeakMap<KeyboardEvent, string>()
  const diagnostics = new Set<string>()
  let composing = false
  let deadKey = false
  let composingUntil = 0
  let disposed = false
  const report = (id: string, message: string) => {
    const text = `${id}: ${message}`
    if (diagnostics.has(text)) return
    diagnostics.add(text)
    const error = new Error(text)
    if (options.onError) options.onError(error)
    else console.error(error)
  }
  const consume = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation() }
  const reset = () => { held.clear(); deadKey = false }
  const start = () => { composing = true; reset() }
  const end = () => { composing = false; composingUntil = Date.now() + 10; reset() }
  const keyup = (event: KeyboardEvent) => { held.delete(event.code) }
  const keydown = (event: KeyboardEvent) => {
    if (disposed || options.isRecording?.()) { reset(); return }
    if (deadKey || event.key === 'Dead') {
      const nextDead = event.key === 'Dead'
      reset(); deadKey = nextDead; return
    }
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || composing || Date.now() < composingUntil || event.getModifierState('AltGraph')) { reset(); return }
    const target = event.composedPath().find(node => node instanceof win.Element) as Element | undefined
    if (!target || !visible(target) || target.closest('.xterm,iframe')) return
    const focus = document.activeElement
    if (!focus || !(focus === target || target.contains(focus) || focus.contains(target))) return
    const composer = target.closest(composerSelector)
    if (composer?.hasAttribute('data-composer-composing')) return
    const top = [...document.querySelectorAll(modalSelector)].filter(visible).at(-1)
    const menu = target.closest('[role="menu"],[role="listbox"]')
    const triggerMenu = composer?.closest('[data-composer-card]')?.querySelector('[data-trigger-menu]')
    const trigger = triggerMenu && visible(triggerMenu) ? triggerMenu : null
    const foregroundMenu = menu ?? (top?.getAttribute('role') === 'menu' ? top : null)
    // Menus can leave focus on their aria-expanded anchor, including portal menus.
    const anchoredMenu = foregroundMenu && (foregroundMenu.contains(target) || target.closest('[aria-haspopup][aria-expanded="true"]'))
    const modalBlocks = top !== undefined && !top.contains(target)
    const approval = target.closest('[data-approval-key]')
    const scope = (row: FixedDispatchMapping): boolean => {
      if (row.group === 'menus') {
        if (row.id === 'fixed.dismiss' && top && !foregroundMenu) return top.contains(target)
        if (modalBlocks) return top === foregroundMenu && !!anchoredMenu
        return !!trigger || !!anchoredMenu || !!menu
      }
      if (foregroundMenu || trigger || modalBlocks || top) return false
      if (row.group === 'approval') {
        if (!approval || !approval.contains(focus) || target.closest(editable)) return false
        if (row.id === 'approval.allow' && target.closest('button,a[href],[role="button"]')) return false
        return true
      }
      if (row.id === 'response.stop') return !approval && !!target.closest('[data-conversation-region]')?.closest('[data-conversation-session]')
      if (row.group === 'input') return !!composer && !approval
      return false
    }
    let rows: readonly FixedDispatchMapping[]
    try { rows = options.getMappings() } catch (error) { report('fixed', String(error)); return }
    const active: FixedDispatchMapping[] = []
    for (const row of rows) {
      if (!row.modified) continue
      const issue = fixedDispatchIssue(row)
      if (issue || row.bindings.length !== row.original.bindings.length) {
        report(row.id, issue ?? 'The override slot count does not match its fixed catalog signature; its original behavior remains active.')
        continue
      }
      if (row.conflicts?.length) { report(row.id, 'Conflicting bindings; its original behavior remains active.'); continue }
      if (scope(row)) active.push(row)
    }
    const previousHeld = new Set(held)
    held.add(event.code)
    const hit = active.flatMap(row => row.bindings.flatMap((binding, index) => binding && matches(event, binding, previousHeld) ? [{ row, index, binding }] : []))
    if (hit.length > 1) { consume(event); report('fixed', 'Multiple fixed actions match in the current scope.'); return }
    const found = hit[0]
    if (found) {
      const { row, index, binding } = found
      const original = row.original.bindings[index]!
      if (signature(binding) === signature(original)) return
      if (event.repeat) { consume(event); return }
      if (composer && row.group === 'input' && row.id !== 'response.stop' && !selectionInside(document, composer)) {
        consume(event); report(row.id, 'The composer selection is unavailable or outside this editor.'); return
      }
      if (row.id === 'fixed.newline' || row.id === 'fixed.slash' || row.id === 'fixed.mention') {
        consume(event)
        const input = new win.InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType: row.id === 'fixed.newline' ? 'insertLineBreak' : 'insertReplacementText', data: row.id === 'fixed.slash' ? '/' : row.id === 'fixed.mention' ? '@' : null })
        composer!.dispatchEvent(input)
        if (!input.defaultPrevented) report(row.id, 'The editor did not accept the controlled editing operation.')
        return
      }
      // A native button's Enter activation is a browser default tied to the physical
      // key, not its JS getters. Invoke that exact enabled menu item's owner instead.
      if (row.id === 'fixed.select' && !trigger) {
        const button = target.closest('button,[role="menuitem"],[role="option"]') as HTMLElement | null
        if (button && menu?.contains(button) && button.tagName === 'BUTTON' && !button.matches(':disabled,[aria-disabled="true"]')) {
          consume(event); button.click(); return
        }
      }
      try { rewrite(event, original); handled.set(event, row.id) }
      catch (error) { consume(event); report(row.id, `Cannot adapt the keyboard event: ${String(error)}`) }
      return
    }
    // Suppress an old key only in its original owner's scope. New bindings win first,
    // permitting deliberate swaps (e.g. Enter and Shift+Enter) without recursion.
    for (const row of active) {
      if (row.original.bindings.some((binding, index) => matches(event, binding, previousHeld) && (row.bindings[index] === null || signature(row.bindings[index]!) !== signature(binding)))) { consume(event); return }
    }
    // A two-key chord owns its prefix too; otherwise a printable prefix would leak
    // into the editor before the second key arrives. Ownership ends on keyup/blur.
    if (active.some(row => row.bindings.some(binding => binding?.secondCode && (binding.code === event.code || binding.secondCode === event.code) && matches(event, { code: event.code, modifiers: binding.modifiers }, previousHeld)))) consume(event)
  }
  const finish = (event: KeyboardEvent) => {
    const id = handled.get(event)
    if (!id || event.defaultPrevented) return
    // Rewriting a trusted event never rewrites the browser's physical default action.
    // Unhandled adapted input must therefore not insert the original typed character.
    event.preventDefault()
    report(id, 'The original owner did not consume the adapted key in this context.')
  }
  win.addEventListener('keydown', keydown, true)
  win.addEventListener('keydown', finish)
  win.addEventListener('keyup', keyup, true)
  win.addEventListener('blur', reset)
  document.addEventListener('compositionstart', start, true)
  document.addEventListener('compositionend', end, true)
  document.addEventListener('focusin', reset, true)
  document.addEventListener('pointerdown', reset, true)
  return () => {
    if (disposed) return
    disposed = true
    reset()
    win.removeEventListener('keydown', keydown, true)
    win.removeEventListener('keydown', finish)
    win.removeEventListener('keyup', keyup, true)
    win.removeEventListener('blur', reset)
    document.removeEventListener('compositionstart', start, true)
    document.removeEventListener('compositionend', end, true)
    document.removeEventListener('focusin', reset, true)
    document.removeEventListener('pointerdown', reset, true)
  }
}
