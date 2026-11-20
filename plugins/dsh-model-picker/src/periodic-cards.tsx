/**
 * Periodic-table style card grid surface for `@klarkxy/dsh-model-picker`.
 *
 * Layout per card:
 *   [01 · dot]          [Provider ▾]
 *          Ne  (or Gr 4.6)
 *         Gemini 4 Neon
 *   [  L  |  M  |  H  |  xH  ]
 *
 * Interactions:
 * - Click card center: pick model with NO explicit reasoning effort (`undefined`).
 * - Type anywhere (or in the toolbar filter): live-filter cards. Enter picks the
 *   first match, ArrowDown focuses the grid, Escape clears the query first.
 * - Right-click a card: context menu (favorite, move to front/end, rename,
 *   restore symbol, copy model ID, hide). Favorites pin to the front; hidden
 *   cards reappear dimmed via the toolbar toggle.
 * - Click a bottom effort cell: pick model + effort in one click (click again to clear).
 * - Click top-right provider trigger: open channel menu to switch provider for this model.
 * - Double-click short symbol: inline rename (clear to restore preset).
 * - Drag & drop: left/right 28% inserts before/after; center 44% swaps in place.
 *   Drops run on the visible keys and merge back into the full arranged order
 *   slot-for-slot, so filtering or hiding never strands non-visible cards.
 * - Width slider adjusts `--_card-w` live and persists locally.
 * - Entrance, hover, pop-in and reorder motion is CSS/WAAPI FLIP; all of it
 *   shuts off under `prefers-reduced-motion`.
 */
import {
  cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Button, Input, MenuItemButton, MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelMenuEffortLabel, type ModelMenuChoice } from '@klarkxy/dsh-model-route'
import type { ModelPickerLeadingItem } from '@klarkxy/dsh-model-route/model-picker'
import { compactEffortLabel, type ModelFamily } from './model-presets.ts'
import {
  applyCardDrop, buildPeriodicCards, CARD_WIDTH_MAX, CARD_WIDTH_MIN, dropModeFromRatio,
  filterPeriodicCards, mergeSubsetOrder, moveCardKey, toggleKey,
  type CardDropMode, type PeriodicCardEntry, type PeriodicPrefs,
} from './periodic-store.ts'

export interface PeriodicCopy {
  readonly viewCards: string
  readonly viewList: string
  readonly widthNarrow: string
  readonly widthWide: string
  readonly widthAria: string
  readonly resetOrder: string
  readonly providerMenuTitle: string
  readonly providerTriggerTitle: string
  readonly swapBadge: string
  readonly cardBodyTitle: string
  readonly shortEditTitle: string
  readonly effortCellTitle: string
  readonly filterPlaceholder: string
  readonly filterClear: string
  readonly filterEmpty: string
  readonly contextMenuLabel: string
  readonly menuFavorite: string
  readonly menuUnfavorite: string
  readonly menuMoveFirst: string
  readonly menuMoveLast: string
  readonly menuRename: string
  readonly menuResetShort: string
  readonly menuCopyId: string
  readonly menuHide: string
  readonly menuUnhide: string
  readonly hiddenToggle: string
  readonly favoriteMark: string
  readonly hint: string
}

/**
 * A symbol single-click may still become a double-click rename, so the pick
 * waits out this window; the rename cancels it. Exported for tests to shrink.
 */
export const SYMBOL_PICK_DELAY_MS = 240

export function periodicCopy(locale: string | undefined): PeriodicCopy {
  const zh = locale?.toLowerCase().startsWith('zh') === true
  return zh
    ? {
        viewCards: '卡片',
        viewList: '列表',
        widthNarrow: '窄',
        widthWide: '宽',
        widthAria: '卡片宽度',
        resetOrder: '恢复默认布局',
        providerMenuTitle: '供应商',
        providerTriggerTitle: '切换供应商',
        swapBadge: '交换',
        cardBodyTitle: '选择模型，不指定思考强度',
        shortEditTitle: '双击修改简称',
        effortCellTitle: '再点一次取消',
        filterPlaceholder: '输入以筛选',
        filterClear: '清除筛选',
        filterEmpty: '没有匹配的模型',
        contextMenuLabel: '卡片操作',
        menuFavorite: '收藏',
        menuUnfavorite: '取消收藏',
        menuMoveFirst: '移到最前',
        menuMoveLast: '移到最后',
        menuRename: '修改简称',
        menuResetShort: '恢复默认简称',
        menuCopyId: '复制模型 ID',
        menuHide: '隐藏',
        menuUnhide: '取消隐藏',
        hiddenToggle: '已隐藏 {n}',
        favoriteMark: '已收藏',
        hint: '输入即可筛选 · 右键卡片管理 · 拖动调整顺序',
      }
    : {
        viewCards: 'Cards',
        viewList: 'List',
        widthNarrow: 'Narrow',
        widthWide: 'Wide',
        widthAria: 'Card width',
        resetOrder: 'Reset layout',
        providerMenuTitle: 'Provider',
        providerTriggerTitle: 'Switch provider',
        swapBadge: 'Swap',
        cardBodyTitle: 'Select model without setting reasoning effort',
        shortEditTitle: 'Double-click to rename',
        effortCellTitle: 'Click again to clear',
        filterPlaceholder: 'Type to filter',
        filterClear: 'Clear filter',
        filterEmpty: 'No matching models',
        contextMenuLabel: 'Card actions',
        menuFavorite: 'Favorite',
        menuUnfavorite: 'Unfavorite',
        menuMoveFirst: 'Move to front',
        menuMoveLast: 'Move to end',
        menuRename: 'Rename symbol',
        menuResetShort: 'Restore default symbol',
        menuCopyId: 'Copy model ID',
        menuHide: 'Hide',
        menuUnhide: 'Unhide',
        hiddenToggle: 'Hidden ({n})',
        favoriteMark: 'Favorited',
        hint: 'Type to filter · Right-click a card for more · Drag to reorder',
      }
}

function familyTone(family: ModelFamily): string {
  switch (family) {
    case 'gemini': return 'business'
    case 'deepseek':
    case 'cn': return 'success'
    case 'grok':
    case 'openai': return 'warn'
    default: return 'muted'
  }
}

function providerCaption(route: ModelMenuChoice, allRoutes: readonly ModelMenuChoice[]): string {
  const base = route.providerLabel || route.provider
  const duplicates = allRoutes.filter(item => (item.providerLabel || item.provider) === base)
  return duplicates.length > 1 ? `${base} (${route.model})` : base
}

export interface PeriodicCardMenuProps {
  readonly locale?: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly anchor: ReactNode
  readonly choices: readonly ModelMenuChoice[]
  readonly selected?: { readonly provider: string; readonly model: string }
  readonly selectedEffort?: string
  readonly leading?: readonly ModelPickerLeadingItem[]
  readonly onPickLeading?: (id: string) => void
  /** Atomic model + effort pick; `effort === undefined` explicitly omits reasoningEffort. */
  readonly onPickCard: (route: { provider: string; model: string }, effort: string | undefined) => void
  readonly menuHeader?: ReactNode
  readonly disabled?: boolean
  readonly busy?: boolean
  readonly emptyLabel: string
  readonly modelLabel: string
  readonly listClassName?: string
  readonly prefs: PeriodicPrefs
  readonly onPrefsChange: (updater: (prev: PeriodicPrefs) => PeriodicPrefs) => void
}

export function PeriodicCardMenu(props: PeriodicCardMenuProps): ReactNode {
  const {
    locale, open, onOpenChange, anchor, choices, selected, selectedEffort,
    leading = [], onPickLeading, onPickCard, menuHeader, disabled = false, busy = false,
    emptyLabel, modelLabel, listClassName, prefs, onPrefsChange,
  } = props

  const copy = useMemo(() => periodicCopy(locale), [locale])
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const filterInputRef = useRef<HTMLInputElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const cardElsRef = useRef(new Map<string, HTMLElement>())
  /* Last committed grid layout (key order + grid-relative rects) for FLIP. */
  const layoutRef = useRef<{ keys: readonly string[]; rects: Map<string, { x: number; y: number }> }>(
    { keys: [], rects: new Map() },
  )
  const openRef = useRef(open)
  openRef.current = open
  const id = useId()

  const [panelPos, setPanelPos] = useState<{ left: number; top: number; placement: 'above' | 'below' } | null>(null)
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [dragSrcIndex, setDragSrcIndex] = useState<number | null>(null)
  const [dropState, setDropState] = useState<{ index: number; mode: CardDropMode } | null>(null)
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState<{ left: number; top: number } | null>(null)
  /* Rename-cancel flag: a ref (not state) so the flag is visible to the blur
   * commit even when Escape and the unmount-triggered blur share one batch. */
  const editingCancelledRef = useRef(false)
  /* A symbol single-click may still turn into a double-click rename; the
   * selection is held for the double-click window and cancelled on rename. */
  const pendingPickRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* The full arranged list (hidden included) is the key space drag drops and
   * front/back moves merge back into; `cards`/`visibleCards` are its views. */
  const allCards = useMemo(
    () => buildPeriodicCards(choices, prefs, selected, { showHidden: true }),
    [choices, prefs, selected],
  )
  const cards = useMemo(
    () => (showHidden ? allCards : buildPeriodicCards(choices, prefs, selected)),
    [allCards, showHidden, choices, prefs, selected],
  )
  const visibleCards = useMemo(() => filterPeriodicCards(cards, query), [cards, query])
  const fullArrangedKeys = useMemo(() => allCards.map(card => card.canonicalKey), [allCards])
  const hiddenCount = useMemo(
    () => allCards.reduce((count, card) => count + (card.hidden ? 1 : 0), 0),
    [allCards],
  )
  const contextCard = contextMenu !== null
    ? allCards.find(card => card.canonicalKey === contextMenu.key) ?? null
    : null

  const gated = disabled || busy

  const cancelPendingPick = (): void => {
    if (pendingPickRef.current !== null) {
      clearTimeout(pendingPickRef.current)
      pendingPickRef.current = null
    }
  }
  const schedulePendingPick = (route: { provider: string; model: string }): void => {
    cancelPendingPick()
    const delay = (globalThis as { __dshModelPickerPickDelay?: number }).__dshModelPickerPickDelay ?? SYMBOL_PICK_DELAY_MS
    pendingPickRef.current = setTimeout(() => {
      pendingPickRef.current = null
      onPickCard(route, undefined)
    }, delay)
  }
  useEffect(() => cancelPendingPick, [])

  useEffect(() => {
    if (!open) {
      setOpenMenuKey(null)
      setEditingKey(null)
      editingCancelledRef.current = false
      cancelPendingPick()
      setDragSrcIndex(null)
      setDropState(null)
      setQuery('')
      setShowHidden(false)
      setContextMenu(null)
    }
  }, [open])

  // A lock rising mid-interaction must cancel any in-flight drag or rename:
  // the contract says `disabled`/`busy` stop every menu action.
  useEffect(() => {
    if (gated) {
      setOpenMenuKey(null)
      setEditingKey(null)
      editingCancelledRef.current = false
      cancelPendingPick()
      setDragSrcIndex(null)
      setDropState(null)
      setContextMenu(null)
    }
  }, [gated])

  // The filter grabs focus on open: typing anywhere already routes there, and
  // keyboard users land on the most common next action.
  useEffect(() => {
    if (open) filterInputRef.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      // A mousedown outside the open context menu closes just the menu; only a
      // mousedown fully outside the panel closes the panel itself.
      if (contextMenu !== null && !contextMenuRef.current?.contains(target)) setContextMenu(null)
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      onOpenChange(false)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      if (!openRef.current) return
      event.preventDefault()
      if (contextMenu !== null) { setContextMenu(null); return }
      if (editingKey !== null) { setEditingKey(null); return }
      if (openMenuKey !== null) { setOpenMenuKey(null); return }
      if (query !== '') { setQuery(''); return }
      onOpenChange(false)
    }
    // Type-to-filter: printable keys from a non-editable target append to the
    // query and focus the input (the composer textarea is editable, so its
    // keystrokes never reach this path). Backspace trims the query.
    const onTypeKey = (event: KeyboardEvent): void => {
      if (!openRef.current || event.defaultPrevented || event.isComposing) return
      if (gated || editingKey !== null || contextMenu !== null) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      // Space keeps activating focused buttons and cards; it only extends a
      // query that is already being typed.
      if (event.key === ' ' && (query === '' || (target instanceof Element && target.closest('button, [role]') !== null))) return
      const editable = target instanceof Element
        && (target.closest('input, textarea, select') !== null
          || (target instanceof HTMLElement && target.isContentEditable))
      if (editable) return
      if (event.key.length === 1) {
        event.preventDefault()
        setQuery(prev => prev + event.key)
        filterInputRef.current?.focus({ preventScroll: true })
      } else if (event.key === 'Backspace' && query !== '') {
        event.preventDefault()
        setQuery(prev => prev.slice(0, -1))
      }
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onEscape)
    document.addEventListener('keydown', onTypeKey)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onEscape)
      document.removeEventListener('keydown', onTypeKey)
    }
  }, [open, onOpenChange, editingKey, openMenuKey, contextMenu, query, gated])

  useLayoutEffect(() => {
    if (!open) { setPanelPos(null); return }
    const place = (): void => {
      const trigger = rootRef.current
      const panel = panelRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const pw = panel?.offsetWidth ?? 0
      const ph = panel?.offsetHeight ?? 0
      const margin = 12
      let left = rect.right - pw
      let top = rect.top - 8 - ph
      let placement: 'above' | 'below' = 'above'
      if (pw > 0) left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - pw - margin))
      if (ph > 0) {
        if (top < margin && rect.bottom + 8 + ph <= window.innerHeight - margin) {
          top = rect.bottom + 8
          placement = 'below'
        }
        top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - ph - margin))
      }
      setPanelPos(prev => (prev && prev.left === left && prev.top === top && prev.placement === placement
        ? prev
        : { left, top, placement }))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, cards.length, prefs.cardWidth])

  // Measure the freshly mounted context menu, clamp it inside the panel, and
  // hand focus to its first enabled item for keyboard users.
  useLayoutEffect(() => {
    if (!contextMenu) { setContextMenuPos(null); return }
    const menu = contextMenuRef.current
    const panel = panelRef.current
    if (menu && panel) {
      const left = Math.min(Math.max(contextMenu.x, 0), Math.max(0, panel.clientWidth - menu.offsetWidth))
      const top = Math.min(Math.max(contextMenu.y, 0), Math.max(0, panel.clientHeight - menu.offsetHeight))
      setContextMenuPos({ left, top })
    } else {
      setContextMenuPos({ left: contextMenu.x, top: contextMenu.y })
    }
    menu?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus()
  }, [contextMenu])

  // FLIP: record every card's grid-relative rect after each commit; when the
  // visible key sequence changed, play cards that existed before from their
  // old spot to their new one. Pure width changes keep the same sequence and
  // never animate; jsdom has no `animate`/`matchMedia` and skips everything.
  useLayoutEffect(() => {
    const grid = gridRef.current
    const keys = visibleCards.map(card => card.canonicalKey)
    const rects = new Map<string, { x: number; y: number }>()
    if (grid) {
      const gridRect = grid.getBoundingClientRect()
      for (const key of keys) {
        const el = cardElsRef.current.get(key)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        rects.set(key, {
          x: rect.left - gridRect.left + grid.scrollLeft,
          y: rect.top - gridRect.top + grid.scrollTop,
        })
      }
    }
    const prev = layoutRef.current
    const sequenceChanged = prev.keys.length !== keys.length || prev.keys.some((key, i) => key !== keys[i])
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (grid && sequenceChanged && prev.keys.length > 0 && !reduced) {
      for (const key of keys) {
        const before = prev.rects.get(key)
        const after = rects.get(key)
        const el = cardElsRef.current.get(key)
        if (!before || !after || !el || typeof el.animate !== 'function') continue
        const dx = before.x - after.x
        const dy = before.y - after.y
        if (dx === 0 && dy === 0) continue
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
        )
      }
    }
    layoutRef.current = { keys: grid ? keys : [], rects }
  })

  const commitAlias = (card: PeriodicCardEntry): void => {
    if (gated || editingCancelledRef.current) {
      setEditingKey(null)
      editingCancelledRef.current = false
      return
    }
    const trimmed = editingDraft.trim()
    onPrefsChange(prev => {
      const nextAliases = { ...prev.aliases }
      if (trimmed) nextAliases[card.canonicalKey] = trimmed.slice(0, 12)
      else delete nextAliases[card.canonicalKey]
      return { ...prev, aliases: nextAliases }
    })
    setEditingKey(null)
  }

  const pickProvider = (card: PeriodicCardEntry, route: ModelMenuChoice): void => {
    setOpenMenuKey(null)
    if (gated) return
    cancelPendingPick()
    onPrefsChange(prev => ({
      ...prev,
      providers: { ...prev.providers, [card.canonicalKey]: route.provider },
    }))
    // Switching to a route that already serves the current effort keeps that
    // effort instead of silently clearing it (and its per-route memory).
    const currentEffort = selectedEffort || undefined
    const supported = currentEffort && route.efforts.some(item => item.id === currentEffort)
      ? currentEffort
      : undefined
    onPickCard({ provider: route.provider, model: route.model }, supported)
  }

  const trigger = isValidElement<Record<string, unknown>>(anchor)
    ? cloneElement(anchor, {
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? `${id}-periodic` : undefined,
        'aria-disabled': disabled || undefined,
      })
    : anchor

  const hasCustomOrder = prefs.order.length > 0 || Object.keys(prefs.aliases).length > 0

  const panel = open && typeof document !== 'undefined'
    ? createPortal(
        <MenuSurface
          ref={panelRef}
          id={`${id}-periodic`}
          role="menu"
          aria-label={modelLabel}
          className={`dsh-model-picker dsh-model-picker-periodicSurface${listClassName ? ` ${listClassName}` : ''}`}
          style={{
            left: panelPos?.left,
            top: panelPos?.top,
            '--_card-w': `${prefs.cardWidth}px`,
          } as CSSProperties}
          data-placement={panelPos?.placement}
          onClick={() => { if (openMenuKey !== null) setOpenMenuKey(null) }}
        >
          <div className="dsh-model-picker-toolbar">
            <div className="dsh-model-picker-viewSwitch" role="group" aria-label={modelLabel}>
              <button
                type="button"
                className="dsh-model-picker-viewBtn"
                data-active=""
                aria-pressed={true}
                disabled={gated}
              >
                {copy.viewCards}
              </button>
              <button
                type="button"
                className="dsh-model-picker-viewBtn"
                aria-pressed={false}
                disabled={gated}
                onClick={() => { if (!gated) onPrefsChange(prev => ({ ...prev, viewMode: 'list' })) }}
              >
                {copy.viewList}
              </button>
            </div>
            <span className="dsh-model-picker-filterWrap">
              <Input
                ref={filterInputRef}
                type="search"
                className="dsh-model-picker-filter"
                placeholder={copy.filterPlaceholder}
                aria-label={copy.filterPlaceholder}
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const first = visibleCards[0]
                    if (!gated && first) {
                      cancelPendingPick()
                      onPickCard({ provider: first.activeRoute.provider, model: first.activeRoute.model }, undefined)
                    }
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    gridRef.current?.querySelector<HTMLElement>('.dsh-model-picker-cardBody')?.focus()
                  } else if (event.key === 'Escape' && query !== '') {
                    event.preventDefault()
                    setQuery('')
                  }
                }}
              />
              {query !== '' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="dsh-model-picker-filterClear"
                  aria-label={copy.filterClear}
                  onClick={() => {
                    setQuery('')
                    filterInputRef.current?.focus({ preventScroll: true })
                  }}
                >
                  ×
                </Button>
              ) : null}
            </span>
            <label className="dsh-model-picker-widthControl">
              <span>{copy.widthNarrow}</span>
              <input
                type="range"
                className="dsh-model-picker-widthSlider"
                aria-label={copy.widthAria}
                min={CARD_WIDTH_MIN}
                max={CARD_WIDTH_MAX}
                step={4}
                value={prefs.cardWidth}
                disabled={gated}
                onChange={event => {
                  if (gated) return
                  const width = Number((event.target as HTMLInputElement).value)
                  if (Number.isFinite(width)) onPrefsChange(prev => ({ ...prev, cardWidth: width }))
                }}
              />
              <span>{copy.widthWide}</span>
            </label>
            {hiddenCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="dsh-model-picker-hiddenToggle"
                aria-pressed={showHidden}
                disabled={gated}
                onClick={() => { if (!gated) setShowHidden(prev => !prev) }}
              >
                {copy.hiddenToggle.replace('{n}', String(hiddenCount))}
              </Button>
            ) : null}
            {hasCustomOrder ? (
              <button
                type="button"
                className="dsh-model-picker-resetBtn"
                disabled={gated}
                onClick={() => { if (!gated) onPrefsChange(prev => ({ ...prev, order: [], aliases: {} })) }}
              >
                {copy.resetOrder}
              </button>
            ) : null}
          </div>

          {menuHeader ? <div className="dsh-model-picker-periodicHeader">{menuHeader}</div> : null}

          {leading.length > 0 ? (
            <div className="dsh-model-picker-leadingRow">
              {leading.map(item => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={item.selected === true}
                  disabled={gated}
                  className={`dsh-model-picker-leadingChip${item.selected ? ' dsh-model-picker-leadingChipActive' : ''}`}
                  onClick={() => { if (!gated) onPickLeading?.(item.id) }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          {cards.length === 0 ? (
            <div className="dsh-model-picker-empty" role="status">{emptyLabel}</div>
          ) : visibleCards.length === 0 ? (
            <div className="dsh-model-picker-empty" role="status">{copy.filterEmpty}</div>
          ) : (
            <div
              ref={gridRef}
              className="dsh-model-picker-grid"
              data-testid="periodic-card-grid"
              onScroll={() => { if (contextMenu !== null) setContextMenu(null) }}
            >
              {visibleCards.map((card, index) => {
                const route = card.activeRoute
                const isActive = Boolean(
                  selected && selected.provider === route.provider && selected.model === route.model,
                )
                const isMenuOpen = openMenuKey === card.canonicalKey
                const isEditing = editingKey === card.canonicalKey
                const seq = String(card.position).padStart(2, '0')
                const dropMode = dropState?.index === index ? dropState.mode : undefined
                const activeEffort = isActive ? (selectedEffort || '') : ''

                return (
                  <div
                    key={card.canonicalKey}
                    ref={el => {
                      if (el) cardElsRef.current.set(card.canonicalKey, el)
                      else cardElsRef.current.delete(card.canonicalKey)
                    }}
                    className={`dsh-model-picker-card${isActive ? ' dsh-model-picker-cardActive' : ''}${isMenuOpen ? ' dsh-model-picker-cardMenuOpen' : ''}${dragSrcIndex === index ? ' dsh-model-picker-cardDragging' : ''}`}
                    data-card-key={card.canonicalKey}
                    data-drop={dropMode}
                    data-swap-label={copy.swapBadge}
                    data-hidden={card.hidden ? '' : undefined}
                    data-first-match={query !== '' && index === 0 ? '' : undefined}
                    style={{ '--_i': index } as CSSProperties}
                    draggable={!gated && !isEditing && !isMenuOpen}
                    onContextMenu={event => {
                      event.preventDefault()
                      if (gated || editingKey !== null) return
                      cancelPendingPick()
                      setOpenMenuKey(null)
                      const panel = panelRef.current
                      if (!panel) return
                      const panelRect = panel.getBoundingClientRect()
                      let x = event.clientX - panelRect.left
                      let y = event.clientY - panelRect.top
                      // Keyboard-triggered contextmenu reports 0,0: anchor at
                      // the card's bottom-left instead of the panel corner.
                      if (event.clientX === 0 && event.clientY === 0) {
                        const cardRect = event.currentTarget.getBoundingClientRect()
                        x = cardRect.left - panelRect.left
                        y = cardRect.bottom - panelRect.top
                      }
                      setContextMenu({ key: card.canonicalKey, x, y })
                    }}
                    onDragStart={event => {
                      if (gated || isEditing || isMenuOpen) { event.preventDefault(); return }
                      setDragSrcIndex(index)
                      setOpenMenuKey(null)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', card.canonicalKey)
                    }}
                    onDragEnd={() => {
                      setDragSrcIndex(null)
                      setDropState(null)
                    }}
                    onDragOver={event => {
                      if (gated || dragSrcIndex === null || dragSrcIndex === index) return
                      // Favorites always partition to the front, so a drop into
                      // the other partition cannot be honored: stay a
                      // non-target (no preventDefault, no drop cue).
                      if (visibleCards[dragSrcIndex]?.favorite !== card.favorite) return
                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5
                      const mode = dropModeFromRatio(ratio)
                      setDropState(prev => (prev && prev.index === index && prev.mode === mode ? prev : { index, mode }))
                    }}
                    onDragLeave={event => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDropState(prev => (prev?.index === index ? null : prev))
                      }
                    }}
                    onDrop={event => {
                      event.preventDefault()
                      if (gated || dragSrcIndex === null || dragSrcIndex === index) return
                      if (visibleCards[dragSrcIndex]?.favorite !== card.favorite) return
                      cancelPendingPick()
                      const rect = event.currentTarget.getBoundingClientRect()
                      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5
                      const mode = dropModeFromRatio(ratio)
                      // Reorder the visible keys, then merge them back into the
                      // full arrangement's slots so hidden/filtered-out cards
                      // never lose their place.
                      const visibleKeys = visibleCards.map(item => item.canonicalKey)
                      const nextVisible = applyCardDrop(visibleKeys, dragSrcIndex, index, mode)
                      onPrefsChange(prev => ({ ...prev, order: mergeSubsetOrder(fullArrangedKeys, nextVisible) }))
                      setDragSrcIndex(null)
                      setDropState(null)
                    }}
                  >
                    <div className="dsh-model-picker-cardHead">
                      <span className="dsh-model-picker-seqWrap">
                        <span className="dsh-model-picker-seq">{seq}</span>
                        <span className="dsh-model-picker-dot" data-tone={familyTone(card.family)} aria-hidden="true" />
                        {card.favorite
                          ? <span className="dsh-model-picker-fav" aria-label={copy.favoriteMark}>★</span>
                          : null}
                      </span>
                      <button
                        type="button"
                        className="dsh-model-picker-provBtn"
                        data-open={isMenuOpen ? '' : undefined}
                        disabled={gated}
                        title={copy.providerTriggerTitle}
                        aria-haspopup="listbox"
                        aria-expanded={isMenuOpen}
                        onClick={event => {
                          event.stopPropagation()
                          setOpenMenuKey(prev => (prev === card.canonicalKey ? null : card.canonicalKey))
                        }}
                      >
                        <span className="dsh-model-picker-provText">{providerCaption(route, card.routes)}</span>
                        <span className="dsh-model-picker-provCaret" aria-hidden="true">▾</span>
                      </button>
                    </div>

                    {isMenuOpen ? (
                      <div
                        className="dsh-model-picker-provMenu"
                        role="listbox"
                        aria-label={copy.providerMenuTitle}
                        onClick={event => event.stopPropagation()}
                      >
                        <div className="dsh-model-picker-provMenuLabel">{copy.providerMenuTitle}</div>
                        {card.routes.map(option => {
                          const optionActive = option.provider === route.provider && option.model === route.model
                          return (
                            <button
                              key={`${option.provider}\0${option.model}`}
                              type="button"
                              role="option"
                              aria-selected={optionActive}
                              className={`dsh-model-picker-provOption${optionActive ? ' dsh-model-picker-provOptionActive' : ''}`}
                              onClick={() => pickProvider(card, option)}
                            >
                              <span className="dsh-model-picker-provOptionLabel">{providerCaption(option, card.routes)}</span>
                              {optionActive ? <span aria-hidden="true">✓</span> : null}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}

                    <div
                      className="dsh-model-picker-cardBody"
                      role="menuitemradio"
                      aria-checked={isActive && activeEffort === ''}
                      aria-disabled={gated || undefined}
                      tabIndex={gated ? -1 : 0}
                      title={copy.cardBodyTitle}
                      onClick={event => {
                        // The rename double-click lands on the symbol line;
                        // its first click holds the pick for the double-click
                        // window so renaming never selects the model. Clicks
                        // anywhere else on the body pick immediately.
                        if (gated || isEditing) return
                        setOpenMenuKey(null)
                        if (event.detail > 1) { cancelPendingPick(); return }
                        const target = event.target
                        if (target instanceof Element && target.closest('.dsh-model-picker-symbolLine')) {
                          schedulePendingPick(route)
                          return
                        }
                        cancelPendingPick()
                        onPickCard({ provider: route.provider, model: route.model }, undefined)
                      }}
                      onKeyDown={event => {
                        if (gated || isEditing) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          cancelPendingPick()
                          onPickCard({ provider: route.provider, model: route.model }, undefined)
                        }
                      }}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          className="dsh-model-picker-shortInput"
                          value={editingDraft}
                          maxLength={12}
                          autoFocus
                          disabled={gated}
                          onClick={event => event.stopPropagation()}
                          onChange={event => setEditingDraft(event.target.value)}
                          onBlur={() => commitAlias(card)}
                          onKeyDown={event => {
                            event.stopPropagation()
                            if (event.key === 'Enter') commitAlias(card)
                            else if (event.key === 'Escape') { editingCancelledRef.current = true; setEditingKey(null) }
                          }}
                        />
                      ) : (
                        <div
                          className="dsh-model-picker-symbolLine"
                          title={copy.shortEditTitle}
                          onDoubleClick={event => {
                            event.stopPropagation()
                            if (gated) return
                            cancelPendingPick()
                            setOpenMenuKey(null)
                            editingCancelledRef.current = false
                            setEditingKey(card.canonicalKey)
                            setEditingDraft(card.short)
                          }}
                        >
                          <span className="dsh-model-picker-short">{card.short}</span>
                          {card.version ? <span className="dsh-model-picker-ver">{card.version}</span> : null}
                        </div>
                      )}
                      <div className="dsh-model-picker-full" title={route.label}>{card.fullName}</div>
                    </div>

                    {route.efforts.length > 0 ? (
                      <div
                        className="dsh-model-picker-effortBar"
                        style={{ gridTemplateColumns: `repeat(${route.efforts.length}, minmax(0, 1fr))` }}
                      >
                        {route.efforts.map(effort => {
                          const cellSelected = isActive && activeEffort === effort.id
                          const localized = modelMenuEffortLabel(effort, locale)
                          return (
                            <button
                              key={effort.id}
                              type="button"
                              disabled={gated}
                              aria-pressed={cellSelected}
                              className={`dsh-model-picker-effortCell${cellSelected ? ' dsh-model-picker-effortCellActive' : ''}`}
                              title={`${localized} · ${copy.effortCellTitle}`}
                              onClick={event => {
                                event.stopPropagation()
                                if (gated) return
                                cancelPendingPick()
                                setOpenMenuKey(null)
                                const nextEffort = cellSelected ? undefined : effort.id
                                onPickCard({ provider: route.provider, model: route.model }, nextEffort)
                              }}
                            >
                              {compactEffortLabel(effort)}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}

          {contextMenu !== null && contextCard !== null ? (
            <div
              ref={contextMenuRef}
              className="dsh-model-picker-cardMenu"
              role="menu"
              aria-label={copy.contextMenuLabel}
              style={{ left: contextMenuPos?.left ?? contextMenu.x, top: contextMenuPos?.top ?? contextMenu.y }}
              onClick={event => event.stopPropagation()}
              onContextMenu={event => event.preventDefault()}
              onKeyDown={event => {
                const menu = contextMenuRef.current
                if (!menu) return
                const items = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')]
                if (items.length === 0) return
                const current = items.indexOf(document.activeElement as HTMLButtonElement)
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  items[(current + 1) % items.length]?.focus()
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  items[(current - 1 + items.length) % items.length]?.focus()
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  items[0]?.focus()
                } else if (event.key === 'End') {
                  event.preventDefault()
                  items[items.length - 1]?.focus()
                }
              }}
            >
              {(() => {
                const card = contextCard
                const run = (action: () => void) => (): void => {
                  setContextMenu(null)
                  if (!gated) action()
                }
                const isFirst = fullArrangedKeys[0] === card.canonicalKey
                const isLast = fullArrangedKeys[fullArrangedKeys.length - 1] === card.canonicalKey
                const canCopyId = typeof navigator !== 'undefined'
                  && typeof navigator.clipboard?.writeText === 'function'
                return <>
                  <MenuItemButton
                    onSelect={run(() => onPrefsChange(prev => ({
                      ...prev,
                      favorites: toggleKey(prev.favorites, card.canonicalKey),
                    })))}
                  >
                    {card.favorite ? copy.menuUnfavorite : copy.menuFavorite}
                  </MenuItemButton>
                  <MenuItemButton
                    disabled={isFirst}
                    onSelect={run(() => onPrefsChange(prev => ({
                      ...prev,
                      order: moveCardKey(fullArrangedKeys, card.canonicalKey, 'first'),
                    })))}
                  >
                    {copy.menuMoveFirst}
                  </MenuItemButton>
                  <MenuItemButton
                    disabled={isLast}
                    onSelect={run(() => onPrefsChange(prev => ({
                      ...prev,
                      order: moveCardKey(fullArrangedKeys, card.canonicalKey, 'last'),
                    })))}
                  >
                    {copy.menuMoveLast}
                  </MenuItemButton>
                  <MenuItemButton
                    separatorBefore
                    onSelect={run(() => {
                      editingCancelledRef.current = false
                      setEditingKey(card.canonicalKey)
                      setEditingDraft(card.short)
                    })}
                  >
                    {copy.menuRename}
                  </MenuItemButton>
                  {card.customShort ? (
                    <MenuItemButton
                      onSelect={run(() => onPrefsChange(prev => {
                        const aliases = { ...prev.aliases }
                        delete aliases[card.canonicalKey]
                        return { ...prev, aliases }
                      }))}
                    >
                      {copy.menuResetShort}
                    </MenuItemButton>
                  ) : null}
                  {canCopyId ? (
                    <MenuItemButton
                      onSelect={run(() => {
                        void navigator.clipboard.writeText(card.activeRoute.model).catch(() => {})
                      })}
                    >
                      {copy.menuCopyId}
                    </MenuItemButton>
                  ) : null}
                  <MenuItemButton
                    separatorBefore
                    onSelect={run(() => onPrefsChange(prev => ({
                      ...prev,
                      hidden: toggleKey(prev.hidden, card.canonicalKey),
                    })))}
                  >
                    {card.hidden ? copy.menuUnhide : copy.menuHide}
                  </MenuItemButton>
                </>
              })()}
            </div>
          ) : null}

          <div className="dsh-model-picker-foot">
            <span>{copy.hint}</span>
          </div>
        </MenuSurface>,
        document.body,
      )
    : null

  return (
    <span
      ref={rootRef}
      className="dsh-model-menu-root dsh-model-picker"
      onClick={event => {
        if (disabled || event.defaultPrevented) return
        const button = event.target instanceof Element ? event.target.closest('button') : null
        if (!(button instanceof HTMLButtonElement) || button.disabled || !rootRef.current?.contains(button)) return
        onOpenChange(!open)
      }}
    >
      {trigger}
      {panel}
    </span>
  )
}
