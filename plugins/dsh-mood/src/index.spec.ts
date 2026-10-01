import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply, inject } from './index.ts'
import { createRequirementsTool } from './tools.ts'
import { draft, fixture, signal } from './testing.ts'

describe('native tool and host wiring', () => {
  it('binds to the actual invoking session and refuses model/session overrides', async () => {
    const f = fixture(), tool = createRequirementsTool(f.service)
    const exec = { agent: { session: { id: 's1' } }, signal: signal() } as ToolRunContext
    expect(await tool.execute({ action: 'read' }, exec)).toMatchObject({ sourceVersion: 'u1', revision: 0 })
    expect(await tool.execute(draft(), exec)).toMatchObject({ revision: 1 })
    expect(f.service.getContract('s2')).toBeUndefined()
    await expect(tool.execute({ action: 'read', sessionId: 's2' }, exec)).rejects.toMatchObject({ code: 'MOOD_INVALID' })
    await expect(tool.execute({ ...draft('other', 1), model: 'other' }, exec)).rejects.toMatchObject({ code: 'MOOD_INVALID' })
    await expect(tool.execute({ action: 'read' }, { signal: signal() } as ToolRunContext)).rejects.toMatchObject({ code: 'MOOD_SESSION_NOT_FOUND' })
    const controller = new AbortController(); controller.abort()
    await expect(tool.execute(draft('cancelled', 1), { ...exec, signal: controller.signal })).rejects.toThrow()
    expect(f.writes()).toBe(1)
  })

  it('loads in a host without LLM, UI, questions or Web and unregisters on disposal', async () => {
    expect([...inject]).toEqual(['storageDomain', 'sessions', 'tools'])
    const f = fixture(), cleanups: Array<() => unknown> = [], registered: ToolDefinition[] = []
    let provided: unknown, closed = false
    const ctx = {
      storageDomain: { open: async () => ({ table: () => ({ get: () => f.disk(), put: async () => {}, delete: async () => false, entries: function* () {} }), close: async () => { closed = true } }) },
      sessions: { get: (id: string) => f.events[id] ? { snapshotEvents: () => f.events[id] } : undefined },
      tools: { register: (tool: ToolDefinition) => { registered.push(tool); return () => { registered.splice(registered.indexOf(tool), 1) } } },
      provide: (_name: string, service: unknown) => { provided = service },
      effect: (run: () => (() => unknown)) => { cleanups.push(run()) },
      inject: () => {},
    }
    await apply(ctx as unknown as Context)
    expect(registered.map(t => t.name)).toEqual(['mood_requirements'])
    expect(provided).toBeTruthy()
    for (const cleanup of cleanups.reverse()) await cleanup()
    expect(registered).toEqual([])
    expect(closed).toBe(true)
  })
})
