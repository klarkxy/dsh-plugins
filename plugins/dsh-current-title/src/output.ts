export const TITLE_TYPE_KEYS = [
  'feature',
  'fix',
  'optimize',
  'refactor',
  'test',
  'docs',
  'release',
  'config',
  'explore',
  'discuss',
] as const

export const TITLE_LOCALES = ['zh', 'en'] as const
export const TITLE_LOCALE_MODES = ['auto', ...TITLE_LOCALES] as const

export type TitleType = (typeof TITLE_TYPE_KEYS)[number]
export type TitleLocale = (typeof TITLE_LOCALES)[number]
export type TitleLocaleMode = (typeof TITLE_LOCALE_MODES)[number]

const TITLE_TYPE_LABELS: Record<TitleLocale, Record<TitleType, string>> = {
  zh: {
    feature: '功能',
    fix: '修复',
    optimize: '优化',
    refactor: '重构',
    test: '测试',
    docs: '文档',
    release: '发布',
    config: '配置',
    explore: '探索',
    discuss: '讨论',
  },
  en: {
    feature: 'Feature',
    fix: 'Fix',
    optimize: 'Optimize',
    refactor: 'Refactor',
    test: 'Test',
    docs: 'Docs',
    release: 'Release',
    config: 'Config',
    explore: 'Explore',
    discuss: 'Discussion',
  },
}

export interface ParsedTitle {
  type: TitleType
  summary: string
}

const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
const ESC_SEQUENCE = /\u001B[@-_]/gu
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

function cleanTitleText(input: string): string {
  return input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function truncateTitleUtf8(input: string, maxBytes: number): string {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be a positive integer')
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input
  let used = 0
  let output = ''
  for (const character of input) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > maxBytes) break
    output += character
    used += bytes
  }
  return output
}

/** Same sanitizing rules as DSH 0.1.7-rc.2 `normalizeSessionTitle`. */
export function normalizeSessionTitle(input: string, maxBytes: number): string {
  return truncateTitleUtf8(cleanTitleText(input), maxBytes).trimEnd()
}

function isTitleType(value: string): value is TitleType {
  return (TITLE_TYPE_KEYS as readonly string[]).includes(value)
}

export function resolveTitleLocale(
  mode: TitleLocaleMode,
  messages: readonly string[],
  preference?: string,
): TitleLocale {
  if (mode !== 'auto') return mode

  const preferred = preference?.trim().toLowerCase().split('-')[0]
  if (preferred === 'zh' || preferred === 'en') return preferred

  const text = messages.join('\n')
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return 'en'
  return /\p{Script=Han}/u.test(text) ? 'zh' : 'en'
}

function removeTitleSyntax(value: string): string {
  return value.replace(/[|`*_~#\[\]"“”]/gu, ' ')
}

function truncateSummary(value: string, targetWords: number, targetCjkCharacters: number): string {
  const containsCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value)
  if (containsCjk) {
    return Array.from(value.replace(/\s+/gu, '')).slice(0, targetCjkCharacters).join('')
  }
  return value.split(/\s+/u).filter(Boolean).slice(0, targetWords).join(' ')
}

function unwrapModelText(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}

function readJsonObject(raw: string): Record<string, unknown> | undefined {
  const text = unwrapModelText(raw)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Accept the required JSON shape, including a code fence or a short preface.
 * Extra keys are ignored. A plain one-line title still becomes a title so a
 * chatty model does not leave the session on the built-in fallback.
 */
export function parseModelTitle(
  raw: string,
  targetWords: number,
  targetCjkCharacters: number,
): ParsedTitle {
  const candidate = readJsonObject(raw)
  const typeValue = typeof candidate?.type === 'string' ? candidate.type.trim().toLowerCase() : ''
  const summaryValue = typeof candidate?.summary === 'string' ? candidate.summary : ''
  const type = isTitleType(typeValue) ? typeValue : 'discuss'
  const source = summaryValue || (candidate ? '' : unwrapModelText(raw).replace(/^["'`]+|["'`]+$/gu, ''))
  const normalized = normalizeSessionTitle(removeTitleSyntax(source), Number.MAX_SAFE_INTEGER)
  const summary = truncateSummary(normalized, targetWords, targetCjkCharacters)
  if (summary.length === 0) {
    throw new Error('dsh-current-title: title model returned an empty summary')
  }
  return { type, summary }
}

export function localMonthDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${month}${day}`
}

export function formatTitle(parsed: ParsedTitle, locale: TitleLocale, now = new Date()): string {
  return `${localMonthDay(now)} | ${TITLE_TYPE_LABELS[locale][parsed.type]} | ${parsed.summary}`
}
