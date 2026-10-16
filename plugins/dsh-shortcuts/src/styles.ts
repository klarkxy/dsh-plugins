import { officialElevation, officialFocus, officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

export const SHORTCUTS_STYLES = `${officialUiCss(['shortcuts-root', 'shortcuts-fixed-root'])}
.shortcuts-root, .shortcuts-fixed-root {
  &.shortcuts-page {
    max-width: 760px;
  }

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

  /* --- Floating Error Toast --- */
  &.shortcuts-error {
    ${officialElevation('prominent')}
    pointer-events: auto;
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    max-width: min(440px, calc(100vw - 48px));
    padding: 12px 16px;
    border-left: 3px solid var(--dsw-alias-state-error-primary);
    border-radius: var(--dsw-radius-lg);
    background: var(--dsw-alias-bg-overlay);
    backdrop-filter: var(--dsw-menu-backdrop-filter);
    font-size: 13px;
    line-height: 20px;
    color: var(--dsw-alias-label-primary);
  }

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

