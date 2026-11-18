import type { Context } from '@deepseek-ai/cordis'
import {
  Button,
  IconCheckOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  MarkdownText,
  type MarkdownLabels,
  Modal,
  SegmentedTabs,
  StateDot,
  Tag,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { installClientPluginLogger, type PluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react'
import {
  PLUGIN_NAME,
  RPC_CHANNEL,
  type DshApplyCliUpdateResult,
  type DshUpdateCheckResult,
  type PluginApplyUpdateResult,
  type PluginCheckAllResult,
  type PluginUpdateEntry,
  type ReleaseLogEntry,
  type RpcResult,
  type UpdateChannel,
} from './contracts.ts'
import {
  PLUGIN_ROOT_CLASS,
  findLiveDesktopNewVersionButton,
  installUpdateButtonInterceptor,
  readClientRuntimeHints,
  triggerNativeControlOnce,
  type InterceptedTrigger,
} from './dsh-interceptor.ts'
import { dshUpdateClientStyles } from './styles.ts'

export const name = 'dsh-update-client'
export const inject = ['slots', 'connection', 'locale'] as const

export interface ClientSlotRegistry {
  inject(key: string, callback: () => unknown): () => void
  register(
    spec: {
      name: string
      id?: string
      key?: string
      order?: number
      priority?: number
      label?: string | (() => string)
    },
    render: unknown,
  ): () => void
}

export interface ClientHostContext {
  connection: {
    rpc: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> }
    generation?: { subscribe(listener: () => void): () => void }
  }
  locale?: { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
  slots: ClientSlotRegistry
}

export type DetailSubject =
  | {
    kind: 'bundle'
    pkg: {
      name: string
      version?: string | null
      installed?: boolean
      enabled?: boolean
      official?: boolean
    }
  }
  | { kind: 'row'; pkg: { name: string }; row: unknown }
  | { kind: 'item'; id: string }

export interface PluginsTabOwnerProps {
  openPackage?: (name: string) => void
  install?: (target: { spec: string; registry?: string; title?: string; version?: string }) => void
  update?: (target: { packageName: string; version: string; spec?: string }) => void
}

type ModalMode =
  | {
    kind: 'dsh'
    interceptedButton?: HTMLElement | null
    targetVersionHint?: string
    channelHint?: UpdateChannel
  }
  | {
    kind: 'plugin'
    packageName: string
    targetVersionHint?: string
    interceptedButton?: HTMLElement | null
  }

interface StoreSnapshot {
  modal: ModalMode | null
  dshStatus: DshUpdateCheckResult | null
  dshLoading: boolean
  dshError: string | null
  pluginsByName: Record<string, PluginUpdateEntry>
  pluginOrder: string[]
  pluginsLoading: boolean
  pluginsError: string | null
  applyingKey: string | null
  applyError: string | null
  applyOutcome: {
    tone: 'success' | 'warning'
    message: string
    diagnostic?: string
  } | null
  toastMessage: { tone?: 'success'; text: string } | null
}

const INITIAL_SNAPSHOT: StoreSnapshot = {
  modal: null,
  dshStatus: null,
  dshLoading: false,
  dshError: null,
  pluginsByName: {},
  pluginOrder: [],
  pluginsLoading: false,
  pluginsError: null,
  applyingKey: null,
  applyError: null,
  applyOutcome: null,
  toastMessage: null,
}

const copy = {
  zh: {
    tabLabel: '更新',
    dshModalTitle: 'DeepSeek Harness 版本变更内容',
    pluginModalTitlePrefix: '插件版本变更：',
    closeModal: '关闭',
    cancelUpdate: '暂不更新',
    confirmDshDesktopUpdate: '开始下载并更新',
    confirmDshCliUpdate: '立即更新 CLI 版本',
    confirmPluginUpdate: '确认更新并生效',
    updatingNow: '正在执行更新…',
    recheck: '重新检查',
    checkUpdate: '检查更新',
    viewChangelogAndUpdate: '查看更新',
    viewCurrentChangelog: '查看当前版本日志',
    checkAllUpdates: '检查全部更新',
    checkingChangelog: '正在读取 Release 变更日志…',
    checkingPlugins: '正在检查已安装插件版本与 Release 日志…',
    currentVersion: '当前版本',
    latestVersion: '目标最新版本',
    unknownVersion: '未知版本',
    upToDate: '当前已是最新版本',
    updateAvailable: '可更新',
    releaseCount: (n: number) => `共 ${n} 个版本的 Release 日志`,
    noReleaseLogsInRange: '未在 GitHub Releases 中检索到该版本区间的发布说明，可点击右上角前往仓库核对提交记录，确认无误后再执行更新。',
    noRepoConfigured: '该插件未声明 GitHub 仓库地址，无法自动读取 Release 日志；确认后仍可更新版本。',
    openGitHubReleases: '在 GitHub 查看 Releases',
    openReleaseTag: '查看此 Release',
    langModeLocalized: '当前语言摘要',
    langModeFull: '完整原文',
    prereleaseTag: '预发布',
    sourceRegistry: 'npm 注册表',
    sourceGit: 'Git 仓库',
    sourceLocal: '本地开发链接',
    sourceUnknown: '其他来源',
    localCannotUpdate: '本地 link/file 插件请在源码目录构建',
    incompatibleDsh: '新版本要求更高版本的 DSH',
    unpinnedGitHint: '未能解析目标提交 SHA，建议重新以固定版本安装',
    dshCoreCardTitle: 'DeepSeek Harness 本体',
    dshCoreCardHint: '点击侧栏「新版本」时将自动弹出变更预览，仅在确认后才开始下载更新。',
    pluginsSectionTitle: '已安装第三方插件',
    filterAll: '全部插件',
    filterUpdatable: '可更新',
    searchPlaceholder: '搜索插件名称或包名…',
    emptyPlugins: '当前 profile 暂无已安装的第三方插件。',
    emptyFilteredPlugins: '没有匹配的插件。',
    openPluginDetail: '插件详情',
    desktopDownloadTriggered: '已确认更新，正在启动桌面端下载流程。下载完成后将由桌面端提示重启安装。',
    summaryUpdatable: (n: number) => `${n} 个插件可更新`,
    summaryAllLatest: '已检查插件均为最新',
    emptyReleaseBody: '（该版本 Release 未填写正文说明）',
    markdownCopy: '复制',
    markdownCopied: '已复制',
    markdownCode: '代码',
    markdownWrap: '自动换行',
    markdownUnwrap: '取消换行',
    markdownFootnotes: '脚注',
    langTabsLabel: 'Release 说明语言',
    nativeHandoff: '交给宿主更新',
    nativeHandoffStarted: '已交回宿主原生更新流程。',
    nativeHandoffUnavailable: '宿主原生更新入口已不可用，请刷新插件页后重试。',
    missingTargetVersion: '缺少目标版本号，请重新检查后再试。',
  },
  en: {
    tabLabel: 'Updates',
    dshModalTitle: 'DeepSeek Harness Release Changelog',
    pluginModalTitlePrefix: 'Plugin Changelog: ',
    closeModal: 'Close',
    cancelUpdate: 'Not now',
    confirmDshDesktopUpdate: 'Download & Update',
    confirmDshCliUpdate: 'Update CLI Now',
    confirmPluginUpdate: 'Update & Apply',
    updatingNow: 'Updating…',
    recheck: 'Check again',
    checkUpdate: 'Check updates',
    viewChangelogAndUpdate: 'View update',
    viewCurrentChangelog: 'Release notes',
    checkAllUpdates: 'Check all updates',
    checkingChangelog: 'Loading GitHub Release logs…',
    checkingPlugins: 'Checking installed plugins and release logs…',
    currentVersion: 'Current',
    latestVersion: 'Latest target',
    unknownVersion: 'Unknown',
    upToDate: 'Up to date',
    updateAvailable: 'Update available',
    releaseCount: (n: number) => `${n} release${n === 1 ? '' : 's'} in range`,
    noReleaseLogsInRange: 'No GitHub Release notes were found for this version range. You can inspect the repository releases link before confirming the update.',
    noRepoConfigured: 'This plugin does not declare a GitHub repository URL for Release logs; you can still confirm to update.',
    openGitHubReleases: 'View Releases on GitHub',
    openReleaseTag: 'Open Release',
    langModeLocalized: 'Active language',
    langModeFull: 'Full release note',
    prereleaseTag: 'Pre-release',
    sourceRegistry: 'npm registry',
    sourceGit: 'Git repository',
    sourceLocal: 'Local link',
    sourceUnknown: 'Other source',
    localCannotUpdate: 'Local link/file plugins are updated by rebuilding locally',
    incompatibleDsh: 'Newer plugin release requires a newer DSH runtime',
    unpinnedGitHint: 'Target commit SHA could not be resolved automatically',
    dshCoreCardTitle: 'DeepSeek Harness Core',
    dshCoreCardHint: 'Clicking "New version" previews the Release changelog first and downloads only after confirmation.',
    pluginsSectionTitle: 'Installed Third-Party Plugins',
    filterAll: 'All plugins',
    filterUpdatable: 'Updates available',
    searchPlaceholder: 'Filter plugins by title or package…',
    emptyPlugins: 'No third-party plugins are installed in this profile.',
    emptyFilteredPlugins: 'No plugins match the current filter.',
    openPluginDetail: 'Details',
    desktopDownloadTriggered: 'Confirmed: starting the Desktop update download. Desktop will prompt before restarting to install.',
    summaryUpdatable: (n: number) => `${n} update${n === 1 ? '' : 's'} available`,
    summaryAllLatest: 'All checked plugins are up to date',
    emptyReleaseBody: '(No release notes body provided for this tag)',
    markdownCopy: 'Copy',
    markdownCopied: 'Copied',
    markdownCode: 'Code',
    markdownWrap: 'Wrap lines',
    markdownUnwrap: 'No wrap',
    markdownFootnotes: 'Footnotes',
    langTabsLabel: 'Release note language',
    nativeHandoff: 'Use the Host updater',
    nativeHandoffStarted: 'Handed the update back to the Host.',
    nativeHandoffUnavailable: 'The Host update control is gone; refresh the Plugins page and try again.',
    missingTargetVersion: 'No target version yet — check for updates again, then retry.',
  },
} as const

type Copy = (typeof copy)['zh'] | (typeof copy)['en']

// Release notes render through the host Markdown renderer, whose code-card chrome
// needs localized labels. The copy dictionaries are stable module constants, so
// one cache entry per language keeps the label identity stable across renders —
// a fresh object per render would discard the renderer's frozen block cache.
const markdownLabelCache = new WeakMap<Copy, MarkdownLabels>()
function markdownLabelsFor(text: Copy): MarkdownLabels {
  const cached = markdownLabelCache.get(text)
  if (cached) return cached
  const labels: MarkdownLabels = {
    code: {
      copyLabel: text.markdownCopy,
      copiedLabel: text.markdownCopied,
      toolbarLabels: {
        codeLabel: text.markdownCode,
        wrapLabel: text.markdownWrap,
        unwrapLabel: text.markdownUnwrap,
      },
    },
    footnotes: text.markdownFootnotes,
  }
  markdownLabelCache.set(text, labels)
  return labels
}

export function createUpdateClientController(client: ClientHostContext, logger?: PluginLogger) {
  let state: StoreSnapshot = { ...INITIAL_SNAPSHOT }
  const listeners = new Set<() => void>()
  let dshCheckGeneration = 0
  let pluginCheckGeneration = 0

  const emit = () => {
    for (const listener of listeners) listener()
  }
  const setState = (patch: Partial<StoreSnapshot> | ((prev: StoreSnapshot) => StoreSnapshot)) => {
    state = typeof patch === 'function' ? patch(state) : { ...state, ...patch }
    emit()
  }

  async function rpcCall<T>(endpoint: string, payload: Record<string, unknown> = {}): Promise<T> {
    const raw = (await client.connection.rpc.call(RPC_CHANNEL, endpoint, payload)) as RpcResult<T>
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid RPC response from dsh-update host.')
    }
    if (!raw.ok) {
      throw new Error(raw.error?.message || 'Update request failed.')
    }
    return raw.value
  }

  async function checkDsh(options: {
    targetVersionHint?: string
    channelHint?: UpdateChannel
    forceRefresh?: boolean
  } = {}): Promise<DshUpdateCheckResult | null> {
    const hints = readClientRuntimeHints()
    const generation = ++dshCheckGeneration
    setState({ dshLoading: true, dshError: null })
    try {
      const res = await rpcCall<DshUpdateCheckResult>('dsh.check', {
        ...(hints.clientVersion ? { clientVersion: hints.clientVersion } : {}),
        ...(options.targetVersionHint || hints.desktopTargetVersion
          ? { desktopTargetVersion: options.targetVersionHint ?? hints.desktopTargetVersion }
          : {}),
        ...(options.channelHint || hints.channel
          ? { channel: options.channelHint ?? hints.channel }
          : {}),
        ...(options.forceRefresh ? { forceRefresh: true } : {}),
      })
      if (generation !== dshCheckGeneration) return null
      setState({ dshStatus: res, dshLoading: false, dshError: null })
      return res
    } catch (error) {
      if (generation !== dshCheckGeneration) return null
      const msg = error instanceof Error ? error.message : String(error)
      logger?.warn('dsh.check.failed', 'Failed to check DSH release logs.', error)
      setState({ dshLoading: false, dshError: msg })
      return null
    }
  }

  async function checkAllPlugins(forceRefresh = false): Promise<PluginCheckAllResult | null> {
    const generation = ++pluginCheckGeneration
    setState({ pluginsLoading: true, pluginsError: null })
    try {
      const res = await rpcCall<PluginCheckAllResult>('plugins.checkAll', { forceRefresh })
      if (generation !== pluginCheckGeneration) return null
      const nextMap: Record<string, PluginUpdateEntry> = { ...state.pluginsByName }
      const order: string[] = []
      for (const item of res.plugins) {
        nextMap[item.name] = item
        order.push(item.name)
      }
      setState({
        pluginsByName: nextMap,
        pluginOrder: order,
        pluginsLoading: false,
        pluginsError: null,
      })
      return res
    } catch (error) {
      if (generation !== pluginCheckGeneration) return null
      const msg = error instanceof Error ? error.message : String(error)
      logger?.warn('plugins.checkAll.failed', 'Failed to check plugin updates.', error)
      setState({ pluginsLoading: false, pluginsError: msg })
      return null
    }
  }

  async function checkOnePlugin(
    packageName: string,
    options: { targetVersionHint?: string; forceRefresh?: boolean } = {},
  ): Promise<PluginUpdateEntry | null> {
    const generation = ++pluginCheckGeneration
    setState({ pluginsLoading: true, pluginsError: null })
    try {
      const entry = await rpcCall<PluginUpdateEntry>('plugins.checkOne', {
        name: packageName,
        ...(options.targetVersionHint ? { targetVersion: options.targetVersionHint } : {}),
        ...(options.forceRefresh ? { forceRefresh: true } : {}),
      })
      if (generation !== pluginCheckGeneration) return null
      setState(prev => ({
        ...prev,
        pluginsLoading: false,
        pluginsError: null,
        pluginsByName: { ...prev.pluginsByName, [entry.name]: entry },
        pluginOrder: prev.pluginOrder.includes(entry.name) ? prev.pluginOrder : [...prev.pluginOrder, entry.name],
      }))
      return entry
    } catch (error) {
      if (generation !== pluginCheckGeneration) return null
      const msg = error instanceof Error ? error.message : String(error)
      logger?.warn('plugins.checkOne.failed', 'Failed to check single plugin update.', error, { packageName })
      setState({ pluginsLoading: false, pluginsError: msg })
      return null
    }
  }

  function openDshModal(options: {
    interceptedButton?: HTMLElement | null
    targetVersionHint?: string
    channelHint?: UpdateChannel
    forceRefresh?: boolean
  } = {}): void {
    setState({
      modal: {
        kind: 'dsh',
        interceptedButton: options.interceptedButton ?? null,
        ...(options.targetVersionHint ? { targetVersionHint: options.targetVersionHint } : {}),
        ...(options.channelHint ? { channelHint: options.channelHint } : {}),
      },
      applyError: null,
      applyOutcome: null,
    })
    void checkDsh({
      targetVersionHint: options.targetVersionHint,
      channelHint: options.channelHint,
      forceRefresh: options.forceRefresh,
    })
  }

  function openPluginModal(
    packageName: string,
    options: {
      targetVersionHint?: string
      interceptedButton?: HTMLElement | null
      forceRefresh?: boolean
    } = {},
  ): void {
    setState({
      modal: {
        kind: 'plugin',
        packageName,
        ...(options.targetVersionHint ? { targetVersionHint: options.targetVersionHint } : {}),
        interceptedButton: options.interceptedButton ?? null,
      },
      applyError: null,
      applyOutcome: null,
    })
    void checkOnePlugin(packageName, {
      targetVersionHint: options.targetVersionHint,
      forceRefresh: options.forceRefresh ?? !state.pluginsByName[packageName],
    })
  }

  function closeModal(): void {
    if (state.applyingKey) return
    setState({ modal: null, applyError: null, applyOutcome: null })
  }

  function handleInterceptedTrigger(trigger: InterceptedTrigger): void {
    if (trigger.kind === 'dsh-new-version') {
      logger?.info('intercept.dsh-new-version', 'Intercepted DSH New Version button click; showing changelog modal.', {
        targetVersionHint: trigger.targetVersionHint ?? null,
      })
      openDshModal({
        interceptedButton: trigger.element,
        targetVersionHint: trigger.targetVersionHint,
        channelHint: trigger.channelHint,
      })
      return
    }
    logger?.info('intercept.plugin-update', 'Intercepted native plugin update click; showing changelog modal.', {
      packageName: trigger.packageName,
      targetVersionHint: trigger.targetVersionHint ?? null,
    })
    openPluginModal(trigger.packageName, {
      targetVersionHint: trigger.targetVersionHint,
      interceptedButton: trigger.element,
    })
  }

  /**
   * User explicitly clicked "Start Update" inside the DSH modal.
   */
  async function confirmDshUpdate(locale: 'zh' | 'en'): Promise<void> {
    if (state.applyingKey) return
    const modal = state.modal
    if (!modal || modal.kind !== 'dsh') return
    const status = state.dshStatus
    const text = copy[locale]

    setState({ applyingKey: 'dsh', applyError: null, applyOutcome: null })
    try {
      // 1. Prefer triggering the native Desktop update button via one-shot passthrough.
      const triggeredNative = triggerNativeControlOnce(
        modal.interceptedButton,
        () => findLiveDesktopNewVersionButton(),
      )
      if (triggeredNative) {
        setState({
          applyingKey: null,
          modal: null,
          toastMessage: { tone: 'success', text: text.desktopDownloadTriggered },
        })
        return
      }

      // 2. If running in non-Desktop CLI/Web mode and a target version exists, run CLI global update.
      const targetVersion = status?.targetVersion ?? modal.targetVersionHint
      if (!targetVersion) {
        setState({
          applyingKey: null,
          applyError: locale === 'zh' ? '未检测到可更新的目标版本号。' : 'No target version available to update.',
        })
        return
      }

      const cliRes = await rpcCall<DshApplyCliUpdateResult>('dsh.applyCli', { targetVersion })
      if (cliRes.status === 'failed') {
        setState({
          applyingKey: null,
          applyError: cliRes.message,
          applyOutcome: cliRes.diagnostic
            ? { tone: 'warning', message: cliRes.message, diagnostic: cliRes.diagnostic }
            : null,
        })
        return
      }

      setState({
        applyingKey: null,
        applyOutcome: {
          tone: 'success',
          message: cliRes.message,
          ...(cliRes.diagnostic ? { diagnostic: cliRes.diagnostic } : {}),
        },
      })
    } catch (error) {
      setState({
        applyingKey: null,
        applyError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * An intercepted native plugin-update click whose update this plugin cannot
   * apply (local link, official bundle, unpinned Git, …) must still be able to
   * reach the Host's own update control, which the interceptor swallowed.
   */
  function handBackToNative(locale: 'zh' | 'en'): void {
    const modal = state.modal
    if (!modal || modal.kind !== 'plugin') return
    const text = copy[locale]
    const handled = triggerNativeControlOnce(modal.interceptedButton)
    setState(handled
      ? {
          modal: null,
          applyError: null,
          applyOutcome: null,
          toastMessage: { tone: 'success', text: text.nativeHandoffStarted },
        }
      : { applyError: text.nativeHandoffUnavailable })
  }

  /**
   * User explicitly clicked "Update & Apply" inside the Plugin modal.
   */
  async function confirmPluginUpdate(packageName: string, locale: 'zh' | 'en'): Promise<void> {
    if (state.applyingKey) return
    const entry = state.pluginsByName[packageName]
    const modal = state.modal
    const targetVersion = entry?.latestVersion
      ?? (modal?.kind === 'plugin' ? modal.targetVersionHint : undefined)

    if (!targetVersion) {
      setState({ applyError: copy[locale].missingTargetVersion })
      return
    }

    setState({ applyingKey: packageName, applyError: null, applyOutcome: null })
    try {
      const res = await rpcCall<PluginApplyUpdateResult>('plugins.apply', {
        name: packageName,
        targetVersion,
        ...(entry?.targetSpec ? { targetSpec: entry.targetSpec } : {}),
        ...(entry?.registry ? { registry: entry.registry } : {}),
      })

      if (res.status === 'failed') {
        setState({
          applyingKey: null,
          applyError: res.message,
          ...(res.diagnostic
            ? { applyOutcome: { tone: 'warning', message: res.message, diagnostic: res.diagnostic } }
            : {}),
        })
        return
      }

      // Refresh plugin entry after update completes so version badges & lists reflect the live version immediately.
      await checkOnePlugin(packageName, { forceRefresh: true }).catch(() => null)

      setState({
        applyingKey: null,
        applyOutcome: {
          tone: res.status === 'applied' ? 'success' : 'warning',
          message: res.message,
          ...(res.diagnostic ? { diagnostic: res.diagnostic } : {}),
        },
        toastMessage: { tone: 'success', text: res.message },
      })
    } catch (error) {
      setState({
        applyingKey: null,
        applyError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function dismissToast(): void {
    setState({ toastMessage: null })
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    checkDsh,
    checkAllPlugins,
    checkOnePlugin,
    openDshModal,
    openPluginModal,
    closeModal,
    handleInterceptedTrigger,
    confirmDshUpdate,
    confirmPluginUpdate,
    handBackToNative,
    dismissToast,
  }
}

export type UpdateClientController = ReturnType<typeof createUpdateClientController>

function readLocaleService(client: ClientHostContext): ClientHostContext['locale'] {
  try {
    return client.locale
  } catch {
    return undefined
  }
}

function useHostLocale(client: ClientHostContext): 'zh' | 'en' {
  const locale = readLocaleService(client)
  const subscribe = useCallback((listener: () => void) => locale?.subscribe(listener) ?? (() => {}), [locale])
  const snapshot = useCallback(() => locale?.getSnapshot().active ?? 'zh', [locale])
  return String(useSyncExternalStore(subscribe, snapshot, snapshot)).startsWith('zh') ? 'zh' : 'en'
}

function useControllerSnapshot(controller: UpdateClientController): StoreSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
}

function ExternalLink({ url, children, className }: { url: string; children: string; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={className ?? 'dsh-upd-link'}
      onClick={event => {
        const bridge = (globalThis as { dshWindow?: { openExternal?(targetUrl: string): void } }).dshWindow
        if (bridge?.openExternal && /^https?:\/\//i.test(url)) {
          event.preventDefault()
          bridge.openExternal(url)
        }
      }}
    >
      {children}
    </a>
  )
}

function formatShortDate(iso: string, locale: 'zh' | 'en'): string {
  if (!iso) return ''
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return iso.slice(0, 10)
  try {
    return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(time))
  } catch {
    return iso.slice(0, 10)
  }
}

function ReleaseLogCard({
  release,
  locale,
  preferLocalized,
  text,
}: {
  release: ReleaseLogEntry
  locale: 'zh' | 'en'
  preferLocalized: boolean
  text: Copy
}) {
  const localizedSection = preferLocalized ? release.localizedBody?.[locale] : undefined
  const markdownBody = (localizedSection ?? release.body).trim()
  const dateText = formatShortDate(release.publishedAt, locale)

  return (
    <article className="dsh-upd-release-card" data-testid={`dsh-upd-release-${release.version}`}>
      <header className="dsh-upd-release-head">
        <div className="dsh-upd-release-title-group">
          <span className="dsh-upd-release-title">{release.title || release.tag}</span>
          <span className="dsh-upd-version-code">{release.tag}</span>
          {release.prerelease ? <Tag tone="warning">{text.prereleaseTag}</Tag> : null}
          {dateText ? <span className="dsh-upd-release-date">{dateText}</span> : null}
        </div>
        {release.url ? <ExternalLink url={release.url}>{text.openReleaseTag}</ExternalLink> : null}
      </header>
      <div className="dsh-upd-markdown">
        {markdownBody ? (
          <MarkdownText text={markdownBody} labels={markdownLabelsFor(text)} />
        ) : (
          <p className="dsh-ui-hint">{text.emptyReleaseBody}</p>
        )}
      </div>
    </article>
  )
}

export function DshUpdateOverlay({
  client,
  controller,
}: {
  client: ClientHostContext
  controller: UpdateClientController
}) {
  const locale = useHostLocale(client)
  const text = copy[locale]
  const snap = useControllerSnapshot(controller)
  const [langView, setLangView] = useState<'localized' | 'full'>('localized')
  const langTabsId = useId()

  const modal = snap.modal
  const isDsh = modal?.kind === 'dsh'
  const pluginEntry = modal?.kind === 'plugin' ? snap.pluginsByName[modal.packageName] : undefined

  const currentVersion = isDsh
    ? snap.dshStatus?.currentVersion ?? readClientRuntimeHints().clientVersion ?? null
    : pluginEntry?.installedVersion ?? null

  const targetVersion = isDsh
    ? snap.dshStatus?.targetVersion ?? modal?.targetVersionHint ?? null
    : pluginEntry?.latestVersion ?? (modal?.kind === 'plugin' ? modal.targetVersionHint ?? null : null)

  const hasUpdate = isDsh
    ? Boolean(snap.dshStatus?.hasUpdate || (modal?.interceptedButton && targetVersion !== currentVersion))
    : Boolean(pluginEntry?.hasUpdate)

  const releases: ReleaseLogEntry[] = useMemo(() => {
    if (isDsh) {
      if (snap.dshStatus?.releases.length) return snap.dshStatus.releases
      if (!hasUpdate && snap.dshStatus?.currentRelease) return [snap.dshStatus.currentRelease]
      return []
    }
    if (pluginEntry) {
      if (pluginEntry.releases.length) return pluginEntry.releases
      if (!pluginEntry.hasUpdate && pluginEntry.currentRelease) return [pluginEntry.currentRelease]
    }
    return []
  }, [isDsh, snap.dshStatus, hasUpdate, pluginEntry])

  const anyBilingual = useMemo(
    () => releases.some(item => Boolean(item.localizedBody?.[locale])),
    [releases, locale],
  )

  const loading = isDsh ? snap.dshLoading : snap.pluginsLoading
  const loadError = isDsh ? snap.dshError : snap.pluginsError || pluginEntry?.error || null
  const releasesUrl = isDsh ? snap.dshStatus?.releasesUrl : pluginEntry?.releasesUrl
  const busy = Boolean(snap.applyingKey)

  const canConfirm = useMemo(() => {
    if (busy || snap.applyOutcome?.tone === 'success') return false
    if (isDsh) {
      const hasNativeButton = Boolean(
        (modal?.interceptedButton && modal.interceptedButton.isConnected)
          || findLiveDesktopNewVersionButton(),
      )
      return Boolean(hasNativeButton || (hasUpdate && targetVersion))
    }
    return Boolean(pluginEntry && pluginEntry.hasUpdate && pluginEntry.canApplyUpdate)
  }, [busy, snap.applyOutcome, isDsh, modal, hasUpdate, targetVersion, pluginEntry])

  const confirmLabel = useMemo(() => {
    if (busy) return text.updatingNow
    if (isDsh) {
      const hasDesktop = Boolean(
        snap.dshStatus?.isDesktopHost
          || readClientRuntimeHints().hasDesktopBridge
          || modal?.interceptedButton
          || findLiveDesktopNewVersionButton(),
      )
      return hasDesktop ? text.confirmDshDesktopUpdate : text.confirmDshCliUpdate
    }
    return text.confirmPluginUpdate
  }, [busy, isDsh, snap.dshStatus, modal, text])

  const modalTitle = isDsh
    ? text.dshModalTitle
    : `${text.pluginModalTitlePrefix}${pluginEntry?.title ?? (modal?.kind === 'plugin' ? modal.packageName : '')}`

  return (
    <>
      {snap.toastMessage ? (
        <Toast
          text={snap.toastMessage.text}
          tone={snap.toastMessage.tone}
          icon={snap.toastMessage.tone === 'success' ? <IconCheckOutlineRegular size={16} /> : undefined}
          onDone={controller.dismissToast}
        />
      ) : null}
      <Modal
        open={Boolean(modal)}
        onClose={controller.closeModal}
        title={modalTitle}
        closeLabel={text.closeModal}
        className={PLUGIN_ROOT_CLASS}
        footer={
          <div className="dsh-upd-footer">
            <div>
              {releasesUrl ? <ExternalLink url={releasesUrl}>{text.openGitHubReleases}</ExternalLink> : null}
            </div>
            <div className="dsh-upd-footer-actions">
              <Button
                variant="outline"
                size="sm"
                icon={<IconRefreshOutlineRegular size={14} />}
                disabled={busy || loading}
                onClick={() => {
                  if (!modal) return
                  if (modal.kind === 'dsh') {
                    void controller.checkDsh({
                      targetVersionHint: modal.targetVersionHint,
                      channelHint: modal.channelHint,
                      forceRefresh: true,
                    })
                  } else {
                    void controller.checkOnePlugin(modal.packageName, {
                      targetVersionHint: modal.targetVersionHint,
                      forceRefresh: true,
                    })
                  }
                }}
              >
                {text.recheck}
              </Button>
              {!isDsh && modal?.kind === 'plugin' && modal.interceptedButton && !canConfirm ? (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="dsh-upd-native-handoff"
                  disabled={busy}
                  onClick={() => controller.handBackToNative(locale)}
                >
                  {text.nativeHandoff}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" disabled={busy} onClick={controller.closeModal}>
                {snap.applyOutcome?.tone === 'success' ? text.closeModal : text.cancelUpdate}
              </Button>
              {hasUpdate || (isDsh && modal?.interceptedButton) ? (
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="dsh-upd-confirm-button"
                  disabled={!canConfirm}
                  onClick={() => {
                    if (!modal) return
                    if (modal.kind === 'dsh') void controller.confirmDshUpdate(locale)
                    else void controller.confirmPluginUpdate(modal.packageName, locale)
                  }}
                >
                  {confirmLabel}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div className="dsh-upd-modal-body" data-testid="dsh-upd-modal-body">
          <div className="dsh-upd-version-bar">
            <div className="dsh-upd-version-pair">
              <span className="dsh-ui-meta">{text.currentVersion}</span>
              <code className="dsh-upd-version-code">{currentVersion ?? text.unknownVersion}</code>
              {targetVersion && targetVersion !== currentVersion ? (
                <>
                  <span className="dsh-upd-arrow" aria-hidden="true">→</span>
                  <span className="dsh-ui-meta">{text.latestVersion}</span>
                  <code className="dsh-upd-version-code dsh-upd-version-code--target">{targetVersion}</code>
                </>
              ) : (
                <Tag tone="success">{text.upToDate}</Tag>
              )}
              {releases.length > 0 && hasUpdate ? (
                <Tag tone="info">{text.releaseCount(releases.length)}</Tag>
              ) : null}
            </div>
            {anyBilingual ? (
              <SegmentedTabs<'localized' | 'full'>
                size="sm"
                label={text.langTabsLabel}
                value={langView}
                onChange={setLangView}
                items={[
                  { value: 'localized', label: text.langModeLocalized, id: `${langTabsId}-loc`, panelId: `${langTabsId}-list` },
                  { value: 'full', label: text.langModeFull, id: `${langTabsId}-full`, panelId: `${langTabsId}-list` },
                ]}
              />
            ) : null}
          </div>

          {snap.applyError ? (
            <p role="alert" className="dsh-ui-error" data-testid="dsh-upd-apply-error">
              {snap.applyError}
            </p>
          ) : null}

          {snap.applyOutcome ? (
            <div className="dsh-ui-banner" role="status" data-testid="dsh-upd-apply-outcome">
              <p>{snap.applyOutcome.message}</p>
              {snap.applyOutcome.diagnostic ? (
                <pre className="dsh-upd-diagnostic">{snap.applyOutcome.diagnostic}</pre>
              ) : null}
            </div>
          ) : null}

          {!isDsh && pluginEntry?.cannotUpdateReason === 'link-or-local' ? (
            <p className="dsh-ui-hint">{text.localCannotUpdate}</p>
          ) : null}
          {!isDsh && pluginEntry?.cannotUpdateReason === 'incompatible-dsh' ? (
            <p className="dsh-ui-error">{pluginEntry.incompatibleReason ?? text.incompatibleDsh}</p>
          ) : null}
          {!isDsh && pluginEntry?.cannotUpdateReason === 'unpinned-git' ? (
            <p className="dsh-ui-hint">{text.unpinnedGitHint}</p>
          ) : null}

          {loading ? (
            <p role="status" className="dsh-ui-hint" data-testid="dsh-upd-loading">
              {text.checkingChangelog}
            </p>
          ) : loadError ? (
            <p role="alert" className="dsh-ui-error" data-testid="dsh-upd-load-error">
              {loadError}
            </p>
          ) : releases.length > 0 ? (
            <div id={`${langTabsId}-list`} className="dsh-upd-release-list">
              {releases.map(item => (
                <ReleaseLogCard
                  key={`${item.tag}-${item.version}`}
                  release={item}
                  locale={locale}
                  preferLocalized={langView === 'localized'}
                  text={text}
                />
              ))}
            </div>
          ) : !isDsh && pluginEntry && !pluginEntry.repository ? (
            <p className="dsh-ui-hint">{text.noRepoConfigured}</p>
          ) : hasUpdate ? (
            <p className="dsh-ui-hint">{text.noReleaseLogsInRange}</p>
          ) : null}
        </div>
      </Modal>
    </>
  )
}

export function PluginUpdatesTab({
  client,
  controller,
  ownerProps,
}: {
  client: ClientHostContext
  controller: UpdateClientController
  ownerProps?: PluginsTabOwnerProps
}) {
  const locale = useHostLocale(client)
  const text = copy[locale]
  const snap = useControllerSnapshot(controller)
  const filterTabsId = useId()
  const [filter, setFilter] = useState<'all' | 'updatable'>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!snap.dshStatus && !snap.dshLoading) {
      void controller.checkDsh()
    }
    if (snap.pluginOrder.length === 0 && !snap.pluginsLoading) {
      void controller.checkAllPlugins(false)
    }
  }, [controller])

  const allPlugins = useMemo(
    () => snap.pluginOrder.map(id => snap.pluginsByName[id]).filter((item): item is PluginUpdateEntry => Boolean(item)),
    [snap.pluginOrder, snap.pluginsByName],
  )
  const updatableCount = useMemo(() => allPlugins.filter(item => item.hasUpdate).length, [allPlugins])

  const visiblePlugins = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allPlugins.filter(item => {
      if (filter === 'updatable' && !item.hasUpdate) return false
      if (!needle) return true
      return (
        item.name.toLowerCase().includes(needle)
        || item.title.toLowerCase().includes(needle)
        || item.description.toLowerCase().includes(needle)
      )
    })
  }, [allPlugins, filter, query])

  const sourceLabel = (kind: PluginUpdateEntry['sourceKind']): string => {
    if (kind === 'registry') return text.sourceRegistry
    if (kind === 'git') return text.sourceGit
    if (kind === 'link' || kind === 'file') return text.sourceLocal
    return text.sourceUnknown
  }

  return (
    <section className={`${PLUGIN_ROOT_CLASS} dsh-ui-page`} data-testid="dsh-upd-plugins-tab">
      <article className="dsh-upd-plugin-row" data-testid="dsh-upd-core-card">
        <div className="dsh-upd-plugin-main">
          <div className="dsh-upd-plugin-head">
            <strong className="dsh-ui-heading">{text.dshCoreCardTitle}</strong>
            {snap.dshStatus?.currentVersion ? (
              <code className="dsh-upd-version-code">{snap.dshStatus.currentVersion}</code>
            ) : null}
            {snap.dshStatus?.hasUpdate && snap.dshStatus.targetVersion ? (
              <>
                <span className="dsh-upd-arrow" aria-hidden="true">→</span>
                <code className="dsh-upd-version-code dsh-upd-version-code--target">{snap.dshStatus.targetVersion}</code>
                <Tag tone="info">{text.updateAvailable}</Tag>
              </>
            ) : snap.dshStatus ? (
              <Tag tone="success">{text.upToDate}</Tag>
            ) : null}
          </div>
          <p className="dsh-ui-hint">{text.dshCoreCardHint}</p>
        </div>
        <div className="dsh-upd-plugin-actions">
          <Button
            variant={snap.dshStatus?.hasUpdate ? 'primary' : 'outline'}
            size="sm"
            onClick={() => controller.openDshModal({ forceRefresh: false })}
          >
            {snap.dshStatus?.hasUpdate ? text.viewChangelogAndUpdate : text.checkUpdate}
          </Button>
        </div>
      </article>

      <div className="dsh-upd-tab-toolbar">
        <div className="dsh-ui-row-wrap">
          <SegmentedTabs<'all' | 'updatable'>
            size="sm"
            label={text.pluginsSectionTitle}
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: text.filterAll, id: `${filterTabsId}-all`, panelId: `${filterTabsId}-panel` },
              {
                value: 'updatable',
                label: `${text.filterUpdatable} (${updatableCount})`,
                id: `${filterTabsId}-upd`,
                panelId: `${filterTabsId}-panel`,
              },
            ]}
          />
          <span className="dsh-ui-meta">
            <StateDot state={updatableCount > 0 ? 'ongoing' : 'done'} />{' '}
            {updatableCount > 0 ? text.summaryUpdatable(updatableCount) : text.summaryAllLatest}
          </span>
        </div>
        <div className="dsh-ui-row-wrap">
          <Input
            icon={<IconSearchOutlineRegular size={14} />}
            value={query}
            aria-label={text.searchPlaceholder}
            placeholder={text.searchPlaceholder}
            onChange={event => setQuery(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            icon={<IconRefreshOutlineRegular size={14} />}
            disabled={snap.pluginsLoading}
            onClick={() => {
              void controller.checkDsh({ forceRefresh: true })
              void controller.checkAllPlugins(true)
            }}
          >
            {text.checkAllUpdates}
          </Button>
        </div>
      </div>

      {snap.pluginsError ? <p role="alert" className="dsh-ui-error">{snap.pluginsError}</p> : null}
      {snap.pluginsLoading && allPlugins.length === 0 ? (
        <p role="status" className="dsh-ui-hint">{text.checkingPlugins}</p>
      ) : null}

      <div id={`${filterTabsId}-panel`} className="dsh-upd-plugin-list">
        {allPlugins.length === 0 && !snap.pluginsLoading ? (
          <p className="dsh-ui-empty">{text.emptyPlugins}</p>
        ) : visiblePlugins.length === 0 && !snap.pluginsLoading ? (
          <p className="dsh-ui-empty">{text.emptyFilteredPlugins}</p>
        ) : (
          visiblePlugins.map(item => (
            <article key={item.name} className="dsh-upd-plugin-row" data-testid={`dsh-upd-row-${item.name}`}>
              <div className="dsh-upd-plugin-main">
                <div className="dsh-upd-plugin-head">
                  <strong className="dsh-ui-heading">{item.title}</strong>
                  <span className="dsh-upd-plugin-pkg">{item.name}</span>
                  <Tag tone="quiet">{sourceLabel(item.sourceKind)}</Tag>
                  {item.installedVersion ? (
                    <code className="dsh-upd-version-code">{item.installedVersion}</code>
                  ) : null}
                  {item.hasUpdate && item.latestVersion ? (
                    <>
                      <span className="dsh-upd-arrow" aria-hidden="true">→</span>
                      <code className="dsh-upd-version-code dsh-upd-version-code--target">{item.latestVersion}</code>
                      <Tag tone="info">{text.updateAvailable}</Tag>
                    </>
                  ) : (
                    <Tag tone="outline">{text.upToDate}</Tag>
                  )}
                </div>
                {item.description ? <p className="dsh-ui-meta">{item.description}</p> : null}
                {item.error ? <p className="dsh-ui-error">{item.error}</p> : null}
              </div>
              <div className="dsh-upd-plugin-actions">
                {ownerProps?.openPackage ? (
                  <Button variant="ghost" size="sm" onClick={() => ownerProps.openPackage?.(item.name)}>
                    {text.openPluginDetail}
                  </Button>
                ) : null}
                <Button
                  variant={item.hasUpdate ? 'primary' : 'outline'}
                  size="sm"
                  data-testid={`dsh-upd-open-${item.name}`}
                  onClick={() => controller.openPluginModal(item.name)}
                >
                  {item.hasUpdate ? `${text.viewChangelogAndUpdate} (${item.latestVersion})` : text.viewCurrentChangelog}
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}

export function PluginDetailUpdateBadge({
  client,
  controller,
  subject,
}: {
  client: ClientHostContext
  controller: UpdateClientController
  subject?: DetailSubject
}) {
  const locale = useHostLocale(client)
  const text = copy[locale]
  const snap = useControllerSnapshot(controller)

  if (!subject || subject.kind !== 'bundle') return null
  const pkg = subject.pkg
  if (!pkg?.name || pkg.official || pkg.installed === false || pkg.name.startsWith('@deepseek-ai/')) {
    return null
  }
  const cached = snap.pluginsByName[pkg.name]
  if (!cached?.hasUpdate || !cached.latestVersion) return null

  return (
    <span className={`${PLUGIN_ROOT_CLASS} dsh-upd-inline-slot`}>
      <Tag tone="info">{`${text.updateAvailable} ${cached.latestVersion}`}</Tag>
    </span>
  )
}

export function PluginDetailUpdateAction({
  client,
  controller,
  subject,
}: {
  client: ClientHostContext
  controller: UpdateClientController
  subject?: DetailSubject
}) {
  const locale = useHostLocale(client)
  const text = copy[locale]
  const snap = useControllerSnapshot(controller)

  if (!subject || subject.kind !== 'bundle') return null
  const pkg = subject.pkg
  if (!pkg?.name || pkg.official || pkg.installed === false || pkg.name.startsWith('@deepseek-ai/')) {
    return null
  }

  const cached = snap.pluginsByName[pkg.name]
  const hasUpdate = Boolean(cached?.hasUpdate && cached.latestVersion)

  return (
    <span className={`${PLUGIN_ROOT_CLASS} dsh-upd-inline-slot`}>
      <Button
        variant={hasUpdate ? 'primary' : 'outline'}
        size="sm"
        data-testid={`dsh-upd-detail-action-${pkg.name}`}
        onClick={() => controller.openPluginModal(pkg.name, { forceRefresh: !cached })}
      >
        {hasUpdate ? `${text.viewChangelogAndUpdate} (${cached!.latestVersion})` : text.checkUpdate}
      </Button>
    </span>
  )
}

export function apply(ctx: Context): void {
  const logger = installClientPluginLogger(ctx, PLUGIN_NAME)
  const client = ctx as unknown as ClientHostContext
  const controller = createUpdateClientController(client, logger)

  // 1. Owned stylesheet injection for HMR safety.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', PLUGIN_NAME)
    style.dataset.dshUpdateStyles = ''
    style.textContent = dshUpdateClientStyles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-update.styles')

  // 2. Capture-phase interception for Desktop `[↓ 新版本]` and native plugin `更新到 ...` buttons.
  // Interception needs the overlay that shows the changelog: a host that never declares
  // `shell.overlay` keeps its native update control instead of a click that goes nowhere.
  let overlayAvailable = false
  ctx.effect(
    () => installUpdateButtonInterceptor(
      trigger => controller.handleInterceptedTrigger(trigger),
      undefined,
      { shouldIntercept: () => overlayAvailable },
    ),
    'dsh-update.interceptor',
  )

  // 3. Global Release Changelog & Confirm Modal on `shell.overlay`.
  ctx.effect(
    () =>
      client.slots.inject('shell.overlay', () => {
        overlayAvailable = true
        const dispose = client.slots.register(
          { name: 'shell.overlay', id: 'dsh-update-overlay', order: 60 },
          () => <DshUpdateOverlay client={client} controller={controller} />,
        )
        return () => {
          overlayAvailable = false
          dispose()
        }
      }),
    'dsh-update.overlay',
  )

  // 4. Unified "更新 / Updates" tab inside the official Plugins page (`plugins.tab`).
  ctx.effect(
    () =>
      client.slots.inject('plugins.tab', () =>
        client.slots.register(
          {
            name: 'plugins.tab',
            id: 'dsh-update-center',
            order: 25,
            label: () =>
              String(readLocaleService(client)?.getSnapshot().active ?? 'zh').startsWith('zh')
                ? copy.zh.tabLabel
                : copy.en.tabLabel,
          },
          (props?: PluginsTabOwnerProps) => (
            <PluginUpdatesTab client={client} controller={controller} ownerProps={props} />
          ),
        ),
      ),
    'dsh-update.plugins-tab',
  )

  // 5. Per-plugin detail header badge & check/update button (`plugins.detail.badge` & `plugins.detail.actions`).
  ctx.effect(
    () =>
      client.slots.inject('plugins.detail.badge', () =>
        client.slots.register(
          { name: 'plugins.detail.badge', id: 'dsh-update-badge', order: 25 },
          (props?: { subject?: DetailSubject }) => (
            <PluginDetailUpdateBadge client={client} controller={controller} subject={props?.subject} />
          ),
        ),
      ),
    'dsh-update.detail-badge',
  )

  ctx.effect(
    () =>
      client.slots.inject('plugins.detail.actions', () =>
        client.slots.register(
          { name: 'plugins.detail.actions', id: 'dsh-update-action', order: 15 },
          (props?: { subject?: DetailSubject }) => (
            <PluginDetailUpdateAction client={client} controller={controller} subject={props?.subject} />
          ),
        ),
      ),
    'dsh-update.detail-action',
  )

}
