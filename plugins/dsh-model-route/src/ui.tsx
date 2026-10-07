/**
 * ModelMenu: the standard editor of one model-route field — the visible half
 * of the x-model-route contract. A feature plugin's settings page renders it
 * for its own marked field; the model hub renders one per detected field.
 *
 * It is a plugin-side copy of the host's composer model picker
 * (dsh-client-ui-model-selection's ModelSelect), rebuilt from the official
 * primitives and the published bundle's behavior: one card that opens on the
 * root pane (Model / Effort cells), drills into the provider-grouped,
 * searchable model list or the effort list, and Escapes back before closing.
 * Sticky group headings, subsequence ranking, highlight walking and focus
 * hand-back all match the host. SYNC POINT: when the host's ModelSelect or
 * ModelSelect.module.css changes, this copy must be re-transcribed; styles
 * below may only reference --dsw-* theme tokens, never literal colors.
 *
 * It statically imports the primitives, so only browser clients should load
 * this entry; host code and node tests use the core entry (`./index.ts`).
 */
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCheckOutlineRegular, IconChevronRightOutlineRegular, IconCloseFillRegular, Input, MenuGroup, MenuSurface,
  observeStickyMenuGroups, rankByName,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelMenuChoice } from './catalog.ts'
import { groupModelMenuChoices, modelMenuShortName } from './menu.ts'

/** Extra rows rendered above the model groups (e.g. a plugin's "follow"/"off" modes). */
export interface ModelMenuLeadingItem {
  readonly id: string
  readonly label: ReactNode
  readonly selected?: boolean
}

export interface ModelMenuProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** Trigger rendered in place; the menu anchors to it and returns focus to it. */
  readonly anchor: ReactNode
  readonly choices: readonly ModelMenuChoice[]
  readonly selected?: { readonly provider: string; readonly model: string }
  readonly onPick: (route: { provider: string; model: string }) => void
  readonly leading?: readonly ModelMenuLeadingItem[]
  readonly onPickLeading?: (id: string) => void
  /** Effort pane rows; the root Effort cell is hidden while this is empty. */
  readonly efforts?: ReadonlyArray<{ id: string; name: string }>
  readonly selectedEffort?: string
  readonly onPickEffort?: (effort: string | undefined) => void
  /** Root-cell labels and the values shown trailing them. */
  readonly modelLabel?: string
  readonly modelValue?: string
  readonly effortLabel?: string
  readonly effortValue?: string
  readonly defaultEffortLabel?: string
  readonly searchPlaceholder?: string
  readonly emptyLabel?: string
  readonly clearSearchLabel?: string
  readonly className?: string
  /** Extra class on the portaled menu card, which renders under document.body. */
  readonly listClassName?: string
}

type Pane = 'root' | 'model' | 'effort'

/** Unplaced portal card: hidden but laid out at a fixed origin so measurements are real. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

export function ModelMenu(props: ModelMenuProps) {
  const {
    open, onOpenChange, anchor, choices, selected, onPick,
    leading = [], onPickLeading, efforts = [], selectedEffort, onPickEffort,
    modelLabel = 'Model', modelValue = '—', effortLabel = 'Reasoning', effortValue, defaultEffortLabel = 'Default',
    searchPlaceholder = 'Search models…', emptyLabel = 'No matching models', clearSearchLabel = 'Clear search',
    className, listClassName,
  } = props
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const pendingOpenRef = useRef(false)
  const pendingRestoreFocus = useRef(false)
  const [requestedOpen, setRequestedOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const paneFocus = useRef<Pane | 'drill' | null>(null)
  const [pane, setPane] = useState<Pane>('root')
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const id = useId()
  const showSearch = choices.length > 4
  const effortRows = useMemo(() => [{ id: '', name: defaultEffortLabel }, ...efforts], [defaultEffortLabel, efforts])
  /* The official ranks each provider group by a case-insensitive ordered
   * subsequence (prefix hits first, then alignment score, then catalog order);
   * groups left empty by the query drop out. */
  const filteredGroups = useMemo(() => groupModelMenuChoices(choices, '').map(group => ({
    ...group,
    items: rankByName(group.items.map(choice => ({ choice, name: modelMenuShortName(choice), label: choice.model })), showSearch ? query.trim() : ''),
  })).filter(group => group.items.length > 0), [choices, query, showSearch])
  const visibleModels = useMemo(() => filteredGroups.flatMap(group => group.items.map(item => item.choice)), [filteredGroups])
  const currentVisibleIndex = visibleModels.findIndex(choice => choice.provider === selected?.provider && choice.model === selected.model)
  const activeModelIndex = Math.min(highlightedIndex ?? Math.max(0, currentVisibleIndex), visibleModels.length - 1)
  const changeOpen = (next: boolean): void => {
    if (openRef.current === next) return
    openRef.current = next
    onOpenChange(next)
  }
  const requestOpen = (): void => {
    if (open || pendingOpenRef.current) return
    pendingOpenRef.current = true
    pendingRestoreFocus.current = false
    setRequestedOpen(true)
  }
  const close = (restoreFocus = false): void => {
    const active = document.activeElement
    pendingRestoreFocus.current = restoreFocus && (active === document.body
      || rootRef.current?.contains(active) === true || menuRef.current?.contains(active) === true)
    changeOpen(false)
  }
  const drill = (next: Pane): void => {
    setQuery('')
    setHighlightedIndex(null)
    paneFocus.current = 'drill'
    setPane(next)
  }
  /** Leave a drilled pane for the root one, handing the keyboard back to its cell. */
  const back = (from: Pane): void => {
    paneFocus.current = from
    setPane('root')
  }
  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null && !item.disabled)
    if (!items.length) return
    const active = items.findIndex(item => item === document.activeElement)
    items[active === -1 ? (offset > 0 ? 0 : items.length - 1) : (active + offset + items.length) % items.length]?.focus()
  }

  // A selection can synchronously disable its trigger while the owner writes.
  // Retry on the owner's next render, once the native button can take focus.
  useLayoutEffect(() => {
    if (open || !pendingRestoreFocus.current) return
    const active = document.activeElement
    if (active !== document.body && !rootRef.current?.contains(active)) {
      pendingRestoreFocus.current = false
      return
    }
    const trigger = rootRef.current?.querySelector('button')
    if (!trigger || trigger.disabled) return
    trigger.focus()
    if (document.activeElement === trigger) pendingRestoreFocus.current = false
  })
  useEffect(() => {
    if (open || !pendingRestoreFocus.current) return
    const cancelOutside = (event: Event): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) pendingRestoreFocus.current = false
    }
    document.addEventListener('focusin', cancelOutside)
    document.addEventListener('pointerdown', cancelOutside)
    return () => {
      document.removeEventListener('focusin', cancelOutside)
      document.removeEventListener('pointerdown', cancelOutside)
    }
  })

  useEffect(() => {
    if (!requestedOpen) return
    pendingOpenRef.current = false
    setRequestedOpen(false)
    // The caller's trigger handler may also update the controlled open prop.
    // Check the committed state before supplying the missing open callback.
    if (!open) changeOpen(true)
  }, [requestedOpen, open])

  useEffect(() => {
    if (!open) return
    setPane('root')
    setQuery('')
    setHighlightedIndex(null)
  }, [open])
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      changeOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open, onOpenChange])
  /* Focus intent after a pane change: the model pane takes the search field when
   * it has one, every other drill takes the checked row, and going back takes
   * the cell that opened the pane. */
  useEffect(() => {
    const intent = paneFocus.current
    // MenuSurface forwards the measurement visibility:hidden style. Browsers
    // refuse focus there, so keep intent until placement has made it visible.
    if (!open || menuPos === null || intent === null) return
    // Reopening resets a previously drilled pane in a separate commit. Entry
    // and return intent belong to the root cells, never the outgoing rows.
    if (intent !== 'drill' && pane !== 'root') return
    paneFocus.current = null
    if (intent === 'drill') {
      if (pane === 'model' && showSearch) { searchRef.current?.focus(); return }
      (menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]:not([disabled])')
        ?? itemRefs.current.find(item => item !== null && !item.disabled))?.focus()
      return
    }
    itemRefs.current[intent === 'effort' ? 1 : 0]?.focus()
  }, [open, pane, showSearch, menuPos])
  useEffect(() => {
    const viewport = groupsRef.current
    if (viewport === null) return
    return observeStickyMenuGroups(viewport)
  }, [open, pane, filteredGroups])
  useLayoutEffect(() => {
    if (open && pane === 'model' && activeModelIndex >= 0) itemRefs.current[leading.length + activeModelIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, pane, activeModelIndex, visibleModels, leading.length])
  /* The card hangs above the trigger, right-aligned, inside 12px viewport
   * margins — the official placement formula, re-run on scroll and resize. */
  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return }
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const margin = 12, lw = menuRef.current?.offsetWidth ?? 0, lh = menuRef.current?.offsetHeight ?? 0
      let x = rect.right - lw, y = rect.top - 8 - lh
      if (lw > 0) x = Math.min(Math.max(x, margin), window.innerWidth - lw - margin)
      if (lh > 0) y = Math.min(Math.max(y, margin), window.innerHeight - lh - margin)
      setMenuPos({ left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, pane, choices, query])

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (!open && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      const button = event.target instanceof Element ? event.target.closest('button') : null
      if (!(button instanceof HTMLButtonElement) || button.disabled || !rootRef.current?.contains(button)) return
      // Prevent the native Enter/Space click from opening a second time.
      event.preventDefault()
      paneFocus.current = 'model'
      requestOpen()
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      if (pane !== 'root') back(pane)
      else close(true)
      return
    }
    if (!open) return
    if (pane === 'model' && showSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      if (visibleModels.length > 0) {
        setHighlightedIndex((activeModelIndex + (event.key === 'ArrowDown' ? 1 : -1) + visibleModels.length) % visibleModels.length)
        searchRef.current?.focus()
      }
      return
    }
    if (pane === 'model' && showSearch && event.target instanceof HTMLInputElement && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
      if (event.key === 'Tab' && visibleModels.length === 0) return
      event.preventDefault()
      const highlighted = visibleModels[activeModelIndex]
      if (highlighted) { onPick({ provider: highlighted.provider, model: highlighted.model }); close(true) }
      return
    }
    if (event.key === 'Tab') {
      if (event.shiftKey) {
        event.preventDefault()
        if (pane !== 'root') back(pane)
        else close(true)
        return
      }
      const focused = document.activeElement
      const rows = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
      if (focused instanceof HTMLButtonElement && rows.includes(focused)) {
        event.preventDefault()
        focused.click()
        return
      }
      if (pane === 'model' && showSearch) {
        event.preventDefault()
        setHighlightedIndex(null)
        searchRef.current?.focus()
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  function onBlur(event: React.FocusEvent): void {
    if (event.relatedTarget instanceof Node && (rootRef.current?.contains(event.relatedTarget) || menuRef.current?.contains(event.relatedTarget))) return
    if (open) changeOpen(false)
  }

  itemRefs.current = []
  let itemIndex = 0
  let modelIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null): void => { itemRefs.current[at] = node }
  }

  const menu = open && typeof document !== 'undefined'
    ? createPortal(
      <MenuSurface
        ref={menuRef}
        id={`${id}-menu`}
        className={`dsh-model-menu-menu${listClassName ? ` ${listClassName}` : ''}`}
        style={menuPos ?? MEASURE_STYLE}
        role={pane === 'model' ? 'group' : 'menu'}
        aria-label={modelLabel}
      >
        {pane === 'root' ? <>
          <button ref={itemRef()} type="button" role="menuitem" className="dsh-model-menu-cell" onClick={() => drill('model')}>
            <span className="dsh-model-menu-cellLabel">{modelLabel}</span>
            <span className="dsh-model-menu-cellValue">{modelValue}</span>
            <IconChevronRightOutlineRegular className="dsh-model-menu-cellChevron" />
          </button>
          {efforts.length > 0 ? <button ref={itemRef()} type="button" role="menuitem" className="dsh-model-menu-cell" onClick={() => drill('effort')}>
            <span className="dsh-model-menu-cellLabel">{effortLabel}</span>
            <span className="dsh-model-menu-cellValue">{effortValue ?? effortRows.find(row => row.id === (selectedEffort ?? ''))?.name ?? defaultEffortLabel}</span>
            <IconChevronRightOutlineRegular className="dsh-model-menu-cellChevron" />
          </button> : null}
        </> : null}
        {pane === 'model' ? <>
          {showSearch ? <div className="dsh-model-menu-searchRow">
            <Input
              ref={searchRef}
              className={`dsh-model-menu-search${query !== '' ? ' dsh-model-menu-searchWithQuery' : ''}`}
              type="text"
              role="searchbox"
              aria-label={searchPlaceholder}
              aria-controls={`${id}-models`}
              aria-activedescendant={activeModelIndex < 0 ? undefined : `${id}-model-${activeModelIndex}`}
              placeholder={searchPlaceholder}
              value={query}
              onChange={event => { setQuery(event.target.value); setHighlightedIndex(0) }}
            />
            {query !== '' ? <button type="button" className="dsh-model-menu-searchClear" aria-label={clearSearchLabel}
              onClick={() => { setQuery(''); setHighlightedIndex(null); searchRef.current?.focus() }}>
              <IconCloseFillRegular />
            </button> : null}
          </div> : null}
          <div ref={groupsRef} id={`${id}-models`} className="dsh-model-menu-groups scrollable" role="menu" aria-label={modelLabel}
            hidden={filteredGroups.length === 0}>
            {leading.length > 0 ? <div className="dsh-model-menu-leading">
              {leading.map(item => (
                <button key={item.id} ref={itemRef()} type="button" role="menuitemradio" aria-checked={item.selected === true}
                  className={`dsh-model-menu-option${item.selected === true ? ' dsh-model-menu-selected' : ''}`}
                  onClick={() => { onPickLeading?.(item.id); close(true) }}>
                  <span className="dsh-model-menu-optionCopy"><span className="dsh-model-menu-modelName">{item.label}</span></span>
                  <span className="dsh-model-menu-check">{item.selected === true ? <IconCheckOutlineRegular /> : null}</span>
                </button>
              ))}
            </div> : null}
            {filteredGroups.map(group => (
              <MenuGroup key={group.provider} label={group.name}>
                {group.items.map(item => {
                  const index = modelIndex++
                  const choice = item.choice
                  const checked = selected?.provider === choice.provider && selected.model === choice.model
                  return <button
                    key={`${choice.provider}/${choice.model}`}
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    id={`${id}-model-${index}`}
                    tabIndex={showSearch ? -1 : 0}
                    onFocus={() => setHighlightedIndex(index)}
                    data-highlighted={index === activeModelIndex ? '' : undefined}
                    className={`dsh-model-menu-option dsh-model-menu-modelOption${checked ? ' dsh-model-menu-selected' : ''}${index === activeModelIndex ? ' dsh-model-menu-optionActive' : ''}`}
                    onMouseMove={index === activeModelIndex ? undefined : () => {
                      if (showSearch) setHighlightedIndex(index)
                      else itemRefs.current[leading.length + index]?.focus()
                    }}
                    title={choice.label}
                    onClick={() => { onPick({ provider: choice.provider, model: choice.model }); close(true) }}
                  >
                    <span className="dsh-model-menu-optionCopy"><span className="dsh-model-menu-modelName">{modelMenuShortName(choice)}</span></span>
                    <span className="dsh-model-menu-check">{checked ? <IconCheckOutlineRegular /> : null}</span>
                  </button>
                })}
              </MenuGroup>
            ))}
          </div>
          {filteredGroups.length === 0 ? <div className="dsh-model-menu-empty" role="status">{emptyLabel}</div> : null}
        </> : null}
        {pane === 'effort' ? <>
          {effortRows.map(row => {
            const checked = (selectedEffort ?? '') === row.id
            return <button key={row.id || '__default'} ref={itemRef()} type="button" role="menuitemradio" aria-checked={checked}
              className={`dsh-model-menu-option${checked ? ' dsh-model-menu-selected' : ''}`}
              onClick={() => { onPickEffort?.(row.id || undefined); close(true) }}>
              <span className="dsh-model-menu-optionCopy"><span className="dsh-model-menu-modelName">{row.name}</span></span>
              <span className="dsh-model-menu-check">{checked ? <IconCheckOutlineRegular /> : null}</span>
            </button>
          })}
        </> : null}
      </MenuSurface>,
      document.body,
    )
    : null
  const trigger = isValidElement<Record<string, unknown>>(anchor)
    ? cloneElement(anchor, { 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? `${id}-menu` : undefined })
    : anchor
  return <span ref={rootRef} className={`dsh-model-menu-root${className ? ` ${className}` : ''}`} onKeyDown={onKeyDown} onBlur={onBlur}
    onClick={event => {
      if (event.defaultPrevented) return
      const button = event.target instanceof Element ? event.target.closest('button') : null
      if (!(button instanceof HTMLButtonElement) || button.disabled || !rootRef.current?.contains(button)) return
      requestOpen()
    }}
    onMouseDown={event => { if (event.target instanceof Element && menuRef.current?.contains(event.target) && event.target.closest('button') !== null) event.preventDefault() }}>
    {trigger}{menu}
  </span>
}

/**
 * ModelMenu styles, transcribed from the official ModelSelect.module.css (the
 * published dsh-client-ui-model-selection bundle): card capped at
 * min(360px, 100vh - 96px), 34px option cells at 13/18 with 5px 7px padding,
 * 34px root cells at 13/20, a borderless 12px search row with a clear button,
 * sticky group headings (MenuGroup's own CSS), and the l1-stroke prominent
 * elevation at portal z-index 1100. The trigger mirrors the composer's 28px
 * model pill, chevron rotating open. MenuSurface paints fill and backdrop.
 * Only --dsw-* theme tokens may appear here — a literal color is a bug.
 */
export const modelMenuCss = `
.dsh-model-menu-root { min-width: 0; position: relative; display: inline-flex; }
.dsh-model-menu-trigger {
  border-radius: var(--dsw-radius-sm);
  min-width: 0;
  max-width: min(360px, 45cqw);
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: none;
  border: none;
  outline: none;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 8px;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  display: flex;
}
.dsh-model-menu-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-model-menu-trigger:focus-visible:not([data-selection-focus]) { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.dsh-model-menu-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-model-menu-triggerLabel { text-overflow: ellipsis; white-space: nowrap; min-width: 0; overflow: hidden; }
.dsh-model-menu-triggerEffort { text-overflow: ellipsis; white-space: nowrap; min-width: 0; color: var(--dsw-alias-label-caption); flex-shrink: 1000; overflow: hidden; }
.dsh-model-menu-chevron { color: var(--dsw-alias-label-caption); flex: none; transition: transform 0.12s; }
.dsh-model-menu-chevronOpen { transform: rotate(180deg); }
.dsh-model-menu-menu {
  z-index: 1100;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  width: max-content;
  min-width: min(240px, 100vw - 32px);
  max-width: min(420px, 100vw - 32px);
  max-height: min(360px, 100vh - 96px);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  border: 0;
  flex-direction: column;
  padding: 4px;
  display: flex;
  position: fixed;
  overflow: hidden;
}
.dsh-model-menu-status, .dsh-model-menu-empty { color: var(--dsw-alias-label-tertiary); padding: 8px; font-size: 12px; line-height: 18px; }
.dsh-model-menu-searchRow { flex-shrink: 0; margin: 2px 0 3px; position: relative; }
.dsh-model-menu-searchRow .dsh-model-menu-search { border-radius: var(--dsw-radius-md); background: none; border: 0 solid transparent; height: auto; padding: 5px 7px; display: flex; }
.dsh-model-menu-searchRow .dsh-model-menu-search:focus-within { border-color: transparent; }
.dsh-model-menu-searchWithQuery { padding-right: 34px; }
.dsh-model-menu-searchRow .dsh-model-menu-search input { padding: 0; font-size: 12px; line-height: normal; }
.dsh-model-menu-searchRow .dsh-model-menu-search input::placeholder { color: var(--dsw-alias-label-caption); }
.dsh-model-menu-searchClear {
  width: 24px;
  height: 24px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 50%;
  justify-content: center;
  align-items: center;
  padding: 0;
  display: inline-flex;
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
}
.dsh-model-menu-searchClear:hover, .dsh-model-menu-searchClear:focus-visible { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
.dsh-model-menu-groups { min-height: 0; overflow-y: auto; }
.dsh-model-menu-leading { border-bottom: 0.5px solid var(--dsw-alias-border-l2); margin-bottom: 3px; padding-bottom: 3px; }
.dsh-model-menu-option {
  box-sizing: border-box;
  border-radius: var(--dsw-radius-md);
  width: auto;
  min-width: 100%;
  min-height: 34px;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  outline: none;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
  display: flex;
}
.dsh-model-menu-option:not(.dsh-model-menu-modelOption):hover:not(:disabled),
.dsh-model-menu-option:focus-visible,
.dsh-model-menu-optionActive:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-model-menu-modelOption:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-model-menu-selected { background: none; }
.dsh-model-menu-option:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-model-menu-optionCopy { flex-direction: column; flex: 1; min-width: 0; display: flex; }
.dsh-model-menu-modelName { color: inherit; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 400; line-height: 18px; overflow: hidden; }
.dsh-model-menu-check { color: var(--dsw-alias-label-primary); flex: 0 0 14px; place-items: center; display: grid; }
.dsh-model-menu-check svg { width: 14px; height: 14px; }
.dsh-model-menu-cell {
  box-sizing: border-box;
  border-radius: var(--dsw-radius-md);
  width: auto;
  min-width: 100%;
  height: 34px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
  background: none;
  border: none;
  outline: none;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  font-size: 13px;
  line-height: 20px;
  display: flex;
}
.dsh-model-menu-cell:hover, .dsh-model-menu-cell:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-model-menu-cellLabel { white-space: nowrap; flex: none; }
.dsh-model-menu-cellValue { text-overflow: ellipsis; white-space: nowrap; text-align: right; min-width: 0; color: var(--dsw-alias-label-tertiary); flex: auto; overflow: hidden; }
.dsh-model-menu-cellChevron { width: 12px; height: 12px; color: var(--dsw-alias-menu-icon); flex: none; }
`
