/**
 * Readable short-name presets and canonical model grouping for
 * `@klarkxy/dsh-model-picker`, covering mainstream model families cataloged on
 * models.dev as well as deterministic fallbacks for custom models.
 *
 * Grouping rule:
 * - Same model across multiple providers (e.g. `google/gemini-4-neon` and
 *   `gemini-4-neon`) shares one canonical key and merges into a single card
 *   with a provider dropdown.
 * - Distinct model versions (e.g. `grok-4.6` and `grok-4.7`) keep distinct
 *   canonical keys, render as separate cards, and distinguish themselves with
 *   a numeric version (`Grok 4.6`, `Grok 4.7`).
 */

export type ModelFamily = 'gemini' | 'claude' | 'deepseek' | 'openai' | 'grok' | 'cn' | 'other'

export interface ModelSymbolPreset {
  /** Readable short name rendered as the card's main title (e.g. `Opus`, `DeepSeek`, `Grok`). */
  readonly short: string
  /** Numeric version shown beside the name (e.g. `4.6`, `4.7`, `5.5`); empty when unknown. */
  readonly version: string
  /** Optional tier suffix written out in Title Case (e.g. `Flash`, `Pro`, `Deep Research`). */
  readonly suffix?: string
  /** Coarse model family used for subtle accent dots. */
  readonly family: ModelFamily
}

interface PresetRule {
  readonly pattern: RegExp
  readonly resolve: (match: RegExpExecArray) => ModelSymbolPreset
}

/**
 * Exact aliases mapping one provider's model id onto the canonical id another
 * provider serves for the same underlying model. Matching is exact on the
 * lowercased leaf, never pattern-based: a generic version-stripping rule would
 * also merge genuinely parallel versions (`grok-4.6` / `grok-4.7`), which the
 * grouping contract keeps apart. Add an entry only when the two ids really are
 * the same model; the alias is an internal card key and never rewrites the
 * routed model id.
 */
const CANONICAL_MODEL_ALIASES: Readonly<Record<string, string>> = {
  // Official DeepSeek's stable alias vs the vendor-prefixed id Magpie serves.
  'deepseek-flash': 'deepseek-v4.1-flash',
}

/**
 * Strip provider/gateway path prefixes (`google/`, `anthropic/`, `openai/`, etc.)
 * and normalize casing so identical models exposed by multiple providers group
 * into one card while preserving distinct version numbers. Exact aliases above
 * additionally unify ids that name the same model differently.
 */
export function canonicalModelKey(modelId: string): string {
  const trimmed = modelId.trim()
  if (!trimmed) return ''
  const slash = trimmed.lastIndexOf('/')
  const leaf = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  const key = leaf.toLowerCase()
  return Object.hasOwn(CANONICAL_MODEL_ALIASES, key) ? CANONICAL_MODEL_ALIASES[key]! : key
}

const GEMINI_ELEMENTS: readonly string[] = [
  'hydrogen',
  'helium',
  'lithium',
  'beryllium',
  'boron',
  'carbon',
  'nitrogen',
  'oxygen',
  'fluorine',
  'neon',
  'sodium',
  'magnesium',
  'silicon',
  'argon',
  'potassium',
  'calcium',
  'germanium',
  'krypton',
  'xenon',
]

/** Title-case each `-`/`_`/`.`-separated word: `flash-lite` → `Flash Lite`. */
function titleSuffix(raw: string): string {
  return raw
    .split(/[-_.]+/)
    .filter(Boolean)
    .map(word => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/** Title-case a single token, preserving inner casing of acronyms: `swe` → `Swe`, `GPT` → `GPT`. */
function titleWord(raw: string): string {
  if (!raw) return raw
  return raw.toUpperCase() === raw ? raw : raw[0]!.toUpperCase() + raw.slice(1).toLowerCase()
}

function compactVersion(raw: string | undefined): string {
  if (!raw) return ''
  return raw.replace(/-/g, '.')
}

const QWEN_SERIES_LABELS: Record<string, string> = {
  vl: 'VL',
  asr: 'ASR',
  livetranslate: 'LiveTranslate',
  coder: 'Coder',
  omni: 'Omni',
}

const PRESET_RULES: readonly PresetRule[] = [
  // Google: Gemini 4 periodic-table element models (Hydrogen, Carbon, Neon, Argon, etc.)
  ...GEMINI_ELEMENTS.map((element): PresetRule => ({
    pattern: new RegExp(`(?:^|[-_.])gemini[-_.]?4(?:\\.\\d+)?[-_.]?${element}(?:$|[-_.])`, 'i'),
    resolve: () => ({ short: titleWord(element), version: '', family: 'gemini' }),
  })),
  // Google: Nano Banana, Gemini numbered series, Gemma
  {
    pattern: /nano[-_.]?banana[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Nano Banana', version: compactVersion(m[1]), family: 'gemini' }),
  },
  {
    pattern: /gemini[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash[-_.]?lite/i,
    resolve: m => ({ short: 'Gemini', version: compactVersion(m[1]), suffix: 'Flash Lite', family: 'gemini' }),
  },
  {
    pattern: /gemini[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Gemini', version: compactVersion(m[1]), suffix: 'Flash', family: 'gemini' }),
  },
  {
    pattern: /gemini[-_.]?(\d+(?:[.-]\d+)?)[-_.]?pro/i,
    resolve: m => ({ short: 'Gemini', version: compactVersion(m[1]), suffix: 'Pro', family: 'gemini' }),
  },
  {
    pattern: /gemini[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Gemini', version: compactVersion(m[1]), family: 'gemini' }),
  },
  {
    pattern: /gemma[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Gemma', version: compactVersion(m[1]), family: 'gemini' }),
  },

  // Anthropic Claude (Opus, Fable, Sonnet, Haiku)
  {
    pattern: /claude[-_.]?(?:(\d+(?:[.-]\d+)?)[-_.]?)?opus(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Opus', version: compactVersion(m[2] || m[1]), family: 'claude' }),
  },
  {
    pattern: /claude[-_.]?(?:(\d+(?:[.-]\d+)?)[-_.]?)?fable(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Fable', version: compactVersion(m[2] || m[1]), family: 'claude' }),
  },
  {
    pattern: /claude[-_.]?(?:(\d+(?:[.-]\d+)?)[-_.]?)?sonnet(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Sonnet', version: compactVersion(m[2] || m[1]), family: 'claude' }),
  },
  {
    pattern: /claude[-_.]?(?:(\d+(?:[.-]\d+)?)[-_.]?)?haiku(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Haiku', version: compactVersion(m[2] || m[1]), family: 'claude' }),
  },
  {
    pattern: /\bopus[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Opus', version: compactVersion(m[1]), family: 'claude' }),
  },
  {
    pattern: /\bfable[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Fable', version: compactVersion(m[1]), family: 'claude' }),
  },
  {
    pattern: /\bsonnet[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Sonnet', version: compactVersion(m[1]), family: 'claude' }),
  },
  {
    pattern: /\bhaiku[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Haiku', version: compactVersion(m[1]), family: 'claude' }),
  },

  // DeepSeek V series. Hyphenated minors are valid, but four-digit build
  // tokens and capacity units are not minor versions.
  {
    pattern: /deepseek[-_.]?v(\d{1,3}(?:\.\d+|-(?!(?:\d{4}|\d+[kmgb])(?:$|[-_.]))\d+)?)(?!\d)[-_.]?flash/i,
    resolve: m => ({ short: 'DeepSeek', version: compactVersion(m[1]), suffix: 'Flash', family: 'deepseek' }),
  },
  {
    pattern: /deepseek[-_.]?v(\d{1,3}(?:\.\d+|-(?!(?:\d{4}|\d+[kmgb])(?:$|[-_.]))\d+)?)(?!\d)[-_.]?pro/i,
    resolve: m => ({ short: 'DeepSeek', version: compactVersion(m[1]), suffix: 'Pro', family: 'deepseek' }),
  },
  {
    pattern: /deepseek[-_.]?v(\d{1,3}(?:\.\d+|-(?!(?:\d{4}|\d+[kmgb])(?:$|[-_.]))\d+)?)(?!\d)/i,
    resolve: m => ({ short: 'DeepSeek', version: compactVersion(m[1]), family: 'deepseek' }),
  },
  {
    pattern: /deepseek[-_.]?r(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'DeepSeek', version: compactVersion(m[1]), suffix: 'R', family: 'deepseek' }),
  },
  {
    pattern: /deepseek[-_.]?reasoner/i,
    resolve: () => ({ short: 'DeepSeek', version: '', suffix: 'Reasoner', family: 'deepseek' }),
  },
  {
    pattern: /deepseek[-_.]?chat/i,
    resolve: () => ({ short: 'DeepSeek', version: '', suffix: 'Chat', family: 'deepseek' }),
  },
  {
    pattern: /deepseek/i,
    resolve: () => ({ short: 'DeepSeek', version: '', family: 'deepseek' }),
  },

  // OpenAI GPT (Astra, Sol, Luna, Terra, Cyber, Codex, Image, OSS, mini/nano/4o) & o-series
  {
    pattern: /(?:gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?)?codex(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Codex', version: compactVersion(m[1] || m[2]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?astra/i,
    resolve: m => ({ short: 'Astra', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?sol/i,
    resolve: m => ({ short: 'Sol', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?luna/i,
    resolve: m => ({ short: 'Luna', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?terra/i,
    resolve: m => ({ short: 'Terra', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?cyber/i,
    resolve: m => ({ short: 'Cyber', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?image[-_.]?(\d+(?:[.-]\d+)?)[-_.]?mini/i,
    resolve: m => ({ short: 'GPT Image', version: compactVersion(m[1]), suffix: 'Mini', family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?image[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'GPT Image', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?oss[-_.]?(\d+(?:[.-]\d+)?b?)?/i,
    resolve: m => ({ short: 'GPT OSS', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?mini/i,
    resolve: m => ({ short: 'GPT', version: compactVersion(m[1]), suffix: 'Mini', family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?nano/i,
    resolve: m => ({ short: 'GPT', version: compactVersion(m[1]), suffix: 'Nano', family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(4o)[-_.]?mini/i,
    resolve: () => ({ short: 'GPT', version: '4o', suffix: 'Mini', family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(4o)/i,
    resolve: () => ({ short: 'GPT', version: '4o', family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?pro/i,
    resolve: m => ({ short: 'GPT', version: compactVersion(m[1]), suffix: 'Pro', family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'GPT', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /^(?:o)(\d+)[-_.]?mini/i,
    resolve: m => ({ short: `O${m[1]}`, version: '', suffix: 'Mini', family: 'openai' }),
  },
  {
    pattern: /^(?:o)(\d+)[-_.]?pro/i,
    resolve: m => ({ short: `O${m[1]}`, version: '', suffix: 'Pro', family: 'openai' }),
  },
  {
    pattern: /^(?:o)(\d+)(?:$|[-_.])/i,
    resolve: m => ({ short: `O${m[1]}`, version: '', family: 'openai' }),
  },

  // xAI Grok (explicitly preserves parallel versions such as 4.6 vs 4.7)
  {
    pattern: /grok[-_.]?code(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Grok Code', version: compactVersion(m[1]), family: 'grok' }),
  },
  {
    pattern: /grok[-_.]?imagine[-_.]?video[-_.]?(\d+(?:[.-]\d+)?)?(?:[-_.]?(lite))?/i,
    resolve: m => ({
      short: 'Grok Imagine',
      version: compactVersion(m[1]),
      suffix: m[2] ? 'Video Lite' : 'Video',
      family: 'grok',
    }),
  },
  {
    pattern: /grok[-_.]?imagine(?:[-_.]?\w+)*[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Grok Imagine', version: compactVersion(m[1]), family: 'grok' }),
  },
  {
    pattern: /grok[-_.]?(\d+(?:[.-]\d+)?)[-_.]?fast/i,
    resolve: m => ({ short: 'Grok', version: compactVersion(m[1]), suffix: 'Fast', family: 'grok' }),
  },
  {
    pattern: /grok[-_.]?(\d+(?:[.-]\d+)?)[-_.]?mini/i,
    resolve: m => ({ short: 'Grok', version: compactVersion(m[1]), suffix: 'Mini', family: 'grok' }),
  },
  {
    pattern: /grok[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Grok', version: compactVersion(m[1]), family: 'grok' }),
  },
  {
    pattern: /grok/i,
    resolve: () => ({ short: 'Grok', version: '', family: 'grok' }),
  },

  // Zhipu AI / Z.ai GLM
  {
    pattern: /glm[-_.]?(\d+(?:[.-]\d+)?)[-_.]?v?[-_.]?flash/i,
    resolve: m => ({ short: 'GLM', version: compactVersion(m[1]), suffix: 'Flash', family: 'cn' }),
  },
  {
    pattern: /glm[-_.]?(\d+(?:[.-]\d+)?)[-_.]?air/i,
    resolve: m => ({ short: 'GLM', version: compactVersion(m[1]), suffix: 'Air', family: 'cn' }),
  },
  {
    pattern: /glm[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'GLM', version: compactVersion(m[1]), family: 'cn' }),
  },

  // MiniMax
  {
    pattern: /minimax[-_.]?m(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'MiniMax', version: compactVersion(m[1]), suffix: 'Flash', family: 'cn' }),
  },
  {
    pattern: /minimax[-_.]?m(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'MiniMax', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /minimax[-_.]?h(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'MiniMax', version: compactVersion(m[1]), suffix: 'Hailuo', family: 'cn' }),
  },
  {
    pattern: /minimax/i,
    resolve: () => ({ short: 'MiniMax', version: '', family: 'cn' }),
  },

  // Moonshot AI Kimi. Keep hyphenated minor versions, but do not capture a
  // context-capacity token such as `-256K` as part of the version.
  {
    pattern: /kimi[-_.]?k(\d+(?:\.\d+|-(?!\d+[kmg](?:$|[-_.]))\d+)?)[-_.]?pro/i,
    resolve: m => ({ short: 'Kimi', version: compactVersion(m[1]), suffix: 'Pro', family: 'cn' }),
  },
  {
    pattern: /kimi[-_.]?k(\d+(?:\.\d+|-(?!\d+[kmg](?:$|[-_.]))\d+)?)[-_.]?code/i,
    resolve: m => ({ short: 'Kimi', version: compactVersion(m[1]), suffix: 'Code', family: 'cn' }),
  },
  {
    pattern: /kimi[-_.]?k(\d+(?:\.\d+|-(?!\d+[kmg](?:$|[-_.]))\d+)?)/i,
    resolve: m => ({ short: 'Kimi', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /kimi|moonshot/i,
    resolve: () => ({ short: 'Kimi', version: '', family: 'cn' }),
  },

  // Alibaba Qwen / QwQ. Qwen version captures only dot decimals so parameter
  // sizes such as `qwen3-235b-a22b` are not misread as `3.235`.
  {
    pattern: /qwq[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'QwQ', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?image[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Qwen Image', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(?:(\d+(?:\.\d+)?)[-_.]?)?(?:(vl|asr|livetranslate|coder|omni)[-_.]?)?(flash|max)(?:$|[-_.])/i,
    resolve: m => ({
      short: 'Qwen',
      version: m[1] ?? '',
      suffix: m[2] ? `${QWEN_SERIES_LABELS[m[2].toLowerCase()]!} ${titleWord(m[3]!)}` : titleWord(m[3]!),
      family: 'cn',
    }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:\.\d+)?)[-_.]?coder/i,
    resolve: m => ({ short: 'Qwen', version: m[1] ?? '', suffix: 'Coder', family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:\.\d+)?)[-_.]?omni/i,
    resolve: m => ({ short: 'Qwen', version: m[1] ?? '', suffix: 'Omni', family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:\.\d+)?)[-_.]?max/i,
    resolve: m => ({ short: 'Qwen', version: m[1] ?? '', suffix: 'Max', family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:\.\d+)?)/i,
    resolve: m => ({ short: 'Qwen', version: m[1] ?? '', family: 'cn' }),
  },
  {
    pattern: /qwen/i,
    resolve: () => ({ short: 'Qwen', version: '', family: 'cn' }),
  },

  // Xiaomi MiMo
  {
    pattern: /mimo[-_.]?v?(\d+(?:[.-]\d+)?)[-_.]?pro/i,
    resolve: m => ({ short: 'MiMo', version: compactVersion(m[1]), suffix: 'Pro', family: 'cn' }),
  },
  {
    pattern: /mimo[-_.]?v?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'MiMo', version: compactVersion(m[1]), suffix: 'Flash', family: 'cn' }),
  },
  {
    pattern: /mimo[-_.]?v?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'MiMo', version: compactVersion(m[1]), family: 'cn' }),
  },

  // Tencent Hy / Hunyuan
  {
    pattern: /(?:^|[-_.])hy[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Hunyuan', version: compactVersion(m[1]), suffix: 'Flash', family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])hy[-_.]?(\d+(?:[.-]\d+)?)(?:$|[-_.])/i,
    resolve: m => ({ short: 'Hunyuan', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /hunyuan[-_.]?([a-z]?\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Hunyuan', version: compactVersion(m[1]), family: 'cn' }),
  },

  // ByteDance Seed / Seedance / Doubao
  {
    pattern: /seedance[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Seedance', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /seed[-_.]?(\d+(?:[.-]\d+)?)[-_.]?lite/i,
    resolve: m => ({ short: 'Seed', version: compactVersion(m[1]), suffix: 'Lite', family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])seed[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Seed', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /doubao[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Doubao', version: compactVersion(m[1]), family: 'cn' }),
  },

  // StepFun / Meituan LongCat / inclusionAI Ling & Ring / OpenBMB / Baidu / Huawei / Baichuan
  {
    pattern: /step[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Step', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /longcat[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'LongCat', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])ling[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Ling', version: compactVersion(m[1]), suffix: 'Flash', family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])ling[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Ling', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])ring[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Ring', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /minicpm[-_.]?(?:v[-_.]?)?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'MiniCPM', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /ernie[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Ernie', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /(?:open)?pangu[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Pangu', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /baichuan[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Baichuan', version: compactVersion(m[1]), family: 'cn' }),
  },

  // Meta (Muse Ember/Wonder/Spark & Llama)
  {
    pattern: /muse[-_.]?ember(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Muse Ember', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /muse[-_.]?wonder(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Muse Wonder', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /muse[-_.]?spark(?:[-_.](\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Muse Spark', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /llama[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Llama', version: compactVersion(m[1]), family: 'other' }),
  },

  // Microsoft (MAI Code & Phi)
  {
    pattern: /mai[-_.]?code[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'MAI Code', version: compactVersion(m[1]), suffix: 'Flash', family: 'other' }),
  },
  {
    pattern: /mai[-_.]?code[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'MAI Code', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /phi[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Phi', version: compactVersion(m[1]), family: 'other' }),
  },

  // NVIDIA Nemotron
  {
    pattern: /nemotron[-_.]?(\d+(?:[.-]\d+)?)[-_.]?lightning/i,
    resolve: m => ({ short: 'Nemotron', version: compactVersion(m[1]), suffix: 'Lightning', family: 'other' }),
  },
  {
    pattern: /nemotron[-_.]?(\d+(?:[.-]\d+)?)[-_.]?(?:super[-_.]?)?vl/i,
    resolve: m => ({ short: 'Nemotron', version: compactVersion(m[1]), suffix: 'VL', family: 'other' }),
  },
  {
    pattern: /nemotron[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Nemotron', version: compactVersion(m[1]), family: 'other' }),
  },

  // Mistral AI (Codestral, Devstral, Magistral, Pixtral, Ministral, Mistral
  // Medium/Large/Small). Four-digit build dates such as `2508`/`2512`/`2604`
  // are deliberately excluded from version capture so catalog display names
  // like `Codestral 25.08` or `Devstral 2` win the version via the
  // dual-candidate detail comparison.
  {
    pattern: /codestral(?:[-_.]?(\d{1,3}(?:\.\d+)?)(?!\d))?/i,
    resolve: m => ({ short: 'Codestral', version: m[1] ?? '', family: 'other' }),
  },
  {
    pattern: /devstral(?:[-_.]?(\d{1,3}(?:\.\d+)?)(?!\d))?(?:[-_.]?(medium|small))?/i,
    resolve: m => ({ short: 'Devstral', version: m[1] ?? '', suffix: m[2] ? titleWord(m[2]) : undefined, family: 'other' }),
  },
  {
    pattern: /magistral/i,
    resolve: () => ({ short: 'Magistral', version: '', family: 'other' }),
  },
  {
    pattern: /pixtral/i,
    resolve: () => ({ short: 'Pixtral', version: '', family: 'other' }),
  },
  {
    pattern: /ministral[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Ministral', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /mistral[-_.]?medium(?:[-_.]?(\d{1,3}(?:[.-](?!(?:\d{4}|\d+[kmgb])(?:$|[-_.]))\d+){0,2})(?!\d))?/i,
    resolve: m => ({ short: 'Mistral', version: compactVersion(m[1]), suffix: 'Medium', family: 'other' }),
  },
  {
    pattern: /mistral[-_.]?large(?:[-_.]?(\d{1,3}(?:[.-](?!(?:\d{4}|\d+[kmgb])(?:$|[-_.]))\d+){0,2})(?!\d))?/i,
    resolve: m => ({ short: 'Mistral', version: compactVersion(m[1]), suffix: 'Large', family: 'other' }),
  },
  {
    pattern: /mistral[-_.]?small(?:[-_.]?(\d{1,3}(?:[.-](?!(?:\d{4}|\d+[kmgb])(?:$|[-_.]))\d+){0,2})(?!\d))?/i,
    resolve: m => ({ short: 'Mistral', version: compactVersion(m[1]), suffix: 'Small', family: 'other' }),
  },
  {
    pattern: /mistral/i,
    resolve: () => ({ short: 'Mistral', version: '', family: 'other' }),
  },

  // Amazon Nova / Cohere Command & Aya / Perplexity Sonar / Cognition SWE
  {
    pattern: /nova[-_.]?(?:(\d+(?:[.-]\d+)?)[-_.]?)?(premier|pro|lite|micro)/i,
    resolve: m => ({ short: 'Nova', version: compactVersion(m[1]), suffix: titleWord(m[2]!), family: 'other' }),
  },
  {
    pattern: /nova[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Nova', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /command[-_.]?a(?:$|[-_.])/i,
    resolve: () => ({ short: 'Command', version: '', suffix: 'A', family: 'other' }),
  },
  {
    pattern: /command[-_.]?r[-_.]?(?:plus|\+)/i,
    resolve: () => ({ short: 'Command', version: '', suffix: 'R+', family: 'other' }),
  },
  {
    pattern: /command[-_.]?r/i,
    resolve: () => ({ short: 'Command', version: '', suffix: 'R', family: 'other' }),
  },
  {
    pattern: /aya[-_.]?(vision|expanse)?/i,
    resolve: m => ({ short: 'Aya', version: '', suffix: m[1] ? titleWord(m[1]) : undefined, family: 'other' }),
  },
  {
    pattern: /sonar[-_.]?deep[-_.]?research/i,
    resolve: () => ({ short: 'Sonar', version: '', suffix: 'Deep Research', family: 'other' }),
  },
  {
    pattern: /sonar[-_.]?reasoning/i,
    resolve: () => ({ short: 'Sonar', version: '', suffix: 'Reasoning', family: 'other' }),
  },
  {
    pattern: /sonar[-_.]?pro/i,
    resolve: () => ({ short: 'Sonar', version: '', suffix: 'Pro', family: 'other' }),
  },
  {
    pattern: /\bsonar\b/i,
    resolve: () => ({ short: 'Sonar', version: '', family: 'other' }),
  },
  {
    pattern: /(?:^|[-_.])swe[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'SWE', version: compactVersion(m[1]), suffix: 'Flash', family: 'other' }),
  },
  {
    pattern: /(?:^|[-_.])swe(?:[-_.]?(\d+(?:[.-]\d+)?))?(?:$|[-_.])/i,
    resolve: m => ({ short: 'SWE', version: compactVersion(m[1]), family: 'other' }),
  },

  // Additional labs cataloged on models.dev (Inception, Thinking Machines, Reflection,
  // Recursive, DeepReinforce, Sakana, Upstage, IBM, Nous, AI21, AllenAI, Swiss AI, QuiverAI, Liquid, Reka)
  {
    pattern: /mercury[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Mercury', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /inkling[-_.]?(\d+(?:[.-]\d+)?)[-_.]?small/i,
    resolve: m => ({ short: 'Inkling', version: compactVersion(m[1]), suffix: 'Small', family: 'other' }),
  },
  {
    pattern: /inkling[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Inkling', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /beam[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Beam', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /\bflint\b/i,
    resolve: () => ({ short: 'Flint', version: '', family: 'other' }),
  },
  {
    pattern: /ornith[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Ornith', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /fugu[-_.]?ultra[-_.]?v?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Fugu', version: compactVersion(m[1]), suffix: 'Ultra', family: 'other' }),
  },
  {
    pattern: /fugu[-_.]?max/i,
    resolve: () => ({ short: 'Fugu', version: '', suffix: 'Max', family: 'other' }),
  },
  {
    pattern: /solar[-_.]?mini[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Solar', version: compactVersion(m[1]), suffix: 'Mini', family: 'other' }),
  },
  {
    pattern: /solar[-_.]?pro[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Solar', version: compactVersion(m[1]), suffix: 'Pro', family: 'other' }),
  },
  {
    pattern: /granite[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Granite', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /hermes[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Hermes', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /jamba[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Jamba', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /olmo[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'OLMo', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /apertus[-_.]?v?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Apertus', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /arrow[-_.]?(\d+(?:[.-]\d+)?)[-_.]?telos/i,
    resolve: m => ({ short: 'Arrow', version: compactVersion(m[1]), suffix: 'Telos', family: 'other' }),
  },
  {
    pattern: /arrow[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Arrow', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /ember[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Ember', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /particle[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Particle', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /reka[-_.]?(flash|core|edge)?/i,
    resolve: m => ({ short: 'Reka', version: '', suffix: m[1] ? titleWord(m[1]) : undefined, family: 'other' }),
  },
]

const FALLBACK_SUFFIX_WORDS = /flash|lite|mini|nano|pro|max|air|lightning/i

/**
 * Resolve a readable short name plus version and optional tier suffix for any
 * model. Checks preset patterns first, then derives a deterministic
 * name + version + suffix fallback for unrecognized models.
 */
export function resolveModelPreset(modelId: string, displayName?: string): ModelSymbolPreset {
  const canonical = canonicalModelKey(modelId)
  const display = displayName?.trim().toLowerCase().replace(/\s+/g, '-') ?? ''
  const resolveCandidate = (candidate: string): ModelSymbolPreset | undefined => {
    for (const rule of PRESET_RULES) {
      const match = rule.pattern.exec(candidate)
      if (match) return rule.resolve(match)
    }
    return undefined
  }
  const canonicalPreset = canonical ? resolveCandidate(canonical) : undefined
  const displayPreset = display && display !== canonical ? resolveCandidate(display) : undefined
  if (canonicalPreset && displayPreset) {
    const detail = (preset: ModelSymbolPreset): number => Number(Boolean(preset.version)) + Number(Boolean(preset.suffix))
    // Stable router ids such as `deepseek-flash` can be less descriptive than
    // their catalog names. Prefer the catalog only when it adds version/tier data.
    if (detail(displayPreset) > detail(canonicalPreset)) return displayPreset
    // Equal-detail candidates can carry complementary fields: the id in
    // `devstral-medium-latest` supplies Medium while `Devstral 2` supplies 2.
    if (detail(displayPreset) === detail(canonicalPreset) && canonicalPreset.short === displayPreset.short) {
      return {
        ...canonicalPreset,
        version: canonicalPreset.version || displayPreset.version,
        suffix: canonicalPreset.suffix ?? displayPreset.suffix,
      }
    }
    return canonicalPreset
  }
  const preset = canonicalPreset ?? displayPreset
  if (preset) return preset
  const source = canonical || display || 'model'
  const words = source.split(/[^a-z0-9]+/i).filter(Boolean)
  const firstAlpha = words.find(word => /[a-z]/i.test(word)) ?? 'model'
  const short = titleWord(firstAlpha)
  const verMatch = source.match(/(?:^|[-_.\s])v?(\d+(?:\.\d+)?)(?:$|[-_.\s])/i)
  const version = verMatch?.[1] ?? ''
  // Remove the extracted version token before looking for qualifiers so its
  // digits cannot be rendered a second time in the suffix.
  const versionIndex = verMatch?.index ?? -1
  const versionEnd = verMatch && versionIndex >= 0 ? versionIndex + verMatch[0].length : -1
  const suffixSource = verMatch && versionIndex >= 0
    ? `${source.slice(0, versionIndex)}${versionEnd < source.length ? '-' : ''}${source.slice(versionEnd)}`
    : source
  // Trailing well-known tier words become a suffix; anything else stays in the name.
  const suffixMatch = suffixSource.match(
    new RegExp(`[-_.\\s]((?!${FALLBACK_SUFFIX_WORDS.source})[a-z]+(?:[-_.\\s][a-z0-9]+)*[-_.\\s](?:${FALLBACK_SUFFIX_WORDS.source})(?:[-_.\\s][a-z0-9]+)*)$`, 'i')
  ) ?? suffixSource.match(new RegExp(`[-_.\\s]((?:${FALLBACK_SUFFIX_WORDS.source})(?:[-_.\\s][a-z0-9]+)*)$`, 'i'))
  const suffix = suffixMatch ? titleSuffix(suffixMatch[1]!) : undefined
  return { short, version, suffix, family: 'other' }
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
