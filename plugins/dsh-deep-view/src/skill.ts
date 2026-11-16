export const DEEP_VIEW_SKILL_DESCRIPTION = 'Create Deep View cards when the user names deep-view, or for a workflow, comparison, chart, adjustable estimate, progress, or optional choice. Load before calling show_view.'

export const DEEP_VIEW_SKILL = `# Deep View

Call \`show_view\` to present one interactive view. Do not read the plugin package, source, README, or type declarations to render a card; those are development tasks. Use these instructions instead.

## When to use

Use it when the user explicitly names deep-view, or when a view is clearer than prose: comparing numbers, a trend or share, progress, a workflow or process, an estimate with adjustable inputs, or a choice the user answers afterwards. Use \`ask_user_question\` when an answer is required before continuing. Prefer plain Markdown for long explanations and code.

Once the \`view\` argument is complete, the card can appear while the turn is still running. Waiting cards can move above the composer. A new human message closes an old waiting card.

Choose one primary view for the response. Write only a short conclusion, reason, or next step in the reply; do not repeat the card's numbers, table, options, or JSON. Do not invent data to fill a chart. Never collect keys, tokens or passwords.

## ViewNode

Nodes nest under \`stack\` or \`row\` using \`children\`; optional \`let\` values are visible to formulas.

- Display: \`text\`, \`metric\` (\`label\`, \`value\`), \`table\` (\`columns\`: \`{key,label}\`, \`rows\`: cells), \`chart\` (\`kind\`: \`bar\` / \`hbar\` / \`line\` / \`area\` / \`donut\`, \`categories\`, \`series\`: \`{name?,values}\`), \`progress\` (\`percent\` or \`value\` + \`max\`), \`callout\` (\`text\`), \`sources\` (\`items\`: \`{label,url}\`).
- Workflow: \`steps\` with \`items\`: \`{label,detail?,status}\`. Status is \`done\`, \`active\`, \`pending\`, or \`blocked\`; use 1–8 items. Use this instead of a stack of callouts and arrows. Explain branches briefly in \`detail\`; this is not a node-link diagram.
- Inputs: \`slider\`, \`number\`, \`choice\`, \`toggle\` (\`id\`, \`label\`, \`value\`). Inputs change local formulas only until the user submits.
- A \`{"=":"expr"}\` formula replaces a value or cell, reading input ids and let names. It supports arithmetic, comparison, conditional expressions, and a fixed function set; no JavaScript execution.
- Answer controls: \`options\` (\`id\`, \`options\`: \`{label,description?}\`, optional \`multi\`), \`confirm\` (\`id\`), \`form\` (\`id\`, \`fields\`: \`{id,label,placeholder?,value?,multiline?,readOnly?}\`, optional \`submitLabel\` and \`cancelLabel\`), \`submit\` (\`id\`, \`label\`). These require \`await_reply\`: true. A display-only card must not request an answer.
- Users can send an answer directly or fill the native composer and review it before sending. Do not claim that filling the composer already sent the answer.
- No HTML component or JavaScript. \`chart\` is for quantitative data, not workflows.

## Recipes

- Metrics/chart: a short title, one or two metrics, and one chart when the numbers support it.
- Comparison: one table, with a callout only for a material caveat.
- Workflow: one \`steps\` node; optionally one short text node for context.
- Form: one focused form or choice, with at most one primary and one secondary action.

For current progress, use one \`steps\` or \`progress\` view. A later progress call replaces the previous activity above the composer rather than adding a stack of progress cards. State only real progress; do not imply continuous streaming between tool calls. After completion, leave the useful result rather than an indefinite progress indicator.

Example:

\`\`\`json
{
  "title": "需求处理流程",
  "view": {
    "type": "steps",
    "items": [
      { "label": "明确目标与验收标准", "status": "done" },
      { "label": "分工实施并汇总结果", "detail": "普通会话并行施工", "status": "active" },
      { "label": "验收；若有问题则定向返工", "status": "pending" }
    ]
  }
}
\`\`\`
`
