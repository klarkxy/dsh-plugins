import React, { useEffect, useMemo, useState } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelMenuEffortLabel, modelMenuEffortOptions, normalizeModelRoute, parseModelMenuChoices, type ModelRoute } from '@klarkxy/dsh-model-route'
import { ModelMenu } from '@klarkxy/dsh-model-route/ui'

/** The text surface FieldMenu needs; both the fields tab and the cast tab supply it. */
export interface FieldMenuText {
  (key: 'follow' | 'effortDefault' | 'model' | 'effort' | 'searchModels' | 'noModels' | 'clearSearch'): string
  language: 'zh' | 'en'
}

/** One detected field's standard editor: the same ModelMenu every marked field gets. */
export function FieldMenu({ t, catalog, current, disabled, label, allowFollow = true, followLabel, reasoningEffort = true, onSet }: {
  t: FieldMenuText
  catalog: unknown
  current: ModelRoute | undefined
  disabled: boolean
  label: string
  allowFollow?: boolean
  followLabel?: string
  reasoningEffort?: boolean
  onSet: (route: ModelRoute) => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const route = normalizeModelRoute(current)
  const follow = !route.provider || !route.model
  const choices = useMemo(() => parseModelMenuChoices(catalog, follow ? undefined : route), [catalog, follow, route.provider, route.model])
  const selected = follow ? undefined : choices.find(choice => choice.provider === route.provider && choice.model === route.model)
  const efforts = follow || !reasoningEffort ? [] : modelMenuEffortOptions(selected, route.reasoningEffort || '')
  const currentLabel = follow ? followLabel || t('follow') : selected?.label ?? `${route.provider} / ${route.model}`
  const selectedEffort = efforts.find(item => item.id === (route.reasoningEffort || ''))
  const effortName = selectedEffort ? modelMenuEffortLabel(selectedEffort, t.language) : undefined
  return <ModelMenu
    locale={t.language}
    open={open && !disabled}
    onOpenChange={next => setOpen(next && !disabled)}
    listClassName="dsh-model-hub"
    anchor={<button type="button" className="dsh-model-menu-trigger" disabled={disabled} aria-label={`${label}: ${currentLabel}`} aria-haspopup="menu" aria-expanded={open && !disabled}>
      <span className="dsh-model-menu-triggerLabel">{currentLabel}</span>
      {!follow && efforts.length ? <span className="dsh-model-menu-triggerEffort">{effortName ?? t('effortDefault')}</span> : null}
      <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${open ? ' dsh-model-menu-chevronOpen' : ''}`} />
    </button>}
    choices={choices}
    selected={follow ? undefined : { provider: route.provider, model: route.model }}
    onPick={picked => onSet({ provider: picked.provider, model: picked.model })}
    leading={allowFollow ? [{ id: 'follow', label: followLabel || t('follow'), selected: follow }] : []}
    onPickLeading={() => onSet({ provider: '', model: '' })}
    efforts={efforts}
    selectedEffort={route.reasoningEffort || ''}
    onPickEffort={effort => onSet(follow
      ? { provider: '', model: '' }
      : { provider: route.provider, model: route.model, ...(effort ? { reasoningEffort: effort } : {}) })}
    modelLabel={t('model')}
    modelValue={currentLabel}
    effortLabel={t('effort')}
    defaultEffortLabel={t('effortDefault')}
    searchPlaceholder={t('searchModels')}
    emptyLabel={t('noModels')}
    clearSearchLabel={t('clearSearch')}
  />
}


export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error)
}

export function checkedCatalog(value: unknown): unknown {
  if (value && typeof value === 'object' && 'ok' in value && value.ok === false) {
    throw new Error('error' in value ? messageOf(value.error) : 'Request failed')
  }
  return value
}

export function catalogFailures(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const root = 'ok' in value && value.ok === true && 'value' in value ? value.value : value
  if (!root || typeof root !== 'object' || !('failures' in root) || !Array.isArray(root.failures)) return []
  return root.failures.map(failure => {
    if (!failure || typeof failure !== 'object') return messageOf(failure)
    const provider = 'name' in failure ? failure.name : 'id' in failure ? failure.id : 'provider' in failure ? failure.provider : ''
    return provider ? `${provider}: ${messageOf(failure)}` : messageOf(failure)
  })
}

