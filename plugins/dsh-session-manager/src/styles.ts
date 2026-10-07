import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

export const FREE_CHAT_ROOT = 'dsh-free-chat'

/** Host tokens and official scaffolding. The panel stays a flat list; the modal reuses the root class. */
export const freeChatCss = `${officialUiCss(FREE_CHAT_ROOT)}
.${FREE_CHAT_ROOT}.dsh-free-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  height: 100%;
  padding: 16px;
  background: var(--dsw-alias-bg-base);
}
.${FREE_CHAT_ROOT} .dsh-free-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.${FREE_CHAT_ROOT} .dsh-free-head .dsh-ui-title { flex: 1; min-width: 0; }
.${FREE_CHAT_ROOT} .dsh-free-search { width: 100%; }
.${FREE_CHAT_ROOT} .dsh-free-line {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.${FREE_CHAT_ROOT} .dsh-free-open {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  min-height: 36px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
.${FREE_CHAT_ROOT} .dsh-free-open:hover { background: var(--dsw-alias-interactive-bg-hover); }
.${FREE_CHAT_ROOT} .dsh-free-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${FREE_CHAT_ROOT} .dsh-free-time {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
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
.${FREE_CHAT_ROOT} .dsh-free-sr {
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
@media (max-width: 640px) {
  .${FREE_CHAT_ROOT}.dsh-free-panel { padding: 12px; }
  .${FREE_CHAT_ROOT} .dsh-free-head { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) {
  .${FREE_CHAT_ROOT} .dsh-free-open { transition: none; }
}
`
