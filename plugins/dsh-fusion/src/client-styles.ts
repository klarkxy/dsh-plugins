import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'

/**
 * The shared contract is scoped under a root class, and its rules only match
 * descendants of that root — so every Fusion surface names `dsh-fusion-root`
 * on an element that wraps the contract classes it uses. Colour, radius,
 * elevation and focus are the host's `--dsw-*` tokens, written under their own
 * names; only the geometry below is Fusion's own.
 */
export const fusionClientStyles = `${officialUiCss(['dsh-fusion-root', 'fusion-settings'])}
/* The seat is an inline block inside a conversation turn, so consecutive tasks
 * need vertical rhythm and the native turn tail indents to the turn column. */
.dsh-fusion-card { margin-block: 12px; }
.dsh-fusion-card.is-native { margin-inline: 12px; }
/* The brief title takes the free space between the kicker and the actions. */
.dsh-fusion-title { flex: 1 1 8rem; }
/* Acceptance criteria are plain bullets, not the contract's selectable rows. */
.dsh-fusion-list { margin: 0; padding-inline-start: 20px; display: grid; gap: 4px; }
/* A candidate report keeps the line breaks the reviewer wrote. */
.dsh-fusion-report { white-space: pre-wrap; }
/* A long candidate scrolls inside the card instead of growing the turn. */
.dsh-fusion-candidate { max-height: 18rem; overflow: auto; }
/* The review dialog is a wide side-by-side diff, so it widens the official
 * card and lets its content region scroll. The card's own material — mask,
 * blur, radius-panel and elevation — stays with the Modal primitive. */
.dsh-fusion-modal { width: min(92vw, 80rem); max-height: 100%; }
.dsh-fusion-modal-content { min-height: 0; overflow-y: auto; }
.dsh-fusion-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dsh-fusion-compare pre { max-height: 55vh; min-height: 12rem; overflow: auto; }
/* The primitives ship no textarea, so it keeps the platform element at the
 * official field geometry, exactly as dsh-ui-select does for a native select. */
.dsh-fusion-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 56px;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  resize: vertical;
}
@media (max-width: 700px) {
  .dsh-fusion-compare { grid-template-columns: minmax(0, 1fr); }
  .dsh-fusion-compare pre { max-height: 30vh; min-height: 6rem; }
}
/* The settings row is the plugin's own feature layout; its fields, controls
 * and copy tiers are all contract classes. */
.fusion-settings { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
`
