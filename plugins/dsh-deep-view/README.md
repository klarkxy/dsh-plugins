# Deep View reply cards

<!-- release-state-note -->

Deep View renders interactive, declarative cards during assistant replies: workflow steps, metrics, tables, charts, progress, callouts and sources. Local inputs update formulas immediately without another model request.

## Install

Install the `@klarkxy/dsh-deep-view` bundle through the DSH plugin manager, then enable **Deep View reply cards**. The package contains its Host and Web Client halves; no account or external service is required.

## Use

Ask the model to use Deep View directly. It can also choose a card for a workflow, comparison, adjustable estimate, progress, or an optional choice. The model loads the on-demand `deep-view` skill, then calls `show_view`; full instructions load only when needed. A complete card can appear while the turn is still running, not only after the final reply.

Layouts are `stack` and `row`. Display components are `text`, `metric`, `table`, `chart` (`bar`, `hbar`, `line`, `area`, `donut`), `progress`, `callout`, `sources` and `steps`. Steps show `done`, `active`, `pending` and `blocked` states without simulating a flowchart with nested callouts. `slider`, `number`, `choice` and `toggle` provide local input. Formulas use `{ "=": "price * count" }`; they support arithmetic, comparisons, conditionals and a fixed function set, not JavaScript execution.

`options`, `confirm`, `form` and `submit` provide answers. A waiting card can appear above the composer and offers two actions when supported: **Fill composer** puts the validated answer into the draft without sending it; direct submission delivers one validated answer into the live top-level conversation. Existing drafts are never replaced without an explicit choice. Form fields support initial values, multiline text, read-only values and cancellation.

Submitted choices and field values appear as readable messages and are saved with them. Refreshing or reopening the conversation restores submitted values and selected options. Current progress uses one replaceable activity view rather than accumulating progress cards. Charts support keyboard inspection, table view and CSV copying.

## Limits

- Cards are opt-in; the plugin does not force every answer into a card or change stored assistant text. A `deepui` fenced code block in prose stays ordinary code. Long explanations and code may remain Markdown.
- Activity updates arrive at tool-call boundaries. The plugin does not stream arbitrary progress from inside another long-running tool or modify historical tool results.
- Only a live `show_view` card can submit through the Host channel. A pending card is lost when the plugin restarts, although its saved card remains visible in the conversation.
- A pending card closes after an answer or another ordinary user message. Do not use cards to collect passwords, keys or tokens.
- Older answers are restored only when their saved message identifies the card and values unambiguously. Unsubmitted local changes are not automatically persisted.
- The `html` component and PNG export are not included. No model-authored HTML or JavaScript is executed.
- Theme and actual rendering depend on the installed DSH Web Client. A source build does not by itself prove runtime or visual compatibility.
