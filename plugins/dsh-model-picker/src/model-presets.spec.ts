import { describe, expect, it } from 'vitest'
import { canonicalModelKey, compactEffortLabel, resolveModelPreset } from './model-presets.ts'

describe('canonicalModelKey', () => {
  it('strips provider path prefixes and normalizes case while preserving version numbers', () => {
    expect(canonicalModelKey('google/gemini-4-neon')).toBe('gemini-4-neon')
    expect(canonicalModelKey('vertex/Gemini-4-Neon')).toBe('gemini-4-neon')
    expect(canonicalModelKey('xai/grok-4.6')).toBe('grok-4.6')
    expect(canonicalModelKey('xai/grok-4.7')).toBe('grok-4.7')
    expect(canonicalModelKey('grok-4.6')).not.toBe(canonicalModelKey('grok-4.7'))
    expect(canonicalModelKey('  ')).toBe('')
  })
})

describe('resolveModelPreset', () => {
  it('maps Gemini 4 periodic-table element models to chemical symbols', () => {
    expect(resolveModelPreset('google/gemini-4-hydrogen')).toEqual({ short: 'H', version: '', family: 'gemini' })
    expect(resolveModelPreset('gemini-4-carbon')).toEqual({ short: 'C', version: '', family: 'gemini' })
    expect(resolveModelPreset('gemini-4-neon')).toEqual({ short: 'Ne', version: '', family: 'gemini' })
    expect(resolveModelPreset('gemini-4-argon')).toEqual({ short: 'Ar', version: '', family: 'gemini' })
    expect(resolveModelPreset('gemini-4-krypton')).toEqual({ short: 'Kr', version: '', family: 'gemini' })
    expect(resolveModelPreset('gemini-4-xenon')).toEqual({ short: 'Xe', version: '', family: 'gemini' })
  })

  it('maps Gemini numbered series, Nano Banana, and Gemma', () => {
    expect(resolveModelPreset('gemini-2.5-pro')).toEqual({ short: 'Gm', version: '2.5P', family: 'gemini' })
    expect(resolveModelPreset('gemini-3-flash')).toEqual({ short: 'Gm', version: '3F', family: 'gemini' })
    expect(resolveModelPreset('gemini-3.5-flash-lite')).toEqual({ short: 'Gm', version: '3.5L', family: 'gemini' })
    expect(resolveModelPreset('google/gemini-nano-banana-2.1')).toEqual({ short: 'Nb', version: '2.1', family: 'gemini' })
    expect(resolveModelPreset('gemma-3')).toEqual({ short: 'Ga', version: '3', family: 'gemini' })
  })

  it('maps Anthropic Claude models including Opus, Fable, Sonnet, and Haiku', () => {
    expect(resolveModelPreset('anthropic/claude-opus-4-7')).toEqual({ short: 'Op', version: '4.7', family: 'claude' })
    expect(resolveModelPreset('anthropic/claude-opus-5-5')).toEqual({ short: 'Op', version: '5.5', family: 'claude' })
    expect(resolveModelPreset('anthropic/claude-fable-5-2')).toEqual({ short: 'Fb', version: '5.2', family: 'claude' })
    expect(resolveModelPreset('claude-4.5-fable')).toEqual({ short: 'Fb', version: '4.5', family: 'claude' })
    expect(resolveModelPreset('claude-sonnet-5-5')).toEqual({ short: 'Sn', version: '5.5', family: 'claude' })
    expect(resolveModelPreset('claude-haiku-5-5')).toEqual({ short: 'Hk', version: '5.5', family: 'claude' })
  })

  it('maps DeepSeek models accurately', () => {
    expect(resolveModelPreset('deepseek-v4.1')).toEqual({ short: 'Ds', version: '4.1', family: 'deepseek' })
    expect(resolveModelPreset('deepseek/deepseek-v4.1-flash-1017')).toEqual({ short: 'Ds', version: '4.1F', family: 'deepseek' })
    expect(resolveModelPreset('deepseek-r1')).toEqual({ short: 'Dr', version: '1', family: 'deepseek' })
    expect(resolveModelPreset('deepseek-reasoner')).toEqual({ short: 'Dr', version: '', family: 'deepseek' })
    expect(resolveModelPreset('deepseek-chat')).toEqual({ short: 'Dc', version: '', family: 'deepseek' })
  })

  it('maps OpenAI GPT-6 Astra/Sol/Luna/Terra/Cyber, Codex, Image, OSS, and o-series models', () => {
    expect(resolveModelPreset('openai/gpt-6.2-astra')).toEqual({ short: 'As', version: '6.2', family: 'openai' })
    expect(resolveModelPreset('openai/gpt-6.2-sol')).toEqual({ short: 'So', version: '6.2', family: 'openai' })
    expect(resolveModelPreset('openai/gpt-6-luna')).toEqual({ short: 'Lu', version: '6', family: 'openai' })
    expect(resolveModelPreset('openai/gpt-6.1-terra')).toEqual({ short: 'Gt', version: '6.1', family: 'openai' })
    expect(resolveModelPreset('openai/gpt-6-cyber')).toEqual({ short: 'Cy', version: '6', family: 'openai' })
    expect(resolveModelPreset('openai/gpt-image-2.5-flare')).toEqual({ short: 'Gi', version: '2.5', family: 'openai' })
    expect(resolveModelPreset('openai/gpt-6.1')).toEqual({ short: 'Gp', version: '6.1', family: 'openai' })
    expect(resolveModelPreset('gpt-5.3-codex')).toEqual({ short: 'Cx', version: '5.3', family: 'openai' })
    expect(resolveModelPreset('gpt-5-mini')).toEqual({ short: 'Gp', version: '5m', family: 'openai' })
    expect(resolveModelPreset('gpt-4o')).toEqual({ short: 'Gp', version: '4o', family: 'openai' })
    expect(resolveModelPreset('o3-mini')).toEqual({ short: 'O3', version: 'm', family: 'openai' })
    expect(resolveModelPreset('o4-pro')).toEqual({ short: 'O4', version: 'p', family: 'openai' })
  })

  it('distinguishes concurrent xAI Grok versions such as 4.6 and 4.7 via superscript', () => {
    expect(resolveModelPreset('xai/grok-4.6')).toEqual({ short: 'Gr', version: '4.6', family: 'grok' })
    expect(resolveModelPreset('xai/grok-4.7')).toEqual({ short: 'Gr', version: '4.7', family: 'grok' })
    expect(resolveModelPreset('grok-code-1')).toEqual({ short: 'Gc', version: '1', family: 'grok' })
  })

  it('maps Chinese model families cataloged on models.dev', () => {
    expect(resolveModelPreset('glm-5.3')).toEqual({ short: 'Gl', version: '5.3', family: 'cn' })
    expect(resolveModelPreset('glm-4.5-air')).toEqual({ short: 'Gl', version: '4.5A', family: 'cn' })
    expect(resolveModelPreset('MiniMax-M3.1-Flash-Preview')).toEqual({ short: 'Mm', version: '3.1F', family: 'cn' })
    expect(resolveModelPreset('minimax/MiniMax-H3')).toEqual({ short: 'Mh', version: '3', family: 'cn' })
    expect(resolveModelPreset('moonshotai/kimi-k3.1-pro')).toEqual({ short: 'Km', version: '3.1P', family: 'cn' })
    expect(resolveModelPreset('kimi-k2.5')).toEqual({ short: 'Km', version: '2.5', family: 'cn' })
    expect(resolveModelPreset('alibaba/qwen4-max')).toEqual({ short: 'Qw', version: '4M', family: 'cn' })
    expect(resolveModelPreset('alibaba/qwen3.8-omni-flash')).toEqual({ short: 'Qo', version: '3.8', family: 'cn' })
    expect(resolveModelPreset('qwen-3.5-coder')).toEqual({ short: 'Qc', version: '3.5', family: 'cn' })
    expect(resolveModelPreset('qwen-3')).toEqual({ short: 'Qw', version: '3', family: 'cn' })
    expect(resolveModelPreset('qwq-32b')).toEqual({ short: 'Qq', version: '32', family: 'cn' })
    expect(resolveModelPreset('xiaomi/mimo-v2.6-pro')).toEqual({ short: 'Mo', version: '2.6P', family: 'cn' })
    expect(resolveModelPreset('xiaomi/mimo-v2.6-flash')).toEqual({ short: 'Mo', version: '2.6F', family: 'cn' })
    expect(resolveModelPreset('tencent/hy4-flash')).toEqual({ short: 'Hy', version: '4F', family: 'cn' })
    expect(resolveModelPreset('tencent/hy4')).toEqual({ short: 'Hy', version: '4', family: 'cn' })
    expect(resolveModelPreset('bytedance-seed/seed-2.1-lite')).toEqual({ short: 'Sd', version: '2.1L', family: 'cn' })
    expect(resolveModelPreset('bytedance-seed/seedance-2.5')).toEqual({ short: 'Sc', version: '2.5', family: 'cn' })
    expect(resolveModelPreset('meituan/longcat-2.5')).toEqual({ short: 'Lc', version: '2.5', family: 'cn' })
    expect(resolveModelPreset('inclusionai/ling-3.2-flash')).toEqual({ short: 'Lg', version: '3.2F', family: 'cn' })
    expect(resolveModelPreset('stepfun/step-5-preview')).toEqual({ short: 'St', version: '5', family: 'cn' })
    expect(resolveModelPreset('openbmb/minicpm-v-4.7-35b-a3b')).toEqual({ short: 'Cp', version: '4.7', family: 'cn' })
  })

  it('maps global open-weight and frontier labs cataloged on models.dev', () => {
    expect(resolveModelPreset('meta/muse-ember-1.0')).toEqual({ short: 'Me', version: '1.0', family: 'other' })
    expect(resolveModelPreset('meta/muse-wonder-1.0')).toEqual({ short: 'Mw', version: '1.0', family: 'other' })
    expect(resolveModelPreset('meta/muse-spark-open')).toEqual({ short: 'Ms', version: '', family: 'other' })
    expect(resolveModelPreset('llama-4')).toEqual({ short: 'Lm', version: '4', family: 'other' })
    expect(resolveModelPreset('microsoft/mai-code-2-flash')).toEqual({ short: 'Mc', version: '2F', family: 'other' })
    expect(resolveModelPreset('nvidia/nemotron-3.5-super-vl-120b-a12b')).toEqual({ short: 'Nm', version: '3.5V', family: 'other' })
    expect(resolveModelPreset('mistral/mistral-large-4')).toEqual({ short: 'Ml', version: '4', family: 'other' })
    expect(resolveModelPreset('codestral-latest')).toEqual({ short: 'Cs', version: '', family: 'other' })
    expect(resolveModelPreset('amazon/nova-pro')).toEqual({ short: 'Nv', version: 'P', family: 'other' })
    expect(resolveModelPreset('cohere/command-a')).toEqual({ short: 'Cm', version: 'A', family: 'other' })
    expect(resolveModelPreset('perplexity/sonar-deep-research')).toEqual({ short: 'Sr', version: 'D', family: 'other' })
    expect(resolveModelPreset('inception/mercury-3')).toEqual({ short: 'Hg', version: '3', family: 'other' })
    expect(resolveModelPreset('thinkingmachines/inkling-2-small')).toEqual({ short: 'Ik', version: '2S', family: 'other' })
    expect(resolveModelPreset('reflection/beam-1.0-501b-a23b')).toEqual({ short: 'Bm', version: '1.0', family: 'other' })
    expect(resolveModelPreset('sakana/fugu-ultra-v2')).toEqual({ short: 'Fg', version: 'U2', family: 'other' })
    expect(resolveModelPreset('upstage/solar-mini4')).toEqual({ short: 'Sl', version: '4m', family: 'other' })
  })

  it('derives a deterministic 2-letter fallback + version for unrecognized models', () => {
    expect(resolveModelPreset('acme/zephyr-2.5')).toEqual({ short: 'Ze', version: '2.5', family: 'other' })
    expect(resolveModelPreset('custom-model')).toEqual({ short: 'Cu', version: '', family: 'other' })
  })
})

describe('compactEffortLabel', () => {
  it('shortens standard reasoning effort ids for compact bottom cells', () => {
    expect(compactEffortLabel({ id: 'off', name: 'Off' })).toBe('Off')
    expect(compactEffortLabel({ id: 'minimal', name: 'Minimal' })).toBe('Min')
    expect(compactEffortLabel({ id: 'low', name: 'Low' })).toBe('L')
    expect(compactEffortLabel({ id: 'medium', name: 'Medium' })).toBe('M')
    expect(compactEffortLabel({ id: 'high', name: 'High' })).toBe('H')
    expect(compactEffortLabel({ id: 'xhigh', name: 'Extra High' })).toBe('xH')
    expect(compactEffortLabel({ id: 'max', name: 'Max' })).toBe('Max')
    expect(compactEffortLabel({ id: 'turbo', name: 'Turbo' })).toBe('Tur')
  })
})
