# Deep View intelligent UI

<!-- release-state-note -->

[简体中文](README.md) / English

Compose native charts, comparisons, workflow steps, metrics, adjustable estimates, and explorable views directly inside assistant replies, then turn interactions into answers. Ordinary Markdown prose flows naturally around each interface.

## Demo

![A malformed node-graph declaration repairs itself once the fence closes; an unrepairable one names the reason](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/pr28-deep-view-repair.gif)

## Downloads

[![Daily npm downloads trend](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-deep-view.svg)](https://www.npmjs.com/package/@klarkxy/dsh-deep-view)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-deep-view
```

Replace `web` with your profile name, then restart the profile and reload the page after installing or updating. The package includes both the Host and Web Client halves; no account or API key is required.

## Usage

Ask naturally for an architecture breakdown, call path, trend, option comparison, adjustable budget, interactive math plot, data exploration, or map; you do not need to name Deep View. In user-facing conversations, the plugin supplies both system-prompt selection policy and runtime interface instructions, encouraging the model to explain architectures with node graphs, chart real trends, and attach live controls for estimates and follow-up choices while keeping prose and code alongside them.

Once enabled in a profile, the interface protocol applies to user-facing conversations across all its presets: ordinary chat, plan mode, PTC code execution, and modes with a complete custom prompt or optional runtime context disabled. Switching modes needs no extra configuration. Common views can still appear directly in replies when tools are unavailable; plan-mode execution restrictions, user-requested formats, and strict structured-output requirements remain in effect.

Common node graphs, charts, comparison tables, steps, adjustable estimates (including `slider`, `number`, `choice`, and `toggle`), and quick follow-up controls (`options` and `confirm`) do not require a skill call first. The `deep-view` skill remains a reference for interactive math planes (`math`), linked scatter exploration (`explore`), maps (`map`), and multi-field forms (`form` and `submit`). You can request plain text, Markdown only, or another specific format; short facts and code-only tasks are not forced into cards. Delegated subagents do not receive this proactive interface guidance; the main conversation composes the final answer.

### Two Interface Surfaces

- **Reply interfaces (`deepui` fence)**: The model embeds a `deepui` declaration between paragraphs. Once its JSON finishes streaming, Deep View replaces it in place with a native card so charts, tables, metrics, and calculators remain in reading order. Answer actions fill the composer via **Fill composer** so you can review before sending.
- **Task interfaces (`show_view` tool)**: Used to display progress before a reply exists, or to show an interactive card whose answer is validated and submitted directly by the Host. Progress views update a single replaceable activity slot above the composer during the turn; pending answer cards can appear in the composer dock while the turn runs and remain in the reply afterwards, with only one editable pending card per session at a time.

### Components, Interactive Views, and Formulas

Both surfaces share the same component set and reactive card state:

- **Layout and core components**: Layouts are `stack` and `row` (the outermost layout can define `let` bindings for formulas). Display components are `text`, `metric`, `table` (supporting inline Markdown code, bold text, and links inside cells), `chart` (`bar`, `hbar`, `line`, `area`, `donut`, with table view toggle and data copy), `progress`, `callout`, `sources`, and `steps`. Local inputs are `slider`, `number`, `choice`, and `toggle`.
- **Formulas**: Written as `{ "=": "price * count" }`, supporting arithmetic, exponentiation (`**` and `^`), comparisons, conditionals, built-in constants (`PI` and `E`), and a fixed math/aggregation function set without arbitrary JavaScript execution.
- **Explorable rich views**:
  - `math` (Mafs): draws a coordinate plane over the declared `domain` and `range` with 1–4 draggable points and up to 4 `f(x)` curves. The viewport stays within the declared bounds (no panning or zooming); curves and formulas read each point's live coordinates, local inputs, and `let` bindings.
  - `flow` (React Flow): draws a declared node graph, automatically laying out nodes in topological layers and routing four-way edges when coordinates are omitted. You can pan, zoom, drag nodes, and select a node to inspect its details; the selected node feeds the rest of the card. (Adding, connecting, or deleting nodes/edges is disabled.)
  - `explore` (Vega-Lite): renders inline scalar rows as an interactive scatter plot with a collapsible data table. Click points to select categories or drag an `x`/`y` interval selection (double-click to clear), linked back to the card.
  - `map` (MapLibre): displays declared locations and routes alongside an always-present accessible location list; selecting a marker or list item updates the rest of the card.
- **Shared card state**: Local inputs and rich selections (math coordinates, flow nodes, scatter selections, and map locations) immediately recompute formulas, metrics, and tables on the same card without another model request, and are included in the readable answer.

### Answers, Updates, and Restoration

- **Answer controls**: Supports `options` (single/multi select), `confirm`, `form`, and `submit`. A `show_view` direct submission is validated by the Host against the card's declared controls and current `revision`. Reply (`deepui`) cards—and `show_view` cards when choosing **Fill composer**—write the formatted answer into the composer (asking whether to replace or append if a draft already exists) and never send silently.
- **In-place updates**: `show_view` can replace an existing card in place by passing its `view_id` and the latest `revision`. Stale revisions or answers to replaced or closed cards are rejected rather than overwriting newer state.
- **Restoration and read-only state**: Directly submitted answers and unambiguous composer answers restore with their card when refreshing or reopening the conversation; answered cards become read-only.

## Limitations

- **Selection and fence timing**: Guidance encourages proactive interface selection but does not guarantee a card on every request, force visual layouts, or alter ordinary Markdown rendering. A `deepui` fence renders only once its JSON is complete. Common field aliases, numeric strings, omitted input IDs, and extra decorative fields are normalized automatically; declarations that still cannot be identified safely surface their validation reason while keeping the raw code viewable.
- **Closed native widgets**: No arbitrary JavaScript, HTML, or `html` component, and no PNG export. `explore` accepts inline scalar rows only (no arbitrary Vega-Lite specs or remote data sources); `map` accepts coordinates and routes only (no custom style URLs, tile servers, or API keys); `flow` renders declared nodes and edges only (no custom node components).
- **Tool-call boundary updates**: Activity updates from `show_view` happen at tool-call boundaries; the plugin does not stream progress from inside other long-running tools or rewrite historical tool results.
- **Session and lifecycle boundaries**: Only a live `show_view` card in a human-driven top-level session or ordinary conversation fork can submit directly through the Host (delegated subagents cannot collect direct answers). Restarting the plugin clears in-memory pending state, though saved content remains visible in the session.
- **Card lifetime and privacy**: A pending card closes after an answer or a new ordinary user message, answered cards become read-only, and unsubmitted local input changes do not persist. Do not use interfaces to collect passwords, keys, or tokens.
- **Map environment**: The map loads a fixed public demo basemap and accepts no custom style source. Without network access or WebGL, or if the basemap fails to load, the card displays a notice and the location list remains usable.
- **Size and count bounds**: Card payload size, component count and depth, curves, graph nodes/edges, data rows, and locations are all bounded; exceeding a limit rejects the card rather than truncating silently.
- **Host appearance**: Theme colors and rendering depend on the installed DSH Web Client.

## License

Licensed under [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for upstream attribution and bundled third-party component notices.
