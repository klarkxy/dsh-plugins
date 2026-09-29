import React, { useEffect, useRef, useState } from 'react';

const h = React.createElement;
export const name = 'dsh-safe-auto-client';
export const inject = ['slots', 'connection', 'remote', 'locale'];
export const CHANNEL = '/dsh-safe-auto';
export const BUNDLE = '@klarkxy/dsh-safe-auto';

export async function unwrapRpc(call, endpoint, payload) {
  const result = await call(CHANNEL, endpoint, payload);
  if (!result?.ok) throw new Error(result?.error?.message || '请求失败 / Request failed');
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
export function modelChoices(catalog, provider = '', model = '') {
  const choices = [{ value: modelKey('', ''), name: '跟随当前对话 / Follow conversation', provider: '', model: '', efforts: [] }];
  for (const group of catalog?.groups || []) for (const entry of group.models || []) {
    choices.push({ value: modelKey(group.id, entry.id), name: `${group.name || group.id} / ${entry.name || entry.id}`, provider: group.id, model: entry.id, efforts: entry.reasoning?.efforts || [] });
  }
  const current = modelKey(provider, model);
  if (!choices.some(choice => choice.value === current)) choices.push({ value: current, name: `已保存，目录中不可用 / Saved, unavailable: ${provider || '—'} / ${model || '—'}`, provider, model, efforts: [], unknown: true });
  return choices;
}
export function selectModel(values, stage, choice) {
  return { ...values, [`${stage}Provider`]: choice.provider, [`${stage}Model`]: choice.model, [`${stage}ReasoningEffort`]: '' };
}
export function permissionLabel(option) {
  return option.value === 'safe-auto' ? '安全自动 / Safe Auto' : option.name;
}

// Only component-local CSS; theme variables are supplied by the host.
const css = `.dsh-safe-auto{color:var(--dsw-alias-label-primary);font:inherit;max-width:100%;box-sizing:border-box}.dsh-safe-auto *{box-sizing:border-box}.dsh-safe-auto summary{cursor:pointer}.dsh-safe-auto button,.dsh-safe-auto select,.dsh-safe-auto textarea{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 9px}.dsh-safe-auto button:disabled,.dsh-safe-auto select:disabled,.dsh-safe-auto textarea:disabled{opacity:.55;cursor:not-allowed}.dsh-safe-auto button:focus-visible,.dsh-safe-auto select:focus-visible,.dsh-safe-auto textarea:focus-visible,.dsh-safe-auto summary:focus-visible{outline:2px solid currentColor;outline-offset:3px}.dsh-safe-auto fieldset{border:1px solid currentColor;border-radius:8px;margin:12px 0;padding:12px;min-width:0}.dsh-safe-auto label{display:grid;gap:6px;margin:10px 0}.dsh-safe-auto select,.dsh-safe-auto textarea{width:100%;max-width:100%}.dsh-safe-auto small{display:block;line-height:1.5}details.dsh-safe-auto{position:relative}details.dsh-safe-auto>summary{list-style:none;border-radius:6px;padding:4px 8px;white-space:nowrap}.dsh-safe-auto .sa-options{position:absolute;bottom:calc(100% + 8px);left:0;z-index:100;display:grid;gap:6px;width:min(360px,85vw);max-height:65vh;overflow:auto;padding:10px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:0 8px 24px #0003}.dsh-safe-auto .sa-options button{text-align:left;white-space:normal}.dsh-safe-auto .sa-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.dsh-safe-auto [role=alert]{overflow-wrap:anywhere}`;
function Style() { return h('style', null, css); }
function ErrorText({ error }) { return error ? h('p', { role: 'alert' }, error) : null; }

export function PermissionMenu({ sessionId, locked, api, initialSnapshot = null }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scopeRef = useRef(null);
  const openRef = useRef(false);
  const detailsRef = useRef(null);
  const refreshRef = useRef(null);
  const refresh = () => scopeRef.current?.run(() => api.getSession(sessionId), {
    value: setSnapshot, error: e => setError(e.message),
  });
  refreshRef.current = refresh;
  useEffect(() => {
    const scope = createRequestScope();
    scopeRef.current = scope;
    setSnapshot(null); setError('');
    refreshRef.current();
    const focus = () => refreshRef.current();
    globalThis.addEventListener?.('focus', focus);
    return () => { scope.dispose(); globalThis.removeEventListener?.('focus', focus); };
  }, [api, sessionId]);
  const choose = value => {
    const scope = scopeRef.current;
    if (locked || !snapshot || (!snapshot.available && value === 'safe-auto') || scope?.writing || !scope || value === snapshot.current) return;
    setBusy(true); setError('');
    let failed = false;
    scope.run(() => api.selectSession({ sessionId, expectedRevision: snapshot.revision, value }), {
      value: next => { setSnapshot(next); if (detailsRef.current) detailsRef.current.open = false; },
      error: e => { failed = true; setError(e.message); },
      settled: () => { setBusy(false); if (failed && openRef.current) refreshRef.current(); },
    }, true);
  };
  const selected = snapshot?.options?.find(option => option.value === snapshot.current);
  return h('details', { className: 'dsh-safe-auto', ref: detailsRef, onToggle: event => {
    openRef.current = event.currentTarget.open;
    if (openRef.current) refreshRef.current(); else scopeRef.current?.invalidate();
  } }, h(Style), h('summary', null, selected ? permissionLabel(selected) : (snapshot?.current || '权限 / Permissions')),
  h('div', { className: 'sa-options', 'aria-busy': busy },
    locked && h('small', null, '当前会话权限已锁定 / Permissions locked'),
    snapshot && !snapshot.available && h('small', null, '安全自动当前不可用；仍可选择原生模式退出 / Safe Auto unavailable; native modes remain available.'),
    snapshot && !selected && h('small', null, `当前自定义权限（只显示） / Current custom permission (display only): ${snapshot.current}`),
    !snapshot && h('small', null, '正在读取权限 / Loading permissions…'),
    snapshot?.platform === 'win32' && h('small', null, 'Windows：自动提权与 PowerShell 自动放行暂不支持，仍需原生审批 / Windows escalation and PowerShell remain manual.'),
    (snapshot?.options || []).map(option => h('button', { key: option.value, type: 'button', disabled: locked || busy || (!snapshot.available && option.value === 'safe-auto'),
      'aria-pressed': snapshot.current === option.value, onClick: () => choose(option.value) },
      snapshot.current === option.value ? '✓ ' : '', permissionLabel(option), option.description && h('small', null, option.description))),
    h('button', { type: 'button', disabled: busy, onClick: () => { setError(''); refresh(); } }, '刷新 / Refresh'), h(ErrorText, { error })));
}

export function ModelFields({ stage, values, catalog, disabled, onChange }) {
  const provider = values[`${stage}Provider`] || '', model = values[`${stage}Model`] || '';
  const effort = values[`${stage}ReasoningEffort`] || '';
  const choices = modelChoices(catalog, provider, model);
  if (stage === 'deep') choices[0] = { ...choices[0], name: '关闭深度审核 / Disable deep review' };
  const selected = choices.find(choice => choice.value === modelKey(provider, model));
  const follow = !provider && !model;
  const unknownEffort = effort && !selected.efforts.some(item => item.id === effort);
  return h('fieldset', { disabled }, h('legend', null, stage === 'fast' ? '快速审核 / Fast reviewer' : '深度审核 / Deep reviewer'),
    h('label', null, '模型 / Model', h('select', { value: selected.value, onChange: e => {
      const choice = choices.find(item => item.value === e.target.value);
      if (choice) onChange(selectModel(values, stage, choice));
    } }, choices.map(choice => h('option', { key: choice.value, value: choice.value }, choice.name)))),
    follow ? h('small', null, stage === 'deep' ? '深度审核已关闭 / Deep review is disabled.' : '跟随对话：思考强度使用默认值 / Conversation route: default reasoning effort.', effort && ` 已保存的强度「${effort}」仍保留；请在 profile 配置中检查 / Saved effort retained; check profile.`) :
      h('label', null, '思考强度 / Reasoning effort', h('select', { value: effort, onChange: e => onChange({ ...values, [`${stage}ReasoningEffort`]: e.target.value }) },
        h('option', { value: '' }, '默认 / Default'), selected.efforts.map(item => h('option', { key: item.id, value: item.id }, item.name || item.id)),
        unknownEffort && h('option', { value: effort }, `已保存，目录中不可用 / Saved, unavailable: ${effort}`))),
    selected.unknown && h('small', null, '当前模型不在目录中，保留已保存配置 / Model is absent from catalog; saved configuration is retained.'),
    !follow && unknownEffort && h('small', null, '当前思考强度不在目录中；不会自动替换 / Saved effort is not advertised; no automatic replacement.'),
    h('small', null, '显式选择模型会清空旧思考强度 / Selecting a model clears its previous effort.'));
}

export function SettingsPanel({ view, api, initialSettings = null, initialCatalog = null }) {
  const [settings, setSettings] = useState(initialSettings);
  const [values, setValues] = useState(initialSettings?.values || null);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [error, setError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = useRef(false);
  const scopeRef = useRef(null);
  const refreshRef = useRef(null);
  const refresh = (discardDraft = false) => scopeRef.current?.run(() => api.getSettings(), {
    value: next => { if (dirty.current && !discardDraft) return; setSettings(next); setValues(next.values); dirty.current = false; setSaved(false); setError(''); },
    error: e => setError(e.message),
  });
  refreshRef.current = refresh;
  useEffect(() => {
    const scope = createRequestScope(); scopeRef.current = scope;
    refreshRef.current();
    let alive = true;
    Promise.resolve().then(() => api.modelCatalog()).then(value => { if (alive) setCatalog(value); }, e => { if (alive) setCatalogError(e.message); });
    const focus = () => { if (!dirty.current) refreshRef.current(); };
    globalThis.addEventListener?.('focus', focus);
    return () => { alive = false; scope.dispose(); globalThis.removeEventListener?.('focus', focus); };
  }, [api]);
  const change = next => { dirty.current = true; setSaved(false); setValues(next); };
  const save = () => {
    if (!settings || !values || settings.http || scopeRef.current?.writing || (values.reviewerPrompt || '').length > 4096) return;
    setBusy(true); setError(''); setSaved(false);
    scopeRef.current?.run(() => api.saveSettings({ expectedRevision: settings.revision, values }), {
      value: next => { setSettings(next); setValues(next.values); dirty.current = false; setSaved(true); },
      error: e => setError(`${e.message} — 草稿保留；请刷新后重新编辑，不会自动重试 / Draft retained; refresh before editing again. No automatic retry.`),
      settled: () => setBusy(false),
    }, true);
  };
  if (view === 'summary') return h('div', { className: 'dsh-safe-auto' }, h(Style),
    h('p', null, '安全自动：审核模型、思考强度与额外审核提示词 / Safe Auto: reviewer models, reasoning effort and additional review prompt.'),
    settings?.http && h('small', null, 'HTTP 审核模式；保留 profile 配置 / HTTP reviewer; profile settings retained.'), h(ErrorText, { error }));
  return h('section', { className: 'dsh-safe-auto', 'aria-label': '安全自动设置 / Safe Auto settings', 'aria-busy': busy }, h(Style),
    h('p', null, '仅保存审核配置，不切换会话权限、不调用模型 / Saves reviewer settings only; does not change session permissions or call models.'),
    settings?.http && h('p', { role: 'status' }, 'HTTP 审核模式：此面板只读。请在 profile 中编辑配置；这里不会覆盖已保存值 / HTTP mode: read-only. Edit the profile; saved values will not be overwritten.'),
    !values && h('p', null, '正在读取配置 / Loading settings…'),
    values && h(React.Fragment, null,
      h(ModelFields, { stage: 'fast', values, catalog, disabled: busy || settings.http, onChange: change }),
      h(ModelFields, { stage: 'deep', values, catalog, disabled: busy || settings.http, onChange: change }),
      h('label', null, '额外审核提示词 / Additional reviewer prompt', h('textarea', { rows: 6, maxLength: 4096, disabled: busy || settings.http, value: values.reviewerPrompt || '', onChange: e => change({ ...values, reviewerPrompt: e.target.value }) })),
      h('small', null, `${(values.reviewerPrompt || '').length}/4096。只可补充审核约束，不可扩大授权或覆盖安全规则 / May add review constraints, never expand authorization or override safety rules.`),
      h('p', null, '思考模型可能需要更高输出预算：默认快速 64 / 深度 256 tokens 可能不足；请在 profile 检查 fastOutputTokens / deepOutputTokens（此面板不修改预算） / Reasoning models may need a larger output budget; check these profile fields.'),
      h('div', { className: 'sa-actions' }, h('button', { type: 'button', disabled: busy || settings.http || !dirty.current || (values.reviewerPrompt || '').length > 4096, onClick: save }, '保存 / Save'),
        h('button', { type: 'button', disabled: busy, onClick: () => refresh(true) }, '刷新（丢弃草稿） / Refresh (discard draft)'))),
    h(ErrorText, { error }), h(ErrorText, { error: catalogError && `模型目录读取失败，已保存值保持不变 / Model catalog failed; saved values retained: ${catalogError}` }),
    saved && h('p', { role: 'status' }, '已保存 / Saved'));
}

export function apply(ctx) {
  const call = (endpoint, payload) => unwrapRpc((...args) => ctx.connection.rpc.call(...args), endpoint, payload);
  const api = Object.freeze({
    getSettings: () => call('settings.get', {}),
    saveSettings: payload => call('settings.save', payload),
    getSession: sessionId => call('session.get', { sessionId }),
    selectSession: payload => call('session.select', payload),
    modelCatalog: () => ctx.remote.session.modelCatalog(),
  });
  ctx.slots.inject('conversation.input.permission', () => ctx.slots.register({
    name: 'conversation.input.permission', priority: -10, inject: () => ({ api }),
  }, PermissionMenu));
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: BUNDLE, inject: () => ({ api }),
  }, SettingsPanel));
}
