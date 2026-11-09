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
 * below may only reference allowlisted theme tokens (the --dsw-* set plus the
 * host's --ds-* motion tokens), never literal colors.
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
export { useModelCatalog, ModelCatalogStatus } from './catalog-ui.tsx'
export type { UseModelCatalogOptions, ModelCatalogState, ModelCatalogStatusProps } from './catalog-ui.tsx'
import type { ModelMenuChoice } from './catalog.ts'
import { groupModelMenuChoices, modelMenuEffortLabel, modelMenuShortName } from './menu.ts'

/** Extra rows rendered above the model groups (e.g. a plugin's "follow"/"off" modes). */
export interface ModelMenuLeadingItem {
  readonly id: string
  readonly label: ReactNode
  readonly selected?: boolean
}

export interface ModelMenuProps {
  /** Active host locale, supplied by the owning plugin's live locale subscription. */
  readonly locale?: string
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
  /** Pane the menu opens on; default 'root'. 'model' opens the searchable model list directly. */
  readonly initialPane?: 'root' | 'model'
  /** Show the model search row even when the catalog has four or fewer choices. */
  readonly alwaysShowSearch?: boolean
  /**
   * Render the declared reasoning efforts as a discrete slider inside the model
   * pane. Additive: the effort list and the root Effort cell stay for the
   * default (false) mode, and only the caller-supplied effort rows are shown.
   */
  readonly reasoningSlider?: boolean
  /**
   * Optional banner rendered at the top of the menu card, above the search and
   * list — e.g. a directory status/error row. Pure library-local React content,
   * not a cross-factory data contract.
   */
  readonly menuHeader?: ReactNode
  /** Disable every action after opening; by default a true value also closes
   *  the menu (closeOnDisable). */
  readonly disabled?: boolean
  /**
   * Submission in progress. Keeps the menu open (unlike `disabled`) and still
   * allows opening/closing and typing in search, but disables selection rows
   * and blocks repeated model/leading/effort/slider submissions.
   */
  readonly busy?: boolean
  /**
   * Close the card after a model pick. Default true (drill menus dismiss).
   * The composer picker sets false so a selection does not unmount the open
   * list — search and scroll belong to that card.
   */
  readonly closeOnPick?: boolean
  /**
   * Close the open card when `disabled` rises. Default true — a hard lock
   * dismisses. Keep-open callers (the composer picker) set false: an owner's
   * save-state "disabled" pulse gates actions without unmounting the open
   * list, and Escape/outside presses still dismiss while disabled.
   */
  readonly closeOnDisable?: boolean
  readonly className?: string
  /** Extra class on the portaled menu card, which renders under document.body. */
  readonly listClassName?: string
}

type Pane = 'root' | 'model' | 'effort'

/** Unplaced portal card: hidden but laid out at a fixed origin so measurements are real. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

export function ModelMenu(props: ModelMenuProps) {
  const language = props.locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const copy = language === 'zh'
    ? { model: '模型', effort: '思考强度', default: '默认', search: '搜索模型…', empty: '没有匹配的模型', clear: '清除搜索' }
    : { model: 'Model', effort: 'Reasoning', default: 'Default', search: 'Search models…', empty: 'No matching models', clear: 'Clear search' }
  const {
    open, onOpenChange, anchor, choices, selected, onPick,
    leading = [], onPickLeading, efforts = [], selectedEffort, onPickEffort,
    modelLabel = copy.model, modelValue = '—', effortLabel = copy.effort, effortValue, defaultEffortLabel = copy.default,
    searchPlaceholder = copy.search, emptyLabel = copy.empty, clearSearchLabel = copy.clear,
    initialPane = 'root', alwaysShowSearch = false, reasoningSlider = false,
    menuHeader, disabled = false, busy = false, closeOnPick = true, closeOnDisable = true,
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
  /* Keyboard arrows only. Mouse focus and a rebuilt choices array must not scroll. */
  const [keyNav, setKeyNav] = useState(0)
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const id = useId()
  const showSearch = alwaysShowSearch || choices.length > 4
  const effortRows = useMemo(() => [{ id: '', name: defaultEffortLabel }, ...efforts.map(effort => ({ ...effort, name: modelMenuEffortLabel(effort, language) }))], [defaultEffortLabel, efforts, language])
  /* The official ranks each provider group by a case-insensitive ordered
   * subsequence (prefix hits first, then alignment score, then catalog order);
   * groups left empty by the query drop out. */
  const filteredGroups = useMemo(() => groupModelMenuChoices(choices, '').map(group => ({
    ...group,
    items: rankByName(group.items.map(choice => ({
      choice,
      name: modelMenuShortName(choice),
      // The match surface deliberately carries the provider id, provider display
      // name, model id and the full "Provider / Model" label — never only the
      // possibly-truncated short model name — so provider and model-id searches
      // resolve while the rendered name stays short.
      label: [choice.provider, choice.providerLabel, choice.model, choice.label].filter(Boolean).join(' '),
    })), showSearch ? query.trim() : ''),
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
  /** Leave a drilled pane for the entry pane, handing the keyboard back to it.
   *  A root entry refocuses the cell that opened the pane; a search-first
   *  (model) entry refocuses that pane's own intent. */
  const back = (from: Pane): void => {
    paneFocus.current = initialPane === 'root' ? from : 'drill'
    setPane(initialPane)
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
    // A consumer may open directly at the model pane (a search-first picker).
    // The root cells stay reachable with Escape; the default stays 'root' and
    // leaves the trigger's keyboard focus intent untouched.
    setPane(initialPane)
    if (initialPane === 'model') paneFocus.current = 'drill'
    setQuery('')
    setHighlightedIndex(null)
  }, [open, initialPane])
  // A consumer that becomes busy/locked after opening must not leave actions
  // available. With closeOnDisable a true value also closes the card (the
  // trigger owns the disabled look); without it the open card stays mounted
  // and only dismissal stays available.
  useEffect(() => {
    if (disabled && open && closeOnDisable) changeOpen(false)
  }, [disabled, open, closeOnDisable])
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      changeOpen(false)
    }
    /* The span's React onKeyDown already sees Escape from inside the menu —
     * portal rows bubble through the React tree. What it cannot see is focus
     * that is no longer in the tree at all: a disabled rise ejects the
     * focused row's focus to document.body, and Escape there never reaches
     * the span. This listener keeps dismissal reachable for that focus; the
     * openRef check means it never double-acts after the in-tree handler. */
    const escapeOutside = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      if (!openRef.current) return
      event.preventDefault()
      if (pane !== initialPane) back(pane)
      else close(true)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', escapeOutside)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', escapeOutside)
    }
  }, [open, onOpenChange, pane, initialPane])
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
  /* Scroll when the model pane opens, or when a keyboard arrow moves the
   * highlight. `visibleModels` is a new array whenever a directory snapshot
   * replaces `current` and the caller rebuilds equivalent choices — depending
   * on that array jumped scrollTop. Search may replace the rows; a model
   * click must not. */
  const modelPaneOpen = open && pane === 'model'
  const scrollSignal = !modelPaneOpen ? 'closed' : keyNav === 0 ? 'open' : `key:${keyNav}`
  const scrollSignalRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!modelPaneOpen || activeModelIndex < 0) {
      if (!modelPaneOpen) scrollSignalRef.current = null
      return
    }
    if (scrollSignalRef.current === scrollSignal) return
    scrollSignalRef.current = scrollSignal
    itemRefs.current[leading.length + activeModelIndex]?.scrollIntoView({ block: 'nearest' })
  }, [modelPaneOpen, scrollSignal, activeModelIndex, leading.length])
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
      setMenuPos(prev => (prev && prev.left === x && prev.top === y ? prev : { left: x, top: y }))
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
    // Escape dismisses even while actions are disabled — a save lock gates
    // selection, not closing. A drilled pane backs out to the entry pane
    // first; the entry pane closes outright.
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      if (pane !== initialPane) back(pane)
      else close(true)
      return
    }
    if (disabled) return
    if (!open && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      const button = event.target instanceof Element ? event.target.closest('button') : null
      if (!(button instanceof HTMLButtonElement) || button.disabled || !rootRef.current?.contains(button)) return
      // Prevent the native Enter/Space click from opening a second time.
      event.preventDefault()
      paneFocus.current = 'model'
      requestOpen()
      return
    }
    if (!open) return
    if (pane === 'model' && showSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      if (visibleModels.length > 0) {
        setHighlightedIndex((activeModelIndex + (event.key === 'ArrowDown' ? 1 : -1) + visibleModels.length) % visibleModels.length)
        setKeyNav(n => n + 1)
        searchRef.current?.focus()
      }
      return
    }
    if (pane === 'model' && showSearch && event.target instanceof HTMLInputElement && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
      if (event.key === 'Tab' && visibleModels.length === 0) return
      event.preventDefault()
      const highlighted = visibleModels[activeModelIndex]
      // A submission in progress must not be repeated by Enter/Tab.
      if (highlighted && !busy) { onPick({ provider: highlighted.provider, model: highlighted.model }); if (closeOnPick) close(true) }
      return
    }
    if (event.key === 'Tab') {
      if (event.shiftKey) {
        event.preventDefault()
        if (pane !== initialPane) back(pane)
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
    const related = event.relatedTarget
    // A target already detached from the document (the menu re-rendering the
    // focused row) is inside for this purpose — never a dismissal.
    if (related instanceof Node
      && (rootRef.current?.contains(related) || menuRef.current?.contains(related)
        || !related.isConnected)) return
    // Keep-open mode never closes on a blur that has no connected next focus:
    // disabling the picked row, or a blur whose target raced a re-render, is
    // not the user dismissing the card. Outside presses, Escape, and focus
    // landing in a real outside node still close.
    if (!closeOnPick && !(related instanceof Node)) return
    // Disabling the focused row while a selection is in flight blurs it with
    // no next target. That is not a dismissal — closing here unmounts the card.
    if (busy && related == null) return
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
        lang={language}
      >
        {menuHeader ? <div className="dsh-model-menu-header">{menuHeader}</div> : null}
        {pane === 'root' ? <>
          <button ref={itemRef()} type="button" role="menuitem" className="dsh-model-menu-cell" disabled={disabled} onClick={() => drill('model')}>
            <span className="dsh-model-menu-cellLabel">{modelLabel}</span>
            <span className="dsh-model-menu-cellValue">{modelValue}</span>
            <IconChevronRightOutlineRegular className="dsh-model-menu-cellChevron" />
          </button>
          {efforts.length > 0 && !reasoningSlider ? <button ref={itemRef()} type="button" role="menuitem" className="dsh-model-menu-cell" disabled={disabled} onClick={() => drill('effort')}>
            <span className="dsh-model-menu-cellLabel">{effortLabel}</span>
            <span className="dsh-model-menu-cellValue">{effortValue ?? effortRows.find(row => row.id === (selectedEffort ?? ''))?.name ?? defaultEffortLabel}</span>
            <IconChevronRightOutlineRegular className="dsh-model-menu-cellChevron" />
          </button> : null}
        </> : null}
        {pane === 'model' ? <>
          {showSearch ? <div className="dsh-model-menu-searchRow">
            <Input
              ref={searchRef}
              disabled={disabled}
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
            {query !== '' ? <button type="button" className="dsh-model-menu-searchClear" aria-label={clearSearchLabel} disabled={disabled}
              onClick={() => { setQuery(''); setHighlightedIndex(null); searchRef.current?.focus() }}>
              <IconCloseFillRegular />
            </button> : null}
          </div> : null}
          <div ref={groupsRef} id={`${id}-models`} className="dsh-model-menu-groups scrollable" role="menu" aria-label={modelLabel}
            hidden={filteredGroups.length === 0}>
            {leading.length > 0 ? <div className="dsh-model-menu-leading">
              {leading.map(item => (
                <button key={item.id} ref={itemRef()} type="button" role="menuitemradio" aria-checked={item.selected === true} disabled={disabled || busy}
                  className={`dsh-model-menu-option${item.selected === true ? ' dsh-model-menu-selected' : ''}`}
                  onClick={() => { if (disabled || busy) return; onPickLeading?.(item.id); if (closeOnPick) close(true) }}>
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
                    disabled={disabled || busy}
                    onFocus={() => setHighlightedIndex(index)}
                    data-highlighted={index === activeModelIndex ? '' : undefined}
                    className={`dsh-model-menu-option dsh-model-menu-modelOption${checked ? ' dsh-model-menu-selected' : ''}${index === activeModelIndex ? ' dsh-model-menu-optionActive' : ''}`}
                    onMouseMove={index === activeModelIndex ? undefined : () => {
                      if (showSearch) setHighlightedIndex(index)
                      else itemRefs.current[leading.length + index]?.focus()
                    }}
                    title={choice.label}
                    onClick={() => { if (disabled || busy) return; onPick({ provider: choice.provider, model: choice.model }); if (closeOnPick) close(true) }}
                  >
                    <span className="dsh-model-menu-optionCopy"><span className="dsh-model-menu-modelName">{modelMenuShortName(choice)}</span></span>
                    <span className="dsh-model-menu-check">{checked ? <IconCheckOutlineRegular /> : null}</span>
                  </button>
                })}
              </MenuGroup>
            ))}
          </div>
          {reasoningSlider && efforts.length > 0 && filteredGroups.length > 0
            ? <EffortSlider label={effortLabel} rows={effortRows} selected={selectedEffort ?? ''} disabled={disabled} busy={busy}
                onPick={value => onPickEffort?.(value)} />
            : null}
          {filteredGroups.length === 0 ? <div className="dsh-model-menu-empty" role="status">{emptyLabel}</div> : null}
        </> : null}
        {pane === 'effort' ? <>
          {effortRows.map(row => {
            const checked = (selectedEffort ?? '') === row.id
            return <button key={row.id || '__default'} ref={itemRef()} type="button" role="menuitemradio" aria-checked={checked} disabled={disabled || busy}
              className={`dsh-model-menu-option${checked ? ' dsh-model-menu-selected' : ''}`}
              onClick={() => { if (disabled || busy) return; onPickEffort?.(row.id || undefined); if (closeOnPick) close(true) }}>
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
    ? cloneElement(anchor, { 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? `${id}-menu` : undefined, 'aria-disabled': disabled || undefined })
    : anchor
  return <span ref={rootRef} className={`dsh-model-menu-root${className ? ` ${className}` : ''}`} onKeyDown={onKeyDown} onBlur={onBlur}
    onClick={event => {
      if (disabled || event.defaultPrevented) return
      const button = event.target instanceof Element ? event.target.closest('button') : null
      if (!(button instanceof HTMLButtonElement) || button.disabled || !rootRef.current?.contains(button)) return
      requestOpen()
    }}
    onMouseDown={event => { if (event.target instanceof Element && menuRef.current?.contains(event.target) && event.target.closest('button') !== null) event.preventDefault() }}>
    {trigger}{menu}
  </span>
}

/**
 * Discrete reasoning-effort slider shown under the model list in enhanced mode.
 *
 * A native range input (`step=1`) over exactly the rows the caller supplies —
 * the default row plus each effort the selected model advertises — so it can
 * never invent a level. It previews locally while dragging or arrowing and
 * commits only when the gesture ends (pointer up, key up, or blur), so a drag
 * does not write on every step. The menu stays open, so adjusting the effort
 * never loses the model selection or the search query.
 *
 * The input itself stays the entire interaction and accessibility surface —
 * keyboard, ARIA, disabled and the native step snapping all come from it —
 * while the track, gradient fill and thumb below are decorative layers painted
 * from the `--_p` percentage the preview position sets on the rail. Value
 * changes only update that custom property, so the CSS transitions animate
 * between levels without remounting nodes or restarting an animation.
 */
function EffortSlider(props: {
  readonly label: string
  readonly rows: ReadonlyArray<{ id: string; name: string }>
  readonly selected: string
  readonly disabled?: boolean
  readonly busy?: boolean
  readonly onPick: (effort: string | undefined) => void
}) {
  const { label, rows, selected, disabled = false, busy = false, onPick } = props
  const active = Math.max(0, rows.findIndex(row => row.id === selected))
  const [position, setPosition] = useState(active)
  const positionRef = useRef(position)
  // A committed selection from the owner resets the preview.
  useEffect(() => { positionRef.current = active; setPosition(active) }, [active])
  const preview = (next: number): void => {
    positionRef.current = next
    setPosition(next)
  }
  // Commit once per gesture: pointer up, key up, or leaving the control. A
  // submission already in flight must not be repeated.
  const commit = (): void => {
    if (disabled || busy) return
    const row = rows[positionRef.current]
    if (row !== undefined) onPick(row.id === '' ? undefined : row.id)
  }
  const max = Math.max(0, rows.length - 1)
  const percent = max > 0 ? Math.round((position / max) * 100) : 0
  return <div className="dsh-model-menu-sliderGroup" role="group" aria-label={label}>
    <div className="dsh-model-menu-sliderHead">
      <span className="dsh-model-menu-sliderTitle">{label}</span>
      <span className="dsh-model-menu-sliderValue">{rows[position]?.name}</span>
    </div>
    <div className="dsh-model-menu-sliderRail" style={{ '--_p': percent } as CSSProperties}>
      <input
        type="range"
        className="dsh-model-menu-sliderInput"
        min={0}
        max={max}
        step={1}
        value={position}
        disabled={disabled}
        aria-label={label}
        aria-disabled={disabled || busy || undefined}
        aria-valuetext={rows[position]?.name}
        onChange={event => {
          // Read the event target, not currentTarget: a synthetic change event may
          // carry a detached `{ value }` target, while a real range event targets
          // the input itself. Both must preview the same position.
          const value = Number((event.target as HTMLInputElement).value)
          if (Number.isFinite(value)) preview(value)
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="dsh-model-menu-sliderTrack" aria-hidden="true">
        <span className="dsh-model-menu-sliderFill"><span className="dsh-model-menu-sliderFillBar" /></span>
        <span className="dsh-model-menu-sliderNodes">
          {rows.map((row, index) => (
            <span key={row.id || '__default'} data-covered={index <= position ? '' : undefined}
              className="dsh-model-menu-sliderNode" style={{ '--_n': max > 0 ? Math.round((index / max) * 100) : 0 } as CSSProperties} />
          ))}
        </span>
      </span>
      <span className="dsh-model-menu-sliderThumb" aria-hidden="true" />
    </div>
  </div>
}

/**
 * ModelMenu styles, transcribed from the official ModelSelect.module.css (the
 * published dsh-client-ui-model-selection bundle): card capped at
 * min(360px, 100vh - 96px), 34px option cells at 13/18 with 5px 7px padding,
 * 34px root cells at 13/20, a borderless 12px search row with a clear button,
 * sticky group headings (MenuGroup's own CSS), and the l1-stroke prominent
 * elevation at portal z-index 1100. The trigger mirrors the composer's 28px
 * model pill, chevron rotating open. MenuSurface paints fill and backdrop.
 * Only allowlisted --dsw- and --ds- theme tokens may appear here — a literal
 * color is a bug.
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
.dsh-model-menu-trigger:focus-visible:not([data-selection-focus]) { box-shadow: 0 0 0 var(--dsw-focus-ring-width) var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.dsh-model-menu-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-model-menu-triggerLabel { text-overflow: ellipsis; white-space: nowrap; min-width: 0; overflow: hidden; }
.dsh-model-menu-triggerEffort { text-overflow: ellipsis; white-space: nowrap; min-width: 0; color: var(--dsw-alias-label-caption); flex-shrink: 1000; overflow: hidden; }
.dsh-model-menu-chevron { color: var(--dsw-alias-label-caption); flex: none; transition: transform var(--ds-transition-duration) var(--ds-ease-in-out); }
.dsh-model-menu-chevronOpen { transform: rotate(180deg); }
/* Portal overlay: the host publishes no z-index token, so the card keeps the
 * native menu layer's 1100 verbatim. */
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
.dsh-model-menu-header { flex: none; padding: 2px 2px 4px; }
.dsh-model-menu-searchRow { flex-shrink: 0; margin: 2px 0 3px; position: relative; }
.dsh-model-menu-searchRow .dsh-model-menu-search { border-radius: var(--dsw-radius-md); background: none; border: 0 solid transparent; height: auto; padding: 5px 7px; display: flex; }
.dsh-model-menu-searchRow .dsh-model-menu-search:focus-within { border-color: transparent; }
.dsh-model-menu-searchWithQuery { padding-right: 34px; }
.dsh-model-menu-searchRow .dsh-model-menu-search input { padding: 0; font-size: 12px; line-height: normal; }
.dsh-model-menu-searchRow .dsh-model-menu-search input::placeholder { color: var(--dsw-alias-label-caption); }
/* The clear button is a circle by geometry (border-radius: 50%), a shape the
 * radius token scale does not describe. */
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
/* Discrete reasoning-effort slider under the model list (enhanced mode).
 * The painted control is layered over a fully functional native range input:
 * the input stays on top, transparent, and owns pointer/keyboard/ARIA, while
 * the decorative track, fill and thumb render beneath it at pointer-events:
 * none. Position lives in one custom property (--_p, 0–100) on the rail, so
 * the only animated work a level change triggers is a clip-path/left
 * transition — no keyframes, no element churn. */
.dsh-model-menu-sliderGroup { border-top: 0.5px solid var(--dsw-alias-border-l2); flex: none; margin-top: 4px; padding: 6px 8px 8px; }
.dsh-model-menu-sliderHead { align-items: baseline; justify-content: space-between; gap: 8px; margin: 0 2px 4px; display: flex; }
.dsh-model-menu-sliderTitle { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-model-menu-sliderValue { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; line-height: 20px; transition: color var(--ds-transition-duration) var(--ds-ease-in-out); }
.dsh-model-menu-sliderRail { position: relative; direction: ltr; height: 38px; margin-top: 2px; }
.dsh-model-menu-sliderRail:has(:disabled) { opacity: 0.45; }
.dsh-model-menu-sliderInput {
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  border: 0;
  cursor: pointer;
  direction: ltr;
  opacity: 0;
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  z-index: 1;
  touch-action: pan-y;
}
.dsh-model-menu-sliderInput:disabled { cursor: default; }
/* The transparent input must keep the painted thumb's geometry: an
 * appearance:none webkit thumb defaults to 16px, which would shift the
 * end-point positions 7px off the decorative 30px disc and misplace the
 * native drag hit target. Track gets the full rail height so the whole band
 * maps to values identically. */
.dsh-model-menu-sliderInput::-webkit-slider-runnable-track { width: 100%; height: 100%; }
.dsh-model-menu-sliderInput::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 30px; height: 30px; margin: 0; }
.dsh-model-menu-sliderInput::-moz-range-track { width: 100%; height: 100%; }
.dsh-model-menu-sliderInput::-moz-range-thumb { width: 30px; height: 30px; margin: 0; border: 0; }
.dsh-model-menu-sliderTrack {
  pointer-events: none;
  border-radius: 999px;
  width: 100%;
  height: 26px;
  background: var(--dsw-alias-interactive-bg-hover);
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2);
  position: absolute;
  inset-inline: 0;
  top: 50%;
  transform: translateY(-50%);
  /* No overflow:hidden — it would clip the fill's drop-shadow glow; the bar's
   * own clip-path already supplies the rounded reveal shape. */
}
/* The accent ramp paints the full track width once and is revealed by an
 * animated clip-path, so raising the effort unwraps more of the spectrum
 * instead of squashing the same gradient into a narrower bar. The glow lives
 * on the un-clipped parent: a filter on the clipped element itself would be
 * clipped away with it. */
.dsh-model-menu-sliderFill {
  display: block;
  height: 100%;
  filter: drop-shadow(0 0 5px var(--dsw-alias-state-business-primary));
  transition: filter var(--ds-transition-duration) var(--ds-ease-in-out);
}
.dsh-model-menu-sliderInput:hover:not(:disabled) ~ .dsh-model-menu-sliderTrack .dsh-model-menu-sliderFill,
.dsh-model-menu-sliderInput:active:not(:disabled) ~ .dsh-model-menu-sliderTrack .dsh-model-menu-sliderFill {
  filter: drop-shadow(0 0 9px var(--dsw-alias-state-business-primary));
}
/* The fill stops at the thumb's center, not at the track edge — at a 30px
 * thumb the end stops sit 15px in from each side, matching the node dots. */
.dsh-model-menu-sliderFillBar {
  display: block;
  height: 100%;
  background: linear-gradient(90deg,
    var(--dsw-alias-state-business-primary),
    var(--dsw-alias-state-success-primary),
    var(--dsw-alias-state-warn-primary),
    var(--dsw-alias-state-error-primary));
  clip-path: inset(0 calc(100% - 15px - (100% - 30px) * var(--_p, 0) / 100) 0 0 round 999px);
  transition: clip-path var(--ds-transition-duration) var(--ds-ease-in-out);
}
/* Stop dots: one per declared row (default + every advertised effort), evenly
 * spread across the band between the two thumb-center extremes (inset 15px,
 * i.e. half the 30px thumb). --_n is 0-100 along that band. A covered dot
 * reads as a pale pin through the gradient; an uncovered one stays a neutral
 * notch on the empty track. */
.dsh-model-menu-sliderNodes {
  pointer-events: none;
  display: block;
  position: absolute;
  inset-inline: 15px;
  inset-block: 0;
}
.dsh-model-menu-sliderNode {
  pointer-events: none;
  box-sizing: border-box;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 35%, transparent);
  position: absolute;
  left: calc(var(--_n, 0) * 1%);
  top: 50%;
  transform: translate(-50%, -50%);
  transition: background-color var(--ds-transition-duration) var(--ds-ease-in-out),
    transform var(--ds-transition-duration) var(--ds-ease-in-out);
}
.dsh-model-menu-sliderNode[data-covered] { background: color-mix(in srgb, var(--dsw-alias-label-primary) 60%, transparent); }
.dsh-model-menu-sliderThumb {
  pointer-events: none;
  box-sizing: border-box;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  background: var(--dsw-alias-button-primary-fill);
  border: 0.5px solid var(--dsw-alias-border-l4);
  box-shadow: 0 0 0 3px var(--dsw-alias-interactive-bg-hover), var(--dsw-elevation-soft);
  position: absolute;
  left: calc((100% - 30px) * var(--_p, 0) / 100);
  top: 50%;
  transform: translateY(-50%) scale(0.92);
  transition: left var(--ds-transition-duration) var(--ds-ease-in-out),
    transform var(--ds-transition-duration) var(--ds-ease-in-out),
    box-shadow var(--ds-transition-duration) var(--ds-ease-in-out);
}
.dsh-model-menu-sliderInput:hover:not(:disabled) ~ .dsh-model-menu-sliderThumb { transform: translateY(-50%) scale(1); }
.dsh-model-menu-sliderInput:active:not(:disabled) ~ .dsh-model-menu-sliderThumb {
  transform: translateY(-50%) scale(1.1);
  box-shadow: 0 0 0 4px var(--dsw-alias-interactive-bg-hover), 0 0 12px var(--dsw-alias-state-business-primary);
}
.dsh-model-menu-sliderInput:focus-visible ~ .dsh-model-menu-sliderThumb {
  box-shadow: 0 0 0 3px var(--dsw-alias-interactive-bg-hover),
    0 0 0 calc(3px + var(--dsw-focus-ring-width)) var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
@media (prefers-reduced-motion: reduce) {
  .dsh-model-menu-sliderFill, .dsh-model-menu-sliderFillBar, .dsh-model-menu-sliderThumb,
  .dsh-model-menu-sliderNode, .dsh-model-menu-sliderValue { transition: none; }
}
`
