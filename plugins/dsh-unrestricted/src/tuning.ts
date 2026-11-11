/**
 * Local tuning for the unrestricted preset.
 *
 * The file lives under `$DSH_HOME/unrestricted/tuning.json`, next to the rest
 * of this plugin's user state, so a user can turn the reminder or retry off
 * without editing the profile's `cordis.patch.yml`. Every field is optional;
 * malformed values fall back to the bundle configuration instead of taking the
 * preset down.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The optional local overrides, all validated on read. */
export interface Tuning {
  /** Whether the standing tail reminder is appended on every assembly. */
  tailReminder?: boolean
  /** Whether a refusal-shaped turn receives a corrective retry. */
  refusalRetry?: boolean
  /** Maximum corrective retries per turn, normalized to 1–3. */
  maxRetries?: number
  /** User-supplied model profile notes, keyed by a provider or model substring. */
  modelProfiles?: Record<string, string>
  /** Prompt profile id from `presets/profiles`; unknown ids fall back to default. */
  profile?: string
  /** Whether to enable the request-boundary stream transport. */
  transportEnabled?: boolean
  /** Maximum transport retries per LLM request, normalized to 1–3. */
  transportMaxRetries?: number
}

/** The path of the tuning file relative to the DSH home. */
export const TUNING_RELATIVE_PATH = 'unrestricted/tuning.json'

/** @param env - process environment, injectable for tests.
 * @returns the configured DSH home, falling back to `~/.dsh`. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env.DSH_HOME ?? '').trim()
  return configured === '' ? join(homedir(), '.dsh') : configured
}

/** @param dshHome - the DSH home directory.
 * @returns the absolute tuning file path. */
export function tuningPath(dshHome: string = resolveDshHome()): string {
  return join(dshHome, 'unrestricted', 'tuning.json')
}

/**
 * Read and validate one tuning file.
 * @param dshHome - the DSH home directory; tests pass a temporary directory.
 * @returns the valid overrides, or an empty object when the file is missing or malformed.
 */
export function readTuning(dshHome: string = resolveDshHome()): Tuning {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(tuningPath(dshHome), 'utf8'))
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const source = parsed as Record<string, unknown>
  const tuning: Tuning = {}

  if (typeof source.tailReminder === 'boolean') tuning.tailReminder = source.tailReminder
  if (typeof source.refusalRetry === 'boolean') tuning.refusalRetry = source.refusalRetry
  if (typeof source.maxRetries === 'number' && Number.isInteger(source.maxRetries)) {
    tuning.maxRetries = Math.min(3, Math.max(1, source.maxRetries))
  }
  if (source.modelProfiles !== null && typeof source.modelProfiles === 'object' && !Array.isArray(source.modelProfiles)) {
    const entries = Object.entries(source.modelProfiles)
      .filter(([needle, note]) => needle.trim() !== '' && typeof note === 'string' && note.trim() !== '')
      .map(([needle, note]) => [needle.trim(), (note as string).trim()] as const)
    if (entries.length > 0) tuning.modelProfiles = Object.fromEntries(entries)
  }
  if (typeof source.profile === 'string' && source.profile.trim() !== '') tuning.profile = source.profile.trim()
  if (typeof source.transportEnabled === 'boolean') tuning.transportEnabled = source.transportEnabled
  if (typeof source.transportMaxRetries === 'number' && Number.isInteger(source.transportMaxRetries)) {
    tuning.transportMaxRetries = Math.min(3, Math.max(1, source.transportMaxRetries))
  }
  return tuning
}
