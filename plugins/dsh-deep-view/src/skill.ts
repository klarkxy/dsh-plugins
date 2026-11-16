export const DEEP_VIEW_SKILL_DESCRIPTION = 'Compose intelligent reply interfaces: visual explanations, interactive math, selectable graphs, linked data exploration, maps, estimates and answers. Load before using deepui fences or show_view.'

export const DEEP_VIEW_SKILL = `# Deep View

Compose a reply from ordinary Markdown and small native interfaces. Do not read the plugin package, source, README, or type declarations to render a view; those are development tasks. Use these instructions instead.

## Decide whether an interface helps

Use Deep View when the user explicitly names it, or when a visual or interaction does a job prose cannot do as well: comparing options, showing a real trend or share, exploring an estimate with adjustable inputs, explaining a process, or collecting an optional answer.

Prefer plain Markdown for conversation, long explanations, code, and one or two facts. Do not invent data, wrap a paragraph in a callout, or add controls that do not change a visible result or answer. A response may contain no view. A focused response usually needs only one; use several only when they answer distinct parts of the request.

## Choose the surface

### In the reply: a deepui fence

For a visual explanation, comparison, interactive diagram-like explanation, or local calculator, put a \`deepui\` fenced JSON block at the exact place it belongs in the response. Write natural Markdown before it, between views, or after it. Do not repeat its numbers, table, or options in prose.

The fence contains either one ViewNode or \`{ "title": "optional task title", "view": ViewNode }\`. Omit the title when the surrounding sentence already names the subject. The interface appears as soon as its JSON is complete; do not show or explain the JSON to the user.

### During the task: show_view

Call \`show_view\` when a view must appear before the response exists, when progress must be replaced while work continues, or when a direct answer must be validated and delivered by the Host. Load this skill before the call. Arguments are \`title\`, \`view\`, optional \`await_reply\`, and optional \`view_id\` + \`base_revision\` for an update; \`await_reply\` is only for answer controls.

A result returns its stable \`viewId\` and integer \`revision\`. To update it, call \`show_view\` again with that \`view_id\`, the latest \`base_revision\`, and a **complete** replacement \`view\`; it is a snapshot, not a JSON Patch. A stale or already answered revision cannot update or answer. Keep the same answer-control capability when updating: changing from a question to a display or vice versa requires a new view. Do not create repeated cards to show one changing result.

A waiting view can appear above the composer while the turn runs and becomes the inline answer surface after the reply. A new human message closes an old waiting view. Only one view can await an answer at a time. Do not wait or poll after showing one.

Use \`ask_user_question\` instead when an answer is required before the agent can safely continue. Users can answer a waiting view directly or fill the native composer and review the answer before sending. Filling the composer is not sending.

## Native ViewNode protocol

Nodes nest under \`stack\` or \`row\` using \`children\`; optional \`let\` values on the outermost layout are visible to formulas.

- Display: \`text\`, \`metric\` (\`label\`, \`value\`), \`table\` (\`columns\`: \`{key,label}\`, \`rows\`: cells), \`chart\` (\`kind\`: \`bar\` / \`hbar\` / \`line\` / \`area\` / \`donut\`, \`categories\`, \`series\`: \`{name?,values}\`), \`progress\` (\`percent\` or \`value\` + \`max\`), \`callout\` (\`text\`), \`sources\` (\`items\`: \`{label,url}\`).
- Workflow: \`steps\` with \`items\`: \`{label,detail?,status}\`. Status is \`done\`, \`active\`, \`pending\`, or \`blocked\`; use 1–8 items. Use this instead of a stack of callouts and arrows. Explain branches briefly in \`detail\`; this is not a node-link diagram.
- Local inputs: \`slider\`, \`number\`, \`choice\`, \`toggle\` (\`id\`, \`label\`, \`value\`). Inputs immediately update local formulas without another model request.
- A \`{"=":"expr"}\` formula replaces a value or cell, reading input ids and let names. It supports arithmetic, comparison, conditional expressions, and a fixed function set; no JavaScript execution.
- Interactive math: \`math\` with \`id\`, \`mathPoints\`: \`{id,label?,x,y,constrain?}\` (\`free\`/\`horizontal\`/\`vertical\`), optional \`curves\`: \`{label?,expression}\`, \`domain\`/\`range\`: \`[min,max]\`. Point ids expose \`<pointId>X\` and \`<pointId>Y\` to formulas and curves; \`x\` is the curve variable. Example: \`{"type":"stack","children":[{"type":"math","id":"plot","mathPoints":[{"id":"a","label":"A","x":1,"y":2}],"curves":[{"expression":"aX * x"}],"domain":[-5,5],"range":[-5,5]},{"type":"metric","label":"Slope","value":{"=":"aX"}}]}\`.
- Relationships: \`flow\` with \`id\`, \`nodes\`: \`{id,label,detail?,x,y,tone?}\` (\`neutral\`/\`accent\`/\`success\`/\`warn\`/\`bad\`), \`edges\`: \`{id,source,target,label?}\`. Stable ids must be distinct. Users can select and drag nodes, pan and zoom; they cannot add, connect or delete them. Selection is the selected node id (empty when none).
- Data exploration: \`explore\` with \`id\`, inline \`data\`: scalar rows, \`xKey\`, \`yKey\`, optional \`colorKey\`, \`select\`: \`point\` (default) or \`interval\`. Point selection gives selected category values as an array; interval gives \`{"size":[low,high]}\`. Use it for actual linked selection/brushing, not as a general Vega spec. Use the existing lightweight \`chart\` for a static trend or comparison.
- Places and routes: \`map\` with \`id\`, \`locations\`: \`{id,label,detail?,coordinates}\` with coordinates as \`[longitude,latitude]\`, optional \`routes\`: \`{label?,coordinates}\` whose coordinates are \`[[longitude,latitude],...]\`, \`center\`, \`zoom\`. Selection is the stable location id (empty when none). The map uses a fixed public demo style and needs network/WebGL; the accessible location list still works without them. Never put secrets in location or route data. This plugin does not supply production basemaps, provider configuration, offline tiles or other mapping infrastructure. If the task needs those, consult the official MapLibre style/source documentation at https://maplibre.org/maplibre-style-spec/ and the chosen provider's official documentation, then integrate them as task-specific infrastructure outside this node. Never turn a model-provided URL, style or credential into executable map configuration.
- Answer controls: \`options\` (\`id\`, \`options\`: \`{label,description?}\`, optional \`multi\`), \`confirm\` (\`id\`), \`form\` (\`id\`, \`fields\`: \`{id,label,placeholder?,value?,multiline?,readOnly?}\`, optional \`submitLabel\` and \`cancelLabel\`), \`submit\` (\`id\`, \`label\`). In show_view these require \`await_reply\`: true. In a deepui fence they fill the composer for review instead of sending directly.
- No HTML component or JavaScript. \`chart\` is for quantitative data, not workflows. Never collect keys, tokens or passwords.

## Compose, do not decorate

- Start with the answer or reason when it helps the user read the interface. Let the view carry the structure; add only a short caveat or next step afterwards.
- Use a sentence or metric for one or two values. Use a chart for a real sequence, trend, or share. Use a table for aligned option or product differences.
- For an interactive estimate, place the inputs beside the result they change. A \`submit\` label should name the next task, such as “按这组假设继续规划”. The formula must express the visible result; if it cannot, say what is missing instead of pretending the control is intelligent.
- For a choice, use specific option labels and a direct next action. Do not ask the user to answer a question already resolved in prose.
- For current progress, use one \`steps\` or \`progress\` view. A later progress call replaces the previous activity above the composer rather than adding a stack. State only real progress; do not imply continuous streaming between tool calls. After completion, leave the useful result rather than an indefinite progress indicator.

## Examples

Reply with text and an inline comparison (the outer four-backtick block below is documentation notation; emit a normal three-backtick deepui fence in the reply):

\`\`\`\`markdown
直接部署更贴合现在的排期；主要差别在回滚成本。

\`\`\`deepui
{
  "view": {
    "type": "table",
    "columns": [{ "key": "option", "label": "方案" }, { "key": "rollback", "label": "回滚" }, { "key": "days", "label": "排期" }],
    "rows": [["直接部署", "换镜像", "2 天"], ["预发一周", "重做路由", "7 天"]]
  }
}
\`\`\`

如果团队要求预发签字，再选第二种。
\`\`\`\`

A local interactive estimate for show_view or a deepui fence:

\`\`\`json
{
  "title": "旅行预算",
  "view": {
    "type": "stack",
    "let": { "total": "days * people * daily" },
    "children": [
      { "type": "row", "children": [
        { "type": "slider", "id": "people", "label": "人数", "min": 1, "max": 6, "step": 1, "value": 2, "unit": "人" },
        { "type": "slider", "id": "days", "label": "天数", "min": 1, "max": 14, "step": 1, "value": 5, "unit": "天" }
      ] },
      { "type": "slider", "id": "daily", "label": "每人每天预算", "min": 200, "max": 2000, "step": 100, "value": 600, "unit": "元" },
      { "type": "metric", "label": "预计总预算", "value": { "=": "total" }, "caption": "可根据左侧假设实时调整" }
    ]
  }
}
\`\`\`
`
