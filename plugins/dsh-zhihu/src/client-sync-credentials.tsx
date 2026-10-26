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

/** 成对保存时的挂起标记；它与凭据引用名不同，不会撞上字段的「保存中…」。 */
const PAIR_PENDING = 'pair'

const GRANT_KEY = /ZHIHU_OPENAPI_APP_KEY\s*[:=]\s*"([^"\r\n]+)"/
const GRANT_SECRET = /ZHIHU_OPENAPI_APP_SECRET\s*[:=]\s*"([^"\r\n]+)"/
const GRANT_MARKER = /ZHIHU_OPENAPI_APP_(?:KEY|SECRET)/

/**
 * 知乎发布助手把授权说明和两项凭据放在同一段文字里。只在两项都用引号写出时拆开；
 * 单独粘贴的 Key 或 Secret 保持原样，避免把普通文本误存成另一项。
 */
export function parseZhihuPublisherGrant(value: string): { appKey: string; appSecret: string } | null {
  const key = GRANT_KEY.exec(value)
  const secret = GRANT_SECRET.exec(value)
  if (!key || !secret) return null
  const appKey = key[1].trim()
  const appSecret = secret[1].trim()
  if (!appKey || !appSecret || appKey === appSecret) return null
  return { appKey, appSecret }
}

/**
 * 文字里出现了凭据标记，但没能按受支持的格式读出两项凭据。这样的文本不能当凭据存：
 * 整段授权说明一旦落进密钥框，格式稍有出入就会变成一个坏凭据，而且要到发布时才报错。
 */
export function looksLikeZhihuPublisherGrant(value: string): boolean {
  return GRANT_MARKER.test(value)
}

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
  plain?: boolean
}[] = [
  {
    ref: ZHIHU_APP_SECRET_REF,
    label: 'App Secret',
    zh: '知乎发布助手的应用密钥',
    en: 'Publisher app secret',
    hintZh: '知乎发布助手签发的应用密钥。整段授权说明粘贴在这里时，下面会自动填入用户名。',
    hintEn: 'The app secret issued by the Zhihu publisher. Pasting the authorization text here fills in the username below.',
  },
  {
    ref: ZHIHU_APP_KEY_REF,
    label: 'App Key',
    zh: '知乎主页用户名',
    en: 'Profile username',
    hintZh: '知乎个人主页地址里的用户名，例如 www.zhihu.com/people/<你的用户名>。这不是密钥，以明文显示。',
    hintEn: 'The username in your Zhihu profile URL, e.g. www.zhihu.com/people/<your username>. This is not a secret and is shown in plain text.',
    plain: true,
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
  const [paired, setPaired] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [confirmRef, setConfirmRef] = useState<string | null>(null)
  const [failure, setFailure] = useState<ClientText>('')
  const [note, setNote] = useState<ClientText>('')

  // describe 报告 writable=false 时，这份凭据当前不在可写来源里：界面按只读呈现，
  // 保存时也跳过它，不把用户没有在界面上编辑过的值写进去。
  const views: Record<string, CredentialView> = state.status === 'ready' ? state.credentials : {}
  const writable = (ref: string) => views[ref]?.writable !== false

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

  const save = async (refs: string[]) => {
    if (pending !== null) return
    // 只写这次明确要写的项：单个「保存」只写那一个字段，「保存两项」才写两个。
    const writes = refs
      .map(ref => ({ ref, value: (drafts[ref] ?? '').trim() }))
      .filter(item => item.value && writable(item.ref))
    if (!writes.length) return
    setPending(refs.length > 1 ? PAIR_PENDING : refs[0]!)
    setFailure('')
    setNote('')
    try {
      for (const write of writes) {
        const result = await credentials.set(write)
        if (!alive.current) return
        if (!result.ok) { setFailure(result.error.message); return }
      }
      setDrafts(current => {
        const next = { ...current }
        for (const write of writes) delete next[write.ref]
        return next
      })
      setPaired(false)
      setNote(writes.length > 1
        ? ['已保存用户名与密钥。', 'Saved the username and the secret.']
        : ['已保存。', 'Saved.'])
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
      // 明确清掉一项，这一对就不再成立。
      setPaired(false)
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
  // 这一对还在、两项都有内容时才给「保存两项」：写入范围写在按钮上，不藏在单个「保存」后面。
  const pairReady = paired
    && (drafts[ZHIHU_APP_KEY_REF] ?? '').trim() !== ''
    && (drafts[ZHIHU_APP_SECRET_REF] ?? '').trim() !== ''

  return (
    <section className="dsh-ui-stack" aria-label={t('知乎发布助手凭据', 'Zhihu publisher credentials')}>
      <h4 className="dsh-ui-heading">{t('知乎发布助手', 'Zhihu publisher')}</h4>
      <p className="dsh-ui-help">
        {t(
          '发布助手使用另一组应用凭据，与搜索用的 Access Secret 无关。把知乎给出的授权说明粘贴到上面的密钥框即可，两项凭据要写成 ZHIHU_OPENAPI_APP_KEY:"…" 与 ZHIHU_OPENAPI_APP_SECRET:"…" 的形式，用户名会自动填到下面。',
          'The publisher uses its own app credentials, separate from the search Access Secret. Paste Zhihu’s authorization text into the secret field above — both credentials must be written as ZHIHU_OPENAPI_APP_KEY:"…" and ZHIHU_OPENAPI_APP_SECRET:"…" — and the username fills in below.',
        )}{' '}
        <PublisherLink url={ZHIHU_PUBLISHER_URL}>{t('申请凭据', 'Get credentials')}</PublisherLink>
      </p>
      {paired ? <p className="dsh-ui-hint">{t('这两项来自同一段授权说明，可以一起保存。', 'These two came from the same authorization text and can be saved together.')}</p> : null}
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
              type: field.plain ? 'text' : 'password',
              value: draft,
              disabled: locked || pending !== null,
              'aria-label': field.label,
              'aria-describedby': `zhihu-sync-cred-${field.ref}`,
              placeholder: locked ? t('由环境变量提供', 'Set by an environment variable') : t('粘贴凭据', 'Paste the credential'),
              onChange: value => {
                const grant = parseZhihuPublisherGrant(value)
                if (grant) {
                  // 整段授权说明：两项凭据分别落到可写的字段，只读的那份不动它。
                  const next: Record<string, string> = {}
                  if (writable(ZHIHU_APP_KEY_REF)) next[ZHIHU_APP_KEY_REF] = grant.appKey
                  if (writable(ZHIHU_APP_SECRET_REF)) next[ZHIHU_APP_SECRET_REF] = grant.appSecret
                  setDrafts(current => ({ ...current, ...next }))
                  setPaired(true)
                  setFailure('')
                  setNote(Object.keys(next).length === 2
                    ? ['已从授权说明读出用户名与密钥。', 'Read the username and the secret from the authorization text.']
                    : ['已从授权说明读出一项凭据；另一项当前是只读的，不会被改动。', 'Read one credential from the authorization text; the other is read-only and is left alone.'])
                  return
                }
                if (looksLikeZhihuPublisherGrant(value)) {
                  // 有凭据标记却读不出两项：整段原文不能当成凭据存下去。
                  setFailure([
                    '这段文字里有知乎凭据标记，但没能读出 App Key 与 App Secret。请确认两项都写成 ZHIHU_OPENAPI_APP_KEY:"…" 与 ZHIHU_OPENAPI_APP_SECRET:"…" 的形式。',
                    'This text contains Zhihu credential markers, but no App Key and App Secret could be read from it. Both must be written as ZHIHU_OPENAPI_APP_KEY:"…" and ZHIHU_OPENAPI_APP_SECRET:"…".',
                  ])
                  setNote('')
                  return
                }
                setDrafts(current => ({ ...current, [field.ref]: value }))
                // 明确清空一个字段，这一对就不再成立。
                if (!value.trim()) setPaired(false)
                setFailure('')
                setNote('')
              },
            })}
            <div className="dsh-ui-actions">
              <ZhihuButton
                variant="primary"
                disabled={locked || pending !== null || draft.trim() === ''}
                onClick={() => void save([field.ref])}>
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
      {pairReady ? (
        <div className="dsh-ui-actions">
          <ZhihuButton
            variant="primary"
            disabled={pending !== null}
            onClick={() => void save([ZHIHU_APP_KEY_REF, ZHIHU_APP_SECRET_REF])}>
            {pending === PAIR_PENDING ? t('保存中…', 'Saving…') : t('保存两项', 'Save both')}
          </ZhihuButton>
        </div>
      ) : null}
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
