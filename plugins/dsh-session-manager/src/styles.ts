import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { modelMenuCss } from '@klarkxy/dsh-model-route/ui'

export const FREE_CHAT_ROOT = 'dsh-free-chat'

/** Host tokens and official scaffolding. Only the edit draft, the inline action row,
 * and the alert line survive the panel removal; the modals reuse the root class. */
export const freeChatCss = `${officialUiCss(FREE_CHAT_ROOT)}
${modelMenuCss}
.${FREE_CHAT_ROOT} .dsh-free-draft {
  width: 100%;
  min-height: 8em;
}
.${FREE_CHAT_ROOT} .dsh-free-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.${FREE_CHAT_ROOT} .dsh-free-alert { margin: 0; }
/* Settings page: one quiet reading surface. Rules, not nested wells, separate
 * sections; dependent controls align with the feature they belong to. */
.${FREE_CHAT_ROOT} .dsm-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.${FREE_CHAT_ROOT} .dsm-setting {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.${FREE_CHAT_ROOT} .dsm-setting + .dsm-setting {
  padding-top: 20px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.${FREE_CHAT_ROOT} .dsm-setting-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.${FREE_CHAT_ROOT} .dsm-ghost-controls {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.2fr);
  align-items: start;
  gap: 16px;
}
/* SegmentedTabs is 42px tall; its adjacent text controls share that baseline. */
.${FREE_CHAT_ROOT} .dsm-ghost-controls .dsh-model-menu-trigger,
.${FREE_CHAT_ROOT} .dsm-ghost-controls .dsm-ghost-input {
  height: 42px;
}
.${FREE_CHAT_ROOT} .dsm-feature + .dsm-feature {
  margin-top: 4px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.${FREE_CHAT_ROOT} .dsm-feature > .dsh-ui-toggle-row { padding: 8px 0; }
.${FREE_CHAT_ROOT} .dsm-feature-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 8px;
}
.${FREE_CHAT_ROOT} .dsm-feature-options[data-disabled='true'] .dsh-ui-label,
.${FREE_CHAT_ROOT} .dsm-feature-options[data-disabled='true'] .dsh-ui-meta {
  color: var(--dsw-alias-label-tertiary);
}
.${FREE_CHAT_ROOT} .dsm-compact-options { max-width: calc(50% - 10px); }
.${FREE_CHAT_ROOT} .dsm-model-field .dsh-model-menu-root,
.${FREE_CHAT_ROOT} .dsm-model-field .dsh-model-menu-trigger {
  width: 100%;
  max-width: none;
}
.${FREE_CHAT_ROOT} .dsm-model-field .dsh-model-menu-trigger {
  justify-content: space-between;
  height: 32px;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}
.${FREE_CHAT_ROOT} .dsm-model-field .dsh-model-menu-triggerLabel {
  flex: 1;
  text-align: left;
}
.${FREE_CHAT_ROOT} .dsm-settings-footer .dsh-ui-notice--error {
  flex: 0 0 100%;
  min-width: 0;
}
.${FREE_CHAT_ROOT} .dsm-minutes-control {
  display: flex;
  align-items: center;
  gap: 8px;
}
.${FREE_CHAT_ROOT} .dsm-minutes { width: 88px; }
@media (max-width: 560px) {
  .${FREE_CHAT_ROOT} .dsm-ghost-controls { grid-template-columns: minmax(0, 1fr); }
  .${FREE_CHAT_ROOT} .dsm-compact-options { max-width: none; }
}
/* Welcome-back card: one flat full-width row at the latest turn's tail in the
 * chat flow — a single bordered surface with the recap laid out inline, no
 * nested box. */
.${FREE_CHAT_ROOT}.dsh-welcome-card {
  box-sizing: border-box;
  width: 100%;
  margin: 8px 0 0;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
}
.${FREE_CHAT_ROOT} .dsh-welcome-card-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 4px;
}
.${FREE_CHAT_ROOT} .dsh-welcome-card-title { font-weight: 600; }
.${FREE_CHAT_ROOT} .dsh-welcome-card-idle {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.${FREE_CHAT_ROOT} .dsh-welcome-card-close {
  align-self: flex-start;
  margin-left: auto;
}
.${FREE_CHAT_ROOT} .dsh-welcome-card-actions {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 0;
}
.${FREE_CHAT_ROOT} .dsh-welcome-recap {
  margin: 0;
  padding: 0;
  border: none;
}
.${FREE_CHAT_ROOT} .dsh-welcome-recap dt {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.${FREE_CHAT_ROOT} .dsh-welcome-recap dt:first-child { margin-top: 0; }
.${FREE_CHAT_ROOT} .dsh-welcome-recap dd {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.${FREE_CHAT_ROOT} .dsh-welcome-cache {
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
}
.${FREE_CHAT_ROOT} .dsh-welcome-done { margin: 6px 0 0; }
`
