import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, DisclosureRow, IconShieldOutlineRegular, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui';

const h = React.createElement;
export const name = 'dsh-safe-auto-client';
export const inject = ['slots', 'connection', 'remote', 'locale'];
export const CHANNEL = '/dsh-safe-auto';
export const BUNDLE = '@klarkxy/dsh-safe-auto';

/* One language at a time, chosen from the host locale. */
const TEXT = {
  zh: {
    requestFailed: '请求失败',
    follow: '跟随当前对话',
    chooseModel: '选择模型',
    savedUnavailable: value => `已保存，目录中不可用：${value}`,
    fast: '快速审核',
    deep: '深度审核',
    deepSwitch: '启用深度审核',
    deepOff: '深度审核已关闭。',
    deepNoModel: '选择模型后才会启用深度审核。',
    model: '模型',
    effort: '思考强度',
    effortDefault: '默认',
    followHelp: '跟随对话：使用默认思考强度。',
    savedEffortRetained: effort => `已保存的强度「${effort}」保留，需在 profile 中检查。`,
    modelAbsent: '当前模型不在目录中，保留已保存配置。',
    effortAbsent: '已保存的思考强度不在目录中，不会自动替换。',
    effortClears: '更换模型会清空该阶段的思考强度。',
    approveForMe: '替我审批',
    sessionHelp: '为指定的活跃会话启用。保留 Workspace Write + ask，不授予 Full Access；重启、切换权限或卸载后需重新启用。',
    targetSession: '目标会话',
    chooseSession: '选择活跃会话',
    enabledMark: '已启用',
    sessionEnabled: '本会话已启用',
    sessionDisabled: current => `未启用 · 当前权限：${current}`,
    unsaved: '有未保存修改，启用前先保存。',
    enable: '启用',
    disable: '停用（不改权限）',
    refreshSessions: '刷新会话',
    noSessions: '没有可操作的活跃主会话，请打开一个。',
    refreshRetry: message => `${message}。刷新后重试。`,
    panelLabel: '安全自动设置',
    intro: '保存设置不调用模型；只有显式启用的会话自动审批。',
    httpBanner: 'HTTP 审核模式：面板只读，请在 profile 中编辑，不会覆盖已保存值。',
    loading: '正在读取配置…',
    reviewMode: '审核模式',
    modeRules: '精确规则候选（POSIX）',
    modeApproval: '独立模型替我审批（含 Windows 原生提权）',
    modeSummary: '仅放行低/中风险、用户直接授权、范围有界的单次提权，其余拒绝。',
    details: '安全与预算说明',
    safetyDetail: '仅处理真实原生 write/edit/bash/pwsh 的单次沙箱提权；高风险、不确定、证据不足、未知或未绑定请求、错误、超时、预算不足及授权失效均拒绝，明确拒绝不回退。不执行取证命令，也不放开整个会话。',
    outputBudget: '思考模型可能需要更高输出预算（默认快审 64 / 深审 256 tokens）。在 profile 检查 fastOutputTokens / deepOutputTokens；本面板不改预算。',
    unableLabel: '无法自动判断时',
    unableValue: '直接拒绝',
    unableHelp: '未核验 DSH 的仅人工审批通道，此策略固定且不保存；交给下游审批链可能被其他自动插件放行，不算人工回退。',
    windows: 'Windows：精确规则模式不支持文件/PowerShell 自动提权，请选独立审批模式。',
    prompt: '额外审核提示词',
    promptHint: count => `${count}/4096 · 只可补充审核约束，不可扩大授权或覆盖安全规则。`,
    limits: '预算与安全边界（只读）',
    limitsTimes: l => `每阶段超时 ${l.timeoutMs} ms · 输入 ${l.maxInputBytes} bytes · 快审 ${l.fastCallsPerTask} 次 · 深审 ${l.deepCallsPerTask} 次`,
    limitsFuses: l => `会话预算 ${l.sessionBudgetUnits} · 连续拒绝熔断 ${l.consecutiveDenials} · 累计拒绝熔断 ${l.totalDenials}`,
    limitsHelp: '预算在 profile 中配置，保存设置或重新启用不会补充；完整动作可能发送给所选审核模型。',
    save: '保存',
    refreshDiscard: '刷新（丢弃草稿）',
    saveFailed: message => `${message}。草稿已保留，刷新后重新编辑，不会自动重试。`,
    catalogFailed: message => `模型目录读取失败，已保存值保持不变：${message}`,
    saved: '已保存',
    summary: '安全自动：审核模型、思考强度与额外审核提示词。',
    httpSummary: 'HTTP 审核模式，保留 profile 配置。',
  },
  en: {
    requestFailed: 'Request failed',
    follow: 'Follow conversation',
    chooseModel: 'Choose a model',
    savedUnavailable: value => `Saved, unavailable: ${value}`,
    fast: 'Fast review',
    deep: 'Deep review',
    deepSwitch: 'Enable deep review',
    deepOff: 'Deep review is off.',
    deepNoModel: 'Deep review stays off until you choose a model.',
    model: 'Model',
    effort: 'Reasoning effort',
    effortDefault: 'Default',
    followHelp: 'Follows the conversation with the default reasoning effort.',
    savedEffortRetained: effort => `Saved effort "${effort}" retained; check the profile.`,
    modelAbsent: 'This model is not in the catalog; the saved configuration is kept.',
    effortAbsent: 'The saved effort is not advertised; it will not be replaced automatically.',
    effortClears: 'Changing the model clears this stage’s reasoning effort.',
    approveForMe: 'Approve for me',
    sessionHelp: 'Enable for one live session. Keeps Workspace Write + ask; no standing permission grant. Re-enable after restart, a permission change or uninstall.',
    targetSession: 'Target session',
    chooseSession: 'Choose a live session',
    enabledMark: 'enabled',
    sessionEnabled: 'Enabled for this session',
    sessionDisabled: current => `Disabled · Permissions: ${current}`,
    unsaved: 'You have unsaved changes. Save before enabling.',
    enable: 'Enable',
    disable: 'Disable (keeps permissions)',
    refreshSessions: 'Refresh sessions',
    noSessions: 'No live root conversation. Open a conversation first.',
    refreshRetry: message => `${message}. Refresh before retrying.`,
    panelLabel: 'Safe Auto settings',
    intro: 'Saving does not call a model; only explicitly enabled sessions use automatic review.',
    httpBanner: 'HTTP mode: read-only. Edit the profile; saved values will not be overwritten.',
    loading: 'Loading settings…',
    reviewMode: 'Review mode',
    modeRules: 'Exact rule candidates (POSIX)',
    modeApproval: 'Independent approval reviewer (includes native Windows escalation)',
    modeSummary: 'Approves only a single low- or medium-risk, user-authorized, bounded escalation; everything else is rejected.',
    details: 'Safety and budget details',
    safetyDetail: 'Only single sandbox escalations of real native write/edit/bash/pwsh calls. Rejected: high risk, uncertainty, missing evidence, unknown or unbound requests, errors, timeouts, exhausted budgets and invalidated grants. Explicit denials never fall back. No probing commands; the whole session is never opened.',
    outputBudget: 'Reasoning models may need more output budget (default 64 fast / 256 deep tokens). Check fastOutputTokens / deepOutputTokens in the profile; this panel does not change budgets.',
    unableLabel: 'When it cannot judge automatically',
    unableValue: 'Reject',
    unableHelp: 'No verified human-only DSH channel, so this policy is fixed and not saved. Another automatic answerer is not human fallback.',
    windows: 'Windows: exact rule mode cannot auto-approve file or PowerShell escalation; choose independent approval.',
    prompt: 'Additional reviewer prompt',
    promptHint: count => `${count}/4096 · May add review constraints, never expand authorization or override safety rules.`,
    limits: 'Budget and safety limits (read-only)',
    limitsTimes: l => `Timeout ${l.timeoutMs} ms per stage · Input ${l.maxInputBytes} bytes · Fast calls ${l.fastCallsPerTask} · Deep calls ${l.deepCallsPerTask}`,
    limitsFuses: l => `Session units ${l.sessionBudgetUnits} · Consecutive denial fuse ${l.consecutiveDenials} · Total denial fuse ${l.totalDenials}`,
    limitsHelp: 'Budgets live in the profile and are not refilled by saving or re-enabling. Complete actions may be sent to the selected reviewer model.',
    save: 'Save',
    refreshDiscard: 'Refresh (discard draft)',
    saveFailed: message => `${message}. Draft retained; refresh before editing again. No automatic retry.`,
    catalogFailed: message => `Model catalog failed; saved values retained: ${message}`,
    saved: 'Saved',
    summary: 'Safe Auto: reviewer models, reasoning effort and additional review prompt.',
    httpSummary: 'HTTP reviewer; profile settings retained.',
  },
};

/** The host locale may arrive as the injected service or as a plain tag. */
export function localeLanguage(locale) {
  const active = typeof locale === 'string' ? locale : locale?.getSnapshot?.()?.active;
  return String(active || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export function translator(language) {
  const table = TEXT[language] || TEXT.en;
  return (key, ...args) => { const value = table[key]; return typeof value === 'function' ? value(...args) : value; };
}
function useText(locale) {
  const [language, setLanguage] = useState(() => localeLanguage(locale));
  useEffect(() => {
    setLanguage(localeLanguage(locale));
    if (typeof locale?.subscribe !== 'function') return undefined;
    return locale.subscribe(() => setLanguage(localeLanguage(locale)));
  }, [locale]);
  return useMemo(() => translator(language), [language]);
}

export async function unwrapRpc(call, endpoint, payload, fallback = TEXT.en.requestFailed) {
  const result = await call(CHANNEL, endpoint, payload);
  if (!result?.ok) throw new Error(result?.error?.message || fallback);
  return result.value;
}

// Responses belong to a view lifetime and generation; writes are never retried.
export function createRequestScope() {
  let generation = 0, active = true, writing = false;
  return {
    invalidate() { generation++; },
    dispose() { active = false; generation++; },
    get writing() { return writing; },
    async run(operation, handlers = {}, write = false) {
      if (!active || writing) return false;
      if (write) writing = true;
      const ticket = ++generation;
      try {
        const value = await operation();
        if (active && generation === ticket) handlers.value?.(value);
      } catch (error) {
        if (active && generation === ticket) handlers.error?.(error);
      } finally {
        if (write) writing = false;
        if (active) handlers.settled?.();
      }
      return true;
    },
  };
}

export function modelKey(provider, model) { return JSON.stringify([provider || '', model || '']); }
export function modelChoices(catalog, provider = '', model = '', t = translator('en')) {
  const choices = [{ value: modelKey('', ''), name: t('follow'), provider: '', model: '', efforts: [] }];
  for (const group of catalog?.groups || []) for (const entry of group.models || []) {
    choices.push({ value: modelKey(group.id, entry.id), name: `${group.name || group.id} / ${entry.name || entry.id}`, provider: group.id, model: entry.id, efforts: entry.reasoning?.efforts || [] });
  }
  const current = modelKey(provider, model);
  if (!choices.some(choice => choice.value === current)) choices.push({ value: current, name: t('savedUnavailable', `${provider || '—'} / ${model || '—'}`), provider, model, efforts: [], unknown: true });
  return choices;
}
export function selectModel(values, stage, choice) {
  return { ...values, [`${stage}Provider`]: choice.provider, [`${stage}Model`]: choice.model, [`${stage}ReasoningEffort`]: '' };
}
/** A short, recognizable session name: its title or folder, plus the id head. */
export function sessionLabel(item, t = translator('en')) {
  const cwd = item.header?.cwd || '';
  const base = item.header?.title || cwd.split(/[\\/]/).filter(Boolean).pop() || '—';
  const id = String(item.sessionId).slice(0, 8);
  return `${base} · ${id}${item.safeAuto ? ` · ${t('enabledMark')}` : ''}`;
}
// The shared contract is scoped under the plugin root, so its rules only match
// descendants: every `dsh-ui-*` class below sits inside `.dsh-safe-auto`.
// Only this plugin's own geometry, and the two platform elements the
// primitives do not ship, are styled here.
const css = `${officialUiCss('dsh-safe-auto')}
/* A fieldset is the settings group and takes the contract's card surface; its
 * legend keeps the UA inline padding from indenting the group title. */
.dsh-safe-auto legend { padding: 0; }
/* The primitives ship no textarea, so it keeps the platform element at the
 * official field geometry, exactly as dsh-ui-select does for a native select. */
.dsh-safe-auto-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  resize: vertical;
}
.dsh-safe-auto-input:disabled { opacity: 0.4; cursor: not-allowed; }
`;
function Style() { return h('style', null, css); }
function ErrorText({ error }) { return error ? h('p', { role: 'alert', className: 'dsh-ui-error dsh-ui-wrap' }, error) : null; }

export function ModelFields({ stage, values, catalog, disabled, onChange, locale }) {
  const t = useText(locale);
  const deep = stage === 'deep';
  const provider = values[`${stage}Provider`] || '', model = values[`${stage}Model`] || '';
  const effort = values[`${stage}ReasoningEffort`] || '';
  const follow = !provider && !model;
  /* Deep review is off exactly when no deep model is saved; the switch only
   * reveals the model picker, so the saved config keeps its shape. */
  const [wantDeep, setWantDeep] = useState(false);
  const on = !deep || !follow || wantDeep;
  const choices = modelChoices(catalog, provider, model, t);
  if (deep) choices[0] = { ...choices[0], name: t('chooseModel'), placeholder: true };
  const selected = choices.find(choice => choice.value === modelKey(provider, model));
  const unknownEffort = effort && !selected.efforts.some(item => item.id === effort);
  const retained = effort && h('span', null, ' ', t('savedEffortRetained', effort));
  return h('fieldset', { disabled, className: 'dsh-ui-card' }, h('legend', { className: 'dsh-ui-heading' }, t(deep ? 'deep' : 'fast')),
    deep && h('div', { className: 'dsh-ui-row' },
      h(Switch, { checked: on, label: t('deepSwitch'), disabled, onChange: next => {
        setWantDeep(next);
        if (!next && !follow) onChange(selectModel(values, stage, choices[0]));
      } }),
      h('span', { className: 'dsh-ui-label', 'aria-hidden': 'true' }, t('deepSwitch'))),
    !on && h('p', { className: 'dsh-ui-help' }, t('deepOff'), retained),
    on && h('label', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('model')), h('select', { className: 'dsh-ui-select', value: selected.value, onChange: e => {
      const choice = choices.find(item => item.value === e.target.value);
      if (choice && !choice.placeholder) onChange(selectModel(values, stage, choice));
    } }, choices.map(choice => h('option', { key: choice.value, value: choice.value, disabled: choice.placeholder }, choice.name)))),
    on && follow && h('p', { className: 'dsh-ui-help' }, deep ? t('deepNoModel') : t('followHelp'), retained),
    on && !follow && h('label', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('effort')), h('select', { className: 'dsh-ui-select', value: effort, onChange: e => onChange({ ...values, [`${stage}ReasoningEffort`]: e.target.value }) },
      h('option', { value: '' }, t('effortDefault')), selected.efforts.map(item => h('option', { key: item.id, value: item.id }, item.name || item.id)),
      unknownEffort && h('option', { value: effort }, t('savedUnavailable', effort)))),
    on && selected.unknown && h('p', { className: 'dsh-ui-help' }, t('modelAbsent')),
    on && !follow && unknownEffort && h('p', { className: 'dsh-ui-help' }, t('effortAbsent')),
    on && !follow && h('p', { className: 'dsh-ui-help' }, t('effortClears')));
}

export function SessionControls({ api, initialSessions = [], dirty = false, locale }) {
  const t = useText(locale);
  const [rows, setRows] = useState(initialSessions);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = useRef(null);
  const load = () => scope.current?.run(() => api.listSessions(), {
    value: value => { setRows(value.sessions); setError(''); }, error: e => setError(e.message),
  });
  useEffect(() => {
    const current = createRequestScope(); scope.current = current; load();
    return () => current.dispose();
  }, [api]);
  const row = rows.find(item => item.sessionId === selected);
  const change = enabled => {
    if (!row || scope.current?.writing || (enabled && dirty)) return;
    setBusy(true); setError('');
    const payload = { sessionId: row.sessionId, expectedRevision: row.revision };
    scope.current?.run(() => enabled ? api.enableSession({ ...payload, value: 'safe-auto' }) : api.disableSession(payload), {
      value: next => setRows(old => old.map(item => item.sessionId === row.sessionId ? { ...item, ...next } : item)),
      error: e => setError(t('refreshRetry', e.message)), settled: () => setBusy(false),
    }, true);
  };
  return h('fieldset', { disabled: busy, className: 'dsh-ui-card' }, h('legend', { className: 'dsh-ui-heading' }, t('approveForMe')),
    h('p', { className: 'dsh-ui-help' }, t('sessionHelp')),
    h('label', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('targetSession')), h('select', { className: 'dsh-ui-select', value: selected, onChange: e => setSelected(e.target.value) },
      h('option', { value: '' }, t('chooseSession')),
      rows.map(item => h('option', { key: item.sessionId, value: item.sessionId, title: [item.header?.cwd, item.sessionId].filter(Boolean).join(' · ') }, sessionLabel(item, t))))),
    row && h('p', { role: 'status', className: 'dsh-ui-compact dsh-ui-wrap' }, row.safeAuto ? t('sessionEnabled') : t('sessionDisabled', row.current)),
    dirty && h('p', { role: 'status', className: 'dsh-ui-help' }, t('unsaved')),
    h('div', { className: 'dsh-ui-actions' },
      h(Button, { variant: 'primary', disabled: !row || !row.available || row.safeAuto || dirty, onClick: () => change(true) }, t('enable')),
      h(Button, { variant: 'outline', disabled: !row?.safeAuto, onClick: () => change(false) }, t('disable')),
      h(Button, { variant: 'ghost', onClick: load }, t('refreshSessions'))),
    !rows.length && h('p', { className: 'dsh-ui-empty' }, t('noSessions')),
    h(ErrorText, { error }));
}

export function SettingsPanel({ view, api, locale, initialSettings = null, initialCatalog = null }) {
  const t = useText(locale);
  const [settings, setSettings] = useState(initialSettings);
  const [values, setValues] = useState(initialSettings?.values || null);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const dirty = useRef(false);
  const scopeRef = useRef(null);
  const refreshRef = useRef(null);
  /* An automatic refresh (mount, window focus) keeps the "saved" notice;
   * only an explicit refresh clears it. */
  const refresh = (discardDraft = false, automatic = false) => scopeRef.current?.run(() => api.getSettings(), {
    value: next => {
      if (dirty.current && !discardDraft) return;
      setSettings(next); setValues(next.values); dirty.current = false; setError('');
      if (!automatic) setSaved(false);
    },
    error: e => setError(e.message),
  });
  refreshRef.current = refresh;
  useEffect(() => {
    const scope = createRequestScope(); scopeRef.current = scope;
    refreshRef.current(false, true);
    let alive = true;
    Promise.resolve().then(() => api.modelCatalog()).then(value => { if (alive) setCatalog(value); }, e => { if (alive) setCatalogError(e.message); });
    const focus = () => { if (!dirty.current) refreshRef.current(false, true); };
    globalThis.addEventListener?.('focus', focus);
    return () => { alive = false; scope.dispose(); globalThis.removeEventListener?.('focus', focus); };
  }, [api]);
  const change = next => { dirty.current = true; setSaved(false); setValues(next); };
  const save = () => {
    if (!settings || !values || settings.http || scopeRef.current?.writing || (values.reviewerPrompt || '').length > 4096) return;
    setBusy(true); setError(''); setSaved(false);
    scopeRef.current?.run(() => api.saveSettings({ expectedRevision: settings.revision, values }), {
      value: next => { setSettings(next); setValues(next.values); dirty.current = false; setSaved(true); },
      error: e => setError(t('saveFailed', e.message)),
      settled: () => setBusy(false),
    }, true);
  };
  if (view === 'summary') return h('div', { className: 'dsh-safe-auto' }, h(Style),
    h('p', { className: 'dsh-ui-compact dsh-ui-wrap' }, t('summary')),
    settings?.http && h('p', { className: 'dsh-ui-help' }, t('httpSummary')), h(ErrorText, { error }));
  const readOnly = busy || settings?.http;
  return h('section', { className: 'dsh-safe-auto dsh-ui-stack', 'aria-label': t('panelLabel'), 'aria-busy': busy }, h(Style),
    h('p', { className: 'dsh-ui-compact dsh-ui-wrap' }, t('intro')),
    settings?.http && h('p', { role: 'status', className: 'dsh-ui-banner' }, t('httpBanner')),
    !values && h('p', { className: 'dsh-ui-loading' }, t('loading')),
    values && h(React.Fragment, null,
      h('label', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('reviewMode')), h('select', { className: 'dsh-ui-select', disabled: readOnly, value: values.approvalReview ? 'approval' : 'rules', onChange: e => change({ ...values, approvalReview: e.target.value === 'approval' }) },
        h('option', { value: 'rules' }, t('modeRules')),
        h('option', { value: 'approval' }, t('modeApproval')))),
      h('p', { className: 'dsh-ui-help' }, t('modeSummary')),
      values.approvalReview && h('div', { className: 'dsh-ui-field' },
        h('span', { className: 'dsh-ui-label' }, t('unableLabel')),
        h('p', { className: 'dsh-ui-compact' }, t('unableValue')),
        h('p', { id: 'sa-human-unavailable', className: 'dsh-ui-help' }, t('unableHelp'))),
      settings.platform === 'win32' && h('p', { role: 'status', className: 'dsh-ui-compact dsh-ui-wrap' }, t('windows')),
      h(DisclosureRow, { icon: h(IconShieldOutlineRegular), title: t('details'), open: detailsOpen, expandable: true, expandOnRowClick: true,
        onToggle: () => setDetailsOpen(value => !value) }, h('div', { className: 'dsh-ui-help' },
        h('p', null, t('safetyDetail')),
        h('p', null, t('outputBudget')))),
      h(ModelFields, { stage: 'fast', values, catalog, disabled: readOnly, onChange: change, locale }),
      h(ModelFields, { stage: 'deep', values, catalog, disabled: readOnly, onChange: change, locale }),
      h('label', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('prompt')), h('textarea', { className: 'dsh-safe-auto-input', rows: 6, maxLength: 4096, disabled: readOnly, 'aria-describedby': 'sa-prompt-hint', value: values.reviewerPrompt || '', onChange: e => change({ ...values, reviewerPrompt: e.target.value }) })),
      h('p', { id: 'sa-prompt-hint', className: 'dsh-ui-help' }, t('promptHint', (values.reviewerPrompt || '').length)),
      settings.policyLimits && h(DisclosureRow, { icon: h(IconShieldOutlineRegular),
        title: t('limits'), open: limitsOpen, expandable: true, expandOnRowClick: true,
        onToggle: () => setLimitsOpen(value => !value) }, h('div', { className: 'dsh-ui-stack' },
        h('p', { className: 'dsh-ui-meta dsh-ui-wrap' }, t('limitsTimes', settings.policyLimits)),
        h('p', { className: 'dsh-ui-meta dsh-ui-wrap' }, t('limitsFuses', settings.policyLimits)),
        h('p', { className: 'dsh-ui-help' }, t('limitsHelp')))),
      h('div', { className: 'dsh-ui-actions' },
        h(Button, { variant: 'primary', disabled: readOnly || !dirty.current || (values.reviewerPrompt || '').length > 4096, onClick: save }, t('save')),
        h(Button, { variant: 'ghost', disabled: busy, onClick: () => refresh(true) }, t('refreshDiscard')))),
    h(ErrorText, { error }), h(ErrorText, { error: catalogError && t('catalogFailed', catalogError) }),
    saved && h('p', { role: 'status', className: 'dsh-ui-notice' }, t('saved')),
    /* Enabling uses the saved settings, so it comes after the save action. */
    h(SessionControls, { api, dirty: dirty.current, locale }));
}

export function apply(ctx) {
  const call = (endpoint, payload) => unwrapRpc((...args) => ctx.connection.rpc.call(...args), endpoint, payload,
    translator(localeLanguage(ctx.locale))('requestFailed'));
  const api = Object.freeze({
    getSettings: () => call('settings.get', {}),
    saveSettings: payload => call('settings.save', payload),
    modelCatalog: () => ctx.remote.session.modelCatalog(),
    listSessions: () => call('session.list', {}),
    enableSession: payload => call('session.select', payload),
    disableSession: payload => call('session.disable', payload),
  });
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: BUNDLE, inject: () => ({ api, locale: ctx.locale }),
  }, SettingsPanel));
}
