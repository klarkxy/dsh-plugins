/**
 * Prompt-profile catalog.
 *
 * A profile is an optional text block appended after the shared contract. The
 * files live in `presets/profiles/*.md` and support a minimal frontmatter:
 *
 *   ---
 *   extends: default
 *   name: Max
 *   ---
 *   <body>
 *
 * `extends` composes a base body before the child body, which keeps the common
 * contract in one place and makes a short variant safe. Unknown ids or circular
 * chains return the default body; a cycle contributes its chain only once.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from './contract.ts'

/** One parsed profile file. */
export interface PromptProfile {
  id: string
  name: string
  extends?: string
  body: string
}

/** @param text - a profile file.
 * @returns parsed frontmatter and body. */
function parseProfile(text: string): { meta: Record<string, string>; body: string } {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { meta: {}, body: normalized.trim() }
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) return { meta: {}, body: normalized.trim() }
  const meta: Record<string, string> = {}
  for (const line of normalized.slice(4, end).split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { meta, body: normalized.slice(end + 5).trim() }
}

let cached: Map<string, PromptProfile> | undefined

/**
 * Load all profile files from the package.
 * @param root - the package root; tests may pass a fixture directory.
 * @returns profiles keyed by file stem.
 */
export function loadProfiles(root: string = packageRoot()): Map<string, PromptProfile> {
  if (root === packageRoot() && cached !== undefined) return cached
  const directory = join(root, 'presets', 'profiles')
  const profiles = new Map<string, PromptProfile>()
  if (!existsSync(directory)) return profiles
  for (const filename of readdirSync(directory).filter(name => name.endsWith('.md')).sort()) {
    const id = filename.slice(0, -3)
    const parsed = parseProfile(readFileSync(join(directory, filename), 'utf8'))
    profiles.set(id, {
      id,
      name: parsed.meta.name ?? id,
      ...(parsed.meta.extends === undefined ? {} : { extends: parsed.meta.extends }),
      body: parsed.body,
    })
  }
  if (root === packageRoot()) cached = profiles
  return profiles
}

/** @param id - profile id.
 * @param profiles - loaded catalog.
 * @param seen - cycle guard.
 * @returns the composed body, or undefined for an unknown id. */
function bodyFor(id: string, profiles: Map<string, PromptProfile>, seen = new Set<string>()): string | undefined {
  const profile = profiles.get(id)
  if (profile === undefined) return undefined
  if (seen.has(id)) return ''
  const nextSeen = new Set([...seen, id])
  const base = profile.extends === undefined ? '' : bodyFor(profile.extends, profiles, nextSeen) ?? ''
  return [base, profile.body].filter(part => part.trim() !== '').join('\n\n')
}

/**
 * Compose one profile body, expanding `extends` chains.
 * @param id - profile id.
 * @param profiles - optional loaded catalog.
 * @returns the body, or undefined when the id is unknown.
 */
export function composeProfile(id: string, profiles: Map<string, PromptProfile> = loadProfiles()): string | undefined {
  const body = bodyFor(id, profiles)
  return body ?? (id === 'default' ? undefined : bodyFor('default', profiles))
}

/** @returns the profile ids in deterministic order, default first. */
export function profileIds(profiles: Map<string, PromptProfile> = loadProfiles()): string[] {
  const ids = [...profiles.keys()].sort()
  return ids.includes('default') ? ['default', ...ids.filter(id => id !== 'default')] : ids
}

/** @returns the human-readable profile name. */
export function profileName(id: string, profiles: Map<string, PromptProfile> = loadProfiles()): string {
  return profiles.get(id)?.name ?? id
}
