window.__ModuleLoader__.load({
  id: '@klarkxy/dsh-dev-index',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const pages = 'https://klarkxy.github.io/dsh-plugins/';

    function DocumentationBrowser({ hostLocale }) {
      const [language, setLanguage] = React.useState(() =>
        hostLocale.getSnapshot().active.startsWith('zh') ? 'zh' : 'en');
      const [revision, setRevision] = React.useState(0);
      const [loaded, setLoaded] = React.useState(false);
      const url = language === 'zh' ? `${pages}zh/index.html` : `${pages}index.html`;
      const chinese = language === 'zh';

      React.useEffect(() => hostLocale.subscribe(() => {
        setLanguage(hostLocale.getSnapshot().active.startsWith('zh') ? 'zh' : 'en');
        setLoaded(false);
      }), [hostLocale]);

      function navigate(nextLanguage) {
        setLoaded(false);
        setLanguage(nextLanguage);
        setRevision(value => value + 1);
      }

      const button = (label, onClick, disabled = false) => h('button', {
        type: 'button',
        onClick,
        disabled,
        style: {
          border: '1px solid currentColor', borderRadius: 6, background: 'transparent',
          color: 'inherit', padding: '6px 10px', cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 0.85,
        },
      }, label);

      return h('section', {
        'aria-label': chinese ? 'DSH 文档浏览器' : 'DSH documentation browser',
        style: { marginTop: 20, width: '100%', minWidth: 0 },
      },
      h('div', {
        style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
      },
      button(chinese ? '返回文档首页' : 'Documentation home', () => navigate(language)),
      button('中文', () => navigate('zh'), chinese),
      button('English', () => navigate('en'), !chinese),
      h('a', {
        href: url, target: '_blank', rel: 'noopener noreferrer',
        style: { color: 'inherit', marginLeft: 'auto', textDecoration: 'underline' },
      }, chinese ? '在浏览器中打开' : 'Open in browser')),
      h('div', {
        style: { marginBottom: 8, opacity: 0.65, fontSize: 12, overflowWrap: 'anywhere' },
      }, chinese ? '来源：GitHub Pages' : 'Source: GitHub Pages'),
      !loaded && h('p', { role: 'status', style: { opacity: 0.7, margin: '8px 0' } },
        chinese ? '正在加载文档…' : 'Loading documentation…'),
      h('iframe', {
        key: `${language}-${revision}`,
        src: url,
        title: chinese ? 'DSH 开发文档' : 'DSH development documentation',
        sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox',
        referrerPolicy: 'no-referrer',
        onLoad: () => setLoaded(true),
        style: {
          display: 'block', width: '100%', height: 'min(70vh, 720px)', minHeight: 420,
          border: '1px solid currentColor', borderRadius: 8, background: '#fff',
        },
      }),
      h('p', { style: { opacity: 0.65, fontSize: 12, marginTop: 8 } },
        chinese ? '如果文档无法显示，请选择“在浏览器中打开”。' :
          'If the page does not appear, use “Open in browser”.'));
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
