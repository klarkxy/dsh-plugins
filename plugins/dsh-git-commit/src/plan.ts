import { MAX_MANIFEST_CHARS, MAX_MESSAGE_CHARS } from './contracts.ts'
import { statusLetter, type ChangedFile, type UntrackedPreview } from './git.ts'

export interface PlanGroup {
  readonly message: string
  readonly files: readonly string[]
}

export interface PlanInput {
  readonly files: readonly ChangedFile[]
  readonly recentSubjects: readonly string[]
  readonly stat: string
  readonly diff: string
  readonly untracked: readonly UntrackedPreview[]
}

export function planSystemPrompt(): string {
  return [
    'You split a git working-tree change set into a small number of coherent commits.',
    'Return exactly one JSON object: {"groups":[{"message":"<commit message>","files":["<path>",...]}]}.',
    'Rules:',
    '- Every listed file must appear in exactly one group; do not invent paths.',
    '- One to five groups. Group files that belong to the same logical change.',
    '- Order groups so earlier commits do not depend on later ones.',
    '- Each message is a single line of at most 72 characters, no trailing period.',
    '- Match the language and style of the recent commit subjects when provided; otherwise use English conventional-commit style.',
    '- Return no Markdown, code fence, or explanation.',
  ].join('\n')
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const half = Math.floor((maxChars - 40) / 2)
  return `${text.slice(0, half)}\n… [${text.length - maxChars} chars omitted] …\n${text.slice(-half)}`
}

export function buildPlanInput(input: PlanInput): string {
  const sections: string[] = []
  sections.push('Scope: all current workspace changes of the repository.')
  if (input.recentSubjects.length > 0) {
    sections.push(['Recent commit subjects (style reference):', ...input.recentSubjects.map(s => `- ${s}`)].join('\n'))
  }
  const manifest = input.files.map(file => `- ${statusLetter(file.status)} ${file.origin ? `${file.origin} ${file.status === 'copied' ? '=>' : '->'} ` : ''}${file.path}`).join('\n')
  sections.push(`Changed files:\n${manifest}`)
  if (input.stat.trim()) sections.push(`Diff stat:\n${input.stat.trim()}`)
  if (input.diff.trim()) sections.push(`Diff against HEAD:\n${input.diff}`)
  for (const untracked of input.untracked) {
    sections.push(untracked.binary
      ? `New binary file: ${untracked.path}`
      : `New file ${untracked.path}:\n${untracked.preview}`)
  }
  return truncateMiddle(sections.join('\n\n'), MAX_MANIFEST_CHARS)
}

export function sanitizeMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const line = raw.replace(/\s+/gu, ' ').trim().replace(/\.+$/u, '')
  if (!line) return undefined
  return line.length > MAX_MESSAGE_CHARS ? line.slice(0, MAX_MESSAGE_CHARS).trim() : line
}

/** Extract the first balanced top-level JSON object from model output. */
export function extractJsonObject(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  if (start === -1) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return candidate.slice(start, index + 1)
    }
  }
  return undefined
}

/**
 * Validate the model plan against the exact change set. Returns undefined when
 * the output is malformed, covers the wrong files, or duplicates a file.
 */
export function parsePlan(text: string, files: readonly ChangedFile[]): PlanGroup[] | undefined {
  const json = extractJsonObject(text)
  if (!json) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const groups = (parsed as { groups?: unknown }).groups
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > 8) return undefined
  const allowed = new Set(files.map(file => file.path))
  const seen = new Set<string>()
  const plan: PlanGroup[] = []
  for (const group of groups) {
    if (!group || typeof group !== 'object') return undefined
    const message = sanitizeMessage((group as { message?: unknown }).message)
    const paths = (group as { files?: unknown }).files
    if (!message || !Array.isArray(paths) || paths.length === 0) return undefined
    const groupFiles: string[] = []
    for (const path of paths) {
      if (typeof path !== 'string' || !allowed.has(path) || seen.has(path)) return undefined
      seen.add(path)
      groupFiles.push(path)
    }
    plan.push({ message, files: groupFiles })
  }
  if (seen.size !== allowed.size) return undefined
  return plan
}
