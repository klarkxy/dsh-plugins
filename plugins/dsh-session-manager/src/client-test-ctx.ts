/**
 * Test wiring for the shared settings-page contract: the kit's
 * registerSessionSettingsItem resolves a rendezvous service through
 * `ctx.root.get`/`ctx.root.provide`, so every client apply() stub needs a
 * cordis-shaped root. The provided services map keeps provide() visible to a
 * later get() and unprovides on release, matching the real lifecycle.
 */
export function wireSharedSettingsRoot(ctx: Record<string, any>): Record<string, any> {
  const services = new Map<string, unknown>()
  ctx.root = ctx.root ?? ctx
  ctx.get ??= (name: string) => (services.has(name) ? services.get(name) : ctx[name])
  ctx.provide ??= (name: string, value: unknown) => {
    services.set(name, value)
    return () => { if (services.get(name) === value) services.delete(name) }
  }
  ctx.set ??= (name: string, value: unknown) => { services.set(name, value) }
  return ctx
}
