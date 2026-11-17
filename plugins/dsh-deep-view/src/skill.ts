import { DEEP_VIEW_PROMPT } from './prompt.ts'

export const DEEP_VIEW_SKILL_DESCRIPTION = 'Deep View reference for interactive math, linked data exploration, maps, advanced formulas and answer controls. Common comparisons, architecture diagrams, charts and steps use the directly supplied reply-interface instructions; no skill load is needed for those. 中文：高级互动、地图、数学图、表单参考。'

export const DEEP_VIEW_SKILL = `# Deep View reference

Common reply interfaces work directly from the supplied reply-interface context. This reference adds advanced components and examples, and includes the common protocol for explicitly requested or delegated view authoring. Do not read the plugin package, source, README, or type declarations to render a view; use this reference.

${DEEP_VIEW_PROMPT}

## Advanced components

- Local choices: {type:"choice",id,label,options:[{label,value?},...],value?}. Values are strings, numbers or booleans; omitted option values default to their label. The initial value must match an option. A toggle is {type:"toggle",id,label,value}, with a boolean value. These are local inputs, not submitted answers.
- Interactive math: math with id, mathPoints: {id,label?,x,y,constrain?} (free/horizontal/vertical), optional curves: {label?,expression}, domain/range: [min,max]. Use 1–4 points and at most 4 curves. Point ids expose <pointId>X and <pointId>Y to formulas and curves; x is the curve variable. The viewport is fixed to the declared bounds; points can move within it.
- Data exploration: explore with id, inline data: scalar rows, xKey, yKey, optional colorKey, select: point (default) or interval. Point selection gives selected category values as an array; interval gives an object such as {"size":[low,high]}. Use this for linked selection/brushing, not as a general Vega spec. Use chart for a static trend or comparison.
- Places and routes: map with id, locations: {id,label,detail?,coordinates}, optional routes: {label?,coordinates}, center, zoom. Location and center coordinates are [longitude,latitude]; route coordinates are arrays of those pairs. Selection is the stable location id, empty when none. The fixed public demo basemap needs network/WebGL; the accessible location list still works without it. Never put secrets in locations or routes. Custom basemap styles, providers, offline tiles and credentials are not supported by this node; use task-specific infrastructure outside the view for those needs.

## Formulas and linked state

Inputs immediately update formulas without another model request. A {"=":"expression"} value reads input ids and outermost let names. Arithmetic, comparisons, conditional expressions and a fixed function set are supported; JavaScript, property access and arbitrary function calls are not. Use min, max, abs, round, floor, ceil, sqrt, pow, clamp and format where needed. Consult the supported patterns below rather than inventing operations.

Use unique input ids. Flow/map selection exposes its id as the selected node/location string; math point coordinates are exposed as <pointId>X and <pointId>Y. Keep the control beside the result it changes. A formula must actually compute the visible result; state missing data instead of adding a nonfunctional control.

## Answer controls and view revisions

- options: {type:"options",id,options:[{label,description?},...],multi?} for an answer selection.
- confirm: {type:"confirm",id,confirmLabel?,cancelLabel?}. Put explanatory text in a separate text node; confirm does not accept label.
- form: {type:"form",id,fields:[{id,label,placeholder?,value?,multiline?,readOnly?},...],submitLabel?,cancelLabel?}.
- submit: {type:"submit",id,label} to submit the card's local inputs for a meaningful next task.

In show_view, answer controls require await_reply:true; display-only views use false. In a deepui reply fence, answer controls fill the native composer for review instead of sending directly. Filling the composer is not sending. Never collect keys, tokens or passwords, and do not ask for an answer already resolved in prose.

show_view returns a stable viewId and positive revision. Update with view_id, the latest base_revision and the complete replacement view. A stale or already answered revision cannot update or answer. Keep the same answer-control capability across updates: changing between an answer view and a display requires a new view. Only one view can await an answer at a time; a new human message closes the previous waiting view. Do not wait or poll after showing one. Use ask_user_question instead when an answer is required before work can proceed.

## Worked examples

A local estimate with no submission or extra model call:

\`\`\`deepui
{"title":"旅行预算","view":{"type":"stack","let":{"total":"days * people * daily"},"children":[{"type":"slider","id":"people","label":"人数","min":1,"max":6,"step":1,"value":2,"unit":"人"},{"type":"slider","id":"days","label":"天数","min":1,"max":14,"step":1,"value":5,"unit":"天"},{"type":"slider","id":"daily","label":"每天每人","min":200,"max":2000,"step":100,"value":600,"unit":"元"},{"type":"metric","label":"预计总预算","value":{"=":"total"}}]}}
\`\`\`

An interactive line whose slope follows point A:

\`\`\`deepui
{"type":"stack","children":[{"type":"math","id":"plot","mathPoints":[{"id":"a","label":"A","x":1,"y":2}],"curves":[{"expression":"aX * x"}],"domain":[-5,5],"range":[-5,5]},{"type":"metric","label":"Slope","value":{"=":"aX"}}]}
\`\`\`

An optional next action in the reply (fills the composer for review):

\`\`\`deepui
{"type":"options","id":"next","options":[{"label":"展开本地方案","description":"继续说明本机部署步骤"},{"label":"展开远程方案","description":"继续说明远程连接与运行条件"}]}
\`\`\`

A confirmation with its explanation in a separate node:

\`\`\`deepui
{"type":"stack","children":[{"type":"text","text":"是否按这组参数继续规划？"},{"type":"confirm","id":"plan","confirmLabel":"继续规划","cancelLabel":"暂不继续"}]}
\`\`\`
`
