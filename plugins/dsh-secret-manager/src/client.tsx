/**
 * Client half of the secret manager: registers the `request_secret` tool view
 * (the dedicated prompt window lives inside it) and the Secrets settings page.
 * Values only ever move inside the dialog's submit call — this module handles
 * nothing but references, flags and session ids.
 */
import type { Context } from '@deepseek-ai/cordis'
import { useSyncExternalStore, useCallback, type ReactNode } from 'react'
import { installClientPluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import { LOCALE, PLUGIN_ID, RPC_CHANNEL } from './contracts.ts'
import { secretClientStyles } from './client-styles.ts'
import { SecretToolView } from './client-prompt.tsx'
import { SecretManagerSettings } from './client-settings.tsx'
import { translator, uiEn, uiZh, type UiTranslate } from './ui-copy.ts'

export const name = 'dsh-secret-manager-client'
export const inject = ['slots', 'connection', 'locale', 'uiWorkspace', 'uiSession'] as const

/** Nav order between Zhihu (160) and Model Hub (180). */
const SLOT_ORDER = 170

type SlotHandle = {
  inject(key: string, callback: () => unknown): () => void
  register(spec: Record<string, unknown>, render: unknown): () => void
}

type RpcCaller = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
}

type HostLocaleService = {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
  /** Untyped register form: (namespace, locale tag, dictionary) → disposer. */
  register?(ns: string, locale: string, dict: Record<string, string>): () => void
}

type SecretClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
  locale?: HostLocaleService
  /** The workspace's own surface: primary source of the open session id. */
  uiWorkspace?: { current?: { getSnapshot(): { sessionId?: string } | undefined; subscribe(listener: () => void): () => void } }
  /** Session adapter fallback when no workspace surface exists. */
  uiSession?: { adapter: { current: { getSnapshot(): { key?: string }; subscribe(listener: () => void): () => void } } }
}

function injectStyles(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null
  const style = document.createElement('style')
  style.setAttribute('data-plugin', '@klarkxy/dsh-secret-manager')
  style.setAttribute('data-sm-styles', '')
  style.textContent = secretClientStyles
  document.head.appendChild(style)
  return style
}

/** The currently open session, from whichever surface the host exposes. */
export function useCurrentSessionId(client: Pick<SecretClientContext, 'uiWorkspace' | 'uiSession'>): string {
  const subscribe = useCallback(
    (fn: () => void) => (client.uiWorkspace?.current ?? client.uiSession?.adapter.current)?.subscribe(fn) ?? (() => {}),
    [client],
  )
  const snapshot = useCallback(
    () => client.uiWorkspace?.current?.getSnapshot()?.sessionId ?? client.uiSession?.adapter.current.getSnapshot().key ?? '',
    [client],
  )
  return useSyncExternalStore(subscribe, snapshot, () => '')
}

/** Follow the host locale; standalone renders default to Chinese. */
function useSecretLocale(service: HostLocaleService | undefined): 'zh' | 'en' {
  const subscribe = useCallback((fn: () => void) => service?.subscribe(fn) ?? (() => {}), [service])
  const snapshot = useCallback(() => service?.getSnapshot().active ?? 'zh', [service])
  const active = useSyncExternalStore(subscribe, snapshot, snapshot)
  return String(active).startsWith('zh') ? 'zh' : 'en'
}

type EndpointCall = (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>

function SettingsRoot(props: { call: EndpointCall; client: Pick<SecretClientContext, 'uiWorkspace' | 'uiSession'>; locale?: HostLocaleService }): ReactNode {
  const sessionId = useCurrentSessionId(props.client)
  const language = useSecretLocale(props.locale)
  return <SecretManagerSettings call={props.call} sessionId={sessionId} t={translator(language)} />
}

export function apply(ctx: Context): void {
  const logger = installClientPluginLogger(ctx, '@klarkxy/dsh-secret-manager')
  const client = ctx as SecretClientContext
  ctx.effect(() => {
    const style = injectStyles()
    return () => style?.remove()
  }, 'secret-manager.styles')

  let locale: HostLocaleService | undefined
  try { locale = client.locale } catch { locale = undefined }
  const localeOf = () => (String(locale?.getSnapshot?.().active ?? 'zh').startsWith('zh') ? 'zh' : 'en')

  const rpc = {
    call: async (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => {
      try {
        return await client.connection.rpc.call(channel, endpoint, payload, signal)
      } catch (error) {
        // Never forward the raw error: transport failures can echo request
        // bodies (a submit payload carries the secret). Endpoint and error
        // kind are the whole log.
        if (!signal?.aborted) logger.warn('rpc.call-failed', 'Secret manager client RPC call failed.', undefined, {
          endpoint,
          errorName: error instanceof Error ? error.name : 'unknown',
        })
        throw error
      }
    },
  }
  const callEndpoint = (endpoint: string, payload: unknown, signal?: AbortSignal) =>
    rpc.call(RPC_CHANNEL, endpoint, payload, signal)

  // The tool's own dictionary: the registered locale namespace puts a bound
  // `t` on the toolview props; the settings page threads the same tables
  // through its own translator. The untyped register form takes one locale
  // per call; both baseline dictionaries go in together.
  ctx.effect(() => {
    const zh = locale?.register?.(LOCALE, 'zh', { ...uiZh })
    const en = locale?.register?.(LOCALE, 'en', { ...uiEn })
    return () => { zh?.(); en?.() }
  }, 'secret-manager.locale')

  ctx.effect(() => client.slots.inject('tool.call.toolview', () =>
    client.slots.register({
      name: 'tool.call.toolview',
      key: 'request_secret',
      locale: LOCALE,
      inject: (sessionId: string) => ({
        sessionId,
        call: (endpoint: string, payload: unknown, signal?: AbortSignal) => callEndpoint(endpoint, payload, signal),
      }),
    }, SecretToolView)), 'secret-manager.toolview')

  ctx.effect(() => client.slots.inject('settings.section', () => [
    client.slots.register({
      name: 'settings.section',
      id: PLUGIN_ID,
      order: SLOT_ORDER,
      label: () => translator(localeOf())('sectionLabel'),
    }, () => <SettingsRoot call={callEndpoint} client={client} locale={locale} />),
    // The nav icon lives on its own seat: it appears only while the icon slot
    // is declared and carries the same id/order as its section.
    client.slots.inject('settings.section.icon', () =>
      client.slots.register({ name: 'settings.section.icon', id: PLUGIN_ID, order: SLOT_ORDER, priority: SLOT_ORDER }, SecretSectionIcon)),
  ]), 'secret-manager.settings')
}

/** Line icon matching the shared settings-nav convention (client-utils). */
function SecretSectionIcon(props: { size?: number; active?: boolean }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M8 1.75 13.25 3.8v3.4c0 3.05-2.1 5.5-5.25 7.05C4.85 12.7 2.75 10.25 2.75 7.2V3.8L8 1.75Z" />
      <circle cx="8" cy="6.75" r="1.6" />
      <path d="M8 8.35v2.4" />
    </svg>
  )
}
