import type { Context } from '@deepseek-ai/cordis'
import type { ContextMenus } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Input, Modal, Tag, IconFolderCloseRegular, IconPlusOutlineRegular, IconCloseFillRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui'
import { installClientPluginLogger } from '@klarkxy/dsh-plugin-kit/client-logger'
import { PLUGIN_NAME, RPC_CHANNEL, type WorkspaceFoldersSnapshot, type RpcResult } from './contracts.ts'

export const name = 'workspace-folders-client'
export const inject = ['slots', 'contextMenus', 'locale', 'connection', 'uiWorkspace'] as const
export const copy = {
  zh: { menu: '文件夹…', title: '工作区文件夹', note: '修改从下一轮对话生效，主工作目录保持不变。', folders: '文件夹', primary: '主要', add: '添加文件夹', remove: '移除', cancel: '取消', save: '保存', loading: '正在读取…', saving: '正在保存…', browse: '选择文件夹', native: '浏览…', path: '文件夹绝对路径', go: '打开', select: '添加此文件夹', back: '返回', empty: '这里没有子文件夹', truncated: '目录较多，部分子文件夹未显示。可输入完整路径打开。', permission: '附加文件夹遵循会话当前的读写权限。', reload: '重新加载', failed: '操作失败，请重试。', stale: '其他窗口已修改列表，请重新加载后再编辑。', invalid: '请选择有效的绝对目录路径。', missing: '文件夹不存在或无法访问。', gone: '工作区已被移除。', duplicate: '该文件夹已在列表中。' },
  en: { menu: 'Folders…', title: 'Workspace folders', note: 'Changes apply next turn. The primary working directory stays the same.', folders: 'Folders', primary: 'Primary', add: 'Add folder', remove: 'Remove', cancel: 'Cancel', save: 'Save', loading: 'Loading…', saving: 'Saving…', browse: 'Choose a folder', native: 'Browse…', path: 'Absolute directory path', go: 'Open', select: 'Add this folder', back: 'Back', empty: 'No subfolders here', truncated: 'Some subfolders are omitted. Enter a full path to open one.', permission: 'Additional folders follow the current session file permissions.', reload: 'Reload', failed: 'Operation failed. Please try again.', stale: 'The list changed in another window. Reload before editing.', invalid: 'Choose a valid absolute directory path.', missing: 'The directory is missing or cannot be accessed.', gone: 'The workspace has been removed.', duplicate: 'This folder is already in the list.' },
} as const
export type FolderLocale = 'zh' | 'en'
type Call = (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>
type Listing = Awaited<ReturnType<UiWorkspace['listDirectory']>>
type Failure = { code: string; message: string }
const errorOf = (error: unknown): Failure => error instanceof Error ? { code: 'internal', message: error.message } : error as Failure
function failureText(error: Failure, t: typeof copy[FolderLocale]): string {
  const keys: Record<string, 'stale' | 'invalid' | 'missing' | 'gone'> = { stale: 'stale', 'invalid-path': 'invalid', 'bad-request': 'invalid', 'not-directory': 'missing', 'not-found': 'gone' }
  return keys[error.code] ? t[keys[error.code]] : error.message || t.failed
}
async function rpc<T>(call: Call, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  const result = await call(endpoint, payload, signal) as RpcResult<T>
  if (!result?.ok) throw result?.error ?? { code: 'internal', message: '' }
  return result.value
}
const baseName = (value: string) => value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
export const styles = officialUiCss('workspace-folders') + `
.workspace-folders[role="dialog"] { width:min(600px,100%); max-height:100%; }
.workspace-folders .wf-content { min-height:0; overflow-y:auto; }
.workspace-folders .wf-body { display:flex; flex-direction:column; gap:16px; width:100%; }
.workspace-folders .wf-project strong { overflow-wrap:anywhere; }
.workspace-folders .wf-note { margin:0; font-size:13px; color:var(--dsw-alias-label-secondary); line-height:1.6; }
.workspace-folders .wf-project, .workspace-folders .wf-row { display:flex; align-items:center; gap:12px; min-width:0; padding:12px; }
.workspace-folders .wf-project { border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); }
.workspace-folders .wf-list { border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); overflow:hidden; max-height:300px; overflow-y:auto; }
.workspace-folders .wf-row + .wf-row { border-top:1px solid var(--dsw-alias-border-l2); }
.workspace-folders .wf-label { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
.workspace-folders .wf-path { font-size:12px; color:var(--dsw-alias-label-secondary); overflow-wrap:anywhere; }
.workspace-folders .wf-actions { display:flex; justify-content:flex-end; gap:8px; }
.workspace-folders .wf-path-entry { display:flex; gap:8px; align-items:center; }
.workspace-folders .wf-path-entry > :first-child { flex:1; min-width:0; }
.workspace-folders .wf-crumbs { display:flex; flex-wrap:wrap; gap:4px; }
.workspace-folders .wf-browser { max-height:260px; overflow-y:auto; display:flex; flex-direction:column; align-items:stretch; }
.workspace-folders .wf-browser button { justify-content:flex-start; text-align:left; overflow-wrap:anywhere; }
.workspace-folders .wf-error { color:var(--dsw-alias-label-error); font-size:13px; line-height:1.5; }
`

export interface FolderDialogProps {
  workspaceId: string
  locale: FolderLocale
  call: Call
  listDirectory: UiWorkspace['listDirectory']
  pickDirectory?: UiWorkspace['pickDirectory']
  onClose(): void
}
/** A keyed occurrence owns its draft and aborts all reads when closed or switched. */
export function FolderDialog({ workspaceId, locale, call, listDirectory, pickDirectory, onClose }: FolderDialogProps) {
  const t = copy[locale]
  const [record, setRecord] = useState<WorkspaceFoldersSnapshot>()
  const [folders, setFolders] = useState<string[]>([])
  const [error, setError] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [browsing, setBrowsing] = useState(false)
  const [listing, setListing] = useState<Listing>()
  const [pathInput, setPathInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const alive = useRef(false), lock = useRef(false), scan = useRef<AbortController>(), lifetime = useRef<AbortController>()
  useEffect(() => {
    alive.current = true
    const controller = new AbortController(); lifetime.current = controller
    setRecord(undefined); setError(null)
    void rpc<WorkspaceFoldersSnapshot>(call, 'get', { workspaceId }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setRecord(value); setFolders(value.folders)
    }, reason => { if (!controller.signal.aborted) setError(errorOf(reason)) })
    return () => { alive.current = false; controller.abort(); scan.current?.abort() }
  }, [workspaceId, call, reload])
  const close = () => { if (!lock.current) onClose() }
  async function browse(path?: string) {
    scan.current?.abort()
    const controller = new AbortController(); scan.current = controller
    setBrowsing(true); setScanning(true); setListing(undefined); setError(null)
    try {
      const value = await listDirectory(path, controller.signal)
      if (controller.signal.aborted || !alive.current) return
      setListing(value); setPathInput(value.path)
    } catch (reason) {
      if (!controller.signal.aborted && alive.current) setError(errorOf(reason))
    } finally { if (!controller.signal.aborted && alive.current) setScanning(false) }
  }
  const back = () => { scan.current?.abort(); setBrowsing(false); setScanning(false); setError(null) }
  async function pickNative() {
    if (!pickDirectory || lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      const selected = await pickDirectory()
      if (alive.current && selected) setPathInput(selected)
    } catch (reason) { if (alive.current) setError(errorOf(reason)) }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function add() {
    if (!pathInput.trim() || lock.current || scanning) return
    lock.current = true; setBusy(true); setError(null)
    try {
      const value = await rpc<{ path: string }>(call, 'validate', { workspaceId, path: pathInput.trim() }, lifetime.current?.signal)
      if (!alive.current) return
      if (value.path === record?.primaryPath || folders.includes(value.path)) {
        setError({ code: 'duplicate', message: t.duplicate }); return
      }
      setFolders(current => [...current, value.path]); setBrowsing(false)
    } catch (reason) { if (alive.current) setError(errorOf(reason)) }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function save() {
    if (!record || lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      await rpc(call, 'save', { workspaceId, folders, expectedRevision: record.revision }, lifetime.current?.signal)
      if (alive.current) onClose()
    } catch (reason) { if (alive.current) setError(errorOf(reason)) }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  return <Modal open title={browsing ? t.browse : t.title} closeLabel={t.cancel} onClose={close} className="workspace-folders" contentClassName="wf-content">
    <div className="wf-body">
      <p className="wf-note">{t.note}</p>
      {record ? <div className="wf-project"><IconFolderCloseRegular /><strong>{record.title}</strong></div> : !error ? <p role="status">{t.loading}</p> : null}
      {record && !browsing ? <>
        <strong>{t.folders}</strong>
        <div className="wf-list">
          <div className="wf-row"><IconFolderCloseRegular /><div className="wf-label"><span>{baseName(record.primaryPath)}</span><span className="wf-path">{record.primaryPath}</span></div><Tag tone="info">{t.primary}</Tag></div>
          {folders.map(folder => <div className="wf-row" key={folder}><IconFolderCloseRegular /><div className="wf-label"><span>{baseName(folder)}</span><span className="wf-path">{folder}</span></div><Button size="sm" disabled={busy} aria-label={t.remove + ' ' + folder} onClick={() => setFolders(current => current.filter(value => value !== folder))}><IconCloseFillRegular /></Button></div>)}
          <div className="wf-row"><Button disabled={busy} icon={<IconPlusOutlineRegular />} onClick={() => { setPathInput(record.primaryPath); record.pickerKind === 'browse' ? void browse(record.primaryPath) : (setBrowsing(true), setPathInput(''), setError(null)) }}>{t.add}</Button></div>
        </div>
        <p className="wf-note">{t.permission}</p>
      </> : null}
      {browsing ? <>
        <form className="wf-path-entry" onSubmit={event => { event.preventDefault(); if (!busy && pathInput.trim()) { if (record?.pickerKind === 'browse') void browse(pathInput.trim()); else void add() } }}>
          <Input aria-label={t.path} value={pathInput} onChange={event => setPathInput(event.target.value)} disabled={busy} />
          {record?.pickerKind === 'browse' ? <Button type="submit" variant="outline" disabled={busy || !pathInput.trim()}>{t.go}</Button> : record?.pickerKind === 'native' && pickDirectory ? <Button variant="outline" disabled={busy} onClick={() => void pickNative()}>{t.native}</Button> : null}
        </form>
        {listing ? <><nav className="wf-crumbs" aria-label={t.path}>{listing.crumbs.map(crumb => <Button size="sm" key={crumb.path} disabled={busy} onClick={() => void browse(crumb.path)}>{crumb.name}</Button>)}</nav>
          <div className="wf-browser">{listing.entries.map(entry => <Button key={entry.path} disabled={busy} icon={<IconFolderCloseRegular />} onClick={() => void browse(entry.path)}>{entry.name}</Button>)}{!listing.entries.length ? <p className="wf-note">{t.empty}</p> : null}</div>
          {listing.truncated ? <p className="wf-note">{t.truncated}</p> : null}</> : scanning ? <p role="status">{t.loading}</p> : null}
      </> : null}
      {error ? <div role="alert" className="wf-error">{failureText(error, t)}{!browsing && (!record || error.code === 'stale') ? <Button disabled={busy} onClick={() => setReload(value => value + 1)}>{t.reload}</Button> : null}</div> : null}
      <div className="wf-actions">{browsing ? <><Button variant="outline" onClick={back} disabled={busy}>{t.back}</Button><Button variant="primary" onClick={() => void add()} disabled={busy || scanning || !pathInput.trim()}>{t.select}</Button></> : <><Button variant="outline" onClick={close} disabled={busy}>{t.cancel}</Button><Button variant="primary" onClick={() => void save()} disabled={busy || !record}>{busy ? t.saving : t.save}</Button></>}</div>
    </div>
  </Modal>
}

interface Client {
  locale: { getSnapshot(): { active: string }; subscribe(listener: () => void): () => void }
  contextMenus: ContextMenus
  uiWorkspace: UiWorkspace
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> } }
  slots: { inject(name: string, callback: () => () => void): () => void; register(spec: Record<string, unknown>, render: () => unknown): () => void }
}
export function apply(ctx: Context): void {
  const logger = installClientPluginLogger(ctx, PLUGIN_NAME)
  const client = ctx as unknown as Client
  let target: { workspaceId: string; occurrence: number } | null = null, serial = 0
  const listeners = new Set<() => void>()
  const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
  const snapshot = () => target
  const publish = (value: typeof target) => { target = value; for (const listener of listeners) listener() }
  const call: Call = async (endpoint, payload, signal) => {
    try {
      return await client.connection.rpc.call(RPC_CHANNEL, endpoint, payload, signal)
    } catch (error) {
      if (!signal?.aborted) logger.warn('rpc.call-failed', 'Workspace folders RPC call failed.', error, { endpoint })
      throw error
    }
  }
  const listDirectory: UiWorkspace['listDirectory'] = (path, signal) => client.uiWorkspace.listDirectory(path, signal)
  const localeSnapshot = () => client.locale.getSnapshot().active.startsWith('zh') ? 'zh' as const : 'en' as const
  const subscribeLocale = (fn: () => void) => client.locale.subscribe(fn)
  function Overlay() {
    const selected = useSyncExternalStore(subscribe, snapshot), locale = useSyncExternalStore(subscribeLocale, localeSnapshot)
    return <><style>{styles}</style>{selected ? <FolderDialog key={selected.workspaceId + ':' + selected.occurrence} workspaceId={selected.workspaceId} locale={locale} call={call} listDirectory={listDirectory} pickDirectory={() => client.uiWorkspace.pickDirectory()} onClose={() => publish(null)} /> : null}</>
  }
  ctx.effect(() => client.slots.inject('shell.overlay', () => client.slots.register({ name: 'shell.overlay', id: 'workspace-folders', order: 45 }, Overlay)), 'workspace-folders.overlay')
  ctx.effect(() => client.contextMenus.register({ id: 'workspace.folders', target: 'workspace', order: 200,
    observe: () => [client.locale],
    resolve: ({ workspaceId }) => [{ id: 'folders', label: copy[localeSnapshot()].menu, run: () => publish({ workspaceId, occurrence: ++serial }) }],
  }), 'workspace-folders.menu')
  ctx.effect(() => () => { publish(null); listeners.clear() }, 'workspace-folders.client')
}
