import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Input, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconShieldOutlineRegular, Menu,
  PermissionIconFullAccessRegular, PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteRegular, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives';
import { MODEL_CATALOG_INJECT, readModelCatalog, modelMenuEffortLabel, modelMenuEffortOptions, parseModelMenuChoices } from '@klarkxy/dsh-model-route';
import { ModelCatalogStatus, ModelMenu, modelMenuCss, useModelCatalog } from '@klarkxy/dsh-model-route/ui';
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui';
import { createPluginReadGate } from '@klarkxy/dsh-plugin-kit/client-utils';
import { createModelSettingsSubscriber, mountModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-client';

const h = React.createElement;
export const name = 'dsh-safe-auto-client';
export const inject = ['slots', 'connection', ...MODEL_CATALOG_INJECT, 'locale'];
export const CHANNEL = '/dsh-safe-auto';
export const BUNDLE = '@klarkxy/dsh-safe-auto';

/* One language at a time, chosen from the host locale. */
const TEXT = {
  zh: {
    requestFailed: '请求失败',
    invalidSession: '会话无效',
    childSession: '子会话不能启用安全自动',
    invalidRequest: '请求无效',
    settingsChanged: '配置已更新，请刷新后重试',
    reviewerOnly: '这里只能修改审核配置',
    sessionChanged: '会话已更新，请刷新后重试',
    profileDisabled: '配置文件中已停用安全自动',
    workspaceUnavailable: '当前无法使用需原生审批的工作区写入权限',
    unknownPreset: '权限预设无效',
    controlUnloaded: '安全自动已停用',
    unknownSetting: '审核模型设置无效',
    invalidModel: '审核模型或提供方标识无效',
    modelPair: '提供方和模型必须一起配置',
    effortRequiresModel: '选择思考强度前需先指定审核模型',
    invalidConfig: '配置无效',
    invalidConfigField: field => `配置项无效：${field}`,
    unknownConfigField: field => `未知配置项：${field}`,
    externalChange: '配置已在别处修改。草稿已保留，请刷新并丢弃草稿后重新确认。',
    syncUnavailable: '自动刷新不可用，请手动刷新配置。',
    follow: '跟随当前对话',
    searchModels: '搜索模型…',
    noModels: '没有匹配的模型',
    clearSearch: '清除搜索',
    reviewer: '审核模型',
    model: '模型',
    effort: '思考强度',
    effortDefault: '默认',
    followHelp: '跟随对话：使用当前会话的模型与默认思考强度。',
    savedEffortRetained: effort => `已保存的强度「${effort}」保留，需在 profile 中检查。`,
    modelAbsent: '当前模型不在目录中，保留已保存配置。',
    effortAbsent: '已保存的思考强度不在目录中，不会自动替换。',
    effortClears: '更换模型会清空思考强度。',
    permission: '权限',
    readOnly: '仅可查看',
    workspaceWrite: '工作区内修改',
    fullAccess: '完全权限',
    safeAuto: '安全自动',
    unavailableShort: '当前不可用',
    refreshRetry: message => `${message}。重新打开菜单后重试。`,
    panelLabel: '安全自动设置',
    intro: '在输入框的权限菜单里为本会话启用「安全自动」；这里只保存审核配置，不调用模型。',
    loading: '正在读取配置…',
    tabsLabel: '设置分区',
    tabReviewer: '审核配置',
    details: '安全说明',
    tabLimits: '预算边界',
    safetyDetail: '普通调用照常在工作区沙箱内运行，插件不拦截。需要审批的请求（沙箱提权、少量危险命令，以及其他工具的审批）交给审核模型：通过就只放行这一次，拒绝或审核失败就把原因告诉智能体。',
    reviewInput: '发给审核模型的内容：对话记录（你的消息标为可信，其余只作参考，超长时截断）、工作目录和这次操作的完整参数。',
    breakerDetail: '同一轮对话里连续拒绝 3 次，或最近 50 次审核拒绝 10 次，本轮暂停自动审批，等你发新消息。',
    prompt: '额外审核提示词',
    promptHint: count => `${count}/4096 · 只可补充审核约束，不可扩大授权或覆盖安全规则。`,
    limitsLine: l => `单次审核超时 ${Math.round(l.timeoutMs / 1000)} 秒 · 输出上限 ${l.outputTokens} tokens · 对话记录上限 ${l.maxTranscriptBytes} bytes`,
    limitsHelp: '这些上限在 profile 中配置。',
    save: '保存',
    refreshDiscard: '刷新（丢弃草稿）',
    saveFailed: message => `${message}。草稿已保留，刷新后重新编辑，不会自动重试。`,
    saved: '已保存',
    summary: '安全自动：需要审批的请求交给审核模型判断，通过才放行这一次。',
  },
  en: {
    requestFailed: 'Request failed',
    invalidSession: 'Invalid session',
    childSession: 'Child sessions cannot select Safe Auto',
    invalidRequest: 'Invalid request',
    settingsChanged: 'Settings changed; reload and retry',
    reviewerOnly: 'Only reviewer settings may be edited here',
    sessionChanged: 'Session changed; refresh and retry',
    profileDisabled: 'Safe Auto is disabled in the profile',
    workspaceUnavailable: 'Workspace Write with native approval is unavailable',
    unknownPreset: 'Unknown permission preset',
    controlUnloaded: 'Safe Auto control unloaded',
    unknownSetting: 'Invalid reviewer model setting',
    invalidModel: 'Invalid reviewer provider/model identifier',
    modelPair: 'Provider and model must be configured together',
    effortRequiresModel: 'Reasoning effort requires a reviewer model',
    invalidConfig: 'Invalid configuration',
    invalidConfigField: field => `Invalid configuration field: ${field}`,
    unknownConfigField: field => `Unknown configuration field: ${field}`,
    externalChange: 'Settings changed elsewhere. Draft preserved; refresh and discard it before reviewing changes.',
    syncUnavailable: 'Automatic refresh unavailable; refresh settings manually.',
    follow: 'Follow conversation',
    searchModels: 'Search models…',
    noModels: 'No matching models',
    clearSearch: 'Clear search',
    reviewer: 'Reviewer model',
    model: 'Model',
    effort: 'Reasoning effort',
    effortDefault: 'Default',
    followHelp: 'Follows the conversation model with the default reasoning effort.',
    savedEffortRetained: effort => `Saved effort "${effort}" retained; check the profile.`,
    modelAbsent: 'This model is not in the catalog; the saved configuration is kept.',
    effortAbsent: 'The saved effort is not advertised; it will not be replaced automatically.',
    effortClears: 'Changing the model clears the reasoning effort.',
    permission: 'Permissions',
    readOnly: 'Read Only',
    workspaceWrite: 'Workspace Write',
    fullAccess: 'Full Access',
    safeAuto: 'Safe Auto',
    unavailableShort: 'unavailable',
    refreshRetry: message => `${message}. Reopen the menu and retry.`,
    panelLabel: 'Safe Auto settings',
    intro: 'Enable Safe Auto per session from the permission menu in the composer; this page only saves reviewer configuration and never calls a model.',
    loading: 'Loading settings…',
    tabsLabel: 'Settings sections',
    tabReviewer: 'Reviewer',
    details: 'Safety notes',
    tabLimits: 'Limits',
    safetyDetail: 'Ordinary calls run inside the workspace sandbox as usual; the plugin does not intercept them. Requests that need approval (sandbox escalations, a short list of dangerous commands, and approval prompts from other tools) go to the reviewer model: a pass approves that one call; a denial or review failure is explained to the agent.',
    reviewInput: 'Sent to the reviewer: the conversation (your messages marked trusted, everything else as evidence, truncated when long), the working directory, and the complete arguments of the action.',
    breakerDetail: 'After 3 consecutive denials, or 10 denials among the last 50 reviews in one turn, automatic approval pauses until your next message.',
    prompt: 'Additional reviewer prompt',
    promptHint: count => `${count}/4096 · May add review constraints, never expand authorization or override safety rules.`,
    limitsLine: l => `Review timeout ${Math.round(l.timeoutMs / 1000)} s · Output cap ${l.outputTokens} tokens · Transcript cap ${l.maxTranscriptBytes} bytes`,
    limitsHelp: 'These limits are configured in the profile.',
    save: 'Save',
    refreshDiscard: 'Refresh (discard draft)',
    saveFailed: message => `${message}. Draft retained; refresh before editing again. No automatic retry.`,
    saved: 'Saved',
    summary: 'Safe Auto: a reviewer model answers approval requests and approves only the calls that pass.',
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
  const language = useSyncExternalStore(
    listener => locale?.subscribe?.(listener) ?? (() => {}),
    () => localeLanguage(locale),
    () => localeLanguage(locale),
  );
  return useMemo(() => translator(language), [language]);
}

// Translate only failures emitted by this plugin; provider/storage diagnostics remain data.
const LOCAL_ERRORS = {
  'Request failed': 'requestFailed', 'Request rejected': 'requestFailed',
  'Invalid session': 'invalidSession',
  'Child sessions cannot select Safe Auto': 'childSession', 'Invalid request': 'invalidRequest',
  'Settings changed; reload and retry': 'settingsChanged', 'Only reviewer settings may be edited here': 'reviewerOnly',
  'Session changed; refresh the list and retry': 'sessionChanged', 'Unknown endpoint': 'invalidRequest',
  'Safe Auto is disabled in the profile': 'profileDisabled', 'Workspace Write with native approval is unavailable': 'workspaceUnavailable',
  'Unknown permission preset': 'unknownPreset', 'Safe Auto control unloaded': 'controlUnloaded',
  'Unknown Safe Auto model setting': 'unknownSetting',
  'invalid reviewer provider/model identifier': 'invalidModel', 'provider and model must be configured together': 'modelPair',
  'reasoningEffort requires a reviewer model': 'effortRequiresModel',
};
function errorMessage(error) {
  return (typeof error === 'string' ? error : error?.message) || TEXT.en.requestFailed;
}
/* The composer mounts before the host publishes a live session. That miss is not
 * something the user can fix, so the permission control stays quiet and retries. */
const INACTIVE_SESSION = 'Session is not active; open it and retry';
function shownPermissionError(error) {
  const message = errorMessage(error);
  return message === INACTIVE_SESSION ? '' : message;
}
export function errorText(t, error) {
  const message = typeof error === 'string' ? error : error?.message;
  const key = Object.hasOwn(LOCAL_ERRORS, message) ? LOCAL_ERRORS[message] : undefined;
  const unknownField = /^unknown config field: (.+)$/.exec(message || '');
  const invalidField = /^(?:(enabled) must be a boolean|(provider|model|reasoningEffort|reviewerPrompt) must be a string|invalid (timeoutMs|outputTokens|maxTranscriptBytes))$/.exec(message || '');
  const text = key ? t(key)
    : unknownField ? t('unknownConfigField', unknownField[1])
    : invalidField ? t('invalidConfigField', invalidField[1] || invalidField[2] || invalidField[3])
    : ['config must be an object', 'invalid configuration'].includes(message) ? t('invalidConfig')
    : message || t('requestFailed');
  return error?.context ? t(error.context, text) : text;
}

export async function unwrapRpc(call, endpoint, payload, fallback = TEXT.en.requestFailed) {
  const result = await call(CHANNEL, endpoint, payload);
  if (!result?.ok) throw new Error(result?.error?.message || fallback);
  return result.value;
}

// Responses belong to a view lifetime and generation; writes are never retried.
export function createRequestScope() {
  let generation = 0, active = true, writing = false;
  const readGate = createPluginReadGate();
  return {
    invalidate() { generation++; readGate.reset(); },
    dispose() { active = false; generation++; readGate.reset(); },
    get writing() { return writing; },
    async run(operation, handlers = {}, write = false, automatic = false) {
      if (!active || writing) return false;
      if (!write && automatic && !readGate.canRead()) return false;
      readGate.reset();
      if (write) writing = true;
      const ticket = ++generation;
      try {
        const value = write ? await operation() : await readGate.run(operation);
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

/* The standard editor's state for the reviewer route: catalog choices with a
 * saved-but-unlisted route retained, the follow-mode flag and the effort rows.
 * Catalog parsing — remote envelope included — lives in dsh-model-route. */
export function reviewerMenuState(values, catalog) {
  const provider = values.provider || '', model = values.model || '';
  const follow = !provider && !model;
  const listed = parseModelMenuChoices(catalog);
  const known = follow || listed.some(choice => choice.provider === provider && choice.model === model);
  const choices = follow || known ? listed : parseModelMenuChoices(catalog, { provider, model });
  const selected = choices.find(choice => choice.provider === provider && choice.model === model);
  const efforts = follow ? [] : modelMenuEffortOptions(selected, values.reasoningEffort || '');
  return { provider, model, follow, known, choices, selected, efforts };
}

/** Picking a model clears the effort; picking "follow" clears the whole route. */
export function pickReviewerModel(values, route) {
  return { ...values, provider: route.provider, model: route.model, reasoningEffort: '' };
}

const PERMISSION_ICONS = {
  'read-only': PermissionIconReadOnlyRegular,
  'workspace-write': PermissionIconWorkspaceWriteRegular,
  'danger-full-access': PermissionIconFullAccessRegular,
  'safe-auto': IconShieldOutlineRegular,
};
/** Known preset values get localized names matching the host menu; anything else keeps its catalog name. */
export function permissionLabel(value, name, t = translator('en')) {
  const known = { 'read-only': t('readOnly'), 'workspace-write': t('workspaceWrite'), 'danger-full-access': t('fullAccess'), 'safe-auto': t('safeAuto') };
  return known[value] || name || value;
}

// The shared contract is scoped under the plugin root, so its rules only match
// descendants: every `dsh-ui-*` class below sits inside `.dsh-safe-auto`.
// Only this plugin's own geometry is styled here. The prompt textarea uses the
// shared dsh-ui-textarea shell.
//
// `modelMenuCss` is the deliberate exception to that baseline: it is the
// companion stylesheet of the shared library @klarkxy/dsh-model-route's
// ModelMenu component — bundled into this client through the library's
// alwaysBundle entry, scoped under the library's own `.dsh-model-menu-*`
// namespace, and restricted to the same official token whitelist. It belongs
// to the library, not to this plugin's own rules, so it is concatenated here
// verbatim rather than rewritten under the plugin root.
const css = `${officialUiCss('dsh-safe-auto')}${modelMenuCss}
/* A fieldset is the settings group and takes the contract's card surface; its
 * legend keeps the UA inline padding from indenting the group title. */
.dsh-safe-auto legend { padding: 0; }
`;
function ErrorText({ error, t }) { return error ? h('p', { role: 'alert', className: 'dsh-ui-error dsh-ui-wrap' }, errorText(t, error)) : null; }

/** Composer permission control via the replacement slot: native presets plus Safe Auto. */
export function PermissionMenu({ sessionId, locked, api, locale, initialSnapshot = null }) {
  const t = useText(locale);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scopeRef = useRef(null);
  const refreshRef = useRef(null);
  const refresh = (automatic = false) => scopeRef.current?.run(() => api.getSession(sessionId), {
    value: value => { setSnapshot(value); setError(''); },
    error: e => { const message = shownPermissionError(e); if (message) setError(message); },
  }, false, automatic);
  refreshRef.current = refresh;
  useEffect(() => {
    const scope = createRequestScope(); scopeRef.current = scope;
    setSnapshot(null); setError('');
    refreshRef.current(true);
    const focus = () => refreshRef.current(true);
    const stopConnection = api.subscribeGeneration?.(() => { scope.invalidate(); refreshRef.current(true); });
    globalThis.addEventListener?.('focus', focus);
    return () => { scope.dispose(); stopConnection?.(); globalThis.removeEventListener?.('focus', focus); };
  }, [api, sessionId]);
  const choose = value => {
    const scope = scopeRef.current;
    if (!snapshot || scope?.writing) return;
    if (value === snapshot.current) { setOpen(false); return; }
    if (value === 'safe-auto' && !snapshot.available) return;
    setBusy(true); setError('');
    scope?.run(() => api.selectSession({ sessionId, expectedRevision: snapshot.revision, value }), {
      value: next => { setSnapshot(next); setOpen(false); },
      error: e => {
        const message = shownPermissionError(e);
        if (message) setError({ message, context: 'refreshRetry' });
        refreshRef.current();
      },
      settled: () => setBusy(false),
    }, true);
  };
  const options = snapshot?.options || [];
  const items = options.map(option => ({
    id: option.value,
    label: permissionLabel(option.value, option.name, t),
    icon: h(PERMISSION_ICONS[option.value] || PermissionIconWorkspaceWriteRegular),
    disabled: Boolean(locked || (option.value === 'safe-auto' && !snapshot.available)),
  }));
  // An unavailable Safe Auto stays visible but disabled, so the menu never silently differs.
  if (snapshot && !snapshot.available && !options.some(o => o.value === 'safe-auto')) {
    items.push({ id: 'safe-auto', label: `${t('safeAuto')} · ${t('unavailableShort')}`, icon: h(IconShieldOutlineRegular), disabled: true });
  }
  const current = options.find(option => option.value === snapshot?.current);
  const CurrentIcon = current && PERMISSION_ICONS[current.value];
  return h('span', { className: 'dsh-safe-auto dsh-safe-auto-permission', 'aria-busy': busy },
    h(Menu, {
      open, side: 'top', align: 'start', portal: true, listClassName: 'dsh-safe-auto',
      selectedId: snapshot?.current, items, onSelect: choose, onClose: () => setOpen(false),
      anchor: h(Button, { variant: 'ghost', disabled: Boolean(locked), 'aria-haspopup': 'menu', 'aria-expanded': open,
        'aria-label': t('permission'),
        onClick: () => { const next = !open; setOpen(next); if (next) refreshRef.current(); } },
        CurrentIcon && h(CurrentIcon), current ? permissionLabel(current.value, current.name, t) : (snapshot?.current || t('permission')),
        h(IconChevronUpOutlineRegular)),
    }),
    h(ErrorText, { error, t }));
}

export function ReviewerFields({ values, catalog, disabled, onChange, locale }) {
  const t = useText(locale);
  const [open, setOpen] = useState(false);
  const state = reviewerMenuState(values, catalog);
  const effort = values.reasoningEffort || '';
  const currentLabel = state.follow ? t('follow') : state.selected?.label || `${state.provider} / ${state.model}`;
  const effortOption = state.efforts.find(item => item.id === effort);
  const effortName = effortOption && modelMenuEffortLabel(effortOption, localeLanguage(locale));
  const unknownEffort = Boolean(effort && !state.follow && state.selected && !state.selected.efforts.some(item => item.id === effort));
  const retained = effort && h('span', null, ' ', t('savedEffortRetained', effort));
  /* The reviewer route uses the contract's standard editor (dsh-model-route's
   * ModelMenu): follow mode is the leading row, effort lives in its own pane. */
  // The card carries the plugin root class itself: scoped contract rules
  // resolve without depending on which ancestor mounted this fieldset.
  return h('fieldset', { disabled, className: 'dsh-safe-auto dsh-ui-card' }, h('legend', { className: 'dsh-ui-heading' }, t('reviewer')),
    h('div', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('model')),
      h(ModelMenu, {
        open, onOpenChange: setOpen, listClassName: 'dsh-safe-auto', locale: localeLanguage(locale),
        anchor: h('button', { type: 'button', className: 'dsh-model-menu-trigger', disabled: Boolean(disabled),
          'aria-haspopup': 'menu', 'aria-expanded': open },
          h('span', { className: 'dsh-model-menu-triggerLabel' }, currentLabel),
          !state.follow && state.efforts.length ? h('span', { className: 'dsh-model-menu-triggerEffort' }, effortName || t('effortDefault')) : null,
          h(IconChevronDownOutlineRegular, { className: `dsh-model-menu-chevron${open ? ' dsh-model-menu-chevronOpen' : ''}` })),
        choices: state.choices,
        selected: state.follow ? undefined : { provider: state.provider, model: state.model },
        onPick: route => onChange(pickReviewerModel(values, route)),
        leading: [{ id: 'follow', label: t('follow'), selected: state.follow }],
        onPickLeading: () => onChange(pickReviewerModel(values, { provider: '', model: '' })),
        efforts: state.efforts,
        selectedEffort: effort,
        onPickEffort: next => onChange({ ...values, reasoningEffort: next || '' }),
        modelLabel: t('model'), modelValue: currentLabel,
        effortLabel: t('effort'), defaultEffortLabel: t('effortDefault'),
        searchPlaceholder: t('searchModels'), emptyLabel: t('noModels'), clearSearchLabel: t('clearSearch'),
      })),
    state.follow && h('p', { className: 'dsh-ui-help' }, t('followHelp'), retained),
    !state.follow && !state.known && h('p', { className: 'dsh-ui-help' }, t('modelAbsent')),
    !state.follow && unknownEffort && h('p', { className: 'dsh-ui-help' }, t('effortAbsent')),
    !state.follow && h('p', { className: 'dsh-ui-help' }, t('effortClears')));
}

const HISTORY_TEXT = {
  zh: { title: '审核历史', help: '保存启用此功能后的审核。内容已尽力脱敏；记录持续保留，可导出供审计。', search: '搜索内容', session: '会话 ID', tool: '工具', outcome: '审核结果', risk: '风险', from: '开始时间', to: '结束时间', all: '全部', apply: '查询', refresh: '刷新', next: '下一页', back: '上一页', detail: '查看详情', empty: '没有匹配的审核记录', loading: '正在查询…', exportOne: '导出此记录', exportAll: '导出筛选结果', cancel: '取消导出', exporting: count => `正在导出 ${count} 条…`, count: count => `共 ${count} 条`, missing: '审核记录不存在', execution: '工具结果', approval: '实际审批', approvalUnknown: '未观察到审批结果', unavailable: '未记录', outcomes: { pending: '审核中', interrupted: '审核中断', 'allowed-once': '审核通过', rejected: '拒绝', cancelled: '取消', unavailable: '审批不可用' }, risks: { low: '低', medium: '中', high: '高', critical: '严重' }, states: { 'not-observed': '未观察到执行结果', succeeded: '工具返回成功', failed: '工具返回错误' } },
  en: { title: 'Review history', help: 'Reviews are retained from the time this feature is enabled. Content is redacted on a best-effort basis and can be exported for audit.', search: 'Search contents', session: 'Session ID', tool: 'Tool', outcome: 'Outcome', risk: 'Risk', from: 'From', to: 'To', all: 'All', apply: 'Search', refresh: 'Refresh', next: 'Next', back: 'Previous', detail: 'View details', empty: 'No matching reviews', loading: 'Loading reviews…', exportOne: 'Export this record', exportAll: 'Export filtered results', cancel: 'Cancel export', exporting: count => `Exporting ${count} records…`, count: count => `${count} records`, missing: 'Review record not found', execution: 'Tool result', approval: 'Actual approval', approvalUnknown: 'No approval result observed', unavailable: 'Not recorded', outcomes: { pending: 'Pending', interrupted: 'Interrupted', 'allowed-once': 'Review passed', rejected: 'Rejected', cancelled: 'Cancelled', unavailable: 'Approval unavailable' }, risks: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }, states: { 'not-observed': 'No execution result observed', succeeded: 'Tool returned success', failed: 'Tool returned an error' } },
};

export function historyFilters(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '').map(([key, value]) =>
    [key, key === 'from' || key === 'to' ? new Date(value).toISOString() : value]));
}
export function downloadHistory(records, filename = 'safe-auto-history.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'safe-auto-audit-v1', exportedAt: new Date().toISOString(), count: records.length, records }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function HistoryPanel({ api, locale, initialPage = null, download = downloadHistory }) {
  const language = useSyncExternalStore(listener => locale?.subscribe?.(listener) ?? (() => {}), () => localeLanguage(locale), () => localeLanguage(locale));
  const t = HISTORY_TEXT[language];
  const [draft, setDraft] = useState({ query: '', sessionId: '', tool: '', outcome: '', risk: '', from: '', to: '' });
  const [filter, setFilter] = useState({});
  const [page, setPage] = useState(initialPage);
  const [cursors, setCursors] = useState([undefined]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [exporting, setExporting] = useState(null);
  const generation = useRef(0), detailsGeneration = useRef(0), exportGeneration = useRef(0);
  const alive = useRef(true), filterRef = useRef(filter);
  filterRef.current = filter;
  const load = useCallback(async (filters, cursor) => {
    const ticket = ++generation.current; ++detailsGeneration.current; ++exportGeneration.current;
    setBusy(true); setError(''); setDetail(null); setExporting(null);
    try {
      const result = await api.historyList({ ...filters, limit: 25, ...(cursor ? { cursor } : {}) });
      if (alive.current && ticket === generation.current) setPage(result);
    } catch (e) { if (alive.current && ticket === generation.current) { setError(errorMessage(e)); setPage(null); } }
    finally { if (alive.current && ticket === generation.current) setBusy(false); }
  }, [api]);
  useEffect(() => {
    alive.current = true; void load({}, undefined);
    const stop = api.subscribeGeneration?.(() => { setCursors([undefined]); setIndex(0); void load(filterRef.current, undefined); });
    return () => { alive.current = false; generation.current++; detailsGeneration.current++; exportGeneration.current++; stop?.(); };
  }, [load, api]);
  const search = e => {
    e?.preventDefault();
    try { const next = historyFilters(draft); setFilter(next); setCursors([undefined]); setIndex(0); void load(next); }
    catch (e) { setError(errorMessage(e)); }
  };
  const showDetail = async id => {
    const ticket = ++detailsGeneration.current; setError(''); setDetail(null);
    try {
      const row = await api.historyGet(id);
      if (!row) throw new Error(t.missing);
      if (alive.current && ticket === detailsGeneration.current) setDetail(row);
    } catch (e) { if (alive.current && ticket === detailsGeneration.current) setError(errorMessage(e)); }
  };
  const exportAll = async () => {
    const ticket = ++exportGeneration.current; const records = []; let cursor;
    setExporting(0); setError('');
    try {
      // Freeze the time boundary: later reviews must not enter an ongoing export.
      const now = new Date().toISOString();
      const filters = { ...filter, to: filter.to && Date.parse(filter.to) < Date.parse(now) ? filter.to : now };
      do {
        const batch = await api.historyList({ ...filters, limit: 100, ...(cursor ? { cursor } : {}) });
        if (!alive.current || ticket !== exportGeneration.current) return;
        for (const item of batch.items) {
          const row = await api.historyGet(item.id);
          if (!alive.current || ticket !== exportGeneration.current) return;
          if (!row) throw new Error(t.missing);
          records.push(row); setExporting(records.length);
        }
        if (batch.nextCursor && batch.nextCursor === cursor) throw new Error('Invalid history cursor');
        cursor = batch.nextCursor;
      } while (cursor);
      download(records);
    } catch (e) { if (alive.current && ticket === exportGeneration.current) setError(errorMessage(e)); }
    finally { if (alive.current && ticket === exportGeneration.current) setExporting(null); }
  };
  const field = (key, label, options) => h('label', { key, className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, label),
    options ? h('select', { className: 'dsh-ui-select', value: draft[key], onChange: e => setDraft({ ...draft, [key]: e.target.value }) }, h('option', { value: '' }, t.all), ...Object.entries(options).map(([value, label]) => h('option', { key: value, value }, label)))
      : h(Input, { type: key === 'from' || key === 'to' ? 'datetime-local' : 'text', maxLength: 256, value: draft[key], onChange: e => setDraft({ ...draft, [key]: e.target.value }) }));
  return h('section', { className: 'dsh-ui-stack', 'aria-label': t.title, 'aria-busy': busy },
    h('p', { className: 'dsh-ui-help' }, t.help),
    h('form', { className: 'dsh-ui-stack', onSubmit: search },
      h('div', { className: 'dsh-ui-fields-grid' }, field('query', t.search), field('sessionId', t.session), field('tool', t.tool), field('outcome', t.outcome, t.outcomes), field('risk', t.risk, t.risks), field('from', t.from), field('to', t.to)),
      h('div', { className: 'dsh-ui-actions' }, h(Button, { type: 'submit', variant: 'primary' }, t.apply),
        h(Button, { type: 'button', variant: 'ghost', onClick: () => { setCursors([undefined]); setIndex(0); void load(filter); } }, t.refresh),
        h(Button, { type: 'button', variant: 'ghost', disabled: busy || exporting !== null || !page?.total, onClick: exportAll }, t.exportAll))),
    error && h('p', { role: 'alert', className: 'dsh-ui-error' }, error),
    exporting !== null && h('div', { className: 'dsh-ui-actions', role: 'status' }, t.exporting(exporting), h(Button, { variant: 'ghost', onClick: () => { exportGeneration.current++; setExporting(null); } }, t.cancel)),
    busy ? h('p', { role: 'status' }, t.loading) : page && h(React.Fragment, null,
      h('p', { className: 'dsh-ui-meta' }, t.count(page.total)),
      !page.items.length && h('p', { className: 'dsh-ui-empty' }, t.empty),
      ...page.items.map(row => h('article', { key: row.id, className: 'dsh-ui-card dsh-ui-stack' },
        h('div', { className: 'dsh-ui-row-wrap' }, h('strong', null, row.tool), h('span', null, t.outcomes[row.reviewOutcome || row.outcome] || row.reviewOutcome || row.outcome), h('span', null, t.risks[row.risk] || row.risk || '')),
        h('p', { className: 'dsh-ui-meta dsh-ui-wrap' }, new Date(row.startedAt).toLocaleString(language), ' · ', row.sessionId, ' · ', row.reviewer ? `${row.reviewer.provider}/${row.reviewer.model}` : t.unavailable),
        row.rationale && h('p', { className: 'dsh-ui-wrap' }, row.rationale),
        h('p', { className: 'dsh-ui-help' }, t.approval, ': ', !row.approvalState || row.approvalState === 'not-observed' ? t.approvalUnknown : row.approvalState === 'allowed-once' ? language === 'zh' ? '单次放行' : 'Allowed once' : t.outcomes[row.approvalState]),
        h('p', { className: 'dsh-ui-help' }, t.execution, ': ', t.states[row.executionState || 'not-observed']),
        h(Button, { variant: 'ghost', onClick: () => showDetail(row.id) }, t.detail))),
      h('div', { className: 'dsh-ui-actions' },
        h(Button, { variant: 'ghost', disabled: index === 0, onClick: () => { const next = index - 1; setIndex(next); void load(filter, cursors[next]); } }, t.back),
        h(Button, { variant: 'ghost', disabled: !page.nextCursor, onClick: () => { const next = index + 1; setCursors([...cursors.slice(0, next), page.nextCursor]); setIndex(next); void load(filter, page.nextCursor); } }, t.next))),
    detail && h('section', { className: 'dsh-ui-stack', 'aria-label': t.detail },
      h('h3', null, detail.id), h(Button, { variant: 'ghost', onClick: () => download([detail], `safe-auto-${detail.id}.json`) }, t.exportOne),
      h('pre', { className: 'dsh-ui-wrap', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '60vh', overflow: 'auto' } }, JSON.stringify(detail, null, 2))));
}

export function SettingsPanel({ view, api, locale, initialSettings = null, initialCatalog = null, initialTab = 'reviewer' }) {
  const t = useText(locale);
  const [settings, setSettings] = useState(initialSettings);
  const [values, setValues] = useState(initialSettings?.values || null);
  const loadCatalog = useCallback(() => api.modelCatalog(), [api]);
  const catalogState = useModelCatalog(loadCatalog, { initialCatalog: initialCatalog ?? undefined, subscribe: api.subscribeGeneration });
  const { catalog, refresh: refreshCatalog } = catalogState;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState(initialTab);
  const tabsId = useId();
  const dirty = useRef(false);
  const reading = useRef(false);
  const pending = useRef(false);
  const external = useRef(false);
  const [externalChange, setExternalChange] = useState(false);
  const [syncError, setSyncError] = useState('');
  const scopeRef = useRef(null);
  const refreshRef = useRef(null);
  /* An automatic refresh (mount, window focus) keeps the "saved" notice;
   * only an explicit refresh clears it. */
  const refresh = (discardDraft = false, automatic = false) => {
    const scope = scopeRef.current;
    if (!scope) return;
    if (reading.current || scope.writing) { pending.current = true; return; }
    pending.current = false;
    if (dirty.current && !discardDraft) {
      if (external.current) setExternalChange(true);
      return;
    }
    reading.current = true;
    setBusy(true);
    const request = scope.run(() => api.getSettings(), {
      value: next => {
        if (pending.current || (dirty.current && !discardDraft)) return;
        setSettings(next); setValues(next.values); dirty.current = false; setError('');
        external.current = false; setExternalChange(false);
        if (!automatic) setSaved(false);
      },
      error: e => { if (!pending.current) setError(errorMessage(e)); },
      settled: () => {
        if (scopeRef.current !== scope) return;
        reading.current = false;
        setBusy(false);
        if (pending.current) refreshRef.current(false, true);
      },
    }, false, automatic && !external.current);
    void request.then(ran => { if (!ran && scopeRef.current === scope) { reading.current = false; setBusy(false); } });
    return request;
  };
  refreshRef.current = refresh;
  useEffect(() => {
    const scope = createRequestScope(); scopeRef.current = scope;
    reading.current = false; pending.current = false; dirty.current = false; external.current = false;
    setBusy(false); setExternalChange(false); setSyncError('');
    refreshRef.current(false, true);
    let alive = true;
    const focus = () => { if (!dirty.current) refreshRef.current(false, true); };
    const stopConnection = api.subscribeGeneration?.(() => {
      scope.invalidate();
      external.current = true;
      refreshRef.current(false, true);
    });
    const stopSettings = api.subscribeSettings?.(() => {
      if (!alive) return;
      setSyncError(''); external.current = true;
      refreshCatalog();
      if (dirty.current && !scope.writing) setExternalChange(true);
      refreshRef.current(false, true);
    }, message => { if (alive) setSyncError(message); });
    globalThis.addEventListener?.('focus', focus);
    return () => { alive = false; scope.dispose(); stopConnection?.(); stopSettings?.(); globalThis.removeEventListener?.('focus', focus); };
  }, [api, refreshCatalog]);
  const change = next => { dirty.current = true; setSaved(false); setValues(next); };
  const save = () => {
    if (!settings || !values || reading.current || external.current || scopeRef.current?.writing || (values.reviewerPrompt || '').length > 4096) return;
    setBusy(true); setError(''); setSaved(false);
    scopeRef.current?.run(() => api.saveSettings({ expectedRevision: settings.revision, values }), {
      value: next => { setSettings(next); setValues(next.values); dirty.current = false; setSaved(true); },
      error: e => setError({ message: errorMessage(e), context: 'saveFailed' }),
      settled: () => { setBusy(false); if (pending.current) refreshRef.current(false, true); },
    }, true);
  };
  /* The limits tab exists only while the host reports policy limits; a stale
   * selection falls back to the reviewer tab rather than showing nothing. */
  const activeTab = tab === 'limits' && !settings?.policyLimits ? 'reviewer' : tab;
  const tabItem = (value, label) => ({ value, label, id: `${tabsId}-${value}-tab`, panelId: `${tabsId}-${value}-panel` });
  const tabPanel = (value, className, children) => h('div', {
    role: 'tabpanel', id: `${tabsId}-${value}-panel`, 'aria-labelledby': `${tabsId}-${value}-tab`,
    hidden: activeTab !== value, tabIndex: 0, className,
  }, children);
  if (view === 'summary') return h('div', { className: 'dsh-safe-auto' },
    h('p', { className: 'dsh-ui-compact dsh-ui-wrap' }, t('summary')), h(ErrorText, { error, t }));
  return h('section', { className: 'dsh-safe-auto dsh-ui-page', 'aria-label': t('panelLabel'), 'aria-busy': busy },
    h('p', { className: 'dsh-ui-compact dsh-ui-wrap' }, t('intro')),
    !values && h('p', { className: 'dsh-ui-loading' }, t('loading')),
    values && h(React.Fragment, null,
      h(SegmentedTabs, { value: activeTab, onChange: setTab, label: t('tabsLabel'), items: [
        tabItem('reviewer', t('tabReviewer')),
        tabItem('details', t('details')),
        tabItem('history', HISTORY_TEXT[localeLanguage(locale)].title),
        ...(settings?.policyLimits ? [tabItem('limits', t('tabLimits'))] : []),
      ] }),
      tabPanel('reviewer', 'dsh-ui-stack', [
        h(ReviewerFields, { key: 'fields', values, catalog, disabled: busy, onChange: change, locale }),
        h('label', { key: 'prompt', className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('prompt')), h('textarea', { className: 'dsh-ui-textarea', rows: 6, maxLength: 4096, disabled: busy, 'aria-describedby': 'sa-prompt-hint', value: values.reviewerPrompt || '', onChange: e => change({ ...values, reviewerPrompt: e.target.value }) })),
        h('p', { key: 'hint', id: 'sa-prompt-hint', className: 'dsh-ui-help' }, t('promptHint', (values.reviewerPrompt || '').length))]),
      tabPanel('details', 'dsh-ui-stack',
        h('div', { className: 'dsh-ui-help' },
          h('p', null, t('safetyDetail')),
          h('p', null, t('reviewInput')),
          h('p', null, t('breakerDetail')))),
      tabPanel('history', 'dsh-ui-stack', activeTab === 'history' ? h(HistoryPanel, { api, locale }) : null),
      settings?.policyLimits && tabPanel('limits', 'dsh-ui-stack', [
        h('p', { key: 'line', className: 'dsh-ui-meta dsh-ui-wrap' }, t('limitsLine', settings.policyLimits)),
        h('p', { key: 'help', className: 'dsh-ui-help' }, t('limitsHelp'))]),
      activeTab === 'reviewer' && h('div', { className: 'dsh-ui-form-footer' },
        h(Button, { variant: 'primary', disabled: busy || externalChange || !dirty.current || (values.reviewerPrompt || '').length > 4096, onClick: save }, t('save')),
        h(Button, { variant: 'ghost', disabled: busy, onClick: () => refresh(true) }, t('refreshDiscard')))),
    h(ErrorText, { error, t }), h(ModelCatalogStatus, { state: catalogState, locale: localeLanguage(locale) }),
    externalChange && h('p', { role: 'alert', className: 'dsh-ui-error' }, t('externalChange')),
    syncError && h('p', { role: 'status', className: 'dsh-ui-hint' }, t('syncUnavailable')),
    saved && h('p', { role: 'status', className: 'dsh-ui-notice' }, t('saved')));
}

export function apply(ctx) {
  // Each plugin lifetime owns its stylesheet; individual seats do not inject
  // copies. A second lifetime must survive disposal of the first one.
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined;
    const style = document.createElement('style');
    style.setAttribute('data-plugin', BUNDLE);
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  });
  mountModelSettingsChanges(ctx, BUNDLE);
  const settingsSubscriber = createModelSettingsSubscriber(ctx, BUNDLE);
  const call = (endpoint, payload) => unwrapRpc((...args) => ctx.connection.rpc.call(...args), endpoint, payload);
  const api = Object.freeze({
    subscribeSettings: (change, error) => settingsSubscriber.subscribe(change, error),
    subscribeGeneration: listener => ctx.connection.generation?.subscribe(listener) ?? (() => {}),
    getSettings: () => call('settings.get', {}),
    saveSettings: payload => call('settings.save', payload),
    modelCatalog: () => readModelCatalog(ctx),
    historyList: payload => call('history.list', payload),
    historyGet: id => call('history.get', { id }),
    getSession: sessionId => call('session.get', { sessionId }),
    selectSession: payload => call('session.select', payload),
  });
  // Replacement slot: this renders the whole composer permission control,
  // native presets included, so Safe Auto appears next to them.
  ctx.slots.inject('conversation.input.permission', () => ctx.slots.register({
    name: 'conversation.input.permission', priority: -10, inject: () => ({ api, locale: ctx.locale }),
  }, PermissionMenu));
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: BUNDLE, inject: () => ({ api, locale: ctx.locale }),
  }, SettingsPanel));
}
