/** Preset scopes support deny-only restrictions; refresh them as global tools arrive. */
import type { Context } from '@deepseek-ai/cordis'

interface ToolScope {
  tools: {
    /** No scope argument deliberately reads the deployment-global registry. */
    schemas(): readonly { readonly name: string }[]
    restrict(filter: { deny: readonly string[] }): () => void
  }
  on(event: 'tools/change', listener: () => void): () => void
  effect(start: () => (() => void)): unknown
}

/**
 * Keep inherited tools out of this preset using only the host's public API.
 * Scoped registrations are exempt from restrictions; unrelated sessions retain
 * their global tools. Each new name adds one restriction, without lifting any
 * earlier filter while a model request could be assembled.
 */
export function restrictInheritedTools(ctx: Context, allowedNames: readonly string[]): void {
  const host = ctx as unknown as ToolScope
  const allowed = new Set(allowedNames)
  ctx.effect(() => {
    const denied = new Set<string>()
    const releases: Array<() => void> = []
    const refresh = () => {
      const names = host.tools.schemas().map(tool => tool.name).filter(name => !allowed.has(name) && !denied.has(name))
      if (names.length === 0) return
      // restrict emits tools/change synchronously. Claim the names first so our
      // own notification cannot recursively install the same restriction.
      for (const name of names) denied.add(name)
      try { releases.push(host.tools.restrict({ deny: names })) } catch (error) {
        for (const name of names) denied.delete(name)
        throw error
      }
    }
    refresh()
    const stop = host.on('tools/change', refresh)
    return () => {
      stop()
      for (const release of releases.reverse()) release()
    }
  })
}
