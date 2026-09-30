/**
 * Shared contract that keeps every plugin's browser-side UI on the official
 * DeepSeek Harness Web design language.
 *
 * Two rules produce that language, and both are load-bearing here:
 *
 * 1. Colour, radius, elevation and focus come from the host theme's real
 *    `--dsw-*` tokens, written under their own names. Plugins never invent a
 *    token, never alias the official ones behind a private palette (a private
 *    alias is just a second, diverging theme), and never carries a literal
 *    fallback — the host publishes light and dark, and a literal would pin one
 *    of them. The only non-colour custom properties used are the host's own
 *    content-font axis and frame clearance.
 *
 * 2. Anything the host already ships is used, not reimplemented. Controls come
 *    from `@deepseek-ai/dsh-client-ui-primitives` (`Button`, `Input`,
 *    `Checkbox`, `Switch`, `Tag`, `Pill`, `SegmentedControl`, `Menu`, `Modal`,
 *    `Tooltip`, `Toast`, `DisclosureRow`, `StateDot`, `PathLabel`, the settings
 *    form suite). This module only styles what primitives do not cover: page
 *    scaffolding, field layout, banners, empty states and scroll regions.
 *
 * The metrics below are transcribed from the primitives' own CSS modules so a
 * feature panel lines up pixel-for-pixel with a native one: the 14/22 body and
 * 13/20 compact type tiers, the 0.5px hairline scale, and the elevation family
 * that draws a surface's edge in its shadow (`border: 0`) instead of a border.
 */

/**
 * Every `--dsw-*` token this repo is allowed to reference, grouped by role.
 *
 * Plugins may only colour through this list. It is exported so the guard test
 * can fail a build when a stylesheet reaches for anything else — the failure
 * mode this prevents is silent: an unknown token resolves to nothing, so a
 * border disappears or a label inherits the wrong colour with no error anywhere.
 */
export const OFFICIAL_THEME_TOKENS = {
  /** Surfaces, from the page up to the topmost nested card. */
  surface: [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-layer-3',
    '--dsw-alias-bg-layer-4',
    '--dsw-alias-bg-module-platform',
    '--dsw-alias-bg-overlay',
  ],
  /** Hairlines. l1 is near-invisible on a menu surface, so menus use l2+. */
  border: ['--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4'],
  /** Text. `caption` is menu shortcut text, `dimmed` is placeholder text. */
  label: [
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-label-caption',
    '--dsw-alias-label-dimmed',
    '--dsw-alias-label-error',
    '--dsw-alias-label-primary-foreground',
  ],
  /** Interactive fills. The `-danger` hover belongs to destructive rows. */
  interactive: [
    '--dsw-alias-interactive-bg-hover',
    '--dsw-alias-interactive-bg-active',
    '--dsw-alias-interactive-bg-hover-danger',
  ],
  /** Accent and status. `business` is the focus ring's default colour. */
  accent: [
    '--dsw-alias-brand-primary',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-button-primary-hover',
    '--dsw-alias-button-tool-bar-fill',
    '--dsw-alias-button-tool-bar-hover',
    '--dsw-alias-button-ghost-active-fill',
    '--dsw-alias-button-ghost-active-border',
  ],
  state: [
    '--dsw-alias-state-business-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-warn-primary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-idle-primary',
  ],
  /** Corner scale: sm 8, md 12, lg the large card, panel the modal. */
  radius: ['--dsw-radius-sm', '--dsw-radius-md', '--dsw-radius-lg', '--dsw-radius-panel'],
  /** An elevated surface draws its edge in the shadow, so it keeps border: 0. */
  elevation: [
    '--dsw-elevation-soft',
    '--dsw-elevation-stroke',
    '--dsw-elevation-stroke-color',
    '--dsw-elevation-panel',
    '--dsw-elevation-prominent',
  ],
  /** Floats, masks and scrollbars. */
  overlay: [
    '--dsw-menu-surface-fill',
    '--dsw-menu-backdrop-filter',
    '--dsw-mask-blur',
    '--dsw-alias-bg-mask-1',
    '--dsw-alias-menu-icon',
    '--dsw-alias-scrollbar-bg-l2',
    '--dsw-alias-scrollbar-hover-l2',
    '--dsw-shadow-lv3',
  ],
  /** Motion, focus and type axis, published by the host rather than by a component. */
  system: [
    '--dsw-focus-ring-width',
    '--dsw-focus-ring-color',
    '--dsw-font-markdown-code-font-family',
    '--ds-transition-duration',
    '--ds-ease-in-out',
    '--ds-font-family-code',
    '--dsh-scrollbar-thumb',
    '--dsh-scrollbar-thumb-hover',
    '--dsh-content-font-size-secondary',
    '--dsh-content-font-delta',
    '--dsh-frame-top-clearance',
  ],
} as const

/** Every official token name, flat. Used by the token guard test. */
export const OFFICIAL_THEME_TOKEN_NAMES: readonly string[] = Object.values(OFFICIAL_THEME_TOKENS).flat()

/** The elevation steps a surface can be raised by, softest first. */
export type OfficialElevation = 'soft' | 'stroke' | 'panel' | 'prominent'

/**
 * The host's focus ring shorthand, verbatim. Writing this per control is how
 * rings drift apart; a stylesheet that draws its own focus style should use
 * {@link officialFocus} instead. The colour fallback is the host's own default.
 */
export const OFFICIAL_FOCUS_RING =
  'var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))'

/**
 * A complete `outline` declaration at the official geometry. `offset` defaults
 * to the 2px the native controls use; the host's inline field rules sit at 1px
 * and a segmented tab pulls the ring inside itself at -2px.
 */
export function officialFocus(offset = '2px'): string {
  return `outline: ${OFFICIAL_FOCUS_RING}; outline-offset: ${offset}`
}

/**
 * An elevated surface. The host draws a raised surface's edge inside its
 * shadow rather than as a border, so a card sets `border: 0` and takes the edge
 * from the elevation — which is also why its border stays off the alias-border
 * set that a flat, non-elevated rule would use.
 */
export function officialElevation(level: OfficialElevation): string {
  return `border: 0; box-shadow: var(--dsw-elevation-${level})`
}

/**
 * An elevated surface whose edge should read as a specific hairline. Rebinding
 * the stroke colour is how a menu card picks l1 while a panel picks l3, without
 * the two growing apart by hand.
 */
export function officialStrokedElevation(level: OfficialElevation, color: string): string {
  return `--dsw-elevation-stroke-color: ${color}; ${officialElevation(level)}`
}

/**
 * The shared stylesheet for a plugin UI, scoped under that plugin's root class.
 *
 * Scoping is what keeps this safe to always-bundle into every client: the rules
 * can only match inside the plugin's own subtree, so two plugins can both mount
 * `dsh-ui-card` without either styling the other's markup.
 *
 * Each recipe matches the root element *and* its descendants, because the
 * commonest arrangement is one element that is both — a surface that carries
 * the root class and `dsh-ui-card`, or a portaled dialog that is the root and
 * the `dsh-ui-surface`. A descendant-only scope would silently leave those
 * unstyled, with no error anywhere.
 *
 * A caveat worth knowing: `Modal` and `Menu` portal to `document.body`, so their
 * content leaves the plugin's subtree entirely. A portaled surface therefore
 * needs its own root class on an element inside the portal.
 *
 * Only patterns that primitives do not provide live here. If a control appears
 * below that `Button`/`Input`/`Switch`/`Tag`/`Menu` already covers, that is a
 * bug in this file: use the primitive and delete the recipe.
 */
export function officialUiCss(roots: string | readonly string[]): string {
  // One plugin often mounts several unrelated surfaces (a settings seat, a chat
  // card, a header menu), so the caller names every root. The rules below are
  // nested under a single selector list and use `&`, which the browser expands
  // per root — so one stylesheet covers all of them without duplicating itself.
  const scope = (typeof roots === 'string' ? [roots] : roots).map(root => `.${root}`).join(', ')
  const sheet = `
/* Official DSH Web UI contract. Generated by @klarkxy/dsh-plugin-kit/official-ui.
 * Do not hand-edit the copy inside a plugin: change this module so every plugin
 * moves together. Scope: ${scope} */
/* The scope rule below stays open for the whole sheet: every rule after it
 * nests with the parent selector, so one stylesheet can cover several unrelated
 * roots without leaking into a neighbouring plugin. Its closing brace is last. */
${scope} {
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  min-width: 0;

& *, & *::before, & *::after { box-sizing: border-box; }
& h1, & h2, & h3, & h4, & p, & figure { margin: 0; }
/* Keyboard focus only: pointer input keeps the native resting appearance. The
 * ring needs no radius of its own — the outline already follows the control's
 * own border-radius, and overriding it here would flatten every control. */
& :focus-visible { ${officialFocus()}; }
& [hidden] { display: none !important; }

/* --- Type tiers. The same 14/22 and 13/20 steps the primitives use. --- */
& .dsh-ui-title { font-size: 16px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
& .dsh-ui-heading { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }
& .dsh-ui-compact { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
& .dsh-ui-meta { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
& .dsh-ui-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
& .dsh-ui-error { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
& .dsh-ui-warn { color: var(--dsw-alias-state-warn-primary); }
& .dsh-ui-success { color: var(--dsw-alias-state-success-primary); }
& .dsh-ui-muted { color: var(--dsw-alias-label-tertiary); }
& .dsh-ui-truncate { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
& .dsh-ui-wrap { min-width: 0; overflow-wrap: anywhere; }

/* --- Layout scaffolding. --- */
& .dsh-ui-stack { display: flex; flex-direction: column; gap: 12px; }
& .dsh-ui-stack-lg { display: flex; flex-direction: column; gap: 20px; }
& .dsh-ui-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
& .dsh-ui-row-wrap { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
& .dsh-ui-spacer { flex: 1; min-width: 0; }
/* A 0.5px l2 rule is the host's section divider; reserve the same rhythm. */
& .dsh-ui-divider { height: 0.5px; background: var(--dsw-alias-border-l2); }
& .dsh-ui-section { display: flex; flex-direction: column; gap: 12px; padding-top: 16px; border-top: 0.5px solid var(--dsw-alias-border-l2); }

/* --- Card: a raised surface whose edge lives in the shadow. --- */
& .dsh-ui-card {
  ${officialElevation('stroke')}
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  min-width: 0;
}
& .dsh-ui-card--flat { border: 0.5px solid var(--dsw-alias-border-l3); box-shadow: none; }
& .dsh-ui-card--nested { background: var(--dsw-alias-bg-layer-2); }
& .dsh-ui-card--plain { background: none; }

/* --- Field: label, control, help, error. The control itself is an
 * official primitive, so this only owns the vertical rhythm. --- */
& .dsh-ui-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
& .dsh-ui-field + .dsh-ui-field { border-top: 0.5px solid var(--dsw-alias-border-l2); padding-top: 12px; }
& .dsh-ui-label { display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
& .dsh-ui-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
& .dsh-ui-help { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
& .dsh-ui-help p { margin: 0; }
& .dsh-ui-help p + p { margin-top: 8px; }
& .dsh-ui-required { color: var(--dsw-alias-state-error-primary); }
& .dsh-ui-control { width: 100%; min-width: 0; }
/* An invalid control is marked on the control, not only in the message. */
& .dsh-ui-control[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }
& .dsh-ui-readonly { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
& .dsh-ui-readonly > dt { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
& .dsh-ui-readonly > dd { margin: 0; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }

/* --- Buttons row. A no-op container: it exists so actions line up on the
 * trailing edge the way every native panel does. --- */
& .dsh-ui-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 4px; }
& .dsh-ui-actions-end { justify-content: flex-end; }

/* --- Banners. A banner is a left-rail notice, the shape used for warnings,
 * deprecations and blocking instructions. --- */
& .dsh-ui-banner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-left: 3px solid var(--dsw-alias-state-warn-primary);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
& .dsh-ui-banner-title { font-weight: 500; color: var(--dsw-alias-state-warn-primary); }
& .dsh-ui-banner--info { border-left-color: var(--dsw-alias-state-business-primary); }
& .dsh-ui-banner--danger { border-left-color: var(--dsw-alias-state-error-primary); }
& .dsh-ui-banner--success { border-left-color: var(--dsw-alias-state-success-primary); }
& .dsh-ui-banner p { margin: 0; }

/* --- Inline notice: a transient confirmation with no chrome of its own. --- */
& .dsh-ui-notice { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-success-primary); }
& .dsh-ui-notice--error { color: var(--dsw-alias-state-error-primary); }

/* --- Empty and loading states. Both sit in a dashed well so an empty panel
 * reads as "nothing here yet" rather than as a broken layout. --- */
& .dsh-ui-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 20px 16px;
  border: 0.5px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
& .dsh-ui-loading { display: flex; align-items: center; gap: 8px; padding: 20px 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }

/* --- Selectable list. A row is a button-sized target with a hover fill and
 * a selected fill; the name carries the weight, the description does not. --- */
& .dsh-ui-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
& .dsh-ui-list-scroll { max-height: min(66vh, 760px); overflow-y: auto; overflow-x: hidden; }
& .dsh-ui-list-row { border-radius: var(--dsw-radius-md); }
& .dsh-ui-list-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
& .dsh-ui-list-row[aria-selected='true'], & .dsh-ui-list-row[data-selected] { background: var(--dsw-alias-interactive-bg-active); }
& .dsh-ui-list-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: none;
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
& .dsh-ui-list-item:disabled { cursor: default; }
& .dsh-ui-list-item:disabled:hover { background: none; }
& .dsh-ui-list-name { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
& .dsh-ui-list-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }

/* --- Code and structured output. Wraps rather than scrolls, because a
 * feature panel is read rather than scanned. --- */
& .dsh-ui-code {
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  font-family: var(--ds-font-family-code, ui-monospace, 'Cascadia Mono', Consolas, monospace);
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
& .dsh-ui-scroll { max-height: 60vh; overflow: auto; overscroll-behavior: contain; }

/* --- A toggle row: label on the left, switch on the trailing edge. This is
 * layout only; the switch itself is the official primitive. --- */
& .dsh-ui-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; padding: 12px 0; }
& .dsh-ui-toggle-row + .dsh-ui-toggle-row { border-top: 0.5px solid var(--dsw-alias-border-l2); }
& .dsh-ui-toggle-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
& .dsh-ui-toggle-label { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }

/* --- Floating surface: a panel anchored to a trigger. This is the material
 * a menu card is made of — the translucent fill plus its backdrop blur, with
 * the edge riding inside the prominent elevation. A plugin that hand-rolls this
 * is how tokens like --dsw-specific-menu get invented; use this instead. --- */
& .dsh-ui-surface {
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  position: relative;
  display: flex;
  flex-direction: column;
  border: 0;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-menu-surface-fill);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  min-width: 0;
}
& .dsh-ui-surface-body { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px 14px; overflow-y: auto; }
& .dsh-ui-surface-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
& .dsh-ui-surface-title { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }

/* --- Native select. The primitives ship no select, so a plugin that offers a
 * closed list of choices keeps the platform control and matches the official
 * settings field geometry exactly (34px, 0.5px l4, radius-md, layer-3). A
 * SegmentedControl is the primitive to reach for when the choices are few
 * enough to show at once. --- */
& .dsh-ui-select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
& .dsh-ui-select:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
& .dsh-ui-select:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
& .dsh-ui-select[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }

/* Long panels scroll inside themselves instead of growing the host page. */
& .dsh-ui-panel { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
& .dsh-ui-panel-wide { max-width: 100%; }

@media (prefers-reduced-motion: reduce) {
  & *, & *::before, & *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
}
`
  // Widen every recipe from "a descendant of the root" to "the root, or one of
  // its descendants". Written as a transform rather than by hand so no recipe
  // can be added later with only the descendant form. The pattern is narrow on
  // purpose: a leading `&` followed by one recipe class and no combinator, so
  // sibling and child rules such as `.dsh-ui-field + .dsh-ui-field` keep their
  // own meaning and are left alone.
  return sheet.replace(/^& (\.dsh-ui-[a-z0-9-]+)(?![+>~])/gm, (_match, className: string) =>
    `&${className}, & ${className}`)
}
