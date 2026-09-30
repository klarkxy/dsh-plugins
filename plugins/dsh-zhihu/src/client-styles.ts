import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

/**
 * The shared contract paints this page: the type tiers, the card, the field,
 * the banners, the empty state, the focus ring and every control's own recipe.
 * What is left here is only the geometry the contract does not cover — the
 * reading width of the plugin page, two inline SVG charts, the quota bars and
 * the day table.
 *
 * Nothing below declares a colour of its own beyond naming a host token for a
 * feature the primitives have no equivalent for (a destructive hover, an inset
 * snippet well, a legend chip), and nothing carries a literal fallback: the
 * host publishes both themes and a literal would pin one of them.
 *
 * Every plugin rule nests under the plugin root, as the contract does, so a
 * .zhihu-* class never paints a neighbouring plugin. Content portaled into a
 * Modal carries the root class on its own element for the same reason.
 */
export const zhihuClientStyles = `${officialUiCss('zhihu-panel')}
.zhihu-panel {
/* --- Plugin page. The contract's rules nest under the scope selector, so the
 * root's own column and reading width are the one part it cannot reach. --- */
&.zhihu-settings-embed {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
  min-width: 0;
}
/* The tab strip is a primitive; this only places it in the page column. */
.zhihu-tabs { margin: 0; }

/* --- Fields. The official Input is an inline-flex wrapper, so a form-width
 * field states that width once instead of per call site. --- */
.zhihu-input { width: 100%; }

/* --- Actions. A destructive button keeps the outlined resting appearance every
 * other action uses and only shows its tone under the pointer or the keyboard. */
.zhihu-button-danger:hover:not(:disabled),
.zhihu-button-danger:focus-visible {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
}

/* --- Disclosures. The capability and fine-print blocks use the host
 * DisclosureRow; only the reasoning block is still a native <summary>. --- */
.zhihu-ask-reasoning > summary { cursor: pointer; width: fit-content; }
.zhihu-guide-list { margin: 4px 0 0; padding-inline-start: 20px; display: grid; gap: 6px; }

/* --- Result rows. The card, the row and the name all come from the contract; a
 * matched snippet is the one inset well the panel needs of its own. --- */
.zhihu-result-snippet {
  display: block;
  padding: 6px 10px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
}
.zhihu-ask-content { white-space: pre-wrap; }

/* --- Open platform. The section is the last block of its tab, so it keeps a
 * trailing hairline; the raw response scrolls instead of growing the page. --- */
.zhihu-open-platform { padding-bottom: 16px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.zhihu-open-platform-quota > legend { padding: 0 8px 0 0; }
.zhihu-open-platform-data { max-height: 480px; overflow: auto; margin: 8px 0 0; }

/* --- Usage. The stat tiles are a grid and the day list is a table, neither of
 * which the contract has a recipe for; figures align in the columns they sit
 * in, so a column of counts scans as a column. --- */
.zhihu-usage-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 8px; }
.zhihu-usage-value { font-variant-numeric: tabular-nums; }
.zhihu-usage-table-wrap { overflow-x: auto; }
.zhihu-usage-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.zhihu-usage-table th,
.zhihu-usage-table td { padding: 4px 6px; text-align: right; border-bottom: 0.5px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.zhihu-usage-table th:first-child,
.zhihu-usage-table td:first-child { text-align: start; }
.zhihu-usage-table th { color: var(--dsw-alias-label-tertiary); font-weight: 500; }

/* --- Usage chart. Inline SVG cannot read a CSS module, so the bars and their
 * axis carry their own geometry and take every colour from a host token. --- */
.zhihu-chart-chip { width: 8px; height: 8px; border-radius: var(--dsw-radius-sm); flex: none; }
.zhihu-chart-chip-ok { background: var(--dsw-alias-state-business-primary); }
.zhihu-chart-chip-fail { background: var(--dsw-alias-state-error-primary); }
.zhihu-chart { width: 100%; height: auto; aspect-ratio: 600 / 176; display: block; }
.zhihu-chart-bar-ok { fill: var(--dsw-alias-state-business-primary); }
.zhihu-chart-bar-fail { fill: var(--dsw-alias-state-error-primary); }
.zhihu-chart-hit { fill: transparent; }
.zhihu-chart-grid { stroke: var(--dsw-alias-border-l2); stroke-width: 1; }
.zhihu-chart-axis,
.zhihu-chart-tick,
.zhihu-chart-value { fill: var(--dsw-alias-label-secondary); font-size: var(--dsh-content-font-size-secondary); font-family: var(--ds-font-family-code); }

/* --- Quota bars. Every field is scaled against its own returned maximum, so a
 * bar only ever states "this share of this field's maximum" and never implies a
 * share of the whole quota. --- */
.zhihu-quota-row { display: grid; grid-template-columns: minmax(7rem, 1fr) minmax(5rem, 2fr) minmax(4rem, auto); align-items: center; gap: 8px; min-width: 0; }
.zhihu-quota-bar { width: 100%; height: 16px; display: block; }
.zhihu-quota-track { fill: var(--dsw-alias-bg-layer-3); }
.zhihu-quota-fill { fill: var(--dsw-alias-state-business-primary); }
.zhihu-quota-value { grid-column: 3; text-align: end; font-variant-numeric: tabular-nums; }
@media (max-width: 480px) {
  .zhihu-quota-row { grid-template-columns: minmax(0, 1fr) minmax(4rem, auto); }
  .zhihu-quota-bar { grid-row: 2; grid-column: 1 / -1; }
  .zhihu-quota-value { grid-column: 2; grid-row: 1; }
}

/* --- File field. The input is visually hidden but stays focusable and in the
 * accessibility tree; its <label> is the visible trigger, so a click on the
 * label opens the file dialog natively and keyboard focus rings the label. --- */
.zhihu-file {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.zhihu-file-trigger {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  flex: none;
}
.zhihu-file-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.zhihu-file-trigger[aria-disabled="true"] { opacity: .5; pointer-events: none; }
.zhihu-file:focus-visible + .dsh-ui-row .zhihu-file-trigger { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

/* 活动反馈:三点呼吸(pulse-dots),参数改写自 Amicro(MIT License,
   Copyright (c) 2026 Syed Subhan Uddin);装饰元素 aria-hidden。 */
.zhihu-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; color: var(--dsw-alias-state-business-primary); }
.zhihu-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; animation: zhihu-activity-pulse 1.4s ease infinite; }
.zhihu-dots i:nth-child(2) { animation-delay: .2s; }
.zhihu-dots i:nth-child(3) { animation-delay: .4s; }
@media (prefers-reduced-motion: reduce) {
  /* Stop the loop outright so the three dots stay lit instead of flickering. */
  .zhihu-dots i { animation: none; }
}
}

/* --- Links. Ordinary DSH paints a light fill on a bare <a>, so plugin links
 * stay transparent and the computed contrast falls through to the card behind
 * them. Anchoring the selector here also outranks the contract's own row-name
 * colour, so a result title reads as a link rather than as body text. It sits
 * outside the nested block because it already names the root. */
.zhihu-panel a.zhihu-link {
  color: var(--dsw-alias-brand-primary);
  background: none;
}

/* Keyframes cannot nest inside a style rule; the name is plugin-prefixed. */
@keyframes zhihu-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
`
