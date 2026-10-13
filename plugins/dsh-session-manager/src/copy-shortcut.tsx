import type { Context } from '@deepseek-ai/cordis'
// ui-workspace's public contracts load the host shortcuts Context augmentation.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef, useState } from 'react'
import { COPY_THREAD_SHORTCUT_ID } from './contracts.ts'
import { COPY_THREAD_COPIED, COPY_THREAD_FAILED, COPY_THREAD_LABEL, COPY_THREAD_NO_SESSION, copyLocale, copyThreadId, type CopyLocale } from './copy-action.ts'
import type { ObservableList } from './session-actions.ts'

export type HostShortcuts = Context['shortcuts']

export async function writeClipboard(value: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard
  if (clipboard === undefined) throw new Error('clipboard unavailable')
  await clipboard.writeText(value)
}

/** Uses the same mainView reference as ui-workspace/src/client/shortcuts.ts.
 * The host registry owns key dispatch, remapping, conflicts, IME and repeat guards.
 */
export function CopyThreadShortcutNotice({ shortcuts, list, locale, currentLocale, writeText = writeClipboard }: {
  shortcuts?: HostShortcuts
  list?: ObservableList
  locale: CopyLocale
  currentLocale: () => string | undefined
  writeText?: (value: string) => Promise<void>
}) {
  const [notice, setNotice] = useState<{ copied: boolean; seq: number } | null>(null)
  const sequence = useRef(0)
  useEffect(() => {
    if (shortcuts === undefined) return
    let active = true
    const notify = (copied: boolean) => {
      if (active) setNotice({ copied, seq: ++sequence.current })
    }
    const binding = { code: 'KeyC', modifiers: ['primary', 'alt'] as const }
    const stop = shortcuts.register({
      id: COPY_THREAD_SHORTCUT_ID as Parameters<HostShortcuts['register']>[0]['id'],
      label: () => COPY_THREAD_LABEL[copyLocale(currentLocale())],
      aliases: ['copy thread id', 'copy session id', '复制线程 ID'],
      defaults: {
        'desktop:windows': binding, 'desktop:macos': binding,
        'web:windows': binding, 'web:macos': binding,
      },
      regions: ['page', 'editable'],
      modals: [],
      resolve(context) {
        const target = Object.values(list?.getSnapshot().byId ?? {})
          .find(row => (row?.retainedBy?.mainView ?? 0) > 0)
        if (target === undefined || context.modal !== null || context.region === 'terminal') {
          return { status: 'blocked', reason: COPY_THREAD_NO_SESSION[copyLocale(currentLocale())] }
        }
        return { status: 'handled', run() {
          void copyThreadId(target.id, writeText).then(
            () => notify(true),
            () => notify(false),
          )
        } }
      },
    })
    return () => { active = false; stop() }
  }, [shortcuts, list, currentLocale, writeText])
  return notice === null ? null : <Toast
    key={notice.seq}
    text={(notice.copied ? COPY_THREAD_COPIED : COPY_THREAD_FAILED)[locale]}
    tone={notice.copied ? 'success' : undefined}
    onDone={() => setNotice(null)}
  />
}
