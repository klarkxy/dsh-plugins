import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ConfirmRequest } from './ConfirmDialog.js';
import { errorMessage } from './errors.js';
import { createPageTranslator, type PageTranslate } from './page-locales.js';
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
  /** Page translator; defaults to the zh copy. */
  t?: PageTranslate;
  /** Host-Modal confirmation owned by the parent page. */
  confirm?(request: ConfirmRequest): Promise<boolean>;
}

const DEFAULT_T = createPageTranslator('zh');
const DECLINE = async () => false;

export const PROFILE_NAME_MAX = 100;
export const PROFILE_DESCRIPTION_MAX = 200;

type BusyAction = 'save' | 'remove' | 'reload' | 'toggle' | 'protect' | null;
type FieldKey = 'name' | 'description' | 'model' | 'effort';
type FieldErrors = Partial<Record<FieldKey, string>>;
type ProfileHealth = 'enabled' | 'disabled' | 'unconfigured' | 'invalid';

/** Editor draft: the model route stays unchosen until the user picks one. */
type ProfileDraft = Omit<ModelProfile, 'model'> & { model: ModelBinding | null };

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


/** Length limits are enforced by maxLength and shown by the counters; only emptiness is reported here. */
function validateDraft(draft: ProfileDraft, models: ModelChoice[], t: PageTranslate): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.name.trim()) errors.name = t('common.nameRequired');
  if (!draft.description.trim()) errors.description = t('profile.descriptionRequired');
  if (!draft.model) {
    errors.model = t('profile.modelRequired');
  } else if (draft.enabled && !findModel(models, draft.model)) {
    errors.model = t('profile.modelUnavailable');
  }
  const effort = draft.model?.reasoningEffort;
  if (draft.enabled && draft.model && effort) {
    const chosen = findModel(models, draft.model);
    if (!chosen?.efforts.some(option => option.id === effort)) {
      errors.effort = t('profile.effortUnsupported');
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

function formatProfileModelSummary(profile: ProfileDraft, models: ModelChoice[], t: PageTranslate): string {
  if (!profile.model) return t('profile.noModel');
  const model = findModel(models, profile.model);
  const modelLabel = `${model ? formatProviderLabel(model) : profile.model.provider} · ${model?.name ?? profile.model.id}`;
  const effort = profile.model.reasoningEffort;
  const effortLabel = effort
    ? model?.efforts.find(option => option.id === effort)?.name ?? effort
    : t('common.modelDefault');
  return t('profile.summary', { model: modelLabel, effort: effortLabel });
}

/** Live character count shown beside a field label; the control's maxLength enforces it. */
function CharCount({ id, count, max }: { id: string; count: number; max: number }) {
  return <span id={id} className="dsh-ui-hint" aria-live="off">{count}/{max}</span>;
}

/** Health reads as one tag plus its state dot; the tone says the same thing twice. */
const HEALTH_TONE = {
  enabled: 'quiet',
  disabled: 'quiet',
  unconfigured: 'warning',
  invalid: 'danger',
} as const;

function StatusBadge({ health, t }: { health: ProfileHealth; t: PageTranslate }) {
  const state = { enabled: 'done', disabled: 'idle', unconfigured: 'warning', invalid: 'error' } as const;
  return (
    <Tag tone={HEALTH_TONE[health]} className="classmates-status">
      <StateDot state={state[health]} size={6} />{t(`health.${health}`)}
    </Tag>
  );
}

/**
 * The `Input` primitive renders a wrapper span around the native control and
 * does not forward a ref, so the name field's ref sits on its `dsh-ui-field`
 * wrapper; focus still has to land on the control inside, which is what
 * saving with a validation error relies on.
 */
function focusField(host: HTMLElement | null): void {
  if (host === null) return;
  const selector = 'input, textarea, select';
  const control = host.matches(selector) ? host : host.querySelector<HTMLElement>(selector);
  control?.focus();
}

export function ModelsPage({
  client, state, readOnly, onState, onDirtyChange, onEditingChange, t = DEFAULT_T, confirm = DECLINE,
}: ModelsPageProps) {
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
  const nameRef = useRef<HTMLDivElement>(null);
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

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    return confirm({
      title: t('confirm.discardTitle'),
      message: t('profile.confirmDiscard'),
      confirmLabel: t('common.discard'),
    });
  }, [dirty, confirm, t]);

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

  const requestOpenProfile = useCallback(async (profile: ModelProfile) => {
    if (!(await confirmDiscard()) || !mountedRef.current) return;
    openProfile(profile);
  }, [confirmDiscard, openProfile]);

  const requestNewProfile = useCallback(async () => {
    if (!(await confirmDiscard()) || !mountedRef.current) return;
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

  const requestBack = useCallback(async () => {
    if (!(await confirmDiscard()) || !mountedRef.current) return;
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
        setNotice(t('reload.kept'));
      } else if (!latest && !isNew) {
        setDraft(current => (current && current.id === targetId ? { ...current, revision: 0 } : current));
        setIsNew(true);
        setRemoteVersion(null);
        setNotice(t('profile.deletedRemote'));
      } else {
        setRemoteVersion(null);
        setNotice(t('reload.plain'));
      }
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(t('reload.failed', { message: errorMessage(error) }));
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [client, draft, busy, isNew, onState, t]);

  const onSave = useCallback(async () => {
    if (!saveModelProfile || !draft || busy) return;
    // Enabled is saved immediately from the list, not owned by the text form.
    const form: ProfileDraft = {
      ...draft,
      model: draft.model ? cloneBinding(draft.model) : null,
      enabled: isNew ? false : profiles.find(item => item.id === draft.id)?.enabled ?? draft.enabled,
    };
    const errors = validateDraft(form, state.models, t);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const focusMap = {
        name: nameRef,
        description: descriptionRef,
        model: modelRef,
        effort: effortRef,
      } as const;
      const first = (Object.keys(errors) as FieldKey[])[0];
      focusField(focusMap[first]?.current);
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
      setNotice(t('common.saved'));
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(t('profile.saveFailed', { message: errorMessage(error) }));
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [saveModelProfile, draft, busy, isNew, profiles, state, onState, openProfile, closeEditor, t]);

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
          setRequestError(t('profile.conflict'));
        }
      }
    } catch (error) {
      if (mountedRef.current) setToggleError(
        t('toggle.failed', { name: profile.name.trim() || profile.id, message: errorMessage(error) }),
      );
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [saveModelProfile, readOnly, busy, state.settingsRevision, draft, baseline, onState, t]);

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
        t(required ? 'protection.enableFailed' : 'protection.disableFailed', {
          model: formatRouteLabel(route, state.models),
          message: errorMessage(error),
        }),
      );
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [setModelProtection, readOnly, busy, state.settingsRevision, state.models, onState, t]);

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
      if (mountedRef.current) setToggleError(t('refresh.failed', { message: errorMessage(error) }));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [client, busy, dirty, draft, isNew, onState, openProfile, closeEditor, t]);

  const onRemove = useCallback(async () => {
    if (!removeModelProfile || !draft || busy) return;
    // The confirmation is asynchronous; a different draft opened meanwhile
    // (generation bump) cancels this removal.
    const asked = draftGenRef.current;
    if (isNew) {
      const discard = await confirm({
        title: t('confirm.draftTitle'),
        message: t('profile.confirmDraft'),
        confirmLabel: t('common.discardDraft'),
      });
      if (discard && mountedRef.current && draftGenRef.current === asked) closeEditor();
      return;
    }
    const confirmed = await confirm({
      title: t('profile.confirmDeleteTitle'),
      message: t('profile.confirmDelete', { name: draft.name.trim() || draft.id }),
      confirmLabel: t('common.delete'),
    });
    if (!confirmed || !mountedRef.current || draftGenRef.current !== asked) return;
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
      setNotice(t('common.deleted'));
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(t('delete.failed', { message: errorMessage(error) }));
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [removeModelProfile, draft, busy, isNew, state.settingsRevision, onState, closeEditor, confirm, t]);

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
    // Page-level section below the two-column layout (not inside the sticky
    // list column): the setting is per model, shared by every preset.
    <section
      className="dsh-ui-section dsh-ui-stack classmates-protection"
      aria-labelledby="classmates-protection-heading"
      aria-busy={busy === 'protect' || undefined}
    >
      <h2 id="classmates-protection-heading" className="dsh-ui-heading">{t('protection.title')}</h2>
      <p className="dsh-ui-help">{t('protection.help')}</p>
      {!protectionSupported && (
        <p className="dsh-ui-help">{t('protection.unsupported')}</p>
      )}
      <div className="dsh-ui-field">
        <label className="dsh-ui-label" htmlFor="classmates-protection-model">{t('common.model')}</label>
        <select
          id="classmates-protection-model"
          className="dsh-ui-select"
          value={routeSelection}
          onChange={event => setRouteSelection(event.target.value)}
          disabled={protectionDisabled || state.models.length === 0}
        >
          <option value="">{state.models.length === 0 ? t('common.noModels') : t('common.chooseModel')}</option>
          {state.models.map(model => {
            const value = JSON.stringify({ provider: model.provider, id: model.id });
            return <option key={value} value={value}>{formatModelOption(model)}</option>;
          })}
        </select>
      </div>
      <div className="dsh-ui-row-wrap">
        <Switch
          label={selectedRouteLabel ? t('protection.switch', { model: selectedRouteLabel }) : t('protection.switchEmpty')}
          checked={selectedProtected}
          onChange={required => {
            if (selectedRoute) void toggleProtection(selectedRoute, required);
          }}
          disabled={protectionDisabled || !selectedRoute}
          title={t('protection.switchTitle')}
        />
        {busy === 'protect' && <span className="dsh-ui-meta" role="status">{t('common.saving')}</span>}
      </div>
      {protectionError && (
        <div className="dsh-ui-stack" role="alert">
          <p className="dsh-ui-error dsh-ui-wrap">{protectionError}</p>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refreshProfileList()}>{t('protection.refresh')}</Button>
        </div>
      )}
      {protectedRoutes.length > 0 && (
        <ul className="dsh-ui-list" aria-label={t('protection.list')}>
          {protectedRoutes.map(route => {
            const label = formatRouteLabel(route, state.models);
            const missing = !findModel(state.models, route);
            return (
              <li key={JSON.stringify(route)} className="dsh-ui-row">
                <span className="classmates-protection-route">
                  <span className="dsh-ui-list-name">{label}</span>
                  {missing && <span className="dsh-ui-list-desc">{t('protection.missing')}</span>}
                </span>
                <Switch
                  label={t('protection.off', { model: label })}
                  checked
                  onChange={() => void toggleProtection(route, false)}
                  disabled={protectionDisabled}
                  title={t('common.savesNow')}
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
      <div className="dsh-ui-stack classmates-models">
        <p className="dsh-ui-banner" role="status">{t('profile.unsupported')}</p>
        {profiles.length > 0 && (
          <ul className="dsh-ui-list dsh-ui-list-scroll classmates-list" aria-label={t('profile.readonlyList')}>
            {profiles.map(profile => (
              <li key={profile.id} className="dsh-ui-list-row">
                <div className="dsh-ui-list-item classmates-static">
                  <span className="dsh-ui-list-name">{profile.name.trim() || t('profile.unnamed')}</span>
                  <span className="dsh-ui-list-desc" title={profile.description}>
                    {profile.description.trim() || t('profile.noDescription')}
                  </span>
                  <span className="dsh-ui-list-desc">{formatProfileModelSummary(profile, state.models, t)}</span>
                  <StatusBadge health={profile.enabled ? 'enabled' : 'disabled'} t={t} />
                  {protectedRoutes.some(route => sameRoute(route, profile.model)) && (
                    <Tag tone="info" className="classmates-status">{t('protection.tag')}</Tag>
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
    ? [selectedModel.description, catalogConnectivityUnknown(selectedModel) ? t('profile.unverified') : undefined]
      .filter(Boolean).join(' ') || undefined
    : !draft?.model && state.models.length === 0
      ? t('common.noModels')
      : undefined;
  const effortHelp = selectedEffortInfo?.description
    ?? (selectedEffort === '' ? t('profile.effortDefaultHelp') : undefined);

  return (
    <div className="dsh-ui-stack classmates-models">
      {notice && (
        <p className="dsh-ui-notice" aria-live="polite">{notice}</p>
      )}

      <div className="classmates-body">
        <section className="dsh-ui-stack classmates-list-pane" aria-labelledby="classmates-profiles-heading">
          <div className="dsh-ui-row classmates-list-head">
            <h2 id="classmates-profiles-heading" className="dsh-ui-heading">
              {t('profile.heading', { count: profiles.length })}
            </h2>
            <Button variant="outline" size="sm"
              type="button"
              onClick={() => void requestNewProfile()}
              disabled={readOnly || busy !== null}
            >
              {t('profile.new')}
            </Button>
          </div>
          <p className="dsh-ui-help classmates-lead">{t('profile.lead')}</p>
          {toggleError && (
            <div className="dsh-ui-stack" role="alert">
              <p className="dsh-ui-error dsh-ui-wrap">{toggleError}</p>
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refreshProfileList()}>{t('common.refresh')}</Button>
            </div>
          )}
          {profiles.length === 0 ? (
            <p className="dsh-ui-empty">{t('profile.empty')}</p>
          ) : (
            <ul className="dsh-ui-list dsh-ui-list-scroll classmates-list">
              {profiles.map(profile => {
                const health = profileHealth(profile, state.models);
                return (
                  <li key={profile.id} className="dsh-ui-list-row" data-selected={selectedId === profile.id && !isNew || undefined}>
                    <button
                      type="button"
                      className="dsh-ui-list-item"
                      aria-current={selectedId === profile.id && !isNew ? 'true' : undefined}
                      onClick={() => void requestOpenProfile(profile)}
                      disabled={busy !== null}
                    >
                      <span className="dsh-ui-list-name">{profile.name.trim() || t('profile.unnamed')}</span>
                      <span className="dsh-ui-list-desc" title={profile.description}>
                        {profile.description.trim() || t('profile.noDescription')}
                      </span>
                      <span className="dsh-ui-list-desc">{formatProfileModelSummary(profile, state.models, t)}</span>
                      {health === 'invalid' && <StatusBadge health={health} t={t} />}
                      {protectedRoutes.some(route => sameRoute(route, profile.model)) && (
                        <Tag tone="info" className="classmates-status">{t('protection.tag')}</Tag>
                      )}
                    </button>
                    <Switch
                      label={t('profile.enable', { name: profile.name.trim() || profile.id })}
                      checked={profile.enabled}
                      onChange={enabled => void toggleProfile(profile, enabled)}
                      disabled={readOnly || busy !== null}
                      title={t('common.savesNow')}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="dsh-ui-stack classmates-editor" aria-label={t('profile.editor')}>
          {draft ? (
            <>
              <Button variant="outline" type="button" className="classmates-back" onClick={() => void requestBack()} disabled={busy !== null}>
                {t('common.back')}
              </Button>
              <div className="dsh-ui-row-wrap classmates-editor-head">
                <h3 className="dsh-ui-title" ref={headingRef} tabIndex={-1}>
                  {isNew ? t('profile.newTitle') : (draft.name.trim() || t('profile.unnamed'))}
                </h3>
                {isNew
                  ? <Tag tone="warning" className="classmates-status">{t('common.unsaved')}</Tag>
                  : <StatusBadge health={profileHealth(draft, state.models)} t={t} />}
                {dirty && <span className="dsh-ui-meta dsh-ui-warn">{t('common.dirty')}</span>}
              </div>

              <form
                className="dsh-ui-stack"
                aria-label={isNew ? t('profile.formNew') : t('profile.formEdit', { name: draft.name.trim() || draft.id })}
                onSubmit={event => {
                  event.preventDefault();
                  void onSave();
                }}
              >
                <fieldset disabled={readOnly || busy !== null} className="dsh-ui-stack classmates-fields">
                  {requestError && (
                    <div className="dsh-ui-banner dsh-ui-banner--danger" role="alert">
                      <p>{requestError}</p>
                      <div className="dsh-ui-actions">
                        <Button variant="outline"
                          type="button"
                          className="classmates-button"
                          onClick={() => void onSave()}
                        >
                          {t('common.retrySave')}
                        </Button>
                        <Button variant="outline"
                          type="button"
                          className="classmates-button"
                          onClick={() => void reloadKeepingDraft()}
                        >
                          {t('common.reloadKeep')}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="dsh-ui-field" ref={nameRef}>
                    <div className="dsh-ui-label-row">
                      <label className="dsh-ui-label" htmlFor="classmates-profile-name">{t('common.name')}</label>
                      <CharCount id="classmates-profile-name-count" count={draft.name.length} max={PROFILE_NAME_MAX} />
                    </div>
                    <Input
                      className={`dsh-ui-control classmates-input${fieldErrors.name ? ' classmates-invalid' : ''}`}
                      id="classmates-profile-name"
                      type="text"
                      value={draft.name}
                      onChange={event => patchDraft({ name: event.target.value })}
                      maxLength={PROFILE_NAME_MAX}
                      required
                      aria-invalid={fieldErrors.name ? 'true' : undefined}
                      aria-describedby={fieldErrors.name ? 'classmates-profile-name-error classmates-profile-name-count' : 'classmates-profile-name-count'}
                      autoComplete="off"
                    />
                    {fieldErrors.name && (
                      <p id="classmates-profile-name-error" className="dsh-ui-error">{fieldErrors.name}</p>
                    )}
                  </div>

                  <div className="dsh-ui-field">
                    <div className="dsh-ui-label-row">
                      <label className="dsh-ui-label" htmlFor="classmates-profile-description">{t('profile.description')}</label>
                      <CharCount id="classmates-profile-description-count" count={draft.description.length} max={PROFILE_DESCRIPTION_MAX} />
                    </div>
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
                          ? 'classmates-profile-description-error classmates-profile-description-help classmates-profile-description-count'
                          : 'classmates-profile-description-help classmates-profile-description-count'
                      }
                    />
                    <p id="classmates-profile-description-help" className="dsh-ui-help">{t('profile.descriptionHelp')}</p>
                    {fieldErrors.description && (
                      <p id="classmates-profile-description-error" className="dsh-ui-error">{fieldErrors.description}</p>
                    )}
                  </div>

                  <div className="classmates-model-fields">
                    <div className="dsh-ui-field">
                      <label className="dsh-ui-label" htmlFor="classmates-profile-model">{t('common.model')}</label>
                      <select
                        id="classmates-profile-model"
                        ref={modelRef}
                        className="dsh-ui-select"
                        value={modelSelectValue}
                        onChange={event => onModelChange(event.target.value)}
                        aria-invalid={fieldErrors.model ? 'true' : undefined}
                        aria-describedby={
                          [fieldErrors.model && 'classmates-profile-model-error', modelHelp && 'classmates-profile-model-help'].filter(Boolean).join(' ') || undefined
                        }
                      >
                        <option value="-1">{t('common.chooseModel')}</option>
                        {state.models.map((model, index) => (
                          <option key={`${model.provider}/${model.id}`} value={String(index)}>
                            {formatModelOption(model)}
                          </option>
                        ))}
                        {modelSelectValue === 'missing' && draft.model && (
                          <option value="missing">
                            {t('profile.missingModel', { model: `${draft.model.provider}/${draft.model.id}` })}
                          </option>
                        )}
                      </select>
                      {modelHelp && <p id="classmates-profile-model-help" className="dsh-ui-help">{modelHelp}</p>}
                      {fieldErrors.model && (
                        <p id="classmates-profile-model-error" className="dsh-ui-error">{fieldErrors.model}</p>
                      )}
                    </div>

                    <div className="dsh-ui-field">
                      <label className="dsh-ui-label" htmlFor="classmates-profile-effort">{t('common.effort')}</label>
                      <select
                        id="classmates-profile-effort"
                        ref={effortRef}
                        className="dsh-ui-select"
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
                        <option value="">{t('common.modelDefault')}</option>
                        {effortOptions.map(effort => (
                          <option key={effort.id} value={effort.id} title={effort.description}>{effort.name}</option>
                        ))}
                        {missingEffort && (
                          <option value={selectedEffort}>{t('profile.missingEffort', { effort: selectedEffort })}</option>
                        )}
                      </select>
                      {effortHelp && <p id="classmates-profile-effort-help" className="dsh-ui-help">{effortHelp}</p>}
                      {fieldErrors.effort && (
                        <p id="classmates-profile-effort-error" className="dsh-ui-error">{fieldErrors.effort}</p>
                      )}
                    </div>
                  </div>
                </fieldset>

                {remoteVersion && (
                  <div className="dsh-ui-banner" role="group" aria-label={t('remote.label')}>
                    <p className="dsh-ui-banner-title">
                      {t('remote.title', { revision: remoteVersion.revision })}
                    </p>
                    <p className="dsh-ui-help">{t('remote.help')}</p>
                    <dl className="classmates-remote-fields">
                      <div>
                        <dt className="dsh-ui-meta">{t('common.name')}</dt>
                        <dd className="dsh-ui-compact">{remoteVersion.name}</dd>
                      </div>
                      <div>
                        <dt className="dsh-ui-meta">{t('profile.description')}</dt>
                        <dd className="dsh-ui-compact">{remoteVersion.description}</dd>
                      </div>
                      <div>
                        <dt className="dsh-ui-meta">{t('remote.model')}</dt>
                        <dd className="dsh-ui-compact">{formatProfileModelSummary(remoteVersion, state.models, t)}</dd>
                      </div>
                      <div>
                        <dt className="dsh-ui-meta">{t('remote.enabled')}</dt>
                        <dd className="dsh-ui-compact">{t(remoteVersion.enabled ? 'health.enabled' : 'health.disabled')}</dd>
                      </div>
                    </dl>
                    <div className="dsh-ui-actions">
                      <Button variant="outline"
                        type="button"
                        className="classmates-button"
                        onClick={() => openProfile(remoteVersion)}
                        disabled={busy !== null}
                      >
                        {t('remote.discard')}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="dsh-ui-actions">
                  <Button variant="primary"
                    type="submit"
                    className="classmates-button"
                    disabled={readOnly || busy !== null}
                  >
                    {busy === 'save' ? t('common.saving') : t('common.save')}
                  </Button>
                  <Button variant="outline"
                    type="button"
                    className="classmates-button classmates-button--danger"
                    onClick={() => void onRemove()}
                    disabled={readOnly || busy !== null}
                  >
                    {busy === 'remove' ? t('common.deleting') : (isNew ? t('common.discardDraft') : t('profile.delete'))}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="dsh-ui-empty">
              <p>{t('profile.emptyEditor')}</p>
            </div>
          )}
        </section>
      </div>

      {protectionSection}
    </div>
  );
}
