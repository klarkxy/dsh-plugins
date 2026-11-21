/**
 * Periodic-table style short-name presets and canonical model grouping for
 * `@klarkxy/dsh-model-picker`, covering mainstream model families cataloged on
 * models.dev as well as deterministic fallbacks for custom models.
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
  return CANONICAL_MODEL_ALIASES[key] ?? key
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
  // Google: Gemini 4 periodic-table element models (Hydrogen, Carbon, Neon, Argon, etc.)
  ...GEMINI_ELEMENTS.map(([element, symbol]): PresetRule => ({
    pattern: new RegExp(`(?:^|[-_.])gemini[-_.]?4(?:\\.\\d+)?[-_.]?${element}(?:$|[-_.])`, 'i'),
    resolve: () => ({ short: symbol, version: '', family: 'gemini' }),
  })),
  // Google: Nano Banana, Gemini numbered series, Gemma
  {
    pattern: /nano[-_.]?banana[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Nb', version: compactVersion(m[1]), family: 'gemini' }),
  },
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
  {
    pattern: /gemma[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Ga', version: compactVersion(m[1]), family: 'gemini' }),
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

  // OpenAI GPT (Astra, Sol, Luna, Terra, Cyber, Codex, Image, OSS, mini/nano/4o) & o-series
  {
    pattern: /(?:gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?)?codex(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Cx', version: compactVersion(m[1] || m[2]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?astra/i,
    resolve: m => ({ short: 'As', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?sol/i,
    resolve: m => ({ short: 'So', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?luna/i,
    resolve: m => ({ short: 'Lu', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?terra/i,
    resolve: m => ({ short: 'Gt', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?(\d+(?:[.-]\d+)?)[-_.]?cyber/i,
    resolve: m => ({ short: 'Cy', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?image[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Gi', version: compactVersion(m[1]), family: 'openai' }),
  },
  {
    pattern: /gpt[-_.]?oss[-_.]?(\d+(?:[.-]\d+)?b?)?/i,
    resolve: m => ({ short: 'Go', version: compactVersion(m[1]), family: 'openai' }),
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

  // xAI Grok (explicitly preserves parallel versions such as 4.6 vs 4.7)
  {
    pattern: /grok[-_.]?code(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Gc', version: compactVersion(m[1]), family: 'grok' }),
  },
  {
    pattern: /grok[-_.]?imagine(?:[-_.]?\w+)*[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Gi', version: compactVersion(m[1]), family: 'grok' }),
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

  // Zhipu AI / Z.ai GLM
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
    pattern: /minimax[-_.]?h(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Mh', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /minimax/i,
    resolve: () => ({ short: 'Mm', version: '', family: 'cn' }),
  },

  // Moonshot AI Kimi
  {
    pattern: /kimi[-_.]?k(\d+(?:[.-]\d+)?)[-_.]?pro/i,
    resolve: m => ({ short: 'Km', version: `${compactVersion(m[1])}P`, family: 'cn' }),
  },
  {
    pattern: /kimi[-_.]?k(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Km', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /kimi|moonshot/i,
    resolve: () => ({ short: 'Km', version: '', family: 'cn' }),
  },

  // Alibaba Qwen / QwQ
  {
    pattern: /qwq[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Qq', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?image[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Qi', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:[.-]\d+)?)[-_.]?coder/i,
    resolve: m => ({ short: 'Qc', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:[.-]\d+)?)[-_.]?omni/i,
    resolve: m => ({ short: 'Qo', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:[.-]\d+)?)[-_.]?max/i,
    resolve: m => ({ short: 'Qw', version: `${compactVersion(m[1])}M`, family: 'cn' }),
  },
  {
    pattern: /qwen[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Qw', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /qwen/i,
    resolve: () => ({ short: 'Qw', version: '', family: 'cn' }),
  },

  // Xiaomi MiMo
  {
    pattern: /mimo[-_.]?v?(\d+(?:[.-]\d+)?)[-_.]?pro/i,
    resolve: m => ({ short: 'Mo', version: `${compactVersion(m[1])}P`, family: 'cn' }),
  },
  {
    pattern: /mimo[-_.]?v?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Mo', version: `${compactVersion(m[1])}F`, family: 'cn' }),
  },
  {
    pattern: /mimo[-_.]?v?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Mo', version: compactVersion(m[1]), family: 'cn' }),
  },

  // Tencent Hy / Hunyuan
  {
    pattern: /(?:^|[-_.])hy[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Hy', version: `${compactVersion(m[1])}F`, family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])hy[-_.]?(\d+(?:[.-]\d+)?)(?:$|[-_.])/i,
    resolve: m => ({ short: 'Hy', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /hunyuan[-_.]?([a-z]?\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Hy', version: compactVersion(m[1]), family: 'cn' }),
  },

  // ByteDance Seed / Seedance / Doubao
  {
    pattern: /seedance[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Sc', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /seed[-_.]?(\d+(?:[.-]\d+)?)[-_.]?lite/i,
    resolve: m => ({ short: 'Sd', version: `${compactVersion(m[1])}L`, family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])seed[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Sd', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /doubao[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Db', version: compactVersion(m[1]), family: 'cn' }),
  },

  // StepFun / Meituan LongCat / inclusionAI Ling & Ring / OpenBMB / Baidu / Huawei / Baichuan
  {
    pattern: /step[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'St', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /longcat[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Lc', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])ling[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Lg', version: `${compactVersion(m[1])}F`, family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])ling[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Lg', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /(?:^|[-_.])ring[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Rg', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /minicpm[-_.]?(?:v[-_.]?)?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Cp', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /ernie[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Er', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /(?:open)?pangu[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Pg', version: compactVersion(m[1]), family: 'cn' }),
  },
  {
    pattern: /baichuan[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Bc', version: compactVersion(m[1]), family: 'cn' }),
  },

  // Meta (Muse Ember/Wonder/Spark & Llama)
  {
    pattern: /muse[-_.]?ember(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Me', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /muse[-_.]?wonder(?:[-_.]?(\d+(?:[.-]\d+)?))?/i,
    resolve: m => ({ short: 'Mw', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /muse[-_.]?spark/i,
    resolve: () => ({ short: 'Ms', version: '', family: 'other' }),
  },
  {
    pattern: /llama[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Lm', version: compactVersion(m[1]), family: 'other' }),
  },

  // Microsoft (MAI Code & Phi)
  {
    pattern: /mai[-_.]?code[-_.]?(\d+(?:[.-]\d+)?)[-_.]?flash/i,
    resolve: m => ({ short: 'Mc', version: `${compactVersion(m[1])}F`, family: 'other' }),
  },
  {
    pattern: /mai[-_.]?code[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Mc', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /phi[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Ph', version: compactVersion(m[1]), family: 'other' }),
  },

  // NVIDIA Nemotron
  {
    pattern: /nemotron[-_.]?(\d+(?:[.-]\d+)?)[-_.]?(?:super[-_.]?)?vl/i,
    resolve: m => ({ short: 'Nm', version: `${compactVersion(m[1])}V`, family: 'other' }),
  },
  {
    pattern: /nemotron[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Nm', version: compactVersion(m[1]), family: 'other' }),
  },

  // Mistral AI (Codestral, Devstral, Magistral, Pixtral, Ministral, Mistral Large/Small)
  {
    pattern: /codestral/i,
    resolve: () => ({ short: 'Cs', version: '', family: 'other' }),
  },
  {
    pattern: /devstral/i,
    resolve: () => ({ short: 'Dv', version: '', family: 'other' }),
  },
  {
    pattern: /magistral/i,
    resolve: () => ({ short: 'Ma', version: '', family: 'other' }),
  },
  {
    pattern: /pixtral/i,
    resolve: () => ({ short: 'Px', version: '', family: 'other' }),
  },
  {
    pattern: /ministral[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Mn', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /mistral[-_.]?large[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Ml', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /mistral[-_.]?small[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Mi', version: `${compactVersion(m[1])}S`, family: 'other' }),
  },
  {
    pattern: /mistral/i,
    resolve: () => ({ short: 'Mi', version: '', family: 'other' }),
  },

  // Amazon Nova / Cohere Command & Aya / Perplexity Sonar
  {
    pattern: /nova[-_.]?(\d+(?:[.-]\d+)?)/i,
    resolve: m => ({ short: 'Nv', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /nova[-_.]?(premier|pro|lite|micro)/i,
    resolve: m => {
      const tier = m[1]!.toLowerCase()
      const suffix = tier === 'premier' ? 'Pr' : tier === 'pro' ? 'P' : tier === 'lite' ? 'L' : 'm'
      return { short: 'Nv', version: suffix, family: 'other' }
    },
  },
  {
    pattern: /command[-_.]?a(?:$|[-_.])/i,
    resolve: () => ({ short: 'Cm', version: 'A', family: 'other' }),
  },
  {
    pattern: /command[-_.]?r[-_.]?(?:plus|\+)/i,
    resolve: () => ({ short: 'Cm', version: 'R+', family: 'other' }),
  },
  {
    pattern: /command[-_.]?r/i,
    resolve: () => ({ short: 'Cm', version: 'R', family: 'other' }),
  },
  {
    pattern: /aya[-_.]?(vision|expanse)?/i,
    resolve: m => ({ short: 'Ay', version: m[1] ? m[1][0]!.toUpperCase() : '', family: 'other' }),
  },
  {
    pattern: /sonar[-_.]?deep[-_.]?research/i,
    resolve: () => ({ short: 'Sr', version: 'D', family: 'other' }),
  },
  {
    pattern: /sonar[-_.]?reasoning/i,
    resolve: () => ({ short: 'Sr', version: 'R', family: 'other' }),
  },
  {
    pattern: /sonar[-_.]?pro/i,
    resolve: () => ({ short: 'Sr', version: 'P', family: 'other' }),
  },
  {
    pattern: /\bsonar\b/i,
    resolve: () => ({ short: 'Sr', version: '', family: 'other' }),
  },

  // Additional labs cataloged on models.dev (Inception, Thinking Machines, Reflection,
  // Recursive, DeepReinforce, Sakana, Upstage, IBM, Nous, AI21, AllenAI, Swiss AI, QuiverAI, Liquid, Reka)
  {
    pattern: /mercury[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Hg', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /inkling[-_.]?(\d+(?:[.-]\d+)?)[-_.]?small/i,
    resolve: m => ({ short: 'Ik', version: `${compactVersion(m[1])}S`, family: 'other' }),
  },
  {
    pattern: /inkling[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Ik', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /beam[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Bm', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /\bflint\b/i,
    resolve: () => ({ short: 'Fl', version: '', family: 'other' }),
  },
  {
    pattern: /ornith[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Or', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /fugu[-_.]?ultra[-_.]?v?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Fg', version: `U${compactVersion(m[1])}`, family: 'other' }),
  },
  {
    pattern: /fugu[-_.]?max/i,
    resolve: () => ({ short: 'Fg', version: 'M', family: 'other' }),
  },
  {
    pattern: /solar[-_.]?mini[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Sl', version: `${compactVersion(m[1])}m`, family: 'other' }),
  },
  {
    pattern: /solar[-_.]?pro[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Sl', version: `${compactVersion(m[1])}P`, family: 'other' }),
  },
  {
    pattern: /granite[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Gn', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /hermes[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Hm', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /jamba[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Jb', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /olmo[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Ol', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /apertus[-_.]?v?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Ap', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /arrow[-_.]?(\d+(?:[.-]\d+)?)[-_.]?telos/i,
    resolve: m => ({ short: 'Aw', version: `${compactVersion(m[1])}T`, family: 'other' }),
  },
  {
    pattern: /arrow[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Aw', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /ember[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Em', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /particle[-_.]?(\d+(?:[.-]\d+)?)?/i,
    resolve: m => ({ short: 'Pt', version: compactVersion(m[1]), family: 'other' }),
  },
  {
    pattern: /reka[-_.]?(flash|core|edge)?/i,
    resolve: m => ({ short: 'Rk', version: m[1] ? m[1][0]!.toUpperCase() : '', family: 'other' }),
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
