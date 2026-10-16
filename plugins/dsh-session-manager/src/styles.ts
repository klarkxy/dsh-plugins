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
/* Settings page: a feature is its toggle row plus the nested well that holds
 * the fields the switch gates. The well reuses the nested-card surface
 * (layer-2 on layer-1) so the grouping reads without another heading. */
.${FREE_CHAT_ROOT} .dsm-feature + .dsm-feature {
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.${FREE_CHAT_ROOT} .dsm-subs {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 0 4px;
  padding: 12px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
}
.${FREE_CHAT_ROOT} .dsm-subs[data-disabled='true'] .dsh-ui-label {
  color: var(--dsw-alias-label-tertiary);
}
.${FREE_CHAT_ROOT} .dsm-minutes { width: 120px; }
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
