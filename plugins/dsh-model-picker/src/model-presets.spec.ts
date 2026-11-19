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

  it('maps Gemini numbered series with tier suffixes', () => {
    expect(resolveModelPreset('gemini-2.5-pro')).toEqual({ short: 'Gm', version: '2.5P', family: 'gemini' })
    expect(resolveModelPreset('gemini-3-flash')).toEqual({ short: 'Gm', version: '3F', family: 'gemini' })
    expect(resolveModelPreset('gemini-3.5-flash-lite')).toEqual({ short: 'Gm', version: '3.5L', family: 'gemini' })
  })

  it('maps Anthropic Claude models including Opus, Fable, Sonnet, and Haiku', () => {
    expect(resolveModelPreset('anthropic/claude-opus-4-7')).toEqual({ short: 'Op', version: '4.7', family: 'claude' })
    expect(resolveModelPreset('claude-4.5-fable')).toEqual({ short: 'Fb', version: '4.5', family: 'claude' })
    expect(resolveModelPreset('claude-sonnet-4-6')).toEqual({ short: 'Sn', version: '4.6', family: 'claude' })
    expect(resolveModelPreset('claude-3.5-haiku')).toEqual({ short: 'Hk', version: '3.5', family: 'claude' })
  })

  it('maps DeepSeek models accurately', () => {
    expect(resolveModelPreset('deepseek-v4.1')).toEqual({ short: 'Ds', version: '4.1', family: 'deepseek' })
    expect(resolveModelPreset('deepseek-v3-flash')).toEqual({ short: 'Ds', version: '3F', family: 'deepseek' })
    expect(resolveModelPreset('deepseek-r1')).toEqual({ short: 'Dr', version: '1', family: 'deepseek' })
    expect(resolveModelPreset('deepseek-reasoner')).toEqual({ short: 'Dr', version: '', family: 'deepseek' })
    expect(resolveModelPreset('deepseek-chat')).toEqual({ short: 'Dc', version: '', family: 'deepseek' })
  })

  it('maps OpenAI GPT, Codex, and o-series models', () => {
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

  it('maps Chinese and open-weight model families (GLM, MiniMax, Kimi, Qwen, Step, Llama, Mistral)', () => {
    expect(resolveModelPreset('glm-5.1')).toEqual({ short: 'Gl', version: '5.1', family: 'cn' })
    expect(resolveModelPreset('glm-4.5-air')).toEqual({ short: 'Gl', version: '4.5A', family: 'cn' })
    expect(resolveModelPreset('MiniMax-M3.1-Flash-Preview')).toEqual({ short: 'Mm', version: '3.1F', family: 'cn' })
    expect(resolveModelPreset('kimi-k2.5')).toEqual({ short: 'Km', version: '2.5', family: 'cn' })
    expect(resolveModelPreset('qwen-3.5-coder')).toEqual({ short: 'Qc', version: '3.5', family: 'cn' })
    expect(resolveModelPreset('qwen-3')).toEqual({ short: 'Qw', version: '3', family: 'cn' })
    expect(resolveModelPreset('qwq-32b')).toEqual({ short: 'Qq', version: '32', family: 'cn' })
    expect(resolveModelPreset('step-3.5')).toEqual({ short: 'St', version: '3.5', family: 'cn' })
    expect(resolveModelPreset('llama-4')).toEqual({ short: 'Lm', version: '4', family: 'other' })
    expect(resolveModelPreset('codestral-latest')).toEqual({ short: 'Cs', version: '', family: 'other' })
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
