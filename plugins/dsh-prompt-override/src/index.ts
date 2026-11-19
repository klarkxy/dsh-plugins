import type { Context } from '@deepseek-ai/cordis'
import type { PromptPresentation } from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { installPluginLogger } from '@klarkxy/dsh-plugin-kit/logger'
import { PLUGIN_NAME } from './contracts.ts'
import { readOverrides, type Overrides } from './overrides.ts'
import { rewriteSections, type DevContextMode, type RewriteSettings } from './rewrite.ts'

export const name = PLUGIN_NAME
export const inject = ['systemPrompt'] as const

/** Profile-level switches; the local overrides file wins over these. */
export interface Config {
  core?: boolean
  tools?: boolean
  devContext?: DevContextMode
}

export const Config: z<Config> = z.object({
  core: z.boolean().default(true),
  tools: z.boolean().default(true),
  devContext: z.union(['auto', 'keep', 'drop']).default('auto'),
})

/** Merge profile config with local overrides. */
export function resolveSettings(config: Config, overrides: Overrides): RewriteSettings {
  return {
    core: overrides.core ?? config.core ?? true,
    tools: overrides.tools ?? config.tools ?? true,
    devContext: overrides.devContext ?? config.devContext ?? 'auto',
    sections: overrides.sections ?? {},
    ...overrides.coreText !== undefined ? { coreText: overrides.coreText } : {},
  }
}

/**
 * Rewrite every system-prompt assembly in the process.
 *
 * The listener is registered without a scope subject, so it sees top-level
 * agents, subagents and auxiliary assemblies alike. That is intended: the
 * rewrite only changes prompt text and never tool visibility or permissions.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // A broken overrides file stops the plugin here: this plugin rewrites every
  // session's prompt, so running on hidden built-in defaults would silently
  // ignore the user's configuration.
  const read = readOverrides()
  const settings = resolveSettings(config, read.overrides)
  const logger = installPluginLogger(ctx, PLUGIN_NAME, {
    forwardHostWarnError: false,
    loadedContext: {
      core: settings.core,
      tools: settings.tools,
      devContext: settings.devContext,
      sectionOverrides: Object.keys(settings.sections).length,
      customCore: settings.coreText !== undefined,
    },
  })
  if (read.ignored.length > 0) logger.warn('overrides.invalid-fields', 'Invalid override fields ignored.', undefined, { fields: read.ignored.join(', ') })

  ctx.effect(() => ctx.on('system-prompt/assemble', async (assembly: PromptPresentation, context: unknown, next) => {
    const original = await next()
    try {
      // The assembly context's `agent` is host-provided and not part of the
      // public AssembleContext type; read it defensively.
      const agent = (context as { agent?: unknown } | undefined)?.agent
      return rewriteSections(original, settings, agent)
    } catch (error) {
      // A rewrite bug must never take the session's prompt down.
      logger.error('rewrite.failed', 'Prompt rewrite failed; native prompt kept.', error)
      return original
    }
  }), 'prompt-override.assemble')
}
