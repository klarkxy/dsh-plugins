import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))

// Plugin business settings are grouped by ownership (see plugins/AGENTS.md):
// preference items merge into native groups (settings.general.item,
// settings.models.footer), action-owned configuration stays in its own GUI
// (dsh-git-commit inside the commit popover), and complex management pages keep
// settings.section. Business settings never go on the plugins page seats —
// plugins.bundle.config / plugins.row.config stay legal for non-settings
// contributions only — nor on the legacy dsh-editor.settings.* seats. This is
// a placement rule, not a repo-wide seat ban: other official seats keep their
// own ownership and remain legal.
const forbidden = /['"`](?:plugins\.(?:bundle|row)\.config|dsh-editor\.settings\.[\w-]+)['"`]/

// Per-file exemptions: registrations on a plugins page seat that are NOT
// settings. dsh-dev-index mounts DocumentationBrowser — a pure documentation
// iframe — under plugins.bundle.config only; it is not a settings entry, stays
// on the plugins page, and must not be migrated or flagged. Only that one
// literal is exempted: plugins.row.config and dsh-editor seats still flag.
const exempted = new Map([
  ['plugins/dsh-dev-index/client.js', /['"`]plugins\.bundle\.config['"`]/g],
])

// Plugins whose settings moved onto grouped native seats must not keep or
// re-add a settings.section registration. The guard matches an actual
// slots.inject('settings.section', …) wait or a register spec naming that
// seat; plain prose mentioning the seat is not flagged. dsh-font is not here:
// it owns a standalone settings page (id 'font'), so it keeps its section.
const mergedSeats = new Map([
  ['plugins/dsh-current-title/src/client.tsx', 'the shared Session Management column'],
  ['plugins/dsh-git-commit/src/client.tsx', 'conversation.session.header.actions'],
  ['plugins/dsh-safe-auto/src/client.jsx', 'the shared Session Management column'],
  ['plugins/dsh-session-manager/src/client.tsx', 'the shared Session Management column'],
])

// A plugin that owns a settings page may take over a native cell of another
// group while that page exists: it registers the same cell id at a lower
// priority, so the host's row stays on the ledger and renders again as soon as
// the page or the plugin goes away. This is an intentional native-cell
// override, not a seat ban: the General group stays open to every plugin, and
// the override may only shadow one native cell — never add a second visible
// row for the same setting.
const nativeCellOverrides = new Map([
  ['plugins/dsh-font/src/client.tsx', { seat: 'settings.general.item', id: 'font-size' }],
])

// The shared Session Management column is a UI group, not a business owner.
// Its participants are equal citizens: the shared kit service owns the page,
// every participant contributes one row to it, and no participant keeps a page
// of its own — which is why a plugin must never depend on another business
// plugin to provide its settings page.
const columnParticipants = [
  { dir: 'plugins/dsh-current-title', pkg: '@klarkxy/dsh-current-title' },
  { dir: 'plugins/dsh-session-manager', pkg: '@klarkxy/dsh-session-manager' },
  { dir: 'plugins/dsh-safe-auto', pkg: '@klarkxy/dsh-safe-auto' },
]
// The shared item list is declared once, by the kit's page service; the slot
// name lives in the shared contracts, so no participant spells it out.
const columnItemSlot = 'dsh.session-settings.item'

function* sources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'lib', 'dist', 'test', 'tests', 'docs', '.npm-cache'].includes(entry.name)) yield* sources(path)
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:spec|test)\./.test(entry.name)) {
      // Frozen public contracts may still export old names for external consumers.
      // Runtime/client implementations must not use those old settings seats.
      if (entry.name !== 'contracts.ts') yield path
    }
  }
}

/** A seat registration: an injected wait for the seat or a register spec naming it. */
function registersSeat(source, seat) {
  return new RegExp(`slots\\.inject\\(\\s*['"\`]${seat}['"\`]`).test(source)
    || new RegExp(`slots\\.register\\(\\s*\\{[^}]*?['"\`]?name['"\`]?\\s*:\\s*['"\`]${seat}['"\`]`).test(source)
}

/** The list cells a source registers into one seat: id plus shadowing rank. */
function registeredCells(source, seat) {
  const cells = []
  const pattern = new RegExp(`slots\\.register\\(\\s*(\\{[^{}]*?['"\`]${seat}['"\`][^{}]*?\\})`, 'g')
  for (const match of source.matchAll(pattern)) {
    const literal = match[1]
    const id = /['"\`]?id['"\`]?\s*:\s*['"\`]([^'"\`]+)['"\`]/.exec(literal)
    const priority = /['"\`]?priority['"\`]?\s*:\s*(-?\d+)/.exec(literal)
    cells.push({ id: id?.[1], priority: priority ? Number(priority[1]) : undefined })
  }
  return cells
}

test('a native cell override shadows one native cell and keeps its own page', () => {
  const violations = []
  for (const [rel, override] of nativeCellOverrides) {
    const source = readFileSync(join(root, rel), 'utf8')
    // The override belongs to a page: without one there would be no place to
    // move the setting to, and the native row would have to stay visible.
    if (!registersSeat(source, 'settings.section')) {
      violations.push(`${rel}: no settings.section page (a native cell override moves a setting into a page)`)
    }
    const cells = registeredCells(source, override.seat)
    if (cells.length !== 1) {
      violations.push(`${rel}: ${cells.length} ${override.seat} cells (expected one shadow of the native cell ${override.id})`)
      continue
    }
    const cell = cells[0]
    if (cell.id !== override.id) {
      violations.push(`${rel}: ${override.seat} cell ${cell.id} (expected the native cell ${override.id})`)
    }
    // A shadow ranks below the native row, which keeps priority 0: the host's
    // entry stays the fallback whenever the plugin is gone.
    if (cell.priority === undefined || cell.priority >= 0) {
      violations.push(`${rel}: ${override.seat} cell priority ${cell.priority} (a shadow must rank below the native cell)`)
    }
  }
  assert.deepEqual(violations, [], 'A plugin that overrides a native cell shadows that one cell at a lower priority and keeps its own settings page; it never adds a second visible row for the same setting')
})

test('business settings leave the plugins page; grouped seats stay out of settings.section', () => {
  const violations = []
  for (const path of sources(join(root, 'plugins'))) {
    const rel = relative(root, path).replaceAll('\\', '/')
    const exempt = exempted.get(rel)
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const stripped = exempt ? line.replace(exempt, '') : line
      if (forbidden.test(stripped)) violations.push(`${rel}:${index + 1}`)
    })
    if (mergedSeats.has(rel)) {
      const target = mergedSeats.get(rel)
      const source = lines.join('\n')
      if (registersSeat(source, 'settings.section')) {
        violations.push(`${rel}: settings.section (merged into ${target})`)
      }
    }
  }
  assert.deepEqual(violations, [], 'Grouped settings register their native seat (settings.general.item / settings.models.footer) or their action GUI; never plugins.bundle.config / plugins.row.config, a legacy dsh-editor.settings seat, or a settings.section they merged out of')
})

test('the shared settings column has one page owner and no General fallback', () => {
  const violations = []
  for (const { dir } of columnParticipants) {
    for (const path of sources(join(root, dir))) {
      const rel = relative(root, path).replaceAll('\\', '/')
      const source = readFileSync(path, 'utf8')
      // A participant contributes a row; it never keeps a General page entry.
      if (registersSeat(source, 'settings.general.item')) {
        violations.push(`${rel}: settings.general.item (the shared column owns the entry, no fallback row)`)
      }
      // The shared item list is declared once by the page service, so its name
      // comes from the shared contracts instead of a local literal.
      if (source.includes(columnItemSlot)) {
        violations.push(`${rel}: ${columnItemSlot} (the shared slot name belongs to the shared contracts)`)
      }
    }
  }
  assert.deepEqual(violations, [], 'Participants of the shared column contribute one row each: no per-plugin page, no settings.general.item fallback, no locally spelled-out shared slot')
})

test('shared column participants do not depend on each other', () => {
  const violations = []
  for (const { dir, pkg } of columnParticipants) {
    const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
    const runtime = { ...manifest.dependencies, ...manifest.peerDependencies }
    for (const other of columnParticipants) {
      if (other.pkg === pkg) continue
      if (runtime[other.pkg]) violations.push(`${dir}/package.json: runtime dependency on ${other.pkg}`)
    }
    for (const path of sources(join(root, dir))) {
      const rel = relative(root, path).replaceAll('\\', '/')
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (/^\s*import\s+type\b/.test(line)) continue
        for (const other of columnParticipants) {
          if (other.pkg === pkg) continue
          if (line.includes(`'${other.pkg}'`) || line.includes(`"${other.pkg}"`)) {
            violations.push(`${rel}: imports ${other.pkg}`)
          }
        }
      }
    }
  }
  assert.deepEqual(violations, [], 'A shared column participant must work on its own: no business plugin depends on another business plugin for its settings page')
})
