# Deep View intelligent UI

<!-- release-state-note -->

[简体中文](README.md) / English

Compose native charts, comparisons, workflow steps, metrics, adjustable estimates, and explorable views directly inside assistant replies, then turn interactions into answers. Ordinary Markdown prose flows naturally around each interface.

## Demo

![The model writes HTML and opens a Deep View canvas, then fills the composer with a preview error and fixes it](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/deep-view-canvas-live.gif)

## Downloads

[![Daily npm downloads trend](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-deep-view.svg)](https://www.npmjs.com/package/@klarkxy/dsh-deep-view)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-deep-view
```

Replace `web` with your profile name and restart the profile after installing.

## Usage

Restart the profile and reload the page after installing or updating so the frontend rendering components load. The package includes both the Host and Web Client halves; no account or API key is required.

Ask naturally for an architecture breakdown, call path, trend, option comparison, adjustable budget, interactive math plot, data exploration, or map; you do not need to name Deep View. In user-facing conversations, the plugin supplies both system-prompt selection policy and runtime interface instructions, encouraging the model to explain architectures with node graphs, chart real trends, and attach live controls for estimates and follow-up choices while keeping prose and code alongside them.

Once enabled in a profile, the interface protocol applies to user-facing conversations across all its presets: ordinary chat, plan mode, PTC code execution, and modes with a complete custom prompt or optional runtime context disabled. Switching modes needs no extra configuration. Common views can still appear directly in replies when tools are unavailable; plan-mode execution restrictions, user-requested formats, and strict structured-output requirements remain in effect.

Common node graphs, charts, comparison tables, steps, adjustable estimates (including `slider`, `number`, `choice`, and `toggle`), and quick answer controls (`options`, `confirm`, and `submit`) do not require a skill call first. The `deep-view` skill remains a reference for interactive math planes (`math`), linked scatter exploration (`explore`), maps (`map`), and composite multi-field forms (`form`). You can request plain text, Markdown only, or another specific format; short facts and code-only tasks are not forced into cards. Delegated subagents do not receive this proactive interface guidance; the main conversation composes the final answer.

### Interface Surfaces and Question Modes

- **Reply interfaces (`deepui` fence)**: The model embeds a `deepui` declaration between paragraphs. Once its JSON finishes streaming, Deep View replaces it in place with a native card so charts, tables, metrics, and calculators remain in reading order. Answer actions fill the composer via **Fill composer**, automatically collapsing the card into a single-line summary bar (click to expand and adjust again) so you can review before sending.
- **Blocking questions (`ask_view` tool)**: Used when the model needs your decision or multi-question form parameters before continuing the current turn. The card docks above the composer and resolves `ask_view` directly once answered without injecting a duplicate user message. Click **Continue first** on the dock bar at any time to let the model proceed immediately with provisional defaults while keeping the card open for an asynchronous reply. Set `replaceNativeAskUser: true` in the plugin config if you want to restrict the builtin `ask_user_question` tool in favor of Deep View.
- **Task and non-blocking interfaces (`show_view` tool)**: Used to display live progress before a reply exists, or to leave a non-blocking interactive card open at the end of a turn. Progress views update a single replaceable activity slot above the composer during the turn; pending answer cards can appear in the composer dock while the turn runs and remain in the reply afterwards, with only one editable pending card per session at a time.
- **Canvas preview (`show_canvas` tool)**: After the model writes an `.html` file for a prototype, mini-game, interactive demo, or complete page, it can call `show_canvas` to open a runnable preview in the right Sidebar; the **Open preview** button on the tool result card reopens it at any time. The canvas becomes the default renderer for `.html` / `.htm` files, while the builtin HTML preview remains selectable in the renderer dropdown.

### Canvas Preview

- **Requires "Show coding view"**: The canvas only registers and runs scripts while the host's "Show coding view" switch is on; when it is off, the tool card surfaces a notice with a one-click enable action while files fall back to the builtin static HTML preview.
- **Error bar and Fill composer**: Script exceptions, unhandled rejections, `console.error` calls, and `<img src>` / `<script src>` / `<link rel="stylesheet">` subresource load failures collect in an error bar below the preview (identical reports merge into a count, and packed local scripts map `blob:` URLs back to workspace relative paths and line numbers). **Fill composer** writes the error list into the composer for the model to fix — asking whether to replace or append when a draft exists — and never sends silently; errors can also be copied.
- **Static precheck and first-paint health receipt**: Before returning, `show_canvas` checks inline and packed classic `.js` syntax, warns on skipped local `<script type="module" src>` or `<base href>` tags, missing relative assets, unfilled open `<svg>` strokes, and 5 common hardcoded credential shapes without echoing secret text (inspired by [liliMozi/showcard](https://github.com/liliMozi/showcard), Agent Showcard 1.0 Specification §7.3). When a live client is open, a bounded first-paint probe returns initial runtime errors or `0px` body collapse inside the same turn so the model can self-heal via `edit`, while later interactive errors stay in the error bar for manual confirmation.
- **Automatic refresh**: Later `edit` changes to the file (including relatively referenced local scripts and styles) reload the preview and clear the error bar automatically, without calling the tool again.

### Components, Interactive Views, and Formulas

All surfaces share the same component set and reactive card state:

- **Layout and core components**: Layouts are `stack` and `row` (the outermost layout can define `let` bindings for formulas). Display components are `text`, `metric`, `table` (supporting inline Markdown code, bold text, and links inside cells), `chart` (`bar`, `hbar`, `line`, `area`, `donut`, with table view toggle and data copy), `progress`, `callout`, `sources`, and `steps`. Local inputs are `slider`, `number`, `choice` (single-select, `multi: true` checkboxes, and `allowCustom: true` custom text input), and `toggle`.
- **Formulas**: Written as `{ "=": "price * count" }`, supporting arithmetic, exponentiation (`**` and `^`), comparisons, conditionals, built-in constants (`PI` and `E`), and a fixed math/aggregation function set (including `count`, `join`, and `contains` over multi-select arrays) without arbitrary JavaScript execution.
- **Explorable rich views**:
  - `math` (Mafs): draws a coordinate plane over the declared `domain` and `range` with 1–4 draggable points and up to 4 `f(x)` curves. The viewport stays within the declared bounds (no panning or zooming); curves and formulas read each point's live coordinates, local inputs, and `let` bindings.
  - `flow` (React Flow): draws a declared node graph, automatically laying out nodes in topological layers and routing four-way edges when coordinates are omitted. You can pan, zoom, drag nodes, and select a node to inspect its details; the selected node feeds the rest of the card. (Adding, connecting, or deleting nodes/edges is disabled.)
  - `explore` (Vega-Lite): renders inline scalar rows as an interactive scatter plot with a collapsible data table. Click points to select categories or drag an `x`/`y` interval selection (double-click to clear), linked back to the card.
  - `map` (MapLibre): displays declared locations and routes alongside an always-present accessible location list; selecting a marker or list item updates the rest of the card.
- **Shared card state**: Local inputs and rich selections (math coordinates, flow nodes, scatter selections, and map locations) immediately recompute formulas, metrics, and tables on the same card without another model request, and are included in the readable answer.

### Answers, Auto-Collapse, and Restoration

- **Answer controls and composite forms**: Supports `options` (single/multi select plus `allowCustom` free-text entry), `confirm`, `form`, and `submit`, as well as multi-question `stack` layouts combining single/multi `choice`, sliders, toggles, and `form`/`submit` into one submission. Direct submissions in `ask_view` and `show_view` are validated by the Host against the card's declared controls and current `revision`. Reply (`deepui`) cards—and non-blocking `show_view` cards when choosing **Fill composer**—write the formatted answer into the composer (asking whether to replace or append if a draft already exists) and never send silently.
- **Auto-collapse on answer**: Answered and draft-filled cards collapse automatically into a compact single-line summary bar showing the title and recorded values; click the bar at any time to expand or re-collapse the full card.
- **In-place updates**: `show_view` can replace an existing card in place by passing its `view_id` and the latest `revision`. Stale revisions or answers to replaced or closed cards are rejected rather than overwriting newer state.
- **Restoration and read-only state**: Directly submitted answers (both synchronous `ask_view` receipts and asynchronous follow-up messages) and unambiguous composer answers restore with their card when refreshing or reopening the conversation; answered cards remain read-only.

## Limitations

- **Selection and fence timing**: Guidance encourages proactive interface selection but does not guarantee a card on every request, force visual layouts, or alter ordinary Markdown rendering. A `deepui` fence renders only once its JSON is complete. Common field aliases, numeric strings, omitted input IDs, and extra decorative fields are normalized automatically; declarations that still cannot be identified safely surface their validation reason while keeping the raw code viewable.
- **Closed native widgets**: No arbitrary JavaScript, HTML, or `html` component, and no PNG export. `explore` accepts inline scalar rows only (no arbitrary Vega-Lite specs or remote data sources); `map` accepts coordinates and routes only (no custom style URLs, tile servers, or API keys); `flow` renders declared nodes and edges only (no custom node components).
- **Tool-call boundary updates**: Activity updates from `show_view` happen at tool-call boundaries; the plugin does not stream progress from inside other long-running tools or rewrite historical tool results.
- **Session and lifecycle boundaries**: Only a live `ask_view` or `show_view` card in a human-driven top-level session or ordinary conversation fork can submit directly through the Host (delegated subagents cannot collect direct answers). Restarting the plugin clears in-memory pending state, though saved content remains visible in the session.
- **Card lifetime and privacy**: A pending card closes after an answer or a new ordinary user message, answered cards become read-only, and unsubmitted local input changes do not persist. Do not use interfaces to collect passwords, keys, or tokens.
- **Canvas preview boundaries**: Card surfaces still allow no arbitrary JavaScript or HTML. The canvas relies on the host file-preview pipeline: it packs only classic `<script src>` and `<link rel="stylesheet">` tags with direct relative references — no local ES module imports, CSS `url()`/`@import` of local files, or `fetch` of local files. Pages declaring `<base href>` are opened without packed local dependencies, so avoid that element. Scripts run inside an isolated sandbox. Turning "Show coding view" off falls back to the builtin static preview, and `show_canvas` is available only in user-facing top-level sessions.
- **Map environment**: The map loads a fixed public demo basemap and accepts no custom style source. Without network access or WebGL, or if the basemap fails to load, the card displays a notice and the location list remains usable.
- **Size and count bounds**: Card payload size, component count and depth, curves, graph nodes/edges, data rows, and locations are all bounded; exceeding a limit rejects the card rather than truncating silently.
- **Host appearance**: Theme colors and rendering depend on the installed DSH Web Client.

## Attribution

See [NOTICE](NOTICE) for upstream attribution and bundled third-party component notices. Redacted static credential precheck design is inspired by [liliMozi/showcard](https://github.com/liliMozi/showcard) (Agent Showcard 1.0 Specification).

## License

[Apache License 2.0](LICENSE)
