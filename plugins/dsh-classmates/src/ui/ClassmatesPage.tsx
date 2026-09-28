import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, SegmentedTabs, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type {
  ClassmatesClient,
  ClassmatesState,
  ClassmateDefinition,
  ModelChoice,
} from '../contracts.js';
import { createPresets } from '../presets.js';
import { isAbortError, isHandoffBusy } from './handoff.js';
import {
  findModel,
  formatRoleModelSummary,
  roleHealth,
  type RoleHealth,
} from './roles.js';
import { classmatesCss } from './styles.js';
import { ModelsPage } from './ModelsPage.js';

export interface ClassmatesPageProps {
  client: ClassmatesClient;
}

type LoadStatus = 'loading' | 'load-error' | 'ready';
type BusyAction = 'save' | 'remove' | 'reload' | 'toggle' | null;

type FieldKey = 'name' | 'description' | 'instructions' | 'model' | 'effort';
type FieldErrors = Partial<Record<FieldKey, string>>;

const HEALTH_LABEL: Record<RoleHealth, string> = {
  enabled: '已启用',
  disabled: '已停用',
  unconfigured: '未配置',
  invalid: '配置错误',
};

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 200;
export const INSTRUCTIONS_MAX = 32000;

function validateDraft(draft: ClassmateDefinition, models: ModelChoice[]): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.name.trim()) {
    errors.name = '请填写名称。';
  } else if (draft.name.length > NAME_MAX) {
    errors.name = `名称不能超过 ${NAME_MAX} 个字符（当前 ${draft.name.length}）。`;
  }
  if (!draft.description.trim()) {
    errors.description = '请填写职责说明。';
  } else if (draft.description.length > DESCRIPTION_MAX) {
    errors.description = `职责说明不能超过 ${DESCRIPTION_MAX} 个字符（当前 ${draft.description.length}）。`;
  }
  if (!draft.instructions.trim()) {
    errors.instructions = '请填写工作指令。';
  } else if (draft.instructions.length > INSTRUCTIONS_MAX) {
    errors.instructions = `工作指令不能超过 ${INSTRUCTIONS_MAX} 个字符（当前 ${draft.instructions.length}）。`;
  }
  if (draft.enabled && draft.model && !findModel(models, draft.model)) {
    errors.model = '所选模型当前不可用，请清除模型绑定后启用。';
  }
  const effort = draft.reasoningEffort ?? draft.model?.reasoningEffort;
  if (draft.enabled && effort) {
    const chosen = draft.model ? findModel(models, draft.model) : undefined;
    const options = draft.model ? chosen?.efforts ?? [] : models.flatMap(model => model.efforts);
    if (!options.some(option => option.id === effort)) {
      errors.effort = '绑定的思考强度当前不可用，请清除模型绑定后启用。';
    }
  }
  return errors;
}

function snapshot(role: ClassmateDefinition): string {
  return JSON.stringify({
    name: role.name,
    description: role.description,
    instructions: role.instructions,
    enabled: role.enabled,
    model: role.model ? { provider: role.model.provider, id: role.model.id } : null,
    reasoningEffort: role.reasoningEffort ?? role.model?.reasoningEffort,
  });
}

function cloneRole(role: ClassmateDefinition): ClassmateDefinition {
  return {
    ...role,
    model: role.model ? { provider: role.model.provider, id: role.model.id } : null,
    reasoningEffort: role.reasoningEffort ?? role.model?.reasoningEffort,
  };
}

function createDraft(): ClassmateDefinition {
  return {
    schemaVersion: 1,
    id: `role-${crypto.randomUUID()}`,
    revision: 0,
    name: '',
    description: '',
    instructions: '',
    enabled: false,
    model: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function modelLabel(role: ClassmateDefinition, models: ModelChoice[]): string {
  return formatRoleModelSummary(role, models);
}

const presets = createPresets();

const CLASSMATES_TABS = [
  { value: 'roles', label: '模板', id: 'classmates-tab-roles', panelId: 'classmates-panel-roles' },
  { value: 'models', label: '模型', id: 'classmates-tab-models', panelId: 'classmates-panel-models' },
] as const;

function StatusBadge({ health }: { health: RoleHealth }) {
  const state = { enabled: 'done', disabled: 'idle', unconfigured: 'warning', invalid: 'error' } as const;
  return <span className="classmates-badge"><StateDot state={state[health]} size={6} />{HEALTH_LABEL[health]}</span>;
}

export function ClassmatesPage({ client }: ClassmatesPageProps) {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [state, setState] = useState<ClassmatesState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClassmateDefinition | null>(null);
  const [baseline, setBaseline] = useState<ClassmateDefinition | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState('');

  const [busy, setBusy] = useState<BusyAction>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState<ClassmateDefinition | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [tab, setTab] = useState<'roles' | 'models'>('roles');
  const [modelsDirty, setModelsDirty] = useState(false);
  const [modelsEditing, setModelsEditing] = useState(false);

  const mountedRef = useRef(true);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftGenRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);

  const dirty = draft !== null && baseline !== null && snapshot(draft) !== snapshot(baseline);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setStatus('loading');
    client.load().then(
      next => {
        if (cancelled || !mountedRef.current) return;
        setState(next);
        setStatus('ready');
      },
      error => {
        if (cancelled || !mountedRef.current) return;
        setLoadError(errorMessage(error));
        setStatus('load-error');
      },
    );
    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, [client]);

  useEffect(() => {
    if (!dirty && !modelsDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, modelsDirty]);

  useEffect(() => {
    if (draft) headingRef.current?.focus();
  }, [selectedId, isNew]);

  const confirmDiscard = useCallback((): boolean => {
    if (!dirty) return true;
    return window.confirm('当前角色的修改尚未保存，离开将丢弃这些修改。确定继续吗？');
  }, [dirty]);

  const openRole = useCallback((role: ClassmateDefinition) => {
    draftGenRef.current += 1;
    setDraft(cloneRole(role));
    setBaseline(role);
    setSelectedId(role.id);
    setIsNew(false);
    setFieldErrors({});
    setRequestError(null);
    setNotice(null);
    setRemoteVersion(null);
  }, []);

  const closeEditor = useCallback(() => {
    draftGenRef.current += 1;
    setDraft(null);
    setBaseline(null);
    setSelectedId(null);
    setIsNew(false);
    setFieldErrors({});
    setRequestError(null);
    setRemoteVersion(null);
  }, []);

  const requestOpenRole = useCallback((role: ClassmateDefinition) => {
    if (!confirmDiscard()) return;
    openRole(role);
  }, [confirmDiscard, openRole]);

  const requestNewRole = useCallback(() => {
    if (!confirmDiscard()) return;
    draftGenRef.current += 1;
    const next = createDraft();
    setDraft(next);
    setBaseline(next);
    setSelectedId(next.id);
    setIsNew(true);
    setFieldErrors({});
    setRequestError(null);
    setNotice(null);
    setRemoteVersion(null);
  }, [confirmDiscard]);

  const requestPresetRole = useCallback(() => {
    if (!state || !selectedPresetId || !confirmDiscard()) return;
    const preset = presets.find(item => item.id === selectedPresetId);
    if (!preset) return;
    let id = preset.id;
    if (state.roles.some(role => role.id === id)) {
      do { id = `role-${crypto.randomUUID()}`; }
      while (state.roles.some(role => role.id === id));
    }
    const next = cloneRole({ ...preset, id, revision: 0, enabled: false, model: null, reasoningEffort: undefined });
    draftGenRef.current += 1;
    setDraft(next);
    setBaseline(next);
    setSelectedId(next.id);
    setIsNew(true);
    setSelectedPresetId('');
    setFieldErrors({});
    setRequestError(null);
    setNotice(null);
    setRemoteVersion(null);
  }, [state, selectedPresetId, confirmDiscard]);

  const requestBack = useCallback(() => {
    if (!confirmDiscard()) return;
    closeEditor();
  }, [confirmDiscard, closeEditor]);

  const retryLoad = useCallback(async () => {
    if (busy) return;
    setStatus('loading');
    setLoadError(null);
    try {
      const next = await client.load();
      if (!mountedRef.current) return;
      setState(next);
      setStatus('ready');
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(errorMessage(error));
      setStatus('load-error');
    }
  }, [client, busy]);

  const reloadKeepingDraft = useCallback(async () => {
    if (!state || !draft || busy) return;
    const generation = draftGenRef.current;
    const targetId = draft.id;
    setBusy('reload');
    try {
      const next = await client.load();
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setState(next);
      setRequestError(null);
      const latest = next.roles.find(r => r.id === targetId);
      if (latest && !isNew) {
        setDraft(current => (current && current.id === targetId
          ? { ...current, revision: latest.revision, schemaVersion: latest.schemaVersion, enabled: latest.enabled }
          : current));
        setRemoteVersion(latest);
        setNotice(
          '已加载最新版本，可在下方对照。'
          + '你的输入已保留，尚未合并。请检查差异后保存，或放弃自己的修改。',
        );
      } else if (!latest && !isNew) {
        setDraft(current => (current && current.id === targetId ? { ...current, revision: 0 } : current));
        setIsNew(true);
        setRemoteVersion(null);
        setNotice('该角色已在最新版本中被删除。你的输入仍保留，保存将创建一个同内容的新角色。');
      } else {
        setRemoteVersion(null);
        setNotice('已加载最新版本，你的输入保留在表单中。');
      }
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(`加载最新版本失败：${errorMessage(error)}。你的输入仍保留，可稍后重试。`);
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [client, state, draft, busy, isNew]);

  const onSave = useCallback(async () => {
    if (!state || !draft || busy) return;
    // Enabled is saved immediately from the list, not owned by the text form.
    const input = { ...cloneRole(draft), enabled: isNew ? false : state.roles.find(role => role.id === draft.id)?.enabled ?? draft.enabled };
    const errors = validateDraft(input, state.models);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const focusMap = {
        name: nameRef,
        description: descriptionRef,
        instructions: instructionsRef,
      } as const;
      const first = (Object.keys(errors) as FieldKey[])[0];
      if (first === 'name' || first === 'description' || first === 'instructions') {
        focusMap[first].current?.focus();
      }
      return;
    }
    const generation = draftGenRef.current;
    const targetId = draft.id;
    setBusy('save');
    setRequestError(null);
    setNotice(null);
    try {
      const next = await client.save(input, state.settingsRevision);
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setState(next);
      const saved = next.roles.find(r => r.id === targetId);
      setBusy(null);
      if (saved) {
        openRole(saved);
      } else {
        closeEditor();
      }
      setNotice('已保存。');
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(
        `保存失败：${errorMessage(error)}。你的输入已保留在表单中，可以直接重试；`
        + '如果配置被其他窗口修改过，请加载最新版本，审阅后再保存（不会自动覆盖他人的更改）。',
      );
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [client, state, draft, busy, isNew, openRole, closeEditor]);

  const toggleRole = useCallback(async (role: ClassmateDefinition, enabled: boolean) => {
    if (!state?.writable || busy) return;
    setBusy('toggle');
    setToggleError(null);
    setNotice(null);
    try {
      // Send the accepted list value, never the unsaved editor draft.
      const next = await client.save({ ...cloneRole(role), enabled }, state.settingsRevision);
      if (!mountedRef.current) return;
      setState(next);
      const saved = next.roles.find(item => item.id === role.id);
      if (saved && draft?.id === role.id && baseline) {
        const sameBase = baseline.revision === role.revision && snapshot(baseline) === snapshot(role);
        const onlyToggle = saved.revision === role.revision + 1 && snapshot(saved) === snapshot({ ...role, enabled });
        if (sameBase && onlyToggle) {
          setDraft(current => current?.id === saved.id ? { ...current, enabled: saved.enabled, revision: saved.revision } : current);
          setBaseline(saved);
          setRemoteVersion(null);
        } else {
          // A separately edited role must still take the normal conflict path.
          setRemoteVersion(saved);
          setRequestError('角色内容已有更新。你的输入仍保留，请对照最新版本后再保存。');
        }
      }
      setAssistantError(null);
    } catch (error) {
      if (mountedRef.current) setToggleError(
        '未能确认「' + role.name + '」的启停结果：' + errorMessage(error) + '。请刷新列表后重试。',
      );
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [client, state, busy, draft, baseline]);

  const refreshRoleList = useCallback(async () => {
    if (busy) return;
    setBusy('reload');
    try {
      const next = await client.load();
      if (!mountedRef.current) return;
      setState(next);
      setToggleError(null);
      // Retain dirty drafts and their revisions; refreshing must not authorize
      // overwriting a change made in another editor.
      if (!dirty && draft && !isNew) {
        const latest = next.roles.find(role => role.id === draft.id);
        if (latest) openRole(latest);
        else closeEditor();
      }
    } catch (error) {
      if (mountedRef.current) setToggleError('刷新失败：' + errorMessage(error) + '。你的输入仍保留。');
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [client, busy, dirty, draft, isNew, openRole, closeEditor]);

  const onRemove = useCallback(async () => {
    if (!state || !draft || busy) return;
    if (isNew) {
      if (window.confirm('放弃这个尚未保存的新角色草稿？')) closeEditor();
      return;
    }
    const confirmed = window.confirm(
      `确定删除角色“${draft.name.trim() || draft.id}”？\n`
      + '删除后无法再使用此角色创建子智能体或队友。已有成员不受影响。',
    );
    if (!confirmed) return;
    const generation = draftGenRef.current;
    setBusy('remove');
    setRequestError(null);
    setNotice(null);
    try {
      const next = await client.remove(draft.id, draft.revision, state.settingsRevision);
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setState(next);
      closeEditor();
      setBusy(null);
      setNotice('已删除。已有子智能体和队友不受影响。');
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(
        `删除失败：${errorMessage(error)}。可以直接重试；如果配置被其他窗口修改过，请加载最新版本后再操作。`,
      );
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [client, state, draft, busy, isNew, closeEditor]);

  const patchDraft = useCallback((patch: Partial<ClassmateDefinition>) => {
    setDraft(current => (current ? { ...current, ...patch } : current));
  }, []);

  const clearLegacyModel = useCallback(() => {
    setDraft(current => (current ? { ...current, model: null, reasoningEffort: undefined } : current));
    setFieldErrors(current => ({ ...current, model: undefined, effort: undefined }));
  }, []);

  const copyDemoRequest = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    if (!mountedRef.current) return;
    setCopied(true);
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopied(false);
    }, 2000);
  }, []);

  const runHandoff = useCallback(async (action: () => void | Promise<void>) => {
    if (handoffBusy) return;
    setHandoffBusy(true);
    setAssistantError(null);
    try {
      await action();
    } catch (error) {
      if (!mountedRef.current) return;
      if (isHandoffBusy(error) || isAbortError(error)) return;
      setAssistantError(errorMessage(error));
    } finally {
      if (mountedRef.current) setHandoffBusy(false);
    }
  }, [handoffBusy]);

  const editing = tab === 'models' ? modelsEditing : draft !== null;
  const rootClass = `classmates${editing ? ' classmates--editing' : ''}`;
  const readOnly = state !== null && !state.writable;
  const demoRole = useMemo(() => {
    if (!state) return null;
    if (draft?.enabled && draft.name.trim() && roleHealth(draft, state.models) === 'enabled') return draft;
    return state.roles.find(r => roleHealth(r, state.models) === 'enabled') ?? null;
  }, [state, draft]);
  const demoText = demoRole
    ? `请使用 Classmates 的「${demoRole.name.trim()}」角色派发子智能体，协助完成：<在这里描述你的任务>。`
    : '请使用 Classmates 已启用的角色派发子智能体，协助完成：<在这里描述你的任务>。需要先在上方启用一个角色。';

  return (
    <div className={rootClass}>
      <style>{classmatesCss}</style>

      <div className="classmates-toolbar">
        <header className="classmates-header">
          <h2>模板与模型</h2>
          <p className="classmates-lead">
            配置模板职责和模型用途，派发时由主智能体选择。
          </p>
        </header>

        {client.startTask && (
          <section className="classmates-assistant" aria-label="开始任务">
            {client.startTask && (
              <Button variant="outline"
                type="button"
                className="classmates-button"
                data-classmates-start-task="true"
                onClick={() => void runHandoff(() => client.startTask?.())}
                disabled={handoffBusy || busy !== null}
              >
                开始任务
              </Button>
            )}
            {assistantError && (
              <p className="classmates-field-error" role="alert">{assistantError}</p>
            )}
          </section>
        )}

      </div>

      {status === 'loading' && (
        <p className="classmates-loading" role="status">正在加载角色配置…</p>
      )}

      {status === 'load-error' && (
        <div className="classmates-alert" role="alert" style={{ marginTop: 14 }}>
          <p>加载角色配置失败：{loadError}</p>
          <div className="classmates-alert-actions">
            <Button variant="outline" type="button" className="classmates-button" onClick={() => void retryLoad()}>
              重试
            </Button>
          </div>
        </div>
      )}

      {status === 'ready' && state && (
        <>
          {state.catalogErrors?.length ? (
            <div className="classmates-banner" role="status">
              {state.catalogErrors.join('；')}。其他可用角色仍可编辑。
            </div>
          ) : null}
          {readOnly && (
            <p className="classmates-banner" role="status">
              当前配置只读。
            </p>
          )}
          {notice && (
            <p className="classmates-notice" style={{ marginTop: 14 }} aria-live="polite">{notice}</p>
          )}

          <SegmentedTabs
            className="classmates-tabs"
            label="配置类别"
            items={CLASSMATES_TABS}
            value={tab}
            onChange={setTab}
          />

          <div
            role="tabpanel"
            id="classmates-panel-roles"
            aria-labelledby="classmates-tab-roles"
            hidden={tab !== 'roles'}
          >
          <div className="classmates-body">
            <section className="classmates-list-pane" aria-label="角色列表">
              <div className="classmates-list-head">
                <h2>角色（{state.roles.length}）</h2>
                <Button variant="outline" size="sm"
                  type="button"
                  onClick={requestNewRole}
                  disabled={readOnly || busy !== null}
                >
                  新建角色
                </Button>
              </div>
              <details className="classmates-presets">
                <summary>从预设添加</summary>
                <div className="classmates-field">
                  <label className="classmates-label" htmlFor="classmates-preset">预设角色</label>
                  <select
                    id="classmates-preset"
                    className="classmates-select"
                    value={selectedPresetId}
                    onChange={event => setSelectedPresetId(event.target.value)}
                    disabled={readOnly || busy !== null}
                  >
                    <option value="">选择预设角色</option>
                    {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                  </select>
                  <Button variant="outline"
                    type="button"
                    className="classmates-button"
                    onClick={requestPresetRole}
                    disabled={readOnly || busy !== null || !selectedPresetId}
                  >
                    添加为新角色
                  </Button>
                </div>
              </details>
              {toggleError && (
                <div className="classmates-list-error" role="alert">
                  <p>{toggleError}</p>
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refreshRoleList()}>刷新角色列表</Button>
                </div>
              )}
              {state.roles.length === 0 ? (
                <p className="classmates-empty">暂无角色，可新建或从预设添加。</p>
              ) : (
                <ul className="classmates-list">
                  {state.roles.map(role => {
                    const health = roleHealth(role, state.models);
                    return (
                      <li key={role.id} className="classmates-row" data-selected={selectedId === role.id && !isNew || undefined}>
                        <button
                          type="button"
                          className="classmates-item"
                          aria-current={selectedId === role.id && !isNew ? 'true' : undefined}
                          onClick={() => requestOpenRole(role)}
                          disabled={busy !== null}
                        >
                          <span className="classmates-item-name">{role.name.trim() || '未命名角色'}</span>
                          <span className="classmates-item-desc" title={role.description}>
                            {role.description.trim() || '暂无职责说明'}
                          </span>
                          {(health === 'invalid' || health === 'unconfigured') && <StatusBadge health={health} />}
                        </button>
                        <Switch
                          label={'启用角色 ' + (role.name.trim() || role.id)}
                          checked={role.enabled}
                          onChange={enabled => void toggleRole(role, enabled)}
                          disabled={readOnly || busy !== null}
                          title="立即保存启用状态；停用不影响已有成员。"
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="classmates-editor" aria-label="角色编辑">
              {draft ? (
                <>
                  <Button variant="outline" type="button" className="classmates-back" onClick={requestBack} disabled={busy !== null}>
                    ← 返回列表
                  </Button>
                  <div className="classmates-editor-head">
                    <h2 ref={headingRef} tabIndex={-1}>
                      {isNew ? '新建角色' : (draft.name.trim() || '未命名角色')}
                    </h2>
                    {isNew
                      ? <span className="classmates-badge classmates-badge--unconfigured">未保存</span>
                      : <StatusBadge health={roleHealth(draft, state.models)} />}
                    {dirty && <span className="classmates-dirty">有未保存的修改</span>}
                  </div>

                  <form
                    className="classmates-form"
                    aria-label={isNew ? '新建角色表单' : `编辑角色 ${draft.name.trim() || draft.id}`}
                    onSubmit={event => {
                      event.preventDefault();
                      void onSave();
                    }}
                  >
                    <fieldset disabled={readOnly || busy !== null} className="classmates-fields">
                      {requestError && (
                        <div className="classmates-alert" role="alert">
                          <p>{requestError}</p>
                          <div className="classmates-alert-actions">
                            <Button variant="outline"
                              type="button"
                              className="classmates-button"
                              onClick={() => void onSave()}
                            >
                              重试保存
                            </Button>
                            <Button variant="outline"
                              type="button"
                              className="classmates-button"
                              onClick={() => void reloadKeepingDraft()}
                            >
                              加载最新版本（保留我的输入）
                            </Button>
                          </div>
                        </div>
                      )}
                      <div className="classmates-field">
                        <label className="classmates-label" htmlFor="classmates-name">名称</label>
                        <input
                          id="classmates-name"
                          ref={nameRef}
                          className="classmates-input"
                          type="text"
                          value={draft.name}
                          onChange={event => patchDraft({ name: event.target.value })}
                          maxLength={NAME_MAX}
                          required
                          aria-invalid={fieldErrors.name ? 'true' : undefined}
                          aria-describedby={fieldErrors.name ? 'classmates-name-error' : undefined}
                          autoComplete="off"
                        />
                        {fieldErrors.name && (
                          <p id="classmates-name-error" className="classmates-field-error">{fieldErrors.name}</p>
                        )}
                      </div>

                      <div className="classmates-field">
                        <label className="classmates-label" htmlFor="classmates-description">职责说明</label>
                        <textarea
                          id="classmates-description"
                          ref={descriptionRef}
                          className="classmates-textarea"
                          rows={2}
                          value={draft.description}
                          onChange={event => patchDraft({ description: event.target.value })}
                          maxLength={DESCRIPTION_MAX}
                          required
                          aria-invalid={fieldErrors.description ? 'true' : undefined}
                          aria-describedby={
                            fieldErrors.description
                              ? 'classmates-description-error classmates-description-help'
                              : 'classmates-description-help'
                          }
                        />
                        <p id="classmates-description-help" className="classmates-help">
                          何时调用、负责什么。
                        </p>
                        {fieldErrors.description && (
                          <p id="classmates-description-error" className="classmates-field-error">{fieldErrors.description}</p>
                        )}
                      </div>

                      {(draft.model !== null || draft.reasoningEffort !== undefined) && (
                        <div className="classmates-legacy" role="group" aria-label="旧版模型绑定">
                          <p className="classmates-legacy-title">旧版模型绑定</p>
                          <p className="classmates-legacy-summary">{modelLabel(draft, state.models)}</p>
                          <p className="classmates-help">
                            角色模板只包含职责与指令。保留此绑定可维持旧行为；清除并保存后，由主智能体参考模型预设选择模型。
                          </p>
                          {fieldErrors.model && (
                            <p className="classmates-field-error">{fieldErrors.model}</p>
                          )}
                          {fieldErrors.effort && (
                            <p className="classmates-field-error">{fieldErrors.effort}</p>
                          )}
                          <Button variant="outline"
                            type="button"
                            className="classmates-button"
                            onClick={clearLegacyModel}
                          >
                            清除模型绑定
                          </Button>
                        </div>
                      )}
                      <div className="classmates-field">
                        <label className="classmates-label" htmlFor="classmates-instructions">工作指令</label>
                        <textarea
                          id="classmates-instructions"
                          ref={instructionsRef}
                          className="classmates-textarea"
                          rows={8}
                          value={draft.instructions}
                          onChange={event => patchDraft({ instructions: event.target.value })}
                          maxLength={INSTRUCTIONS_MAX}
                          required
                          aria-invalid={fieldErrors.instructions ? 'true' : undefined}
                          aria-describedby={
                            fieldErrors.instructions
                              ? 'classmates-instructions-error'
                              : undefined
                          }
                        />
                        {fieldErrors.instructions && (
                          <p id="classmates-instructions-error" className="classmates-field-error">{fieldErrors.instructions}</p>
                        )}
                      </div>

                    </fieldset>

                    {remoteVersion && (
                      <div className="classmates-remote" role="group" aria-label="最新版本对照">
                        <p className="classmates-remote-title">
                          最新版本对照（版本 {remoteVersion.revision}）
                        </p>
                        <p className="classmates-help">
                          以下是其他页面保存的内容。你的输入保留在上方，尚未合并。请检查差异后保存，或放弃自己的修改。
                        </p>
                        <dl className="classmates-remote-fields">
                          <div>
                            <dt>名称</dt>
                            <dd>{remoteVersion.name}</dd>
                          </div>
                          <div>
                            <dt>职责说明</dt>
                            <dd>{remoteVersion.description}</dd>
                          </div>
                          <div>
                            <dt>模型 / 思考强度</dt>
                            <dd>{modelLabel(remoteVersion, state.models)}</dd>
                          </div>
                          <div>
                            <dt>启用</dt>
                            <dd>{remoteVersion.enabled ? '已启用' : '已停用'}</dd>
                          </div>
                          <div>
                            <dt>工作指令</dt>
                            <dd className="classmates-remote-instructions">{remoteVersion.instructions}</dd>
                          </div>
                        </dl>
                        <Button variant="outline"
                          type="button"
                          className="classmates-button"
                          onClick={() => openRole(remoteVersion)}
                          disabled={busy !== null}
                        >
                          放弃我的修改，加载最新版本
                        </Button>
                      </div>
                    )}

                    <div className="classmates-actions">
                      <Button variant="primary"
                        type="submit"
                        className="classmates-button classmates-button--primary"
                        disabled={readOnly || busy !== null}
                      >
                        {busy === 'save' ? '正在保存…' : '保存'}
                      </Button>
                      <Button variant="outline"
                        type="button"
                        className="classmates-button classmates-button--danger"
                        onClick={() => void onRemove()}
                        disabled={readOnly || busy !== null}
                      >
                        {busy === 'remove' ? '正在删除…' : (isNew ? '放弃草稿' : '删除角色')}
                      </Button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="classmates-editor-placeholder">
                  <p>选择或新建角色。</p>
                </div>
              )}
            </section>
          </div>

          <details className="classmates-details">
            <summary>工具与权限说明</summary>
            <p>
              工具和权限由宿主提供；「只读」等角色指令不构成权限限制。
            </p>
          </details>

          <details className="classmates-details">
            <summary>停用、删除与卸载的影响</summary>
            <p>
              删除角色不影响已有子智能体和队友。卸载前先结束相关成员；恢复角色指令需要保留插件，团队队友还需要原绑定数据。
            </p>
          </details>

          <section className="classmates-demo" aria-label="示例请求">
            <h2 style={{ fontSize: 15 }}>示例请求</h2>
            <p className="classmates-help">
              复制到普通对话中使用。
            </p>
            <p className="classmates-demo-text">{demoText}</p>
            <div className="classmates-demo-row">
              <Button variant="outline"
                type="button"
                className="classmates-button"
                onClick={() => void copyDemoRequest(demoText)}
              >
                复制示例请求
              </Button>
              {copied && <span className="classmates-demo-copied" role="status">已复制</span>}
            </div>
          </section>
          </div>

          <div
            role="tabpanel"
            id="classmates-panel-models"
            aria-labelledby="classmates-tab-models"
            hidden={tab !== 'models'}
          >
            <ModelsPage
              client={client}
              state={state}
              readOnly={readOnly}
              onState={setState}
              onDirtyChange={setModelsDirty}
              onEditingChange={setModelsEditing}
            />
          </div>
        </>
      )}
    </div>
  );
}
