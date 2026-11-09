/**
 * Effort preference — a small client-side memory for explicit reasoning-effort
 * picks, keyed by provider+model route.
 *
 * Why it exists: the Host already persists the complete default selection —
 * `sessionController.selectModel` records the Session selection and calls
 * `ctx.agentDefaultModel.saveSelection(selected)` in the background, and the
 * `agentDefaultModel` Config carries `provider`, `model` and an optional
 * `reasoningEffort` field. A Session with no recorded selection follows that
 * saved default through live `AgentOptions` accessors
 * (`dsh-api-session-controller/agent.js` `agentOptions()`), so a new Session
 * inherits the effort only while the default keeps it.
 *
 * The gap is a model switch: the picker's pick submits provider+model only
 * (native semantics — the adapter resolves its own default effort), which
 * makes `saveSelection` write a config WITHOUT `reasoningEffort`; the default
 * effort is erased and the next new Session loses it. Remembering the last
 * successful explicit effort per route and re-attaching it to later model
 * picks restores "new Session inherits the last human setting" without
 * touching Host code, Host events, or existing Sessions — the memory only
 * shapes what THIS surface submits.
 *
 * Rules (matching the Host contract):
 * - Only successful explicit picks are remembered. A failed `select` must
 *   never update memory — nothing was recorded or saved.
 * - Choosing "Default" (effort `undefined`) clears the route's entry; the
 *   model then follows the adapter default, never a forced prior pick.
 * - A remembered effort is re-applied only when the catalog declares it for
 *   that exact route: a model that advertises no `efforts` never receives an
 *   explicit effort, so "不支援 High 的模型不會收到 High".
 * - No persistence to disk and no Host calls: the memory lasts for the page
 *   lifetime; across reloads the Host's own saved default already carries
 *   the effort forward.
 * - Reads never mutate; this module never triggers an LLM call and never
 *   touches subagent model choices.
 */

/** One selectable route. */
export interface EffortRoute {
  provider: string
  model: string
}

/** A selection request: the same shape `directory.select` accepts. */
export interface EffortSelection extends EffortRoute {
  reasoningEffort?: string
}

/** The subset of catalog metadata the memory validates against. */
export interface RouteReasoning {
  /** Effort ids the model declares (`model.reasoning.efforts[].id`). */
  efforts?: readonly string[]
}

/** Normalized select result: `{ ok: true }` or `{ ok: false }`. */
export type SelectResult = { ok: boolean; error?: unknown } | undefined

type SelectFn = (selection: EffortSelection) => Promise<SelectResult> | SelectResult

const keyOf = (route: EffortRoute): string => JSON.stringify([route.provider, route.model])

/**
 * In-memory per-route effort memory. One instance is shared by the composer
 * seat and any face that submits through `submit`, so a slider pick made in
 * one surface is what the next model pick re-attaches.
 */
export class EffortPreference {
  /** route key → remembered explicit effort (a cleared route has no entry). */
  private readonly efforts = new Map<string, string>()

  /** The remembered explicit effort for one route, or undefined. */
  effortFor(route: EffortRoute): string | undefined {
    return this.efforts.get(keyOf(route))
  }

  /**
   * Record one confirmed pick. `undefined` clears the route's entry —
   * "Default" is an explicit choice too, and must not be overridden later.
   * Callers invoke this only after the Host accepted the selection.
   */
  remember(route: EffortRoute, effort: string | undefined): void {
    const key = keyOf(route)
    if (effort === undefined) this.efforts.delete(key)
    else this.efforts.set(key, effort)
  }

  /**
   * Effort to attach to a fresh pick of `route`: the remembered value when
   * the catalog still declares it for that route, else undefined (the pick
   * then follows the adapter default). Validation is per-route — a model
   * without declared efforts can never inherit an effort remembered for it.
   */
  resolve(route: EffortRoute, reasoning: RouteReasoning | undefined): string | undefined {
    const effort = this.efforts.get(keyOf(route))
    if (effort === undefined) return undefined
    return reasoning?.efforts?.includes(effort) ? effort : undefined
  }

  /**
   * Submit helper for a MODEL pick: merge the remembered effort into
   * `selection` when no effort is already present and the target route still
   * supports it, call `select`, and remember the resolved effort only on
   * success. On failure memory is untouched and the result is returned
   * verbatim.
   *
   * This is NOT the right verb for the slider's "Default" row: a caller
   * clearing an effort must submit through `select` directly and call
   * `remember(route, undefined)` only after success — routing the clear
   * through `submit` would just re-attach the remembered effort.
   */
  async submit(
    selection: EffortSelection,
    reasoning: RouteReasoning | undefined,
    select: SelectFn,
  ): Promise<SelectResult> {
    const effort = selection.reasoningEffort ?? this.resolve(selection, reasoning)
    const intent: EffortSelection = effort === undefined ? { provider: selection.provider, model: selection.model } : { ...selection, reasoningEffort: effort }
    const result = await select(intent)
    /* Only a confirmed `ok: true` updates memory. `undefined` is NOT success:
     * the seat's fallback select resolves undefined for an unavailable
     * directory, and recording a pick the Host never saw would invent a
     * preference. */
    if (result?.ok !== true) return result
    this.remember(intent, intent.reasoningEffort)
    return result
  }
}
