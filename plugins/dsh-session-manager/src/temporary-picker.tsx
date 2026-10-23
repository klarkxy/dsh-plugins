import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { Button, IconFolderCloseRegular, IconNewChatOutlineRegular, IconPlusOutlineRegular, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { TEMP_WORKSPACE_FLOW_SLOT } from './contracts.ts'
import { FREE_CHAT_ROOT } from './styles.ts'
import { copyLocale, uiText, type CopyLocale } from './ui-copy.ts'
import type { TemporaryWorkspaceModel } from './temporary-workspace.ts'

const PICKER_SLOT = 'conversation.hero.workspace'
const DIRECTORY_SLOT = 'conversation.hero.workspace.directoryFlow'

/** Public registry faces used by the version-bounded directory-flow compatibility adapter. */
export interface PickerRegistry {
  inject(key: string, callback: () => (() => void) | void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
  entriesOfSlot(key: string): readonly StoredEntry[]
  spec(key: string): { kind: string; scope: string } | undefined
  subscribe(key: string, listener: () => void): () => void
  onEntryError?(listener: (key: string, entry: StoredEntry, error: unknown) => void): () => void
}

/** Keep the host's native/web picker implementation and its injected capabilities.
 * Standard rc.2 offers no exported directory-flow factory. Only its simple root
 * registration can be mirrored; more complex future registrations restore the host picker.
 * Original entries and their ownership ledger are never changed.
 */
export function installTemporaryWorkspacePicker(slots: PickerRegistry, model: TemporaryWorkspaceModel,
  createWorkspace: (path: string) => Promise<{ workspaceId: string }>, locale?: {
    getSnapshot(): { active: string }; subscribe(listener: () => void): () => void
  }): () => void {
  if (typeof slots.entriesOfSlot !== 'function' || typeof slots.spec !== 'function' || typeof slots.subscribe !== 'function') {
    model.reportFailure(copyLocale(locale?.getSnapshot().active) === 'zh'
      ? '当前版本无法扩展工作区菜单，已保留原菜单。' : 'Could not extend the workspace menu. The original menu has been preserved.')
    return () => {}
  }
  return slots.inject(PICKER_SLOT, () => {
    let mirror: StoredEntry | undefined, stopMirror = () => {}, restored = false
    const failureMessage = () => copyLocale(locale?.getSnapshot().active) === 'zh'
      ? '当前版本无法扩展工作区菜单，已保留原菜单。' : 'Could not extend the workspace menu. The original menu has been preserved.'
    const renderPicker = (props: PickerProps) => <TemporaryWorkspacePicker {...props} model={model} createWorkspace={createWorkspace} locale={locale}
      getDirectoryFlow={() => mirror} subscribeFlow={listener => slots.subscribe(DIRECTORY_SLOT, listener)} />
    const stopPicker = slots.register({ name: PICKER_SLOT, priority: -10, locale: 'workspace',
      children: { [TEMP_WORKSPACE_FLOW_SLOT]: { kind: 'single', scope: 'root' } },
    }, renderPicker)
    const stopErrors = slots.onEntryError?.((key, entry) => {
      if (restored || (key !== TEMP_WORKSPACE_FLOW_SLOT && !(key === PICKER_SLOT && entry.component === renderPicker))) return
      restored = true; stopMirror(); mirror = undefined; stopPicker()
      model.reportFailure(failureMessage())
    }) ?? (() => {})
    const sync = () => {
      if (restored) return
      const next = slots.entriesOfSlot(DIRECTORY_SLOT)[0]
      if (next === mirror) return
      stopMirror(); stopMirror = () => {}; mirror = undefined
      if (next === undefined) return
      const spec = slots.spec(DIRECTORY_SLOT)
      if (spec?.kind !== 'single' || spec.scope !== 'root' || typeof next.component !== 'function'
        || next.children !== undefined || next.store !== undefined || next.locale !== undefined || next.select !== undefined) {
        restored = true; stopPicker()
        model.reportFailure(failureMessage())
        return
      }
      try {
        stopMirror = slots.register({ name: TEMP_WORKSPACE_FLOW_SLOT, ...next.inject ? { inject: next.inject } : {} }, next.component)
        mirror = next
      } catch (error) {
        restored = true; stopPicker()
        model.reportFailure(error instanceof Error ? error.message : 'Could not extend the workspace picker')
      }
    }
    const stopSource = slots.subscribe(DIRECTORY_SLOT, sync)
    sync()
    return () => { restored = true; stopErrors(); stopSource(); stopMirror(); stopPicker() }
  })
}

/** Standard conversation hero owner share; some published type graphs omit its merge. */
type PickerProps = Pick<WorkspacePickerProps, 'useWorkspaces'> & {
  open: boolean
  anchorRef?: RefObject<HTMLElement | null>
  selectedId?: string
  onPick(workspaceId: string): void
  onClose(): void
  t(key: string): string
  renderSlot(key: typeof TEMP_WORKSPACE_FLOW_SLOT, owner: DirectoryFlowOwnerProps): ReactNode
}

function TemporaryWorkspacePicker(props: PickerProps & {
  model: TemporaryWorkspaceModel; createWorkspace(path: string): Promise<{ workspaceId: string }>
  getDirectoryFlow(): StoredEntry | undefined; subscribeFlow(listener: () => void): () => void
  locale?: { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
}) {
  const workspaces = props.useWorkspaces(snapshot => snapshot)
  const state = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot)
  const source = useSyncExternalStore(props.subscribeFlow, props.getDirectoryFlow, props.getDirectoryFlow)
  const available = source !== undefined
  const locale = copyLocale(useSyncExternalStore(listener => props.locale?.subscribe(listener) ?? (() => {}),
    () => props.locale?.getSnapshot().active ?? 'en', () => 'en'))
  const [flowOpen, setFlowOpen] = useState(false), [adopting, setAdopting] = useState(false)
  const [failure, setFailure] = useState<string>()
  const epoch = useRef(0)
  useEffect(() => () => { epoch.current++ }, [])
  useEffect(() => { epoch.current++; setFlowOpen(false); setAdopting(false) }, [source])
  const busy = flowOpen || adopting || state.creating
  const getAnchorRect = useCallback(() => props.anchorRef?.current?.getBoundingClientRect() ?? null, [props.anchorRef])
  const openDirectory = () => { props.onClose(); setFailure(undefined); setFlowOpen(true) }
  return <>
    <Menu open={props.open} anchor={null} portal getAnchorRect={getAnchorRect} selectedId={props.selectedId}
      onClose={props.onClose} items={workspaces.items.map(workspace => ({ id: workspace.workspaceId,
        // The standard registry's first-use title is language-neutral; all user titles stay verbatim.
        label: workspace.title === 'default-workspace' ? props.t('workspace.defaultName') : workspace.title,
        icon: <IconFolderCloseRegular size={16} />, disabled: busy }))}
      footer={[
        ...available ? [{ id: '::add-workspace', label: props.t('menu.addWorkspace'), icon: <IconPlusOutlineRegular size={16} />, disabled: busy }] : [],
        { id: '::temporary-workspace', label: uiText(locale, 'tempWorkspace'), icon: <IconNewChatOutlineRegular size={16} />, disabled: busy },
      ]}
      onSelect={id => {
        if (id === '::add-workspace') openDirectory()
        else if (id === '::temporary-workspace') { props.onClose(); void props.model.create() }
        else props.onPick(id as never)
      }} />
    {/* The picker renders straight into the host's conversation.hero.workspace
     * slot with no plugin-rooted ancestor, so the loading line carries the root
     * class itself for the dsh-ui-loading recipe to reach it. */}
    {props.open && workspaces.phase === 'pending' && <span role="status" className={`${FREE_CHAT_ROOT} dsh-ui-loading`}>{props.t('picker.loading')}</span>}
    {props.renderSlot(TEMP_WORKSPACE_FLOW_SLOT, {
      open: flowOpen, busy: adopting,
      onCancel: () => { epoch.current++; setFlowOpen(false); setAdopting(false) },
      onError: message => { epoch.current++; setFlowOpen(false); setAdopting(false); setFailure(message) },
      onPicked: path => {
        if (adopting) return
        const ticket = ++epoch.current
        setAdopting(true)
        void props.createWorkspace(path).then(workspace => {
          if (ticket !== epoch.current) return
          setFlowOpen(false); props.onPick(workspace.workspaceId as never)
        }, error => {
          if (ticket !== epoch.current) return
          setFlowOpen(false); setFailure(error instanceof Error ? error.message : String(error))
        }).finally(() => { if (ticket === epoch.current) setAdopting(false) })
      },
    })}
    <Modal open={failure !== undefined} className={FREE_CHAT_ROOT} title={props.t('folderError.title')} closeLabel={props.t('close')}
      onClose={() => setFailure(undefined)} footer={<>
        <Button variant="outline" onClick={() => setFailure(undefined)}>{props.t('cancel')}</Button>
        <Button variant="primary" disabled={!available} onClick={openDirectory}>{props.t('folderError.retry')}</Button>
      </>}><p role="alert">{failure}</p></Modal>
  </>
}

export function TemporaryWorkspaceNotice({ model, locale }: { model: TemporaryWorkspaceModel; locale: CopyLocale }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  return <Modal open={state.failure !== undefined} className={FREE_CHAT_ROOT} title={uiText(locale, 'createFailed')}
    closeLabel={uiText(locale, 'close')} onClose={model.dismissFailure} footer={<>
      <Button variant="outline" onClick={model.dismissFailure}>{uiText(locale, 'close')}</Button>
      <Button variant="primary" disabled={state.creating} onClick={() => { void model.create() }}>{uiText(locale, 'retry')}</Button>
    </>}><p role="alert">{state.failure}</p></Modal>
}
