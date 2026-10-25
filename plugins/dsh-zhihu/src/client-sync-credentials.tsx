/**
 * 知乎发布助手的应用凭据设置。
 *
 * 只有插件设置页（plugins.bundle.config）里才有这段表单：右侧栏工作台不发凭据，
 * 也不重复提供入口。凭据本身由宿主管理（remote.credentials），插件只读写引用。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ZhihuRpcResult } from './contracts.ts'
import { clientText, useT, type ClientText } from './client-locale.ts'
import { renderInput, ZhihuButton } from './client-host-ui.tsx'

export const ZHIHU_APP_KEY_REF = 'ZHIHU_OPENAPI_APP_KEY'
export const ZHIHU_APP_SECRET_REF = 'ZHIHU_OPENAPI_APP_SECRET'

/** 宿主侧的发布助手凭据引用（与 sync-service 的 ZHIHU_SYNC_CREDENTIAL_REFS 一致）。 */
export const ZHIHU_SYNC_CREDENTIAL_REFS = [ZHIHU_APP_KEY_REF, ZHIHU_APP_SECRET_REF] as const

/** 申请发布助手应用凭据的官方入口。 */
export const ZHIHU_PUBLISHER_URL = 'https://www.zhihu.com/playground/zhihu-publisher'

type CredentialView = { configured: boolean; source?: string; writable: boolean }

export type SyncCredentialsApi = {
  describe: (request: { refs: string[] }) => Promise<ZhihuRpcResult<{ credentials: Record<string, CredentialView> }>>
  set: (request: { ref: string; value: string }) => Promise<ZhihuRpcResult<Record<string, never>>>
  unset: (request: { ref: string }) => Promise<ZhihuRpcResult<Record<string, never>>>
}

type CredentialLoad =
  | { status: 'loading' }
  | { status: 'ready'; credentials: Record<string, CredentialView> }
  | { status: 'error'; error: ClientText }

const FIELD_COPY: readonly {
  ref: string
  label: string
  zh: string
  en: string
  hintZh: string
  hintEn: string
}[] = [
  {
    ref: ZHIHU_APP_KEY_REF,
    label: 'App Key',
    zh: '知乎主页 urlToken',
    en: 'Profile urlToken',
    hintZh: '知乎个人主页地址里的标识，例如 www.zhihu.com/people/<你的 urlToken>。',
    hintEn: 'The identifier in your Zhihu profile URL, e.g. www.zhihu.com/people/<your urlToken>.',
  },
  {
    ref: ZHIHU_APP_SECRET_REF,
    label: 'App Secret',
    zh: '知乎发布助手的应用密钥',
    en: 'Publisher app secret',
    hintZh: '知乎发布助手签发的应用密钥。',
    hintEn: 'The app secret issued by the Zhihu publisher.',
  },
]

/** 只有 http(s) 可以成为链接；其余一律降级为文本。 */
function safeUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null
}

function PublisherLink(props: { url: string; children: ReactNode }): ReactNode {
  const url = safeUrl(props.url)
  if (!url) return <span>{props.children}</span>
  return <a className="zhihu-link" href={url} target="_blank" rel="noreferrer noopener">{props.children}</a>
}

export function ZhihuSyncCredentials(props: { credentials: SyncCredentialsApi }) {
  const t = useT()
  const { credentials } = props
  const alive = useRef(false)
  const [state, setState] = useState<CredentialLoad>({ status: 'loading' })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<string | null>(null)
  const [confirmRef, setConfirmRef] = useState<string | null>(null)
  const [failure, setFailure] = useState<ClientText>('')
  const [note, setNote] = useState<ClientText>('')

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const load = useCallback(async () => {
    setState(current => (current.status === 'ready' ? current : { status: 'loading' }))
    try {
      const result = await credentials.describe({ refs: FIELD_COPY.map(field => field.ref) })
      if (!alive.current) return
      if (!result.ok) { setState({ status: 'error', error: result.error.message }); return }
      setState({ status: 'ready', credentials: result.value.credentials })
    } catch (cause) {
      if (!alive.current) return
      setState({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) })
    }
  }, [credentials])

  useEffect(() => { void load() }, [load])

  const save = async (ref: string) => {
    const value = (drafts[ref] ?? '').trim()
    if (!value || pending !== null) return
    setPending(ref)
    setFailure('')
    setNote('')
    try {
      const result = await credentials.set({ ref, value })
      if (!alive.current) return
      if (!result.ok) { setFailure(result.error.message); return }
      setDrafts(current => ({ ...current, [ref]: '' }))
      setNote(['已保存。', 'Saved.'])
      await load()
    } catch (cause) {
      if (!alive.current) return
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setPending(null)
    }
  }

  const clear = async (ref: string) => {
    setConfirmRef(null)
    if (pending !== null) return
    setPending(ref)
    setFailure('')
    setNote('')
    try {
      const result = await credentials.unset({ ref })
      if (!alive.current) return
      if (!result.ok) { setFailure(result.error.message); return }
      setDrafts(current => ({ ...current, [ref]: '' }))
      setNote(['已清除。', 'Cleared.'])
      await load()
    } catch (cause) {
      if (!alive.current) return
      setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (alive.current) setPending(null)
    }
  }

  if (state.status === 'loading') {
    return <section className="dsh-ui-stack" aria-label={t('知乎发布助手凭据', 'Zhihu publisher credentials')}>
      <p className="dsh-ui-loading" role="status">{t('正在读取凭据状态…', 'Loading credential status…')}</p>
    </section>
  }

  if (state.status === 'error') {
    return <section className="dsh-ui-stack" aria-label={t('知乎发布助手凭据', 'Zhihu publisher credentials')}>
      <p className="dsh-ui-error" role="alert">{clientText(state.error, t)}</p>
      <div className="dsh-ui-actions">
        <ZhihuButton onClick={() => void load()}>{t('重试', 'Retry')}</ZhihuButton>
      </div>
    </section>
  }

  const confirmed = confirmRef ? FIELD_COPY.find(field => field.ref === confirmRef) : undefined

  return (
    <section className="dsh-ui-stack" aria-label={t('知乎发布助手凭据', 'Zhihu publisher credentials')}>
      <h4 className="dsh-ui-heading">{t('知乎发布助手', 'Zhihu publisher')}</h4>
      <p className="dsh-ui-help">
        {t(
          '发布助手使用另一组应用凭据，与搜索用的 Access Secret 无关。',
          'The publisher uses its own app credentials, separate from the search Access Secret.',
        )}{' '}
        <PublisherLink url={ZHIHU_PUBLISHER_URL}>{t('申请凭据', 'Get credentials')}</PublisherLink>
      </p>
      {FIELD_COPY.map(field => {
        const view = state.credentials[field.ref]
        const locked = view?.writable === false
        const configured = view?.configured === true
        const draft = drafts[field.ref] ?? ''
        return (
          <div key={field.ref} className="dsh-ui-field">
            <div className="dsh-ui-label-row">
              <span className="dsh-ui-label" id={`zhihu-sync-cred-${field.ref}`}>{field.label}</span>
              <span className="dsh-ui-row">
                <StateDot state={locked ? 'warning' : configured ? 'done' : 'idle'} />
                <span className="dsh-ui-meta">
                  {locked
                    ? t('由环境变量提供（只读）', 'Provided by an environment variable (read-only)')
                    : configured
                      ? t('已保存', 'Saved')
                      : t('未配置', 'Not set')}
                </span>
              </span>
            </div>
            <p className="dsh-ui-hint">{t(field.hintZh, field.hintEn)}</p>
            {renderInput({
              type: 'password',
              value: draft,
              disabled: locked || pending !== null,
              'aria-label': field.label,
              'aria-describedby': `zhihu-sync-cred-${field.ref}`,
              placeholder: locked ? t('由环境变量提供', 'Set by an environment variable') : t('粘贴凭据', 'Paste the credential'),
              onChange: value => {
                setDrafts(current => ({ ...current, [field.ref]: value }))
                setNote('')
              },
            })}
            <div className="dsh-ui-actions">
              <ZhihuButton
                variant="primary"
                disabled={locked || pending !== null || draft.trim() === ''}
                onClick={() => void save(field.ref)}>
                {pending === field.ref ? t('保存中…', 'Saving…') : t('保存', 'Save')}
              </ZhihuButton>
              {/* 只读凭据由环境变量提供，界面不能也不必清除它。 */}
              {locked ? null : (
                <ZhihuButton
                  variant="danger"
                  disabled={pending !== null || !configured}
                  onClick={() => setConfirmRef(field.ref)}>
                  {pending === field.ref ? t('清除中…', 'Clearing…') : t('清除', 'Clear')}
                </ZhihuButton>
              )}
            </div>
          </div>
        )
      })}
      {note ? <p className="dsh-ui-notice" role="status">{clientText(note, t)}</p> : null}
      {failure ? <p className="dsh-ui-error" role="alert">{clientText(failure, t)}</p> : null}
      <Modal
        open={confirmed !== undefined}
        onClose={() => setConfirmRef(null)}
        title={t('清除发布助手凭据？', 'Clear the publisher credentials?')}
        closeLabel={t('关闭', 'Close')}
        // 对话框挂到 body，根类名要跟着它，否则面板里的样式不生效。
        className="zhihu-panel"
        footer={<div className="dsh-ui-actions">
          <ZhihuButton onClick={() => setConfirmRef(null)}>{t('取消', 'Cancel')}</ZhihuButton>
          <ZhihuButton variant="danger" onClick={() => { if (confirmed) void clear(confirmed.ref) }}>
            {t('清除', 'Clear')}
          </ZhihuButton>
        </div>}>
        <p className="dsh-ui-help">
          {t(
            '清除后，发布与预览会失败，直到重新填写凭据。',
            'Publishing and previewing fail until you enter the credentials again.',
          )}
        </p>
      </Modal>
    </section>
  )
}
