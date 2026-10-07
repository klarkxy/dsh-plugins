import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconShieldOutlineRegular, Menu, Modal,
  PermissionIconFullAccessRegular, PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteRegular, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives';
import { modelMenuEffortOptions, parseModelMenuChoices } from '@klarkxy/dsh-model-route';
import { ModelMenu, modelMenuCss } from '@klarkxy/dsh-model-route/ui';
import { officialUiCss } from '@klarkxy/dsh-plugin-kit/official-ui';
import { createPluginReadGate } from '@klarkxy/dsh-plugin-kit/client-utils';

const h = React.createElement;
export const name = 'dsh-safe-auto-client';
/* `remote.session` is a nested service of the injected `remote` face: cordis
 * checks the dotted path against this list, so the parent `remote` entry alone
 * is not enough — omitting it throws "cannot get property without inject". */
export const inject = ['slots', 'connection', 'remote', 'remote.session', 'locale'];
export const CHANNEL = '/dsh-safe-auto';
export const BUNDLE = '@klarkxy/dsh-safe-auto';

/* One language at a time, chosen from the host locale. */
const TEXT = {
  zh: {
    requestFailed: '请求失败',
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
    safetyDetail: '只处理原生 write/edit/bash/pwsh 的单次沙箱提权。审核会保留真人任务授权及后续限制，并按需读取工作区内的包配置和脚本；模型通过时自动放行。其余有效请求请你在 60 秒内确认，超时拒绝。确认只适用于这一次调用。',
    unableLabel: '无法自动判断时',
    unableValue: '请你在 60 秒内确认；超时拒绝',
    approvalTitle: '确认这一次调用',
    approvalPending: count => `${count} 个请求待确认`,
    approvalCountdown: seconds => `剩余 ${seconds} 秒 · 超时拒绝`,
    approvalExpired: '确认已超时，已拒绝。',
    approvalAllow: '仅允许这一次',
    approvalDeny: '拒绝',
    approvalPermission: '请求权限',
    approvalScope: '仅此调用',
    approvalReview: '模型审核意见',
    approvalRefresh: message => `${message}。正在刷新请求；不会自动重试决定。`,
    approvalEffect: '完整调用内容',
    prompt: '额外审核提示词',
    promptHint: count => `${count}/4096 · 只可补充审核约束，不可扩大授权或覆盖安全规则。`,
    limitsLine: l => `单次审查超时 ${l.timeoutMs} ms · 输入上限 ${l.maxInputBytes} bytes · 输出上限 ${l.outputTokens} tokens`,
    limitsFuses: l => `每个任务最多审查 ${l.maxReviewsPerTask} 次 · 连续拒绝 ${l.consecutiveDenials} 次后熔断`,
    limitsHelp: '预算在 profile 中配置，保存设置或重新启用不会补充；动作、真人指令和有界的本地脚本证据会发送给审核模型。',
    save: '保存',
    refreshDiscard: '刷新（丢弃草稿）',
    saveFailed: message => `${message}。草稿已保留，刷新后重新编辑，不会自动重试。`,
    catalogFailed: message => `模型目录读取失败，已保存值保持不变：${message}`,
    saved: '已保存',
    summary: '安全自动：沙箱提权时由独立审核模型把关，通过才自动放行。',
  },
  en: {
    requestFailed: 'Request failed',
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
    safetyDetail: 'Reviews one native write/edit/bash/pwsh sandbox escalation at a time. Earlier human task authorization and later restrictions remain visible; workspace package definitions and scripts may supply evidence. A model pass auto-approves. Other valid requests ask you to confirm within 60 seconds and are denied on timeout. Confirmation grants this call only.',
    unableLabel: 'When it cannot judge automatically',
    unableValue: 'Ask you to confirm within 60 seconds; deny on timeout',
    approvalTitle: 'Confirm this call',
    approvalPending: count => `${count} pending confirmation${count === 1 ? '' : 's'}`,
    approvalCountdown: seconds => `${seconds} seconds left · Deny on timeout`,
    approvalExpired: 'Confirmation expired and was denied.',
    approvalAllow: 'Allow this call only',
    approvalDeny: 'Reject',
    approvalPermission: 'Requested permission',
    approvalScope: 'This call only',
    approvalReview: 'Model review opinion',
    approvalRefresh: message => `${message}. Refreshing requests; your decision will not be retried automatically.`,
    approvalEffect: 'Complete call content',
    prompt: 'Additional reviewer prompt',
    promptHint: count => `${count}/4096 · May add review constraints, never expand authorization or override safety rules.`,
    limitsLine: l => `Review timeout ${l.timeoutMs} ms · Input cap ${l.maxInputBytes} bytes · Output cap ${l.outputTokens} tokens`,
    limitsFuses: l => `At most ${l.maxReviewsPerTask} reviews per task · Breaker opens after ${l.consecutiveDenials} consecutive denials`,
    limitsHelp: 'Budgets live in the profile and are not refilled by saving or re-enabling. Actions, human instructions and bounded local script evidence are sent to the reviewer model.',
    save: 'Save',
    refreshDiscard: 'Refresh (discard draft)',
    saveFailed: message => `${message}. Draft retained; refresh before editing again. No automatic retry.`,
    catalogFailed: message => `Model catalog failed; saved values retained: ${message}`,
    saved: 'Saved',
    summary: 'Safe Auto: an independent reviewer vets each sandbox escalation and only a pass auto-approves.',
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

const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();
export function approvalRemaining(request, now = monotonicNow()) {
  return Math.max(0, request.deadline - now);
}

/** Per-session serial reads and one-shot writes. A response's server remainder
 * is anchored before the round trip so network delay cannot extend the prompt. */
export function createApprovalController({ api, sessionId, onState, now = monotonicNow,
  schedule = setTimeout, cancel = clearTimeout, intervalMs = 1000, readGate = createPluginReadGate() }) {
  let active = true, reading = false, writing = false, generation = 0, readSequence = 0, timer;
  let state = { requests: [], busy: false, error: '' };
  const publish = next => { state = { ...state, ...next }; if (active) onState(state); };
  const arm = () => { if (active) { cancel(timer); timer = schedule(() => { void refresh(); }, intervalMs); } };
  async function refresh(manual = false) {
    if (!active || reading || writing) return false;
    if (manual) { generation++; readGate.reset(); }
    if (!readGate.canRead()) { arm(); return false; }
    cancel(timer); reading = true;
    const ticket = generation, readId = ++readSequence, started = now();
    try {
      const value = await readGate.run(() => api.getApprovals(sessionId));
      if (active && ticket === generation) {
        const previous = new Map(state.requests.map(request => [request.id, request.deadline]));
        const requests = (value?.requests || []).map(request => ({ ...request,
          deadline: Math.min(previous.get(request.id) ?? Infinity,
            started + Math.max(0, Number(request.remainingMs) || 0)),
        })).filter(request => approvalRemaining(request, now()) > 0);
        publish({ requests, error: '' });
      }
    } catch (error) {
      if (active && ticket === generation) publish({ error: error.message });
    } finally { if (readId === readSequence) { reading = false; arm(); } }
    return true;
  }
  return {
    refresh,
    reconnect() { generation++; readSequence++; readGate.reset(); reading = false; if (!writing) void refresh(); },
    dispose() { active = false; generation++; readGate.reset(); cancel(timer); },
    async answer(requestId, outcome) {
      const request = state.requests.find(item => item.id === requestId);
      if (!active || writing || !request || approvalRemaining(request, now()) <= 0) return false;
      writing = true; generation++; cancel(timer); publish({ busy: true, error: '' });
      readGate.reset();
      try {
        const value = await api.answerApproval({ sessionId, requestId, outcome });
        if (value?.accepted !== true) throw new Error('Confirmation is no longer available');
        if (active) publish({ requests: state.requests.filter(item => item.id !== requestId) });
      } catch (error) {
        // A competing tab, timeout or lost response needs a fresh read, never a
        // repeated write. Remove the stale prompt until that read completes.
        if (active) publish({ requests: state.requests.filter(item => item.id !== requestId), error: error.message });
      } finally {
        writing = false;
        if (active) { publish({ busy: false }); if (!reading) void refresh(); else arm(); }
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
// Only this plugin's own geometry, and the platform element the primitives do
// not ship, are styled here.
const css = `${officialUiCss('dsh-safe-auto')}${modelMenuCss}
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
.dsh-safe-auto-approval-dialog {
  display: flex;
  flex-direction: column;
  max-height: 100%;
  max-width: 100%;
}
.dsh-safe-auto-approval-content {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
.dsh-safe-auto-approval-pre {
  max-height: 35vh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  padding: 8px 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
`;
function Style() { return h('style', null, css); }
function ErrorText({ error }) { return error ? h('p', { role: 'alert', className: 'dsh-ui-error dsh-ui-wrap' }, error) : null; }

/** Values are rendered as plain text, with no Markdown or HTML interpretation. */
export function ApprovalDialog({ request, pendingCount = 1, remainingMs, busy = false, error = '', onAnswer, locale }) {
  const t = useText(locale);
  if (!request) return null;
  const expired = remainingMs <= 0;
  const action = request.action || {};
  const fields = Object.entries({ tool: action.tool, cwd: action.cwd, ...action.arguments });
  return h(Modal, { open: true, title: t('approvalTitle'), closeLabel: t('approvalDeny'),
    onClose: () => { if (!busy && !expired) onAnswer(request.id, 'deny'); },
    className: 'dsh-safe-auto dsh-safe-auto-approval-dialog', contentClassName: 'dsh-safe-auto-approval-content',
    footer: h('div', { className: 'dsh-safe-auto dsh-ui-actions' }, h(Style),
      h(Button, { variant: 'ghost', disabled: busy || expired, 'data-modal-autofocus': true,
        onClick: () => onAnswer(request.id, 'deny') }, t('approvalDeny')),
      h(Button, { variant: 'primary', disabled: busy || expired,
        onClick: () => onAnswer(request.id, 'allow') }, t('approvalAllow'))) },
    h('div', { className: 'dsh-safe-auto dsh-ui-stack' }, h(Style),
      h('p', { className: 'dsh-ui-meta', role: 'status' }, t('approvalPending', pendingCount), ' · ',
        expired ? t('approvalExpired') : t('approvalCountdown', Math.ceil(remainingMs / 1000))),
      h('div', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('approvalPermission')),
        h('pre', { className: 'dsh-safe-auto-approval-pre' }, JSON.stringify({ ...action.permission, scope: action.permission?.scope }, null, 2)),
        h('span', { className: 'dsh-ui-help' }, t('approvalScope'))),
      h('div', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('approvalEffect')),
        fields.map(([field, value]) => h('div', { key: field, className: 'dsh-ui-field' },
          h('span', { className: 'dsh-ui-meta' }, field), h('pre', { className: 'dsh-safe-auto-approval-pre' },
            typeof value === 'string' ? value : JSON.stringify(value, null, 2))))),
      h('div', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('approvalReview')),
        h('pre', { className: 'dsh-safe-auto-approval-pre' }, JSON.stringify(request.review || {}, null, 2))),
      h(ErrorText, { error })));
}

/** Composer permission control via the replacement slot: native presets plus Safe Auto. */
export function PermissionMenu({ sessionId, locked, api, locale, initialSnapshot = null }) {
  const t = useText(locale);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scopeRef = useRef(null);
  const refreshRef = useRef(null);
  const approvalsRef = useRef(null);
  const [approvals, setApprovals] = useState({ sessionId, requests: [], busy: false, error: '' });
  const [approvalNow, setApprovalNow] = useState(monotonicNow);
  const refresh = (automatic = false) => scopeRef.current?.run(() => api.getSession(sessionId), {
    value: value => { setSnapshot(value); setError(''); }, error: e => setError(e.message),
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
  const approvalsEnabled = Boolean(snapshot?.safeAuto);
  useEffect(() => {
    setApprovals({ sessionId, requests: [], busy: false, error: '' });
    if (!approvalsEnabled) return undefined;
    const controller = createApprovalController({ api, sessionId, onState: value => {
      setApprovalNow(monotonicNow()); setApprovals({ ...value, sessionId });
    } });
    approvalsRef.current = controller;
    void controller.refresh();
    const stopConnection = api.subscribeGeneration?.(() => controller.reconnect());
    const focus = () => { void controller.refresh(); };
    globalThis.addEventListener?.('focus', focus);
    return () => { controller.dispose(); stopConnection?.(); approvalsRef.current = null; globalThis.removeEventListener?.('focus', focus); };
  }, [api, sessionId, approvalsEnabled]);
  const pending = approvalsEnabled && approvals.sessionId === sessionId
    ? approvals.requests.filter(request => approvalRemaining(request, approvalNow) > 0) : [];
  useEffect(() => {
    if (!pending.length) return undefined;
    const timer = setInterval(() => setApprovalNow(monotonicNow()), 250);
    return () => clearInterval(timer);
  }, [pending.length]);
  const choose = value => {
    const scope = scopeRef.current;
    if (!snapshot || scope?.writing) return;
    if (value === snapshot.current) { setOpen(false); return; }
    if (value === 'safe-auto' && !snapshot.available) return;
    setBusy(true); setError('');
    scope?.run(() => api.selectSession({ sessionId, expectedRevision: snapshot.revision, value }), {
      value: next => { setSnapshot(next); setOpen(false); },
      error: e => { setError(t('refreshRetry', e.message)); refreshRef.current(); },
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
  return h('span', { className: 'dsh-safe-auto dsh-safe-auto-permission', 'aria-busy': busy }, h(Style),
    h(Menu, {
      open, side: 'top', align: 'start', portal: true, listClassName: 'dsh-safe-auto',
      selectedId: snapshot?.current, items, onSelect: choose, onClose: () => setOpen(false),
      anchor: h(Button, { variant: 'ghost', disabled: Boolean(locked), 'aria-haspopup': 'menu', 'aria-expanded': open,
        'aria-label': t('permission'),
        onClick: () => { const next = !open; setOpen(next); if (next) refreshRef.current(); } },
        CurrentIcon && h(CurrentIcon), current ? permissionLabel(current.value, current.name, t) : (snapshot?.current || t('permission')),
        h(IconChevronUpOutlineRegular)),
    }),
    h(ErrorText, { error }),
    h(ErrorText, { error: approvals.error && t('approvalRefresh', approvals.error) }),
    pending.length ? h(ApprovalDialog, { key: pending[0].id, request: pending[0], pendingCount: pending.length,
      remainingMs: approvalRemaining(pending[0], approvalNow), busy: approvals.busy,
      onAnswer: (id, outcome) => { void approvalsRef.current?.answer(id, outcome); }, locale }) : null);
}

export function ReviewerFields({ values, catalog, disabled, onChange, locale }) {
  const t = useText(locale);
  const [open, setOpen] = useState(false);
  const state = reviewerMenuState(values, catalog);
  const effort = values.reasoningEffort || '';
  const currentLabel = state.follow ? t('follow') : state.selected?.label || `${state.provider} / ${state.model}`;
  const effortName = state.efforts.find(item => item.id === effort)?.name;
  const unknownEffort = Boolean(effort && !state.follow && state.selected && !state.selected.efforts.some(item => item.id === effort));
  const retained = effort && h('span', null, ' ', t('savedEffortRetained', effort));
  /* The reviewer route uses the contract's standard editor (dsh-model-route's
   * ModelMenu): follow mode is the leading row, effort lives in its own pane. */
  return h('fieldset', { disabled, className: 'dsh-ui-card' }, h('legend', { className: 'dsh-ui-heading' }, t('reviewer')),
    h('div', { className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('model')),
      h(ModelMenu, {
        open, onOpenChange: setOpen, listClassName: 'dsh-safe-auto',
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

export function SettingsPanel({ view, api, locale, initialSettings = null, initialCatalog = null, initialTab = 'reviewer' }) {
  const t = useText(locale);
  const [settings, setSettings] = useState(initialSettings);
  const [values, setValues] = useState(initialSettings?.values || null);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState(initialTab);
  const tabsId = useId();
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
  }, false, automatic);
  refreshRef.current = refresh;
  useEffect(() => {
    const scope = createRequestScope(); scopeRef.current = scope;
    refreshRef.current(false, true);
    let alive = true;
    Promise.resolve().then(() => api.modelCatalog()).then(value => { if (alive) setCatalog(value); }, e => { if (alive) setCatalogError(e.message); });
    const focus = () => { if (!dirty.current) refreshRef.current(false, true); };
    const stopConnection = api.subscribeGeneration?.(() => {
      scope.invalidate();
      if (!dirty.current) refreshRef.current(false, true);
    });
    globalThis.addEventListener?.('focus', focus);
    return () => { alive = false; scope.dispose(); stopConnection?.(); globalThis.removeEventListener?.('focus', focus); };
  }, [api]);
  const change = next => { dirty.current = true; setSaved(false); setValues(next); };
  const save = () => {
    if (!settings || !values || scopeRef.current?.writing || (values.reviewerPrompt || '').length > 4096) return;
    setBusy(true); setError(''); setSaved(false);
    scopeRef.current?.run(() => api.saveSettings({ expectedRevision: settings.revision, values }), {
      value: next => { setSettings(next); setValues(next.values); dirty.current = false; setSaved(true); },
      error: e => setError(t('saveFailed', e.message)),
      settled: () => setBusy(false),
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
  if (view === 'summary') return h('div', { className: 'dsh-safe-auto' }, h(Style),
    h('p', { className: 'dsh-ui-compact dsh-ui-wrap' }, t('summary')), h(ErrorText, { error }));
  return h('section', { className: 'dsh-safe-auto dsh-ui-stack', 'aria-label': t('panelLabel'), 'aria-busy': busy }, h(Style),
    h('p', { className: 'dsh-ui-compact dsh-ui-wrap' }, t('intro')),
    !values && h('p', { className: 'dsh-ui-loading' }, t('loading')),
    values && h(React.Fragment, null,
      h(SegmentedTabs, { value: activeTab, onChange: setTab, label: t('tabsLabel'), items: [
        tabItem('reviewer', t('tabReviewer')),
        tabItem('details', t('details')),
        ...(settings?.policyLimits ? [tabItem('limits', t('tabLimits'))] : []),
      ] }),
      tabPanel('reviewer', 'dsh-ui-stack', [
        h(ReviewerFields, { key: 'fields', values, catalog, disabled: busy, onChange: change, locale }),
        h('label', { key: 'prompt', className: 'dsh-ui-field' }, h('span', { className: 'dsh-ui-label' }, t('prompt')), h('textarea', { className: 'dsh-safe-auto-input', rows: 6, maxLength: 4096, disabled: busy, 'aria-describedby': 'sa-prompt-hint', value: values.reviewerPrompt || '', onChange: e => change({ ...values, reviewerPrompt: e.target.value }) })),
        h('p', { key: 'hint', id: 'sa-prompt-hint', className: 'dsh-ui-help' }, t('promptHint', (values.reviewerPrompt || '').length))]),
      tabPanel('details', 'dsh-ui-stack',
        h('div', { className: 'dsh-ui-help' },
          h('p', null, t('safetyDetail')),
          h('p', null, h('span', { className: 'dsh-ui-label' }, t('unableLabel'), '：'), t('unableValue')))),
      settings?.policyLimits && tabPanel('limits', 'dsh-ui-stack', [
        h('p', { key: 'line', className: 'dsh-ui-meta dsh-ui-wrap' }, t('limitsLine', settings.policyLimits)),
        h('p', { key: 'fuses', className: 'dsh-ui-meta dsh-ui-wrap' }, t('limitsFuses', settings.policyLimits)),
        h('p', { key: 'help', className: 'dsh-ui-help' }, t('limitsHelp'))]),
      h('div', { className: 'dsh-ui-actions' },
        h(Button, { variant: 'primary', disabled: busy || !dirty.current || (values.reviewerPrompt || '').length > 4096, onClick: save }, t('save')),
        h(Button, { variant: 'ghost', disabled: busy, onClick: () => refresh(true) }, t('refreshDiscard')))),
    h(ErrorText, { error }), h(ErrorText, { error: catalogError && t('catalogFailed', catalogError) }),
    saved && h('p', { role: 'status', className: 'dsh-ui-notice' }, t('saved')));
}

export function apply(ctx) {
  const call = (endpoint, payload) => unwrapRpc((...args) => ctx.connection.rpc.call(...args), endpoint, payload,
    translator(localeLanguage(ctx.locale))('requestFailed'));
  const api = Object.freeze({
    subscribeGeneration: listener => ctx.connection.generation?.subscribe(listener) ?? (() => {}),
    getSettings: () => call('settings.get', {}),
    saveSettings: payload => call('settings.save', payload),
    modelCatalog: () => ctx.remote.session.modelCatalog(),
    getSession: sessionId => call('session.get', { sessionId }),
    selectSession: payload => call('session.select', payload),
    getApprovals: sessionId => call('approval.list', { sessionId }),
    answerApproval: payload => call('approval.answer', payload),
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
