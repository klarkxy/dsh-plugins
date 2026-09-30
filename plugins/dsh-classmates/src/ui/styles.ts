import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui';

/**
 * The Classmates plugin page. Everything the host already ships — the type
 * tiers, the field rhythm, banners, notices, empty states, list rows, the
 * focus ring and every colour — comes from the shared contract, so what is
 * left here is only the geometry this screen genuinely owns: the two-column
 * master/detail body, the sticky list pane, the measure caps, and the
 * container query that folds the two panes into one on a narrow pane.
 *
 * Local rules are written under `.classmates` so they match the contract's own
 * scoping specificity and can override it deliberately rather than by accident.
 */
export const classmatesCss = `${officialUiCss('classmates')}
/* --- Page scaffolding --- */
.classmates { width: 100%; min-width: 0; container: classmates / inline-size; }
.classmates .classmates-toolbar { justify-content: space-between; gap: 12px 20px; padding-bottom: 16px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
.classmates .classmates-assistant { justify-content: flex-end; gap: 6px 16px; }
.classmates .classmates-assistant .dsh-ui-error { flex-basis: 100%; }
.classmates .classmates-lead { max-width: 68ch; }
.classmates .classmates-prose { max-width: 72ch; }

/* --- Master/detail body: the one layout this screen owns --- */
.classmates .classmates-body { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px 40px; align-items: start; }
.classmates .classmates-list-pane { min-width: 0; position: sticky; top: 16px; }
.classmates .classmates-list { scrollbar-gutter: stable; }
.classmates .classmates-editor { min-width: 0; }
.classmates .classmates-editor-head { align-items: baseline; gap: 4px 8px; }
.classmates .classmates-back { display: none; }
.classmates .classmates-model-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 20px; align-items: start; }
.classmates .classmates-tabs { max-width: 360px; }

/* --- Native disclosure ---
 * A <details> is the platform control here: swapping it for DisclosureRow
 * would move the open state out of the browser and change what the summary
 * exposes to assistive tech. It also has to stay a block box, because
 * blockifying a list-item summary is what drops the disclosure marker — so the
 * trailing notes get their own section rule rather than dsh-ui-section. */
/* Type comes from the dsh-ui-heading class on the summary; only the quieter tone is local. */
.classmates .classmates-disclosure > summary { cursor: pointer; padding: 4px 0; color: var(--dsw-alias-label-secondary); }
.classmates .classmates-disclosure > summary:hover { color: var(--dsw-alias-label-primary); }
.classmates .classmates-disclosure > .dsh-ui-field { margin-top: 10px; }
.classmates .classmates-details { margin-top: 16px; padding-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.classmates .classmates-details > p { margin-top: 8px; }

/* The contract draws a divider between sibling fields, which reads as the
 * settings form. In the side-by-side model row the second field is a
 * grid cell, so that divider has to come off. */
.classmates .classmates-model-fields > .dsh-ui-field + .dsh-ui-field { border-top: 0; padding-top: 0; }

/* The form's own stack rides the contract; only the fieldset's user-agent
 * chrome has to be reset for it to be one. */
.classmates .classmates-fields { border: 0; margin: 0; padding: 0; min-width: 0; }

/* --- The one field control the primitives do not ship ---
 * A textarea, matched to the Input primitive's own hairline, radius and fill
 * so the two kinds of text control line up. */
.classmates .classmates-textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
  resize: vertical;
}
.classmates .classmates-textarea[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }
/* Input paints its hairline on the wrapper span, so an invalid control is
 * marked on that wrapper rather than on the input nested in it. */
.classmates .classmates-invalid { border-color: var(--dsw-alias-state-error-primary); }

/* --- Status tag ---
 * The dot sits inside a tag, and the tag's own padding is its spacing. */
.classmates .classmates-status { gap: 4px; }
/* A read-only list row is not a target, so it keeps the row's shape without
 * the pointer that says "click me". */
.classmates .classmates-static { cursor: default; }
/* A long label must wrap inside the pane rather than push it wider. */
.classmates .classmates-button { max-width: 100%; }
/* The primitives ship no destructive button; an outlined action tinted with
 * the error step is the official way to spell one. */
.classmates .classmates-button--danger { color: var(--dsw-alias-state-error-primary); }

/* --- Version-conflict panel: the two-column definition list --- */
.classmates .classmates-remote-fields { display: grid; gap: 6px; margin: 0; }
.classmates .classmates-remote-fields > div { display: grid; grid-template-columns: minmax(72px, max-content) minmax(0, 1fr); gap: 2px 12px; }
/* dt/dd type comes from dsh-ui-meta / dsh-ui-compact on the elements. */
.classmates .classmates-remote-fields dt { color: var(--dsw-alias-label-tertiary); }
.classmates .classmates-remote-fields dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.classmates .classmates-remote-instructions { max-height: 160px; }

/* --- Launch-approval list: the label column of each switch row --- */
.classmates .classmates-protection-route { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }

@container classmates (max-width: 640px) {
  .classmates .classmates-body { display: block; }
  .classmates .classmates-list-pane { position: static; }
  .classmates .classmates-model-fields { grid-template-columns: minmax(0, 1fr); }
  .classmates .classmates-assistant { justify-content: flex-start; }
  .classmates.classmates--editing .classmates-list-pane { display: none; }
  .classmates:not(.classmates--editing) .classmates-editor { display: none; }
  .classmates.classmates--editing .classmates-back { display: inline-block; }
}
`;
