/** Clipboard result shown on the session-row menu. */

export type CopyLocale = 'zh' | 'en'

export const COPY_THREAD_LABEL: Record<CopyLocale, string> = {
  zh: '复制线程 ID',
  en: 'Copy thread ID',
}

export const COPY_THREAD_FAILED: Record<CopyLocale, string> = {
  zh: '无法复制线程 ID',
  en: 'Could not copy the thread ID',
}

export function copyLocale(active: string | undefined): CopyLocale {
  return active?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** Copy one session id. Rejection stays with the caller so the menu can show it. */
export async function copyThreadId(sessionId: string, writeText: (value: string) => Promise<void>): Promise<void> {
  await writeText(sessionId)
}

export function copyMenuState(ok: boolean, locale: CopyLocale): { close: boolean; failure?: string } {
  return ok ? { close: true } : { close: false, failure: COPY_THREAD_FAILED[locale] }
}
