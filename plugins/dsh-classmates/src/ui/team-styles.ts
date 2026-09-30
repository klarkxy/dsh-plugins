import { officialElevation, officialStrokedElevation, officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui';

/**
 * Classmates Team panel styles, adapted from the official
 * @deepseek-ai/dsh-experimental-client-ui-agent-team TeamAction.module.css
 * (MIT License, Copyright (c) DeepSeek). Layout, anchoring, dismissal and
 * theme-token usage mirror the native panel; Classmates additions are the
 * instance-name suffix, the always-visible model provenance line, and the
 * per-member issue note.
 *
 * The panel's material — the translucent menu fill, its backdrop blur, the
 * prominent elevation and the scrollbar tokens — is the shared contract's
 * dsh-ui-surface, so what is left here is geometry: the panel's box, the roster
 * grid, the task board and the roster member tile. Every colour, radius and
 * shadow is the host's own token or the contract's elevation helper.
 *
 * The rules below are deliberately unscoped. The panel is portaled onto
 * document.body, so it carries the cmt-root class itself and the contract's
 * own scoping takes it from there; the cmt- prefix keeps these rules from
 * reaching any other plugin.
 */
export const classmatesTeamCss = `${officialUiCss('cmt-root')}
/* --- Trigger ---
 * The control itself is the Button primitive; only the label's width cap and
 * its narrow-width step are this plugin's own. */
.cmt-triggerLabel { max-width: 320px; }
@container (width<=480px) {
  .cmt-triggerLabel { max-width: 180px; }
}

/* --- Panel box: the material comes from dsh-ui-surface --- */
/* z-index stays literal: the host publishes no --dsw-* z-index token
 * (none in OFFICIAL_THEME_TOKEN_NAMES). */
.cmt-panel { z-index: 100; box-sizing: border-box; width: min(500px, 100vw - 32px); max-height: min(680px, 100vh - 32px); padding: 8px 2px 0; position: fixed; overflow: hidden; }
.cmt-panelCompact { width: min(320px, 100vw - 32px); }
.cmt-panelCompact .cmt-roster { grid-template-columns: minmax(0, 1fr); }
.cmt-body { scrollbar-gutter: stable; flex: auto; min-height: 0; padding: 0 9px 16px 14px; }
.cmt-body section:first-of-type h3 { margin-top: 8px; }
.cmt-panel h3 { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px 4px; }

/* --- Roster --- */
.cmt-roster { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; display: grid; }
.cmt-member {
  ${officialStrokedElevation('stroke', 'var(--dsw-alias-border-l2)')}
  min-width: 0;
  background: var(--dsw-alias-bg-layer-2);
  text-align: left;
  cursor: pointer;
  border-radius: var(--dsw-radius-md);
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  display: flex;
}
.cmt-member:disabled { cursor: default; }
.cmt-memberCurrent {
  ${officialStrokedElevation('stroke', 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent)')}
  box-shadow: var(--dsw-elevation-stroke), inset 0 0 0 1px var(--dsw-elevation-stroke-color);
}
.cmt-member:not(:disabled):hover,
.cmt-member:not(:disabled):focus-visible { ${officialElevation('panel')} }
.cmt-memberDot { flex: none; align-items: center; height: 1lh; display: inline-flex; }
.cmt-inactiveIcon { color: var(--dsw-alias-label-tertiary); }
.cmt-memberText { flex-direction: column; gap: 4px; min-width: 0; display: flex; }
.cmt-memberName { align-items: center; gap: 5px; min-width: 0; display: inline-flex; flex-wrap: wrap; }
/* Primary card facts (role, instance, model, tasks) wrap — never ellipsized. */
.cmt-memberNameText { overflow-wrap: anywhere; }
.cmt-currentTag { flex: none; min-width: 0; }

/* --- Task board --- */
.cmt-tasks { flex-direction: column; gap: 7px; display: flex; }
.cmt-task {
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: var(--dsw-radius-sm);
  padding: 11px 13px;
}
.cmt-taskTitle { align-items: center; gap: 8px; display: flex; }
.cmt-taskState { align-items: center; gap: 6px; margin-left: auto; display: inline-flex; }
.cmt-task p { white-space: pre-wrap; margin: 5px 0; }
.cmt-clampedDescription { -webkit-line-clamp: 2; -webkit-box-orient: vertical; display: -webkit-box; overflow: hidden; }
/* The control is the Button primitive; only the rotation rides on the icon. */
.cmt-expandToggle { float: right; margin-left: 10px; }
.cmt-expandToggle svg { transition: transform 0.12s; }
.cmt-expandToggleOpen { transform: rotate(180deg); }
.cmt-meta > span { margin-right: 10px; }
.cmt-emptyNotice { margin: 16px 0 0 4px; }
/* The status line's own padding; type and colour come from the contract. */
.cmt-notice { display: flex; align-items: center; gap: 6px; padding: 9px 0; }

@media (prefers-reduced-motion: reduce) {
  .cmt-expandToggle svg { transition: none; }
}
`;
