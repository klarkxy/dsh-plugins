import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { MODEL_CATALOG_INJECT, readModelCatalog, type ModelCatalogClient } from './catalog.ts'

// Match api-gateway's two real traced Services, not a plain-object remote mock.
// Cordis routes a traced service's namespace property through its own inject check.
class Remote extends Service {
  constructor(ctx: Context) { super(ctx, 'remote') }
}
class Session extends Service {
  constructor(ctx: Context) { super(ctx, 'remote.session') }
  async modelCatalog() { return { groups: [], failures: [] } }
}

describe('real Cordis model catalog injection', () => {
  it('rejects remote-only injection and succeeds with the shared declaration', async () => {
    const root = new Context()
    // Root-owned services are inherited without inject; production services
    // belong to sibling plugins, so preserve that ownership in the regression.
    const remoteOwner = root.plugin({ apply(ctx) { new Remote(ctx) } })
    const sessionOwner = root.plugin({ apply(ctx) { new Session(ctx) } })
    await remoteOwner
    await sessionOwner
    let missing!: Promise<unknown>
    const incomplete = root.plugin({
      inject: ['remote'],
      apply(ctx) {
        missing = readModelCatalog(ctx as unknown as ModelCatalogClient)
        // Install rejection handling before Cordis awaits activation.
        void missing.catch(() => {})
      },
    })
    await incomplete
    await expect(missing).rejects.toThrow('cannot get property "remote.session" without inject')
    let catalog!: Promise<unknown>
    const complete = root.plugin({
      inject: [...MODEL_CATALOG_INJECT],
      apply(ctx) { catalog = readModelCatalog(ctx as unknown as ModelCatalogClient) },
    })
    try {
      await complete
      await expect(catalog).resolves.toEqual({ groups: [], failures: [] })
    } finally {
      await complete.dispose()
      await incomplete.dispose()
      await root.fiber.dispose()
    }
  })
})
