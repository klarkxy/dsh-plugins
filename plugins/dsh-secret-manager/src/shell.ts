/**
 * Injection into the model's own shell calls.
 *
 * `ctx.shellEnv` rebuilds a trusted `DSH_*` namespace per execution: the shell
 * executor discards inherited `DSH_*` values and merges this registry's current
 * snapshot, so `process.env` is untouched and a child agent cannot inherit a
 * parent's value through the process environment. The resolver is synchronous
 * by contract, which is why the stored values are cached: a cache miss returns
 * nothing (fail closed) and never blocks or awaits.
 *
 * Declared keys are static per registration, so a change to the stored slot set
 * re-registers the contributor. The resolver only ever returns the value for the
 * exact session that approved it, and never for a child thread.
 */
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Redactor } from './redact.ts'

/** The slice of `ctx.shellEnv` this plugin uses. */
export interface ShellEnvRegistryLike {
  register(contributor: {
    name: string
    variables: Record<string, { description: string }>
    resolve(execution: ToolExecution): Readonly<Partial<Record<string, string>>>
  }): () => void
}

export interface ShellBridgeOptions {
  registry: ShellEnvRegistryLike
  /**
   * Values for one execution. Must be synchronous and return only keys the
   * bridge declared; an empty map means "not authorized for this execution".
   */
  valuesFor(execution: ToolExecution): Record<string, string>
  redactor: Redactor
  warn?(event: string, message: string, detail?: Record<string, unknown>): void
}

const CONTRIBUTOR = 'secret-manager'

export class ShellBridge {
  private disposer: (() => void) | undefined
  private declaredKey = ''

  private readonly options: ShellBridgeOptions

  constructor(options: ShellBridgeOptions) {
    this.options = options
  }

  /** Re-register when the set of injectable slots changed; a no-op otherwise. */
  sync(envKeys: readonly string[]): void {
    const unique = [...new Set(envKeys)].sort()
    const signature = unique.join('\u0000')
    if (signature === this.declaredKey && this.disposer) return
    this.dispose()
    const variables: Record<string, { description: string }> = {}
    for (const key of unique) {
      variables[key] = { description: `Secret managed by the secret manager (${key}).` }
    }
    try {
      this.disposer = this.options.registry.register({
        name: CONTRIBUTOR,
        variables,
        resolve: (execution) => this.resolve(execution),
      })
      this.declaredKey = signature
    } catch (error) {
      // Duplicate ownership or an undeclared key fails loudly in the registry;
      // the plugin keeps working without injection rather than failing to load.
      this.disposer = undefined
      this.declaredKey = ''
      this.options.warn?.('shell.register-failed', 'Shell environment contributor registration failed.', {
        reason: error instanceof Error ? error.name : 'unknown',
      })
    }
  }

  dispose(): void {
    const disposer = this.disposer
    this.disposer = undefined
    this.declaredKey = ''
    try { disposer?.() } catch { /* already disposed */ }
  }

  private resolve(execution: ToolExecution): Record<string, string> {
    let values: Record<string, string>
    try {
      values = this.options.valuesFor(execution)
    } catch (error) {
      this.options.warn?.('shell.resolve-failed', 'Shell environment resolution failed.', {
        reason: error instanceof Error ? error.name : 'unknown',
      })
      return {}
    }
    if (values && typeof execution.callId === 'string') {
      // The execution keeps its own snapshot, so a later revocation cannot
      // retroactively un-mask this call's own output.
      this.options.redactor.record(execution.callId, Object.values(values))
    }
    return values
  }
}
