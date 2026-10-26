/** Session-authorized discovery; catalog membership never removes an allowed route. */
export const discoveryDescription = 'List every LLM route authorized for explicit subagent selection in this Session. Omit arguments for all routes, use provider to filter, or provider and model for one route. Results keep provider and model as separate exact ids, include reasoning efforts and per-provider or per-model failures, and do not test actual model calls. The allowed list is saved for this Session; later settings edits apply to new top-level Sessions. Missing catalog entries do not remove authorized routes. Supply the separate provider and model values together to a delegation tool that exposes those fields.'

const failureMessages = {
  MISSING_CREDENTIAL: 'Provider credentials are missing; configure them before delegating.',
  INVALID_CREDENTIAL: 'Provider credentials are invalid; check provider settings.',
  INVALID_CONFIG: 'Provider or model configuration is invalid; check provider settings.',
  UNKNOWN_MODEL: 'The adapter cannot resolve this model; check its configured model id.',
  NO_ADAPTER: 'This provider is not registered in the running host.',
  INVALID_CATALOG: 'The adapter returned an invalid model catalog.',
  INVALID_MODEL_INFO: 'The adapter returned invalid metadata for this model.',
  INVALID_MODEL_CONTEXT: 'The adapter returned invalid context metadata for this model.',
  INVALID_MODEL_REASONING: 'The adapter returned invalid reasoning metadata for this model.',
}

// Adapter errors can contain endpoint responses or credentials. Report stable codes,
// never arbitrary error messages or stacks, while retaining cancellation semantics.
function discoveryFailure(error, signal) {
  signal.throwIfAborted()
  if (error?.name === 'AbortError') throw error
  const code = typeof error?.code === 'string' && Object.hasOwn(failureMessages, error.code)
    ? error.code : 'DISCOVERY_FAILED'
  return { code, message: failureMessages[code] ?? 'Model discovery failed; check the provider configuration and retry.' }
}

/** Return the same string output type as the native tool, containing explicit JSON fields. */
export async function listSubagentModels(ctx, policy, request, signal) {
  signal.throwIfAborted()
  if (request.model !== undefined && request.provider === undefined) throw new Error('`model` requires `provider`')
  if (request.provider === '') throw new Error('`provider` must be non-empty')
  if (request.model === '') throw new Error('`model` must be non-empty')
  const allowed = policy.routes.filter(route => request.provider === undefined || route.provider === request.provider)
  if (request.provider !== undefined && allowed.length === 0) {
    throw new Error(`LLM provider ${JSON.stringify(request.provider)} is not allowed for this Session; call list_subagent_models without arguments for its allowed routes.`)
  }
  const routes = allowed.filter(route => request.model === undefined || route.model === request.model)
  if (request.model !== undefined && routes.length === 0) {
    throw new Error(`child LLM route provider=${JSON.stringify(request.provider)} model=${JSON.stringify(request.model)} is not allowed for this Session; call list_subagent_models with provider only for its allowed models.`)
  }
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('cannot discover child LLM routes because the `llm` service is unavailable')
  const providers = new Map(llm.listProviders().map(provider => [provider.id, provider]))
  const catalogs = new Map()
  for (const provider of new Set(routes.map(route => route.provider))) {
    signal.throwIfAborted()
    if (!providers.has(provider)) {
      catalogs.set(provider, { status: 'error', error: { code: 'NO_ADAPTER', message: failureMessages.NO_ADAPTER } })
      continue
    }
    try {
      const models = await llm.listModels(provider)
      signal.throwIfAborted()
      catalogs.set(provider, { status: 'ok', models: new Set(models.map(model => model.id)) })
    } catch (error) {
      catalogs.set(provider, { status: 'error', error: discoveryFailure(error, signal) })
    }
  }
  const models = []
  for (const route of routes) {
    signal.throwIfAborted()
    const provider = providers.get(route.provider)
    const catalog = catalogs.get(route.provider)
    const row = {
      provider: route.provider,
      model: route.model,
      providerRegistered: provider !== undefined,
      catalog: catalog.status === 'ok'
        ? { status: 'ok', advertised: catalog.models.has(route.model) }
        : { status: 'error', error: catalog.error },
    }
    if (provider === undefined) {
      models.push({ ...row, metadata: { status: 'error', error: catalog.error } })
      continue
    }
    try {
      const model = await llm.resolveModelInfo(route.provider, route.model, signal)
      signal.throwIfAborted()
      models.push({
        ...row,
        name: model.name,
        metadata: { status: 'resolved' },
        reasoningEfforts: model.reasoning?.efforts.map(effort => ({ id: effort.id, name: effort.name })) ?? [],
        ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultReasoningEffort: model.reasoning.defaultEffort }),
      })
    } catch (error) {
      models.push({ ...row, metadata: { status: 'error', error: discoveryFailure(error, signal) } })
    }
  }
  return JSON.stringify({
    scope: 'current-session',
    selection: 'explicit-provider-model',
    settingsChangesApplyTo: 'new-top-level-sessions',
    callability: 'not-tested',
    note: 'These are all authorized routes matching the request, not a live endpoint model list. Metadata resolution does not verify credentials, network access, or a successful model call. Keep provider and model separate; model ids can contain slashes.',
    models,
  }, null, 2)
}
