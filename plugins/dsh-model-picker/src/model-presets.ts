/**
 * Periodic-table style short-name presets and canonical model grouping for
 * `@klarkxy/dsh-model-picker`.
 *
 * Grouping rule:
 * - Same model across multiple providers (e.g. `google/gemini-4-neon` and
 *   `gemini-4-neon`) shares one canonical key and merges into a single card
 *   with a provider dropdown.
 * - Distinct model versions (e.g. `grok-4.6` and `grok-4.7`) keep distinct
 *   canonical keys, render as separate cards, and distinguish themselves with
 *   a compact version superscript (`Gr 4.6`, `Gr 4.7`).
 */

export type ModelFamily = 'gemini' | 'claude' | 'deepseek' | 'openai' | 'grok' | 'cn' | 'other'

export interface ModelSymbolPreset {
  /** 1-4 character periodic-style short symbol (e.g. `Ne`, `H`, `Ds`, `Op`, `Gr`). */
  readonly short: string
  /** Optional compact version superscript shown beside the symbol (e.g. `4.6`, `4.7`, `5.5`). */
  readonly version: string
  /** Coarse model family used for subtle accent dots. */
  readonly family: ModelFamily
}

interface PresetRule {
  readonly pattern: RegExp
  readonly resolve: (match: RegExpExecArray) => ModelSymbolPreset
}

/**
 * Strip provider/gateway path prefixes (`google/`, `anthropic/`, `openai/`, etc.)
 * and normalize casing so identical models exposed by multiple providers group
 * into one card while preserving distinct version numbers.
 */
export function canonicalModelKey(modelId: string): string {
  const trimmed = modelId.trim()
  if (!trimmed) return ''
  const slash = trimmed.lastIndexOf('/')
  const leaf = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  return leaf.toLowerCase()
}

const GEMINI_ELEMENTS: ReadonlyArray<readonly [name: string, symbol: string]> = [
  ['hydrogen', 'H'],
  ['helium', 'He'],
  ['lithium', 'Li'],
  ['beryllium', 'Be'],
  ['boron', 'B'],
  ['carbon', 'C'],
  ['nitrogen', 'N'],
  ['oxygen', 'O'],
  ['fluorine', 'F'],
  ['neon', 'Ne'],
  ['sodium', 'Na'],
  ['magnesium', 'Mg'],
  ['silicon', 'Si'],
  ['argon', 'Ar'],
  ['potassium', 'K'],
  ['calcium', 'Ca'],
  ['germanium', 'Ge'],
  ['krypton', 'Kr'],
  ['xenon', 'Xe'],
]

function compactVersion(raw: string | undefined): string {
  if (!raw) return ''
  return raw.replace(/-/g, '.')
}

const PRESET_RULES: readonly PresetRule[] = [
  // Gemini 4 periodic-table element models (Hydrogen, Carbon, Neon, Argon, etc.)
  ...GEMINI_ELEMENTS.map(([element, symbol]): PresetRule => ({
    pattern: new RegExp(`(?:^|[-_.])gemini[-_.]?4(?:\\.\\d+)?[-_.]?${element}(?:$|[-_.])`, 'i'),
    resolve: () => ({ short: symbol, version: '', family: 'gemini' }),
  })),
  // Gemini classic / numbered series (2.5, 3, 3.1, 3.5 ...)
  {
    pattern: /gemini[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash[-_.]?lite/i,
    resolve: m => ({ short: 'Gm', version: `${compactVersion(m[1])}L`, family: 'gemini' }),
  },
  {
    pattern: /gemini[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Gm', version: `${compactVersion(m[1])}F`, family: 'gemini' }),
  },
  {
    pattern: /gemini[-_.]?(\d+(?:[.-]\d+)?)[-_.]?pro/i,
    resolve: m => ({ short: 'Gm', version: `${compactVersion(m[1])}P`, family: 'gemini' }),
  },
  {
    pattern: /gemini[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Gm', version: compactVersion(m[1]), family: 'gemini' }),
  },

  // Anthropic Claude (Opus, Fable, Sonnet, Haiku)
  {
    pattern: /claude[-_.]?(?:(\d+(?:[.-]\d+)?)[-_.]?)?opus(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Op', version: compactVersion(m[2] || m[1]), family: 'claude' }),
  },
  {
    pattern: /claude[-_.]?(?:(\d+(?:[.-]\d+)?)[-_.]?)?fable(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Fb', version: compactVersion(m[2] || m[1]), family: 'claude' }),
  },
  {
    pattern: /claude[-_.]?(?:(\d+(?:[.-]\d+)?)[-_.]?)?sonnet(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Sn', version: compactVersion(m[2] || m[1]), family: 'claude' }),
  },
  {
    pattern: /claude[-_.]?(?:(\d+(?:[.-]\d+)?)[-_.]?)?haiku(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Hk', version: compactVersion(m[2] || m[1]), family: 'claude' }),
  },
  {
    pattern: /\bopus[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Op', version: compactVersion(m[1]), family: 'claude' }),
  },
  {
    pattern: /\bfable[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Fb', version: compactVersion(m[1]), family: 'claude' }),
  },
  {
    pattern: /\bsonnet[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Sn', version: compactVersion(m[1]), family: 'claude' }),
  },
  {
    pattern: /\bhaiku[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Hk', version: compactVersion(m[1]), family: 'claude' }),
  },

  // DeepSeek
  {
    pattern: /deepseek[-_.]?v(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Ds', version: `${compactVersion(m[1])}F`, family: 'deepseek' }),
  },
  {
    pattern: /deepseek[-_.]?v(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Ds', version: compactVersion(m[1]), family: 'deepseek' }),
  },
  {
    pattern: /deepseek[-_.]?r(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Dr', version: compactVersion(m[1]), family: 'deepseek' }),
  },
  {
    pattern: /deepseek[-_.]?reasoner/i,
    resolve: () => ({ short: 'Dr', version: '', family: 'deepseek' }),
  },
  {
    pattern: /deepseek[-_.]?chat/i,
    resolve: () => ({ short: 'Dc', version: '', family: 'deepseek' }),
  },
  {
    pattern: /deepseek/i,
    resolve: () => ({ short: 'Ds', version: '', family: 'deepseek' }),
  },

  // OpenAI GPT / Codex / o-series
  {
    pattern: /(?:gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?)?codex(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Cx', version: compactVersion(m[1] || m[2]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?terra/i,
    resolve: m => ({ short: 'Gt', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?mini/i,
    resolve: m => ({ short: 'Gp', version: `${compactVersion(m[1])}m`, family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?nano/i,
    resolve: m => ({ short: 'Gp', version: `${compactVersion(m[1])}n`, family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(4o)[-_.]?mini/i,
    resolve: () => ({ short: 'Gp', version: '4m', family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(4o)/i,
    resolve: () => ({ short: 'Gp', version: '4o', family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Gp', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /^(?:o)(\d+)[-_.]?mini/i,
    resolve: m => ({ short: `O${m[1]}`, version: 'm', family: 'openai' }),
  },
  {
    pattern: /^(?:o)(\d+)[-_.]?pro/i,
    resolve: m => ({ short: `O${m[1]}`, version: 'p', family: 'openai' }),
  },
  {
    pattern: /^(?:o)(\d+)(?:$|[-_.])/i,
    resolve: m => ({ short: `O${m[1]}`, version: '', family: 'openai' }),
  },

  // xAI Grok (explicitly preserves 4.6 vs 4.7, etc.)
  {
    pattern: /grok[-_.]?code(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Gc', version: compactVersion(m[1]), family: 'grok' }),
  },
  {
    pattern: /grok[-_.]?(\d+(?:[.-]\d+)?)[-_.]?mini/i,
    resolve: m => ({ short: 'Gr', version: `${compactVersion(m[1])}m`, family: 'grok' }),
  },
  {
    pattern: /grok[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Gr', version: compactVersion(m[1]), family: 'grok' }),
  },
  {
    pattern: /grok/i,
    resolve: () => ({ short: 'Gr', version: '', family: 'grok' }),
  },

  // Zhipu GLM
  {
    pattern: /glm[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Gl', version: `${compactVersion(m[1])}F`, family: 'cn' }),
  },
  {
    pattern: /glm[-_.]?(\d+(?:[.-]\d+)?)[-_.]?air/i,
    resolve: m => ({ short: 'Gl', version: `${compactVersion(m[1])}A`, family: 'cn' }),
  },
  {
    pattern: /glm[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Gl', version: compactVersion(m[1]), family: 'cn' }),
  },

  // MiniMax
  {
    pattern: /minimax[-_.]?m(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Mm', version: `${compactVersion(m[1])}F`, family: 'cn' }),
  },
  {
    pattern: /minimax[-_.]?m(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Mm', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /minimax/i,
    resolve: () => ({ short: 'Mm', version: '', family: 'cn' }),
  },

  // Moonshot Kimi
  {
    pattern: /kimi[-_.]?k(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Km', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /kimi|moonshot/i,
    resolve: () => ({ short: 'Km', version: '', family: 'cn' }),
  },

  // Alibaba Qwen
  {
    pattern: /qwq[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Qq', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:[.-]\d+)?)[-_.]?coder/i,
    resolve: m => ({ short: 'Qc', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Qw', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen/i,
    resolve: () => ({ short: 'Qw', version: '', family: 'cn' }),
  },

  // StepFun / Doubao / Llama / Mistral
  {
    pattern: /step[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'St', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /doubao[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Db', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /llama[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Lm', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /codestral/i,
    resolve: () => ({ short: 'Cs', version: '', family: 'other' }),
  },
  {
    pattern: /devstral/i,
    resolve: () => ({ short: 'Dv', version: '', family: 'other' }),
  },
  {
    pattern: /mistral/i,
    resolve: () => ({ short: 'Mi', version: '', family: 'other' }),
  },
]

/**
 * Resolve a periodic-table style symbol and version superscript for any model.
 * Checks preset patterns first, then derives a deterministic 2-letter symbol +
 * version fallback for unrecognized models.
 */
export function resolveModelPreset(modelId: string, displayName?: string): ModelSymbolPreset {
  const canonical = canonicalModelKey(modelId)
  const candidates = [canonical, displayName?.trim().toLowerCase() ?? ''].filter(Boolean)
  for (const candidate of candidates) {
    for (const rule of PRESET_RULES) {
      const match = rule.pattern.exec(candidate)
      if (match) return rule.resolve(match)
    }
  }
  const source = canonical || displayName?.trim().toLowerCase() || 'model'
  const words = source.split(/[^a-z0-9]+/i).filter(Boolean)
  const firstAlpha = words.find(word => /[a-z]/i.test(word)) ?? 'md'
  const letters = firstAlpha.replace(/[^a-z]/gi, '')
  const short = letters.length >= 2
    ? `${letters[0]!.toUpperCase()}${letters[1]!.toLowerCase()}`
    : (letters[0]?.toUpperCase() ?? 'M')
  const verMatch = source.match(/(?:^|[-_.\s])v?(\d+(?:\.\d+)?)(?:$|[-_.\s])/i)
  return { short, version: verMatch?.[1] ?? '', family: 'other' }
}

const EFFORT_SHORT_MAP: Record<string, string> = {
  off: 'Off',
  none: 'Off',
  minimal: 'Min',
  min: 'Min',
  low: 'L',
  medium: 'M',
  med: 'M',
  high: 'H',
  xhigh: 'xH',
  'extra-high': 'xH',
  extra_high: 'xH',
  max: 'Max',
}

/** Compact label rendered inside each bottom effort cell on a card. */
export function compactEffortLabel(effort: { id: string; name: string }): string {
  const key = effort.id.trim().toLowerCase()
  if (key in EFFORT_SHORT_MAP) return EFFORT_SHORT_MAP[key]!
  const nameKey = effort.name.trim().toLowerCase()
  if (nameKey in EFFORT_SHORT_MAP) return EFFORT_SHORT_MAP[nameKey]!
  const clean = (effort.name || effort.id).trim()
  return clean.length <= 4 ? clean : clean.slice(0, 3)
}
