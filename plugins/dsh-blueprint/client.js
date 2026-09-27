window.__ModuleLoader__.load({
  id: '@klarkxy/dsh-blueprint',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const PACKAGE = '@klarkxy/dsh-blueprint';
    const idOf = f => JSON.stringify([f.package, f.row, f.module]);
    const style = { border: '1px solid currentColor', borderRadius: 6, padding: '6px 10px', background: 'transparent', color: 'inherit', font: 'inherit' };
    let focusPackage = null;
    function Panel({ ctx }) {
      const [zh, setZh] = React.useState(() => ctx.locale.getSnapshot().active.startsWith('zh'));
      const t = (a, b) => zh ? a : b;
      const [catalog, setCatalog] = React.useState(null), [selected, setSelected] = React.useState([]);
      const [forms, setForms] = React.useState([]), [omit, setOmit] = React.useState([]);
      const [mode, setMode] = React.useState('plugins'), [name, setName] = React.useState('My DSH setup');
      const [generated, setGenerated] = React.useState(null), [source, setSource] = React.useState('');
      const [preview, setPreview] = React.useState(null), [confirmed, setConfirmed] = React.useState(false);
      const [report, setReport] = React.useState(null), [lastPlan, setLastPlan] = React.useState(null);
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
      const lifetime = React.useRef(null);
      async function rpc(endpoint, payload) {
        const result = await ctx.connection.rpc.call('/dsh-blueprint', endpoint, payload, lifetime.current?.signal);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      }
      async function run(fn) {
        setBusy(true); setError('');
        try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Operation failed'); }
        finally { setBusy(false); }
      }
      async function load() {
        const data = await rpc('catalog', {}); setCatalog(data);
        const selection = data.packages.filter(p => !p.readonly && !p.reason && (!focusPackage || p.name === focusPackage)).map(p => p.name);
        setSelected(selection); setForms(data.forms.filter(f => f.builtin || selection.includes(f.package)).map(idOf));
        setOmit([]); setGenerated(null); focusPackage = null;
      }
      React.useEffect(() => {
        lifetime.current = new AbortController();
        const off = ctx.locale.subscribe(() => setZh(ctx.locale.getSnapshot().active.startsWith('zh')));
        void run(load);
        return () => { off(); lifetime.current.abort(); };
      }, []);
      const button = (label, action, disabled = false) => h('button', { type: 'button', style, disabled: busy || disabled, onClick: () => run(action) }, label);
      const toggle = (list, value) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];
      const check = (label, checked, onChange, disabled = false) => h('label', { style: { display: 'flex', alignItems: 'start', gap: 8, padding: '5px 0', overflowWrap: 'anywhere' } },
        h('input', { type: 'checkbox', checked, disabled: busy || disabled, onChange }), label);
      function updateSource(value) { setSource(value); setPreview(null); setConfirmed(false); setReport(null); }
      const code = value => h('pre', { style: { overflow: 'auto', maxHeight: 360, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 12, border: '1px solid currentColor', borderRadius: 6 } }, JSON.stringify(value, null, 2));
      return h('section', { 'aria-label': t('蓝图导入与导出', 'Blueprint import and export'), style: { display: 'grid', gap: 14, minWidth: 0 } },
        h('p', null, t('分享插件组合和官方 Config／Settings 暴露的可编辑设置。不读取自定义页面、自建存储、会话或凭据库。', 'Share plugins and editable settings exposed by official Config/Settings. Custom pages, private storage, sessions and credential stores are not read.')),
        error && h('p', { role: 'alert', style: { border: '1px solid currentColor', padding: 10 } }, error),
        busy && h('p', { role: 'status' }, t('正在处理；安装进度也可在官方插件管理器中查看。', 'Working. Native package installation progress is also available in the official manager.')),
        h('h3', null, t('导出蓝图', 'Export blueprint')),
        button(t('刷新插件与原生设置', 'Refresh plugins and native settings'), load),
        h('label', null, t('名称 ', 'Name '), h('input', { style, value: name, maxLength: 120, disabled: busy, onChange: e => { setName(e.target.value); setGenerated(null); } })),
        h('label', null, t('分享范围 ', 'Share '), h('select', { style, value: mode, disabled: busy, onChange: e => { setMode(e.target.value); setGenerated(null); } },
          h('option', { value: 'plugins' }, t('仅插件组合和顺序', 'Plugins and order only')),
          h('option', { value: 'settings' }, t('插件组合及设置', 'Plugins and settings')))),
        catalog && h('div', null, catalog.packages.map(p => h('div', { key: p.name }, check(
          `${p.name}@${p.version ?? '?'}${p.reason ? ` (${p.reason})` : ''}${p.readonly ? t('（宿主管理，不导出）', ' (host-managed)') : ''}`,
          selected.includes(p.name), () => { setSelected(toggle(selected, p.name)); setGenerated(null); }, p.readonly || Boolean(p.reason))))),
        mode === 'settings' && catalog && h('div', null,
          h('p', null, t('以官方可编辑字段为准，不推断自定义页面的可见字段。普通字段默认包含；可以取消任一表单或字段。请检查未标记的私密内容。', 'The official editable fields define scope, not custom-page visibility. Ordinary fields are included by default. Uncheck any form or field and review unmarked private text.')),
          catalog.forms.filter(f => f.builtin || selected.includes(f.package)).map(f => h('details', { key: idOf(f) },
            h('summary', null, `${f.row} · ${f.package}`),
            check(t('包含此原生配置', 'Include these native settings'), forms.includes(idOf(f)), () => { setForms(toggle(forms, idOf(f))); setGenerated(null); }),
            f.fields.map(field => {
              const key = JSON.stringify([idOf(f), field.path]);
              return h('div', { key }, check(`${field.path.join('.')} = ${JSON.stringify(field.value)}`, !omit.includes(key), () => { setOmit(toggle(omit, key)); setGenerated(null); }, !forms.includes(idOf(f))));
            }), f.omitted.length > 0 && code(f.omitted))),
        ),
        catalog?.warnings?.length > 0 && h('details', null, h('summary', null, t('未导出的项目与限制', 'Unavailable configurations and limits')), code(catalog.warnings)),
        button(t('生成并预览', 'Generate and review'), async () => setGenerated(await rpc('generate', {
          mode, name, packages: selected,
          forms: forms.filter(id => catalog.forms.some(f => idOf(f) === id && (f.builtin || selected.includes(f.package)))),
          omit: omit.map(key => { const [form, path] = JSON.parse(key); return { form, path }; }),
        })), !catalog || !name.trim()),
        generated && h('div', null, code(generated.blueprint),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            button(t('复制分享码', 'Copy share code'), () => navigator.clipboard.writeText(generated.code)),
            button(t('保存 JSON', 'Save JSON'), async () => {
              const url = URL.createObjectURL(new Blob([generated.json], { type: 'application/json' }));
              const a = document.createElement('a'); a.href = url; a.download = 'setup.dsh-blueprint.json'; a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })),
          h('details', null, h('summary', null, t('分享码（也可手动复制）', 'Share code (manual copy)')), h('textarea', { readOnly: true, value: generated.code, rows: 4, style: { ...style, width: '100%', boxSizing: 'border-box' } }))),
        h('hr'), h('h3', null, t('导入到当前 profile', 'Import into the current profile')),
        h('p', null, t('不会新建空间或删除现有插件。蓝图中的插件会保持相对顺序；需要重排时放在未选插件之后。', 'No spaces are created and no existing packages are removed. Imported bundles retain their relative order; reordered bundles follow unselected bundles.')),
        h('label', null, t('读取蓝图文件 ', 'Read blueprint file '), h('input', { type: 'file', accept: '.json,.txt', disabled: busy, onChange: e => { const file = e.target.files?.[0]; if (file) void run(async () => {
          if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB');
          updateSource(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()));
        }); } })),
        h('textarea', { 'aria-label': t('JSON 或分享码', 'JSON or share code'), value: source, rows: 7, disabled: busy,
          maxLength: 2 * 1024 * 1024, style: { ...style, width: '100%', boxSizing: 'border-box' }, onChange: e => updateSource(e.target.value) }),
        button(t('预览导入变更', 'Preview import changes'), async () => { setConfirmed(false); setPreview(await rpc('preview', { text: source })); }, !source.trim()),
        preview && h('div', null,
          preview.blockers.length > 0 && h('div', { role: 'alert' }, code(preview.blockers)),
          code({ stage: preview.stage, operations: preview.operations, finalOrder: preview.order }),
          preview.next && h('p', null, t('这一步仅安装／启用插件。完成后再次预览，核对真实配置字段后再确认写入设置。', 'This stage only installs/enables plugins. Preview again afterwards to review the live configuration fields before writing settings.')),
          check(t('我已核对变更，并信任这些插件代码。安装可能运行先前已授权的构建脚本；启用会执行插件。', 'I reviewed the changes and trust the plugin code. Installation may run previously approved build scripts; enabling executes plugins.'), confirmed, () => setConfirmed(!confirmed)),
          button(t('确认执行本次变更', 'Apply these changes'), async () => {
            const id = preview.planId; setLastPlan(id);
            const result = await rpc('apply', { planId: id, confirmed: true }); setReport(result); setPreview(null); setConfirmed(false);
          }, !preview.planId || !confirmed)),
        report && h('div', { role: 'status' }, h('strong', null, t('执行结果', 'Execution result')), code(report),
          report.next && h('p', null, t('请再次点击“预览导入变更”以继续设置阶段。', 'Select Preview import changes again to continue with settings.'))),
        lastPlan && button(t('读取该次执行结果（不重试执行）', 'Read this execution result (no replay)'), async () => {
          const result = await rpc('result', { planId: lastPlan });
          if (!result) throw new Error(t('结果尚未生成或服务已重启；请检查官方管理器，不要假定操作未发生。', 'No retained result yet, or the service restarted. Check the official manager; do not assume nothing changed.'));
          setReport(result);
        }),
      );
    }
    return {
      inject: ['slots', 'locale', 'connection', 'pluginNavigation'],
      apply(ctx) {
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE }, () => h(Panel, { ctx })));
        ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({ name: 'plugins.detail.actions', id: 'klarkxy-blueprint-share', order: 40 }, ({ subject }) => {
          if (subject.kind !== 'bundle' || subject.pkg.name === PACKAGE) return null;
          return h('button', { type: 'button', style, onClick: () => { focusPackage = subject.pkg.name; ctx.pluginNavigation.openBundle(PACKAGE); } }, ctx.locale.getSnapshot().active.startsWith('zh') ? '分享蓝图' : 'Share blueprint');
        }));
      },
    };
  },
});
