import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, SegmentedTabs, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type {
  ClassmatesClient,
  ClassmatesState,
  ModelChoice,
  ModelProfile,
  NormalizedRole,
  RoleModelSelection,
} from '../contracts.js';
import { normalizeRole } from '../contracts.js';
import { createPresets } from '../presets.js';
import { useConfirmDialog } from './ConfirmDialog.js';
import { errorMessage } from './errors.js';
import { isAbortError, isHandoffBusy } from './handoff.js';
import { useLocaleId, useStartTaskAvailable, type LocaleSource } from './hooks.js';
import { createPageTranslator, type PageTranslate } from './page-locales.js';
import {
  modelSourceFromModel,
  parseRouteValue,
  profileReferenceStatus,
  selectionFromModelSource,
  toSavePayload,
  formatRouteValue,
  type ModelSourceState,
} from './role-model.js';
import {
  findModel,
  formatModelOption,
  formatRoleModelSummary,
  roleHealth,
  type RoleHealth,
} from './roles.js';
import { classmatesCss } from './styles.js';
import { ModelsPage } from './ModelsPage.js';

export interface ClassmatesPageProps {
  client: ClassmatesClient;
  /** Host locale runtime; absent in tests, where the page falls back to zh. */
  locale?: LocaleSource;
}

type LoadStatus = 'loading' | 'load-error' | 'ready';
type BusyAction = 'save' | 'remove' | 'reload' | 'toggle' | 'model' | null;

type FieldKey = 'name' | 'description' | 'instructions';
type FieldErrors = Partial<Record<FieldKey, string>>;

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 200;
export const INSTRUCTIONS_MAX = 32000;

/**
 * Length limits are enforced by the controls' maxLength (and again on the
 * host), so the form only reports empty fields; the live counter next to each
 * label is how a user sees the limit. The model source is saved on its own
 * and never blocks the text form.
 */
function validateDraft(draft: NormalizedRole, t: PageTranslate): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.name.trim()) errors.name = t('common.nameRequired');
  if (!draft.description.trim()) errors.description = t('role.descriptionRequired');
  if (!draft.instructions.trim()) errors.instructions = t('role.instructionsRequired');
  return errors;
}

function snapshot(role: NormalizedRole): string {
  return JSON.stringify({
    name: role.name,
    description: role.description,
    instructions: role.instructions,
    enabled: role.enabled,
    model: role.model,
    reasoningEffort: role.reasoningEffort ?? null,
  });
}

function cloneModelSelection(model: RoleModelSelection): RoleModelSelection {
  if (model.kind === 'fixed') {
    return {
      kind: 'fixed',
      provider: model.provider,
      id: model.id,
      ...model.effort === undefined ? {} : { effort: model.effort },
    };
  }
  if (model.kind === 'profile') return { kind: 'profile', profileId: model.profileId };
  return { kind: 'inherit' };
}

function cloneRole(role: NormalizedRole): NormalizedRole {
  return { ...role, model: cloneModelSelection(role.model) };
}

function createDraft(): NormalizedRole {
  return {
    schemaVersion: 1,
    id: `role-${crypto.randomUUID()}`,
    revision: 0,
    name: '',
    description: '',
    instructions: '',
    enabled: false,
    model: { kind: 'inherit' },
  };
}

function modelLabel(role: NormalizedRole, models: ModelChoice[], profiles: ModelProfile[], t: PageTranslate): string {
  return formatRoleModelSummary(role, models, {
    follow: t('role.followChat'),
    profile: preset => t('roleModel.profileSummary', { preset }),
    summary: (model, effort) => t('role.modelSummary', { model, effort }),
  }, profiles);
}

const presets = createPresets();

function classmatesTabs(t: PageTranslate) {
  return [
    { value: 'roles', label: t('tab.roles'), id: 'classmates-tab-roles', panelId: 'classmates-panel-roles' },
    { value: 'models', label: t('tab.models'), id: 'classmates-tab-models', panelId: 'classmates-panel-models' },
  ] as const;
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

function StatusBadge({ health, t }: { health: RoleHealth; t: PageTranslate }) {
  const state = { enabled: 'done', disabled: 'idle', unconfigured: 'warning', invalid: 'error' } as const;
  return (
    <Tag tone={HEALTH_TONE[health]} className="classmates-status">
      <StateDot state={state[health]} size={6} />{t(`health.${health}`)}
    </Tag>
  );
}

/**
 * Three-state model source: follow the dispatching chat, a strong model-preset
 * reference, or a fixed route. Like the enable Switch, every confirmed change
 * saves immediately and submits only this field; choosing a kind whose
 * subfield is still empty waits for that choice instead of saving a draft.
 */
function ModelSourceField({
  role, profiles, models, disabled, saving, error, t, onSave,
}: {
  role: NormalizedRole;
  profiles: ModelProfile[];
  models: ModelChoice[];
  disabled: boolean;
  saving: boolean;
  error: string | null;
  t: PageTranslate;
  onSave(selection: RoleModelSelection): void;
}) {
  const [source, setSource] = useState<ModelSourceState>(() => modelSourceFromModel(role.model));
  const syncRef = useRef(`${role.id}|${JSON.stringify(role.model)}`);

  // Sync from the saved model (adopting a migration, a reload, a role switch):
  // the active kind takes the saved values, other kinds keep what the user saw.
  useEffect(() => {
    const key = `${role.id}|${JSON.stringify(role.model)}`;
    if (syncRef.current === key) return;
    const idChanged = !syncRef.current.startsWith(`${role.id}|`);
    syncRef.current = key;
    const next = modelSourceFromModel(role.model);
    setSource(current => (idChanged ? next : {
      kind: next.kind,
      profileId: next.kind === 'profile' ? next.profileId : current.profileId,
      route: next.kind === 'fixed' ? next.route : current.route,
      effort: next.kind === 'fixed' ? next.effort : current.effort,
    }));
  }, [role.id, role.model]);

  const commit = (next: ModelSourceState) => {
    setSource(next);
    const selection = selectionFromModelSource(next);
    if (selection !== null) onSave(selection);
  };

  const unavailable = disabled || saving;
  const help = source.kind === 'inherit'
    ? t('roleModel.inheritHelp')
    : source.kind === 'profile'
      ? t('roleModel.profileHelp')
      : t('roleModel.fixedHelp');

  const profileStatus = source.profileId ? profileReferenceStatus(source.profileId, profiles) : null;
  const missingProfile = profiles.find(item => item.id === source.profileId);

  const route = parseRouteValue(source.route);
  const routeInCatalog = route ? findModel(models, route) : undefined;
  const routeSelectValue = !route ? '' : routeInCatalog ? source.route : 'missing';
  const effortOptions = routeInCatalog?.efforts ?? [];
  const effortMissing = source.effort !== '' && !effortOptions.some(option => option.id === source.effort);

  return (
    <div className="dsh-ui-stack classmates-model-source">
      <div className="dsh-ui-field">
        <label className="dsh-ui-label" htmlFor="classmates-model-source">{t('roleModel.label')}</label>
        <select
          id="classmates-model-source"
          className="dsh-ui-select"
          value={source.kind}
          onChange={event => commit({ ...source, kind: event.target.value as ModelSourceState['kind'] })}
          disabled={unavailable}
          aria-describedby="classmates-model-source-help"
        >
          <option value="inherit">{t('roleModel.inherit')}</option>
          <option value="profile">{t('roleModel.profile')}</option>
          <option value="fixed">{t('roleModel.fixed')}</option>
        </select>
        <p id="classmates-model-source-help" className="dsh-ui-help">{help}</p>
      </div>

      {source.kind === 'profile' && (
        <div className="dsh-ui-field">
          <label className="dsh-ui-label" htmlFor="classmates-model-profile">{t('roleModel.profileLabel')}</label>
          <select
            id="classmates-model-profile"
            className="dsh-ui-select"
            value={source.profileId}
            onChange={event => commit({ ...source, profileId: event.target.value })}
            disabled={unavailable}
            aria-describedby={profileStatus === 'missing' || profileStatus === 'disabled' ? 'classmates-model-profile-warning' : undefined}
          >
            <option value="">{t('roleModel.profilePlaceholder')}</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.enabled
                  ? t('roleModel.profileOption', { name: profile.name, id: profile.id })
                  : t('roleModel.profileDisabledOption', { name: profile.name, id: profile.id })}
              </option>
            ))}
            {profileStatus === 'missing' && (
              <option value={source.profileId}>{t('roleModel.profileMissingOption', { id: source.profileId })}</option>
            )}
          </select>
          {profileStatus === 'missing' && (
            <p id="classmates-model-profile-warning" className="dsh-ui-error">
              {t('roleModel.profileMissing', { id: source.profileId })}
            </p>
          )}
          {profileStatus === 'disabled' && missingProfile && (
            <p id="classmates-model-profile-warning" className="dsh-ui-error">
              {t('roleModel.profileDisabled', { name: missingProfile.name, id: missingProfile.id })}
            </p>
          )}
        </div>
      )}

      {source.kind === 'fixed' && (
        <div className="classmates-model-fields">
          <div className="dsh-ui-field">
            <label className="dsh-ui-label" htmlFor="classmates-model-fixed">{t('common.model')}</label>
            <select
              id="classmates-model-fixed"
              className="dsh-ui-select"
              value={routeSelectValue}
              onChange={event => {
                if (event.target.value === 'missing') return;
                // Picking a model clears the effort, inheriting the calling conversation's effort.
                commit({ ...source, route: event.target.value, effort: '' });
              }}
              disabled={unavailable}
              aria-describedby={routeSelectValue === 'missing' ? 'classmates-model-fixed-warning' : undefined}
            >
              <option value="">{t('common.chooseModel')}</option>
              {models.map(model => {
                const value = formatRouteValue(model);
                return <option key={value} value={value}>{formatModelOption(model)}</option>;
              })}
              {routeSelectValue === 'missing' && route && (
                <option value="missing">{t('profile.missingModel', { model: `${route.provider}/${route.id}` })}</option>
              )}
            </select>
            {routeSelectValue === 'missing' && (
              <p id="classmates-model-fixed-warning" className="dsh-ui-error">{t('roleModel.fixedMissing')}</p>
            )}
          </div>

          {routeInCatalog && effortOptions.length > 0 && (
            <div className="dsh-ui-field">
              <label className="dsh-ui-label" htmlFor="classmates-model-effort">{t('common.effort')}</label>
              <select
                id="classmates-model-effort"
                className="dsh-ui-select"
                value={source.effort}
                onChange={event => commit({ ...source, effort: event.target.value })}
                disabled={unavailable}
              >
                <option value="">{t('roleModel.inheritEffort')}</option>
                {effortOptions.map(effort => (
                  <option key={effort.id} value={effort.id} title={effort.description}>{effort.name}</option>
                ))}
                {effortMissing && (
                  <option value={source.effort}>{t('profile.missingEffort', { effort: source.effort })}</option>
                )}
              </select>
            </div>
          )}
        </div>
      )}

      {saving && <p className="dsh-ui-meta" role="status">{t('common.saving')}</p>}
      {error && (
        <p className="dsh-ui-error dsh-ui-wrap" role="alert">{error}</p>
      )}
    </div>
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

export function ClassmatesPage({ client, locale }: ClassmatesPageProps) {
  const localeId = useLocaleId(locale);
  const t = useMemo(() => createPageTranslator(localeId), [localeId]);
  const [confirmDialog, confirm] = useConfirmDialog(t);
  const startTaskAvailable = useStartTaskAvailable(client);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [state, setState] = useState<ClassmatesState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NormalizedRole | null>(null);
  const [baseline, setBaseline] = useState<NormalizedRole | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState('');

  const [busy, setBusy] = useState<BusyAction>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [remoteVersion, setRemoteVersion] = useState<NormalizedRole | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [tab, setTab] = useState<'roles' | 'models'>('roles');
  const [modelsDirty, setModelsDirty] = useState(false);
  const [modelsEditing, setModelsEditing] = useState(false);

  const mountedRef = useRef(true);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftGenRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
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

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    return confirm({
      title: t('confirm.discardTitle'),
      message: t('role.confirmDiscard'),
      confirmLabel: t('common.discard'),
    });
  }, [dirty, confirm, t]);

  const openRole = useCallback((role: NormalizedRole) => {
    draftGenRef.current += 1;
    setDraft(cloneRole(role));
    setBaseline(role);
    setSelectedId(role.id);
    setIsNew(false);
    setFieldErrors({});
    setRequestError(null);
    setNotice(null);
    setModelError(null);
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
    setModelError(null);
    setRemoteVersion(null);
  }, []);

  const requestOpenRole = useCallback(async (role: NormalizedRole) => {
    if (!(await confirmDiscard()) || !mountedRef.current) return;
    openRole(role);
  }, [confirmDiscard, openRole]);

  const requestNewRole = useCallback(async () => {
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
    setModelError(null);
    setRemoteVersion(null);
  }, [confirmDiscard]);

  const requestPresetRole = useCallback(async () => {
    if (!state || !selectedPresetId) return;
    if (!(await confirmDiscard()) || !mountedRef.current) return;
    const preset = presets.find(item => item.id === selectedPresetId);
    if (!preset) return;
    let id = preset.id;
    if (state.roles.some(role => role.id === id)) {
      do { id = `role-${crypto.randomUUID()}`; }
      while (state.roles.some(role => role.id === id));
    }
    const next = cloneRole(normalizeRole({ ...preset, id, revision: 0, enabled: false }));
    draftGenRef.current += 1;
    setDraft(next);
    setBaseline(next);
    setSelectedId(next.id);
    setIsNew(true);
    setSelectedPresetId('');
    setFieldErrors({});
    setRequestError(null);
    setNotice(null);
    setModelError(null);
    setRemoteVersion(null);
  }, [state, selectedPresetId, confirmDiscard]);

  const requestBack = useCallback(async () => {
    if (!(await confirmDiscard()) || !mountedRef.current) return;
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
        setNotice(t('reload.kept'));
      } else if (!latest && !isNew) {
        setDraft(current => (current && current.id === targetId ? { ...current, revision: 0 } : current));
        setIsNew(true);
        setRemoteVersion(null);
        setNotice(t('role.deletedRemote'));
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
  }, [client, state, draft, busy, isNew, t]);

  const onSave = useCallback(async () => {
    if (!state || !draft || busy) return;
    // Enabled is saved immediately from the list, not owned by the text form.
    const input = { ...cloneRole(draft), enabled: isNew ? false : state.roles.find(role => role.id === draft.id)?.enabled ?? draft.enabled };
    const errors = validateDraft(input, t);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      const focusMap = {
        name: nameRef,
        description: descriptionRef,
        instructions: instructionsRef,
      } as const;
      const first = (Object.keys(errors) as FieldKey[])[0];
      focusField(focusMap[first].current);
      return;
    }
    const generation = draftGenRef.current;
    const targetId = draft.id;
    setBusy('save');
    setRequestError(null);
    setNotice(null);
    try {
      const next = await client.save(toSavePayload(input), state.settingsRevision);
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setState(next);
      const saved = next.roles.find(r => r.id === targetId);
      setBusy(null);
      if (saved) {
        openRole(saved);
      } else {
        closeEditor();
      }
      setNotice(t('role.savedNotice'));
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(t('role.saveFailed', { message: errorMessage(error) }));
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [client, state, draft, busy, isNew, openRole, closeEditor, t]);

  const toggleRole = useCallback(async (role: NormalizedRole, enabled: boolean) => {
    if (!state?.writable || busy) return;
    setBusy('toggle');
    setToggleError(null);
    setNotice(null);
    try {
      // Send the accepted list value, never the unsaved editor draft.
      const next = await client.save(toSavePayload({ ...cloneRole(role), enabled }), state.settingsRevision);
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
          setRequestError(t('role.conflict'));
        }
      }
      setAssistantError(null);
    } catch (error) {
      if (mountedRef.current) setToggleError(
        t('toggle.failed', { name: role.name.trim() || role.id, message: errorMessage(error) }),
      );
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [client, state, busy, draft, baseline, t]);

  /**
   * Immediate save of the model source alone (same semantics as the enable
   * Switch): the payload carries the last accepted text, never the unsaved
   * draft, and the dirty text edits stay untouched on success.
   */
  const saveModelSelection = useCallback(async (selection: RoleModelSelection) => {
    if (!state || !draft || busy) return;
    setModelError(null);
    if (isNew) {
      // Nothing persisted yet; the choice is written by the first explicit save.
      setDraft(current => (current ? { ...current, model: cloneModelSelection(selection) } : current));
      return;
    }
    const saved = state.roles.find(role => role.id === draft.id);
    if (!saved) return;
    const generation = draftGenRef.current;
    const targetId = draft.id;
    setBusy('model');
    setNotice(null);
    try {
      const next = await client.save(toSavePayload({ ...saved, model: selection }), state.settingsRevision);
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setState(next);
      const updated = next.roles.find(role => role.id === targetId);
      if (updated) {
        const sameBase = baseline && baseline.revision === saved.revision && snapshot(baseline) === snapshot(saved);
        const onlyModel = updated.revision === saved.revision + 1
          && snapshot(updated) === snapshot({ ...saved, model: selection });
        const sync = (current: NormalizedRole | null): NormalizedRole | null => {
          if (!current || current.id !== updated.id) return current;
          const merged = {
            ...current,
            model: cloneModelSelection(updated.model),
            // Only our model mutation may advance the text draft's CAS base.
            revision: sameBase && onlyModel ? updated.revision : current.revision,
            enabled: updated.enabled,
          };
          delete merged.migratedRecommendation;
          return merged;
        };
        setDraft(sync);
        setBaseline(sync);
        if (sameBase && onlyModel) {
          setRemoteVersion(null);
        } else {
          setRemoteVersion(updated);
          setRequestError(t('role.conflict'));
        }
      }
      setNotice(t('roleModel.saved'));
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setModelError(t('roleModel.saveFailed', { message: errorMessage(error) }));
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [client, state, draft, baseline, busy, isNew, t]);

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
      if (mountedRef.current) setToggleError(t('refresh.failed', { message: errorMessage(error) }));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [client, busy, dirty, draft, isNew, openRole, closeEditor, t]);

  const onRemove = useCallback(async () => {
    if (!state || !draft || busy) return;
    // The confirmation is asynchronous; a different draft opened meanwhile
    // (generation bump) cancels this removal.
    const asked = draftGenRef.current;
    if (isNew) {
      const discard = await confirm({
        title: t('confirm.draftTitle'),
        message: t('role.confirmDraft'),
        confirmLabel: t('common.discardDraft'),
      });
      if (discard && mountedRef.current && draftGenRef.current === asked) closeEditor();
      return;
    }
    const confirmed = await confirm({
      title: t('role.confirmDeleteTitle'),
      message: t('role.confirmDelete', { name: draft.name.trim() || draft.id }),
      confirmLabel: t('common.delete'),
    });
    if (!confirmed || !mountedRef.current || draftGenRef.current !== asked) return;
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
      setNotice(t('role.deleted'));
    } catch (error) {
      if (!mountedRef.current || draftGenRef.current !== generation) return;
      setRequestError(t('delete.failed', { message: errorMessage(error) }));
    } finally {
      if (mountedRef.current && draftGenRef.current === generation) setBusy(null);
    }
  }, [client, state, draft, busy, isNew, closeEditor, confirm, t]);

  const patchDraft = useCallback((patch: Partial<NormalizedRole>) => {
    setDraft(current => (current ? { ...current, ...patch } : current));
  }, []);

  const copyDemoRequest = useCallback(async (text: string) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        // execCommand reports failure by returning false, not by throwing.
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      } finally {
        area.remove();
      }
    }
    if (!mountedRef.current) return;
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    setCopyState(ok ? 'copied' : 'failed');
    // A failure stays visible until the next attempt; success fades.
    if (ok) {
      copyTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopyState('idle');
      }, 2000);
    }
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
  const rootClass = `classmates dsh-ui-panel${editing ? ' classmates--editing' : ''}`;
  const readOnly = state !== null && !state.writable;
  const profiles = state?.modelProfiles ?? [];
  const demoRole = useMemo(() => {
    if (!state) return null;
    if (draft?.enabled && draft.name.trim() && roleHealth(draft, state.models, profiles) === 'enabled') return draft;
    return state.roles.find(r => roleHealth(r, state.models, profiles) === 'enabled') ?? null;
  }, [state, draft, profiles]);
  const demoText = demoRole
    ? t('demo.withRole', { name: demoRole.name.trim() })
    : t('demo.noRole');
  const tabs = useMemo(() => classmatesTabs(t), [t]);

  // One-time legacy note, read from the persisted role: any save strips it.
  const migrationNotice = draft && !isNew
    ? state?.roles.find(role => role.id === draft.id)?.migratedRecommendation
    : undefined;

  const changeTab = useCallback((next: 'roles' | 'models') => {
    // Notices describe the tab they were raised on; they do not follow a switch.
    setNotice(null);
    setTab(next);
  }, []);

  return (
    <div className={rootClass}>
      <style>{classmatesCss}</style>

      {confirmDialog}

      {/* The host plugin page owns the page title; this row only carries the
       * lead sentences and the page-level action. */}
      <div className="dsh-ui-row-wrap classmates-toolbar">
        <div className="classmates-lead-block">
          <p className="dsh-ui-help classmates-lead">{t('page.lead')}</p>
          <p className="dsh-ui-help classmates-lead">{t('page.creatorNote')}</p>
          <p className="dsh-ui-help classmates-lead">{t('page.priorityNote')}</p>
        </div>

        {startTaskAvailable && (
          <div className="dsh-ui-row-wrap classmates-assistant">
            <Button variant="outline"
              type="button"
              className="classmates-button"
              data-classmates-start-task="true"
              onClick={() => void runHandoff(() => client.startTask?.())}
              disabled={handoffBusy || busy !== null}
            >
              {t('startTask')}
            </Button>
            {assistantError && (
              <p className="dsh-ui-error dsh-ui-wrap" role="alert">{assistantError}</p>
            )}
          </div>
        )}
      </div>

      {status === 'loading' && (
        <p className="dsh-ui-loading" role="status">{t('loading')}</p>
      )}

      {status === 'load-error' && (
        <div className="dsh-ui-banner dsh-ui-banner--danger" role="alert">
          <p>{t('loadError', { message: loadError ?? '' })}</p>
          <div className="dsh-ui-actions">
            <Button variant="outline" type="button" className="classmates-button" onClick={() => void retryLoad()}>
              {t('retry')}
            </Button>
          </div>
        </div>
      )}

      {status === 'ready' && state && (
        <>
          {state.catalogErrors?.length ? (
            // Base banner tone is the warning rail; a partial read is a warning, not a failure.
            <div className="dsh-ui-banner" role="status">
              <p className="dsh-ui-banner-title">{t('catalogError.title')}</p>
              <p className="dsh-ui-wrap">{state.catalogErrors.join('；')}</p>
              <p>{t('catalogError.rest')}</p>
            </div>
          ) : null}
          {readOnly && (
            <p className="dsh-ui-banner dsh-ui-banner--info" role="status">
              {t('readOnly')}
            </p>
          )}

          <SegmentedTabs
            className="classmates-tabs"
            label={t('tabs.label')}
            items={tabs}
            value={tab}
            onChange={changeTab}
          />

          <div
            role="tabpanel"
            id="classmates-panel-roles"
            aria-labelledby="classmates-tab-roles"
            hidden={tab !== 'roles'}
          >
          {notice && (
            <p className="dsh-ui-notice" aria-live="polite">{notice}</p>
          )}
          <div className="classmates-body">
            <section className="dsh-ui-stack classmates-list-pane" aria-labelledby="classmates-roles-heading">
              <div className="dsh-ui-row classmates-list-head">
                <h2 id="classmates-roles-heading" className="dsh-ui-heading">
                  {t('role.heading', { count: state.roles.length })}
                </h2>
                <Button variant="outline" size="sm"
                  type="button"
                  onClick={() => void requestNewRole()}
                  disabled={readOnly || busy !== null}
                >
                  {t('role.new')}
                </Button>
              </div>
              <details className="classmates-disclosure">
                <summary className="dsh-ui-heading">{t('role.fromPreset')}</summary>
                <div className="dsh-ui-field">
                  <label className="dsh-ui-label" htmlFor="classmates-preset">{t('role.presetLabel')}</label>
                  <select
                    id="classmates-preset"
                    className="dsh-ui-select"
                    value={selectedPresetId}
                    onChange={event => setSelectedPresetId(event.target.value)}
                    disabled={readOnly || busy !== null}
                  >
                    <option value="">{t('role.presetPlaceholder')}</option>
                    {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                  </select>
                  <div className="dsh-ui-actions">
                    <Button variant="outline"
                      type="button"
                      className="classmates-button"
                      onClick={() => void requestPresetRole()}
                      disabled={readOnly || busy !== null || !selectedPresetId}
                    >
                      {t('role.addPreset')}
                    </Button>
                  </div>
                </div>
              </details>
              {toggleError && (
                <div className="dsh-ui-stack" role="alert">
                  <p className="dsh-ui-error dsh-ui-wrap">{toggleError}</p>
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void refreshRoleList()}>{t('common.refresh')}</Button>
                </div>
              )}
              {state.roles.length === 0 ? (
                <p className="dsh-ui-empty">{t('role.empty')}</p>
              ) : (
                <ul className="dsh-ui-list dsh-ui-list-scroll classmates-list">
                  {state.roles.map(role => {
                    const health = roleHealth(role, state.models, profiles);
                    return (
                      <li key={role.id} className="dsh-ui-list-row" data-selected={selectedId === role.id && !isNew || undefined}>
                        <button
                          type="button"
                          className="dsh-ui-list-item"
                          aria-current={selectedId === role.id && !isNew ? 'true' : undefined}
                          onClick={() => void requestOpenRole(role)}
                          disabled={busy !== null}
                        >
                          <span className="dsh-ui-list-name">{role.name.trim() || t('role.unnamed')}</span>
                          <span className="dsh-ui-list-desc" title={role.description}>
                            {role.description.trim() || t('role.noDescription')}
                          </span>
                          {(health === 'invalid' || health === 'unconfigured') && <StatusBadge health={health} t={t} />}
                        </button>
                        <Switch
                          label={t('role.enable', { name: role.name.trim() || role.id })}
                          checked={role.enabled}
                          onChange={enabled => void toggleRole(role, enabled)}
                          disabled={readOnly || busy !== null}
                          title={t('role.enableTitle')}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="dsh-ui-stack classmates-editor" aria-label={t('role.editor')}>
              {draft ? (
                <>
                  <Button variant="outline" type="button" className="classmates-back" onClick={() => void requestBack()} disabled={busy !== null}>
                    {t('common.back')}
                  </Button>
                  <div className="dsh-ui-row-wrap classmates-editor-head">
                    <h3 className="dsh-ui-title" ref={headingRef} tabIndex={-1}>
                      {isNew ? t('role.newTitle') : (draft.name.trim() || t('role.unnamed'))}
                    </h3>
                    {isNew
                      ? <Tag tone="warning" className="classmates-status">{t('common.unsaved')}</Tag>
                      : <StatusBadge health={roleHealth(draft, state.models, profiles)} t={t} />}
                    {dirty && <span className="dsh-ui-meta dsh-ui-warn">{t('common.dirty')}</span>}
                  </div>

                  <form
                    className="dsh-ui-stack"
                    aria-label={isNew ? t('role.formNew') : t('role.formEdit', { name: draft.name.trim() || draft.id })}
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
                          <label className="dsh-ui-label" htmlFor="classmates-name">{t('common.name')}</label>
                          <CharCount id="classmates-name-count" count={draft.name.length} max={NAME_MAX} />
                        </div>
                        <Input
                          className={`dsh-ui-control classmates-input${fieldErrors.name ? ' classmates-invalid' : ''}`}
                          id="classmates-name"
                          type="text"
                          value={draft.name}
                          onChange={event => patchDraft({ name: event.target.value })}
                          maxLength={NAME_MAX}
                          required
                          aria-invalid={fieldErrors.name ? 'true' : undefined}
                          aria-describedby={fieldErrors.name ? 'classmates-name-error classmates-name-count' : 'classmates-name-count'}
                          autoComplete="off"
                        />
                        {fieldErrors.name && (
                          <p id="classmates-name-error" className="dsh-ui-error">{fieldErrors.name}</p>
                        )}
                      </div>

                      <div className="dsh-ui-field">
                        <div className="dsh-ui-label-row">
                          <label className="dsh-ui-label" htmlFor="classmates-description">{t('role.description')}</label>
                          <CharCount id="classmates-description-count" count={draft.description.length} max={DESCRIPTION_MAX} />
                        </div>
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
                              ? 'classmates-description-error classmates-description-help classmates-description-count'
                              : 'classmates-description-help classmates-description-count'
                          }
                          placeholder={t('role.descriptionPlaceholder')}
                        />
                        <p id="classmates-description-help" className="dsh-ui-help">
                          {t('role.descriptionHelp')}
                        </p>
                        {fieldErrors.description && (
                          <p id="classmates-description-error" className="dsh-ui-error">{fieldErrors.description}</p>
                        )}
                      </div>

                      {migrationNotice && (
                        <div className="dsh-ui-banner" role="group" aria-label={t('roleModel.migratedTitle')}>
                          <p className="dsh-ui-banner-title">{t('roleModel.migratedTitle')}</p>
                          <p className="dsh-ui-wrap">{t('roleModel.migratedBody', { id: migrationNotice })}</p>
                          <div className="dsh-ui-actions">
                            <Button variant="outline"
                              type="button"
                              className="classmates-button"
                              onClick={() => void saveModelSelection({ kind: 'profile', profileId: migrationNotice })}
                            >
                              {t('roleModel.migratedAdopt')}
                            </Button>
                          </div>
                        </div>
                      )}

                      <ModelSourceField
                        role={draft}
                        profiles={profiles}
                        models={state.models}
                        disabled={readOnly || busy !== null}
                        saving={busy === 'model'}
                        error={modelError}
                        t={t}
                        onSave={selection => void saveModelSelection(selection)}
                      />

                      <div className="dsh-ui-field">
                        <div className="dsh-ui-label-row">
                          <label className="dsh-ui-label" htmlFor="classmates-instructions">{t('role.instructions')}</label>
                          <CharCount id="classmates-instructions-count" count={draft.instructions.length} max={INSTRUCTIONS_MAX} />
                        </div>
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
                              ? 'classmates-instructions-error classmates-instructions-count'
                              : 'classmates-instructions-count'
                          }
                        />
                        {fieldErrors.instructions && (
                          <p id="classmates-instructions-error" className="dsh-ui-error">{fieldErrors.instructions}</p>
                        )}
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
                            <dt className="dsh-ui-meta">{t('role.description')}</dt>
                            <dd className="dsh-ui-compact">{remoteVersion.description}</dd>
                          </div>
                          <div>
                            <dt className="dsh-ui-meta">{t('remote.model')}</dt>
                            <dd className="dsh-ui-compact">{modelLabel(remoteVersion, state.models, profiles, t)}</dd>
                          </div>
                          <div>
                            <dt className="dsh-ui-meta">{t('remote.enabled')}</dt>
                            <dd className="dsh-ui-compact">{t(remoteVersion.enabled ? 'health.enabled' : 'health.disabled')}</dd>
                          </div>
                          <div>
                            <dt className="dsh-ui-meta">{t('role.instructions')}</dt>
                            <dd className="dsh-ui-compact dsh-ui-scroll classmates-remote-instructions">{remoteVersion.instructions}</dd>
                          </div>
                        </dl>
                        <div className="dsh-ui-actions">
                          <Button variant="outline"
                            type="button"
                            className="classmates-button"
                            onClick={() => openRole(remoteVersion)}
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
                        {busy === 'remove' ? t('common.deleting') : (isNew ? t('common.discardDraft') : t('role.delete'))}
                      </Button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="dsh-ui-empty">
                  <p>{t('role.emptyEditor')}</p>
                </div>
              )}
            </section>
          </div>

          <details className="classmates-details classmates-disclosure">
            <summary className="dsh-ui-heading">{t('role.toolsTitle')}</summary>
            <p className="dsh-ui-help classmates-prose">{t('role.toolsBody')}</p>
          </details>

          <details className="classmates-details classmates-disclosure">
            <summary className="dsh-ui-heading">{t('role.impactTitle')}</summary>
            <p className="dsh-ui-help classmates-prose">{t('role.impactBody')}</p>
          </details>

          <section className="dsh-ui-section" aria-labelledby="classmates-demo-heading">
            <h2 id="classmates-demo-heading" className="dsh-ui-heading">{t('demo.title')}</h2>
            <p className="dsh-ui-help">{t('demo.help')}</p>
            <p className="dsh-ui-code">{demoText}</p>
            <div className="dsh-ui-row-wrap">
              <Button variant="outline"
                type="button"
                className="classmates-button"
                onClick={() => void copyDemoRequest(demoText)}
              >
                {t('demo.copy')}
              </Button>
              {copyState === 'copied' && <span className="dsh-ui-notice" role="status">{t('demo.copied')}</span>}
              {copyState === 'failed' && (
                <span className="dsh-ui-notice dsh-ui-notice--error" role="alert">{t('demo.copyFailed')}</span>
              )}
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
              t={t}
              confirm={confirm}
            />
          </div>
        </>
      )}
    </div>
  );
}
