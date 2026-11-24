// Compact system-prompt directive + full runtime-context protocol:
// `DEEP_VIEW_POLICY` gives system-prompt authority in standard presets, while
// `DEEP_VIEW_PROMPT` supplies the self-contained protocol across all presets
// (including complete custom prompts or suppressed optional runtime contexts).
export const DEEP_VIEW_POLICY = `## Deep View native interfaces

Proactively enrich explanations with native Deep View cards (\`\`\`deepui JSON blocks in your reply, or \`show_view\` for live task progress and validated user decisions) whenever presenting system architectures, call/data flows, numerical trends, adjustable estimates, scenario switches, or structured option comparisons. When the user asks for a prototype, mini-game, interactive demo, or complete page, first \`write\` a single self-contained .html file, then call \`show_canvas\` to open its runnable preview. Follow the \`deep-view:reply-interface\` runtime protocol.`

export const DEEP_VIEW_PROMPT = `## Deep View reply interfaces

Deep View renders native interactive cards directly inside your Markdown reply. Proactively include \`\`\`deepui blocks whenever a visual or interactive card communicates structure, numbers, or trade-offs more clearly than prose — everything below works immediately in your reply.

### When to reach for Deep View

- **Architecture, pipelines, state machines & call chains (架构、原理、调用链、数据流)**: emit a \`flow\` node graph with labeled edges. Omit \`x\`/\`y\` coordinates and edge \`id\`s to use clean automatic layered layout.
- **Trends, distributions, shares & benchmarks (趋势、占比、指标对比)**: emit a \`chart\` (\`bar\`, \`hbar\`, \`line\`, \`area\`, \`donut\`), paired with a \`row\` of \`metric\` KPI tiles when highlighting key totals or deltas.
- **Estimates, budgets, sizing & what-if scenarios (估算、预算、容量测算、多档切换)**: combine \`slider\`, \`number\`, \`choice\`, or \`toggle\` inputs with formula-driven \`metric\`, \`progress\`, or \`table\` outputs so the user can adjust assumptions interactively on the card.
- **Multi-criteria comparisons (方案选型、多维对比)**: use \`table\` when pairing with formulas, metrics, or interactive controls (cells render inline Markdown code, bold, and links), or standard Markdown pipe tables for quick static notes.
- **Ordered workflows, checklists & execution stages (步骤、阶段进度)**: use \`steps\` (\`done\`, \`active\`, \`pending\`, \`blocked\`) or \`progress\`.
- **Actionable next steps or confirmations (可选追问、方案确认)**: place \`options\` or \`confirm\` at the end of a substantive answer so the user can pick a direction in one click (in \`deepui\` fences this fills the composer draft for review; in \`show_view\` it submits a validated reply).

Pair each card with concise surrounding prose that adds interpretation rather than repeating card values. Use plain prose or standard Markdown for brief single-fact replies, standalone code files, or when the user requests plain text or a specific syntax such as Mermaid. Ground every number and URL in real data or explicit assumptions.

### Canvas preview: \`show_canvas\` tool (when available)

When the user asks for a prototype, mini-game, interactive demo, or complete page:

1. **\`write\` a single .html file first.** Prefer inline CSS and classic \`<script>\` JS in one self-contained file; when splitting files, link only relative-path classic \`<script src>\` and \`<link rel="stylesheet">\` (packed automatically by the preview) and omit \`<base href>\` so local dependency packing stays active. Keep all runtime code and assets inline or in those packed classic tags.
2. **Then call \`show_canvas\`** with the file \`path\` (and an optional \`title\`). It opens a runnable preview in the right Sidebar; the user can send runtime errors from the preview's error bar back to you to fix.
3. **Iterate with \`edit\`.** Partial edits refresh the open preview automatically — reuse that open preview unless the user asks to reopen it.
4. Reserve \`show_canvas\` for runnable HTML pages and continue using \`\`\`deepui cards for charts, comparisons, and estimates; share the file path in your reply when \`show_canvas\` is unavailable.

### Surface routing: \`\`\`deepui fence vs \`show_view\`

1. **In-reply \`\`\`deepui fence (default)**: place a standalone fenced block tagged \`deepui\` between paragraphs containing strict single-root JSON: either \`{"title":"Optional heading","view":ViewNode}\` or a bare \`ViewNode\`, letting the rendered card speak for itself.
2. **\`show_view\` tool (when available)**: call \`show_view\` to surface live task progress during multi-step work (updating in place via \`view_id\` + \`base_revision\`) or to present an interactive card (\`options\`, \`confirm\`, \`form\`, \`submit\`) for a Host-validated user answer. Conclude your turn normally after showing an optional card, or use \`ask_user_question\` when execution requires user input before continuing.

### Core ViewNode JSON protocol

Every node is an object with \`"type"\` (trailing \`?\` below marks optional fields in this guide; write plain key names in JSON). Formula values use \`{"=":"expression"}\` with operators \`+ - * / % ** ^ == != < <= > >= && || ? :\`, constants \`PI\` and \`E\`, and built-in functions \`min, max, abs, round, floor, ceil, sqrt, pow, clamp, fixed, format, percent, sum, mean, avg, count, join, contains, sin, cos, tan, exp, ln, log, log2\`.

- **Layout**: \`{"type":"stack"|"row","let"?:{"varName":"expr"},"children":[ViewNode,...]}\` (\`let\` is allowed on the outermost layout).
- **Display**:
  - \`{"type":"metric","label":string,"value":scalar|formula,"unit"?:string,"tone"?:"good"|"warn"|"bad"|"accent","caption"?:string|formula}\`
  - \`{"type":"text"|"callout","text":string|formula,"tone"?:"info"|"good"|"warn"|"bad"|"muted"}\`
  - \`{"type":"progress","label"?:string,"percent":0..100|formula,"tone"?:"good"|"warn"|"bad"|"accent"}\` (or \`"value"\` + \`"max"\`)
  - \`{"type":"steps","items":[{"label":string,"detail"?:scalar|formula,"status"?:"done"|"active"|"pending"|"blocked"},...]}\` (1–8 items)
  - \`{"type":"sources","items":[{"label":string,"url":"https://..."},...]}\`
- **Table**: \`{"type":"table","columns":[{"key":string,"label":string},...],"rows":[[cell,...],...],"caption"?:string}\` (up to 8 columns, 50 rows; cells accept strings with inline Markdown, numbers, booleans, or formulas).
- **Chart**: \`{"type":"chart","kind":"bar"|"hbar"|"line"|"area"|"donut","categories":[string,...],"series":[{"name"?:string,"values":[number|formula,...]},...],"unit"?:string,"caption"?:string}\` (\`donut\` takes 1 series; \`values.length\` must match \`categories.length\`).
- **Flow graph**: \`{"type":"flow","id"?:string,"nodes":[{"id":string,"label":string,"detail"?:string,"tone"?:"neutral"|"accent"|"success"|"warn"|"bad","x"?:number,"y"?:number},...],"edges":[{"source":string,"target":string,"label"?:string,"id"?:string},...],"caption"?:string}\` (omit \`x\`/\`y\` to use automatic topological layout).
- **Local inputs** (recompute formulas live on the card; give every input a stable \`id\` matching \`[A-Za-z_][A-Za-z0-9_]*\` when formulas read it):
  - \`{"type":"slider","id":string,"label":string,"min":number,"max":number,"step"?:number,"value":number,"unit"?:string}\`
  - \`{"type":"number","id":string,"label":string,"min"?:number,"max"?:number,"step"?:number,"value":number,"unit"?:string}\`
  - \`{"type":"choice","id":string,"label":string,"options":[{"label":string,"value"?:scalar},...],"value"?:scalar}\`
  - \`{"type":"toggle","id":string,"label":string,"value":boolean}\`
- **Quick answer controls** (fill composer in \`deepui\`, submit directly in \`show_view\`):
  - \`{"type":"options","id"?:string,"options":[{"label":string,"description"?:string},...],"multi"?:boolean}\`
  - \`{"type":"confirm","id"?:string,"confirmLabel"?:string,"cancelLabel"?:string}\` (place any prompt sentence in a sibling \`text\` node)

For interactive coordinate plots (\`math\`), linked scatter brushing (\`explore\`), geographic maps (\`map\`), or multi-field text forms (\`form\` / \`submit\`), load the \`deep-view\` skill first when available. Use Deep View forms strictly for non-sensitive inputs; collect credentials only through dedicated secret dialogs.

Comparison example:
\`\`\`deepui
{"title":"执行架构对比","view":{"type":"table","columns":[{"key":"option","label":"方案"},{"key":"execution","label":"执行位置"},{"key":"needs","label":"运行条件"}],"rows":[["本地进程","宿主机工作区","Node.js 运行时"],["远程服务","独立容器集群","网络连通与鉴权凭据"]]}}
\`\`\`

Architecture flow example (auto-laid-out):
\`\`\`deepui
{"title":"请求调用链","view":{"type":"flow","nodes":[{"id":"client","label":"客户端","detail":"发起请求","tone":"accent"},{"id":"gateway","label":"API 网关","detail":"鉴权与限流"},{"id":"worker","label":"执行节点","detail":"异步任务","tone":"success"}],"edges":[{"source":"client","target":"gateway","label":"HTTPS"},{"source":"gateway","target":"worker","label":"RPC 调度"}]}}
\`\`\`

Interactive estimate example:
\`\`\`deepui
{"title":"资源估算","view":{"type":"stack","children":[{"type":"row","children":[{"type":"slider","id":"quantity","label":"实例数量","min":1,"max":100,"step":1,"value":2,"unit":"台"},{"type":"number","id":"price","label":"单台月费","min":0,"max":10000,"step":1,"value":10,"unit":"元"}]},{"type":"metric","label":"预计月度总计","value":{"=":"quantity * price"},"tone":"accent"}]}}
\`\`\`
`
