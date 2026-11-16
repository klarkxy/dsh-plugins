# Deep View intelligent UI

<!-- release-state-note -->

Deep View composes intelligent interfaces inside assistant replies. Ordinary Markdown can flow into native charts, comparisons, workflow steps, metrics, adjustable estimates and answer controls, then continue as prose. Some interfaces are explorable: an interactive math plane, a node graph, a linked data explorer or a map. Interactions on a card update its formulas and other components immediately, without another model request.

## Install

Install the `@klarkxy/dsh-deep-view` bundle through the DSH plugin manager, then enable **Deep View intelligent UI**. The package contains its Host and Web Client halves; no account or API key is required.

## Use

Ask naturally for a comparison, a trend, a process, an adjustable budget, an interactive math plot, a node diagram, a map or another task that benefits from a visual interface. You can also name Deep View explicitly. The model decides whether prose is sufficient and loads the on-demand `deep-view` skill only when an interface would help.

Two complementary surfaces are available:

- **Reply interfaces.** The model places a `deepui` declaration between paragraphs. Deep View replaces it with a native interface at that exact position as soon as its JSON becomes complete during streaming. Charts, tables, metrics and interactive estimates stay in the reading flow instead of moving to the end of the turn.
- **Task interfaces.** The model calls `show_view` for progress that should be visible before the reply exists, or for a direct answer that must be validated by the Host. Current progress uses one replaceable activity view. Awaiting answers can use the composer dock during the turn and remain in the reply afterwards; there is only one editable instance at a time.

Both surfaces can contain the same components. Layouts are `stack` and `row`. Display components are `text`, `metric`, `table`, `chart` (`bar`, `hbar`, `line`, `area`, `donut`), `progress`, `callout`, `sources` and `steps`. `slider`, `number`, `choice` and `toggle` provide local input. Formulas use `{ "=": "price * count" }`; they support arithmetic, comparisons, conditionals and a fixed function set, not JavaScript execution.

Four components are visual and interactive:

- `math` (Mafs) draws a coordinate plane with one to four draggable points and up to four `f(x)` curves over the declared domain and range. The plane stays within that declared view instead of panning or zooming; formulas and other components can read each point's live coordinates.
- `flow` (React Flow) draws the declared node graph. You can pan, zoom, drag nodes into a layout and select one node; the rest of the card can read that selection.
- `explore` (Vega-Lite) plots declared inline rows as a scatter and links one selection back to the card: click points to choose categories, or drag to select an `x`/`y` interval. A collapsible table lists the same rows.
- `map` (MapLibre) shows declared locations and routes and always renders a location list beside the map; the rest of the card can read the selected location.

Within one card that state is shared: inputs, math point positions and node, map or scatter selections feed every formula, metric and table on the card, and they are recorded in the readable answer.

`options`, `confirm`, `form` and `submit` provide answers. A `show_view` answer is checked by the Host against the card's declared controls and current revision before it is submitted. A reply interface uses **Fill composer** so you can review and send the answer yourself; it never silently sends or replaces an existing draft. Choices, field values, adjustable inputs and rich selections are included in the readable answer.

`show_view` can also update a card instead of adding a second one: the model passes the card's `view_id` with the revision it last saw, and the card is replaced in place with the next revision. A stale revision, or an answer to a card that has been replaced or closed, is refused instead of overwriting newer state.

Directly submitted answers and unambiguous composer answers are restored with their interface after refreshing or reopening the conversation. Charts support keyboard inspection, table view and CSV copying; a card that has been answered becomes read-only.

## Limits

- Interfaces are opt-in and model-selected; the plugin does not force every answer into a visual layout or change the rest of the assistant's Markdown.
- A `deepui` fence renders after its complete JSON is available, not as arbitrary node-by-node UI patches. Malformed declarations remain available as ordinary code. Model decisions depend on the selected model and prompt.
- The rich components are closed native widgets, not a charting, diagramming or mapping language: no arbitrary JavaScript or HTML and no `html` component; `explore` accepts inline scalar rows, not a Vega-Lite spec or a remote data source; `map` accepts coordinates, not a style URL, tile server or API key; `flow` accepts declared nodes and edges, not custom node components. PNG export is not included.
- Activity updates from `show_view` arrive at tool-call boundaries. The plugin does not stream arbitrary progress from inside another long-running tool or modify historical tool results.
- Only a live `show_view` interface in a human-driven top-level session or ordinary conversation fork can submit through the Host channel. Delegated subagents cannot collect direct answers. A pending interface is lost when the plugin restarts, although its saved content remains visible. Reply-fence interactions fill the composer instead.
- A card is interactive only while it is live: a pending interface closes after an answer or another ordinary user message, an answered card becomes read-only, and local changes that were never submitted are not persisted. Do not use interfaces to collect passwords, keys or tokens.
- The map loads a fixed remote demo basemap and does not accept another style source. Without network access or WebGL, or when the basemap fails to load, the card shows a notice and the location list still works for choosing a location.
- Each card is bounded: an excessive number of components, curves, graph nodes, inline rows or locations is rejected rather than silently truncated.
- Theme and actual rendering depend on the installed DSH Web Client. A source build does not by itself prove runtime or visual compatibility.
