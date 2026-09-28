/**
 * Classmates Team panel styles, adapted from the official
 * @deepseek-ai/dsh-experimental-client-ui-agent-team TeamAction.module.css
 * (MIT License, Copyright (c) DeepSeek). Layout, anchoring, dismissal and
 * theme-token usage mirror the native panel; Classmates additions are the
 * instance-name suffix, the always-visible model provenance line, and the
 * per-member issue note. All colors stay on `--dsw-*` tokens so light, dark,
 * and narrow layouts follow the host theme.
 */
export const classmatesTeamCss = `
.cmt-root { position: relative; }
.cmt-trigger {
  min-height: 28px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: none;
  border: 0;
  border-radius: 6px;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  font-size: 12px;
  display: inline-flex;
  max-width: 100%;
}
.cmt-trigger:hover, .cmt-trigger:focus-visible { color: var(--dsw-alias-label-primary); }
.cmt-triggerLabel {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  max-width: 320px;
}
@container (width<=480px) {
  .cmt-triggerLabel { max-width: 180px; }
}
.cmt-count {
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
}
.cmt-panel {
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  z-index: 100;
  box-sizing: border-box;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  width: min(500px, 100vw - 32px);
  max-height: min(680px, 100vh - 32px);
  box-shadow: var(--dsw-elevation-prominent);
  border: 0;
  border-radius: 12px;
  flex-direction: column;
  padding: 8px 2px 0;
  display: flex;
  position: fixed;
  overflow: hidden;
}
.cmt-panel::before {
  content: "";
  z-index: -1;
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  border-radius: 12px;
  position: absolute;
  inset: 0;
}
.cmt-panelCompact { width: min(320px, 100vw - 32px); }
.cmt-panelCompact .cmt-roster { grid-template-columns: minmax(0, 1fr); }
.cmt-body {
  --dsh-scrollbar-track-margin: 8px;
  scrollbar-gutter: stable;
  flex: auto;
  min-height: 0;
  padding: 0 9px 16px 14px;
  overflow-y: auto;
}
.cmt-taskTitle { align-items: center; gap: 8px; display: flex; }
.cmt-taskTitle strong { font-size: 13px; font-weight: 500; }
.cmt-panel h3 {
  color: var(--dsw-alias-label-primary);
  align-items: center;
  gap: 8px;
  margin: 16px 0 8px 4px;
  font-size: 13px;
  font-weight: 500;
  display: flex;
}
.cmt-body section:first-of-type h3 { margin-top: 8px; }
.cmt-roster { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; display: grid; }
.cmt-member {
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l2);
  min-width: 0;
  box-shadow: var(--dsw-elevation-stroke);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
  border: 0;
  border-radius: 8px;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  display: flex;
}
.cmt-member:disabled { cursor: default; }
.cmt-memberCurrent {
  --dsw-elevation-stroke-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent);
  box-shadow: var(--dsw-elevation-stroke),
    inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent);
}
.cmt-member:not(:disabled):hover, .cmt-member:not(:disabled):focus-visible {
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
  box-shadow: var(--dsw-elevation-panel);
}
.cmt-memberDot { flex: none; align-items: center; height: 1lh; display: inline-flex; }
.cmt-inactiveIcon { color: var(--dsw-alias-label-tertiary); }
.cmt-memberText { flex-direction: column; min-width: 0; display: flex; }
.cmt-memberName { align-items: center; gap: 5px; min-width: 0; display: inline-flex; flex-wrap: wrap; }
/* Primary card facts (role, instance, model, tasks) wrap — never ellipsized. */
.cmt-memberNameText { overflow-wrap: anywhere; }
.cmt-memberText small { overflow-wrap: anywhere; }
.cmt-currentTag {
  text-overflow: ellipsis;
  flex: 0 999 auto;
  min-width: 0;
  padding: 0 4px;
  font-size: 10px;
  line-height: 15px;
  display: inline-block;
  overflow: hidden;
}
.cmt-memberText small, .cmt-meta { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.cmt-diagnostic, .cmt-error, .cmt-warning { color: var(--dsw-alias-state-error-primary); }
.cmt-issue { color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-warn-primary, #a86200)); }
.cmt-tasks { flex-direction: column; gap: 7px; display: flex; }
.cmt-emptyNotice { color: var(--dsw-alias-label-tertiary); margin: 16px 0 0 4px; font-size: 12px; }
.cmt-task {
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 9px;
  padding: 11px 13px;
}
.cmt-taskState {
  color: var(--dsw-alias-label-tertiary);
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 11px;
  display: inline-flex;
}
.cmt-task p {
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  margin: 5px 0;
  font-size: 12px;
  line-height: 18px;
}
.cmt-clampedDescription {
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  display: -webkit-box;
  overflow: hidden;
}
.cmt-expandToggle {
  float: right;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: none;
  border: 0;
  align-items: center;
  gap: 2px;
  margin-left: 10px;
  padding: 0;
  font-size: 11px;
  line-height: 20px;
  display: inline-flex;
}
.cmt-expandToggle:hover, .cmt-expandToggle:focus-visible { color: var(--dsw-alias-label-primary); }
.cmt-expandToggle svg { transition: transform 0.12s; }
.cmt-expandToggleOpen { transform: rotate(180deg); }
.cmt-meta { line-height: 20px; }
.cmt-meta > span { margin-right: 10px; }
.cmt-notice, .cmt-error { align-items: center; gap: 6px; padding: 9px; font-size: 12px; display: flex; }
@media (prefers-reduced-motion: reduce) {
  .cmt-expandToggle svg { transition: none; }
}
`;
