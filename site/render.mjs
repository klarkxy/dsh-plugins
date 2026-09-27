// Pure rendering for the plugin site: catalog + fetched npm data -> Map<path, content>.
// No I/O here so tests can run offline against fixtures.
import { Marked } from "marked";

export const LANGS = ["zh", "en"];
const OFFICIAL_DOCS = "https://deepseek-harness.github.io/deepseek-harness/";
const CATEGORY_COLORS = { workflow: "#3c63e8", sessions: "#16877f", models: "#5b54d6", dev: "#2d6fa8" };

const T = {
  zh: {
    htmlLang: "zh-CN",
    siteTitle: "klarkxy 的 DSH 插件",
    switchLabel: "English",
    skip: "跳到正文",
    heroLead: (n) => `${n} 个 DeepSeek Harness 插件，都已发布到 npm。挑一个，在终端里装上。`,
    heroArg: "<包名>",
    heroNote: "把 web 换成你在用的 profile。装完重启 profile，插件会出现在「设置 → 插件」里。",
    catalog: "插件",
    filterLabel: "筛选插件",
    filterPlaceholder: "按名称、包名或用途筛选",
    count: (n) => `${n} 个插件`,
    empty: "没有匹配的插件，换个关键词试试。",
    copyInstall: "复制安装命令",
    copy: "复制",
    needs: (list) => `需先装 ${list}`,
    recent: "最近发布",
    footerData: (date) => `版本和 README 取自 npm，生成于 ${date}。`,
    source: "源码",
    npmProfile: "npm 主页",
    officialDocs: "DSH 官方文档",
    back: "全部插件",
    install: "安装",
    installDeps: (list) => `这个插件依赖 ${list}，命令会按顺序一起装上。`,
    about: "说明",
    readmeFrom: (path, version) => `以下内容来自 ${path}（${version}）。`,
    readmeFallback: "这个包没有中文 README，下面是英文原文。",
    readmeMissing: "这个包没有附带 README。",
    facts: "基本信息",
    version: "版本",
    released: "发布于",
    firstPublished: "首次发布",
    type: "类型",
    webUi: "含 Web 界面",
    dependsOn: "依赖",
    usedBy: "被依赖",
    license: "许可证",
    licenseFile: "见 LICENSE",
    links: "链接",
    issues: "反馈问题",
    toc: "本页内容",
    history: "版本记录",
    olderVersions: (n) => `还有 ${n} 个更早的版本，见 npm。`,
    related: "同类插件",
    kind: { preset: "预设", plugin: "插件", service: "共享服务" },
    notFoundTitle: "页面不存在",
    notFoundBody: "这个地址没有页面。旧的 DSH 开发索引已经下线，DSH 文档请看官方站点。",
    notFoundHome: "查看全部插件",
  },
  en: {
    htmlLang: "en",
    siteTitle: "klarkxy's DSH plugins",
    switchLabel: "中文",
    skip: "Skip to content",
    heroLead: (n) => `${n} DeepSeek Harness plugins, all published on npm. Pick one and install it from a terminal.`,
    heroArg: "<package>",
    heroNote: "Replace web with your profile name. Restart the profile after installing; the plugin then shows up under Settings → Plugins.",
    catalog: "Plugins",
    filterLabel: "Filter plugins",
    filterPlaceholder: "Filter by name, package, or purpose",
    count: (n) => `${n} plugin${n === 1 ? "" : "s"}`,
    empty: "No plugins match. Try another word.",
    copyInstall: "Copy install command",
    copy: "Copy",
    needs: (list) => `Needs ${list}`,
    recent: "Recent releases",
    footerData: (date) => `Versions and READMEs come from npm. Generated ${date}.`,
    source: "Source",
    npmProfile: "npm profile",
    officialDocs: "Official DSH docs",
    back: "All plugins",
    install: "Install",
    installDeps: (list) => `This plugin depends on ${list}; the commands install them in order.`,
    about: "About",
    readmeFrom: (path, version) => `From ${path} in ${version}.`,
    readmeFallback: "This package has no English README; the Chinese original follows.",
    readmeMissing: "This package ships no README.",
    facts: "Details",
    version: "Version",
    released: "Released",
    firstPublished: "First published",
    type: "Type",
    webUi: "includes a Web UI",
    dependsOn: "Depends on",
    usedBy: "Used by",
    license: "License",
    licenseFile: "See LICENSE",
    links: "Links",
    issues: "Report an issue",
    toc: "On this page",
    history: "Version history",
    olderVersions: (n) => `${n} older versions on npm.`,
    related: "More in this category",
    kind: { preset: "Preset", plugin: "Plugin", service: "Shared service" },
    notFoundTitle: "Page not found",
    notFoundBody: "Nothing lives at this address. The old DSH development index is gone; read the official site for DSH docs.",
    notFoundHome: "See all plugins",
  },
};

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });
export const day = (iso) => dateFormat.format(new Date(iso));

// ---------------------------------------------------------------------------
// Catalog validation

export function validateCatalog(catalog) {
  const errors = [];
  const categories = new Set(catalog.categories.map((c) => c.id));
  const slugs = new Set();
  const packages = new Set();
  for (const p of catalog.plugins) {
    if (!/^[a-z0-9-]+$/.test(p.slug ?? "")) errors.push(`${p.package}: bad slug`);
    if (slugs.has(p.slug)) errors.push(`${p.slug}: duplicate slug`);
    if (packages.has(p.package)) errors.push(`${p.package}: duplicate package`);
    slugs.add(p.slug);
    packages.add(p.package);
    if (!categories.has(p.category)) errors.push(`${p.slug}: unknown category ${p.category}`);
    if (!T.zh.kind[p.kind]) errors.push(`${p.slug}: unknown kind ${p.kind}`);
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(p.repository ?? "")) errors.push(`${p.slug}: repository must be https://github.com/owner/repo`);
    for (const lang of LANGS) {
      if (!p.title?.[lang]) errors.push(`${p.slug}: missing title.${lang}`);
      if (!p.summary?.[lang]) errors.push(`${p.slug}: missing summary.${lang}`);
      if (!p.readme?.[lang]) errors.push(`${p.slug}: missing readme.${lang}`);
    }
  }
  for (const c of catalog.categories) {
    for (const lang of LANGS) if (!c.title?.[lang] || !c.summary?.[lang]) errors.push(`category ${c.id}: missing ${lang} copy`);
  }
  if (errors.length) throw new Error(`site/catalog.json is invalid:\n  ${errors.join("\n  ")}`);
}

// ---------------------------------------------------------------------------
// README rendering

const SEPARATOR_TEXT = /^[\s|·/,，、]*(English|中文|简体中文|Chinese)?[\s|·/,，、]*$/i;

/** GitHub-compatible heading slugs, de-duplicated per document. */
export function makeSlugger() {
  const seen = new Map();
  return (text) => {
    const base = text.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-") || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

function plainText(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : "";
}

const isSafeUrl = (url) => /^(https?:|mailto:|#)/i.test(url) || !/^[^/?#]*:/.test(url);

/**
 * ctx: {
 *   repository: "https://github.com/o/r", directory: "packages/x", readmePath: "docs/README.zh-CN.md",
 *   cdnBase: "https://cdn.jsdelivr.net/npm/pkg@1.0.0/",
 *   readmePages: { [repoPath]: href }, packagePages: { [npmName]: href }
 * }
 * Returns { html, toc: [{ id, text }] }.
 */
export function renderReadme(markdown, ctx) {
  const dir = ctx.directory ? `${ctx.directory.replace(/\/$/, "")}/` : "";
  const readmeDir = `${dir}${ctx.readmePath}`.replace(/[^/]*$/, "");
  const [, owner, repo] = /github\.com\/([^/]+)\/([^/]+)/.exec(ctx.repository);
  const blobPrefix = new RegExp(`^https://github\\.com/${owner}/${repo}/blob/[^/]+/`, "i");

  const toRepoPath = (href) => {
    const url = new URL(href, `https://repo.invalid/${readmeDir}`);
    return { path: decodeURIComponent(url.pathname.slice(1)), hash: url.hash };
  };
  const readmePage = (path) => ctx.readmePages?.[path];

  const mapLink = (href) => {
    if (!href) return null;
    if (href.startsWith("#")) return href;
    if (/^https?:/i.test(href)) {
      const npm = /^https:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[^/]+\/)?[^/?#]+)\/?(?:[?#].*)?$/i.exec(href);
      if (npm && ctx.packagePages?.[npm[1]]) return ctx.packagePages[npm[1]];
      if (blobPrefix.test(href)) {
        const page = readmePage(href.replace(blobPrefix, "").replace(/[?#].*$/, ""));
        if (page) return page;
      }
      return href;
    }
    if (/^mailto:/i.test(href)) return href;
    if (/^[^/?#]*:/.test(href)) return null; // javascript:, data:, etc.
    const { path, hash } = toRepoPath(href);
    const page = readmePage(path);
    if (page) return page + hash;
    return `${ctx.repository}/blob/HEAD/${path}${hash}`;
  };

  const mapImage = (src) => {
    if (!src) return null;
    if (/^https:/i.test(src)) return src;
    if (/^[^/?#]*:/.test(src)) return null;
    const { path } = toRepoPath(src);
    if (!dir || path.startsWith(dir)) return ctx.cdnBase + path.slice(dir.length);
    return `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`;
  };

  const isLangSwitch = (token) =>
    token.type === "paragraph" &&
    token.tokens.some((t) => t.type === "link") &&
    token.tokens.every((t) =>
      t.type === "link"
        ? Boolean(readmePage(blobPrefix.test(t.href) ? t.href.replace(blobPrefix, "") : /^[a-z]+:/i.test(t.href) ? "" : toRepoPath(t.href).path))
        : t.type === "text" && SEPARATOR_TEXT.test(t.text),
    );

  const imageTag = (src, alt, title) => {
    const url = mapImage(src);
    if (!url || !isSafeUrl(url)) return esc(alt);
    return `<img src="${esc(url)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ""} loading="lazy">`;
  };

  const slug = makeSlugger();
  const toc = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = plainText(inner).trim();
        const id = slug(text);
        const level = Math.min(Math.max(depth, 2), 6);
        if (level === 2) toc.push({ id, text });
        return `<h${level} id="${esc(id)}">${inner}</h${level}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const url = mapLink(href);
        if (!url || !isSafeUrl(url)) return inner;
        return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ""}>${inner}</a>`;
      },
      image({ href, title, text }) {
        return imageTag(href, text, title);
      },
      code({ text, lang }) {
        const language = (lang ?? "").split(/\s/)[0];
        return `<pre><code${language ? ` class="language-${esc(language)}"` : ""}>${esc(text.replace(/\n$/, ""))}</code></pre>\n`;
      },
      // Raw HTML is never passed through. Images survive; other tags are dropped, text is escaped.
      html({ text, block }) {
        const source = text.replace(/<!--[\s\S]*?-->/g, "");
        if (!block) {
          if (/^<br\s*\/?>$/i.test(source.trim())) return "<br>";
          if (/^<img\b/i.test(source.trim())) return imageTag(attr(source, "src"), attr(source, "alt"));
          return "";
        }
        const images = [...source.matchAll(/<img\b[^>]*>/gi)].map((m) => imageTag(attr(m[0], "src"), attr(m[0], "alt")));
        const rest = source.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return [images.length ? `<p class="readme-figure">${images.join(" ")}</p>` : "", rest ? `<p>${esc(rest)}</p>` : ""].join("\n");
      },
    },
  });

  const tokens = marked.lexer(markdown);
  const firstContent = tokens.findIndex((t) => t.type !== "space");
  if (firstContent >= 0 && tokens[firstContent].type === "heading" && tokens[firstContent].depth === 1) tokens.splice(firstContent, 1);
  for (let i = tokens.length - 1; i >= 0; i--) if (isLangSwitch(tokens[i])) tokens.splice(i, 1);

  const html = marked
    .parser(tokens)
    .replaceAll("<table>", '<div class="table-wrap"><table>')
    .replaceAll("</table>", "</table></div>");
  return { html, toc };
}

// ---------------------------------------------------------------------------
// Derived plugin facts

const peerDsh = (manifest) =>
  Object.entries(manifest.peerDependencies ?? {}).find(([name]) => /^@deepseek-ai\/dsh-/.test(name))?.[1];

export function derive(catalog, data) {
  const byPackage = new Map(catalog.plugins.map((p) => [p.package, p]));
  const deps = new Map();
  for (const p of catalog.plugins) {
    const m = data[p.package].manifest;
    const names = Object.keys({ ...m.dependencies, ...m.peerDependencies }).filter((n) => byPackage.has(n) && n !== p.package);
    deps.set(p.package, names.sort());
  }
  const chain = (name, seen = new Set()) => {
    const out = [];
    for (const d of deps.get(name)) {
      if (seen.has(d)) continue;
      seen.add(d);
      out.push(...chain(d, seen), d);
    }
    return out;
  };
  return catalog.plugins.map((p) => {
    const d = data[p.package];
    const install = [...new Set([...chain(p.package), p.package])];
    return {
      ...p,
      npm: d,
      deps: deps.get(p.package).map((n) => byPackage.get(n)),
      dependents: catalog.plugins.filter((o) => deps.get(o.package).includes(p.package)),
      installPackages: install.map((n) => byPackage.get(n)),
      commands: install.map((n) => `dsh plugin --profile web add ${n}`),
      requires: { dsh: d.manifest.engines?.dsh ?? peerDsh(d.manifest), node: d.manifest.engines?.node },
      webUi: Boolean(d.manifest.dsh?.client),
      cdnBase: `https://cdn.jsdelivr.net/npm/${p.package}@${d.version}/`,
    };
  });
}

// ---------------------------------------------------------------------------
// Page chrome

function monogram(plugin) {
  const parts = plugin.slug.split("-");
  const letters = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0][0].toUpperCase() + parts[0][1];
  const color = CATEGORY_COLORS[plugin.category] ?? "#3c63e8";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect x="3" y="3" width="30" height="30" rx="8" fill="${color}"/><text x="18" y="23" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="13" font-weight="600" fill="#fff">${esc(letters)}</text></svg>\n`;
}

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="8" fill="#1d3fbf"/><path d="M11 9v5M21 9v5M8 14h16v3a8 8 0 0 1-16 0zM16 25v4" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>\n`;

const langPrefix = (lang) => (lang === "en" ? "en/" : "");

function head({ lang, title, description, root, path, altPath, catalog, assetVersion }) {
  const t = T[lang];
  const other = lang === "zh" ? "en" : "zh";
  return `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<link rel="canonical" href="${esc(catalog.siteUrl + path)}">
<link rel="alternate" hreflang="${T[lang].htmlLang}" href="${esc(catalog.siteUrl + path)}">
<link rel="alternate" hreflang="${T[other].htmlLang}" href="${esc(catalog.siteUrl + altPath)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="icon" href="${root}assets/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="${root}assets/site.css?v=${assetVersion}">
<script src="${root}assets/site.js?v=${assetVersion}" defer></script>
</head>
<body>
<a class="skip" href="#main">${t.skip}</a>
<header class="masthead">
<div class="wrap masthead-inner">
<a class="brand" href="${root}${langPrefix(lang) || "./"}"><img src="${root}assets/mark.svg" width="28" height="28" alt="">${esc(t.siteTitle)}</a>
<nav class="masthead-nav">
<a href="${root}${altPath}" hreflang="${T[other].htmlLang}" lang="${T[other].htmlLang}">${t.switchLabel}</a>
<a href="${esc(catalog.source)}">GitHub</a>
</nav>
</div>
</header>
`;
}

function foot({ lang, generatedAt, catalog, root }) {
  const t = T[lang];
  return `<footer class="site-foot">
<div class="wrap foot-inner">
<p>${esc(t.footerData(day(generatedAt)))}</p>
<ul>
<li><a href="${esc(catalog.source)}">${t.source}</a></li>
<li><a href="${esc(catalog.owner.npm)}">${t.npmProfile}</a></li>
<li><a href="${OFFICIAL_DOCS}${lang === "en" ? "en/" : ""}">${t.officialDocs}</a></li>
<li><a href="${root}plugins.json">plugins.json</a></li>
</ul>
</div>
</footer>
</body>
</html>
`;
}

const iconImg = (root, plugin, size) =>
  `<img class="icon" src="${root}assets/icons/${plugin.slug}.svg" width="${size}" height="${size}" alt="">`;

function copyButton(lang, commands, label) {
  return `<button type="button" class="copy" data-copy="${esc(commands.join("\n"))}" data-done="${lang === "zh" ? "已复制" : "Copied"}">${esc(label)}</button>`;
}

// ---------------------------------------------------------------------------
// Pages

function homePage(ctx, lang) {
  const { catalog, plugins } = ctx;
  const t = T[lang];
  const root = lang === "en" ? "../" : "";
  const path = langPrefix(lang);
  const pageFor = (p) => `${root}${langPrefix(lang)}plugins/${p.slug}/`;

  const sections = catalog.categories
    .map((c) => {
      const members = plugins.filter((p) => p.category === c.id);
      if (!members.length) return "";
      const rows = members
        .map((p) => {
          const needs = p.deps.length ? `<span class="needs">${esc(t.needs(p.deps.map((d) => d.title[lang]).join("、")))}</span>` : "";
          const haystack = [p.title.zh, p.title.en, p.package, p.summary[lang], c.title[lang]].join(" ").toLowerCase();
          return `<li class="row" data-search="${esc(haystack)}">
${iconImg(root, p, 40)}
<div class="row-text">
<h4><a class="row-link" href="${pageFor(p)}">${esc(p.title[lang])}</a></h4>
<code class="pkg">${esc(p.package)}</code>
<p>${esc(p.summary[lang])}</p>
</div>
<div class="row-meta">
<span class="ver">${esc(p.npm.version)}</span>
<span>${day(p.npm.modified)}</span>
${needs}
</div>
${copyButton(lang, p.commands, t.copy)}
</li>`;
        })
        .join("\n");
      return `<section class="shelf" aria-labelledby="cat-${c.id}">
<div class="shelf-head">
<h3 id="cat-${c.id}">${esc(c.title[lang])}</h3>
<p>${esc(c.summary[lang])}</p>
</div>
<ul class="rows">
${rows}
</ul>
</section>`;
    })
    .join("\n");

  const releases = plugins
    .flatMap((p) => p.npm.versions.map((v) => ({ p, ...v })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map(
      (r) => `<li><time datetime="${esc(r.date)}">${day(r.date)}</time><a href="${pageFor(r.p)}">${esc(r.p.title[lang])}</a><span class="ver">${esc(r.version)}</span></li>`,
    )
    .join("\n");

  return (
    head({ ...ctx, lang, root, path, altPath: lang === "zh" ? "en/" : "", title: t.siteTitle, description: t.heroLead(plugins.length) }) +
    `<main id="main">
<section class="hero">
<div class="wrap">
<h1>${esc(t.siteTitle)}</h1>
<p class="lede">${esc(t.heroLead(plugins.length))}</p>
<pre class="terminal hero-terminal" aria-label="${esc(t.install)}"><span class="prompt" aria-hidden="true">$</span> dsh plugin --profile web add <span class="arg">${esc(t.heroArg)}</span></pre>
<p class="hero-note">${esc(t.heroNote)}</p>
</div>
</section>
<section class="catalog wrap" aria-labelledby="catalog-title">
<div class="catalog-bar">
<h2 id="catalog-title">${t.catalog}</h2>
<div class="filter" hidden>
<label for="filter" class="sr-only">${t.filterLabel}</label>
<input id="filter" type="search" placeholder="${esc(t.filterPlaceholder)}" autocomplete="off" spellcheck="false">
<span class="count" data-template="${esc(t.count("{n}"))}" data-single="${esc(t.count(1))}" aria-live="polite">${esc(t.count(plugins.length))}</span>
</div>
</div>
${sections}
<p class="empty" hidden>${esc(t.empty)}</p>
</section>
<section class="releases wrap" aria-labelledby="releases-title">
<h2 id="releases-title">${t.recent}</h2>
<ol>
${releases}
</ol>
</section>
</main>
` +
    foot({ ...ctx, lang, root })
  );
}

function detailPage(ctx, plugin, lang) {
  const { catalog, plugins } = ctx;
  const t = T[lang];
  const root = lang === "en" ? "../../../" : "../../";
  const path = `${langPrefix(lang)}plugins/${plugin.slug}/`;
  const altPath = `${lang === "zh" ? "en/" : ""}plugins/${plugin.slug}/`;
  const pageFor = (p, l = lang) => `${root}${langPrefix(l)}plugins/${p.slug}/`;
  const category = catalog.categories.find((c) => c.id === plugin.category);
  const npm = plugin.npm;
  const dir = plugin.directory ? `${plugin.directory}/` : "";

  // README: prefer this language, fall back to the other one.
  const own = npm.readme[lang];
  const readme = own ?? npm.readme[lang === "zh" ? "en" : "zh"];
  const readmePages = {};
  for (const l of LANGS) readmePages[`${dir}${plugin.readme[l]}`] = pageFor(plugin, l);
  const packagePages = Object.fromEntries(plugins.map((p) => [p.package, pageFor(p)]));
  const rendered = readme
    ? renderReadme(readme.text, {
        repository: plugin.repository,
        directory: plugin.directory,
        readmePath: readme.path,
        cdnBase: plugin.cdnBase,
        readmePages,
        packagePages,
      })
    : { html: `<p>${t.readmeMissing}</p>`, toc: [] };
  const readmeNote = !readme ? "" : own ? t.readmeFrom(readme.path, npm.version) : t.readmeFallback;

  const list = (items) => items.map((p) => `<a href="${pageFor(p)}">${esc(p.title[lang])}</a>`).join("、");
  const license =
    npm.manifest.license === "SEE LICENSE IN LICENSE" && npm.files.includes("/LICENSE")
      ? `<a href="${plugin.cdnBase}LICENSE">${t.licenseFile}</a>`
      : esc(npm.manifest.license ?? "—");
  const facts = [
    [t.version, `<span class="ver">${esc(npm.version)}</span>`],
    [t.released, `<time datetime="${esc(npm.modified)}">${day(npm.modified)}</time>`],
    [t.firstPublished, `<time datetime="${esc(npm.created)}">${day(npm.created)}</time>`],
    plugin.requires.dsh && ["DSH", `<code>${esc(plugin.requires.dsh)}</code>`],
    plugin.requires.node && ["Node.js", `<code>${esc(plugin.requires.node)}</code>`],
    [t.type, esc(t.kind[plugin.kind] + (plugin.webUi ? (lang === "zh" ? "，" : ", ") + t.webUi : ""))],
    plugin.deps.length && [t.dependsOn, list(plugin.deps)],
    plugin.dependents.length && [t.usedBy, list(plugin.dependents)],
    [t.license, license],
  ]
    .filter(Boolean)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join("\n");

  const issues = npm.manifest.bugs?.url ?? `${plugin.repository}/issues`;
  const sourceUrl = plugin.directory ? `${plugin.repository}/tree/HEAD/${plugin.directory}` : plugin.repository;
  const toc =
    rendered.toc.length >= 3
      ? `<nav class="toc" aria-labelledby="toc-title"><h2 id="toc-title">${t.toc}</h2><ol>${rendered.toc
          .map((h) => `<li><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`)
          .join("")}</ol></nav>`
      : "";

  const shown = npm.versions.slice(0, 8);
  const history = `<ol class="history">${shown
    .map((v) => `<li><span class="ver">${esc(v.version)}</span><time datetime="${esc(v.date)}">${day(v.date)}</time></li>`)
    .join("")}</ol>${
    npm.versions.length > shown.length
      ? `<p class="small"><a href="https://www.npmjs.com/package/${plugin.package}?activeTab=versions">${esc(t.olderVersions(npm.versions.length - shown.length))}</a></p>`
      : ""
  }`;

  const related = plugins.filter((p) => p.category === plugin.category && p.slug !== plugin.slug);
  const relatedBlock = related.length
    ? `<section class="related wrap" aria-labelledby="related-title"><h2 id="related-title">${t.related}</h2><ul>${related
        .map((p) => `<li>${iconImg(root, p, 28)}<a href="${pageFor(p)}">${esc(p.title[lang])}</a><span>${esc(p.summary[lang])}</span></li>`)
        .join("")}</ul></section>`
    : "";

  return (
    head({ ...ctx, lang, root, path, altPath, title: `${plugin.title[lang]} · ${t.siteTitle}`, description: plugin.summary[lang] }) +
    `<main id="main">
<div class="wrap">
<nav class="crumbs" aria-label="breadcrumb"><a href="${root}${langPrefix(lang) || "./"}">${t.back}</a><span aria-hidden="true">/</span><a href="${root}${langPrefix(lang) || "./"}#cat-${category.id}">${esc(category.title[lang])}</a></nav>
<header class="plugin-head">
${iconImg(root, plugin, 64)}
<div>
<h1>${esc(plugin.title[lang])}</h1>
<code class="pkg">${esc(plugin.package)}</code>
<p class="lede">${esc(plugin.summary[lang])}</p>
</div>
</header>
<section class="install" aria-labelledby="install-title">
<h2 id="install-title">${t.install}</h2>
<div class="terminal-wrap">
<pre class="terminal">${plugin.commands.map((c) => `<span class="prompt" aria-hidden="true">$</span> ${esc(c)}`).join("\n")}</pre>
${copyButton(lang, plugin.commands, t.copyInstall)}
</div>
${plugin.deps.length ? `<p class="small">${t.installDeps(list(plugin.installPackages.filter((p) => p.slug !== plugin.slug)))}</p>` : ""}
<p class="small">${esc(t.heroNote)}</p>
</section>
<div class="plugin-body">
<aside class="facts" aria-labelledby="facts-title">
<h2 id="facts-title">${t.facts}</h2>
<dl>
${facts}
</dl>
<h2>${t.links}</h2>
<ul class="links">
<li><a href="https://www.npmjs.com/package/${plugin.package}">npm</a></li>
<li><a href="${esc(sourceUrl)}">${t.source}</a></li>
<li><a href="${esc(issues)}">${t.issues}</a></li>
</ul>
${toc}
<h2>${t.history}</h2>
${history}
</aside>
<article class="readme" aria-labelledby="about-title">
<h2 id="about-title" class="sr-only">${t.about}</h2>
${readmeNote ? `<p class="readme-note">${esc(readmeNote)}</p>` : ""}
${rendered.html}
</article>
</div>
</div>
${relatedBlock}
</main>
` +
    foot({ ...ctx, lang, root })
  );
}

function notFoundPage(ctx) {
  const root = new URL(ctx.catalog.siteUrl).pathname;
  const t = T.zh;
  const e = T.en;
  return (
    head({ ...ctx, lang: "zh", root, path: "404.html", altPath: "en/", title: t.notFoundTitle, description: t.notFoundBody }) +
    `<main id="main" class="wrap not-found">
<script>if (/\\/(zh\\/)?areas\\/|\\/(index|meta)\\.json$|\\/llms\\.txt$/.test(location.pathname) && !/\\/plugins\\.json$/.test(location.pathname)) location.replace(${JSON.stringify(OFFICIAL_DOCS)});</script>
<h1>${t.notFoundTitle}</h1>
<p>${t.notFoundBody}</p>
<p><a href="${root}">${t.notFoundHome}</a> · <a href="${OFFICIAL_DOCS}">${t.officialDocs}</a></p>
<p lang="en">${e.notFoundBody} <a href="${root}en/">${e.notFoundHome}</a></p>
</main>
` +
    foot({ ...ctx, lang: "zh", root })
  );
}

function pluginsJson(ctx) {
  const { catalog, plugins, generatedAt } = ctx;
  return `${JSON.stringify(
    {
      generatedAt,
      site: catalog.siteUrl,
      owner: catalog.owner,
      categories: catalog.categories,
      plugins: plugins.map((p) => ({
        slug: p.slug,
        package: p.package,
        category: p.category,
        kind: p.kind,
        title: p.title,
        summary: p.summary,
        version: p.npm.version,
        released: p.npm.modified,
        firstPublished: p.npm.created,
        requires: p.requires,
        dependsOn: p.deps.map((d) => d.package),
        install: p.commands,
        page: { zh: `${catalog.siteUrl}plugins/${p.slug}/`, en: `${catalog.siteUrl}en/plugins/${p.slug}/` },
        npm: `https://www.npmjs.com/package/${p.package}`,
        repository: p.repository,
        directory: p.directory || undefined,
      })),
    },
    null,
    2,
  )}\n`;
}

function llmsTxt(ctx) {
  const { catalog, plugins } = ctx;
  const lines = [
    "# klarkxy's DSH plugins",
    "",
    "> DeepSeek Harness plugins by klarkxy, published on npm. Install with `dsh plugin --profile <profile> add <package>`; install listed dependencies first.",
    "",
    `Machine-readable catalog: ${catalog.siteUrl}plugins.json`,
    "",
  ];
  for (const c of catalog.categories) {
    const members = plugins.filter((p) => p.category === c.id);
    if (!members.length) continue;
    lines.push(`## ${c.title.en}`, "");
    for (const p of members) {
      const deps = p.deps.length ? ` Depends on ${p.deps.map((d) => d.package).join(", ")}.` : "";
      lines.push(`- [${p.title.en}](${catalog.siteUrl}en/plugins/${p.slug}/): \`${p.package}@${p.npm.version}\`. ${p.summary.en}${deps}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Returns Map<relativePath, string>. */
export function renderSite(catalog, data, { generatedAt, assetVersion = "0" }) {
  validateCatalog(catalog);
  const plugins = derive(catalog, data);
  const ctx = { catalog, plugins, generatedAt, assetVersion };
  const out = new Map();
  for (const lang of LANGS) {
    out.set(`${langPrefix(lang)}index.html`, homePage(ctx, lang));
    for (const p of plugins) out.set(`${langPrefix(lang)}plugins/${p.slug}/index.html`, detailPage(ctx, p, lang));
  }
  for (const p of plugins) out.set(`assets/icons/${p.slug}.svg`, p.npm.icon ?? monogram(p));
  out.set("assets/mark.svg", MARK);
  out.set("404.html", notFoundPage(ctx));
  out.set("plugins.json", pluginsJson(ctx));
  out.set("llms.txt", llmsTxt(ctx));
  out.set(".nojekyll", "");
  return out;
}
