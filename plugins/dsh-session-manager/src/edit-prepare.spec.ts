import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { prepareEdit } from './edit-prepare.ts'

function event(seq: number, type: string, data: Record<string, unknown>): SessionEvent {
  return { seq, time: seq, type, data, surfaceOp: 'append' } as never
}

function user(seq: number, text: string, blocks?: Record<string, unknown>[]): SessionEvent {
  return event(seq, 'user/message', {
    id: `u-${seq}`,
    role: 'user',
    source: { kind: 'user' },
    content: blocks ?? [{ type: 'text', text }],
  })
}

function query(events: SessionEvent[], branched = false) {
  const dispose = vi.fn()
  return {
    dispose,
    engine: {
      observeSession: async () => ({
        header: { id: 's', createdAt: 0, isSeeded: false, version: 5 },
        events,
        ...branched ? { branchRevision: 1 } : {},
        [Symbol.dispose]: dispose,
      }),
    } as never,
  }
}

const signal = new AbortController().signal

describe('edit preparation', () => {
  it('reports the selected prompt and the modifications recorded after it', async () => {
    const fixture = query([
      event(0, 'session/title', { title: 'test' }),
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'workspace/changes', { turn: 1 }),
      user(3, 'steering after work'),
      event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    await expect(prepareEdit(fixture.engine, { sessionId: 's', promptSeq: 3 }, signal)).resolves.toMatchObject({
      promptSeq: 3, text: 'steering after work', modified: false,
    })
  })

  it('selects the first human prompt and later changes', async () => {
    const fixture = query([
      event(0, 'turn/start', { turn: 1 }),
      event(1, 'request/header', { header: { config: { provider: 'p', model: 'm', reasoningEffort: 'high' } } }),
      user(2, 'original'),
      event(3, 'workspace/changes', { turn: 1 }),
      event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    await expect(prepareEdit(fixture.engine, { sessionId: 's', promptSeq: 2 }, signal)).resolves.toEqual({
      sessionId: 's', promptSeq: 2, text: 'original', modified: true,
    })
    expect(fixture.dispose).toHaveBeenCalledOnce()
  })

  it('selects the exact prompt in a multi-input turn and reports no later changes', async () => {
    const fixture = query([
      event(0, 'turn/start', { turn: 1 }),
      user(1, 'first', [{ type: 'text', text: 'fir' }, { type: 'text', text: 'st' }]),
      user(2, 'steering'),
      event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(4, 'turn/start', { turn: 2 }),
      user(5, 'next turn'),
      event(6, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ])
    await expect(prepareEdit(fixture.engine, { sessionId: 's', promptSeq: 2 }, signal)).resolves.toMatchObject({
      promptSeq: 2, text: 'steering', modified: false,
    })
  })

  it('keeps ordered text and image references, including an image-only prompt', async () => {
    const fixture = query([
      event(0, 'turn/start', { turn: 1 }),
      user(1, '', [{ type: 'image', attachment: { attachmentId: 'image-a' } }]),
      user(2, '', [{ type: 'text', text: 'look' }, { type: 'image', attachment: { attachmentId: 'image-b' } }, { type: 'text', text: 'here' }]),
      event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    await expect(prepareEdit(fixture.engine, { sessionId: 's', promptSeq: 1 }, signal)).resolves.toMatchObject({
      text: '', content: [{ type: 'image', attachmentId: 'image-a' }],
    })
    await expect(prepareEdit(fixture.engine, { sessionId: 's', promptSeq: 2 }, signal)).resolves.toMatchObject({
      text: 'lookhere', content: [{ type: 'text', text: 'look' }, { type: 'image', attachmentId: 'image-b' }, { type: 'text', text: 'here' }],
    })
  })

  it('keeps file attachments and rejects missing human prompts or an unknown active branch', async () => {
    const attachments = query([
      event(0, 'turn/start', { turn: 1 }),
      user(1, 'file prompt', [{ type: 'file', attachment: { attachmentId: 'a', name: 'notes.txt', bytes: 4 } }]),
      event(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    await expect(prepareEdit(attachments.engine, { sessionId: 's', promptSeq: 1 }, signal)).resolves.toMatchObject({ content: [{ type: 'file', attachmentId: 'a', name: 'notes.txt', bytes: 4 }] })
    const noPrompt = query([event(0, 'turn/start', { turn: 1 }), event(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } })])
    await expect(prepareEdit(noPrompt.engine, { sessionId: 's', promptSeq: 1 }, signal)).rejects.toMatchObject({ code: 'session-manager/unavailable' })
    const branched = query([event(0, 'turn/start', { turn: 1 }), user(1, 'old')], true)
    await expect(prepareEdit(branched.engine, { sessionId: 's', promptSeq: 1 }, signal)).rejects.toMatchObject({ code: 'session-manager/unavailable' })
  })
})
