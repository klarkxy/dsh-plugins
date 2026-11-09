/**
 * Shared `klarkxy.model-picker` Factory contract.
 *
 * `@klarkxy/dsh-model-picker` registers one root-scoped Component Factory under
 * this name: a searchable model picker with a reasoning-effort slider, built on
 * the same ModelMenu recipe this package ships. Feature plugins opt in by
 * calling `renderFactorySlot('klarkxy.model-picker', props, options)` inside a
 * slot component; when no definition is registered the renderer resolves the
 * caller's `options.fallback`, so each consumer keeps its own native menu as
 * the fallback and gains the shared picker only while the plugin is installed.
 *
 * This entry is pure types and constants — no React, no host imports — so a
 * consumer can `import type` the declaration and the input/local props without
 * depending on the business plugin at runtime. The `SlotFactoryMap` merge is
 * what makes the `renderFactorySlot`/`registerFactory` calls type-check on
 * both sides; import it for the types only.
 */
import type { ModelMenuChoice, ModelCatalogFailure } from './catalog.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Registered Factory name — the `renderFactorySlot`/`registerFactory` key. */
export const MODEL_PICKER_FACTORY = 'klarkxy.model-picker'
/** The one caller-selectable local position: the trigger rendered in place. */
export const MODEL_PICKER_ANCHOR_SLOT = 'anchor'

/** Extra row the picker renders above the model groups (pure data; no React). */
export interface ModelPickerLeadingItem {
  readonly id: string
  readonly label: string
  readonly selected?: boolean
}

/** Status banner data the picker renders inside the menu header, above the groups. */
export interface ModelPickerStatus {
  /** Whole-request failure text; renders with a retry action. */
  readonly error?: string | null
  /** Advisory row (e.g. the saved route left the catalog); rendered warn-toned, no retry. */
  readonly warning?: string
  /** Whether the owner is loading or selecting (dims the banner). */
  readonly busy?: boolean
  /** Provider-local failures; still usable groups stay selectable. */
  readonly failures?: readonly ModelCatalogFailure[]
  /** Reload action the banner's retry buttons call. */
  readonly retry?: () => void
}

/**
 * Occurrence input (`renderFactorySlot` `props`). Everything here is data or
 * callbacks — React content travels through the `anchor` local slot instead.
 */
export interface ModelPickerProps {
  /** Active UI language; `'zh*'` selects the built-in Chinese copy. */
  readonly locale?: string
  /** Flat catalog choices (grouped internally by provider). */
  readonly choices: readonly ModelMenuChoice[]
  /** Current selection highlight. */
  readonly selected?: { readonly provider: string; readonly model: string }
  /** Model pick; the picker closes after the callback runs. */
  readonly onPick: (route: { provider: string; model: string }) => void
  /** Extra rows above the model groups (e.g. a "follow default" row). */
  readonly leading?: readonly ModelPickerLeadingItem[]
  /** Leading-row pick; `undefined` keeps the menu open. */
  readonly onPickLeading?: (id: string) => void
  /** Declared reasoning-effort rows; the slider is hidden while empty. */
  readonly efforts?: ReadonlyArray<{ id: string; name: string }>
  /** Current effort id; `''`/undefined marks the provider-default row. */
  readonly selectedEffort?: string
  /** Effort pick; the menu stays open. `undefined` = provider default. */
  readonly onPickEffort?: (effort: string | undefined) => void
  /** Disables the trigger and every menu action. */
  readonly disabled?: boolean
  /** Trigger caption; the default anchor falls back to localized "Select model". */
  readonly triggerLabel?: string
  /** Current effort caption shown after the trigger label ("model · high"). */
  readonly triggerEffortLabel?: string
  /** Extra class on the default trigger button. */
  readonly triggerClassName?: string
  /** Show a spinner instead of the chevron while a selection settles. */
  readonly busy?: boolean
  /** Extra class on the portaled menu card. */
  readonly listClassName?: string
  /** Menu opens on the searchable model pane ('model') or the root cells. */
  readonly initialPane?: 'root' | 'model'
  /** Show the search row even for a small catalog. */
  readonly alwaysShowSearch?: boolean
  /** Show the reasoning-effort slider under the model list (default true here). */
  readonly reasoningSlider?: boolean
  /** Status banner rendered inside the menu header (load failures, retry). */
  readonly status?: ModelPickerStatus
  /** Menu open-state changes; the owner may react (e.g. refresh the catalog). */
  readonly onOpenChange?: (open: boolean) => void
  /** Copy overrides; every key is optional. */
  readonly modelLabel?: string
  readonly modelValue?: string
  readonly effortLabel?: string
  readonly defaultEffortLabel?: string
  readonly searchPlaceholder?: string
  readonly emptyLabel?: string
  readonly clearSearchLabel?: string
  readonly retryLabel?: string
}

/** Props one `anchor` local component receives (plus the framework kit). */
export interface ModelPickerAnchorProps {
  /** Mirror of `aria-expanded`; true while the menu is open. */
  readonly open: boolean
  /** Disabled state passed down by the owner. */
  readonly disabled: boolean
  /** Whether a selection is settling; the default anchor shows a spinner. */
  readonly busy: boolean
  /** Resolved trigger caption. */
  readonly label: string
  /** Resolved effort caption appended to the caption, if any. */
  readonly effortLabel?: string
  /** Extra class on the trigger element. */
  readonly className?: string
  /** Anchored-popup marker the picker stamps on the trigger (always 'menu'). */
  readonly 'aria-haspopup'?: 'menu'
  /** Mirror of `open`, for ARIA-compliant custom anchors. */
  readonly 'aria-expanded'?: boolean
  /** Menu element id while the menu is mounted. */
  readonly 'aria-controls'?: string
  /** Resolved accessible name for the trigger. */
  readonly 'aria-label'?: string
  /** Set when the picker is disabled; custom anchors may read it instead of `disabled`. */
  readonly 'aria-disabled'?: boolean
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /**
     * Reusable model picker: one searchable provider-grouped model list plus an
     * optional reasoning-effort slider. Consumers call `renderFactorySlot` with
     * `ModelPickerProps`; `options.slots.anchor` may supply a custom trigger
     * component typed `ModelPickerAnchorProps`, and `options.fallback` is the
     * menu rendered while no `klarkxy.model-picker` definition is registered.
     */
    'klarkxy.model-picker': {
      scope: 'root'
      props: ModelPickerProps
      /** Occurrence inject face: the active-locale observable bound as a hook. */
      inject: { hooks: { activeLocale: HostObservable<{ active: string }> } }
      slots: {
        anchor: {
          scope: 'root'
          props: ModelPickerAnchorProps
        }
      }
      locale: 'model-picker'
    }
  }
  interface LocaleNamespaceMap {
    /** Copy owned by @klarkxy/dsh-model-picker. */
    'model-picker':
      | 'trigger.fallback' | 'trigger.aria' | 'trigger.ariaEffort'
      | 'menu.model' | 'menu.effort' | 'effort.providerDefault'
      | 'search.placeholder' | 'search.clear' | 'search.empty' | 'empty.models'
      | 'status.loading' | 'error.action' | 'action.retry' | 'warning.unroutable'
  }
}
