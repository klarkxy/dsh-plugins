import { officialFocus, officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

export const SHORTCUTS_STYLES = `${officialUiCss(['shortcuts-root', 'shortcuts-fixed-root'])}
.shortcuts-root, .shortcuts-fixed-root {
  /* --- Toolbar & Section Headers --- */
  & .shortcuts-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  & .shortcuts-search {
    flex: 1 1 220px;
    min-width: 180px;
  }
  & .shortcuts-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  & .shortcuts-section-title {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* --- Keycaps & Key Groups --- */
  & .shortcuts-keys {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    vertical-align: middle;
  }
  /* 官方 ShortcutKeys 无盒式键帽变体（plain 为无框文字键、tooltip 为 16px 提示键），
   * kbd 原生元素为例外：这里保留 22px 盒式键帽，供设置列表、草稿摘要与面板脚注共用。 */
  & kbd, & .shortcuts-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border: 0.5px solid var(--dsw-alias-border-l3);
    border-radius: var(--dsw-radius-sm);
    background: var(--dsw-alias-bg-layer-2);
    box-shadow: var(--dsw-elevation-soft);
    font-family: var(--ds-font-family-code);
    font-size: 12px;
    line-height: 18px;
    font-weight: 500;
    color: var(--dsw-alias-label-primary);
    white-space: nowrap;
  }
  & .shortcuts-key-sep {
    font-size: 11px;
    line-height: 16px;
    color: var(--dsw-alias-label-tertiary);
    padding: 0 1px;
  }
  & .shortcuts-key-unbound {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border: 0.5px dashed var(--dsw-alias-border-l3);
    border-radius: var(--dsw-radius-sm);
    font-size: 12px;
    line-height: 18px;
    color: var(--dsw-alias-label-tertiary);
    white-space: nowrap;
  }

  /* --- Trigger Card --- */
  & .shortcuts-trigger-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    padding: 10px 12px;
    border: 0.5px solid var(--dsw-alias-border-l2);
    border-radius: var(--dsw-radius-md);
    background: var(--dsw-alias-bg-layer-2);
  }
  & .shortcuts-trigger-bar > .dsh-ui-actions {
    padding-top: 0;
  }

  /* --- Application Shortcut Rows --- */
  & .shortcuts-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    padding: 12px 16px;
  }
  & .shortcuts-label {
    display: flex;
    flex-direction: column;
    flex: 1 1 220px;
    min-width: 0;
    gap: 4px;
  }
  & .shortcuts-id {
    font-family: var(--ds-font-family-code);
    font-size: 12px;
    line-height: 18px;
    color: var(--dsw-alias-label-tertiary);
    overflow-wrap: anywhere;
  }
  & .shortcuts-binding {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex: 1 1 180px;
    min-width: 0;
    gap: 6px;
  }
  & .shortcuts-row > .dsh-ui-actions {
    padding-top: 0;
    margin-inline-start: auto;
  }

  /* --- Fixed / Additional Shortcut Cards & Slots --- */
  & .shortcuts-fixed-card {
    gap: 10px;
    padding: 14px 16px;
  }
  & .shortcuts-fixed-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  & .shortcuts-slots {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  & .shortcuts-slot-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 12px;
    border: 0.5px solid var(--dsw-alias-border-l2);
    border-radius: var(--dsw-radius-md);
    background: var(--dsw-alias-bg-layer-2);
  }
  & .shortcuts-slot-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    min-width: 0;
  }
  & .shortcuts-slot-pair {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    line-height: 18px;
    color: var(--dsw-alias-label-secondary);
  }
  & .shortcuts-slot-card > .dsh-ui-actions {
    padding-top: 0;
    margin-inline-start: auto;
  }

  /* --- Modals, Draft Summary & Recorder --- */
  & .shortcuts-draft-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 8px;
  }
  & .shortcuts-draft-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 10px 12px;
    border: 0.5px solid var(--dsw-alias-border-l2);
    border-radius: var(--dsw-radius-md);
    background: var(--dsw-alias-bg-layer-1);
    min-width: 0;
  }
  & .shortcuts-recorder {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  & .shortcuts-recorder-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 200px;
    min-width: 0;
  }
  & .shortcuts-settings-modal {
    max-height: 75vh;
    overflow: auto;
  }

  /* --- Command Palette --- */
  & .shortcuts-palette {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  & .shortcuts-command-list, & .shortcuts-palette-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: min(50vh, 420px);
    overflow-y: auto;
    overflow-x: hidden;
    padding: 2px 0;
  }
  & [role="option"] {
    border-radius: var(--dsw-radius-md);
  }
  & [role="option"]:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  & [role="option"][aria-selected="true"] {
    background: var(--dsw-alias-interactive-bg-active);
  }
  & .shortcuts-command, & .shortcuts-palette-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 38px;
    padding: 6px 10px;
    text-align: start;
    border-radius: var(--dsw-radius-md);
  }
  & .shortcuts-command-main {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
  }
  & .shortcuts-command-label {
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    color: var(--dsw-alias-label-primary);
    overflow-wrap: anywhere;
  }
  & .shortcuts-palette-keys {
    color: var(--dsw-alias-label-secondary);
    flex: none;
  }
  & .shortcuts-palette-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 8px;
    border-top: 0.5px solid var(--dsw-alias-border-l2);
  }


  /* --- In-Conversation Full-History Find Bar & Viewport Highlights --- */
  &.sc-find-highlights {
    position: fixed;
    inset: 0;
    z-index: 210;
    pointer-events: none;
    overflow: hidden;
  }
  & .sc-find-hl {
    position: fixed;
    pointer-events: none;
    border-radius: var(--dsw-radius-sm);
    background: var(--dsw-alias-interactive-bg-hover);
    border-bottom: 1.5px solid var(--dsw-alias-label-tertiary);
  }
  & .sc-find-hl-current {
    background: var(--dsw-alias-interactive-bg-active);
    border: 1.5px solid var(--dsw-alias-state-business-primary);
  }
  &.sc-find-wrap {
    position: fixed;
    top: 52px;
    right: 20px;
    z-index: 220;
    pointer-events: none;
    max-width: calc(100vw - 32px);
  }
  & .sc-find-bar {
    pointer-events: auto;
    box-sizing: border-box;
    width: min(420px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-radius: var(--dsw-radius-lg);
    background: var(--dsw-alias-bg-overlay);
    backdrop-filter: var(--dsw-menu-backdrop-filter);
    color: var(--dsw-alias-label-primary);
    border: 0.5px solid var(--dsw-alias-border-l3);
    box-shadow: var(--dsw-elevation-soft);
    font-size: 13px;
    line-height: 18px;
  }
  & .sc-find-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
  & .sc-find-drag { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 18px; height: 26px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: grab; touch-action: none; user-select: none; }
  & .sc-find-drag:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
  &.sc-find-wrap[data-dragging="true"] .sc-find-drag, &.sc-find-wrap[data-dragging="true"] .sc-find-bar { cursor: grabbing; user-select: none; }
  & .sc-find-input-wrap { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 0 8px; height: 30px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l3); }
  & .sc-find-input-wrap:focus-within { border-color: var(--dsw-alias-state-business-primary); }
  & .sc-find-input { flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; padding: 0; }
  & .sc-find-count { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; white-space: nowrap; }
  & .sc-find-btn { display: inline-flex; flex: none; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 5px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
  & .sc-find-btn:enabled:not([aria-pressed="true"]):hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
  & .sc-find-btn:disabled { opacity: 0.42; cursor: default; }
  & .sc-find-btn[aria-pressed="true"] { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-state-business-primary); font-weight: 600; }
  & .sc-find-scope-btn { position: relative; }
  & .sc-find-scope-btn[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); }
  & .sc-find-scope-btn[data-custom-scope="true"] { color: var(--dsw-alias-state-business-primary); }
  & .sc-find-dot { position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-state-business-primary); }
  & .sc-find-menu { pointer-events: auto; position: absolute; right: 0; top: calc(100% + 6px); min-width: 228px; max-width: calc(100vw - 32px); max-height: min(360px, calc(100vh - 80px)); overflow-y: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 2px; padding: 6px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-overlay); backdrop-filter: var(--dsw-menu-backdrop-filter); color: var(--dsw-alias-label-primary); border: 0.5px solid var(--dsw-alias-border-l3); box-shadow: var(--dsw-elevation-soft); font-size: 12px; line-height: 18px; z-index: 230; }
  & .sc-find-menu[data-placement="above"] { top: auto; bottom: calc(100% + 6px); }
  & .sc-find-menu-head { padding: 2px 8px 4px; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-tertiary); user-select: none; }
  & .sc-find-menu-sep { height: 0.5px; margin: 3px 4px; background: var(--dsw-alias-border-l2); }
  & .sc-find-menu-item { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 5px 8px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
  & .sc-find-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
  & .sc-find-chk { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: var(--dsw-radius-sm); border: 1px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-state-business-primary); box-sizing: border-box; }
  & .sc-find-menu-item[aria-checked="true"] .sc-find-chk { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-active); }
  & .sc-find-menu-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  & .sc-find-menu-tag { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
  & .sc-find-menu-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 3px; padding: 4px 4px 1px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
  & .sc-find-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); min-width: 0; }
  & .sc-find-status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  & .sc-find-actions { display: flex; align-items: center; gap: 6px; flex: none; }
  & .sc-find-link { border: 0; background: transparent; padding: 2px 6px; border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
  & .sc-find-link:hover { background: var(--dsw-alias-interactive-bg-hover); }
  & .sc-find-excerpt { border-radius: var(--dsw-radius-md); padding: 6px 8px; background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l2); display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 17px; }
  & .sc-find-exhead { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: var(--dsw-alias-label-tertiary); }
  & .sc-find-extext { color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 72px; overflow: auto; }
  & .sc-find-exmark { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); border-bottom: 1px solid var(--dsw-alias-state-business-primary); border-radius: var(--dsw-radius-sm); padding: 0 2px; }
  &.sc-find-trig { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--dsw-radius-lg); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; margin-left: 2px; }
  &.sc-find-trig:hover { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-interactive-bg-hover); }
  &.sc-find-trig[aria-pressed="true"] { color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-active); }

  & .shortcuts-recorder:focus-visible {
    ${officialFocus('2px')};
  }

  @media (max-width: 560px) {
    & .shortcuts-search { flex-basis: 100%; }
    & .shortcuts-row { align-items: flex-start; }
    & .shortcuts-binding { flex-basis: 100%; }
    & .shortcuts-row > .dsh-ui-actions { margin-inline-start: 0; }
    & .shortcuts-slot-card > .dsh-ui-actions { margin-inline-start: 0; }
  }
}
`
