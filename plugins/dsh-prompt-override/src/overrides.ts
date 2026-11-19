/**
 * Local overrides at `$DSH_HOME/prompt-override/overrides.json`.
 *
 * Read once when the plugin starts; malformed fields are ignored individually
 * so one typo does not disable the whole plugin.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DevContextMode } from './rewrite.ts'

/** Validated local overrides; every field is optional. */
export interface Overrides {
  core?: boolean
  tools?: boolean
  devContext?: DevContextMode
  coreText?: string
  sections?: Record<string, string | null>
}

/** @returns the configured DSH home, falling back to `~/.dsh`. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env.DSH_HOME ?? '').trim()
  return configured === '' ? join(homedir(), '.dsh') : configured
}

/** @returns the absolute overrides file path. */
export function overridesPath(dshHome: string = resolveDshHome()): string {
  return join(dshHome, 'prompt-override', 'overrides.json')
}

/**
 * Validate parsed JSON into overrides, dropping invalid fields.
 * @param raw - parsed file content.
 * @returns the valid subset plus the names of ignored fields.
 */
export function parseOverrides(raw: unknown): { overrides: Overrides, ignored: string[] } {
  const overrides: Overrides = {}
  const ignored: string[] = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { overrides, ignored: ['<root>'] }
  const input = raw as Record<string, unknown>
  for (const key of ['core', 'tools'] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] === 'boolean') overrides[key] = input[key]
    else ignored.push(key)
  }
  if (input.devContext !== undefined) {
    if (input.devContext === 'auto' || input.devContext === 'keep' || input.devContext === 'drop') overrides.devContext = input.devContext
    else ignored.push('devContext')
  }
  if (input.coreText !== undefined) {
    if (typeof input.coreText === 'string') overrides.coreText = input.coreText
    else ignored.push('coreText')
  }
  if (input.sections !== undefined) {
    if (input.sections !== null && typeof input.sections === 'object' && !Array.isArray(input.sections)) {
      const sections: Record<string, string | null> = {}
      for (const [name, text] of Object.entries(input.sections as Record<string, unknown>)) {
        if (typeof text === 'string' || text === null) sections[name] = text
        else ignored.push(`sections.${name}`)
      }
      overrides.sections = sections
    } else {
      ignored.push('sections')
    }
  }
  return { overrides, ignored }
}

/**
 * Read the overrides file; a missing file is not an error.
 * @param path - file to read.
 * @returns the overrides, ignored field names, and a read/parse error message if any.
 */
export function readOverrides(path: string = overridesPath()): { overrides: Overrides, ignored: string[], error?: string } {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { overrides: {}, ignored: [] }
    return { overrides: {}, ignored: [], error: (error as Error).message }
  }
  try {
    return parseOverrides(JSON.parse(text.replace(/^\uFEFF/, '')))
  } catch (error) {
    return { overrides: {}, ignored: [], error: (error as Error).message }
  }
}
