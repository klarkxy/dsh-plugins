import { describe, expect, it, vi } from 'vitest'
import { apply, inject, readToolCall } from './client.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  MarkdownText: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
  JsonBlock: ({ payload, label }: { payload: unknown; label: string }) => <pre data-json={label}>{JSON.stringify(payload)}</pre>,
}))
const argsView = (fields: Record<string, unknown>) => ({
  has: (key: string) => key in fields,
  complete: (key: string) => key in fields,
  text: (key: string) => typeof fields[key] === 'string' ? fields[key] as string : undefined,
  value: (key: string) => fields[key] !== undefined && typeof fields[key] !== 'string' ? fields[key] : undefined,
})
const interactiveView = { type: 'options', id: 'pick', options: [{ label: 'One' }, { label: 'Two' }] }
describe('tool.call.toolview contract', () => {
  it('reads the persisted presentationMeta from a settled result block', () => {
    const read = readToolCall({ phase: 'result', block: {
      callId: 'call-1', kind: 'tool-result', meta: { owner: 'dsh-deep-view', viewId: 'view-1', title: 'Choose', view: interactiveView, interactive: true, awaitReply: true },
    } })
    expect(read.presentation).toMatchObject({ owner: 'dsh-deep-view', viewId: 'view-1', interactive: true, awaitReply: true })
    expect(read.isError).toBe(false)
  })
  it('rejects foreign or malformed meta and result errors', () => {
    const foreign = readToolCall({ phase: 'result', block: { callId: 'c', kind: 'tool-result', meta: { owner: 'other' } } })
    expect(foreign.presentation).toBeUndefined()
    const broken = readToolCall({ phase: 'result', block: { callId: 'c', kind: 'tool-result', meta: { owner: 'dsh-deep-view', view: { type: 'nope' } } } })
    expect(broken.isError).toBe(true)
    expect(readToolCall({ phase: 'result', block: { callId: 'c', kind: 'tool-result', isError: true } }).isError).toBe(true)
  })
  it('waits for a view field still streaming during preparing', () => {
    const open = argsView({ title: 'Pick' })
    expect(readToolCall({ phase: 'preparing', block: { callId: 'c', args: { ...open, complete: () => false } } }).viewReady).toBe(false)
    expect(readToolCall({ phase: 'start', block: { callId: 'c', args: argsView({ title: 'Pick', view: interactiveView }) } }).view).toEqual(interactiveView)
  })
  it('registers compact tool status and a separate final-reply surface', () => {
    const registrations: Record<string, unknown>[] = []
    const slots: string[] = []
    const provided: string[] = []
    const ctx = {
      effect(run: () => unknown) { run() },
      provide(name: string) { provided.push(name) },
      slots: { inject(key: string, fn: () => unknown) { slots.push(key); fn(); return () => {} }, register(spec: Record<string, unknown>) { registrations.push(spec); return () => {} } },
      locale: { register: () => () => {} }, connection: { rpc: { call: async () => ({ ok: true, value: null }) } },
    }
    apply(ctx as never)
    expect([...inject]).toEqual(['slots', 'connection', 'locale'])
    expect(slots).toEqual(['tool.call.toolview', 'conversation.chat.turnTail'])
    expect(registrations[1]).toMatchObject({ name: 'conversation.chat.turnTail', id: 'deep-view', locale: 'deep-view' })
    expect(registrations[0]).toMatchObject({ name: 'tool.call.toolview', key: 'show_view', locale: 'deep-view' })
    // Plugin-drawn chats read the same card through this client service.
    expect(provided).toEqual(['dshDeepView'])
  })
})
