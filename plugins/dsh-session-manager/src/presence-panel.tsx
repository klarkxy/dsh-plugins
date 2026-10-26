import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, IconCloseFillRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContinueModel, WelcomeBackModel } from './presence-model.ts'
import { FREE_CHAT_ROOT } from './styles.ts'
import { compactedText, failureText, idleText, uiText, type CopyLocale } from './ui-copy.ts'

/** Narrow slot standard props the components rely on; the host keeps the real types. */
export interface GhostInputState {
  readonly draft: string
  readonly phase: string
  readonly attachmentIds: readonly unknown[]
}

export interface GhostSessionState {
  readonly blank: boolean
}

export interface GhostStatusState {
  readonly running?: boolean
}

export interface GhostSlotProps {
  readonly sessionId?: string
  readonly useInput?: <T>(selector: (state: GhostInputState) => T) => T
  readonly useSession?: <T>(selector: (state: GhostSessionState) => T) => T
  readonly useSessionStatus?: <T>(selector: (state: ReadonlyMap<string, GhostStatusState>) => T) => T
  readonly inputActions?: {
    setDraft(text: string): void
  }
}

/**
 * Grey inline-completion for an empty composer, IDE style: the shipped
 * placeholder's own text becomes the continuation (native look, zero
 * positioning), and Tab fills it into the draft for a normal send.
 * The rendered element is a hidden anchor; all work happens in effects.
 */
export function ContinueGhost(props: GhostSlotProps & {
  model: ContinueModel
  locale: CopyLocale
}): React.ReactElement | null {
  const sessionId = props.sessionId ?? ''
  const draft = props.useInput?.(state => state.draft) ?? ''
  const phase = props.useInput?.(state => state.phase) ?? 'plain'
  // The host placeholder shows exactly when the draft and attachment rail are
  // both empty; the ghost replaces its text under the same condition.
  const bare = (props.useInput?.(state => state.attachmentIds.length) ?? 0) === 0
  const blank = props.useSession?.(state => state.blank) ?? true
  const running = props.useSessionStatus?.(state => state.get(sessionId)?.running === true) ?? false
  const snapshot = useSyncExternalStore(
    props.model.subscribe,
    () => props.model.getSnapshot(sessionId),
    () => props.model.getSnapshot(sessionId),
  )
  // An unresolved or still-open turn keeps the shipped placeholder. Empty fixed
  // text becomes the localized default; an empty model line shows nothing.
  const shown = running || snapshot.pending === true || snapshot.text === undefined
    ? ''
    : (snapshot.text ?? (snapshot.fallback === true ? uiText(props.locale, 'continueDefault') : ''))
  const idle = sessionId !== '' && !blank && bare && draft === '' && phase === 'plain' && !running
  const active = shown !== '' && idle
  const text = shown
  const latest = useRef({ active, text })
  useEffect(() => {
    latest.current = { active, text }
  }, [active, text])

  const wasRunning = useRef(false)
  useEffect(() => {
    const finished = wasRunning.current && !running
    wasRunning.current = running
    // A falling edge is the previous turn ending. Drop the cached line so the
    // next idle composer asks once for the new cut.
    if (finished && sessionId !== '') props.model.invalidate(sessionId)
    if (idle && !running) props.model.load(sessionId)
  }, [props.model, idle, running, sessionId])
  // Config invalidation can happen while this same idle composer stays
  // mounted. Its empty snapshot must start a fresh load too.
  useEffect(() => {
    if (idle && !running && snapshot.text === undefined) props.model.load(sessionId)
  }, [props.model, idle, running, sessionId, snapshot])

  // Replace the shipped placeholder's text while the composer is empty. Class
  // hashes change per host build, so the DOM contract is the stable data
  // attributes [data-composer-card] / [data-composer-placeholder]; the editor's
  // own [data-placeholder] attribute keeps the original text for restore.
  const anchorRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!active) return
    const anchor = anchorRef.current
    const card = anchor?.closest('[data-composer-card]') ?? document.querySelector('[data-composer-card]')
    if (!card) return
    const write = () => {
      const placeholder = card.querySelector('[data-composer-placeholder]')
      if (placeholder !== null && placeholder.textContent !== latest.current.text) {
        placeholder.textContent = latest.current.text
      }
    }
    write()
    const observer = new MutationObserver(write)
    observer.observe(card, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
      const placeholder = card.querySelector('[data-composer-placeholder]')
      const original = card.querySelector('[data-composer-input]')?.getAttribute('data-placeholder')
      // Only undo our own write; a genuinely different placeholder stays.
      if (placeholder !== null && typeof original === 'string' && placeholder.textContent === latest.current.text) {
        placeholder.textContent = original
      }
    }
  }, [active, text])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.isComposing || event.keyCode === 229) return
      const current = latest.current
      if (!current.active) return
      // Only this composer's editor. Dialogs and every other field keep Tab.
      // The anchor normally sits in the card. A single page-level card is the
      // fallback when the slot mounts beside it; several cards and no match
      // means leave the key alone.
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[role="dialog"]') !== null) return
      const anchored = anchorRef.current?.closest('[data-composer-card]')
      const fromTarget = target.closest('[data-composer-card]')
      const only = document.querySelectorAll('[data-composer-card]')
      const card = anchored ?? (fromTarget !== null && only.length === 1 ? fromTarget : null) ?? (only.length === 1 ? only[0] : null)
      const composer = card?.querySelector('[data-composer-input]') ?? null
      if (composer === null || (target !== composer && !composer.contains(target))) return
      event.preventDefault()
      event.stopPropagation()
      props.inputActions?.setDraft(current.text)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [props.inputActions])

  return <span ref={anchorRef} hidden data-sm-ghost-anchor="" />
}

/**
 * Narrow TurnLocation face the card needs from the conversation.chat.turnTail
 * owner props; the host keeps the real type.
 */
export interface WelcomeBackTurn {
  readonly turn: number
  readonly start?: { readonly time: number }
  readonly end?: { readonly time: number }
}

/** Narrow ChatSnapshot face used to find the latest loaded turn. */
export interface WelcomeBackChatState {
  readonly timeline: { readonly turnOrder: readonly number[] }
}

/**
 * The merged return card inside the chat flow: model recap past the recap
 * threshold, compaction offer past the compact one. It renders at the latest
 * completed turn's tail instead of opening a modal, so it suggests rather
 * than intercepts a send.
 */
export function WelcomeBackCard(props: {
  sessionId?: string
  turn?: WelcomeBackTurn
  useChat?: <T>(selector: (state: WelcomeBackChatState) => T) => T
  useInput?: <T>(selector: (state: GhostInputState) => T) => T
  model: WelcomeBackModel
  locale: CopyLocale
}): React.ReactElement | null {
  const sessionId = props.sessionId ?? ''
  const snapshot = useSyncExternalStore(
    props.model.subscribe,
    () => props.model.getSnapshot(sessionId),
    () => props.model.getSnapshot(sessionId),
  )
  const lastTurn = props.useChat?.(state => state.timeline.turnOrder[state.timeline.turnOrder.length - 1])
  const inputPhase = props.useInput?.(state => state.phase)
  const card = snapshot.card
  // Live idle clock: the prepared value is a fixed snapshot, so the card
  // recomputes the minutes against lastResponseAt every half minute and the
  // compaction offer can cross its threshold while the card is visible.
  const [liveMinutes, setLiveMinutes] = useState(() => card === undefined ? 0 : Math.max(0, Math.floor((Date.now() - card.lastResponseAt) / 60_000)))
  useEffect(() => {
    if (card === undefined) return
    const tick = () => setLiveMinutes(Math.max(0, Math.floor((Date.now() - card.lastResponseAt) / 60_000)))
    tick()
    const timer = setInterval(tick, 30_000)
    return () => clearInterval(timer)
  }, [card])
  // Sending closes the card: once the composer leaves the plain phase the
  // user has continued, and dismiss() records the activity mark so a fresh
  // response re-arms the card without another model call.
  const phaseRef = useRef(inputPhase)
  useEffect(() => {
    const previous = phaseRef.current
    phaseRef.current = inputPhase
    if (inputPhase === undefined || previous === inputPhase) return
    if (previous === 'plain' && sessionId !== '') props.model.dismiss(sessionId)
  }, [inputPhase, sessionId, props.model])
  if (sessionId === '' || card === undefined) return null
  // The slot dispatches once per completed turn; only the latest one's tail
  // hosts the card, so it reads as the bottom of the conversation chain.
  if (props.turn === undefined || lastTurn === undefined || props.turn.turn !== lastTurn) return null
  // A response newer than the prepared mark makes the recap stale: the user
  // already continued, so the card never reappears at the new turn's tail.
  const respondedAt = props.turn.end?.time ?? props.turn.start?.time
  if (respondedAt !== undefined && card.lastResponseAt < respondedAt) return null
  const copy = (key: Parameters<typeof uiText>[1]) => uiText(props.locale, key)
  const recap = card.recap
  const settled = snapshot.compactedTokens !== undefined || snapshot.compactReason === 'nothing'
  const liveCompactSuggested = card.compactSuggested || (card.compactMinutes > 0 && liveMinutes >= card.compactMinutes)
  // Root-level capability probes cannot see preset-isolated commands. Always
  // offer the explicit action; the native target-session command fails closed.
  const offerCompact = liveCompactSuggested && !settled
  const actionBusy = snapshot.compactBusy || snapshot.continueBusy === true
  return (
    <div className={`${FREE_CHAT_ROOT} dsh-welcome-card`}>
      <div className="dsh-welcome-card-head">
        <span className="dsh-welcome-card-title">{copy('welcomeBack')}</span>
        <span className="dsh-welcome-card-idle">{idleText(props.locale, liveMinutes)}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="dsh-welcome-card-close"
          aria-label={copy('close')}
          icon={<IconCloseFillRegular />}
          onClick={() => { props.model.dismiss(sessionId) }}
        />
      </div>
      {recap !== null ? (
        <dl className="dsh-welcome-recap">
          <dt>{copy('recapSummary')}</dt>
          <dd>{recap.summary}</dd>
          {recap.progress !== '' ? <dt>{copy('recapProgress')}</dt> : null}
          {recap.progress !== '' ? <dd>{recap.progress}</dd> : null}
          {recap.nextStep !== '' ? <dt>{copy('recapNextStep')}</dt> : null}
          {recap.nextStep !== '' ? <dd>{recap.nextStep}</dd> : null}
        </dl>
      ) : null}
      {liveCompactSuggested ? <p className="dsh-welcome-cache">{copy('cacheNotice')}</p> : null}
      {liveCompactSuggested ? (
        <div className="dsh-welcome-card-actions">
          {offerCompact ? (
            <Button
              type="button"
              variant="outline"
              disabled={actionBusy}
              onClick={() => { void props.model.compact(sessionId) }}
            >
              {snapshot.compactBusy ? copy('compacting') : copy('compactNow')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={actionBusy}
            title={copy('continueNewHint')}
            onClick={() => { void props.model.continueInNewSession(sessionId, props.locale) }}
          >
            {snapshot.continueBusy ? copy('creatingContinuation') : copy('continueNew')}
          </Button>
        </div>
      ) : null}
      {snapshot.compactCommandSent ? (
        <p className="dsh-welcome-done" role="status">{copy('compactCommandSent')}</p>
      ) : null}
      {snapshot.compactedTokens !== undefined ? (
        <p className="dsh-welcome-done" role="status">{compactedText(props.locale, snapshot.compactedTokens)}</p>
      ) : null}
      {snapshot.compactReason === 'nothing' ? <p className="dsh-welcome-done" role="status">{copy('compactNothing')}</p> : null}
      {snapshot.compactReason === 'busy' || snapshot.compactReason === 'unavailable' ? (
        <p className="dsh-ui-error dsh-free-alert" role="alert">
          {failureText(props.locale, { code: snapshot.compactReason === 'busy' ? 'session-manager/busy' : 'session-manager/unavailable' })}
        </p>
      ) : null}
      {snapshot.failure ? <p className="dsh-ui-error dsh-free-alert" role="alert">{failureText(props.locale, snapshot.failure)}</p> : null}
    </div>
  )
}
