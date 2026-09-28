export const classmatesCss = `
.classmates {
  --cm-radius: var(--dsw-radius-md, 12px);
  --cm-accent: var(--dsw-alias-state-business-primary, #4d6bfe);
  --cm-text: var(--dsw-alias-label-primary, #1c1f24);
  --cm-text-secondary: var(--dsw-alias-label-secondary, #4b5158);
  --cm-text-tertiary: var(--dsw-alias-label-tertiary, #828a94);
  --cm-border: var(--dsw-alias-border-l2, #e5e5e5);
  --cm-surface: var(--dsw-alias-bg-layer-3, #ffffff);
  --cm-hover: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05));
  --cm-active: var(--dsw-alias-interactive-bg-active, rgba(15, 23, 42, 0.09));
  --cm-error: var(--dsw-alias-state-error-primary, #c93a2e);
  --cm-success: var(--dsw-alias-state-success-primary, #1f8f4e);
  --cm-warn: var(--dsw-alias-state-warning-primary, #a86200);
  color: var(--cm-text);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.55;
  width: 100%;
  min-width: 0;
  container: classmates / inline-size;
}
.classmates *, .classmates *::before, .classmates *::after { box-sizing: border-box; }
.classmates h1, .classmates h2, .classmates h3 { margin: 0; font-weight: 500; }
.classmates p { margin: 0; }
.classmates :focus-visible { outline: 2px solid var(--cm-accent); outline-offset: 2px; border-radius: 4px; }

.classmates-header h2 { font-size: 14px; line-height: 22px; }
.classmates .classmates-lead { margin-top: 6px; color: var(--cm-text-secondary); max-width: 68ch; }
.classmates-loading { padding: 24px 0; color: var(--cm-text-secondary); }

.classmates-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 28px; padding-bottom: 24px; border-bottom: 0.5px solid var(--cm-border); }
.classmates-assistant {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  justify-content: flex-end;
}
.classmates-assistant .classmates-field-error { flex-basis: 100%; }

.classmates-banner {
  margin-top: 14px;
  padding: 10px 14px;
  border: 1px solid var(--cm-border);
  border-left: 3px solid var(--cm-warn);
  border-radius: var(--cm-radius);
  background: var(--cm-surface);
  color: var(--cm-text-secondary);
}

.classmates-body {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 40px;
  align-items: start;
  margin-top: 28px;
}

.classmates-list-pane { min-width: 0; position: sticky; top: 16px; }
.classmates-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.classmates-list-head h2 { font-size: 15px; }

.classmates-presets { margin-bottom: 16px; color: var(--cm-text-secondary); }
.classmates-presets summary { cursor: pointer; padding: 6px 0; }
.classmates-presets > .classmates-field { margin-top: 10px; }
.classmates-list-error { display: grid; gap: 8px; margin: 12px 0; color: var(--cm-error); overflow-wrap: anywhere; }
.classmates-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(66vh, 760px);
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.classmates-row { display: flex; align-items: center; gap: 8px; border-radius: var(--cm-radius); padding-right: 10px; margin-bottom: 4px; }
.classmates-row:hover { background: var(--cm-hover); }
.classmates-row[data-selected] { background: var(--cm-active); }
.classmates-item {
  display: block;
  flex: 1;
  min-width: 0;
  padding: 12px 10px;
  border: 0;
  border-radius: var(--cm-radius);
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.classmates-item-name { display: block; font-weight: 500; overflow-wrap: anywhere; }
.classmates-item-desc {
  display: block;
  margin-top: 5px;
  color: var(--cm-text-tertiary);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.classmates-item .classmates-badge { margin-top: 4px; }
.classmates-empty { padding: 18px 14px; color: var(--cm-text-secondary); border: 1px dashed var(--cm-border); border-radius: var(--cm-radius); }

.classmates-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--cm-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.classmates-badge--unconfigured { color: var(--cm-warn); }

.classmates-editor {
  min-width: 0;
  padding: 0;
}
.classmates-editor-placeholder { padding: 28px 18px; color: var(--cm-text-secondary); }
.classmates-editor-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.classmates-editor-head h2 { font-size: 16px; overflow-wrap: anywhere; }
.classmates-dirty { color: var(--cm-warn); font-size: 12px; }

.classmates-back { display: none; margin-bottom: 12px; }

.classmates-form { margin-top: 24px; display: grid; gap: 24px; }
.classmates-fields { border: 0; margin: 0; padding: 0; display: grid; gap: 24px; min-width: 0; }
.classmates-model-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.classmates-field { display: grid; gap: 8px; min-width: 0; }
.classmates-label { font-weight: 500; }
.classmates-help { color: var(--cm-text-tertiary); font-size: 12px; }
.classmates-input, .classmates-select, .classmates-textarea {
  width: 100%;
  min-width: 0;
  padding: 9px 12px;
  border: 0.5px solid var(--dsw-alias-border-l4, var(--cm-border));
  border-radius: var(--cm-radius);
  background: var(--cm-surface);
  color: var(--cm-text);
  font: inherit;
}
.classmates-textarea { resize: vertical; line-height: 1.65; }
.classmates-input[aria-invalid="true"], .classmates-select[aria-invalid="true"], .classmates-textarea[aria-invalid="true"] {
  border-color: var(--cm-error);
}
.classmates-input:disabled, .classmates-select:disabled, .classmates-textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.classmates-field-error { color: var(--cm-error); font-size: 12px; }


.classmates-alert {
  padding: 10px 14px;
  border: 1px solid var(--cm-error);
  border-radius: var(--cm-radius);
  color: var(--cm-error);
  display: grid;
  gap: 8px;
}
.classmates-alert-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.classmates-notice {
  padding: 8px 12px;
  border-radius: var(--cm-radius);
  border: 1px solid var(--cm-success);
  color: var(--cm-success);
}

.classmates-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }

.classmates-remote {
  border: 1px solid var(--cm-warn);
  border-radius: var(--cm-radius);
  padding: 12px 14px;
  display: grid;
  gap: 8px;
}
.classmates-remote-title { font-weight: 500; color: var(--cm-warn); }
.classmates-remote-fields { margin: 0; display: grid; gap: 6px; }
.classmates-remote-fields div { display: grid; grid-template-columns: minmax(72px, max-content) minmax(0, 1fr); gap: 4px 12px; }
.classmates-remote-fields dt { color: var(--cm-text-tertiary); font-size: 12px; }
.classmates-remote-fields dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.classmates-remote-instructions { max-height: 160px; overflow: auto; }

.classmates-button { max-width: 100%; height: auto; min-height: 36px; padding-block: 6px; }
.classmates-button--danger { color: var(--cm-error); }

.classmates-details { margin-top: 16px; border-top: 1px solid var(--cm-border); padding-top: 12px; }
.classmates-details summary { cursor: pointer; font-weight: 500; color: var(--cm-text-secondary); }
.classmates-details p { margin-top: 8px; color: var(--cm-text-secondary); max-width: 72ch; }

.classmates-demo { margin-top: 16px; border-top: 1px solid var(--cm-border); padding-top: 12px; display: grid; gap: 8px; }
.classmates-demo-text {
  padding: 10px 12px;
  border: 1px solid var(--cm-border);
  border-radius: var(--cm-radius);
  background: var(--cm-surface);
  font-family: var(--ds-font-family-code, ui-monospace, "Cascadia Mono", Consolas, monospace);
  font-size: 12px;
  color: var(--cm-text-secondary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.classmates-demo-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.classmates-demo-copied { color: var(--cm-success); font-size: 12px; }

.classmates [hidden] { display: none !important; }
.classmates-tabs { margin-top: 20px; max-width: 360px; }
.classmates-models-lead { margin-bottom: 12px; max-width: 56ch; }
.classmates-models-readonly { margin-top: 14px; }
.classmates-item--static { cursor: default; }
.classmates-legacy {
  border: 1px solid var(--cm-border);
  border-left: 3px solid var(--cm-warn);
  border-radius: var(--cm-radius);
  padding: 10px 14px;
  display: grid;
  gap: 8px;
  justify-items: start;
}
.classmates-legacy-title { font-weight: 500; color: var(--cm-warn); }
.classmates-legacy-summary { color: var(--cm-text-secondary); overflow-wrap: anywhere; }

.classmates-badge--protected { color: var(--cm-accent); }

.classmates-protection {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--cm-border);
  display: grid;
  gap: 12px;
  justify-items: start;
}
.classmates-protection-title { font-size: 15px; }
.classmates-protection > .classmates-field { width: 100%; }
.classmates-protection-toggle { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.classmates-protection-list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: grid;
  gap: 6px;
}
.classmates-protection-row { display: flex; align-items: center; gap: 8px; }
.classmates-protection-route { flex: 1; min-width: 0; }

@container classmates (max-width: 640px) {
  .classmates-body { display: block; }
  .classmates-list-pane { position: static; }
  .classmates-model-fields { grid-template-columns: minmax(0, 1fr); }
  .classmates-assistant { justify-content: flex-start; }
  .classmates--editing .classmates-list-pane { display: none; }
  .classmates:not(.classmates--editing) .classmates-editor { display: none; }
  .classmates--editing .classmates-back { display: inline-block; }
  .classmates-editor { padding: 0; border-left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .classmates * { transition: none !important; }
}
`;
