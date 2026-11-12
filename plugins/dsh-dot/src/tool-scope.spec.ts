import { describe, expect, it } from 'vitest'
import { TOOL } from './contracts.ts'
import { restrictInheritedTools } from './tool-scope.ts'

/** Model the public registry contract, including synchronous change notifications. */
function scope(initial: string[]) {
  const global = new Set(initial)
  const filters = new Set<{ deny: readonly string[] }>()
  const calls: Array<{ deny: readonly string[] }> = []
  const listeners = new Set<() => void>()
  const cleanups: Array<() => void> = []
  let depth = 0
  const notify = () => {
    if (++depth > 5) throw new Error('recursive restriction update')
    try { for (const listener of listeners) listener() } finally { depth-- }
  }
  const ctx = {
    tools: {
      schemas: () => [...global].map(name => ({ name })),
      restrict(filter: { deny: readonly string[] }) {
        expect(Object.keys(filter)).toEqual(['deny'])
        expect(filter.deny.length).toBeGreaterThan(0)
        expect(filter.deny.every(name => global.has(name))).toBe(true)
        calls.push(filter)
        filters.add(filter)
        notify()
        return () => { filters.delete(filter); notify() }
      },
    },
    on(_event: string, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    effect(start: () => (() => void)) { cleanups.push(start()) },
  }
  return {
    ctx, calls, global,
    add(name: string) { global.add(name); notify() },
    remove(name: string) { global.delete(name); notify() },
    visible: () => [...global].filter(name => ![...filters].some(filter => filter.deny.includes(name))),
    dispose: () => cleanups.forEach(cleanup => cleanup()),
    listenerCount: () => listeners.size,
  }
}

describe('dot preset tool restrictions', () => {
  it('denies existing host and external tools, preserving only the exact public names', () => {
    const allowed = [...Object.values(TOOL), 'show_view']
    const s = scope([...allowed, 'read', 'pwsh', 'working_directory', 'mcp_external', 'dot_not_a_real_tool'])
    restrictInheritedTools(s.ctx as never, allowed)
    expect(s.visible().sort()).toEqual([...allowed].sort())
    expect(s.global.has('pwsh')).toBe(true) // unrelated scopes still inherit it
    expect(s.calls).toHaveLength(1)
  })

  it('blocks late MCP and plugin tools without recursion or replacing earlier filters', () => {
    const s = scope(['pwsh', 'show_view'])
    restrictInheritedTools(s.ctx as never, ['show_view'])
    s.add('mcp_late')
    s.add('plugin_late')
    s.add('plugin_late')
    expect(s.calls.map(filter => filter.deny)).toEqual([['pwsh'], ['mcp_late'], ['plugin_late']])
    expect(s.visible()).toEqual(['show_view'])
    s.remove('mcp_late')
    s.add('mcp_late')
    expect(s.visible()).toEqual(['show_view'])
    expect(s.calls).toHaveLength(3)
  })

  it('handles an initially empty registry and restores filters on scoped disposal', () => {
    const s = scope([])
    restrictInheritedTools(s.ctx as never, ['show_view'])
    expect(s.calls).toHaveLength(0)
    s.add('read')
    expect(s.visible()).toEqual([])
    s.dispose()
    expect(s.listenerCount()).toBe(0)
    expect(s.visible()).toEqual(['read'])
    s.add('later')
    expect(s.calls).toHaveLength(1)
  })

  it('gives reflection no inherited public mutation tools', () => {
    const s = scope([...Object.values(TOOL), 'show_view', 'dot_reflection_submit'])
    restrictInheritedTools(s.ctx as never, [TOOL.searchHistory, TOOL.readHistory, 'dot_reflection_submit'])
    expect(s.visible().sort()).toEqual([TOOL.searchHistory, TOOL.readHistory, 'dot_reflection_submit'].sort())
    expect(s.visible()).not.toContain(TOOL.agreement)
  })
})
