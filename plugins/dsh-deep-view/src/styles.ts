// All colour values come from the repository's official host token contract.
// The root is scoped to the plugin's cells; no body or global element rules.
export const viewStyles = `
.dvui-root { min-width: 0; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 14px; line-height: 22px; }
.dvui-root * { box-sizing: border-box; }
.dvui-root .dvui-view { min-width: 0; display: flex; flex-direction: column; gap: 14px; margin: 14px 0; padding: 14px 16px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); border: 0; box-shadow: var(--dsw-elevation-stroke); }
.dvui-root .dvui-bare { gap: 12px; }
.dvui-root .dvui-bare-inline { padding: 0; background: transparent; box-shadow: none; border-radius: 0; }
.dvui-root .dvui-framed { width: 100%; }
.dvui-root .dvui-settled .dvui-option-label,.dvui-root .dvui-settled .dvui-option-desc { color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-head { display: flex; align-items: center; gap: 8px; min-width: 0; padding-bottom: 10px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dvui-root .dvui-head-tools-only { padding-bottom: 0; border-bottom: 0; margin-bottom: -6px; justify-content: flex-end; }
.dvui-root .dvui-title { flex: 1 1 0; min-width: 0; margin: 0; font-size: 14px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dvui-root .dvui-body { min-width: 0; }
.dvui-root .dvui-stack { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.dvui-root .dvui-row { display: flex; flex-wrap: wrap; gap: 12px; min-width: 0; align-items: stretch; }
.dvui-root .dvui-row > * { flex: 1 1 160px; min-width: 0; }
.dvui-root .dvui-metric { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 10px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.dvui-root .dvui-metric-label,.dvui-root .dvui-caption,.dvui-root .dvui-field-label,.dvui-root .dvui-input-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dvui-root .dvui-input-label,.dvui-root .dvui-field-label { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.dvui-root .dvui-metric-value { font-size: 22px; line-height: 28px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-metric[data-tone=accent] .dvui-metric-value { color: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-metric[data-tone=good] .dvui-metric-value { color: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-metric[data-tone=warn] .dvui-metric-value { color: var(--dsw-alias-state-warn-primary); }
.dvui-root .dvui-metric[data-tone=bad] .dvui-metric-value { color: var(--dsw-alias-state-error-primary); }
.dvui-root .dvui-progress[data-tone=accent] .dvui-progress-fill { background: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-progress[data-tone=good] .dvui-progress-fill { background: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-progress[data-tone=warn] .dvui-progress-fill { background: var(--dsw-alias-state-warn-primary); }
.dvui-root .dvui-progress[data-tone=bad] .dvui-progress-fill { background: var(--dsw-alias-state-error-primary); }
.dvui-root .dvui-muted { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-muted * { font-size: inherit !important; line-height: inherit !important; color: inherit !important; }
.dvui-root .dvui-table-wrap { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dvui-root .dvui-table { max-width: 100%; overflow-x: auto; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); }
.dvui-root .dvui-table table { border-collapse: collapse; min-width: 100%; font-size: 13px; line-height: 20px; }
.dvui-root .dvui-table thead { background: var(--dsw-alias-bg-layer-2); }
.dvui-root .dvui-table th { padding: 8px 12px; font-size: 12px; line-height: 18px; font-weight: 600; text-align: start; white-space: nowrap; color: var(--dsw-alias-label-secondary); border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dvui-root .dvui-table td { padding: 8px 12px; max-width: 320px; vertical-align: top; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-table td p { margin: 0; }
.dvui-root .dvui-table tbody tr + tr > * { border-top: .5px solid var(--dsw-alias-border-l1); }
.dvui-root .dvui-table tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dvui-root .dvui-table tbody th { font-size: 13px; line-height: 20px; font-weight: 500; border-bottom: 0; color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dvui-root .dvui-progress { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dvui-root .dvui-progress-label { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dvui-root .dvui-progress-label > span:first-child { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dvui-root .dvui-progress-track { height: 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3); overflow: hidden; }
.dvui-root .dvui-progress-fill { height: 100%; border-radius: inherit; background: var(--dsw-alias-state-business-primary); transition: width .15s ease; }
.dvui-root .dvui-callout { display: flex; gap: 10px; padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l2); border-left: 3px solid var(--dsw-alias-state-business-primary); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-callout[data-tone=good] { border-left-color: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-callout[data-tone=warn] { border-left-color: var(--dsw-alias-state-warn-primary); }
.dvui-root .dvui-callout[data-tone=bad] { border-left-color: var(--dsw-alias-state-error-primary); }
.dvui-root .dvui-callout-icon { flex: none; display: flex; padding-top: 3px; color: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-callout[data-tone=good] .dvui-callout-icon { color: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-callout[data-tone=warn] .dvui-callout-icon { color: var(--dsw-alias-state-warn-primary); }
.dvui-root .dvui-callout[data-tone=bad] .dvui-callout-icon { color: var(--dsw-alias-state-error-primary); }
.dvui-root .dvui-callout > div { flex: 1 1 auto; min-width: 0; }
.dvui-root .dvui-sources { display: flex; flex-wrap: wrap; gap: 6px; }
.dvui-root .dvui-source { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-height: 26px; padding: 2px 8px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dvui-root .dvui-source:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-input-row { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dvui-root .dvui-input-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.dvui-root .dvui-input-value { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dvui-root .dvui-range { appearance: none; width: 100%; height: 22px; margin: 0; background: transparent; cursor: pointer; }
.dvui-root .dvui-range:disabled { cursor: default; opacity: .55; }
.dvui-root .dvui-range::-webkit-slider-runnable-track { height: 6px; border-radius: 999px; background: linear-gradient(to right, var(--dsw-alias-state-business-primary) var(--_dvui-fill, 0%), var(--dsw-alias-bg-layer-3) var(--_dvui-fill, 0%)); }
.dvui-root .dvui-range::-moz-range-track { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3); }
.dvui-root .dvui-range::-moz-range-progress { height: 6px; border-radius: 999px; background: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-range::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; margin-top: -5px; border-radius: 50%; background: var(--dsw-alias-bg-base); border: 2px solid var(--dsw-alias-state-business-primary); box-shadow: var(--dsw-elevation-soft); }
.dvui-root .dvui-range::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-bg-base); border: 2px solid var(--dsw-alias-state-business-primary); box-shadow: var(--dsw-elevation-soft); }
.dvui-root .dvui-number { display: flex; align-items: center; gap: 8px; max-width: 220px; }
.dvui-root .dvui-unit { flex: none; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.dvui-root .dvui-choice-seg { align-self: flex-start; max-width: 100%; }
.dvui-root .dvui-seg button { flex: 0 1 auto; min-height: 28px; padding: 4px 12px; border: 0; border-radius: var(--dsw-radius-sm); background: none; font: inherit; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); cursor: pointer; overflow-wrap: anywhere; }
.dvui-root .dvui-seg button:hover:not(:disabled):not([aria-pressed=true]) { color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-seg button[aria-pressed=true] { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-weight: 500; box-shadow: var(--dsw-elevation-soft); }
.dvui-root .dvui-radios,.dvui-root .dvui-checks { display: flex; flex-direction: column; gap: 2px; }
.dvui-root .dvui-radio,.dvui-root .dvui-check-option { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 5px 8px; margin: 0 -8px; border: 0; border-radius: var(--dsw-radius-sm); background: none; font: inherit; text-align: start; color: inherit; cursor: pointer; }
.dvui-root .dvui-radio:hover:not(:disabled),.dvui-root .dvui-check-option:hover:not(:disabled),.dvui-root .dvui-option:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dvui-root .dvui-radio-dot { flex: none; width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-base); }
.dvui-root .dvui-radio[aria-checked=true] .dvui-radio-dot { box-shadow: inset 0 0 0 5px var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-check-box { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: var(--dsw-radius-sm); box-shadow: inset 0 0 0 1.5px var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary-foreground); }
.dvui-root .dvui-check-option[aria-checked=true] .dvui-check-box { box-shadow: none; background: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-custom-row { display: flex; align-items: center; gap: 8px; min-width: 0; margin-top: 2px; }
.dvui-root .dvui-custom-row > .dvui-radio,.dvui-root .dvui-custom-row > .dvui-check-option { flex: none; margin: 0; padding: 4px; }
.dvui-root .dvui-custom-input { flex: 1 1 auto; min-height: 30px; padding: 4px 10px; }
.dvui-root .dvui-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 30px; padding: 2px 0; }
.dvui-root .dvui-switch { position: relative; flex: none; width: 36px; height: 20px; padding: 0; border: .5px solid var(--dsw-alias-border-l3); border-radius: 999px; background: var(--dsw-alias-bg-layer-3); cursor: pointer; }
.dvui-root .dvui-switch[aria-checked=true] { border-color: transparent; background: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-switch-knob { position: absolute; top: 1.5px; left: 1.5px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-bg-base); box-shadow: var(--dsw-elevation-soft); transition: transform .15s ease; }
.dvui-root .dvui-switch[aria-checked=true] .dvui-switch-knob { transform: translateX(16px); }
.dvui-root .dvui-options { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dvui-root .dvui-option { position: relative; display: flex; align-items: flex-start; gap: 10px; width: 100%; min-width: 0; margin: 0; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); padding: 9px 12px; font: inherit; color: inherit; text-align: start; cursor: pointer; }
.dvui-root .dvui-option-custom { align-items: center; cursor: default; }
.dvui-root .dvui-option[aria-pressed=true],.dvui-root .dvui-option[data-selected] { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-active); }
.dvui-root .dvui-key { flex: none; width: 22px; height: 22px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; line-height: 22px; text-align: center; }
.dvui-root .dvui-option[aria-pressed=true] .dvui-key,.dvui-root .dvui-option[data-selected] .dvui-key { background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary-foreground); }
.dvui-root .dvui-option-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 1px; }
.dvui-root .dvui-option-label { font-size: 13px; line-height: 20px; font-weight: 500; overflow-wrap: anywhere; }
.dvui-root .dvui-option-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dvui-root .dvui-check { flex: none; display: inline-flex; align-items: center; padding-top: 2px; color: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-form { display: flex; flex-direction: column; gap: 10px; margin: 0; }
.dvui-root .dvui-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dvui-root .dvui-input { width: 100%; min-width: 0; min-height: 34px; padding: 6px 12px; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); outline: none; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; }
.dvui-root .dvui-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dvui-root .dvui-input:focus-visible { border-color: var(--dsw-alias-state-business-primary); }
.dvui-root .dvui-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding-top: 2px; }
.dvui-root .dvui-submit,.dvui-root .dvui-button { flex: none; }
.dvui-root button:disabled { opacity: .45; cursor: default; }
.dvui-root .dvui-badge { display: inline-flex; align-items: center; height: 24px; padding: 0 9px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: .5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 22px; }
.dvui-root .dvui-settled-bar { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; min-height: 34px; margin: 0; padding: 6px 10px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; text-align: start; cursor: pointer; }
.dvui-root .dvui-settled-bar:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-settled-check { flex: none; display: inline-flex; align-items: center; color: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-settled-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 500; }
.dvui-root .dvui-settled-toggle { flex: none; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-view.dvui-collapsed { gap: 0; padding: 0; background: transparent; box-shadow: none; }
.dvui-root .dvui-view.dvui-collapsed > .dvui-head,.dvui-root .dvui-view.dvui-collapsed > .dvui-body,.dvui-root .dvui-view.dvui-collapsed > .dvui-local-note { display: none; }
.dvui-root .dvui-fence-collapsed { margin: 10px 0; }
.dvui-root .dvui-fence-collapsed > .dvui-view,.dvui-root .dvui-fence-collapsed > .dvui-status { display: none; }
.dvui-root .dvui-dock-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: .5px solid var(--dsw-alias-border-l2); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-tools { position: relative; flex: none; align-self: center; }
.dvui-root .dvui-more,.dvui-root .dvui-dismiss { width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: none; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.dvui-root .dvui-more:hover,.dvui-root .dvui-dismiss:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-menu { position: absolute; top: 32px; right: 0; z-index: 6; min-width: 180px; padding: 6px; border-radius: var(--dsw-radius-md); background: var(--dsw-menu-surface-fill); backdrop-filter: var(--dsw-menu-backdrop-filter); box-shadow: var(--dsw-elevation-prominent); display: flex; flex-direction: column; gap: 2px; }
.dvui-root .dvui-menu button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 30px; text-align: left; border: 0; background: none; border-radius: var(--dsw-radius-sm); padding: 6px 8px; font: inherit; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dvui-root .dvui-menu button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dvui-root .dvui-menu-label { padding: 2px 8px; font-size: 11px; line-height: 14px; color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-local-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dvui-root .dvui-chart { position: relative; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.dvui-root .dvui-chart-plot { position: relative; min-width: 0; }
.dvui-root .dvui-chart-svg { display: block; overflow: visible; outline: none; font-family: inherit; }
.dvui-root .dvui-chart-svg text { pointer-events: none; }
.dvui-root .dvui-chart-grid { stroke: var(--dsw-alias-border-l2); stroke-width: 1; stroke-dasharray: 3 3; }
.dvui-root .dvui-chart-tick { font-size: 12px; fill: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dvui-root .dvui-chart-label,.dvui-root .dvui-chart-value { font-size: 12px; fill: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-chart-value { font-variant-numeric: tabular-nums; }
.dvui-root .dvui-chart-center { font-size: 16px; font-weight: 600; fill: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dvui-root .dvui-chart-center-name { font-size: 12px; fill: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-chart-mark[data-dim] { opacity: .28; }
.dvui-root .dvui-chart-line { fill: none; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
.dvui-root .dvui-chart-area { opacity: .16; }
.dvui-root .dvui-chart-guide { stroke: var(--dsw-alias-border-l3); stroke-width: 1; }
.dvui-root .dvui-chart-hit { fill: transparent; }
.dvui-root .dvui-chart-tip { position: absolute; z-index: 6; pointer-events: none; transform: translate(var(--_dvui-tip-x, -50%), var(--_dvui-tip-y, calc(-100% - 8px))); display: flex; flex-direction: column; gap: 3px; padding: 6px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-menu-surface-fill); backdrop-filter: var(--dsw-menu-backdrop-filter); box-shadow: var(--dsw-elevation-prominent); font-size: 12px; line-height: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-chart-tip span { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-chart-tip i,.dvui-root .dvui-chart-key i { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.dvui-root .dvui-chart-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding-right: 32px; }
.dvui-root .dvui-chart-key { display: inline-flex; align-items: center; gap: 6px; min-height: 22px; padding: 0; border: 0; background: none; font: inherit; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dvui-root .dvui-chart-key[aria-pressed=false],.dvui-root .dvui-chart-key[data-dim] { opacity: .4; }
.dvui-root .dvui-chart-legend-list { flex-direction: column; flex-wrap: nowrap; gap: 6px; padding: 0; min-width: 0; }
.dvui-root .dvui-chart-legend-list .dvui-chart-key { cursor: default; width: 100%; }
.dvui-root .dvui-chart-key-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); }
.dvui-root .dvui-chart-key-value { flex: none; font-variant-numeric: tabular-nums; }
.dvui-root .dvui-chart-donut { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.dvui-root .dvui-chart-donut-beside { flex-direction: row; align-items: center; justify-content: center; gap: 28px; }
.dvui-root .dvui-chart-donut-beside .dvui-chart-legend-list { flex: 1 1 auto; max-width: 280px; }
.dvui-root .dvui-chart-copied { position: absolute; top: 2px; right: 36px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-state-success-primary); }
.dvui-root .dvui-reasoning { margin: 6px 0; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-reasoning > summary { cursor: pointer; font-size: 12px; line-height: 20px; }
.dvui-root .dvui-reasoning-body { padding: 4px 0 4px 12px; border-left: 1px solid var(--dsw-alias-border-l2); }
.dvui-root .dvui-unknown { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dvui-root .dvui-tool-loading, .dvui-root.dvui-tool-loading { padding: 6px 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dvui-root.dvui-dock { width: 100%; padding: 12px 14px; box-sizing: border-box; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-stroke); }
.dvui-root.dvui-dock .dvui-view, .dvui-root .dvui-view.dvui-embedded { margin: 0; padding: 0; border: 0; background: transparent; box-shadow: none; border-radius: 0; }
.dvui-root.dvui-activity .dvui-steps .dvui-step[data-status=pending] { display: none; }
.dvui-root.dvui-activity .dvui-steps .dvui-step[data-status=done] { display: none; }
.dvui-root.dvui-activity .dvui-title { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dvui-root.dvui-activity .dvui-view { gap: 4px; }
.dvui-root .dvui-status { margin: 6px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dvui-root .dvui-draft-choice { margin-top: 10px; padding-top: 10px; border-top: .5px solid var(--dsw-alias-border-l2); }
.dvui-root .dvui-draft-choice > p { margin: 0 0 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dvui-root .dvui-fence { min-width: 0; }
.dvui-root .dvui-fence-pending { display: flex; align-items: center; gap: 10px; min-height: 36px; margin: 12px 0; padding: 8px 14px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); border: .5px dashed var(--dsw-alias-border-l3); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dvui-root .dvui-fence-title { margin: 0; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 20px; }
.dvui-root .dvui-fence-hint { flex: none; }
.dvui-root .dvui-fence-failed { margin: 12px 0; padding: 10px 14px; border-radius: var(--dsw-radius-md); border: .5px solid var(--dsw-alias-border-l3); border-left: 3px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-1); }
.dvui-root .dvui-fence-source { margin: 6px 0 0; }
.dvui-root .dvui-fence-source > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dvui-root .dvui-fence-code { margin-top: 8px; }
.dvui-root .dvui-tool-error, .dvui-root.dvui-tool-error { margin: 4px 0; color: var(--dsw-alias-label-error); font-size: 12px; line-height: 18px; }
.dvui-root .dvui-canvas-card { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; padding: 10px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.dvui-root .dvui-canvas-card-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
.dvui-root .dvui-canvas-inline-shell { width: 100%; min-width: 0; overflow: hidden; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); }
.dvui-root .dvui-canvas-card-title { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 20px; overflow-wrap: anywhere; }
.dvui-root .dvui-canvas-card-path { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dvui-root .dvui-canvas-card-notice { margin: 2px 0 0; padding: 6px 10px; border-radius: var(--dsw-radius-sm); border-left: 2px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dvui-root.dvui-canvas { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 240px; }
.dvui-root.dvui-canvas.dvui-canvas-inline { height: auto; min-height: 80px; }
.dvui-root .dvui-canvas-frame { flex: 1 1 auto; display: block; width: 100%; min-height: 240px; border: none; background: var(--dsw-alias-bg-base); }
.dvui-root .dvui-canvas-frame-inline { flex: none; min-height: 80px; max-height: 1600px; overflow: hidden; }
.dvui-root .dvui-canvas-status { flex: 1 1 auto; margin: 0; padding: 10px; color: var(--dsw-alias-label-secondary); white-space: normal; }
.dvui-root .dvui-canvas-errors { flex: none; max-height: 45%; overflow-y: auto; padding: 8px 10px; border-top: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
.dvui-root .dvui-canvas-errors-list { margin: 0; padding: 0 0 0 18px; color: var(--dsw-alias-label-error); font-size: 12px; line-height: 18px; }
.dvui-root .dvui-canvas-errors-list li { overflow-wrap: anywhere; white-space: pre-wrap; }
.dvui-root .dvui-canvas-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.dvui-root button:focus-visible,.dvui-root a:focus-visible,.dvui-root input:focus-visible,.dvui-root textarea:focus-visible,.dvui-root summary:focus-visible,.dvui-root .dvui-chart-svg:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
@media (hover: hover) { .dvui-root .dvui-tools:not(:focus-within):not([data-open]) { opacity: 0; } .dvui-root .dvui-view:hover .dvui-tools { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dvui-root * { transition: none !important; } }
`
