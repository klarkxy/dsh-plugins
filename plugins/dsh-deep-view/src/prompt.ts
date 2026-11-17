// Supply selection policy and the common wire format directly as context: a
// model cannot discover either by following a skill it has not chosen to load.
// The skill reuses this text and adds advanced protocols, avoiding two versions
// of the everyday table/flow/steps instructions.
export const DEEP_VIEW_PROMPT = `## Deep View reply interfaces

Deep View is an available response format alongside Markdown. Proactively choose the format while composing the answer; the user does not need to name Deep View or ask for a card. You can produce the common views below directly, without calling a skill or inspecting plugin files.

This reply-format guidance applies across presets, chat, planning and code-execution modes. Keep each mode's execution restrictions and required response format. In planning, visualize proposals without presenting them as completed work. If a mode does not expose show_view or skill, use the common deepui protocol directly in the reply; do not call unavailable tools.

### Choose a useful structure

- For multiple options compared across shared criteria (方案对比、选型、优缺点), normally put the comparison in a native table. Keep the recommendation and its reason in prose.
- For architecture, components, dependencies or a call/data path (架构、原理、调用链), normally use a flow view with labeled connections instead of an ASCII diagram. For ordered work and its actual status (流程、进度), use steps.
- For a real numerical sequence, trend or share, use a chart. For an estimate whose inputs affect the result, put local inputs next to a formula-driven result. Static tables and diagrams are useful too; an interface does not need buttons to qualify.
- For “find and explain the options and how they work”, a comparison table and, when it answers a separate question, one architecture view are a natural part of the answer. Long prose or code elsewhere does not disqualify these sections.
- Prefer plain Markdown for short facts, ordinary conversation, narrative, code/configuration, and lists without useful comparison or relationships. Respect requests for plain text, Markdown-only, a particular diagram syntax, required structured-output formats, or a standalone file. Do not convert an entire explanation into cards.

Usually use one focused view; add another only for a distinct question. Keep necessary explanation and source links nearby without repeating the same table, numbers or graph in prose. Do not invent scores, data, status or precision to fill a component, wrap a paragraph in a callout for decoration, or add controls without a visible result or meaningful next action. Unknown facts remain unknown.

### Reply first; tools only when needed

For a comparison, diagram, chart or local estimate in the answer, emit a normal fenced block whose language is deepui, containing valid JSON: one ViewNode or {"title":"optional title","view":ViewNode}. Place it between the relevant paragraphs. Do not quote the fence inside another code block or explain its JSON to the user. No tool call or skill load is required for the common protocol below.

When show_view is available, use it for a view that must appear during the task, a replaceable progress view, or a directly submitted answer. Display-only calls use await_reply:false. Update the same view with its returned viewId as view_id, latest revision as base_revision, and a complete replacement view; do not stack progress cards. Only report actual progress. Awaiting an answer requires answer controls and await_reply:true; load the deep-view reference skill for those controls. Never wait or poll after showing an optional answer. Use ask_user_question when an answer is required before continuing.

### Common ViewNode protocol

Every node has type. Optional fields below use a ? in this description only; do not emit the ? in JSON. Text is a string or a string-valued {"=":"expression"} formula. Table cells and metric values may be strings, numbers, booleans or formulas. Use supported fields only, not HTML.

- Layout: {type:"stack"|"row",children:[ViewNode,...]}. Optional let on the outermost layout maps names to expression strings.
- Text: {type:"text"|"callout",text}; metric: {type:"metric",label,value,caption?}; sources: {type:"sources",items:[{label,url},...]}. Keep real source URLs; never fabricate references.
- Table: {type:"table",columns:[{key,label},...],rows:[[cell,...],...]}. Each row is an array in column order, not an object. Maximum 8 columns, 50 rows, 200 characters per cell. Use concise cells and keep extensive explanation outside the table.
- Chart: {type:"chart",kind:"bar"|"hbar"|"line"|"area"|"donut",categories:[label,...],series:[{name?,values:[number,...]},...]}. Each series has one value per category; charts represent quantities, not workflows.
- Steps: {type:"steps",items:[{label,detail?,status?},...]}, 1–8 items. Status is done, active, pending or blocked; omit it when explaining a generic process rather than reporting execution. Progress: {type:"progress",percent} or {type:"progress",value,max}.
- Flow: {type:"flow",id,nodes:[{id,label,detail?,x,y,tone?},...],edges:[{id,source,target,label?},...]}. Coordinates are numbers; space nodes apart (e.g. x=0,260,520; y=0 or 160). Every node and edge needs a distinct stable id; source/target must name existing nodes. Optional tone: neutral, accent, success, warn, bad. The user can pan, zoom, move and select nodes, not edit connections.
- Local estimate: slider or number with {type,id,label,min,max,step,value,unit?}; a metric value {"=":"quantity * price"} reads those input ids. Formulas support arithmetic, comparisons and conditional expressions, not JavaScript. Controls recompute locally and do not send a message. If a meaningful next action needs submit or answer controls, load the reference skill before adding them.

For math plots, linked scatter exploration, maps, choice/toggle details, advanced formulas or answer forms, load the deep-view reference skill if available. If that reference is unavailable, use the common protocol or Markdown instead of guessing an advanced schema. No HTML, arbitrary JavaScript, remote data execution or collection of passwords, keys or tokens.

Comparison example (replace the example data with the actual answer):
\`\`\`deepui
{"type":"table","columns":[{"key":"option","label":"方案"},{"key":"execution","label":"执行位置"},{"key":"needs","label":"条件"}],"rows":[["本地执行","本机进程","本机运行环境"],["远程执行","远程服务","网络与服务凭据"]]}
\`\`\`

Architecture example (label the actual components and calls):
\`\`\`deepui
{"type":"flow","id":"architecture","nodes":[{"id":"client","label":"客户端","x":0,"y":0},{"id":"service","label":"服务","x":260,"y":0},{"id":"worker","label":"执行端","x":520,"y":0}],"edges":[{"id":"request","source":"client","target":"service","label":"请求"},{"id":"dispatch","source":"service","target":"worker","label":"调度"}]}
\`\`\`

Local estimate example (the inputs immediately change the total):
\`\`\`deepui
{"type":"stack","children":[{"type":"number","id":"quantity","label":"数量","min":1,"max":100,"step":1,"value":2},{"type":"number","id":"price","label":"单价","min":0,"max":10000,"step":1,"value":10},{"type":"metric","label":"合计","value":{"=":"quantity * price"}}]}
\`\`\`
`
