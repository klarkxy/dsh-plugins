import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type {
  ClassmatesClient,
  ClassmatesState,
  ModelBinding,
  ModelChoice,
  ModelProfile,
  ModelRoute,
} from '../contracts.js';
import {
  catalogConnectivityUnknown,
  findModel,
  formatModelOption,
  formatProviderLabel,
} from './roles.js';

export interface ModelsPageProps {
  client: ClassmatesClient;
  state: ClassmatesState;
  readOnly: boolean;
  onState(next: ClassmatesState): void;
  onDirtyChange?(dirty: boolean): void;
  onEditingChange?(editing: boolean): void;
}

export const PROFILE_NAME_MAX = 100;
export const PROFILE_DESCRIPTION_MAX = 200;

type BusyAction = 'save' | 'remove' | 'reload' | 'toggle' | 'protect' | null;
type FieldKey = 'name' | 'description' | 'model' | 'effort';
type FieldErrors = Partial<Record<FieldKey, string>>;
type ProfileHealth = 'enabled' | 'disabled' | 'unconfigured' | 'invalid';

/** Editor draft: the model route stays unchosen until the user picks one. */
type ProfileDraft = Omit<ModelProfile, 'model'> & { model: ModelBinding | null };

const HEALTH_LABEL: Record<ProfileHealth, string> = {
  enabled: '已启用',
  disabled: '已停用',
  unconfigured: '未配置',
  invalid: '配置错误',
};

function cloneBinding(binding: ModelBinding): ModelBinding {
  return binding.reasoningEffort === undefined
    ? { provider: binding.provider, id: binding.id }
    : { provider: binding.provider, id: binding.id, reasoningEffort: binding.reasoningEffort };
}

function cloneProfile(profile: ModelProfile): ProfileDraft {
  return { ...profile, model: cloneBinding(profile.model) };
}

function createDraft(): ProfileDraft {
  return {
    id: `profile-${crypto.randomUUID()}`,
    revision: 0,
    name: '',
    description: '',
    enabled: false,
    model: null,
  };
}

/** Route identity is the exact provider+id pair, never a joined string. */
function sameRoute(a: ModelRoute, b: ModelRoute): boolean {
  return a.provider === b.provider && a.id === b.id;
}

function parseRouteSelection(value: string): ModelRoute | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { provider, id } = parsed as Record<string, unknown>;
    if (typeof provider !== 'string' || !provider || typeof id !== 'string' || !id) return null;
    return { provider, id };
  } catch {
    return null;
  }
}

function formatRouteLabel(route: ModelRoute, models: ModelChoice[]): string {
  const model = findModel(models, route);
  return model ? formatModelOption(model) : `${route.provider} · ${route.id}`;
}

function snapshot(draft: ProfileDraft): string {
  return JSON.stringify({
    name: draft.name,
    description: draft.description,
    enabled: draft.enabled,
    model: draft.model ? cloneBinding(draft.model) : null,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateDraft(draft: ProfileDraft, models: ModelChoice[]): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.name.trim()) {
    errors.name = '请填写名称。';
  } else if (draft.name.length > PROFILE_NAME_MAX) {
    errors.name = `名称不能超过 ${PROFILE_NAME_MAX} 个字符（当前 ${draft.name.length}）。`;
  }
  if (!draft.description.trim()) {
    errors.description = '请填写用途说明。';
  } else if (draft.description.length > PROFILE_DESCRIPTION_MAX) {
    errors.description = `用途说明不能超过 ${PROFILE_DESCRIPTION_MAX} 个字符（当前 ${draft.description.length}）。`;
  }
  if (!draft.model) {
    errors.model = '请选择模型。';
  } else if (draft.enabled && !findModel(models, draft.model)) {
    errors.model = '所选模型当前不可用，请重新选择后启用。';
  }
  const effort = draft.model?.reasoningEffort;
  if (draft.enabled && draft.model && effort) {
    const chosen = findModel(models, draft.model);
    if (!chosen?.efforts.some(option => option.id === effort)) {
      errors.effort = '所选模型不支持此思考强度，请重新选择。';
    }
  }
  return errors;
}

function profileHealth(profile: ProfileDraft, models: ModelChoice[]): ProfileHealth {
  if (!profile.model) return 'unconfigured';
  const model = findModel(models, profile.model);
  if (!model) return 'invalid';
  const effort = profile.model.reasoningEffort;
  if (effort && !model.efforts.some(option => option.id === effort)) return 'invalid';
  return profile.enabled ? 'enabled' : 'disabled';
}

function formatProfileModelSummary(profile: ProfileDraft, models: ModelChoice[]): string {
  if (!profile.model) return '未选择模型';
  const model = findModel(models, profile.model);
  const modelLabel = `${model ? formatProviderLabel(model) : profile.model.provider} · ${model?.name ?? profile.model.id}`;
  const effort = profile.model.reasoningEffort;
  const effortLabel = effort
    ? model?.efforts.find(option => option.id === effort)?.name ?? effort
    : '模型默认';
  return `${modelLabel} · 思考强度：${effortLabel}`;
}

function StatusBadge({ health }: { health: ProfileHealth }) {
  const state = { enabled: 'done', disabled: 'idle', unconfigured: 'warning', invalid: 'error' } as const;
  return <span className="classmates-badge"><StateDot state={state[health]} size={6} />{HEALTH_LABEL[health]}</span>;
}

export function ModelsPage({ client, state, readOnly, onState, onDirtyChange, onEditingChange }: ModelsPageProps) {
  const saveModelProfile = client.saveModelProfile;
  const removeModelProfile = client.removeModelProfile;
  const setModelProtection = client.setModelProtection;
  const supported = saveModelProfile !== undefined && removeModelProfile !== undefined;
  const profiles = state.modelProfiles ?? [];
  // Older hosts omit the field; render as empty without writing it back.
  const protectedRoutes = state.protectedModels ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [baseline, setBaseline] = useState<ProfileDraft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [remoteVersion, setRemoteVersion] = useState<ModelProfile | null>(null);
  const [routeSelection, setRouteSelection] = useState('');
  const [protectionError, setProtectionError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const draftGenRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const modelRef = useRef<HTMLSelectElement>(null);
  const effortRef = useRef<HTMLSelectElement>(null);

  const dirty = draft !== null && baseline !== null && snapshot(draft) !== snapshot(baseline);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onEditingChange?.(draft !== null);
  }, [draft, onEditingChange]);

  useEffect(() => {
    if (draft) headingRef.current?.focus();
  }, [selectedId, isNew]);

  const confirmDiscard = useCallback((): boolean => {
    if (!dirty) return true;
    return window.confirm('当前模型预设的修改尚未保存，离开将丢弃这些修改。确定继续吗？');
  }, [dirty]);

  const openProfile = useCallback((profile: ModelProfile) => {
    draftGenRef.current += 1;
    setDraft(cloneProfile(profile));
    setBaseline(cloneProfile(profile));
    setSelectedId(profile.id);
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

  const requestOpenProfile = useCallback((profile: ModelProfile) => {
    if (!confirmDiscard()) return;
    openProfile(profile);
  }, [confirmDiscard, openProfile]);

  const requestNewProfile = useCallback(() => {
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

  const requestBack = useCallback(() => {
    if (!confirmDiscard()) return;
    closeEditor();
  }, [confirmDiscard, closeEditor]);

  const reloadKeepingDraft = useCallback(async () => {
    if (!draft || busy) return;
    const generation = draftGenRef.current;
    const targetId = draft.id;
    setBusy('reload');
    try {
      const next = await client.load();
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      onState(next);
      setRequestError(null);
      const latest = (next.modelProfiles ?? []).find(item => item.id === targetId);
      if (latest && !isNew) {
        setDraft(current => (current && current.id === targetId
          ? { ...current, revision: latest.revision, enabled: latest.enabled }
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
        setNotice('该预设已在最新版本中被删除。你的输入仍保留，保存将创建一个同内容的新预设。');
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
  }, [client, draft, busy, isNew, onState]);

  const onSave = useCallback(async () => {
    if (!saveModelProfile || !draft || busy) return;
    // Enabled is saved immediately from the list, not owned by the text form.
    const form: ProfileDraft = {
      ...draft,
      model: draft.model ? cloneBinding(draft.model) : null,
      enabled: isNew ? false : profiles.find(item => item.id === draft.id)?.enabled ?? draft.enabled,
    };
    const errors = validateDraft(form, state.models);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const focusMap = {
        name: nameRef,
        description: descriptionRef,
        model: modelRef,
        effort: effortRef,
      } as const;
      const first = (Object.keys(errors) as FieldKey[])[0];
      focusMap[first]?.current?.focus();
      return;
    }
    const input: ModelProfile = { ...form, model: form.model as ModelBinding };
    const generation = draftGenRef.current;
    const targetId = draft.id;
    setBusy('save');
    setRequestError(null);
    setNotice(null);
    try {
      const next = await saveModelProfile(input, state.settingsRevision);
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      onState(next);
      const saved = (next.modelProfiles ?? []).find(item => item.id === targetId);
      setBusy(null);
      if (saved) {
        openProfile(saved);
      } else {
        closeEditor();
      }
      setNotice('已保存。');
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(`保存失败：${errorMessage(error)}。可加载最新版本进行对照。`);
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [saveModelProfile, draft, busy, isNew, profiles, state, onState, openProfile, closeEditor]);

  const toggleProfile = useCallback(async (profile: ModelProfile, enabled: boolean) => {
    if (!saveModelProfile || readOnly || busy) return;
    setBusy('toggle');
    setToggleError(null);
    setNotice(null);
    try {
      // Send the accepted list value, never the unsaved editor draft.
      const next = await saveModelProfile({ ...profile, enabled }, state.settingsRevision);
      if (!mountedRef.current) return;
      onState(next);
      const saved = (next.modelProfiles ?? []).find(item => item.id === profile.id);
      if (saved && draft?.id === profile.id && baseline) {
        const listed = cloneProfile(profile);
        const sameBase = baseline.revision === profile.revision && snapshot(baseline) === snapshot(listed);
        const onlyToggle = saved.revision === profile.revision + 1
          && snapshot(cloneProfile(saved)) === snapshot({ ...listed, enabled });
        if (sameBase && onlyToggle) {
          setDraft(current => current?.id === saved.id ? { ...current, enabled: saved.enabled, revision: saved.revision } : current);
          setBaseline(cloneProfile(saved));
          setRemoteVersion(null);
        } else {
          // A separately edited profile must still take the normal conflict path.
          setRemoteVersion(saved);
          setRequestError('模型预设内容已有更新。你的输入仍保留，请对照最新版本后再保存。');
        }
      }
    } catch (error) {
      if (mountedRef.current) setToggleError(
        '未能确认「' + profile.name + '」的启停结果：' + errorMessage(error) + '。请刷新列表后重试。',
      );
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [saveModelProfile, readOnly, busy, state.settingsRevision, draft, baseline, onState]);

  const toggleProtection = useCallback(async (route: ModelRoute, required: boolean) => {
    if (!setModelProtection || readOnly || busy) return;
    setBusy('protect');
    setProtectionError(null);
    setNotice(null);
    try {
      const next = await setModelProtection({ provider: route.provider, id: route.id }, required, state.settingsRevision);
      if (!mountedRef.current) return;
      // Shared state only: the profile editor draft, dirty or not, stays untouched.
      onState(next);
    } catch (error) {
      if (mountedRef.current) setProtectionError(
        `未能${required ? '开启' : '关闭'}「${formatRouteLabel(route, state.models)}」的使用前确认：${errorMessage(error)}。`
        + '列表保持原样；如果配置被其他窗口修改过，请刷新后重试。',
      );
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [setModelProtection, readOnly, busy, state.settingsRevision, state.models, onState]);

  const refreshProfileList = useCallback(async () => {
    if (busy) return;
    setBusy('reload');
    try {
      const next = await client.load();
      if (!mountedRef.current) return;
      onState(next);
      setToggleError(null);
      setProtectionError(null);
      // Retain dirty drafts and their revisions; refreshing must not authorize
      // overwriting a change made in another editor.
      if (!dirty && draft && !isNew) {
        const latest = (next.modelProfiles ?? []).find(item => item.id === draft.id);
        if (latest) openProfile(latest);
        else closeEditor();
      }
    } catch (error) {
      if (mountedRef.current) setToggleError('刷新失败：' + errorMessage(error) + '。你的输入仍保留。');
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [client, busy, dirty, draft, isNew, onState, openProfile, closeEditor]);

  const onRemove = useCallback(async () => {
    if (!removeModelProfile || !draft || busy) return;
    if (isNew) {
      if (window.confirm('放弃这个尚未保存的新预设草稿？')) closeEditor();
      return;
    }
    const confirmed = window.confirm(
      `确定删除模型预设“${draft.name.trim() || draft.id}”？\n`
      + '删除后主智能体选择模型时将不再参考此预设。',
    );
    if (!confirmed) return;
    const generation = draftGenRef.current;
    setBusy('remove');
    setRequestError(null);
    setNotice(null);
    try {
      const next = await removeModelProfile(draft.id, draft.revision, state.settingsRevision);
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      onState(next);
      closeEditor();
      setBusy(null);
      setNotice('已删除。');
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(
        `删除失败：${errorMessage(error)}。可以直接重试；如果配置被其他窗口修改过，请加载最新版本后再操作。`,
      );
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [removeModelProfile, draft, busy, isNew, state.settingsRevision, onState, closeEditor]);

  const patchDraft = useCallback((patch: Partial<ProfileDraft>) => {
    setDraft(current => (current ? { ...current, ...patch } : current));
  }, []);

  const onModelChange = useCallback((value: string) => {
    if (value === 'missing') return;
    setDraft(current => {
      if (!current) return current;
      const index = Number(value);
      const model = Number.isInteger(index) && index >= 0 ? state.models[index] : undefined;
      // Picking a model clears the effort: missing effort means the model default.
      if (!model) return { ...current, model: null };
      return { ...current, model: { provider: model.provider, id: model.id } };
    });
    setFieldErrors(current => ({ ...current, model: undefined, effort: undefined }));
  }, [state.models]);

  const protectionSupported = setModelProtection !== undefined;
  const protectionDisabled = readOnly || busy !== null || !protectionSupported;
  const selectedRoute = parseRouteSelection(routeSelection);
  const selectedProtected = selectedRoute !== null && protectedRoutes.some(route => sameRoute(route, selectedRoute));
  const selectedRouteLabel = selectedRoute ? formatRouteLabel(selectedRoute, state.models) : null;

  const protectionSection = (
    <section className="classmates-protection" aria-label="启动审批" aria-busy={busy === 'protect' || undefined}>
      <h2 className="classmates-protection-title">启动审批</h2>
      <p className="classmates-help">
        新建使用此模型的 Classmates 子智能体前请求审批，同一模型的所有用途和思考强度共用；已有子智能体不受影响。
      </p>
      {!protectionSupported && (
        <p className="classmates-help">当前版本暂不支持启动审批设置。</p>
      )}
      <div className="classmates-field">
        <label className="classmates-label" htmlFor="classmates-protection-model">模型</label>
        <select
          id="classmates-protection-model"
          className="classmates-select"
          value={routeSelection}
          onChange={event => setRouteSelection(event.target.value)}
          disabled={protectionDisabled || state.models.length === 0}
        >
          <option value="">{state.models.length === 0 ? '暂无可选模型' : '请选择模型'}</option>
          {state.models.map(model => {
            const value = JSON.stringify({ provider: model.provider, id: model.id });
            return <option key={value} value={value}>{formatModelOption(model)}</option>;
          })}
        </select>
      </div>
      <div className="classmates-protection-toggle">
        <Switch
          label={selectedRouteLabel ? `使用前确认：${selectedRouteLabel}` : '使用前确认（先选择模型）'}
          checked={selectedProtected}
          onChange={required => {
            if (selectedRoute) void toggleProtection(selectedRoute, required);
          }}
          disabled={protectionDisabled || !selectedRoute}
          title="立即保存，对该模型的所有用途预设和思考强度生效。"
        />
        {busy === 'protect' && <span className="classmates-help" role="status">正在保存…</span>}
      </div>
      {protectionError && (
        <div className="classmates-list-error" role="alert">
          <p>{protectionError}</p>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refreshProfileList()}>刷新</Button>
        </div>
      )}
      {protectedRoutes.length > 0 && (
        <ul className="classmates-protection-list" aria-label="已开启使用前确认的模型">
          {protectedRoutes.map(route => {
            const label = formatRouteLabel(route, state.models);
            const missing = !findModel(state.models, route);
            return (
              <li key={JSON.stringify(route)} className="classmates-protection-row">
                <span className="classmates-protection-route">
                  <span className="classmates-item-name">{label}</span>
                  {missing && <span className="classmates-item-desc">此模型已不在当前目录中，可在此关闭确认。</span>}
                </span>
                <Switch
                  label={`关闭使用前确认：${label}`}
                  checked
                  onChange={() => void toggleProtection(route, false)}
                  disabled={protectionDisabled}
                  title="立即保存。"
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  if (!supported) {
    return (
      <div className="classmates-models">
        <p className="classmates-banner" role="status" style={{ marginTop: 14 }}>
          当前 DSH 版本暂不支持管理模型预设，请升级到最新版本后重试。
        </p>
        {profiles.length > 0 && (
          <ul className="classmates-list classmates-models-readonly" aria-label="已有模型预设（只读）">
            {profiles.map(profile => (
              <li key={profile.id} className="classmates-row">
                <div className="classmates-item classmates-item--static">
                  <span className="classmates-item-name">{profile.name.trim() || '未命名预设'}</span>
                  <span className="classmates-item-desc" title={profile.description}>
                    {profile.description.trim() || '暂无用途说明'}
                  </span>
                  <span className="classmates-item-desc">{formatProfileModelSummary(profile, state.models)}</span>
                  <StatusBadge health={profile.enabled ? 'enabled' : 'disabled'} />
                  {protectedRoutes.some(route => sameRoute(route, profile.model)) && (
                    <span className="classmates-badge classmates-badge--protected">使用前确认</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {protectionSection}
      </div>
    );
  }

  const selectedModel = draft?.model ? findModel(state.models, draft.model) : undefined;
  const modelIndex = draft?.model
    ? state.models.findIndex(model => model.provider === draft.model!.provider && model.id === draft.model!.id)
    : -1;
  const modelSelectValue = !draft?.model ? '-1' : (modelIndex >= 0 ? String(modelIndex) : 'missing');
  const effortOptions = selectedModel?.efforts ?? [];
  const selectedEffort = draft?.model?.reasoningEffort ?? '';
  const selectedEffortInfo = effortOptions.find(option => option.id === selectedEffort);
  const missingEffort = selectedEffort !== '' && !selectedEffortInfo;
  const modelHelp = draft?.model && selectedModel
    ? [selectedModel.description, catalogConnectivityUnknown(selectedModel) ? '连接尚未验证。' : undefined]
      .filter(Boolean).join(' ') || undefined
    : !draft?.model && state.models.length === 0
      ? '暂无可选模型。'
      : undefined;
  const effortHelp = selectedEffortInfo?.description
    ?? (selectedEffort === '' ? '不选择时使用模型自身的默认强度，与当前聊天无关。' : undefined);

  return (
    <div className="classmates-models">
      {notice && (
        <p className="classmates-notice" style={{ marginTop: 14 }} aria-live="polite">{notice}</p>
      )}

      <div className="classmates-body">
        <section className="classmates-list-pane" aria-label="模型预设列表">
          <div className="classmates-list-head">
            <h2>模型预设（{profiles.length}）</h2>
            <Button variant="outline" size="sm"
              type="button"
              onClick={requestNewProfile}
              disabled={readOnly || busy !== null}
            >
              新建模型预设
            </Button>
          </div>
          <p className="classmates-help classmates-models-lead">
            记录什么任务适合哪个模型、哪种思考强度，供主智能体派发子智能体时参考。同一个模型可以建立多个不同强度的预设。
          </p>
          {toggleError && (
            <div className="classmates-list-error" role="alert">
              <p>{toggleError}</p>
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refreshProfileList()}>刷新预设列表</Button>
            </div>
          )}
          {profiles.length === 0 ? (
            <p className="classmates-empty">
              暂无模型预设。可点击「新建模型预设」创建，也可以在创造模式中配置。
            </p>
          ) : (
            <ul className="classmates-list">
              {profiles.map(profile => {
                const health = profileHealth(profile, state.models);
                return (
                  <li key={profile.id} className="classmates-row" data-selected={selectedId === profile.id && !isNew || undefined}>
                    <button
                      type="button"
                      className="classmates-item"
                      aria-current={selectedId === profile.id && !isNew ? 'true' : undefined}
                      onClick={() => requestOpenProfile(profile)}
                      disabled={busy !== null}
                    >
                      <span className="classmates-item-name">{profile.name.trim() || '未命名预设'}</span>
                      <span className="classmates-item-desc" title={profile.description}>
                        {profile.description.trim() || '暂无用途说明'}
                      </span>
                      <span className="classmates-item-desc">{formatProfileModelSummary(profile, state.models)}</span>
                      {health === 'invalid' && <StatusBadge health={health} />}
                      {protectedRoutes.some(route => sameRoute(route, profile.model)) && (
                        <span className="classmates-badge classmates-badge--protected">使用前确认</span>
                      )}
                    </button>
                    <Switch
                      label={'启用模型预设 ' + (profile.name.trim() || profile.id)}
                      checked={profile.enabled}
                      onChange={enabled => void toggleProfile(profile, enabled)}
                      disabled={readOnly || busy !== null}
                      title="立即保存启用状态。"
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {protectionSection}
        </section>

        <section className="classmates-editor" aria-label="模型预设编辑">
          {draft ? (
            <>
              <Button variant="outline" type="button" className="classmates-back" onClick={requestBack} disabled={busy !== null}>
                ← 返回列表
              </Button>
              <div className="classmates-editor-head">
                <h2 ref={headingRef} tabIndex={-1}>
                  {isNew ? '新建模型预设' : (draft.name.trim() || '未命名预设')}
                </h2>
                {isNew
                  ? <span className="classmates-badge classmates-badge--unconfigured">未保存</span>
                  : <StatusBadge health={profileHealth(draft, state.models)} />}
                {dirty && <span className="classmates-dirty">有未保存的修改</span>}
              </div>

              <form
                className="classmates-form"
                aria-label={isNew ? '新建模型预设表单' : `编辑模型预设 ${draft.name.trim() || draft.id}`}
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
                    <label className="classmates-label" htmlFor="classmates-profile-name">名称</label>
                    <input
                      id="classmates-profile-name"
                      ref={nameRef}
                      className="classmates-input"
                      type="text"
                      value={draft.name}
                      onChange={event => patchDraft({ name: event.target.value })}
                      maxLength={PROFILE_NAME_MAX}
                      required
                      aria-invalid={fieldErrors.name ? 'true' : undefined}
                      aria-describedby={fieldErrors.name ? 'classmates-profile-name-error' : undefined}
                      autoComplete="off"
                    />
                    {fieldErrors.name && (
                      <p id="classmates-profile-name-error" className="classmates-field-error">{fieldErrors.name}</p>
                    )}
                  </div>

                  <div className="classmates-field">
                    <label className="classmates-label" htmlFor="classmates-profile-description">用途说明</label>
                    <textarea
                      id="classmates-profile-description"
                      ref={descriptionRef}
                      className="classmates-textarea"
                      rows={2}
                      value={draft.description}
                      onChange={event => patchDraft({ description: event.target.value })}
                      maxLength={PROFILE_DESCRIPTION_MAX}
                      required
                      aria-invalid={fieldErrors.description ? 'true' : undefined}
                      aria-describedby={
                        fieldErrors.description
                          ? 'classmates-profile-description-error classmates-profile-description-help'
                          : 'classmates-profile-description-help'
                      }
                    />
                    <p id="classmates-profile-description-help" className="classmates-help">
                      什么任务适合使用此预设，主智能体选择模型时会参考。
                    </p>
                    {fieldErrors.description && (
                      <p id="classmates-profile-description-error" className="classmates-field-error">{fieldErrors.description}</p>
                    )}
                  </div>

                  <div className="classmates-model-fields">
                    <div className="classmates-field">
                      <label className="classmates-label" htmlFor="classmates-profile-model">模型</label>
                      <select
                        id="classmates-profile-model"
                        ref={modelRef}
                        className="classmates-select"
                        value={modelSelectValue}
                        onChange={event => onModelChange(event.target.value)}
                        aria-invalid={fieldErrors.model ? 'true' : undefined}
                        aria-describedby={
                          [fieldErrors.model && 'classmates-profile-model-error', modelHelp && 'classmates-profile-model-help'].filter(Boolean).join(' ') || undefined
                        }
                      >
                        <option value="-1">请选择模型</option>
                        {state.models.map((model, index) => (
                          <option key={`${model.provider}/${model.id}`} value={String(index)}>
                            {formatModelOption(model)}
                          </option>
                        ))}
                        {modelSelectValue === 'missing' && draft.model && (
                          <option value="missing">
                            {`当前模型：${draft.model.provider}/${draft.model.id}（当前不可用，请重新选择）`}
                          </option>
                        )}
                      </select>
                      {modelHelp && <p id="classmates-profile-model-help" className="classmates-help">{modelHelp}</p>}
                      {fieldErrors.model && (
                        <p id="classmates-profile-model-error" className="classmates-field-error">{fieldErrors.model}</p>
                      )}
                    </div>

                    <div className="classmates-field">
                      <label className="classmates-label" htmlFor="classmates-profile-effort">思考强度</label>
                      <select
                        id="classmates-profile-effort"
                        ref={effortRef}
                        className="classmates-select"
                        value={selectedEffort}
                        disabled={!draft.model}
                        onChange={event => {
                          const value = event.target.value;
                          setDraft(current => (current && current.model ? {
                            ...current,
                            model: value === ''
                              ? { provider: current.model.provider, id: current.model.id }
                              : { provider: current.model.provider, id: current.model.id, reasoningEffort: value },
                          } : current));
                          setFieldErrors(current => ({ ...current, effort: undefined }));
                        }}
                        aria-invalid={fieldErrors.effort ? 'true' : undefined}
                        aria-describedby={
                          [fieldErrors.effort && 'classmates-profile-effort-error', effortHelp && 'classmates-profile-effort-help'].filter(Boolean).join(' ') || undefined
                        }
                      >
                        <option value="">模型默认</option>
                        {effortOptions.map(effort => (
                          <option key={effort.id} value={effort.id} title={effort.description}>{effort.name}</option>
                        ))}
                        {missingEffort && (
                          <option value={selectedEffort}>{selectedEffort}（当前模型不支持，请重新选择）</option>
                        )}
                      </select>
                      {effortHelp && <p id="classmates-profile-effort-help" className="classmates-help">{effortHelp}</p>}
                      {fieldErrors.effort && (
                        <p id="classmates-profile-effort-error" className="classmates-field-error">{fieldErrors.effort}</p>
                      )}
                    </div>
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
                        <dt>用途说明</dt>
                        <dd>{remoteVersion.description}</dd>
                      </div>
                      <div>
                        <dt>模型 / 思考强度</dt>
                        <dd>{formatProfileModelSummary(remoteVersion, state.models)}</dd>
                      </div>
                      <div>
                        <dt>启用</dt>
                        <dd>{remoteVersion.enabled ? '已启用' : '已停用'}</dd>
                      </div>
                    </dl>
                    <Button variant="outline"
                      type="button"
                      className="classmates-button"
                      onClick={() => openProfile(remoteVersion)}
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
                    {busy === 'remove' ? '正在删除…' : (isNew ? '放弃草稿' : '删除预设')}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="classmates-editor-placeholder">
              <p>选择或新建模型预设。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
