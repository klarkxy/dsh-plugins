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
 * - Click a bottom effort cell: pick model + effort in one click (click again to clear).
 * - Click top-right provider trigger: open channel menu to switch provider for this model.
 * - Double-click short symbol: inline rename (clear to restore preset).
 * - Drag & drop: left/right 28% inserts before/after; center 44% swaps in place.
 * - Width slider adjusts `--_card-w` live and persists locally.
 */
import {
  cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelMenuEffortLabel, type ModelMenuChoice } from '@klarkxy/dsh-model-route'
import type { ModelPickerLeadingItem } from '@klarkxy/dsh-model-route/model-picker'
import { compactEffortLabel, type ModelFamily } from './model-presets.ts'
import {
  applyCardDrop, buildPeriodicCards, CARD_WIDTH_MAX, CARD_WIDTH_MIN, dropModeFromRatio,
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
  readonly effortNone: string
  readonly hint: string
}

export function periodicCopy(locale: string | undefined): PeriodicCopy {
  const zh = locale?.toLowerCase().startsWith('zh') === true
  return zh
    ? {
        viewCards: '卡片',
        viewList: '列表',
        widthNarrow: '窄',
        widthWide: '宽',
        widthAria: '调整卡片宽度',
        resetOrder: '重置顺序',
        providerMenuTitle: '选择供应商渠道',
        providerTriggerTitle: '切换供应商',
        swapBadge: '交换',
        cardBodyTitle: '点击选中模型（不传思考强度）',
        shortEditTitle: '双击修改简称',
        effortCellTitle: '点击选定思考强度（再点取消）',
        effortNone: '不传思考强度',
        hint: '拖到边缘插入 · 拖到中间交换 · 双击简称改名',
      }
    : {
        viewCards: 'Cards',
        viewList: 'List',
        widthNarrow: 'Narrow',
        widthWide: 'Wide',
        widthAria: 'Adjust card width',
        resetOrder: 'Reset order',
        providerMenuTitle: 'Select provider',
        providerTriggerTitle: 'Switch provider',
        swapBadge: 'Swap',
        cardBodyTitle: 'Select model without reasoning effort',
        shortEditTitle: 'Double-click to rename',
        effortCellTitle: 'Select reasoning effort (click again to clear)',
        effortNone: 'No effort',
        hint: 'Drag edges to insert · center to swap · double-click to rename',
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
  const openRef = useRef(open)
  openRef.current = open
  const id = useId()

  const [panelPos, setPanelPos] = useState<CSSProperties | null>(null)
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [dragSrcIndex, setDragSrcIndex] = useState<number | null>(null)
  const [dropState, setDropState] = useState<{ index: number; mode: CardDropMode } | null>(null)

  const cards = useMemo(
    () => buildPeriodicCards(choices, prefs, selected),
    [choices, prefs, selected],
  )

  const gated = disabled || busy

  useEffect(() => {
    if (!open) {
      setOpenMenuKey(null)
      setEditingKey(null)
      setDragSrcIndex(null)
      setDropState(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      onOpenChange(false)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      if (!openRef.current) return
      event.preventDefault()
      if (editingKey !== null) { setEditingKey(null); return }
      if (openMenuKey !== null) { setOpenMenuKey(null); return }
      onOpenChange(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open, onOpenChange, editingKey, openMenuKey])

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
      if (pw > 0) left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - pw - margin))
      if (ph > 0) {
        if (top < margin && rect.bottom + 8 + ph <= window.innerHeight - margin) {
          top = rect.bottom + 8
        }
        top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - ph - margin))
      }
      setPanelPos(prev => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, cards.length, prefs.cardWidth])

  const commitAlias = (card: PeriodicCardEntry): void => {
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
    onPrefsChange(prev => ({
      ...prev,
      providers: { ...prev.providers, [card.canonicalKey]: route.provider },
    }))
    const currentEffort = selected && selected.provider === route.provider && selected.model === route.model
      ? (selectedEffort || undefined)
      : undefined
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
          style={{ ...panelPos, '--_card-w': `${prefs.cardWidth}px` } as CSSProperties}
          onClick={() => { if (openMenuKey !== null) setOpenMenuKey(null) }}
        >
          <div className="dsh-model-picker-toolbar">
            <div className="dsh-model-picker-viewSwitch" role="group" aria-label={modelLabel}>
              <button
                type="button"
                className="dsh-model-picker-viewBtn"
                data-active=""
                aria-pressed={true}
              >
                {copy.viewCards}
              </button>
              <button
                type="button"
                className="dsh-model-picker-viewBtn"
                aria-pressed={false}
                onClick={() => onPrefsChange(prev => ({ ...prev, viewMode: 'list' }))}
              >
                {copy.viewList}
              </button>
            </div>
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
                onChange={event => {
                  const width = Number((event.target as HTMLInputElement).value)
                  if (Number.isFinite(width)) onPrefsChange(prev => ({ ...prev, cardWidth: width }))
                }}
              />
              <span>{copy.widthWide}</span>
            </label>
            {hasCustomOrder ? (
              <button
                type="button"
                className="dsh-model-picker-resetBtn"
                onClick={() => onPrefsChange(prev => ({ ...prev, order: [], aliases: {} }))}
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
          ) : (
            <div className="dsh-model-picker-grid" data-testid="periodic-card-grid">
              {cards.map((card, index) => {
                const route = card.activeRoute
                const isActive = Boolean(
                  selected && selected.provider === route.provider && selected.model === route.model,
                )
                const isMenuOpen = openMenuKey === card.canonicalKey
                const isEditing = editingKey === card.canonicalKey
                const seq = String(index + 1).padStart(2, '0')
                const dropMode = dropState?.index === index ? dropState.mode : undefined
                const activeEffort = isActive ? (selectedEffort || '') : ''

                return (
                  <div
                    key={card.canonicalKey}
                    className={`dsh-model-picker-card${isActive ? ' dsh-model-picker-cardActive' : ''}${isMenuOpen ? ' dsh-model-picker-cardMenuOpen' : ''}${dragSrcIndex === index ? ' dsh-model-picker-cardDragging' : ''}`}
                    data-card-key={card.canonicalKey}
                    data-drop={dropMode}
                    data-swap-label={copy.swapBadge}
                    draggable={!gated && !isEditing && !isMenuOpen}
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
                      if (dragSrcIndex === null || dragSrcIndex === index) return
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
                      if (dragSrcIndex === null || dragSrcIndex === index) return
                      const rect = event.currentTarget.getBoundingClientRect()
                      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5
                      const mode = dropModeFromRatio(ratio)
                      const currentKeys = cards.map(item => item.canonicalKey)
                      const nextOrder = applyCardDrop(currentKeys, dragSrcIndex, index, mode)
                      onPrefsChange(prev => ({ ...prev, order: nextOrder }))
                      setDragSrcIndex(null)
                      setDropState(null)
                    }}
                  >
                    <div className="dsh-model-picker-cardHead">
                      <span className="dsh-model-picker-seqWrap">
                        <span className="dsh-model-picker-seq">{seq}</span>
                        <span className="dsh-model-picker-dot" data-tone={familyTone(card.family)} aria-hidden="true" />
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
                      onClick={() => {
                        if (gated || isEditing) return
                        setOpenMenuKey(null)
                        onPickCard({ provider: route.provider, model: route.model }, undefined)
                      }}
                      onKeyDown={event => {
                        if (gated || isEditing) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
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
                          onClick={event => event.stopPropagation()}
                          onChange={event => setEditingDraft(event.target.value)}
                          onBlur={() => commitAlias(card)}
                          onKeyDown={event => {
                            event.stopPropagation()
                            if (event.key === 'Enter') commitAlias(card)
                            else if (event.key === 'Escape') setEditingKey(null)
                          }}
                        />
                      ) : (
                        <div
                          className="dsh-model-picker-symbolLine"
                          title={copy.shortEditTitle}
                          onDoubleClick={event => {
                            event.stopPropagation()
                            if (gated) return
                            setOpenMenuKey(null)
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
