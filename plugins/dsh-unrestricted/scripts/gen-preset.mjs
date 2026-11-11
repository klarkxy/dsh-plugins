#!/usr/bin/env node
/**
 * Keep the preset's plugin roster in sync with the installed host's `standard`
 * preset.
 *
 * The preset intentionally retains a few host rows that the stock standard
 * preset disables, and intentionally drops the removed `list-agents` row. This
 * script encodes those two exceptions once and reports a readable diff; CI can
 * run it as `node scripts/gen-preset.mjs --check`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const ourPatch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const hostManifest = import.meta.resolve('@deepseek-ai/dsh-web-app/package.json')
const hostPatch = readFileSync(new URL('./presets/standard.patch.yml', hostManifest), 'utf8')

/** Host rows this preset deliberately keeps enabled. */
const RETAINED = new Set(['tool-subagent-codex', 'tool-subagent-claude-code', 'tool-ralph'])
/** Host rows this preset must not carry because the host removed their subpath. */
const DROPPED = new Set(['tool-subagent-list-agents'])

/** Every `- id:` / `name:` plugin pair in document order. */
function roster(source) {
  const rows = []
  const pattern = /^[ ]{10,}- id: ([A-Za-z0-9-]+)\n[ ]{10,}name: (.+)$/gm
  for (const match of source.matchAll(pattern)) {
    if (match[1] === 'unrestricted-runtime' || match[1] === 'unrestricted-transport') continue
    rows.push([match[1], match[2].trim().replace(/^'|'$/g, '')])
  }
  return rows
}

/** Strip the known deliberate exceptions from one roster. */
function normalized(rows) {
  return rows.filter(([id]) => !RETAINED.has(id) && !DROPPED.has(id))
}

const ours = normalized(roster(ourPatch))
const theirs = normalized(roster(hostPatch))
const same = ours.length === theirs.length && ours.every((row, index) => row[0] === theirs[index]?.[0] && row[1] === theirs[index]?.[1])

if (process.argv.includes('--check')) {
  if (!same) {
    console.error('dsh-unrestricted: plugin roster drifted from the installed standard preset.')
    console.error('ours:', ours)
    console.error('host:', theirs)
    process.exitCode = 1
  } else {
    console.log(`dsh-unrestricted: roster matches ${theirs.length} host rows.`)
  }
} else {
  console.log(JSON.stringify({ packageRoot: pkgRoot, ours, theirs, same }, null, 2))
}
