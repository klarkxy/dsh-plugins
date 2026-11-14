import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

/**
 * The shared contract paints nearly everything here: the type tiers, fields,
 * banners, cards, empty and loading states, the focus ring and every control's
 * own recipe. What is left is only the geometry the contract does not cover —
 * the pending-request card's compact row, the secret list's two-column rows and
 * the prompt dialog's grant checkboxes.
 *
 * Nothing declares a colour of its own beyond naming a host token for a
 * feature the primitives have no equivalent for (a destructive hover), and
 * nothing carries a literal fallback: the host publishes both themes and a
 * literal would pin one of them.
 *
 * Every rule nests under `.sm-root`, as the contract does, so a `sm-*` class
 * never paints a neighbouring plugin. Content portaled into a Modal carries
 * the root class on its own element for the same reason.
 */
export const secretClientStyles = `${officialUiCss('sm-root')}
.sm-root {
/* --- Prompt card. The pending request row in the tool call: a status line
 * plus the one action that reopens the dialog. --- */
.sm-prompt { display: flex; flex-direction: column; gap: 8px; }
.sm-prompt-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* --- Dialog. The Input primitive is an inline-flex wrapper, so a form-width
 * field states that width once instead of per call site. --- */
.sm-input { width: 100%; }
.sm-grant { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; }
.sm-grant-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sm-separator { height: 0.5px; background: var(--dsw-alias-border-l2); margin: 4px 0; }

/* --- Destructive actions keep the outlined resting appearance and only show
 * their tone under the pointer or the keyboard. --- */
.sm-button-danger:hover:not(:disabled),
.sm-button-danger:focus-visible {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
}

/* --- Secret rows. One row per slot: name and env key on the left, grant
 * counts in the middle, actions on the trailing edge. --- */
.sm-secret-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 12px;
  padding: 10px 12px;
  align-items: center;
}
.sm-secret-actions { display: flex; align-items: center; gap: 6px; grid-row: span 2; justify-content: end; }
.sm-secret-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; }
@media (max-width: 560px) {
  .sm-secret-row { grid-template-columns: minmax(0, 1fr); }
  .sm-secret-actions { grid-row: auto; justify-content: start; }
}

/* --- Add form. Name and value stack on narrow widths; the name field keeps
 * the envKey preview beside it so the pair is read as one unit. --- */
.sm-add-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 8px 12px; align-items: end; }
@media (max-width: 560px) {
  .sm-add-grid { grid-template-columns: minmax(0, 1fr); }
}

/* --- Session grant rows: the granted scope reads as text, the revoke action
 * sits on the trailing edge. --- */
.sm-grant-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; }
.sm-mono { font-family: var(--ds-font-family-code); font-size: 12px; }
}
`
