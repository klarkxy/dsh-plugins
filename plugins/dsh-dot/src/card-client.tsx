/** dot's own answer channel around Deep View's shared renderer. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { WidgetCard, type Answer } from '../../dsh-deep-view/src/widget.tsx'
import { checkShownView } from '../../dsh-deep-view/src/core/index.js'
import { checkedAnswer } from '../../dsh-deep-view/src/answers.ts'
import { uiEn, uiZh } from '../../dsh-deep-view/src/client.tsx'
import type { CardComponent } from './chat-panel.tsx'

interface CardLocale {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}
const translationKeys = new Map(Object.entries(uiEn).map(([key, english]) => [english, key as keyof typeof uiZh]))

export function createDotCards(call: (endpoint: string, payload: unknown) => Promise<unknown>, locale?: CardLocale): { Card: CardComponent } {
  const subscribe = (listener: () => void) => locale?.subscribe(listener) ?? (() => {})
  const active = () => locale?.getSnapshot().active ?? 'en'
  const Card: CardComponent = props => {
    const language = useSyncExternalStore(subscribe, active)
    const zh = language.toLowerCase().startsWith('zh')
    const t = useCallback((key: string, params?: Record<string, unknown>) => {
      const text = zh && translationKeys.has(key) ? uiZh[translationKeys.get(key)!] : key
      return text.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
    }, [zh])
    const labels = useMemo<MarkdownLabels>(() => ({ code: { copyLabel: t('Copy'), copiedLabel: t('Copied') }, footnotes: t('Footnotes') }), [t])
    const meta = props.presentation as { title?: unknown; view?: unknown; viewId?: string } | undefined
    const shown = useMemo(() => checkShownView(meta?.title ?? props.title, meta?.view ?? props.view), [meta?.title, meta?.view, props.title, props.view])
    const valid = !('error' in shown) && !props.failed ? shown : undefined
    const id = meta?.viewId
    const restored = useMemo(() => valid ? checkedAnswer(props.answer, id, valid.view) : null, [props.answer, id, valid])
    const [localAnswer, setAnswer] = useState<Answer | null>(null)
    const [pending, setPending] = useState(false)
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState(false)
    const answer = restored ?? localAnswer
    useEffect(() => {
      let cancelled = false
      setPending(false)
      if (!valid?.interactive || !id || answer) return
      void call('card.pending', { sessionId: props.sessionId, callId: props.callId }).then(record => {
        if (!cancelled) setPending(record !== null && typeof record === 'object' && (record as { id?: unknown }).id === id)
      }, () => { if (!cancelled) setFailed(true) })
      return () => { cancelled = true }
    }, [call, props.sessionId, props.callId, id, valid?.interactive, answer])
    const submit = useCallback((action: string, values: Record<string, unknown>) => {
      if (!id || !pending || busy) return
      setBusy(true); setFailed(false)
      void call('card.answer', { viewId: id, action, values }).then(() => {
        setAnswer({ id, action, values }); setPending(false)
      }, () => setFailed(true)).finally(() => setBusy(false))
    }, [call, id, pending, busy])
    if (!valid) return <div className="dvui-root" role="alert">{zh ? uiZh.invalid : uiEn.invalid}</div>
    const canAnswer = valid.interactive && pending && answer === null
    // Expiry is a dot badge, never a reason to settle or disable an unanswered card.
    return <div className="dvui-root"><WidgetCard title={valid.title} view={valid.view}
      onSubmit={canAnswer ? submit : undefined} busy={busy} answer={answer}
      settled={answer !== null || valid.interactive && !canAnswer}
      localOnly={valid.interactive && !canAnswer && answer === null} t={t} labels={labels} Markdown={MarkdownText} />
      {failed ? <p role="alert">{zh ? uiZh.answerFailed : uiEn.answerFailed}</p> : null}</div>
  }
  return { Card }
}
