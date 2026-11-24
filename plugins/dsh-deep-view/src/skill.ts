import { DEEP_VIEW_PROMPT } from './prompt.ts'

export const DEEP_VIEW_SKILL_DESCRIPTION = 'Deep View reference for interactive math planes (math), linked scatter data exploration (explore), geographic maps (map), multi-field forms (form/submit) and view revisions. Everyday flows, charts, tables, estimates, choices and options are already covered in the reply-interface context. 中文：交互数学图、联动散点探索、地图与多字段表单参考。'

export const DEEP_VIEW_SKILL = `# Deep View reference

Everyday reply interfaces (\`flow\`, \`chart\`, \`table\`, \`metric\`, \`steps\`, \`slider\`, \`number\`, \`choice\`, \`toggle\`, \`options\`, \`confirm\`) work directly from the supplied reply-interface context. Render specialized rich canvases, multi-field forms, and view revisions directly from this self-contained reference.

${DEEP_VIEW_PROMPT}

## Specialized rich canvases

- **Interactive math (\`math\`)**: \`{"type":"math","id":string,"mathPoints":[{"id":string,"label"?:string,"x":number,"y":number,"constrain"?:"free"|"horizontal"|"vertical"},...],"curves"?:[{"label"?:string,"expression":string},...],"domain"?:[min,max],"range"?:[min,max],"caption"?:string}\`.
  - Requires 1–4 \`mathPoints\` and at most 4 \`curves\`.
  - Each point \`p\` publishes live \`pX\` and \`pY\` numeric bindings to formulas and curve expressions; \`x\` is the curve's free variable (e.g. \`"aX * x^2 + sin(PI * x)"\`). Curves can also read any slider/input \`id\` (above or below the plot) and outermost \`let\` names.
- **Linked data exploration (\`explore\`)**: \`{"type":"explore","id":string,"data":[{"col":scalar,...},...],"xKey":string,"yKey":string,"colorKey"?:string,"select"?:"point"|"interval","caption"?:string}\`.
  - Accepts 1–200 flat scalar rows with \`[A-Za-z_][A-Za-z0-9_]*\` field keys; \`xKey\` and \`yKey\` must hold finite numbers.
  - \`"point"\` (default) exposes an array of selected category values (\`colorKey ?? xKey\`), usable with \`count(id)\` or \`join(id)\`; \`"interval"\` exposes \`{xKey:[low,high], yKey:[low,high]}\`. Use \`chart\` instead when static bars/lines suffice.
- **Places and routes (\`map\`)**: \`{"type":"map","id":string,"locations":[{"id":string,"label":string,"detail"?:string,"coordinates":[longitude,latitude]},...],"routes"?:[{"label"?:string,"coordinates":[[lng,lat],...]},...],"center"?:[lng,lat],"zoom"?:0..22,"caption"?:string}\`.
  - Coordinates are \`[longitude, latitude]\` (1–60 public, non-sensitive locations, up to 8 routes). Exposes the selected location \`id\` (or \`""\` when unselected), with an accessible location list rendered below the world basemap.

## Multi-field forms, submit actions & view revisions

- **\`form\`**: \`{"type":"form","id":string,"fields":[{"id":string,"label":string,"placeholder"?:string,"value"?:string,"multiline"?:boolean,"readOnly"?:boolean},...],"submitLabel"?:string,"cancelLabel"?:string}\` (up to 6 fields).
- **\`submit\`**: \`{"type":"submit","id":string,"label"?:string}\` — submits all current local input values (\`slider\`, \`number\`, \`choice\`, \`toggle\`, \`math\`, \`flow\`, \`explore\`, \`map\`) for the next turn.

In \`show_view\`, cards containing \`options\`, \`confirm\`, \`form\`, or \`submit\` automatically await a user reply, whereas display-only views render immediately as status cards. To update an existing \`show_view\` card in place, pass its returned \`viewId\` as \`view_id\`, its latest \`revision\` as \`base_revision\`, and the complete replacement \`view\` with the same interactive or display-only role. Each session keeps one active answer card at a time; a new ordinary user message supersedes an unanswered card.

## Worked examples

A multi-input budget calculator with \`let\` bindings and \`choice\`:

\`\`\`deepui
{"title":"云资源月度预算","view":{"type":"stack","let":{"tierRate":"tier == 'pro' ? 1.6 : 1","total":"round(nodes * hours * 0.8 * tierRate, 0)"},"children":[{"type":"choice","id":"tier","label":"规格档位","options":[{"label":"标准版","value":"std"},{"label":"高性能版","value":"pro"}],"value":"std"},{"type":"slider","id":"nodes","label":"节点数","min":1,"max":16,"step":1,"value":4,"unit":"个"},{"type":"slider","id":"hours","label":"日均运行时长","min":1,"max":24,"step":1,"value":12,"unit":"小时"},{"type":"metric","label":"预计日成本","value":{"=":"format(total, 0) + ' 元'"},"tone":"accent"}]}}
\`\`\`

An interactive parabola whose curvature follows draggable point A and slider \`offset\`:

\`\`\`deepui
{"title":"二次函数探索","view":{"type":"stack","children":[{"type":"math","id":"plot","mathPoints":[{"id":"a","label":"A","x":1,"y":2}],"curves":[{"label":"f(x)","expression":"aX * x^2 + offset"}],"domain":[-5,5],"range":[-6,10]},{"type":"slider","id":"offset","label":"常数项截距","min":-4,"max":4,"step":0.5,"value":0},{"type":"row","children":[{"type":"metric","label":"二次项系数","value":{"=":"fixed(aX, 2)"}},{"type":"metric","label":"f(2) 当前值","value":{"=":"fixed(aX * 2^2 + offset, 2)"},"tone":"good"}]}]}}
\`\`\`

An optional next-step picker at the end of a reply (fills composer for review):

\`\`\`deepui
{"type":"options","id":"next","options":[{"label":"生成隔离验收脚本","description":"输出可直接运行的 Playwright 测试用例"},{"label":"查看完整配置项","description":"展开高级参数与默认值表"}]}
\`\`\`

A confirmation prompt with explanatory text:

\`\`\`deepui
{"type":"stack","children":[{"type":"text","text":"是否按这组参数继续生成迁移计划？"},{"type":"confirm","id":"plan","confirmLabel":"继续生成","cancelLabel":"暂不继续"}]}
\`\`\`
`
