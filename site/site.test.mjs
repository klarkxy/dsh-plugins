import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { overlayLocalDocs } from "./local.mjs";
import { derive, marketIndex, renderReadme, renderSite, validateCatalog } from "./render.mjs";

const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));

const ctx = {
  repository: "https://github.com/klarkxy/dsh-editor",
  directory: "packages/dsh-memory",
  readmePath: "README.md",
  assetPages: { "docs/shot.png": "../../assets/packages/memory/docs/shot.png", "docs/logo.png": "../../assets/packages/memory/docs/logo.png" },
  readmePages: { "packages/dsh-memory/docs/README.zh-CN.md": "../../plugins/memory/", "packages/dsh-memory/README.md": "./" },
  packagePages: { "@klarkxy/dsh-zhihu": "../zhihu/" },
};

test("README rendering drops the title and language switch, and rewrites links", () => {
  const { html, toc } = renderReadme(
    [
      "# @klarkxy/dsh-sample",
      "",
      "[简体中文](docs/README.zh-CN.md)",
      "",
      "Needs [Zhihu](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) and [design](../../docs/design.md#limits).",
      "",
      "![shot](docs/shot.png) ![outside](../../assets/x.png)",
      "",
      "## Install",
      "## Install",
      "## Use `it`",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
    ].join("\n"),
    ctx,
  );
  assert.doesNotMatch(html, /<h1|简体中文/);
  assert.match(html, /href="\.\.\/zhihu\/"/);
  assert.match(html, /href="https:\/\/github\.com\/klarkxy\/dsh-editor\/blob\/HEAD\/docs\/design\.md#limits"/);
  assert.match(html, /src="\.\.\/\.\.\/assets\/packages\/memory\/docs\/shot\.png"/);
  assert.match(html, /src="https:\/\/raw\.githubusercontent\.com\/klarkxy\/dsh-editor\/HEAD\/assets\/x\.png"/);
  assert.match(html, /<div class="table-wrap"><table>/);
  assert.deepEqual(toc.map((h) => h.id), ["install", "install-1", "use-it"]);
});

test("README rendering strips zh-default and en-alternate language switchers", () => {
  const postCtx = {
    ...ctx,
    readmePages: {
      "packages/dsh-memory/README.md": "../../plugins/memory/",
      "packages/dsh-memory/README.en.md": "../../en/plugins/memory/",
    },
  };
  const zh = renderReadme(
    "# 插件\n\n<!-- release-state-note -->\n\n简体中文 / [English](README.en.md)\n\n## 用法\n\n正文。",
    { ...postCtx, readmePath: "README.md" },
  );
  assert.doesNotMatch(zh.html, /简体中文|English|README\.en\.md/);
  assert.match(zh.html, /正文。/);

  const en = renderReadme(
    "# Plugin\n\n<!-- release-state-note -->\n\n[简体中文](README.md) / English\n\n## Usage\n\nBody.",
    { ...postCtx, readmePath: "README.en.md" },
  );
  assert.doesNotMatch(en.html, /简体中文|English|README\.md/);
  assert.match(en.html, /Body\./);
});

test("README rendering never passes raw HTML or unsafe URLs through", () => {
  const { html } = renderReadme(
    [
      '<p align="center"><img src="docs/logo.png" alt="Logo" onerror="alert(1)"></p>',
      "",
      "<script>alert(1)</script>",
      "",
      "Inline <b onclick=x>bold</b> [bad](javascript:alert(1)) ![x](data:image/svg+xml,evil)",
      "",
      "```html",
      "<script>ok</script>",
      "```",
    ].join("\n"),
    ctx,
  );
  assert.doesNotMatch(html, /<script|onerror|onclick|javascript:|data:image/);
  assert.match(html, /<img src="\.\.\/\.\.\/assets\/packages\/memory\/docs\/logo\.png" alt="Logo"/);
  assert.match(html, /&lt;script&gt;ok&lt;\/script&gt;/);
});

test("catalog validation rejects duplicates and missing translations", () => {
  validateCatalog(catalog);
  const broken = structuredClone(catalog);
  broken.plugins[1].slug = broken.plugins[0].slug;
  delete broken.plugins[2].summary.en;
  assert.throws(() => validateCatalog(broken), /duplicate slug[\s\S]*missing summary\.en/);
});

test("the Git market index stays aligned with the catalog", () => {
  const market = JSON.parse(readFileSync(new URL("../index.json", import.meta.url), "utf8"));
  assert.equal(market.format, 1);
  assert.deepEqual(market.plugins.map((p) => p.name), catalog.plugins.filter((p) => p.kind !== "service").map((p) => p.package));
  for (const entry of market.plugins) {
    const plugin = catalog.plugins.find((p) => p.package === entry.name);
    assert.deepEqual(entry.title, plugin.title);
    assert.deepEqual(entry.description, plugin.summary);
    assert.equal(entry.metadata.category, plugin.category);
    assert.deepEqual(entry.repository, { url: plugin.repository, ...(plugin.directory ? { directory: plugin.directory } : {}) });
    assert.ok(entry.versions.length > 0);
    for (const version of entry.versions) {
      assert.equal(version.source.type, "npm");
      assert.ok(Number.isInteger(version.publishTimestamp) && version.publishTimestamp >= 0);
    }
  }
});

function fixture() {
  const data = {};
  for (const [i, p] of catalog.plugins.entries()) {
    const deps = p.package === "@klarkxy/dsh-zhihu" ? { "@klarkxy/dsh-web-search-manager": "^0.1.0" } : {};
    const runtimeDeps = p.package === "@klarkxy/dsh-dev-index" ? { "@klarkxy/dsh-plugin-kit": "0.3.4" } : {};
    data[p.package] = {
      name: p.package,
      version: `0.1.${i}`,
      created: "2026-01-01T00:00:00.000Z",
      modified: `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      versions: [{ version: `0.1.${i}`, date: `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }],
      manifest: {
        license: "SEE LICENSE IN LICENSE",
        engines: { dsh: "0.1.7-rc.2" },
        dependencies: runtimeDeps,
        peerDependencies: deps,
        keywords: [p.slug],
        ...(p.kind === "service" ? {} : { dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
      },
      files: ["/LICENSE", "/README.md"],
      readme: { en: { path: p.readme.en, text: `# ${p.package}\n\nSee [zh](${p.readme.zh}).\n\n## Usage\n\nText.` } },
      icon: i === 0 ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : undefined,
    };
  }
  return data;
}

test("install commands cover the plugin and its required peers; dependencies come along", () => {
  const data = fixture();
  const files = renderSite(catalog, data, { generatedAt: "2026-03-01T00:00:00.000Z" });
  for (const p of catalog.plugins) {
    assert.ok(files.has(`plugins/${p.slug}/index.html`), p.slug);
    assert.ok(files.has(`en/plugins/${p.slug}/index.html`), p.slug);
    assert.ok(files.has(`assets/icons/${p.slug}.svg`), p.slug);
  }
  // A required peer from the catalog is not installed for us, so it keeps its own command.
  const zhihu = files.get("plugins/zhihu/index.html");
  const dep = zhihu.indexOf("add @klarkxy/dsh-web-search-manager");
  assert.ok(dep > 0 && dep < zhihu.indexOf("add @klarkxy/dsh-zhihu"));
  assert.match(zhihu, /这个插件需要先装/);
  assert.match(zhihu, /这个包没有中文 README/);
  assert.match(files.get("plugins/web-search-manager/index.html"), /被依赖/);

  // A plain dependency is installed by `pnpm add`, so only the plugin itself is spelled out.
  const docs = files.get("plugins/dev-index/index.html");
  assert.match(docs, /dsh plugin --profile web add @klarkxy\/dsh-dev-index/);
  assert.doesNotMatch(docs, /add @klarkxy\/dsh-plugin-kit/);
  assert.match(docs, /这个插件依赖 <a href="[^"]*">插件共享库<\/a>，安装时会自动一起装上/);
  assert.match(files.get("en/plugins/dev-index/index.html"), /they are installed with it automatically/);

  const optionalPeer = "@klarkxy/dsh-plugin-kit";
  data["@klarkxy/dsh-dev-index"].manifest = {
    ...data["@klarkxy/dsh-dev-index"].manifest,
    dependencies: {},
    peerDependencies: { [optionalPeer]: ">=0.1.0" },
    peerDependenciesMeta: { [optionalPeer]: { optional: true } },
  };
  const optionalPage = renderSite(catalog, data, { generatedAt: "2026-03-01T00:00:00.000Z" }).get("plugins/dev-index/index.html");
  assert.doesNotMatch(optionalPage, /add @klarkxy\/dsh-plugin-kit/);
  assert.doesNotMatch(optionalPage, /自动一起装上/);

  const json = JSON.parse(files.get("plugins.json"));
  assert.equal(json.plugins.length, catalog.plugins.length);
  const market = JSON.parse(files.get("index.json"));
  assert.equal(market.format, 1);
  assert.equal(market.title.en, "klarkxy's DSH plugins");
  assert.deepEqual(market.plugins.map((p) => p.name), catalog.plugins.filter((p) => p.kind !== "service").map((p) => p.package));
  const zhihuMarket = market.plugins.find((p) => p.name === "@klarkxy/dsh-zhihu");
  assert.equal(zhihuMarket.metadata.category, "models");
  assert.deepEqual(zhihuMarket.metadata.keywords, ["zhihu"]);
  assert.equal(zhihuMarket.versions[0].publishTimestamp, Math.floor(Date.parse(data["@klarkxy/dsh-zhihu"].modified) / 1000));
  assert.equal(zhihuMarket.versions[0].engines.dsh, "0.1.7-rc.2");
  assert.equal(zhihuMarket.repository.directory, "plugins/dsh-zhihu");
  assert.deepEqual(Object.keys(market.metadata.categories).sort(), [...new Set(market.plugins.map((p) => p.metadata.category))].sort());
  data["@klarkxy/dsh-zhihu"].versions.push({ version: "0.0.1", date: "not-a-date" });
  assert.deepEqual(
    JSON.parse(marketIndex({ catalog, plugins: derive(catalog, data) }))
      .plugins.find((p) => p.name === "@klarkxy/dsh-zhihu").versions.map((v) => v.version),
    [zhihuMarket.versions[0].version],
  );
  data["@klarkxy/dsh-zhihu"].versions.unshift({ version: "9.9.9", date: "2026-03-01T00:00:00.000Z" });
  const historical = JSON.parse(marketIndex({ catalog, plugins: derive(catalog, data) }))
    .plugins.find((p) => p.name === "@klarkxy/dsh-zhihu");
  assert.deepEqual(historical.versions.map((v) => v.version), [zhihuMarket.versions[0].version]);
  assert.equal(historical.versions.some((v) => v.version === "9.9.9"), false);
  assert.deepEqual(json.plugins.find((p) => p.slug === "zhihu").dependsOn, ["@klarkxy/dsh-web-search-manager"]);
  assert.deepEqual(json.plugins.find((p) => p.slug === "dev-index").dependsOn, ["@klarkxy/dsh-plugin-kit"]);
  assert.deepEqual(json.plugins.find((p) => p.slug === "dev-index").install, ["dsh plugin --profile web add @klarkxy/dsh-dev-index"]);
  assert.match(files.get("404.html"), /areas/);
  assert.match(files.get("llms.txt"), /index\.json/);

  // Home chrome: category nav with counts, stats, market URL, prerequisite note, and a link to the timeline.
  const home = files.get("index.html");
  assert.match(home, /class="catnav"/);
  assert.match(home, /class="hero-market"/);
  assert.match(home, /自定义插件市场/);
  assert.match(files.get("en/index.html"), /Custom Plugin Market/);
  assert.match(home, /data-category="workflow"/);
  assert.match(home, /hero-stats/);
  assert.match(home, /href="changelog\/"/);

  // Changelog pages exist in both languages and list every fixture version.
  for (const langPrefix of ["", "en/"]) {
    const page = files.get(`${langPrefix}changelog/index.html`);
    assert.ok(page, `${langPrefix}changelog`);
    for (const [i, p] of catalog.plugins.entries()) assert.match(page, new RegExp(`>${p.title[langPrefix ? "en" : "zh"]}</a><span class="ver">0\\.1\\.${i}<`));
  }

  // Assets written by build.mjs, not render.mjs.
  const known = new Set([...files.keys(), "assets/site.css", "assets/site.js"]);
  const missing = [];
  for (const [path, content] of files) {
    if (!path.endsWith(".html") || path === "404.html") continue;
    for (const [, url] of content.matchAll(/(?:href|src)="([^"#?]*)[^"]*"/g)) {
      if (!url || /^[a-z]+:/i.test(url)) continue;
      let target = posix.normalize(posix.join(posix.dirname(path), url));
      if (url.endsWith("/") || target === ".") target = posix.join(target, "index.html");
      if (!known.has(target)) missing.push(`${path} -> ${url}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("both languages serve package images and licenses from relative local assets", () => {
  const data = fixture();
  const item = catalog.plugins.find(plugin => plugin.slug === "zhihu");
  const pkg = data[item.package];
  pkg.assets = { "docs/a b.png": Buffer.from([0, 255, 127]).toString("base64"), LICENSE: Buffer.from("Published license").toString("base64") };
  pkg.readme.en = { path: "README.md", text: "# Zhihu\n\n## Usage\n\n![Example](docs/a%20b.png)\n\n[License](LICENSE#terms)" };
  const options = { generatedAt: "2026-10-01T00:00:00.000Z" };
  const files = renderSite(catalog, data, options);
  for (const [lang, root] of [["", "../../"], ["en/", "../../../"]]) {
    const html = files.get(`${lang}plugins/zhihu/index.html`);
    assert.ok(html.includes(`src="${root}assets/packages/zhihu/docs/a%20b.png"`));
    assert.ok(html.includes(`href="${root}assets/packages/zhihu/LICENSE#terms"`));
    assert.ok(html.includes(`href="${root}assets/packages/zhihu/LICENSE"`));
    assert.doesNotMatch(html, /jsdelivr/);
  }
  assert.deepEqual(files.get("assets/packages/zhihu/docs/a b.png"), Buffer.from([0, 255, 127]));
  assert.equal(files.get("assets/packages/zhihu/LICENSE").toString(), "Published license");
  // Standard SPDX license IDs (e.g. Apache-2.0) also link to assetPages.LICENSE when shipped.
  const deepViewPkg = data["@klarkxy/dsh-deep-view"];
  deepViewPkg.manifest = { ...deepViewPkg.manifest, license: "Apache-2.0" };
  deepViewPkg.assets = { LICENSE: Buffer.from("Apache License 2.0").toString("base64") };
  const spdxFiles = renderSite(catalog, data, options);
  assert.ok(spdxFiles.get("plugins/deep-view/index.html").includes('<a href="../../assets/packages/deep-view/LICENSE">Apache-2.0</a>'));
  assert.ok(spdxFiles.get("en/plugins/deep-view/index.html").includes('<a href="../../../assets/packages/deep-view/LICENSE">Apache-2.0</a>'));
  assert.equal(spdxFiles.get("assets/packages/deep-view/LICENSE").toString(), "Apache License 2.0");

  pkg.assets["../escape.png"] = "AA==";
  assert.throws(() => renderSite(catalog, data, options), /Unsafe package asset path/);
});

test("detail pages strip language switchers for both post-flip and pre-flip tarballs", () => {
  const data = fixture();
  const gitCommit = data["@klarkxy/dsh-git-commit"];
  gitCommit.readme = {
    zh: { path: "README.md", text: "# Git 提交\n\n<!-- release-state-note -->\n\n简体中文 / [English](README.en.md)\n\n## 用法\n\n中文用法说明。" },
    en: { path: "README.en.md", text: "# Git Commit\n\n<!-- release-state-note -->\n\n[简体中文](README.md) / English\n\n## Usage\n\nUsage guide body." },
  };
  const zhihu = data["@klarkxy/dsh-zhihu"];
  zhihu.readme = {
    zh: { path: "docs/README.zh-CN.md", text: "# 知乎\n\n[English](../README.md)\n\n## 用法\n\n旧版中文用法。" },
    en: { path: "README.md", text: "# Zhihu\n\n[简体中文](docs/README.zh-CN.md)\n\n## Usage\n\nLegacy usage body." },
  };
  const files = renderSite(catalog, data, { generatedAt: "2026-03-01T00:00:00.000Z" });
  const body = (html) => {
    const start = html.indexOf('<article class="readme"');
    return html.slice(start, html.indexOf("</article>", start));
  };
  for (const [slug, zhNeedle, enNeedle] of [
    ["git-commit", "中文用法说明", "Usage guide body"],
    ["zhihu", "旧版中文用法", "Legacy usage body"],
  ]) {
    const zhBody = body(files.get(`plugins/${slug}/index.html`));
    const enBody = body(files.get(`en/plugins/${slug}/index.html`));
    assert.match(zhBody, new RegExp(zhNeedle));
    assert.match(enBody, new RegExp(enNeedle));
    assert.doesNotMatch(zhBody, /简体中文|English|README\./);
    assert.doesNotMatch(enBody, /简体中文|English|README\./);
  }
});

test("stripSiteChrome strips redundant chrome blocks while keeping special cases", () => {
  const stripCtx = {
    ...ctx,
    readmePages: {
      ...ctx.readmePages,
      "packages/dsh-memory/README.en.md": "../../en/plugins/memory/",
    },
  };
  const full = renderReadme(
    [
      "# 插件",
      "",
      "<!-- release-state-note -->",
      "",
      "简体中文 / [English](README.en.md)",
      "",
      "定位简介。",
      "",
      "## 演示",
      "",
      "![demo](docs/shot.png)",
      "",
      "## 安装",
      "",
      "```sh\ndsh plugin --profile web add @klarkxy/dsh-sample\n```",
      "",
      "## 从 GitHub 安装",
      "",
      "特殊安装步骤。",
      "",
      "## 使用",
      "",
      "使用说明。",
      "",
      "## 署名",
      "",
      "致谢 [NOTICE](NOTICE)。",
      "",
      "## 许可证",
      "",
      "[SATA License 2.1](LICENSE)",
    ].join("\n"),
    { ...stripCtx, stripSiteChrome: true },
  );
  assert.doesNotMatch(full.html, /定位简介|dsh-sample|SATA License/);
  assert.match(full.html, /<img[^>]+docs\/shot\.png/);
  assert.doesNotMatch(full.html, /id="演示"/);
  assert.match(full.html, /从 GitHub 安装/);
  assert.match(full.html, /使用说明/);
  assert.match(full.html, /署名/);
  assert.deepEqual(full.toc.map((h) => h.text), ["从 GitHub 安装", "使用", "署名"]);

  // Sole paragraph (shared library style) is kept, even with a Downloads chart section.
  const sole = renderReadme("# Kit\n\n<!-- release-state-note -->\n\nShared runtime helpers.\n\n## License\n\n[SATA](LICENSE)", { ...ctx, stripSiteChrome: true });
  assert.match(sole.html, /Shared runtime helpers/);
  assert.doesNotMatch(sole.html, /License/);

  const soleWithChart = renderReadme(
    "# Kit\n\nShared runtime helpers.\n\n## Downloads\n\n[![chart](https://example.com/a.svg)](https://www.npmjs.com/package/@klarkxy/dsh-kit)\n\n## License\n\n[SATA](LICENSE)",
    { ...ctx, stripSiteChrome: true },
  );
  assert.match(soleWithChart.html, /Shared runtime helpers/);
  assert.match(soleWithChart.html, /Downloads/);
  assert.doesNotMatch(soleWithChart.html, /License/);

  // Lead ending in colon / introducing a list is kept.
  const listIntro = renderReadme("# Sidebar\n\nSwitch between modes:\n\n- Push\n- Drawer\n\n## Install\n\nSkip.", { ...ctx, stripSiteChrome: true });
  assert.match(listIntro.html, /Switch between modes/);
  assert.match(listIntro.html, /Drawer/);
  assert.doesNotMatch(listIntro.html, /Skip/);

  // Second background paragraph is kept after lead summary is stripped; License mentioning NOTICE is kept.
  const multi = renderReadme("# Prompt\n\nSummary.\n\nBackground context.\n\n## Usage\n\nBody.\n\n## License\n\nApache 2.0. See [NOTICE](NOTICE).", { ...ctx, stripSiteChrome: true });
  assert.doesNotMatch(multi.html, /Summary/);
  assert.match(multi.html, /Background context/);
  assert.match(multi.html, /Apache 2\.0/);

  // Leading image paragraph without a heading is preserved.
  const leadImg = renderReadme("# Font\n\nSummary.\n\n![preview](docs/shot.png)\n\n## Usage\n\nPick fonts.", { ...ctx, stripSiteChrome: true });
  assert.doesNotMatch(leadImg.html, /Summary/);
  assert.match(leadImg.html, /docs\/shot\.png/);
});

test("overlayLocalDocs overlays in-repo READMEs, referenced assets, and legal files safely", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dsh-site-local-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outside = join(root, "outside");
  mkdirSync(join(outside), { recursive: true });
  writeFileSync(join(outside, "secret.png"), "secret");

  const repo = join(root, "repo");
  const pkgDir = join(repo, "plugins", "dsh-alpha");
  mkdirSync(join(pkgDir, "screenshots"), { recursive: true });
  mkdirSync(join(pkgDir, "docs"), { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@klarkxy/dsh-alpha" }));
  writeFileSync(join(pkgDir, "LICENSE"), "Local license");
  writeFileSync(join(pkgDir, "NOTICE.md"), "Local notice");
  writeFileSync(join(pkgDir, "screenshots", "zh.png"), Buffer.from([1, 2, 3]));
  writeFileSync(join(pkgDir, "screenshots", "unused.mp4"), Buffer.from([4, 5, 6]));
  writeFileSync(join(pkgDir, "docs", "en.png"), Buffer.from([7, 8, 9]));
  writeFileSync(
    join(pkgDir, "README.md"),
    "# Alpha\n\nLocal zh.\n\n![zh](screenshots/zh.png)\n\n![escape](../../../outside/secret.png)\n\n[Notice](NOTICE.md)\n",
  );
  writeFileSync(join(pkgDir, "README.en.md"), "# Alpha\n\nLocal en.\n\n![en](docs/en.png)\n");

  const miniCatalog = {
    source: "https://github.com/klarkxy/dsh-plugins",
    plugins: [
      {
        slug: "alpha",
        package: "@klarkxy/dsh-alpha",
        readme: { zh: "README.md", en: "README.en.md" },
        repository: "https://github.com/klarkxy/dsh-plugins",
        directory: "plugins/dsh-alpha",
      },
      {
        slug: "external",
        package: "@other/dsh-external",
        readme: { zh: "README.md", en: "README.en.md" },
        repository: "https://github.com/other/repo",
        directory: "plugins/dsh-alpha",
      },
    ],
  };
  const pkgData = {
    "@klarkxy/dsh-alpha": { readme: { zh: { path: "README.md", text: "Old" } }, files: [], assets: {} },
    "@other/dsh-external": { readme: { zh: { path: "README.md", text: "Remote" } }, files: [], assets: {} },
  };
  overlayLocalDocs(miniCatalog, pkgData, repo);

  const alpha = pkgData["@klarkxy/dsh-alpha"];
  assert.match(alpha.readme.zh.text, /Local zh/);
  assert.match(alpha.readme.en.text, /Local en/);
  assert.deepEqual(Buffer.from(alpha.assets["screenshots/zh.png"], "base64"), Buffer.from([1, 2, 3]));
  assert.deepEqual(Buffer.from(alpha.assets["docs/en.png"], "base64"), Buffer.from([7, 8, 9]));
  assert.equal(Buffer.from(alpha.assets.LICENSE, "base64").toString(), "Local license");
  assert.equal(Buffer.from(alpha.assets["NOTICE.md"], "base64").toString(), "Local notice");
  assert.equal(alpha.assets["screenshots/unused.mp4"], undefined);
  assert.ok(!Object.keys(alpha.assets).some((k) => k.includes("secret.png")));
  assert.ok(alpha.files.includes("/screenshots/zh.png"));
  assert.equal(pkgData["@other/dsh-external"].readme.zh.text, "Remote");
});

test("real workspace READMEs render cleanly with local overlay and stripSiteChrome", () => {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const data = fixture();
  overlayLocalDocs(catalog, data, repoRoot);
  const files = renderSite(catalog, data, { generatedAt: "2026-03-01T00:00:00.000Z" });
  const known = new Set([...files.keys(), "assets/site.css", "assets/site.js"]);
  const missing = [];

  for (const p of catalog.plugins) {
    for (const langPrefix of ["", "en/"]) {
      const pagePath = `${langPrefix}plugins/${p.slug}/index.html`;
      const html = files.get(pagePath);
      assert.ok(html, pagePath);
      assert.doesNotMatch(html, /class="readme-note"/, `${pagePath} has local translation`);
      const articleStart = html.indexOf('<article class="readme"');
      const article = html.slice(articleStart, html.indexOf("</article>", articleStart));
      assert.match(article, /<(?:p|ul|ol|table|img)\b/, `${pagePath} renders non-empty README body`);
      assert.ok(!article.includes(`dsh plugin --profile web add ${p.package}`), `${pagePath} strips standard install command`);
    }
  }
  for (const [path, content] of files) {
    if (!path.endsWith(".html") || path === "404.html") continue;
    for (const [, url] of content.matchAll(/(?:href|src)="([^"#?]*)[^"]*"/g)) {
      if (!url || /^[a-z]+:/i.test(url)) continue;
      let target = posix.normalize(posix.join(posix.dirname(path), url));
      if (url.endsWith("/") || target === ".") target = posix.join(target, "index.html");
      if (!known.has(target)) missing.push(`${path} -> ${url}`);
    }
  }
  assert.match(files.get("plugins/plugin-kit/index.html"), /共享能力|支撑库/);
  assert.match(files.get("en/plugins/model-route/index.html"), /provider, model, and reasoning-effort settings/);
  // Plugin-specific update, reload, and activation notes survive stripSiteChrome on real READMEs.
  const articleHtml = (page) => {
    const html = files.get(page);
    const start = html.indexOf('<article class="readme"');
    return html.slice(start, html.indexOf("</article>", start));
  };
  assert.match(articleHtml("plugins/web-search-manager/index.html"), /更新插件后需重启 profile.*设置 → 网页搜索/);
  assert.match(articleHtml("en/plugins/web-search-manager/index.html"), /updating the plugin.*Settings → Web Search/);
  assert.match(articleHtml("plugins/deep-view/index.html"), /刷新页面.*Host 与 Web Client/);
  assert.match(articleHtml("en/plugins/deep-view/index.html"), /reload the page.*Host and Web Client/);
  assert.match(articleHtml("plugins/delegation/index.html"), /启用插件.*刷新页面或重启 profile/);
  assert.match(articleHtml("en/plugins/delegation/index.html"), /enabling the plugin.*reloading the page or restarting the profile/);
  assert.deepEqual(missing, []);

  // Verify real dsh-deep-view LICENSE overlay with its published Apache-2.0 SPDX license.
  data["@klarkxy/dsh-deep-view"].manifest = { ...data["@klarkxy/dsh-deep-view"].manifest, license: "Apache-2.0" };
  const spdxRendered = renderSite(catalog, data, { generatedAt: "2026-03-01T00:00:00.000Z" });
  assert.ok(spdxRendered.get("plugins/deep-view/index.html").includes('<a href="../../assets/packages/deep-view/LICENSE">Apache-2.0</a>'));
  assert.ok(spdxRendered.get("en/plugins/deep-view/index.html").includes('<a href="../../../assets/packages/deep-view/LICENSE">Apache-2.0</a>'));
});
