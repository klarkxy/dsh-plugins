import { parseSemver, type UpdateChannel } from './contracts.ts'

export const PLUGIN_ROOT_CLASS = 'dsh-upd-root'

export type InterceptedTrigger =
  | {
    kind: 'dsh-new-version'
    element: HTMLElement
    targetVersionHint?: string
    channelHint?: UpdateChannel
  }
  | {
    kind: 'plugin-native-update'
    element: HTMLElement
    packageName: string
    targetVersionHint?: string
  }

const NEW_VERSION_EXACT_LABELS = new Set([
  '新版本',
  '有新版本',
  '发现新版本',
  'new version',
  'update available',
  'new update',
])

const NEW_VERSION_PREFIX_RE = /^(?:新版本|有新版本|发现新版本|new\s+version|update\s+available)(?:\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?))?$/iu

const EXCLUDED_UPDATE_CONTROL_RE = /^(?:\d{1,3}%|检查中|正在检查|校验中|正在校验|重新连接中|连接异常.*|重试|重启.*|立即安装|安装并重启|checking.*|verifying.*|reconnecting.*|retry.*|restart.*|install.*)$/iu

const NATIVE_PLUGIN_UPDATE_RE = /^(?:更新到\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)|update\s+to\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)|更新|update)$/iu

const SEMVER_FINDER_RE = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/

const bypassedElements = new WeakSet<Element>()

export function isElementBypassed(element: Element): boolean {
  return bypassedElements.has(element)
}

/**
 * Trigger the native click handler on an intercepted element once, bypassing our capture-phase interceptor.
 */
export function triggerNativeControlOnce(
  capturedElement: HTMLElement | null | undefined,
  fallbackLookup?: () => HTMLElement | null,
): boolean {
  const target = (capturedElement && capturedElement.isConnected ? capturedElement : null)
    ?? fallbackLookup?.()
    ?? null
  if (!target) return false
  bypassedElements.add(target)
  try {
    target.click()
    return true
  } finally {
    bypassedElements.delete(target)
  }
}

/**
 * Locate the live `[↓ 新版本]` button in the current document if React re-rendered it while the modal was open.
 */
export function findLiveDesktopNewVersionButton(doc: Document | undefined = globalThis.document): HTMLElement | null {
  if (!doc) return null
  const candidates = doc.querySelectorAll<HTMLElement>('button, [role="button"]')
  for (const el of candidates) {
    const match = matchInterceptableTrigger(el, doc)
    if (match?.kind === 'dsh-new-version') return el
  }
  return null
}

/**
 * Read non-mutating hints exposed on `window` / `window.dshDesktop` when running inside DSH Desktop or Web.
 */
export function readClientRuntimeHints(win: unknown = globalThis): {
  clientVersion?: string
  desktopTargetVersion?: string
  channel?: UpdateChannel
  hasDesktopBridge: boolean
} {
  if (!win || typeof win !== 'object') return { hasDesktopBridge: false }
  const g = win as Record<string, unknown>

  let clientVersion: string | undefined
  if (typeof g.DSH_CLIENT_VERSION === 'string') {
    clientVersion = parseSemver(g.DSH_CLIENT_VERSION)?.version
  }

  // Fallback: inspect sidebar brand version badge (`version[-commit][-dirty]`) if present in DOM.
  if (!clientVersion && typeof document !== 'undefined') {
    const bodyText = document.querySelector('[data-sidebar-brand], nav, aside')?.textContent ?? ''
    const found = SEMVER_FINDER_RE.exec(bodyText)
    if (found?.[1]) clientVersion = parseSemver(found[1])?.version
  }

  const desktop = g.dshDesktop
  if (!desktop || typeof desktop !== 'object') {
    return {
      ...(clientVersion ? { clientVersion } : {}),
      hasDesktopBridge: false,
    }
  }

  const dObj = desktop as Record<string, unknown>
  let desktopTargetVersion: string | undefined
  let channel: UpdateChannel | undefined

  // Safely probe read-only update carrier snapshots if exposed on `dshDesktop`.
  for (const key of ['updates', 'update', 'desktopUpdates', 'appUpdate']) {
    const carrier = dObj[key]
    if (!carrier || typeof carrier !== 'object') continue
    const cObj = carrier as Record<string, unknown>
    try {
      const snap = typeof cObj.getSnapshot === 'function'
        ? cObj.getSnapshot()
        : typeof cObj.getState === 'function'
          ? cObj.getState()
          : cObj.state ?? cObj
      if (snap && typeof snap === 'object') {
        const sObj = snap as Record<string, unknown>
        if (typeof sObj.version === 'string') {
          desktopTargetVersion = parseSemver(sObj.version)?.version ?? desktopTargetVersion
        } else if (typeof sObj.availableVersion === 'string') {
          desktopTargetVersion = parseSemver(sObj.availableVersion)?.version ?? desktopTargetVersion
        }
        if (sObj.channel === 'prerelease' || sObj.channel === 'nightly' || sObj.channel === 'beta') {
          channel = 'prerelease'
        } else if (sObj.channel === 'stable') {
          channel = 'stable'
        }
      }
    } catch {
      // Never fail if preload getter throws.
    }
  }

  return {
    ...(clientVersion ? { clientVersion } : {}),
    ...(desktopTargetVersion ? { desktopTargetVersion } : {}),
    ...(channel ? { channel } : {}),
    hasDesktopBridge: true,
  }
}

/**
 * Determine whether an event target corresponds to:
 * 1) The DSH Desktop `[↓ 新版本]` (`New version` / `Update available`) button in its `available` phase; or
 * 2) A native plugin `更新` / `更新到 x.y.z` button inside `[data-plugin-detail]`.
 */
export function matchInterceptableTrigger(
  rawTarget: EventTarget | null,
  doc: Document | undefined = globalThis.document,
): InterceptedTrigger | null {
  if (!rawTarget || typeof (rawTarget as Element).closest !== 'function') return null
  const element = (rawTarget as Element).closest('button, [role="button"]') as HTMLElement | null
  if (!element) return null

  if (isElementBypassed(element)) return null
  if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') return null

  // Never intercept clicks inside our own plugin UI, dialogs/modals, or chat transcripts/code blocks.
  if (element.closest(`.${PLUGIN_ROOT_CLASS}`)) return null
  if (element.closest('[role="dialog"], [aria-modal="true"], [role="menu"]')) return null
  if (element.closest('article, pre, code, [data-message-id], [contenteditable="true"]')) return null

  const rawText = normalizeInlineText(element.textContent ?? '')
  const ariaLabel = normalizeInlineText(element.getAttribute('aria-label') ?? '')
  const titleAttr = normalizeInlineText(element.getAttribute('title') ?? '')

  // Case A: Native plugin detail page update button (`[data-plugin-detail="<pkg>"]`)
  const detailContainer = element.closest('[data-plugin-detail]') as HTMLElement | null
  if (detailContainer) {
    const pkgName = (detailContainer.getAttribute('data-plugin-detail') ?? '').trim()
    const match = NATIVE_PLUGIN_UPDATE_RE.exec(rawText)
    if (pkgName && match) {
      const ver = match[1] || match[2] || extractVersionFromStrings(ariaLabel, titleAttr)
      return {
        kind: 'plugin-native-update',
        element,
        packageName: pkgName,
        ...(ver ? { targetVersionHint: ver } : {}),
      }
    }
    return null
  }

  // Exclude the rest of the Plugins page list cards from matching as DSH Desktop's `[↓ 新版本]` pill.
  if (element.closest('[data-plugin-package]')) return null

  // Exclude downloading %, checking, verifying, retry, or ready-to-restart buttons.
  if (EXCLUDED_UPDATE_CONTROL_RE.test(rawText)) return null

  // Case B: DSH Desktop `[↓ 新版本]` / `New version` / `Update available` pill button.
  const explicitPhase = (
    element.getAttribute('data-update-phase')
    || element.getAttribute('data-desktop-update')
    || element.getAttribute('data-phase')
    || ''
  ).toLowerCase()

  const lowerText = rawText.toLowerCase()
  const prefixMatch = NEW_VERSION_PREFIX_RE.exec(rawText)
  const isNewVersionButton = explicitPhase === 'available'
    || NEW_VERSION_EXACT_LABELS.has(lowerText)
    || Boolean(prefixMatch)

  if (!isNewVersionButton) return null

  const runtimeHints = readClientRuntimeHints()
  const tooltipText = findActiveTooltipText(doc)
  const targetVersionHint = prefixMatch?.[1]
    ?? extractVersionFromStrings(
      element.getAttribute('data-version') ?? '',
      ariaLabel,
      titleAttr,
      tooltipText,
    )
    ?? runtimeHints.desktopTargetVersion

  return {
    kind: 'dsh-new-version',
    element,
    ...(targetVersionHint ? { targetVersionHint } : {}),
    ...(runtimeHints.channel ? { channelHint: runtimeHints.channel } : {}),
  }
}

export interface UpdateButtonInterceptorOptions {
  /**
   * Whether the changelog surface can take the click right now. The plugin only
   * renders that surface from the `shell.overlay` slot, so until the host
   * declares it there is nothing to show: a swallowed click would leave the user
   * with neither the changelog nor the native download. Returning false keeps
   * the native behavior.
   */
  shouldIntercept?: () => boolean
}

/**
 * Install capture-phase `click` and `keydown` (`Enter`) listeners on `window`
 * so clicking `[↓ 新版本]` opens the changelog modal instead of starting an immediate download.
 * Space is left to the native button: it activates on keyup and arrives here as a click,
 * so handling it twice would open the modal twice.
 */
export function installUpdateButtonInterceptor(
  onIntercept: (trigger: InterceptedTrigger) => void,
  targetWindow: Window | undefined = typeof window !== 'undefined' ? window : undefined,
  options: UpdateButtonInterceptorOptions = {},
): () => void {
  if (!targetWindow || typeof targetWindow.addEventListener !== 'function') {
    return () => {}
  }

  const intercept = (event: Event): void => {
    const matched = matchInterceptableTrigger(event.target, targetWindow.document)
    if (!matched) return
    if (options.shouldIntercept && !options.shouldIntercept()) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    onIntercept(matched)
  }

  const onClickCapture = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    intercept(event)
  }

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return
    if (event.key !== 'Enter') return
    intercept(event)
  }

  targetWindow.addEventListener('click', onClickCapture, true)
  targetWindow.addEventListener('keydown', onKeyDownCapture, true)

  return () => {
    targetWindow.removeEventListener('click', onClickCapture, true)
    targetWindow.removeEventListener('keydown', onKeyDownCapture, true)
  }
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function extractVersionFromStrings(...inputs: string[]): string | undefined {
  for (const input of inputs) {
    if (!input) continue
    const hit = SEMVER_FINDER_RE.exec(input)
    if (hit?.[1]) {
      const parsed = parseSemver(hit[1])
      if (parsed) return parsed.version
    }
  }
  return undefined
}

function findActiveTooltipText(doc: Document | undefined): string {
  if (!doc) return ''
  const tips = doc.querySelectorAll('[role="tooltip"]')
  const texts: string[] = []
  for (const tip of tips) {
    if (tip.textContent) texts.push(tip.textContent)
  }
  return texts.join(' ')
}
