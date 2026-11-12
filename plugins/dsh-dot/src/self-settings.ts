import { DotError, messageOf, type DotService } from './service.ts'
import { AGREEMENTS_MAX_CHARS, SETTING_FIELDS, TOOL, type DotSettings, type SettingField, type SettingProposal } from './contracts.ts'
import { lockedField, patchSettings } from './settings.ts'
import { DEFAULT_ADDRESS, DEFAULT_PERSONA } from './persona.ts'
import { normalizeAgreements } from './memory.ts'

/** A proposal for the old "memory" field now rewrites the agreements, which replaced the notes. */
function valueOf(settings: DotSettings, field: SettingField, agreementsText: string): unknown {
  if (field === 'memory') return agreementsText || null
  if (field === 'persona') return settings.persona ?? DEFAULT_PERSONA
  if (field === 'address') return settings.address ?? DEFAULT_ADDRESS
  return settings[field] ?? null
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '(default / empty)'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

export function proposalText(proposal: SettingProposal): string {
  return `${proposal.field}\nBefore: ${textOf(proposal.before)}\nAfter: ${textOf(proposal.after)}\nWhy: ${proposal.reason}`
}

/**
 * Compact read-only snapshot of the core hard-switch settings injected into
 * dot's system prompt. Rendered on every request so a settings change reaches
 * dot in the same segment without requiring a new segment rollover.
 */
export function settingsSnapshotBlock(settings: DotSettings): string {
  const lines = [
    '[settings snapshot — read-only; use dot_settings to propose a change]',
    `scope: ${settings.scope}`,
    `approvals: ${settings.approvals}`,
    `questions: ${settings.questions}`,
    `taskPermission: ${(settings as unknown as Record<string, unknown>).taskPermission ?? 'default'}`,
  ]
  const reflection = (settings as unknown as Record<string, unknown>).reflection
  if (reflection !== undefined) lines.push(`reflection: ${reflection}`)
  return lines.join('\n')
}

export class SelfSettings {
  constructor(private readonly dot: DotService) {}

  async read(): Promise<string> {
    const knowledge = await this.dot.knowledgeView()
    const locks = this.dot.store.settings.locks ?? {}
    const fields = SETTING_FIELDS.map(field => `${field}${locks[field] ? ' [locked by the human]' : ''}: ${textOf(valueOf(this.dot.store.settings, field, knowledge.agreements.text))}`)
    const pending = this.dot.store.settingProposals.map(proposal => `${proposal.id} · ${proposal.field}: ${proposal.reason}`).join('\n')
    return `${fields.join('\n')}\n\nOnly propose an unlocked field with ${TOOL.settings} (action=propose); the human must approve it. Locks and homeDir are human-only.${pending ? `\n\nWaiting proposals:\n${pending}` : ''}`
  }

  async propose(input: { field: string; value: unknown; reason: string }): Promise<string> {
    return this.dot.serialSettings(() => this.proposeNow(input))
  }

  private async proposeNow(input: { field: string; value: unknown; reason: string }): Promise<string> {
    const field = lockedField(this.dot.store.settings, input.field)!
    if (!input.reason.trim()) throw new DotError('dot/invalid', 'reason must explain why the change helps')
    let before: unknown
    let after: unknown
    if (field === 'memory') {
      if (input.value !== null && typeof input.value !== 'string') throw new DotError('dot/invalid', 'memory must be text or null')
      const knowledge = await this.dot.knowledgeView()
      before = normalizeAgreements(knowledge.agreements.text) || null
      const normalized = input.value === null ? '' : normalizeAgreements(String(input.value))
      if (normalized.trim().length > AGREEMENTS_MAX_CHARS) throw new DotError('dot/invalid', `the agreements are at most ${AGREEMENTS_MAX_CHARS} characters`)
      after = normalized || null
    } else {
      const patch = { [field]: input.value }
      patchSettings(this.dot.store.settings, patch)
      before = valueOf(this.dot.store.settings, field, '')
      after = valueOf(patchSettings(this.dot.store.settings, patch), field, '')
    }
    if (this.dot.store.settingProposals.some(proposal => proposal.field === field)) throw new DotError('dot/proposal-exists', `a change to ${field} already waits for the human; ask them to review it before proposing another`)
    if (equal(before, after)) throw new DotError('dot/invalid', `${field} already has this value`)
    const proposal: SettingProposal = { id: `setting-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, field, before, after, reason: input.reason.trim(), createdAt: Date.now() }
    await this.dot.store.putSettingProposal(proposal)
    return `Proposal ${proposal.id} waits for the human in Settings > Proposed changes. Nothing changed yet.\n${proposalText(proposal)}`
  }

  async decide(id: string, allow: boolean): Promise<string> {
    return this.dot.serialSettings(() => this.decideNow(id, allow))
  }

  private async decideNow(id: string, allow: boolean): Promise<string> {
    const proposal = this.dot.store.settingProposal(id)
    if (!proposal) throw new DotError('dot/unknown-proposal', `no waiting settings proposal ${id}`)
    const field = lockedField(this.dot.store.settings, proposal.field)!
    if (!allow) {
      await this.dot.store.deleteSettingProposal(id)
      return `Declined ${id}; no settings changed.`
    }
    const knowledge = await this.dot.knowledgeView()
    const current = field === 'memory' ? normalizeAgreements(knowledge.agreements.text) || null : valueOf(this.dot.store.settings, field, '')
    if (!equal(current, proposal.before)) throw new DotError('dot/proposal-stale', `${field} changed after this proposal. Decline it and ask Dorothy to propose the change again from the current value.`)
    try {
      if (field === 'memory') await this.dot.setAgreements(proposal.after === null ? '' : String(proposal.after), 'human')
      else await this.dot.store.setSettings(patchSettings(this.dot.store.settings, { [field]: proposal.after }))
    } catch (error) {
      throw new DotError('dot/proposal-failed', messageOf(error))
    }
    await this.dot.store.deleteSettingProposal(id)
    // Agreements already reach dot before the next message; other settings keep the live-apply path.
    if (field !== 'memory') await this.dot.settingsChanged()
    const now = field === 'memory' ? (await this.dot.knowledgeView()).agreements.text || null : valueOf(this.dot.store.settings, field, '')
    return `Approved ${id}; ${field} is now ${textOf(now)}.`
  }
}
