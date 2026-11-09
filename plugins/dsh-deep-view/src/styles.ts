// All colour values come from the repository's official host token contract.
// The root is scoped to the plugin's cells; no body or global element rules.
export const viewStyles = `
.dvui-root { min-width: 0; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; }
.dvui-root * { box-sizing: border-box; }
.dvui-root .dvui-view { min-width: 0; display: flex; flex-direction: column; gap: 10px; margin: 10px 0; }
.dvui-root .dvui-bare { gap: 8px; }
.dvui-root .dvui-framed { width: min(100%, 560px); padding: 14px 16px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-stroke); }
.dvui-root .dvui-settled { color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.dvui-root .dvui-title { flex: 1 1 0; min-width: 0; margin: 0; font-size: 13px; line-height: 18px; font-weight: 500; overflow-wrap: anywhere; }
.dvui-root .dvui-body { min-width: 0; }
.dvui-root .dvui-stack { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dvui-root .dvui-row { display: flex; flex-wrap: wrap; gap: 12px 24px; min-width: 0; }
.dvui-root .dvui-row > * { flex: 1 1 160px; min-width: 0; }
.dvui-root .dvui-metric { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dvui-root .dvui-metric-label,.dvui-root .dvui-caption,.dvui-root .dvui-field-label,.dvui-root .dvui-input-label { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dvui-root .dvui-metric-value { font-size: 22px; line-height: 28px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dvui-root .dvui-metric[data-tone=good] .dvui-metric-value,.dvui-root .dvui-progress[data-tone=good] .dvui-progress-fill { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-metric[data-tone=warn] .dvui-metric-value,.dvui-root .dvui-progress[data-tone=warn] .dvui-progress-fill { color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-state-warn-primary); }
.dvui-root .dvui-metric[data-tone=bad] .dvui-metric-value,.dvui-root .dvui-progress[data-tone=bad] .dvui-progress-fill { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-primary); }
.dvui-root .dvui-muted { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-muted * { font-size: inherit !important; line-height: inherit !important; color: inherit !important; }
.dvui-root .dvui-table { max-width: 100%; overflow-x: auto; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
.dvui-root .dvui-table table { border-collapse: collapse; min-width: 100%; font-size: 13px; line-height: 18px; }
.dvui-root .dvui-table th { padding: 6px 10px; font-weight: 500; text-align: start; white-space: nowrap; color: var(--dsw-alias-label-secondary); border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dvui-root .dvui-table td { padding: 6px 10px; max-width: 280px; overflow-wrap: anywhere; }
.dvui-root .dvui-table tbody tr + tr > * { border-top: .5px solid var(--dsw-alias-border-l1); }
.dvui-root .dvui-table tbody th { font-weight: 400; border-bottom: 0; color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-num { text-align: end; font-variant-numeric: tabular-nums; }
.dvui-root .dvui-progress { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dvui-root .dvui-progress-label { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dvui-root .dvui-progress-label > span:first-child { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dvui-root .dvui-progress-track { height: 6px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); overflow: hidden; }
.dvui-root .dvui-progress-fill { height: 100%; border-radius: inherit; background: var(--dsw-alias-state-business-primary); transition: width .12s ease; }
.dvui-root .dvui-callout { display: flex; gap: 8px; padding: 8px 12px; border-radius: var(--dsw-radius-md); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); }
.dvui-root .dvui-callout[data-tone=good] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent); }
.dvui-root .dvui-callout[data-tone=warn] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); }
.dvui-root .dvui-callout[data-tone=bad] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
.dvui-root .dvui-callout-icon { flex: none; display: flex; padding-top: 3px; color: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-callout[data-tone=good] .dvui-callout-icon { color: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-callout[data-tone=warn] .dvui-callout-icon { color: var(--dsw-alias-state-warn-primary); }
.dvui-root .dvui-callout[data-tone=bad] .dvui-callout-icon { color: var(--dsw-alias-state-error-primary); }
.dvui-root .dvui-callout > div { flex: 1 1 auto; min-width: 0; }
.dvui-root .dvui-sources { display: flex; flex-wrap: wrap; gap: 6px; }
.dvui-root .dvui-source { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; height: 22px; padding: 0 6px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dvui-root .dvui-source:hover { color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-input-row { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dvui-root .dvui-input-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.dvui-root .dvui-input-value { font-size: 15px; line-height: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dvui-root .dvui-range { appearance: none; width: 100%; height: 20px; margin: 0; background: transparent; cursor: pointer; }
.dvui-root .dvui-range:disabled { cursor: default; opacity: .6; }
.dvui-root .dvui-range::-webkit-slider-runnable-track { height: 6px; border-radius: 999px; background: linear-gradient(to right, var(--dsw-alias-state-business-primary) var(--_dvui-fill, 0%), var(--dsw-alias-interactive-bg-hover) var(--_dvui-fill, 0%)); }
.dvui-root .dvui-range::-moz-range-track { height: 6px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); }
.dvui-root .dvui-range::-moz-range-progress { height: 6px; border-radius: 999px; background: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-range::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; margin-top: -5px; border-radius: 50%; background: var(--dsw-alias-label-primary-foreground); box-shadow: var(--dsw-elevation-soft); }
.dvui-root .dvui-range::-moz-range-thumb { width: 16px; height: 16px; border: 0; border-radius: 50%; background: var(--dsw-alias-label-primary-foreground); box-shadow: var(--dsw-elevation-soft); }
.dvui-root .dvui-number { display: flex; align-items: center; gap: 6px; max-width: 200px; }
.dvui-root .dvui-unit { flex: none; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-seg { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-interactive-bg-hover); }
.dvui-root .dvui-choice-seg { align-self: flex-start; max-width: 100%; }
.dvui-root .dvui-seg button { flex: 0 1 auto; min-height: 30px; padding: 4px 12px; border: 0; border-radius: var(--dsw-radius-sm); background: none; font: inherit; font-size: 13px; color: var(--dsw-alias-label-secondary); cursor: pointer; overflow-wrap: anywhere; }
.dvui-root .dvui-seg button[aria-pressed=true] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-soft); }
.dvui-root .dvui-radios { display: flex; flex-direction: column; gap: 2px; }
.dvui-root .dvui-radio { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 4px 8px; margin: 0 -8px; border: 0; border-radius: var(--dsw-radius-sm); background: none; font: inherit; text-align: start; color: inherit; cursor: pointer; }
.dvui-root .dvui-radio:hover:not(:disabled),.dvui-root .dvui-option:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dvui-root .dvui-radio-dot { flex: none; width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--dsw-alias-border-l3); }
.dvui-root .dvui-radio[aria-checked=true] .dvui-radio-dot { box-shadow: inset 0 0 0 5px var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; }
.dvui-root .dvui-switch { position: relative; flex: none; width: 36px; height: 20px; padding: 0; border: 0; border-radius: 999px; background: var(--dsw-alias-border-l3); cursor: pointer; }
.dvui-root .dvui-switch[aria-checked=true] { background: var(--dsw-alias-button-primary-fill); }
.dvui-root .dvui-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-label-primary-foreground); box-shadow: var(--dsw-elevation-soft); transition: transform .15s ease; }
.dvui-root .dvui-switch[aria-checked=true] .dvui-switch-knob { transform: translateX(16px); }
.dvui-root .dvui-options { display: flex; flex-direction: column; gap: 1px; min-width: 0; margin: 0 -8px; }
.dvui-root .dvui-option { position: relative; display: flex; align-items: flex-start; gap: 12px; width: 100%; min-width: 0; margin: 0; border: 0; border-radius: var(--dsw-radius-md); background: transparent; padding: 10px 8px; font: inherit; color: inherit; text-align: start; cursor: pointer; }
.dvui-root .dvui-key { flex: none; width: 24px; height: 24px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 24px; text-align: center; }
.dvui-root .dvui-option-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding-top: 2px; }
.dvui-root .dvui-option-label { font-size: 14px; line-height: 20px; font-weight: 500; overflow-wrap: anywhere; }
.dvui-root .dvui-option-desc { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dvui-root .dvui-check { flex: none; display: inline-flex; align-items: center; color: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-form { display: flex; flex-direction: column; gap: 8px; margin: 0; }
.dvui-root .dvui-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dvui-root .dvui-input { width: 100%; min-width: 0; min-height: 32px; padding: 5px 11px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); outline: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 20px; }
.dvui-root .dvui-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dvui-root .dvui-input:focus-visible { border-color: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dvui-root .dvui-submit,.dvui-root .dvui-button { flex: none; min-height: 34px; padding: 0 14px; border: 0; border-radius: 999px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.dvui-root .dvui-submit { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dvui-root .dvui-submit:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dvui-root .dvui-button { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
.dvui-root button:disabled { opacity: .45; cursor: default; }
.dvui-root .dvui-badge { height: 22px; padding: 0 7px; border-radius: 999px; border: 1px dotted var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; }
.dvui-root .dvui-tools { position: relative; flex: none; align-self: flex-start; }
.dvui-root .dvui-more,.dvui-root .dvui-dismiss { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.dvui-root .dvui-more:hover,.dvui-root .dvui-dismiss:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-menu { position: absolute; top: 32px; right: 0; z-index: 4; min-width: 180px; padding: 6px; border-radius: var(--dsw-radius-md); background: var(--dsw-menu-surface-fill); box-shadow: var(--dsw-elevation-panel); display: flex; flex-direction: column; gap: 2px; }
.dvui-root .dvui-menu button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 30px; text-align: left; border: 0; background: none; border-radius: var(--dsw-radius-sm); padding: 6px 8px; font: inherit; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dvui-root .dvui-menu button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dvui-root .dvui-menu-label { padding: 2px 8px; font-size: 11px; line-height: 14px; color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-local-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-chart { position: relative; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.dvui-root .dvui-chart-plot { position: relative; min-width: 0; }
.dvui-root .dvui-chart-svg { display: block; overflow: visible; outline: none; font-family: inherit; }
.dvui-root .dvui-chart-svg text { pointer-events: none; }
.dvui-root .dvui-chart-grid { stroke: var(--dsw-alias-border-l1); stroke-width: 1; stroke-dasharray: 3 3; }
.dvui-root .dvui-chart-tick { font-size: 10px; fill: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dvui-root .dvui-chart-label,.dvui-root .dvui-chart-value { font-size: 11px; fill: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-chart-value { font-variant-numeric: tabular-nums; }
.dvui-root .dvui-chart-center { font-size: 15px; font-weight: 600; fill: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dvui-root .dvui-chart-center-name { font-size: 11px; fill: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-chart-mark[data-dim] { opacity: .28; }
.dvui-root .dvui-chart-line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.dvui-root .dvui-chart-area { opacity: .14; }
.dvui-root .dvui-chart-guide { stroke: var(--dsw-alias-border-l3); stroke-width: 1; }
.dvui-root .dvui-chart-hit { fill: transparent; }
.dvui-root .dvui-chart-tip { position: absolute; z-index: 4; pointer-events: none; transform: translate(-50%, calc(-100% - 8px)); display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-menu-surface-fill); box-shadow: var(--dsw-elevation-panel); font-size: 12px; line-height: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dvui-root .dvui-chart-tip span { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-chart-tip i,.dvui-root .dvui-chart-key i { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.dvui-root .dvui-chart-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; padding-right: 32px; }
.dvui-root .dvui-chart-key { display: inline-flex; align-items: center; gap: 6px; min-height: 20px; padding: 0; border: 0; background: none; font: inherit; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dvui-root .dvui-chart-key[aria-pressed=false],.dvui-root .dvui-chart-key[data-dim] { opacity: .4; }
.dvui-root .dvui-chart-legend-list { flex-direction: column; flex-wrap: nowrap; gap: 6px; padding: 0; min-width: 0; }
.dvui-root .dvui-chart-legend-list .dvui-chart-key { cursor: default; width: 100%; }
.dvui-root .dvui-chart-key-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-chart-key-value { flex: none; font-variant-numeric: tabular-nums; }
.dvui-root .dvui-chart-donut { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.dvui-root .dvui-chart-donut-beside { flex-direction: row; align-items: center; gap: 24px; }
.dvui-root .dvui-chart-donut-beside .dvui-chart-legend-list { flex: 1 1 auto; max-width: 280px; }
.dvui-root .dvui-chart-copied { position: absolute; top: 2px; right: 36px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-reasoning { margin: 6px 0; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-reasoning > summary { cursor: pointer; font-size: 12px; line-height: 20px; }
.dvui-root .dvui-reasoning-body { padding: 4px 0 4px 12px; border-left: 1px solid var(--dsw-alias-border-l2); }
.dvui-root .dvui-unknown { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dvui-root .dvui-tool-loading, .dvui-root.dvui-tool-loading { padding: 8px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dvui-root .dvui-tool-error, .dvui-root.dvui-tool-error { margin: 8px 0; color: var(--dsw-alias-label-error); font-size: 13px; }
.dvui-root button:focus-visible,.dvui-root a:focus-visible,.dvui-root input:focus-visible,.dvui-root .dvui-chart-svg:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
@media (hover: hover) { .dvui-root .dvui-tools:not(:focus-within):not([data-open]) { opacity: 0; } .dvui-root .dvui-view:hover .dvui-tools { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dvui-root * { transition: none !important; } }
`
