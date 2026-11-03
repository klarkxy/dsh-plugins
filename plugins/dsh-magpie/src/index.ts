/**
 * dsh-magpie — connect this profile to a magpie gateway.
 *
 * Host half: fetches the gateway's model listing and writes the same three
 * llm-pi-ai provider routes `magpie dsh` writes (`magpie`,
 * `magpie-responses`, `magpie-anthropic`), plus the default model and web
 * search selection, through `ctx.settings.mutate` — the official profile-patch
 * path. The gateway key lives in the credential store under the same
 * `MAGPIE_GATEWAY_KEY` reference magpie uses, so either tool can replace the
 * other. Syncs are serialized; one runs on the button and once at startup
 * after the Loader has settled.
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { registerHostRpc, type HostRpcContext } from '@klarkxy/dsh-plugin-kit/host-rpc'
import { createMagpieService, type CredentialsLike } from './service.ts'
import type { SettingsDescriptorLike } from './plan.ts'
import {
  DEFAULT_ADDRESS, DEFAULT_KEY_REF, PLUGIN_NAME, PLUGIN_VERSION, RPC_CHANNEL,
  type MagpieOptions, type RpcResult,
} from './contracts.ts'

export const name = PLUGIN_NAME
export const inject = ['settings', 'loader'] as const

export const Config = Schema.object({
  /** magpie gateway root; `http://` is assumed and a trailing `/v1` is stripped. */
  address: Schema.string().default(DEFAULT_ADDRESS).volatile(),
  /** Credential reference (`env`-style name) holding the gateway key. */
  apiKeyEnv: Schema.string().role('credential-ref').default(DEFAULT_KEY_REF).volatile(),
  /** Run one sync when the profile starts. */
  syncOnStart: Schema.boolean().default(true).volatile(),
  /** magpie model id promoted to the default model; empty keeps the current one. */
  defaultModel: Schema.string().volatile(),
  /** Route the DeepSeek web-search provider through this gateway. */
  webSearch: Schema.boolean().default(false).volatile(),
  /** Web-search model; empty uses the default model. */
  webSearchModel: Schema.string().volatile(),
})

type Cell<T> = { get(): T } | T

interface ResolvedConfig {
  address: Cell<string>
  apiKeyEnv: Cell<string>
  syncOnStart: Cell<boolean>
  defaultModel: Cell<string | undefined>
  webSearch: Cell<boolean>
  webSearchModel: Cell<string | undefined>
}

type Host = Context & HostRpcContext & {
  loader: { await(): Promise<void> }
  settings: {
    describe(): unknown[]
    mutate(ns: string, ops: readonly { op: string; path: readonly string[]; value?: unknown }[], expectedRevision?: number): Promise<void>
    writable: boolean
    configure(presentation: { auto?: boolean }): () => void
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { magpie: ReturnType<typeof createMagpieService> }
}

/** Volatile Config fields surface as cells with a live `get()`. */
function cell<T>(value: Cell<T>): T {
  const get = (value as { get?: () => T })?.get
  return typeof get === 'function' ? get.call(value) : value as T
}

export function apply(ctx: Context, config: ResolvedConfig): void {
  const host = ctx as Host
  const ownNamespace = (ctx.fiber as unknown as { entry?: { options?: { id?: string } } } | undefined)?.entry?.options?.id ?? 'magpie'
  const options = (): MagpieOptions => ({
    address: (cell(config.address) || DEFAULT_ADDRESS).trim() || DEFAULT_ADDRESS,
    apiKeyEnv: (cell(config.apiKeyEnv) || DEFAULT_KEY_REF).trim() || DEFAULT_KEY_REF,
    syncOnStart: cell(config.syncOnStart) ?? true,
    defaultModel: cell(config.defaultModel) || undefined,
    webSearch: cell(config.webSearch) ?? false,
    webSearchModel: cell(config.webSearchModel) || undefined,
  })
  // The credential store is optional: headless hosts ship none; the service
  // then reads the key ref from the environment at call time.
  const credentialHolder: { current?: CredentialsLike } = {}
  const service = createMagpieService({
    describe: () => host.settings.describe() as SettingsDescriptorLike[],
    mutate: (ns, ops, revision) => host.settings.mutate(ns, ops, revision),
    writable: () => host.settings.writable,
    credentials: () => credentialHolder.current,
    ownNamespace,
    options,
    userAgent: `deepseek-harness dsh-magpie/${PLUGIN_VERSION}`,
    logger: ctx.logger,
  })
  ctx.provide('magpie', service)
  ctx.inject(['credentials'], child => {
    credentialHolder.current = (child as Context & { credentials: CredentialsLike }).credentials
    child.effect(() => () => { credentialHolder.current = undefined }, 'magpie.credentials')
  })
  ctx.effect(() => host.settings.configure({ auto: false }), 'magpie.settings-page')
  // The settings page RPC needs the optional web host; headless/ACP hosts skip it.
  ctx.inject(['connection', 'webServer'], child => {
    child.effect(() => registerHostRpc(child as Context & HostRpcContext, RPC_CHANNEL,
      (endpoint, payload, signal): Promise<RpcResult> => service.handleRpc(endpoint, payload, signal)),
    'magpie.rpc')
  })
  ctx.effect(() => {
    let settled = true
    void host.loader.await()
      .then(() => {
        if (!settled || !options().syncOnStart) return
        // One startup sync per process; failures land in status, not a crash.
        void service.sync().then(result => {
          if (result.lastError) ctx.logger.warn('magpie: startup sync failed: %s', result.lastError.message)
        })
      })
      .catch((error: unknown) => ctx.logger.warn('magpie: loader wait failed: %s', (error as Error).message))
    return () => { settled = false }
  }, 'magpie.startup-sync')
}

export { createMagpieService } from './service.ts'
export { normalizeGatewayAddress, isLoopbackHost, AddressError } from './address.ts'
export { buildRoutes, isSelectableModel, modelProtocol, endpointProtocol } from './mapping.ts'
export { planSync, planDisconnect, deepEqual } from './plan.ts'
export type { MagpieStatus, MagpieOptions, RouteModel, RpcResult, TestResult } from './contracts.ts'
