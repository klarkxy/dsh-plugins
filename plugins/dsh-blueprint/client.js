window.__ModuleLoader__.load({
  id: '@klarkxy/dsh-blueprint',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const PACKAGE = '@klarkxy/dsh-blueprint';
    const box = { boxSizing: 'border-box', border: '1px solid currentColor', borderRadius: 7, padding: '7px 10px', background: 'transparent', color: 'inherit', font: 'inherit' };
    const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 };
    const stack = { display: 'grid', gap: 12, minWidth: 0 };
    const card = { border: '1px solid color-mix(in srgb, currentColor 30%, transparent)', borderRadius: 9, padding: 12 };
    const dim = { opacity: .72, margin: 0 };
    const check = (label, checked, onChange, disabled) => h('label', { style: { display: 'flex', gap: 8, alignItems: 'start', overflowWrap: 'anywhere' } },
      h('input', { type: 'checkbox', checked, onChange, disabled, style: { marginTop: 3 } }), label);
    const Button = ({ children, primary, ...props }) => h('button', { type: 'button', style: { ...box, cursor: props.disabled ? 'default' : 'pointer', fontWeight: primary ? 650 : undefined }, ...props }, children);
    const textarea = (value, label, rows = 6) => h('textarea', { readOnly: true, value, rows, 'aria-label': label, onFocus: e => e.target.select(),
      style: { ...box, width: '100%', resize: 'vertical', fontFamily: 'ui-monospace, monospace' } });

    function useText(ctx) {
      const [zh, setZh] = React.useState(() => ctx.locale.getSnapshot().active.startsWith('zh'));
      React.useEffect(() => ctx.locale.subscribe(() => setZh(ctx.locale.getSnapshot().active.startsWith('zh'))), [ctx]);
      return (cn, en) => zh ? cn : en;
    }
    function Menu({ label, items, choose }) {
      const ref = React.useRef(null);
      React.useEffect(() => {
        const outside = event => {
          if (ref.current?.open && !ref.current.contains(event.target)) ref.current.open = false;
        };
        const escape = event => {
          if (event.key !== 'Escape' || !ref.current?.open) return;
          event.preventDefault();
          event.stopPropagation();
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape, true);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
      }, []);
      return h('details', { ref, style: { position: 'relative', WebkitAppRegion: 'no-drag' } },
        h('summary', { style: { ...box, cursor: 'pointer', listStyle: 'none' } }, label, ' ▾'),
        h('div', { style: { ...card, position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', insetInlineStart: 0, minWidth: 190,
          background: 'var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1, Canvas))',
          color: 'var(--dsw-alias-label-primary, CanvasText)', boxShadow: 'var(--dsw-elevation-prominent, 0 8px 24px #0002)', padding: 4 } },
          items.map(item => h('button', { key: item.key, type: 'button', onClick: () => {
            if (ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); }
            choose(item.key);
          },
            style: { display: 'block', width: '100%', textAlign: 'start', border: 0, borderRadius: 6, padding: '9px 10px', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' } }, item.label))));
    }
    function Actions({ ctx, page = false }) {
      const t = useText(ctx);
      const [task, setTask] = React.useState(null);
      const [lastPlan, setLastPlan] = React.useState(null);
      return h('section', { 'aria-label': t('蓝图', 'Blueprint'), style: { ...stack, position: 'relative', zIndex: 30, WebkitAppRegion: 'no-drag' } },
        page && h('p', { style: dim }, t('分享插件组合与安装顺序。导入前可以核对变更。', 'Share plugin selection and installation order. Review changes before importing.')),
        h('div', { style: row },
          h(Menu, { label: t('蓝图', 'Blueprint'), choose: setTask, items: [
            { key: 'import', label: t('导入蓝图', 'Import blueprint') },
            { key: 'export', label: t('导出蓝图', 'Export blueprint') }] })),
        task && h(TaskDialog, { key: task, ctx, task, t, lastPlan, onPlan: setLastPlan, onClose: () => setTask(null) }));
    }
    function TaskDialog({ ctx, task, t, lastPlan, onPlan, onClose }) {
      const exporting = task === 'export';
      const title = exporting ? t('导出蓝图', 'Export blueprint') : t('导入蓝图', 'Import blueprint');
      const dialog = React.useRef(null), controller = React.useRef(null), epoch = React.useRef(0), locked = React.useRef(false);
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
      const [catalog, setCatalog] = React.useState(null), [selected, setSelected] = React.useState([]);
      const [name, setName] = React.useState(() => t('我的插件组合', 'My plugin setup')), [generated, setGenerated] = React.useState(null);
      const [copied, setCopied] = React.useState(null), [source, setSource] = React.useState('');
      const [preview, setPreview] = React.useState(null), [confirmed, setConfirmed] = React.useState(false);
      const [report, setReport] = React.useState(null), [finishedPlan, setFinishedPlan] = React.useState(lastPlan);
      function close() { epoch.current++; controller.current?.abort(); dialog.current?.close(); onClose(); }
      React.useEffect(() => {
        const node = dialog.current; node?.showModal();
        return () => { epoch.current++; controller.current?.abort(); controller.current = null; locked.current = false; if (node?.open) node.close(); };
      }, []);
      async function rpc(endpoint, payload, signal) {
        const result = await ctx.connection.rpc.call('/dsh-blueprint', endpoint, payload, signal);
        if (!result.ok) throw new Error(result.error?.message || 'Request failed');
        return result.value;
      }
      async function run(work) {
        if (locked.current) return;
        locked.current = true;
        const id = ++epoch.current, request = new AbortController();
        controller.current = request; setBusy(true); setError('');
        try { await work((endpoint, payload) => rpc(endpoint, payload, request.signal), () => epoch.current === id && !request.signal.aborted); }
        catch (cause) { if (epoch.current === id && !request.signal.aborted) setError(cause instanceof Error ? cause.message : t('操作失败', 'Operation failed')); }
        finally { if (epoch.current === id) { locked.current = false; controller.current = null; setBusy(false); } }
      }
      function clearExport() { setGenerated(null); setCopied(null); }
      function updateSource(text) { setSource(text); setPreview(null); setConfirmed(false); setReport(null); }
      function load() {
        return run(async (call, current) => {
          const data = await call('catalog', {});
          if (!current()) return;
          setCatalog(data);
          const eligible = new Set(data.packages.filter(p => !p.readonly && !p.reason).map(p => p.name));
          setSelected(data.order.filter(n => eligible.has(n)));
          clearExport();
        });
      }
      React.useEffect(() => { if (exporting) void load(); }, []);
      function togglePackage(name) { setSelected(old => old.includes(name) ? old.filter(n => n !== name) : [...old, name]); clearExport(); }
      function move(index, by) {
        setSelected(old => { const next = [...old]; [next[index], next[index + by]] = [next[index + by], next[index]]; return next; });
        clearExport();
      }
      function generate() {
        return run(async (call, current) => {
          const value = await call('generate', { name, packages: selected });
          if (current()) setGenerated(value);
        });
      }
      function previewImport() {
        setPreview(null); setConfirmed(false); setReport(null);
        return run(async (call, current) => { const value = await call('preview', { text: source }); if (current()) setPreview(value); });
      }
      function applyImport() {
        if (!preview?.planId || preview.blockers?.length || !preview.operations?.length || !confirmed) return;
        const planId = preview.planId; onPlan(planId); setFinishedPlan(planId); setConfirmed(false);
        return run(async (call, current) => {
          const value = await call('apply', { planId, confirmed: true });
          if (current()) { setReport(value); setPreview(null); }
        });
      }
      function readResult() {
        if (!finishedPlan) return;
        return run(async (call, current) => {
          const value = await call('result', { planId: finishedPlan });
          if (!current()) return;
          if (!value) throw new Error(t('结果未保留；请在原生插件管理器检查当前状态。', 'Result unavailable. Check the native plugin manager for current state.'));
          setReport(value);
        });
      }
      return h('dialog', { ref: dialog, onCancel: e => { e.preventDefault(); close(); }, 'aria-label': title,
        style: { width: 'min(680px, calc(100vw - 32px))', maxWidth: 'calc(100vw - 32px)', maxHeight: '85vh', overflow: 'auto',
          boxSizing: 'border-box', border: '1px solid currentColor', borderRadius: 12, padding: 'clamp(16px, 4vw, 26px)',
          background: 'var(--dsw-alias-bg-module-platform, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)' } },
        h('div', { style: stack },
          h('div', { style: { ...row, justifyContent: 'space-between' } },
            h('h2', { style: { margin: 0, fontSize: '1.2em' } }, title),
            h(Button, { onClick: close, 'aria-label': t('关闭', 'Close') }, '×')),
          error && h('p', { role: 'alert', style: card }, error),
          busy && h('p', { role: 'status', style: dim }, t('正在处理…', 'Working…')),
          exporting ? h(ExportContent, { t, busy, catalog, selected, togglePackage, move, name, setName,
            generated, clearExport, copied, setCopied, load, generate })
            : h(ImportContent, { t, busy, source, updateSource, preview, previewImport, confirmed, setConfirmed,
              applyImport, report, finishedPlan, readResult })));
    }
    function ExportContent(p) {
      const { t, busy, catalog, selected, togglePackage, move, name, setName,
        generated, clearExport, copied, setCopied, load, generate } = p;
      const mounted = React.useRef(false);
      React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
      const eligible = catalog?.packages.filter(pkg => !pkg.readonly && !pkg.reason) ?? [];
      return h('div', { style: stack },
        h('p', { style: dim }, t('选择插件及建议顺序；导入时会保留接收方已有的插件顺序。', 'Choose plugins and a preferred order. Import preserves the recipient’s existing order.')),
        h(Button, { onClick: load, disabled: busy }, t('刷新', 'Refresh')),
        h('label', { style: stack }, t('名称', 'Name'),
          h('input', { style: { ...box, width: '100%' }, value: name, maxLength: 120, disabled: busy,
            onChange: e => { setName(e.target.value); clearExport(); } })),
        catalog && h('div', { style: stack },
          h('h3', { style: { margin: 0 } }, t('插件', 'Plugins')),
          eligible.map(pkg => h('div', { key: pkg.name }, check(`${pkg.name} · ${pkg.version ?? '?'}${pkg.enabled ? '' : t('（未启用，仅分享安装）', ' (inactive; installation only)')}`,
            selected.includes(pkg.name), () => togglePackage(pkg.name), busy))),
          h('h3', { style: { margin: 0 } }, t('建议顺序', 'Preferred order')),
          selected.length ? h('ol', { style: { ...stack, paddingInlineStart: 30, margin: 0 } }, selected.map((pkg, index) =>
            h('li', { key: pkg }, h('div', { style: { ...row, justifyContent: 'space-between' } },
              h('span', { style: { overflowWrap: 'anywhere' } }, pkg),
              h('span', { style: row },
                h(Button, { disabled: busy || index === 0, onClick: () => move(index, -1), 'aria-label': t(`上移 ${pkg}`, `Move ${pkg} up`) }, '↑'),
                h(Button, { disabled: busy || index === selected.length - 1, onClick: () => move(index, 1),
                  'aria-label': t(`下移 ${pkg}`, `Move ${pkg} down`) }, '↓'))))))
            : h('p', { style: dim }, t('未选择插件。', 'No plugins selected.'))),
        h(Button, { onClick: generate, disabled: busy || !catalog || !name.trim() || !selected.length, primary: true },
          t('生成导出内容', 'Generate export')),
        generated && h('div', { style: stack },
          h('div', { style: stack },
            h('label', { style: stack }, t('蓝图分享码', 'Blueprint share code'), textarea(generated.code, t('蓝图分享码', 'Blueprint share code'))),
            h('div', { style: row }, h(Button, { disabled: busy, onClick: async () => {
              try { await navigator.clipboard.writeText(generated.code); if (mounted.current) setCopied('ok'); }
              catch { if (mounted.current) setCopied('failed'); }
            } }, t('复制分享码', 'Copy share code')),
              copied && h('span', { role: copied === 'failed' ? 'alert' : 'status' },
                copied === 'ok' ? t('已复制', 'Copied') : t('复制失败，请手动复制分享码。', 'Copy failed. Select and copy the code manually.'))))));
    }
    function describe(op, t) {
      if (op.type === 'install') return t(`安装 ${op.name}@${op.version}`, `Install ${op.name}@${op.version}`);
      if (op.type === 'bundle') return t(`启用 ${op.name}`, `Enable ${op.name}`);
      return String(op.type);
    }
    function status(value, t) {
      const labels = {
        applied: [ '已完成', 'Applied' ], interrupted: [ '已中断', 'Interrupted' ],
        conflict: [ '当前状态已变化', 'Profile changed' ], 'verification-failed': [ '验证失败', 'Verification failed' ],
        failed: [ '失败', 'Failed' ], rejected: [ '未执行', 'Not applied' ],
        'restart-required': [ '需要重启后生效', 'Restart required' ], overridden: [ '被宿主配置覆盖', 'Overridden by host configuration' ],
        cancelled: [ '已取消', 'Cancelled' ],
      };
      return labels[value] ? t(...labels[value]) : String(value ?? t('未知', 'Unknown'));
    }
    function ImportContent(p) {
      const { t, busy, source, updateSource, preview, previewImport, confirmed, setConfirmed,
        applyImport, report, finishedPlan, readResult } = p;
      const blocked = (preview?.blockers?.length ?? 0) > 0;
      return h('div', { style: stack },
        h('p', { style: dim }, t('粘贴蓝图码。保留已有顺序，需要启用的插件按蓝图顺序追加。', 'Paste a blueprint code. Existing order stays; requested new activations append in blueprint order.')),
        h('p', { style: dim }, t('不会删除现有插件。安装可能运行包脚本；启用会执行插件代码。请只导入可信来源的蓝图。',
          'Existing plugins are not removed. Installation may run package scripts, and enabling runs plugin code. Import only from a source you trust.')),
        h('label', { style: stack }, t('蓝图分享码', 'Blueprint share code'),
          h('textarea', { style: { ...box, width: '100%', resize: 'vertical', fontFamily: 'ui-monospace, monospace' }, rows: 7,
            value: source, disabled: busy, onChange: e => updateSource(e.target.value) })),
        h(Button, { onClick: previewImport, disabled: busy || !source.trim(), primary: true }, t('预览变更', 'Preview changes')),
        preview && h('section', { style: { ...stack, ...card }, 'aria-label': t('导入预览', 'Import preview') },
          h('h3', { style: { margin: 0 } }, t('将执行的变更', 'Planned changes')),
          preview.operations?.length ? h('ol', { style: { margin: 0, paddingInlineStart: 25 } },
            preview.operations.map((op, index) => h('li', { key: index }, describe(op, t))))
            : h('p', { style: dim }, t('当前内容没有需要执行的变更。', 'No changes are needed.')),
          preview.order?.length > 0 && h('p', { style: dim }, t('最终插件顺序：', 'Final plugin order: '), preview.order.join(' → ')),
          blocked && h('div', { role: 'alert' }, h('strong', null, t('需要先解决的问题', 'Resolve before applying')),
            h('ul', null, preview.blockers.map((item, index) => h('li', { key: index }, String(item))))),
          !blocked && preview.operations?.length > 0 && check(t('我已核对上述变更，确认执行。', 'I reviewed these changes and confirm applying them.'),
            confirmed, () => setConfirmed(value => !value), busy),
          h(Button, { onClick: applyImport, disabled: busy || blocked || !preview.planId || !preview.operations?.length || !confirmed, primary: true },
            t('执行变更', 'Apply changes'))),
        report && h('section', { style: { ...stack, ...card }, role: 'status' },
          h('strong', null, t('执行状态：', 'Result: '), status(report.status, t)),
          report.steps?.length > 0 && h('ol', { style: { margin: 0, paddingInlineStart: 25 } },
            report.steps.map((step, index) => h('li', { key: index }, `${step.target ?? step.type}: `, status(step.outcome?.application ?? 'applied', t)))),
          report.remaining > 0 && h('p', { style: dim }, t(`仍有 ${report.remaining} 项未执行。`, `${report.remaining} changes remain.`))),
        finishedPlan && h(Button, { onClick: readResult, disabled: busy }, t('读取上次执行结果', 'Read last execution result')));
    }
    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        ctx.slots.inject('plugins.list.actions', () => ctx.slots.register(
          { name: 'plugins.list.actions', id: 'klarkxy-blueprint', order: 40 },
          () => h(Actions, { ctx })));
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: PACKAGE }, () => h(Actions, { ctx, page: true })));
      },
    };
  },
});
