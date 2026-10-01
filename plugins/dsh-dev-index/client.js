window.__ModuleLoader__.load({
  id: '@klarkxy/dsh-dev-index',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { Button, SegmentedTabs } = require('@deepseek-ai/dsh-client-ui-primitives');
    const pages = 'https://deepseek-harness.github.io/deepseek-harness/';

/* A copy of the rules this client needs from
 * `@klarkxy/dsh-plugin-kit/official-ui`, the shared DSH Web design contract.
 * It is inlined rather than imported because nothing bundles this client half:
 * the host loads client.js raw and hands the factory a require that resolves
 * host modules by id, so a workspace package is not reachable from here. Only
 * patterns the primitives do not provide belong here — the toolbar below uses
 * the host's own Button. Keep the class names and metrics in step with that
 * module. */
const css = `
.dsh-di-root {
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  min-width: 0;
  width: 100%;

  & *, & *::before, & *::after { box-sizing: border-box; }
  & h1, & h2, & h3, & h4, & p, & figure { margin: 0; }
  /* Keyboard focus only: pointer input keeps the native resting appearance. */
  & :focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; border-radius: var(--dsw-radius-sm); }
  & [hidden] { display: none !important; }

  /* --- Type tiers. The same 14/22 and 12/18 steps the primitives use. --- */
  &.dsh-ui-meta, & .dsh-ui-meta { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
  &.dsh-ui-hint, & .dsh-ui-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }

  /* --- Layout scaffolding. Each recipe also matches the root itself, because
   * this plugin's one surface carries the root class and the stack on the same
   * element; a descendant-only rule would leave it unstyled. --- */
  &.dsh-ui-stack, & .dsh-ui-stack { display: flex; flex-direction: column; gap: 12px; }
  &.dsh-ui-row-wrap, & .dsh-ui-row-wrap { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  &.dsh-ui-spacer, & .dsh-ui-spacer { flex: 1; min-width: 0; }

  /* --- This plugin's own surfaces; the material and metrics stay official. --- */
  /* --- A banner is a left-rail notice. --- */
  & .dsh-ui-banner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px;
    border: 0.5px solid var(--dsw-alias-border-l3);
    border-left: 3px solid var(--dsw-alias-state-warn-primary);
    border-radius: var(--dsw-radius-md);
    background: var(--dsw-alias-bg-layer-1);
    font-size: 13px;
    line-height: 20px;
    color: var(--dsw-alias-label-secondary);
  }

  & .dsh-di-language { width: auto; min-width: 160px; }
  & .dsh-di-link { margin-left: auto; color: var(--dsw-alias-brand-primary); text-decoration: underline; }
  /* The fallback is the banner's primary way out, so it reads as its lead action. */
  & .dsh-di-open { font-weight: 500; color: var(--dsw-alias-brand-primary); text-decoration: underline; }
  /* The framed site is a surface, not a control: a flat l3 hairline and the
   * large card radius, with the fill from the host so it reads in both themes. */
  & .dsh-di-frame {
    display: block;
    width: 100%;
    /* One bounded height, so the frame never forces the page to scroll
     * alongside the framed site's own scrollbar. */
    height: clamp(320px, calc(100vh - 260px), 720px);
    border: 0.5px solid var(--dsw-alias-border-l3);
    border-radius: var(--dsw-radius-lg);
    background: var(--dsw-alias-bg-layer-1);
  }

  @media (prefers-reduced-motion: reduce) {
    & *, & *::before, & *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  }
}
`;

    /* A cross-origin frame reports `load` for error pages too and never reports
     * a refusal, so a slow or blocked load is detected by time alone. */
    const LOAD_TIMEOUT_MS = 12000;
    const hostLanguage = locale => locale.getSnapshot().active.startsWith('zh') ? 'zh' : 'en';

    function DocumentationBrowser({ hostLocale }) {
      const [language, setLanguage] = React.useState(() => hostLanguage(hostLocale));
      /* Once the reader picks a language, the host locale stops driving it. */
      const [pinned, setPinned] = React.useState(false);
      const [revision, setRevision] = React.useState(0);
      const [status, setStatus] = React.useState('loading');
      const url = language === 'zh' ? pages : `${pages}en/`;
      const chinese = language === 'zh';

      React.useEffect(() => {
        if (pinned) return undefined;
        return hostLocale.subscribe(() => setLanguage(hostLanguage(hostLocale)));
      }, [hostLocale, pinned]);

      React.useEffect(() => {
        setStatus('loading');
        const timer = setTimeout(() => setStatus(value => value === 'loading' ? 'slow' : value), LOAD_TIMEOUT_MS);
        return () => clearTimeout(timer);
      }, [language, revision]);

      function reload() { setRevision(value => value + 1); }
      function choose(nextLanguage) {
        setPinned(true);
        if (nextLanguage !== language) setLanguage(nextLanguage);
      }

      const open = h('a', {
        className: 'dsh-di-link',
        href: url, target: '_blank', rel: 'noopener noreferrer',
      }, chinese ? '在浏览器中打开' : 'Open in browser');

      return h('section', {
        'aria-label': chinese ? 'DSH 文档浏览器' : 'DSH documentation browser',
        className: 'dsh-di-root dsh-ui-stack',
      },
      h('style', null, css),
      h('div', { className: 'dsh-ui-row-wrap' },
        h(Button, { variant: 'outline', size: 'sm', onClick: reload },
          chinese ? '返回文档首页' : 'Documentation home'),
        h(SegmentedTabs, {
          className: 'dsh-di-language',
          label: chinese ? '文档语言' : 'Documentation language',
          value: language,
          onChange: choose,
          items: [
            { value: 'zh', label: '中文', id: 'dsh-di-lang-zh', panelId: 'dsh-di-frame' },
            { value: 'en', label: 'English', id: 'dsh-di-lang-en', panelId: 'dsh-di-frame' },
          ],
        }),
        status !== 'slow' && open),
      h('p', { className: 'dsh-ui-meta' },
        chinese ? '来源：DSH 官方文档' : 'Source: official DSH docs'),
      status === 'loading' && h('p', { role: 'status', className: 'dsh-ui-hint' },
        chinese ? '正在加载文档…' : 'Loading documentation…'),
      status === 'slow' && h('div', { role: 'status', className: 'dsh-ui-banner' },
        h('p', null, chinese ? '文档未加载。' : 'The documentation did not load.'),
        h('div', { className: 'dsh-ui-row-wrap' },
          h('a', {
            className: 'dsh-di-open',
            href: url, target: '_blank', rel: 'noopener noreferrer',
          }, chinese ? '在浏览器中打开' : 'Open in browser'),
          h(Button, { variant: 'outline', size: 'sm', onClick: reload }, chinese ? '重试' : 'Retry'))),
      h('iframe', {
        key: `${language}-${revision}`,
        id: 'dsh-di-frame',
        className: 'dsh-di-frame',
        src: url,
        title: chinese ? 'DSH 开发文档' : 'DSH development documentation',
        sandbox: 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
        referrerPolicy: 'no-referrer',
        onLoad: () => setStatus('loaded'),
      }));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: '@klarkxy/dsh-dev-index',
        }, () => h(DocumentationBrowser, { hostLocale: ctx.locale })));
      },
    };
  },
});
