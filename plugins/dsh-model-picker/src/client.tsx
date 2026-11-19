/**
 * Model picker, browser half.
 *
 * Two surfaces ride one component:
 *
 * - `klarkxy.model-picker` (root Factory): the model picker offering both a
 *   periodic-table card grid (per-card provider selector, bottom reasoning-effort
 *   strip with optional unset state, resizable width, inline alias edit, and
 *   three-zone drag insert/swap) and the classic searchable list with a
 *   reasoning-effort slider. Feature plugins mount it through
 *   `renderFactorySlot`; while the definition is absent the renderer resolves
 *   the caller's `options.fallback`.
 * - `conversation.input.model` (single/session, priority -2): the composer
 *   model seat, shadowing the shipped entry (priority 0) and a reasoning-slider
 *   entry (priority -1). The ledger keeps every occupant, so unmounting this
 *   entry restores the previous winner — the native or reference seat returns
 *   automatically on disable/uninstall. The label child slot stays declared by
 *   the shadowed native entry, which means only it may render it; like
 *   reasoning-slider this seat renders the model name verbatim.
 *
 * The seat drives the same per-session ModelDirectory the native seat and the
 * /model popup share (catalog load, selection submission, pending/error
 * projection), so selection semantics stay host-owned.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { FactoryComponentPropsOf, FactoryLocalComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState, ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
/* Type-only merges: client Context services and the composer slot contract. */
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconChevronDownOutlineRegular, IconDataOutlineRegular, IconWarningOutlineRegular, StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { modelMenuEffortLabel, type ModelMenuChoice } from '@klarkxy/dsh-model-route'
import { ModelMenu, modelMenuCss } from '@klarkxy/dsh-model-route/ui'
import {
  MODEL_PICKER_ANCHOR_SLOT, MODEL_PICKER_FACTORY,
  type ModelPickerAnchorProps, type ModelPickerProps,
} from '@klarkxy/dsh-model-route/model-picker'
import { EffortPreference } from './effort-preference.ts'
import { installClientPluginLogger, type PluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import { PeriodicCardMenu, periodicCopy } from './periodic-cards.tsx'
import { periodicStore, type PeriodicPrefs } from './periodic-store.ts'

export const name = 'dsh-model-picker-client'
export const inject = ['slots', 'locale', 'sessions'] as const

/* The seat's cell: the native entry holds priority 0, reasoning-slider -1.
 * -2 makes this seat the winner while both are registered. */
const MODEL_SEAT_PRIORITY = -2

/* --------------------------------------------------------------------------
 * Locale
 * ------------------------------------------------------------------------ */

const NS = 'model-picker'
export const dictZh = {
  'trigger.fallback': '请选择模型',
  'trigger.aria': '选择模型，当前 {model}',
  'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
  'menu.model': '模型',
  'menu.effort': '推理等级',
  'effort.providerDefault': '跟随模型默认',
  'search.placeholder': '搜索模型…',
  'search.clear': '清除搜索',
  'search.empty': '没有匹配的模型。',
  'empty.models': '暂无可用模型',
  'status.loading': '正在刷新模型列表…',
  'error.action': '模型操作失败：{message}',
  'action.retry': '重试',
  'warning.unroutable': '当前模型不在可用目录中',
}
export const dictEn = {
  'trigger.fallback': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'search.placeholder': 'Search models…',
  'search.clear': 'Clear search',
  'search.empty': 'No matching models.',
  'empty.models': 'No models available.',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.retry': 'Retry',
  'warning.unroutable': 'The selected model is not in the available catalog',
}
type PickerKey = keyof typeof dictZh
type Translate = (key: PickerKey, params?: Record<string, unknown>) => string

function template(text: string, params?: Record<string, unknown>): string {
  return params ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : text
}

/** Copy resolver for tests and for faces that never got a framework `t`. */
export function pickerCopy(locale: string | undefined): Translate {
  const dict = locale?.toLowerCase().startsWith('zh') ? dictZh : dictEn
  return (key, params) => template(dict[key], params)
}

/* --------------------------------------------------------------------------
 * Styles — token whitelist only, scoped under .dsh-model-picker
 * ------------------------------------------------------------------------ */

export const modelPickerCss = `${modelMenuCss}
.dsh-model-picker-status {
  display: flex; flex-direction: column; gap: 4px; flex: none;
}
.dsh-model-picker-statusRow {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  border-radius: var(--dsw-radius-md); padding: 5px 7px;
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  font-size: 12px; line-height: 18px;
}
.dsh-model-picker-statusRow[data-tone="warn"] {
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-model-picker-statusText { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.dsh-model-picker-retry {
  color: inherit; font: inherit; font-weight: 600; cursor: pointer;
  background: none; border: none; padding: 0 2px; flex: none;
}
.dsh-model-picker-retry:hover:not(:disabled) { text-decoration: underline; }
.dsh-model-picker-retry:disabled { opacity: 0.6; cursor: default; }
.dsh-model-picker-triggerIcon { display: var(--dsh-composer-model-icon-display, none); flex: none; }
.dsh-model-picker-periodicSurface {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(680px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 80px));
  padding: 10px;
  border-radius: var(--dsw-radius-lg);
  box-shadow: var(--dsw-elevation-prominent);
  isolation: isolate;
}
.dsh-model-picker-periodicSurface:not([data-menu-material])::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: var(--dsw-menu-surface-fill);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  pointer-events: none;
}
.dsh-model-picker-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  flex: none;
}
.dsh-model-picker-viewSwitch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-model-picker-viewBtn {
  border: 0;
  border-radius: var(--dsw-radius-sm);
  padding: 2px 8px;
  font: inherit;
  font-size: 11px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
  transition: background-color var(--ds-transition-duration) var(--ds-ease-in-out),
    color var(--ds-transition-duration) var(--ds-ease-in-out);
}
.dsh-model-picker-viewBtn:hover { color: var(--dsw-alias-label-primary); }
.dsh-model-picker-viewBtn[data-active] {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  box-shadow: var(--dsw-elevation-soft);
}
.dsh-model-picker-listSwitchRow {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 4px;
}
.dsh-model-picker-widthControl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-model-picker-widthSlider {
  width: 78px;
  accent-color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
}
.dsh-model-picker-resetBtn {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  padding: 2px 7px;
  font: inherit;
  font-size: 11px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.dsh-model-picker-resetBtn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-model-picker-periodicHeader { flex: none; }
.dsh-model-picker-leadingRow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: none;
}
.dsh-model-picker-leadingChip {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  cursor: pointer;
}
.dsh-model-picker-leadingChip:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-model-picker-leadingChipActive {
  border-color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);
  color: var(--dsw-alias-state-business-primary);
  font-weight: 500;
}
.dsh-model-picker-empty {
  padding: 18px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-model-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--_card-w, 168px), 1fr));
  gap: 8px;
  overflow-y: auto;
  padding: 4px 2px;
  min-height: 0;
  flex: 1 1 auto;
}
.dsh-model-picker-card {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  border-radius: var(--dsw-radius-md);
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  cursor: grab;
  user-select: none;
  transition: background-color var(--ds-transition-duration) var(--ds-ease-in-out),
    border-color var(--ds-transition-duration) var(--ds-ease-in-out),
    box-shadow var(--ds-transition-duration) var(--ds-ease-in-out),
    opacity var(--ds-transition-duration) var(--ds-ease-in-out);
}
.dsh-model-picker-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l4);
}
.dsh-model-picker-cardActive {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, var(--dsw-alias-bg-layer-1));
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, transparent);
}
.dsh-model-picker-cardMenuOpen { z-index: 40; }
.dsh-model-picker-cardDragging { opacity: 0.35; cursor: grabbing; }
.dsh-model-picker-card[data-drop='before']::before,
.dsh-model-picker-card[data-drop='after']::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  pointer-events: none;
  z-index: 20;
}
.dsh-model-picker-card[data-drop='before']::before { left: -6px; }
.dsh-model-picker-card[data-drop='after']::after { right: -6px; }
.dsh-model-picker-card[data-drop='swap'] {
  border-style: dashed;
  border-color: var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, var(--dsw-alias-bg-layer-1));
}
.dsh-model-picker-card[data-drop='swap']::after {
  content: attr(data-swap-label);
  position: absolute;
  top: -9px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  font-weight: 600;
  color: var(--dsw-alias-bg-layer-1);
  background: var(--dsw-alias-state-warn-primary);
  pointer-events: none;
  z-index: 30;
}
.dsh-model-picker-cardHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 6px 7px 0 8px;
  min-height: 22px;
}
.dsh-model-picker-seqWrap {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
}
.dsh-model-picker-seq {
  font-family: var(--ds-font-family-code);
  font-size: 10px;
  line-height: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-caption);
}
.dsh-model-picker-cardActive .dsh-model-picker-seq {
  color: var(--dsw-alias-state-business-primary);
}
.dsh-model-picker-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-label-caption);
}
.dsh-model-picker-dot[data-tone='business'] { background: var(--dsw-alias-state-business-primary); }
.dsh-model-picker-dot[data-tone='success'] { background: var(--dsw-alias-state-success-primary); }
.dsh-model-picker-dot[data-tone='warn'] { background: var(--dsw-alias-state-warn-primary); }
.dsh-model-picker-provBtn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 100px;
  padding: 1px 5px;
  border: 0.5px solid transparent;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 10.5px;
  line-height: 16px;
  cursor: pointer;
}
.dsh-model-picker-provBtn:hover:not(:disabled),
.dsh-model-picker-provBtn[data-open] {
  border-color: var(--dsw-alias-border-l4);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-model-picker-provBtn:disabled { opacity: 0.55; cursor: default; }
.dsh-model-picker-provText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-model-picker-provCaret { font-size: 9px; flex: none; opacity: 0.75; }
.dsh-model-picker-provMenu {
  position: absolute;
  top: 28px;
  right: 6px;
  min-width: 140px;
  max-width: 220px;
  padding: 4px;
  border-radius: var(--dsw-radius-md);
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: var(--dsw-elevation-prominent);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 60;
}
.dsh-model-picker-provMenuLabel {
  padding: 2px 6px;
  font-size: 10px;
  line-height: 14px;
  color: var(--dsw-alias-label-caption);
}
.dsh-model-picker-provOption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11.5px;
  line-height: 16px;
  text-align: left;
  cursor: pointer;
}
.dsh-model-picker-provOption:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-model-picker-provOptionActive {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);
  color: var(--dsw-alias-state-business-primary);
  font-weight: 500;
}
.dsh-model-picker-provOptionLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-model-picker-cardBody {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 2px;
  padding: 8px 8px 10px;
  cursor: pointer;
  outline: none;
}
.dsh-model-picker-cardBody:focus-visible {
  box-shadow: inset 0 0 0 var(--dsw-focus-ring-width) var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dsh-model-picker-symbolLine {
  display: inline-flex;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
}
.dsh-model-picker-short {
  font-family: var(--ds-font-family-code);
  font-size: 20px;
  line-height: 24px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  letter-spacing: -0.02em;
}
.dsh-model-picker-ver {
  font-family: var(--ds-font-family-code);
  font-size: 10px;
  line-height: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  padding-top: 2px;
}
.dsh-model-picker-cardActive .dsh-model-picker-ver {
  color: var(--dsw-alias-state-business-primary);
}
.dsh-model-picker-shortInput {
  width: 78px;
  padding: 1px 4px;
  border: 1px solid var(--dsw-alias-state-business-primary);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code);
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  outline: none;
}
.dsh-model-picker-full {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  line-height: 15px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-model-picker-effortBar {
  display: grid;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 0 0 calc(var(--dsw-radius-md) - 1px) calc(var(--dsw-radius-md) - 1px);
  overflow: hidden;
  margin-top: auto;
}
.dsh-model-picker-effortCell {
  border: 0;
  padding: 4px 2px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 10.5px;
  line-height: 15px;
  text-align: center;
  cursor: pointer;
  transition: background-color var(--ds-transition-duration) var(--ds-ease-in-out),
    color var(--ds-transition-duration) var(--ds-ease-in-out);
}
.dsh-model-picker-effortCell + .dsh-model-picker-effortCell {
  border-left: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-model-picker-effortCell:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-model-picker-effortCell:disabled { opacity: 0.5; cursor: default; }
.dsh-model-picker-effortCellActive {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
  color: var(--dsw-alias-state-business-primary);
  font-weight: 600;
}
.dsh-model-picker-foot {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-caption);
  flex: none;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-model-picker-viewBtn, .dsh-model-picker-card, .dsh-model-picker-effortCell {
    transition: none;
  }
}
`

/* --------------------------------------------------------------------------
 * Catalog shape adapters
 * ------------------------------------------------------------------------ */

/** Directory provider groups → flat ModelMenu choices. */
export function directoryChoices(groups: ModelDirectoryState['groups'], bound?: { provider: string; model: string }): ModelMenuChoice[] {
  const choices: ModelMenuChoice[] = []
  for (const group of groups) {
    const providerName = group.name || group.id
    for (const model of group.models) {
      choices.push({
        provider: group.id,
        model: model.id,
        label: `${providerName} / ${model.name || model.id}`,
        providerLabel: providerName,
        efforts: (model.reasoning?.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name || effort.id })),
      })
    }
  }
  if (bound?.provider && bound.model && !choices.some(item => item.provider === bound.provider && item.model === bound.model)) {
    choices.push({ provider: bound.provider, model: bound.model, label: `${bound.provider} / ${bound.model}`, efforts: [] })
  }
  return choices
}

function reasoningOf(groups: ModelDirectoryState['groups'], provider: string, model: string) {
  return groups.find(group => group.id === provider)?.models.find(entry => entry.id === model)?.reasoning
}

/** Route key only when the saved model is absent from the catalog. Effort-only
 * snapshot updates must not change this — a new `current` object is not a new list. */
function outsideCatalogKey(groups: ModelDirectoryState['groups'], current: { provider: string; model: string } | null): string {
  if (!current) return ''
  for (const group of groups) {
    if (group.id !== current.provider) continue
    if (group.models.some(model => model.id === current.model)) return ''
  }
  return `${current.provider}\0${current.model}`
}

/* --------------------------------------------------------------------------
 * Default anchor (the trigger rendered in place of the caller's row)
 * ------------------------------------------------------------------------ */

export type AnchorComponent = (props: ModelPickerAnchorProps & Record<string, unknown>) => ReactNode

/**
 * DOM attributes the anchor forwards: framework-stamped ARIA, identity and
 * style fields, and event handlers. Everything else in the local props —
 * injected kit members and hook objects — never reaches the DOM.
 */
const TRIGGER_FORWARD = /^(aria-|data-|id$|className$|style$|title$|role$|tabIndex$|on[A-Z])/

/**
 * The trigger every occurrence gets unless the caller selects its own
 * `anchor` local component. It mirrors the composer's model pill: icon +
 * label + effort caption + chevron (spinner while busy).
 */
function DefaultTrigger(props: ModelPickerAnchorProps & Record<string, unknown>): ReactNode {
  const { open, disabled, busy, label, effortLabel, className, ...rest } = props as ModelPickerAnchorProps & Record<string, unknown>
  const forward: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rest)) if (TRIGGER_FORWARD.test(key)) forward[key] = value
  return <button
    type="button"
    {...forward}
    className={`dsh-model-menu-trigger${className ? ` ${className}` : ''}`}
    disabled={disabled || undefined}
    title={effortLabel ? `${label} · ${effortLabel}` : label}
  >
    <IconDataOutlineRegular className="dsh-model-picker-triggerIcon" size={16} />
    <span className="dsh-model-menu-triggerLabel">{label}</span>
    {effortLabel !== undefined
      ? <span className="dsh-model-menu-triggerEffort">{effortLabel}</span>
      : null}
    {busy
      ? <StateDot state="ongoing" />
      : <IconChevronDownOutlineRegular className={`dsh-model-menu-chevron${open ? ' dsh-model-menu-chevronOpen' : ''}`} />}
  </button>
}

/* --------------------------------------------------------------------------
 * Factory definition component
 * ------------------------------------------------------------------------ */

type ModelPickerInternalProps = ModelPickerProps & {
  /** Optional atomic route + effort callback used by ComposerModelSeat for card clicks. */
  readonly onPickWithEffort?: (route: { provider: string; model: string }, effort: string | undefined) => void
}
type ModelPickerComponentProps = FactoryComponentPropsOf<'klarkxy.model-picker'>

/**
 * One picker occurrence. `props` is the consumer's ModelPickerProps plus the
 * framework seats (`t`, `useFactorySlot`, injected hooks). Supports toggling
 * between the periodic card grid (`cards`) and the classic searchable list
 * with reasoning slider (`list`), persisted per browser.
 */
export function ModelPicker(props: ModelPickerComponentProps): ReactNode {
  const { t, useFactorySlot, useActiveLocale, ...input } = props as ModelPickerComponentProps & ModelPickerInternalProps
  const activeLocale = useActiveLocale ? String(useActiveLocale(snapshot => snapshot.active)) : 'en'
  const [open, setOpen] = useState(false)
  // One module-level store owns the shared localStorage key: every occurrence
  // sees the same snapshot and one commit path persists it (P1 multi-instance
  // stale-overwrite fix; store shape mirrors dsh-font's conversation store).
  const prefsStore = periodicStore()
  const prefs = useSyncExternalStore(
    useCallback((onStoreChange: () => void) => prefsStore.subscribe(onStoreChange), [prefsStore]),
    useCallback(() => prefsStore.get(), [prefsStore]),
    useCallback(() => prefsStore.get(), [prefsStore]),
  )
  const updatePrefs = useCallback((updater: (prev: PeriodicPrefs) => PeriodicPrefs): void => {
    prefsStore.set(updater(prefsStore.get()))
  }, [prefsStore])

  const disabled = input.disabled === true
  const busy = input.busy === true
  const gatedRef = useRef(disabled || busy)
  gatedRef.current = disabled || busy
  const setMenuOpenRef = useRef((_next: boolean): void => {})
  setMenuOpenRef.current = (next: boolean): void => {
    if (disabled && next) return
    setOpen(next)
    input.onOpenChange?.(next)
  }
  const setMenuOpen = (next: boolean): void => setMenuOpenRef.current(next)

  const language = input.locale ?? activeLocale
  const cardCopy = useMemo(() => periodicCopy(language), [language])
  const selected = input.selected
  const selectedChoice = useMemo(
    () => input.choices.find(choice => choice.provider === selected?.provider && choice.model === selected.model),
    [input.choices, selected?.provider, selected?.model])
  const triggerLabel = input.triggerLabel ?? selectedChoice?.label ?? (selected ? `${selected.provider} / ${selected.model}` : t('trigger.fallback'))
  const effortRows = input.efforts ?? []
  const selectedEffort = input.selectedEffort ?? ''
  const triggerEffortLabel = input.triggerEffortLabel
    ?? (selectedEffort
      ? modelMenuEffortLabel(effortRows.find(row => row.id === selectedEffort) ?? { id: selectedEffort, name: selectedEffort }, language)
      : effortRows.length > 0 ? input.defaultEffortLabel ?? t('effort.providerDefault') : undefined)

  const status = input.status
  const loading = status?.busy === true && input.choices.length === 0
  const statusBanner = status && (loading || status.error || status.warning || (status.failures?.length ?? 0) > 0)
    ? <div className="dsh-model-picker-status" role={status.error ? 'alert' : 'status'}>
        {loading
          ? <div className="dsh-model-picker-statusRow" data-tone="info">
              <span className="dsh-model-picker-statusText">{t('status.loading')}</span>
            </div>
          : null}
        {status.warning
          ? <div className="dsh-model-picker-statusRow" data-tone="warn">
              <span className="dsh-model-picker-statusText">{status.warning}</span>
            </div>
          : null}
        {status.error
          ? <div className="dsh-model-picker-statusRow">
              <span className="dsh-model-picker-statusText">{t('error.action', { message: status.error })}</span>
              {status.retry ? <button type="button" className="dsh-model-picker-retry" disabled={disabled} onClick={() => status.retry?.()}>{input.retryLabel ?? t('action.retry')}</button> : null}
            </div>
          : null}
        {(status.failures ?? []).map(failure => <div key={failure.id} className="dsh-model-picker-statusRow" data-tone="warn">
          <span className="dsh-model-picker-statusText">{failure.name || failure.id}: {failure.message}</span>
          {status.retry ? <button type="button" className="dsh-model-picker-retry" disabled={disabled} onClick={() => status.retry?.()}>{input.retryLabel ?? t('action.retry')}</button> : null}
        </div>)}
      </div>
    : undefined

  const listMenuHeader = <>
    <div className="dsh-model-picker-listSwitchRow">
      <div className="dsh-model-picker-viewSwitch" role="group" aria-label={input.modelLabel ?? t('menu.model')}>
        <button
          type="button"
          className="dsh-model-picker-viewBtn"
          aria-pressed={false}
          onClick={() => updatePrefs(prev => ({ ...prev, viewMode: 'cards' }))}
        >
          {cardCopy.viewCards}
        </button>
        <button
          type="button"
          className="dsh-model-picker-viewBtn"
          data-active=""
          aria-pressed={true}
        >
          {cardCopy.viewList}
        </button>
      </div>
    </div>
    {statusBanner}
  </>

  const gate = <A extends unknown[]>(fn: ((...args: A) => void) | undefined): ((...args: A) => void) =>
    (...args) => { if (!gatedRef.current) fn?.(...args) }

  const pickCard = useCallback((route: { provider: string; model: string }, effort: string | undefined): void => {
    if (gatedRef.current) return
    if (input.onPickWithEffort) {
      input.onPickWithEffort(route, effort)
      return
    }
    const sameRoute = selected?.provider === route.provider && selected?.model === route.model
    if (!sameRoute) input.onPick(route)
    if (input.onPickEffort && (sameRoute || effort !== undefined)) input.onPickEffort(effort)
  }, [input.onPickWithEffort, input.onPick, input.onPickEffort, selected?.provider, selected?.model])

  const Anchor = useFactorySlot(MODEL_PICKER_ANCHOR_SLOT, DefaultTrigger as FactoryLocalComponent<'klarkxy.model-picker', 'anchor'>)
  const anchor = <Anchor
    open={open}
    disabled={disabled}
    busy={busy}
    label={triggerLabel}
    effortLabel={triggerEffortLabel}
    className={input.triggerClassName}
    aria-label={triggerEffortLabel
      ? t('trigger.ariaEffort', { model: triggerLabel, effort: triggerEffortLabel })
      : t('trigger.aria', { model: triggerLabel })}
  />

  return <>
    <style data-plugin="@klarkxy/dsh-model-picker">{modelPickerCss}</style>
    {prefs.viewMode === 'cards' ? (
      <PeriodicCardMenu
        locale={language}
        open={open}
        onOpenChange={setMenuOpen}
        anchor={anchor}
        choices={input.choices}
        selected={input.selected}
        selectedEffort={selectedEffort}
        leading={input.leading ?? []}
        onPickLeading={gate(input.onPickLeading)}
        onPickCard={pickCard}
        menuHeader={statusBanner}
        disabled={disabled}
        busy={busy}
        emptyLabel={input.emptyLabel ?? (input.choices.length === 0 ? t('empty.models') : t('search.empty'))}
        modelLabel={input.modelLabel ?? t('menu.model')}
        listClassName={input.listClassName}
        prefs={prefs}
        onPrefsChange={updatePrefs}
      />
    ) : (
      <ModelMenu
        locale={language}
        open={open}
        onOpenChange={setMenuOpen}
        anchor={anchor}
        choices={input.choices}
        selected={input.selected}
        onPick={gate(input.onPick)}
        leading={input.leading ?? []}
        onPickLeading={gate(input.onPickLeading)}
        menuHeader={listMenuHeader}
        disabled={disabled}
        busy={busy}
        efforts={effortRows}
        selectedEffort={selectedEffort}
        onPickEffort={gate(input.onPickEffort)}
        modelLabel={input.modelLabel ?? t('menu.model')}
        modelValue={input.modelValue ?? triggerLabel}
        effortLabel={input.effortLabel ?? t('menu.effort')}
        defaultEffortLabel={input.defaultEffortLabel ?? t('effort.providerDefault')}
        searchPlaceholder={input.searchPlaceholder ?? t('search.placeholder')}
        emptyLabel={input.emptyLabel ?? (input.choices.length === 0 ? t('empty.models') : t('search.empty'))}
        clearSearchLabel={input.clearSearchLabel ?? t('search.clear')}
        initialPane={input.initialPane ?? 'model'}
        alwaysShowSearch={input.alwaysShowSearch ?? true}
        reasoningSlider={input.reasoningSlider ?? true}
        closeOnPick={false}
        closeOnDisable={false}
        listClassName={`dsh-model-picker${input.listClassName ? ` ${input.listClassName}` : ''}`}
        className="dsh-model-picker"
      />
    )}
  </>
}

/* --------------------------------------------------------------------------
 * Composer seat
 * ------------------------------------------------------------------------ */

interface SeatProps {
  sessionId: string
  locked: boolean
  t: Translate
}

/** The seat's injected face equals the native ModelSelectInjected. */
type InjectedSeatProps = SeatProps & ModelSelectInjected & {
  renderFactorySlot?: (name: string, props: unknown, options?: { fallback?: ReactNode }) => ReactNode
}

/**
 * The composer model seat: the same injected face the native entry exposes,
 * rendered through the shared factory so the composer and every consumer
 * share one picker implementation. The bare ModelMenu below is the last-ditch
 * path for a missing factory — the seat never loses its control.
 */
export function ComposerModelSeat(props: InjectedSeatProps): ReactNode {
  const { t } = props
  const directory = props.directory
  const subscribeDirectory = useCallback((onStoreChange: () => void) => directory.subscribe(onStoreChange), [directory])
  const snapshotDirectory = useCallback(() => directory.getSnapshot(), [directory])
  const state = useSyncExternalStore(subscribeDirectory, snapshotDirectory, snapshotDirectory)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  const groups = state.groups
  const current = state.current
  const outsideKey = outsideCatalogKey(groups, current)
  const choices = useMemo(() => directoryChoices(
    groups,
    outsideKey === '' ? undefined : { provider: outsideKey.slice(0, outsideKey.indexOf('\0')), model: outsideKey.slice(outsideKey.indexOf('\0') + 1) },
  ), [groups, outsideKey])
  const selectedChoice = choices.find(choice => choice.provider === current?.provider && choice.model === current.model)
  const reasoning = current ? reasoningOf(groups, current.provider, current.model) : undefined
  const efforts = useMemo(() => [...(selectedChoice?.efforts ?? [])], [selectedChoice])
  const busy = state.status === 'selecting' || state.pending !== null

  useEffect(() => { props.load() }, [props.load])
  const onMenuOpenChange = (next: boolean): void => { if (next) props.load() }

  const report = (error: { code: string; message: string }): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text: t('error.action', { message: `${error.code}: ${error.message}` }) })
  }
  const submit = (selection: { provider: string; model: string; reasoningEffort?: string }): void => {
    void props.select(selection).then(result => {
      if (result !== undefined && !result.ok) report(result.error)
    }).catch(error => report({ code: 'model-picker/error', message: error instanceof Error ? error.message : String(error) }))
  }
  const unroutable = state.routable === false && current !== null
  const pickModel = (route: { provider: string; model: string }): void => {
    if (current?.provider === route.provider && current.model === route.model) return
    if (unroutable && route.provider === current.provider && route.model === current.model) return
    submit({ provider: route.provider, model: route.model })
  }
  const pickEffort = (effort: string | undefined): void => {
    if (!current) return
    if ((current.reasoningEffort ?? undefined) === effort) return
    submit({ provider: current.provider, model: current.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
  }
  /**
   * Card click handler: passing `reasoningEffort: undefined` as an explicit
   * own property tells `createPreferredSelect` to omit reasoning effort instead
   * of replaying remembered effort, matching "click center = no effort".
   */
  const pickCard = (route: { provider: string; model: string }, effort: string | undefined): void => {
    if (unroutable && route.provider === current.provider && route.model === current.model) return
    if (current?.provider === route.provider && current.model === route.model && (current.reasoningEffort ?? undefined) === effort) return
    submit({ provider: route.provider, model: route.model, reasoningEffort: effort })
  }

  const modelName = selectedChoice
    ? (selectedChoice.label.split(' / ').slice(1).join(' / ') || selectedChoice.model)
    : current?.model ?? t('trigger.fallback')
  const effortLabel = reasoning === undefined
    ? state.retainedEffort
    : current?.reasoningEffort !== undefined
      ? modelMenuEffortLabel(reasoning.efforts.find(row => row.id === current?.reasoningEffort) ?? { id: current?.reasoningEffort ?? '', name: current?.reasoningEffort ?? '' }, undefined)
      : reasoning.efforts.length > 0 || reasoning.defaultEffort !== undefined
        ? t('effort.providerDefault')
        : undefined

  if (!props.available) return null

  const fallback = <ModelMenuFallback
    t={t}
    state={state}
    choices={choices}
    efforts={efforts}
    savedEffort={current?.reasoningEffort}
    effortLabel={effortLabel}
    modelName={modelName}
    locked={props.locked}
    busy={busy}
    onPick={pickModel}
    onPickEffort={pickEffort}
    onOpen={onMenuOpenChange}
    onRetry={() => props.load()}
  />

  const pickerProps: ModelPickerInternalProps = {
    choices,
    selected: current ? { provider: current.provider, model: current.model } : undefined,
    onPick: pickModel,
    onPickWithEffort: pickCard,
    efforts,
    selectedEffort: current?.reasoningEffort ?? '',
    onPickEffort: pickEffort,
    disabled: props.locked,
    busy,
    triggerLabel: modelName,
    triggerEffortLabel: effortLabel,
    onOpenChange: onMenuOpenChange,
    status: {
      error: state.error,
      busy: state.status === 'loading',
      warning: unroutable ? t('warning.unroutable') : undefined,
      failures: state.failures,
      retry: () => props.load(),
    },
  }

  return <span ref={rootRef} className="dsh-model-picker">
    {props.renderFactorySlot ? props.renderFactorySlot(MODEL_PICKER_FACTORY, pickerProps, { fallback }) : fallback}
    {toast !== null && <Toast
      key={toast.seq}
      text={toast.text}
      icon={<IconWarningOutlineRegular />}
      anchor={rootRef.current?.closest('[data-composer-card]') ?? rootRef.current}
      onDone={() => setToast(null)}
    />}
  </span>
}

/** Bare-menu fallback used only if the factory never registered. */
function ModelMenuFallback(props: {
  t: Translate
  state: ModelDirectoryState
  choices: ModelMenuChoice[]
  efforts: { id: string; name: string }[]
  savedEffort: string | undefined
  effortLabel: string | undefined
  modelName: string
  locked: boolean
  busy: boolean
  onPick(route: { provider: string; model: string }): void
  onPickEffort(effort: string | undefined): void
  onOpen(next: boolean): void
  onRetry(): void
}): ReactNode {
  const { t, state } = props
  const [open, setOpen] = useState(false)
  useEffect(() => { if (props.locked) setOpen(false) }, [props.locked])
  const gated = props.locked || props.busy
  const unroutable = state.routable === false && state.current !== null
  const loading = state.status === 'loading' && props.choices.length === 0
  const menuHeader = (loading || state.error || unroutable || state.failures.length > 0)
    ? <div className="dsh-model-picker-status" role={state.error ? 'alert' : 'status'}>
        {loading
          ? <div className="dsh-model-picker-statusRow" data-tone="info">
              <span className="dsh-model-picker-statusText">{t('status.loading')}</span>
            </div>
          : null}
        {unroutable
          ? <div className="dsh-model-picker-statusRow" data-tone="warn">
              <span className="dsh-model-picker-statusText">{t('warning.unroutable')}</span>
            </div>
          : null}
        {state.error
          ? <div className="dsh-model-picker-statusRow">
              <span className="dsh-model-picker-statusText">{t('error.action', { message: state.error })}</span>
              <button type="button" className="dsh-model-picker-retry" disabled={gated} onClick={props.onRetry}>{t('action.retry')}</button>
            </div>
          : null}
        {state.failures.map(failure => <div key={failure.id} className="dsh-model-picker-statusRow" data-tone="warn">
          <span className="dsh-model-picker-statusText">{failure.name || failure.id}: {failure.message}</span>
          <button type="button" className="dsh-model-picker-retry" disabled={gated} onClick={props.onRetry}>{t('action.retry')}</button>
        </div>)}
      </div>
    : undefined
  return <>
    <style data-plugin="@klarkxy/dsh-model-picker">{modelPickerCss}</style>
    <ModelMenu
      locale="en"
      open={open && !props.locked}
      onOpenChange={next => {
        if (props.locked) return
        setOpen(next)
        if (next) props.onOpen(next)
      }}
      anchor={<DefaultTrigger open={open} disabled={gated} busy={props.busy} label={props.modelName} effortLabel={props.effortLabel} aria-label={props.effortLabel ? t('trigger.ariaEffort', { model: props.modelName, effort: props.effortLabel }) : t('trigger.aria', { model: props.modelName })} />}
      choices={props.choices}
      selected={state.current ? { provider: state.current.provider, model: state.current.model } : undefined}
      onPick={route => { if (!gated) props.onPick(route) }}
      menuHeader={menuHeader}
      disabled={props.locked}
      busy={props.busy}
      efforts={props.efforts}
      selectedEffort={props.savedEffort ?? ''}
      onPickEffort={effort => { if (!gated) props.onPickEffort(effort) }}
      modelLabel={t('menu.model')}
      modelValue={props.modelName}
      effortLabel={t('menu.effort')}
      defaultEffortLabel={t('effort.providerDefault')}
      searchPlaceholder={t('search.placeholder')}
      emptyLabel={t('empty.models')}
      clearSearchLabel={t('search.clear')}
      initialPane="model"
      alwaysShowSearch
      reasoningSlider
      closeOnPick={false}
      listClassName="dsh-model-picker"
      className="dsh-model-picker"
    />
  </>
}

/* --------------------------------------------------------------------------
 * Plugin apply
 * ------------------------------------------------------------------------ */

/**
 * Wrap one per-session `ModelDirectory.select` with the page-lifetime effort
 * memory: a cross-route pick with no `reasoningEffort` property re-attaches the
 * route's last successful human pick (only while the catalog still declares it).
 * An explicit `{ reasoningEffort: undefined }` property (such as clicking the
 * center of a periodic card) omits reasoning effort and clears memory on success.
 */
export function createPreferredSelect(
  directory: { store: ModelSelectInjected['directory']; select: ModelSelectInjected['select'] },
  preference: EffortPreference,
  logger?: PluginLogger,
): ModelSelectInjected['select'] {
  return async selection => {
    const state = directory.store.getSnapshot()
    const current = state.current
    const sameRoute = current !== null && current.provider === selection.provider && current.model === selection.model
    const explicitClear = Object.prototype.hasOwnProperty.call(selection, 'reasoningEffort') && selection.reasoningEffort === undefined
    let final: { provider: string; model: string; reasoningEffort?: string } = explicitClear
      ? { provider: selection.provider, model: selection.model }
      : selection
    if (!sameRoute && !explicitClear && selection.reasoningEffort === undefined) {
      const reasoning = state.groups
        .find(group => group.id === selection.provider)?.models
        .find(model => model.id === selection.model)?.reasoning
      const effort = preference.resolve(selection, reasoning === undefined ? undefined : { efforts: reasoning.efforts.map(row => row.id) })
      if (effort !== undefined) final = { ...selection, reasoningEffort: effort }
    }
    const result = await directory.select(final)
    if (result?.ok === true) {
      preference.remember(final, final.reasoningEffort)
      logger?.debug('model.selected', 'Applied model selection.', {
        provider: final.provider,
        model: final.model,
        effort: final.reasoningEffort ?? null,
      })
    } else if (result && result.ok === false) {
      logger?.warn('model.select-rejected', 'Model selection failed.', undefined, {
        provider: final.provider,
        model: final.model,
      })
    }
    return result
  }
}

export function apply(ctx: Context): void {
  const logger = installClientPluginLogger(ctx, '@klarkxy/dsh-model-picker')
  const preference = new EffortPreference()

  ctx.effect(() => {
    const zh = ctx.locale?.register(NS, 'zh', dictZh)
    const en = ctx.locale?.register(NS, 'en', dictEn)
    return () => { zh?.(); en?.() }
  })

  ctx.slots.registerFactory({
    name: MODEL_PICKER_FACTORY,
    scope: 'root',
    locale: NS,
    inject: () => ({ hooks: { activeLocale: ctx.locale } }),
    slots: { [MODEL_PICKER_ANCHOR_SLOT]: { scope: 'root' } },
  }, ModelPicker as never)

  ctx.inject(['modelDirectories'], scope => {
    const directories = scope.modelDirectories
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      priority: MODEL_SEAT_PRIORITY,
      locale: NS,
      inject: (sessionId): ModelSelectInjected => {
        const unavailable: ModelSelectInjected = {
          available: false,
          directory: {
            getSnapshot: () => EMPTY_STATE,
            subscribe: () => () => {},
            update: () => {},
            set: () => {},
          },
          load: () => {},
          resolveText: text => ctx.locale?.resolveText(text) ?? String(text),
          select: async () => undefined,
        }
        if (scope.sessions?.subagentAddress?.(sessionId) !== undefined) return unavailable
        try {
          const directory = directories.directoryFor(sessionId)
          return {
            available: true,
            directory: directory.store,
            load: () => {
              void directory.load().catch(error => {
                logger.warn('directory.load-failed', 'Model directory load failed.', error, { sessionId })
              })
            },
            resolveText: text => ctx.locale?.resolveText(text) ?? String(text),
            select: createPreferredSelect(directory, preference, logger),
          }
        } catch (error) {
          logger.warn('directory.unavailable', 'Could not resolve model directory for session.', error, { sessionId })
          return unavailable
        }
      },
    }, ComposerModelSeat as never))
  })
}

const EMPTY_STATE: ModelDirectoryState = { current: null, routable: null, groups: [], failures: [], status: 'idle', pending: null, error: null }
