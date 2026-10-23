import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

/**
 * The shared contract paints this page: the type tiers, the card, the field,
 * the button row, the notice, the focus ring and the state colours. What is
 * left here is only the geometry the contract does not cover — the reading
 * width of the panel, the ranked three-column row, the drag affordance, the
 * drop indicator, the screen-reader-only announcer and the limits grid.
 *
 * Nothing below declares a colour of its own beyond naming a host token, and
 * nothing carries a literal fallback: the host publishes both themes and a
 * literal would pin one of them.
 *
 * Every plugin rule nests under the plugin root, as the contract does, so a
 * .ws-* or .web-search-* class never paints a neighbouring plugin. Selectors
 * that start with an element name keep an explicit `&`, the form every
 * nesting implementation accepts.
 */
export const webSearchClientStyles = `${officialUiCss('ws-root')}
.ws-root {

.ws-card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 8px; }
.ws-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.ws-provider-note { display: flex; align-items: center; gap: 6px; }
.web-search-provider { display: grid; gap: 8px; min-width: 0; }
.web-search-provider-info { display: grid; gap: 3px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.web-search-provider-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-height: 24px; }
& a { color: var(--dsw-alias-state-business-primary); font-size: 12px; line-height: 18px; text-underline-offset: 3px; }
/* The primitive renders a 32px control in an inline-flex wrapper; a settings
 * field needs it to fill the column it sits in. */
.ws-input { width: 100%; }
.web-search-rank { margin: 0; padding: 0; list-style: none; }
.web-search-rank li {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 14px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
& button.web-search-drag-handle {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  cursor: grab;
  opacity: 0.65;
}
& button.web-search-drag-handle:hover { opacity: 1; }
& button.web-search-drag-handle:active { cursor: grabbing; }
& button.web-search-drag-handle[aria-disabled='true'] { cursor: wait; opacity: 0.4; }
.web-search-rank li[data-dragging] { opacity: 0.45; }
.web-search-rank li[data-drop]::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--dsw-alias-state-business-primary); pointer-events: none; }
.web-search-rank li[data-drop='before']::after { top: -1px; }
.web-search-rank li[data-drop='after']::after { bottom: -1px; }
.web-search-rank-index { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; line-height: 24px; }
.web-search-rank-move { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-end; padding-top: 2px; }
.ws-danger:hover:not(:disabled),
.ws-danger[data-armed] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.ws-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
@media (max-width: 560px) {
  .web-search-rank-move { flex-direction: column; align-items: flex-end; }
}
}
`
