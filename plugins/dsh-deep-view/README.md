# Deep View reply cards

<!-- release-state-note -->

Deep View renders opt-in declarative cards in assistant replies below the final answer: metrics, tables, charts, progress, callouts and sources, plus local inputs whose formulas update immediately without another model request.

## Install

Install the `@klarkxy/dsh-deep-view` bundle through the DSH plugin manager, then enable the **Deep View reply cards** row. The workspace contains its Host and Web Client halves; no account or external service is required.

## Use

The model adds a card on its own when numbers are compared, an estimate depends on adjustable parameters, or the reply ends with a choice for you; you can also ask for one directly. The model calls the `show_view` tool with `{ "title"?: string, "view": ViewNode }`; the tool prepares the card, then the model writes its final answer. The card appears directly below that answer, outside collapsed tool activity.

Layouts are `stack` and `row`. Display components are `text`, `metric`, `table`, `chart` (`bar`, `hbar`, `line`, `area`, `donut`), `progress`, `callout` and `sources`. `slider`, `number`, `choice` and `toggle` provide local input. Formulas use `{ "=": "price * count" }`; they support arithmetic, comparisons, conditionals and a fixed function set, not JavaScript execution.

After the final reply finishes, the `options`, `confirm`, `form` and `submit` components can deliver one validated answer into a live top-level conversation. Your choice and field values appear as a readable message and are saved with it. Refreshing or reopening the conversation restores the submitted values and selected option. Charts support keyboard inspection, table view and CSV copying.

## Limits

- Cards are opt-in; the plugin does not force every answer into a card or change stored assistant text. A `deepui` fenced code block in prose stays ordinary code; cards prepared by `show_view` render in the final reply area.
- Only a live `show_view` card can submit through the Host channel; a pending card is lost when the plugin restarts, although the saved card remains visible in the final reply area.
- A pending card closes after an answer or another ordinary user message. Do not use cards to collect passwords, keys or tokens.
- Older answers are restored only when their saved message identifies the card and values unambiguously. Unsubmitted local changes are not saved.
- The `html` component and PNG export are not included. No model-authored HTML or JavaScript is executed.
- Theme and actual rendering depend on the installed DSH Web Client. A source build does not by itself prove runtime or visual compatibility.
