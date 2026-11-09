/**
 * Optional shared model picker (`klarkxy.model-picker` Factory).
 *
 * `@klarkxy/dsh-model-picker`, when installed, registers one root-scoped
 * Component Factory under `MODEL_PICKER_FACTORY`: an enhanced model menu with
 * a searchable provider-grouped list and a reasoning-effort slider, built on
 * the same ModelMenu recipe. Consumers keep their own ModelMenu as the
 * `fallback`; when no definition is registered the renderer resolves that
 * fallback verbatim, so the shared picker is strictly opt-in and every saved
 * value keeps its existing write path.
 *
 * `renderFactorySlot` is a framework-composed prop, never a context: the
 * component a plugin registers into any slot receives it automatically, but
 * the plugin must pass it down to whichever child renders the menu (or to the
 * render callback handed to registerSessionSettingsItem).
 *
 * The Factory manages its own open state; a consumer's `open`/`onOpenChange`
 * pair belongs to the fallback menu only and must not be fed to both.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MODEL_PICKER_FACTORY, MODEL_PICKER_ANCHOR_SLOT,
  type ModelPickerAnchorProps, type ModelPickerProps,
} from '@klarkxy/dsh-model-route/model-picker'

export {
  MODEL_PICKER_ANCHOR_SLOT,
  MODEL_PICKER_FACTORY,
  type ModelPickerAnchorProps,
  type ModelPickerLeadingItem,
  type ModelPickerProps,
  type ModelPickerStatus,
} from '@klarkxy/dsh-model-route/model-picker'
export type { RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The trigger every consumer used to hand its own ModelMenu, rebuilt as the
 * factory's `anchor` local component: identical classes and chevron, the menu
 * state coming from the occurrence's props instead of local open state.
 *
 * `ariaLabel` and `title` are the whole accessible name and tooltip (the
 * caller formats "field: current route" itself because the factory's resolved
 * caption may intentionally be a short name). The component identity stays
 * put across label changes — a new function would unmount the trigger, and
 * its cleanup would close a menu that `closeOnPick={false}` is keeping open.
 * The latest label, title, and `onClose` are read from refs.
 */
export function useModelMenuAnchor(ariaLabel: string, title?: string, onClose?: () => void): (props: ModelPickerAnchorProps) => ReactNode {
  const closeRef = useRef(onClose)
  const labelRef = useRef(ariaLabel)
  const titleRef = useRef(title)
  closeRef.current = onClose
  labelRef.current = ariaLabel
  titleRef.current = title
  return useMemo(() => {
    const ModelPickerTrigger = (props: ModelPickerAnchorProps): ReactNode => {
      /* A real unmount means the factory occurrence left (definition unloaded
       * or the row closed). `onOpenChange` only tracks user-driven opens, so
       * without this the fallback's shared open state could stay true. */
      useEffect(() => () => closeRef.current?.(), [])
      /* The factory injects its own aria set (aria-controls among them) plus
       * the caller's triggerClassName into the local component's props.
       * Forward exactly those attributes — a blanket {...props} spread would
       * leak framework props (including renderFactorySlot) onto the DOM. The
       * caller's label/title win over any injected aria-label; popup semantics
       * default to the mirror of the fallback trigger and yield to injected
       * values when present. */
      const record = props as unknown as Record<string, unknown>
      const injected: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(record)) {
        if (key.startsWith('aria-')) injected[key] = value
      }
      const extraClass = typeof record.className === 'string' ? ` ${record.className}` : ''
      return (
        <button
          type="button"
          className={`dsh-model-menu-trigger${extraClass}`}
          disabled={props.disabled}
          aria-haspopup="menu"
          aria-expanded={props.open}
          {...injected}
          aria-label={labelRef.current}
          title={titleRef.current}
        >
          <span className="dsh-model-menu-triggerLabel">{props.label}</span>
          {props.effortLabel ? <span className="dsh-model-menu-triggerEffort">{props.effortLabel}</span> : null}
          <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${props.open ? ' dsh-model-menu-chevronOpen' : ''}`} />
        </button>
      )
    }
    return ModelPickerTrigger
  }, [])
}

/**
 * Render the shared model picker while it is registered; `options.fallback`
 * whenever it is not (plugin absent, disabled, or unloaded).
 *
 * `options.anchor` is optional: the factory ships a default trigger, so only
 * consumers that need their own chrome (custom aria-label, tooltip, class)
 * pass one built with {@link useModelMenuAnchor}. The returned node is never
 * assumed to be the factory's own output — a defensive `?? fallback` covers a
 * renderer that yields null for an unregistered definition.
 */
export function renderModelPicker(
  renderFactorySlot: RenderFactorySlot | undefined,
  props: ModelPickerProps,
  options: {
    readonly anchor?: (props: ModelPickerAnchorProps) => ReactNode
    readonly fallback: ReactNode
  },
): ReactNode {
  if (typeof renderFactorySlot !== 'function') return options.fallback
  const rendered = renderFactorySlot(MODEL_PICKER_FACTORY, props, {
    ...(options.anchor ? { slots: { [MODEL_PICKER_ANCHOR_SLOT]: options.anchor } } : {}),
    fallback: options.fallback,
  })
  return rendered ?? options.fallback
}
