import { describe, expect, it, vi } from 'vitest'
import { apply, inject, readToolCall } from './client.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: Record<string, unknown>) => <button {...props} />,
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
  it('reads the persisted presentationMeta (including synchronous ask_view answer) from a settled result block', () => {
    const read = readToolCall({ phase: 'result', block: {
      callId: 'call-1', kind: 'tool-result', meta: {
        owner: 'dsh-deep-view',
        viewId: 'view-1',
        title: 'Choose',
        view: interactiveView,
        interactive: true,
        awaitReply: true,
        revision: 1,
        answer: { id: 'view-1', action: 'pick', values: { selected: ['Two'] }, revision: 1 },
      },
    } })
    expect(read.presentation).toMatchObject({
      owner: 'dsh-deep-view',
      viewId: 'view-1',
      interactive: true,
      awaitReply: true,
      answer: { id: 'view-1', action: 'pick', values: { selected: ['Two'] }, revision: 1 },
    })
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
  it('registers live tool cards (show_view, ask_view, show_canvas), an activity dock and the settled-reply surface', () => {
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
    expect(slots).toEqual(['tool.call.toolview', 'tool.call.toolview', 'tool.call.toolview', 'conversation.chat.markdown.fence', 'conversation.chat.markdown.fence', 'conversation.input.dock', 'conversation.chat.turnTail'])
    expect(registrations[0]).toMatchObject({ name: 'tool.call.toolview', key: 'show_view', locale: 'deep-view' })
    expect(registrations[1]).toMatchObject({ name: 'tool.call.toolview', key: 'ask_view', locale: 'deep-view' })
    expect(registrations[2]).toMatchObject({ name: 'tool.call.toolview', key: 'show_canvas', locale: 'deep-view' })
    expect(registrations[3]).toMatchObject({ name: 'conversation.chat.markdown.fence', id: 'deep-view', key: 'deepui', locale: 'deep-view' })
    expect(registrations[4]).toMatchObject({ name: 'conversation.chat.markdown.fence', id: 'deep-view', key: 'deep-view', locale: 'deep-view' })
    expect(registrations[5]).toMatchObject({ name: 'conversation.input.dock', id: 'deep-view', locale: 'deep-view' })
    expect(registrations[6]).toMatchObject({ name: 'conversation.chat.turnTail', id: 'deep-view', locale: 'deep-view' })
    // Plugin-drawn chats read the same card through this client service.
    expect(provided).toEqual(['dshDeepView'])
  })
})
