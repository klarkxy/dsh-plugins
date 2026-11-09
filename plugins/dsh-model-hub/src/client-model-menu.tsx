import { useEffect, useMemo, useState } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelMenuEffortLabel, modelMenuEffortOptions, modelMenuShortName, normalizeModelRoute, parseModelMenuChoices, type ModelRoute } from '@klarkxy/dsh-model-route'
import { ModelMenu } from '@klarkxy/dsh-model-route/ui'
import { renderModelPicker, useModelMenuAnchor, type RenderFactorySlot } from '@klarkxy/dsh-plugin-kit/model-picker'

/** The text surface FieldMenu needs; both the fields tab and the cast tab supply it. */
export interface FieldMenuText {
  (key: 'follow' | 'effortDefault' | 'model' | 'effort' | 'searchModels' | 'noModels' | 'clearSearch'): string
  language: 'zh' | 'en'
}

/**
 * One detected field's standard editor: the same ModelMenu every marked field gets.
 *
 * `display: 'short'` shows only the model name on the trigger; the accessible
 * name and the title keep the full provider/model route so two providers that
 * ship the same model name stay distinguishable. Picking another model keeps
 * the current reasoning effort when the new model advertises it, so switching a
 * route does not silently reset the user's choice.
 */
export function FieldMenu({ t, catalog, current, disabled, label, allowFollow = true, followLabel, reasoningEffort = true, display = 'full', onSet, renderFactorySlot }: {
  t: FieldMenuText
  catalog: unknown
  current: ModelRoute | undefined
  disabled: boolean
  label: string
  allowFollow?: boolean
  followLabel?: string
  reasoningEffort?: boolean
  display?: 'full' | 'short'
  onSet: (route: ModelRoute) => void
  /** Framework-composed factory renderer; absent under direct test renders. */
  renderFactorySlot?: RenderFactorySlot
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const route = normalizeModelRoute(current)
  const follow = !route.provider || !route.model
  const choices = useMemo(() => parseModelMenuChoices(catalog, follow ? undefined : route), [catalog, follow, route.provider, route.model])
  const selected = follow ? undefined : choices.find(choice => choice.provider === route.provider && choice.model === route.model)
  const efforts = follow || !reasoningEffort ? [] : modelMenuEffortOptions(selected, route.reasoningEffort || '')
  const menuLabel = follow ? followLabel || t('follow') : selected?.label ?? `${route.provider} / ${route.model}`
  /* The full route stays in the accessible name and the tooltip; the button
   * itself may show only the model name. */
  const routeLabel = follow ? menuLabel : `${route.provider} / ${route.model}`
  const accessible = label === routeLabel ? routeLabel : `${label}: ${routeLabel}`
  const currentLabel = display === 'short' && !follow ? (selected ? modelMenuShortName(selected) : route.model) : menuLabel
  const selectedEffort = efforts.find(item => item.id === (route.reasoningEffort || ''))
  const effortName = selectedEffort ? modelMenuEffortLabel(selectedEffort, t.language) : undefined
  const anchor = useModelMenuAnchor(accessible, routeLabel, () => setOpen(false))
  const pick = (picked: { provider: string; model: string }) => {
    /* Keep the current effort when the new model lists it; an effort the new
     * model does not support is dropped rather than carried into a route
     * that cannot honour it. */
    const choice = choices.find(item => item.provider === picked.provider && item.model === picked.model)
    const effort = route.reasoningEffort
    const supported = Boolean(effort) && Boolean(choice?.efforts.some(item => item.id === effort))
    onSet({ provider: picked.provider, model: picked.model, ...(supported ? { reasoningEffort: effort } : {}) })
  }
  return renderModelPicker(renderFactorySlot, {
    locale: t.language,
    disabled,
    onOpenChange: next => setOpen(next && !disabled),
    listClassName: 'dsh-model-hub',
    choices,
    selected: follow ? undefined : { provider: route.provider, model: route.model },
    onPick: pick,
    leading: allowFollow ? [{ id: 'follow', label: followLabel || t('follow'), selected: follow }] : [],
    onPickLeading: () => onSet({ provider: '', model: '' }),
    efforts,
    selectedEffort: route.reasoningEffort || '',
    onPickEffort: effort => onSet(follow
      ? { provider: '', model: '' }
      : { provider: route.provider, model: route.model, ...(effort ? { reasoningEffort: effort } : {}) }),
    triggerLabel: currentLabel,
    triggerEffortLabel: !follow && efforts.length ? ` · ${effortName ?? t('effortDefault')}` : undefined,
    modelLabel: t('model'),
    modelValue: currentLabel,
    effortLabel: t('effort'),
    defaultEffortLabel: t('effortDefault'),
    searchPlaceholder: t('searchModels'),
    emptyLabel: t('noModels'),
    clearSearchLabel: t('clearSearch'),
  }, {
    anchor,
    fallback: <ModelMenu
    locale={t.language}
    open={open && !disabled}
    onOpenChange={next => setOpen(next && !disabled)}
    listClassName="dsh-model-hub"
    anchor={<button type="button" className="dsh-model-menu-trigger" disabled={disabled} aria-label={accessible} title={routeLabel} aria-haspopup="menu" aria-expanded={open && !disabled}>
      <span className="dsh-model-menu-triggerLabel">{currentLabel}</span>
      {!follow && efforts.length ? <span className="dsh-model-menu-triggerEffort">{` · ${effortName ?? t('effortDefault')}`}</span> : null}
      <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${open ? ' dsh-model-menu-chevronOpen' : ''}`} />
    </button>}
    choices={choices}
    selected={follow ? undefined : { provider: route.provider, model: route.model }}
    onPick={pick}
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
  />,
  })
}


export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error)
}

// Preserve the hub's helper exports while keeping catalog validation and failure
// decoding in the shared route contract used by both pages.
export { checkedModelCatalog as checkedCatalog, catalogFailures } from '@klarkxy/dsh-model-route'
