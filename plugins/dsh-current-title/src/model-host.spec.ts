import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveFeatureModel } from '@klarkxy/dsh-plugin-kit'
import { inject as titleInject } from './index.ts'
import { inject as commitInject } from '../../dsh-git-commit/src/index.ts'

describe('feature model service injection', () => {
  it.each([['title', titleInject], ['commit', commitInject]] as const)(
    '%s resolves pending, recorded and default selections on its declared Cordis services',
    async (name, inject) => {
      const root = new Context()
      const pendingRoute = { provider: 'pending', model: 'pending-model', reasoningEffort: 'high' }
      const recordedRoute = { provider: 'recorded', model: 'recorded-model', reasoningEffort: 'low' }
      const defaultRoute = { provider: 'default', model: 'default-model' }
      let pending: typeof pendingRoute | undefined = pendingRoute
      let defaults = false
      let live = true
      try {
        // A sibling provider enforces Cordis injection; root.provide or a plain
        // object would let undeclared service reads pass unnoticed.
        await root.plugin({ name: 'model-services', apply(ctx: Context) {
          const provide = ctx.provide.bind(ctx) as (name: string, value: unknown) => void
          provide('agents', { get: () => live ? { session: {
            requestHeader: () => ({ config: recordedRoute, adapterDefaults: { reasoningEffort: defaults } }),
          } } : undefined })
          provide('sessionProjections', { stateOf: () => ({ pending }) })
          provide('agentDefaultModel', { currentSelection: () => defaultRoute })
          for (const key of new Set([...titleInject, ...commitInject])) {
            if (!['agents', 'sessionProjections', 'agentDefaultModel'].includes(key)) provide(key, {})
          }
        } })
        let host: Context | undefined
        await root.plugin({ name, inject: [...inject], apply(ctx: Context) { host = ctx } })
        expect(host).toBeDefined()
        expect(resolveFeatureModel(host, undefined, 's')).toEqual(pendingRoute)
        pending = undefined
        expect(resolveFeatureModel(host, undefined, 's')).toEqual(recordedRoute)
        defaults = true
        expect(resolveFeatureModel(host, undefined, 's')).toEqual({ provider: 'recorded', model: 'recorded-model' })
        live = false
        expect(resolveFeatureModel(host, undefined, 's')).toEqual(defaultRoute)
        expect(resolveFeatureModel(host, undefined)).toEqual(defaultRoute)
        expect(resolveFeatureModel(host, { provider: 'page', model: 'page-model' }, 's')).toEqual({ provider: 'page', model: 'page-model' })
      } finally {
        await root.fiber.dispose()
      }
    },
  )
})
