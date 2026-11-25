import { Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  FIND_LOCALES,
  SCOPE_EXTRA_KEYS,
  clampOverlayPosition,
  readSavedOverlayPosition,
  writeSavedOverlayPosition,
  type FindController,
  type OverlayPosition,
} from './conversation-find.ts'

function SvgPathIcon({ d, size = 14 }: { d: string; size?: number | undefined }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

function GripIcon() {
  return (
    <svg width={10} height={14} viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.1" />
      <circle cx="7" cy="3" r="1.1" />
      <circle cx="3" cy="7" r="1.1" />
      <circle cx="7" cy="7" r="1.1" />
      <circle cx="3" cy="11" r="1.1" />
      <circle cx="7" cy="11" r="1.1" />
    </svg>
  )
}

export function FindBarOverlay(props: {
  controller: FindController
  usePanelInfo?: (<T>(selector: (panel: { activePanelId?: string | null | undefined } | undefined) => T) => T) | undefined
}) {
  const { controller } = props
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const activePanelId = typeof props.usePanelInfo === 'function'
    ? props.usePanelInfo(p => p?.activePanelId ?? null)
    : null
  const inputRef = useRef<HTMLInputElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const composingRef = useRef(false)
  const prevMenuOpenRef = useRef(false)
  const [draft, setDraft] = useState(snap.query)
  const [menuAbove, setMenuAbove] = useState(false)
  const [dragPos, setDragPos] = useState<OverlayPosition | null>(() => {
    const saved = readSavedOverlayPosition()
    if (!saved) return null
    const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 720
    return clampOverlayPosition(saved, null, { width: vw, height: vh })
  })
  const [dragging, setDragging] = useState(false)

  const reclampOverlay = () => {
    const el = wrapRef.current
    if (!el || typeof window === 'undefined') return
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
    const vp = { width: window.innerWidth || 1280, height: window.innerHeight || 720 }
    setDragPos(prev => {
      if (!prev) return prev
      const next = clampOverlayPosition(prev, rect, vp)
      return next && (next.left !== prev.left || next.top !== prev.top) ? next : prev
    })
  }

  useEffect(() => {
    if (!composingRef.current && draft !== snap.query) setDraft(snap.query)
  }, [snap.query])

  useEffect(() => {
    if (!snap.open || activePanelId !== null) return
    const el = inputRef.current
    if (el && typeof el.focus === 'function') {
      el.focus({ preventScroll: true })
      if (typeof el.select === 'function') el.select()
    }
  }, [snap.open, snap.focusSeq, activePanelId])

  const hasMeta = Boolean(snap.query && (snap.scanState || snap.remoteHasMore || snap.hasEvictedPending || snap.loadingTarget))
  const hasExcerpt = Boolean(snap.fallbackNotice && snap.activeHit)
  useEffect(() => {
    if (!snap.open || activePanelId !== null || !dragPos) return
    reclampOverlay()
  }, [snap.open, activePanelId, hasMeta, hasExcerpt])

  useEffect(() => {
    if (!snap.open || activePanelId !== null || typeof window === 'undefined') return undefined
    window.addEventListener('resize', reclampOverlay)
    return () => window.removeEventListener('resize', reclampOverlay)
  }, [snap.open, activePanelId])

  useEffect(() => () => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
  }, [])

  useEffect(() => {
    if (prevMenuOpenRef.current && !snap.scopeMenuOpen && snap.open && activePanelId === null) {
      inputRef.current?.focus({ preventScroll: true })
    }
    prevMenuOpenRef.current = snap.scopeMenuOpen
  }, [snap.scopeMenuOpen, snap.open, activePanelId])

  useEffect(() => {
    if (!snap.open || !snap.scopeMenuOpen || activePanelId !== null || typeof window === 'undefined') return undefined
    const onOutsidePointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-shortcuts-find-scope-menu="true"], [data-shortcuts-find-scope="true"]')) return
      if (e.button === 2 && target?.closest?.('.sc-find-bar') && !target?.closest?.('input, textarea, .sc-find-extext')) return
      controller.setScopeMenuOpen(false)
    }
    window.addEventListener('pointerdown', onOutsidePointer, true)
    return () => window.removeEventListener('pointerdown', onOutsidePointer, true)
  }, [snap.open, snap.scopeMenuOpen, activePanelId])

  if (!snap.open || activePanelId !== null) return null

  const { t } = controller
  const countLabel = !snap.query
    ? ''
    : snap.hits.length === 0
      ? t('noMatches')
      : snap.navigated && snap.selectedIndex >= 0
        ? `${snap.selectedIndex + 1} / ${snap.hits.length}${snap.remoteHasMore ? '+' : ''}`
        : t('foundCount', { count: `${snap.hits.length}${snap.remoteHasMore ? '+' : ''}` })

  const statusText = snap.loadingTarget
    ? t('statusLoadingTarget')
    : snap.scanState === 'scanning'
      ? t('scanning')
      : snap.scanState === 'error'
        ? (snap.scanError ?? t('statusError'))
        : snap.scanState === 'done'
          ? t('statusDone')
          : snap.scanState === 'paused'
            ? t('statusPaused')
            : (snap.remoteHasMore || snap.hasEvictedPending)
              ? t('statusMore')
              : ''

  let scanBtn: React.ReactElement | null = null
  if (snap.query && snap.hasRemote) {
    if (snap.scanState === 'scanning') {
      scanBtn = <button type="button" className="sc-find-link" data-shortcuts-find-action="pause" onClick={() => controller.pauseScan()}>{t('pause')}</button>
    } else if (snap.scanState === 'error') {
      scanBtn = <button type="button" className="sc-find-link" data-shortcuts-find-action="retry" onClick={() => { void controller.startOrResumeScan() }}>{t('retry')}</button>
    } else if (snap.scanState === 'paused' && (snap.remoteHasMore || snap.hasEvictedPending)) {
      scanBtn = <button type="button" className="sc-find-link" data-shortcuts-find-action="resume" onClick={() => { void controller.startOrResumeScan() }}>{t('resume')}</button>
    } else if (snap.remoteHasMore || snap.hasEvictedPending) {
      scanBtn = <button type="button" className="sc-find-link" data-shortcuts-find-action="scan" onClick={() => { void controller.startOrResumeScan() }}>{t('searchHistory')}</button>
    }
  }

  const activeHit = snap.activeHit
  const excerpt = activeHit ? (activeHit.excerpt ?? controller._cache.hitExcerpts.get(activeHit.hitKey) ?? null) : null
  const showMeta = Boolean(snap.query && (statusText || scanBtn))

  const computeMenuAbove = () => {
    const rect = wrapRef.current?.getBoundingClientRect?.()
    if (!rect || typeof window === 'undefined') return false
    return ((window.innerHeight || 720) - rect.bottom) < 300 && rect.top > 280
  }

  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement | null
    const handleEl = target?.closest?.('[data-shortcuts-find-drag="true"]') as HTMLElement | null
    if (!handleEl && target?.closest?.('input, textarea, select, button, a, [contenteditable], .sc-find-input-wrap, .sc-find-extext')) return
    const wrapEl = wrapRef.current
    if (!wrapEl || typeof window === 'undefined') return
    e.preventDefault()
    dragCleanupRef.current?.()
    const rect = wrapEl.getBoundingClientRect()
    const originLeft = dragPos ? dragPos.left : rect.left
    const originTop = dragPos ? dragPos.top : rect.top
    const boxSize = { width: rect.width, height: rect.height }
    const startX = e.clientX
    const startY = e.clientY
    const pointerId = e.pointerId
    let moved = false
    let latest: OverlayPosition | null = null
    const captureEl = handleEl ?? e.currentTarget
    try {
      captureEl.setPointerCapture?.(pointerId)
    } catch {
      /* ignore */
    }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) < 3) return
      if (!moved) {
        moved = true
        setDragging(true)
      }
      const vp = { width: window.innerWidth || 1280, height: window.innerHeight || 720 }
      latest = clampOverlayPosition({ left: originLeft + dx, top: originTop + dy }, boxSize, vp)
      if (latest) setDragPos(latest)
    }
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
      setDragging(false)
      if (moved && latest) writeSavedOverlayPosition(latest)
      inputRef.current?.focus({ preventScroll: true })
    }
    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      try {
        captureEl.releasePointerCapture?.(pointerId)
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const resetDragPos = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
    setDragging(false)
    setDragPos(null)
    writeSavedOverlayPosition(null)
    inputRef.current?.focus({ preventScroll: true })
  }

  const srcLabelKey = (`src_${activeHit?.sourceKind ?? 'response'}`) as keyof typeof FIND_LOCALES.en

  return (
    <>
      {snap.highlightRects.length > 0 ? (
        <div className="shortcuts-root sc-find-highlights" aria-hidden="true">
          {snap.highlightRects.map((box, idx) => (
            <span
              key={`${idx}:${box.left}:${box.top}:${box.current ? 1 : 0}`}
              className={box.current ? 'sc-find-hl sc-find-hl-current' : 'sc-find-hl'}
              style={{
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.width}px`,
                height: `${box.height}px`,
              }}
            />
          ))}
        </div>
      ) : null}
      <div
        ref={wrapRef}
        className="shortcuts-root sc-find-wrap"
        data-shortcuts-find-root="true"
        data-dragging={dragging ? 'true' : undefined}
        style={dragPos ? { left: `${dragPos.left}px`, top: `${dragPos.top}px`, right: 'auto' } : undefined}
        role="search"
        aria-label={t('openLabel')}
        onKeyDown={e => {
          if (e.key === 'Escape' && !composingRef.current && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.stopPropagation()
            if (snap.scopeMenuOpen) controller.setScopeMenuOpen(false)
            else controller.closeFind(true)
          }
        }}
      >
        <div
          className="sc-find-bar"
          onPointerDown={onBarPointerDown}
          onContextMenu={e => {
            const target = e.target as HTMLElement | null
            if (target?.closest?.('input, textarea, .sc-find-extext')) return
            e.preventDefault()
            e.stopPropagation()
            setMenuAbove(computeMenuAbove())
            controller.setScopeMenuOpen(true)
          }}
        >
          <div className="sc-find-row">
            <button
              type="button"
              tabIndex={-1}
              className="sc-find-drag"
              data-shortcuts-find-drag="true"
              title={t('dragHandle')}
              aria-label={t('dragHandle')}
              onDoubleClick={resetDragPos}
            >
              <GripIcon />
            </button>
            <div className="sc-find-input-wrap">
              <input
                ref={inputRef}
                type="text"
                className="sc-find-input"
                data-shortcuts-find-input="true"
                value={draft}
                placeholder={t('placeholder')}
                aria-label={t('placeholder')}
                onCompositionStart={() => {
                  composingRef.current = true
                }}
                onCompositionEnd={e => {
                  composingRef.current = false
                  const v = e.currentTarget.value
                  setDraft(v)
                  controller.setQuery(v)
                }}
                onChange={e => {
                  const v = e.currentTarget.value
                  setDraft(v)
                  if (!composingRef.current) controller.setQuery(v)
                }}
                onKeyDown={e => {
                  if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    void controller.navigate(e.shiftKey ? -1 : 1)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    if (snap.scopeMenuOpen) controller.setScopeMenuOpen(false)
                    else controller.closeFind(true)
                  }
                }}
              />
              {countLabel ? (
                <span className="sc-find-count" data-shortcuts-find-count="true">
                  {countLabel}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="sc-find-btn"
              data-shortcuts-find-case="true"
              aria-pressed={snap.caseSensitive ? 'true' : 'false'}
              title={t('caseSensitive')}
              aria-label={t('caseSensitive')}
              onClick={() => controller.toggleCaseSensitive()}
            >
              Aa
            </button>
            <button
              type="button"
              className="sc-find-btn sc-find-scope-btn"
              data-shortcuts-find-scope="true"
              data-custom-scope={snap.hasCustomScope ? 'true' : undefined}
              aria-haspopup="menu"
              aria-expanded={snap.scopeMenuOpen ? 'true' : 'false'}
              title={t('scopeBtn')}
              aria-label={t('scopeBtn')}
              onClick={() => {
                const next = !snap.scopeMenuOpen
                if (next) setMenuAbove(computeMenuAbove())
                controller.setScopeMenuOpen(next)
              }}
            >
              <SvgPathIcon d="M2 4h12M4 8h8M6 12h4" size={14} />
              {snap.hasCustomScope ? <span className="sc-find-dot" aria-hidden="true" /> : null}
            </button>
            <button
              type="button"
              className="sc-find-btn"
              data-shortcuts-find-prev="true"
              disabled={snap.hits.length === 0}
              title={t('prev')}
              aria-label={t('prev')}
              onClick={() => { void controller.navigate(-1) }}
            >
              <SvgPathIcon d="M4 10L8 6L12 10" />
            </button>
            <button
              type="button"
              className="sc-find-btn"
              data-shortcuts-find-next="true"
              disabled={snap.hits.length === 0}
              title={t('next')}
              aria-label={t('next')}
              onClick={() => { void controller.navigate(1) }}
            >
              <SvgPathIcon d="M4 6L8 10L12 6" />
            </button>
            <button
              type="button"
              className="sc-find-btn"
              data-shortcuts-find-close="true"
              title={t('close')}
              aria-label={t('close')}
              onClick={() => controller.closeFind(true)}
            >
              <SvgPathIcon d="M4 4L12 12M12 4L4 12" />
            </button>
          </div>
          {showMeta ? (
            <div className="sc-find-meta">
              <span className="sc-find-status" data-shortcuts-find-status="true">{statusText}</span>
              <div className="sc-find-actions">{scanBtn}</div>
            </div>
          ) : null}
          {snap.fallbackNotice && activeHit ? (
            <div className="sc-find-excerpt" data-shortcuts-find-excerpt="true">
              <div className="sc-find-exhead">
                <span>
                  {`${t(srcLabelKey)}${typeof activeHit.turn === 'number' && Number.isSafeInteger(activeHit.turn) ? ` · #${activeHit.turn}` : ''} · ${snap.fallbackNotice}`}
                </span>
                <button
                  type="button"
                  className="sc-find-link"
                  data-shortcuts-find-relocate="true"
                  onClick={() => { void controller.jumpToHit(snap.selectedIndex) }}
                >
                  {t('relocate')}
                </button>
              </div>
              {excerpt ? (
                <div className="sc-find-extext">
                  {excerpt.leftContext}
                  <mark className="sc-find-exmark">{excerpt.match || snap.query}</mark>
                  {excerpt.rightContext}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {snap.scopeMenuOpen ? (
          <div
            className="sc-find-menu"
            data-shortcuts-find-scope-menu="true"
            data-placement={menuAbove ? 'above' : 'below'}
            role="menu"
            aria-label={t('scopeMenuTitle')}
          >
            <div className="sc-find-menu-head">{t('scopeMenuTitle')}</div>
            <button
              type="button"
              role="menuitemcheckbox"
              className="sc-find-menu-item"
              data-shortcuts-find-scope-opt="body"
              aria-checked={snap.scope.body ? 'true' : 'false'}
              onClick={() => controller.toggleScopeKey('body')}
            >
              <span className="sc-find-chk" aria-hidden="true">
                {snap.scope.body ? <SvgPathIcon d="M3 8.2L6.2 11.4L13 4.6" size={10} /> : null}
              </span>
              <span className="sc-find-menu-label">{t('scopeBody')}</span>
              <span className="sc-find-menu-tag">{t('scopeDefaultTag')}</span>
            </button>
            <div className="sc-find-menu-sep" role="separator" />
            {SCOPE_EXTRA_KEYS.map(key => {
              const optLabelKey = (`src_${key}`) as keyof typeof FIND_LOCALES.en
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitemcheckbox"
                  className="sc-find-menu-item"
                  data-shortcuts-find-scope-opt={key}
                  aria-checked={snap.scope[key] ? 'true' : 'false'}
                  onClick={() => controller.toggleScopeKey(key)}
                >
                  <span className="sc-find-chk" aria-hidden="true">
                    {snap.scope[key] ? <SvgPathIcon d="M3 8.2L6.2 11.4L13 4.6" size={10} /> : null}
                  </span>
                  <span className="sc-find-menu-label">{t(optLabelKey)}</span>
                </button>
              )
            })}
            <div className="sc-find-menu-foot">
              <button type="button" className="sc-find-link" data-shortcuts-find-scope-reset="true" onClick={() => controller.resetScope()}>
                {t('scopeReset')}
              </button>
              <button type="button" className="sc-find-link" data-shortcuts-find-scope-all="true" onClick={() => controller.selectAllScope()}>
                {t('scopeAll')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}

export function FindHeaderUtilityButton(props: {
  controller: FindController
  useSession?: (<T>(selector: (session: { removed?: boolean | undefined; blank?: boolean | undefined } | undefined) => T) => T) | undefined
}) {
  const { controller } = props
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const hidden = typeof props.useSession === 'function'
    ? props.useSession(s => !s || Boolean(s.removed) || Boolean(s.blank))
    : false
  const btnRef = useRef<HTMLButtonElement | null>(null)
  if (hidden) return null
  const label = controller.t('openLabel')
  return (
    <Tooltip label={label} side="bottom" delayMs={500}>
      <button
        ref={btnRef}
        type="button"
        className="shortcuts-root sc-find-trig"
        data-shortcuts-find-trigger="true"
        aria-label={label}
        aria-pressed={snap.open ? 'true' : 'false'}
        title={label}
        onClick={() => {
          controller.syncMainSession()
          if (snap.open) controller.closeFind(true)
          else controller.openFind(btnRef.current)
        }}
      >
        <svg
          width={15}
          height={15}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
      </button>
    </Tooltip>
  )
}

export function FindWebCtrlFSection(props: {
  locale: 'zh' | 'en'
  runtime: string
  enabled: boolean
  onToggle(next: boolean): void
}) {
  if (props.runtime !== 'web') return null
  const dict = FIND_LOCALES[props.locale]
  return (
    <section className="shortcuts-root dsh-ui-card" data-testid="shortcuts-web-ctrl-f">
      <div className="shortcuts-section-head">
        <div className="shortcuts-section-title">
          <h3 className="dsh-ui-heading">{dict.webCtrlFTitle}</h3>
          <p className="dsh-ui-hint">{dict.webCtrlFHint}</p>
        </div>
        <Switch checked={props.enabled} label={dict.webCtrlFLabel} onChange={props.onToggle} />
      </div>
    </section>
  )
}
