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
  gap: 8px;
  min-width: 0;
}
.${FREE_CHAT_ROOT} .dsh-free-alert { margin: 0; }
.${FREE_CHAT_ROOT} .dsh-free-warning {
  margin: 0 0 12px;
  color: var(--dsw-alias-label-secondary);
}
.${FREE_CHAT_ROOT}.dsm-user-row {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.${FREE_CHAT_ROOT} .dsm-user-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
  max-width: 82%;
}
.${FREE_CHAT_ROOT} .dsm-user-bubble {
  max-width: 100%;
  padding: 10px 16px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-word;
}
.${FREE_CHAT_ROOT} .dsm-user-chrome {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  color: var(--dsw-alias-label-tertiary);
}
.${FREE_CHAT_ROOT} .dsm-user-time {
  font-size: 13px;
  white-space: nowrap;
}
.${FREE_CHAT_ROOT} .dsm-icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.${FREE_CHAT_ROOT} .dsm-icon-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.${FREE_CHAT_ROOT} .dsm-icon-action svg { width: 15px; height: 15px; }
.${FREE_CHAT_ROOT} .dsm-user-attachments {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 100%;
  gap: 8px;
}
.${FREE_CHAT_ROOT} .dsm-file-card {
  display: inline-flex;
  flex: 0 0 240px;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  width: 240px;
  min-height: 64px;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
}
.${FREE_CHAT_ROOT} .dsm-file-icon { flex: none; width: 28px; height: 28px; }
.${FREE_CHAT_ROOT} .dsm-file-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.${FREE_CHAT_ROOT} .dsm-file-name {
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.${FREE_CHAT_ROOT} .dsm-file-meta {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 15px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.${FREE_CHAT_ROOT} .dsm-reference-summary {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 18px;
}
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

.${FREE_CHAT_ROOT} .dsm-user-original { display: contents; }
.${FREE_CHAT_ROOT} .dsm-user-original[hidden] { display: none; }
.${FREE_CHAT_ROOT} .dsm-message-edit { width: min(100%, 720px); align-self: flex-end; }
.${FREE_CHAT_ROOT} .dsm-message-editor { width: 100%; box-sizing: border-box; padding: 14px; border-radius: 18px; background: var(--dsw-alias-bg-layer-3); }
.${FREE_CHAT_ROOT} .dsm-message-editor .dsh-free-draft { width: 100%; min-height: 80px; max-height: 360px; resize: vertical; border: none; background: transparent; box-shadow: none; padding: 4px; box-sizing: border-box; }
.${FREE_CHAT_ROOT} .dsm-edit-footer { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.${FREE_CHAT_ROOT} .dsm-edit-spacer { flex: 1; }
.${FREE_CHAT_ROOT} .dsm-edit-attachments { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.${FREE_CHAT_ROOT} .dsm-edit-attachment { display: flex; align-items: center; gap: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 6px; max-width: 100%; }
.${FREE_CHAT_ROOT} .dsm-edit-attachment img { width: 72px; height: 60px; object-fit: contain; border-radius: 6px; }
.${FREE_CHAT_ROOT} .dsm-edit-attachment > span { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${FREE_CHAT_ROOT} .dsm-edit-attachment > svg { width: 24px; height: 24px; }
.${FREE_CHAT_ROOT} .dsm-edit-image { position: relative; padding: 0; border: none; }
.${FREE_CHAT_ROOT} .dsm-edit-image img { width: auto; height: auto; max-width: 220px; max-height: 140px; object-fit: contain; border-radius: 10px; }
.${FREE_CHAT_ROOT} .dsm-edit-image > button { position: absolute; top: 4px; right: 4px; border-radius: 50%; background: var(--dsw-alias-bg-layer-3); width: 24px; height: 24px; padding: 0; }
`
