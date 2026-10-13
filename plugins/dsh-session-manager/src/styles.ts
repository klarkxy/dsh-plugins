import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

export const FREE_CHAT_ROOT = 'dsh-free-chat'

/** Host tokens and official scaffolding. Only the edit draft, the inline action row,
 * and the alert line survive the panel removal; the modals reuse the root class. */
export const freeChatCss = `${officialUiCss(FREE_CHAT_ROOT)}
.${FREE_CHAT_ROOT} .dsh-free-draft {
  box-sizing: border-box;
  width: 100%;
  min-height: 8em;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  resize: vertical;
}
.${FREE_CHAT_ROOT} .dsh-free-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.${FREE_CHAT_ROOT} .dsh-free-alert { margin: 0; }
`
