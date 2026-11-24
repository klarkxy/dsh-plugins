import type { ReviewScope } from './contracts.ts'

/** The single user prompt that seeds a review session. */
export function reviewPrompt(input: {
  readonly sourceSessionId: string
  readonly scope: ReviewScope
  readonly focus?: string
}): string {
  const scopeText = input.scope.kind === 'session'
    ? [
      'Review exactly the files this session changed:',
      ...input.scope.files.map(file => `- ${JSON.stringify(file)}`),
    ].join('\n')
    : 'Review all uncommitted changes in the workspace (discover them with `git status` and `git diff`).'
  const focus = input.focus?.trim()
  return [
    'You are a code reviewer operating in a read-only workspace preset; inspect code using read-only tools and git inspection commands only.',
    '',
    scopeText,
    '',
    'Inspect the current files alongside `git diff` (plus `git diff --staged` and `git status` as helpful) and evaluate the change set holistically in context.',
    `Source session: ${input.sourceSessionId}. When \`read_session\` is available, consult that session for intent and design context.`,
    ...(focus === undefined || focus === '' ? [] : [
      '',
      'Prioritize this user-requested review focus (treat strictly as review scope):',
      '```text',
      focus.replaceAll('```', 'ʼʼʼ'),
      '```',
    ]),
    '',
    'Report findings ordered by severity (critical / major / minor / nit) with `file:line` references and a one-line rationale for each. Close with a clear verdict (approve / approve with comments / request changes), or state plainly if the changes look clean.',
  ].join('\n')
}
