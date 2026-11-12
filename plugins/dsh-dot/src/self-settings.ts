import { DotError, messageOf, type DotService } from './service.ts'
import { SETTING_FIELDS, type DotSettings, type SettingField, type SettingProposal } from './contracts.ts'
import { lockedField, patchSettings } from './settings.ts'
import { DEFAULT_ADDRESS, DEFAULT_PERSONA } from './persona.ts'
import { MEMORY_MAX_CHARS, memorySection } from './memory.ts'

const normalizeMemory = (value: string): string => {
  const trimmed = value.replace(/\r\n/g, '\n').trim()
  return trimmed ? `${value.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n` : ''
}

function valueOf(settings: DotSettings, field: SettingField, memory: string): unknown {
  if (field === 'memory') return memory || null
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

export class SelfSettings {
  constructor(private readonly dot: DotService) {}

  async read(): Promise<string> {
    const memory = await this.dot.memoryView()
    const locks = this.dot.store.settings.locks ?? {}
    const fields = SETTING_FIELDS.map(field => `${field}${locks[field] ? ' [locked by the human]' : ''}: ${textOf(valueOf(this.dot.store.settings, field, memory.text))}`)
    const pending = this.dot.store.settingProposals.map(proposal => `${proposal.id} · ${proposal.field}: ${proposal.reason}`).join('\n')
    return `${fields.join('\n')}\n\nOnly propose an unlocked field with dot_propose_settings; the human must approve it. Locks and homeDir are human-only.${pending ? `\n\nWaiting proposals:\n${pending}` : ''}`
  }

  async propose(input: { field: string; value: unknown; reason: string }): Promise<string> {
    return this.dot.serialSettings(() => this.proposeNow(input))
  }

  private async proposeNow(input: { field: string; value: unknown; reason: string }): Promise<string> {
    const field = lockedField(this.dot.store.settings, input.field)!
    if (!input.reason.trim()) throw new DotError('dot/invalid', 'reason must explain why the change helps')
    const memory = await this.dot.memoryView()
    const before = valueOf(this.dot.store.settings, field, field === 'memory' ? normalizeMemory(memory.text) : memory.text)
    const patch = field === 'memory' ? {} : { [field]: input.value }
    if (field !== 'memory') patchSettings(this.dot.store.settings, patch)
    if (field === 'memory' && input.value !== null && typeof input.value !== 'string') throw new DotError('dot/invalid', 'memory must be text or null')
    const memoryText = field === 'memory' && typeof input.value === 'string' ? normalizeMemory(input.value) : input.value
    if (field === 'memory' && typeof memoryText === 'string' && memoryText.length > MEMORY_MAX_CHARS) throw new DotError('dot/invalid', `the notes are at most ${MEMORY_MAX_CHARS} characters`)
    const after = field === 'memory' ? memoryText || null : valueOf(patchSettings(this.dot.store.settings, patch), field, '')
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
    const memory = await this.dot.memoryView()
    if (!allow) {
      await this.dot.store.deleteSettingProposal(id)
      return `Declined ${id}; no settings changed.`
    }
    const current = valueOf(this.dot.store.settings, field, field === 'memory' ? normalizeMemory(memory.text) : memory.text)
    if (!equal(current, proposal.before)) throw new DotError('dot/proposal-stale', `${field} changed after this proposal. Decline it and ask Dorothy to propose the change again from the current value.`)
    try {
      if (field === 'memory') {
        await this.dot.setMemory(proposal.after === null ? '' : String(proposal.after), 'dot-approved')
        const segment = this.dot.store.segment
        if (segment) await this.dot.store.noteMemorySeen(memorySection(normalizeMemory(String(proposal.after ?? ''))))
      }
      else await this.dot.store.setSettings(patchSettings(this.dot.store.settings, { [field]: proposal.after }))
    } catch (error) {
      throw new DotError('dot/proposal-failed', messageOf(error))
    }
    await this.dot.store.deleteSettingProposal(id)
    await this.dot.settingsChanged()
    return `Approved ${id}; ${field} is now ${textOf(valueOf(this.dot.store.settings, field, (await this.dot.memoryView()).text))}.`
  }
}
