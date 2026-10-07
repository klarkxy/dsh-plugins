import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { test } from "node:test";

import { renderReadme, renderSite, validateCatalog } from "./render.mjs";

const catalog = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));

const ctx = {
  repository: "https://github.com/klarkxy/dsh-editor",
  directory: "packages/dsh-memory",
  readmePath: "README.md",
  assetPages: { "docs/shot.png": "../../assets/packages/memory/docs/shot.png", "docs/logo.png": "../../assets/packages/memory/docs/logo.png" },
  readmePages: { "packages/dsh-memory/docs/README.zh-CN.md": "../../plugins/memory/", "packages/dsh-memory/README.md": "./" },
  packagePages: { "@klarkxy/dsh-recap": "../recap/" },
};

test("README rendering drops the title and language switch, and rewrites links", () => {
  const { html, toc } = renderReadme(
    [
      "# @klarkxy/dsh-sample",
      "",
      "[简体中文](docs/README.zh-CN.md)",
      "",
      "Needs [Session Recap](https://www.npmjs.com/package/@klarkxy/dsh-recap) and [design](../../docs/design.md#limits).",
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
  assert.match(html, /href="\.\.\/recap\/"/);
  assert.match(html, /href="https:\/\/github\.com\/klarkxy\/dsh-editor\/blob\/HEAD\/docs\/design\.md#limits"/);
  assert.match(html, /src="\.\.\/\.\.\/assets\/packages\/memory\/docs\/shot\.png"/);
  assert.match(html, /src="https:\/\/raw\.githubusercontent\.com\/klarkxy\/dsh-editor\/HEAD\/assets\/x\.png"/);
  assert.match(html, /<div class="table-wrap"><table>/);
  assert.deepEqual(toc.map((h) => h.id), ["install", "install-1", "use-it"]);
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

function fixture() {
  const data = {};
  for (const [i, p] of catalog.plugins.entries()) {
    const deps = p.package === "@klarkxy/dsh-recap" ? { "@klarkxy/dsh-mood": "^0.1.0" } : {};
    data[p.package] = {
      name: p.package,
      version: `0.1.${i}`,
      created: "2026-01-01T00:00:00.000Z",
      modified: `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      versions: [{ version: `0.1.${i}`, date: `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }],
      manifest: { license: "SEE LICENSE IN LICENSE", engines: { dsh: "0.1.7-rc.2" }, peerDependencies: deps },
      files: ["/LICENSE", "/README.md"],
      readme: { en: { path: p.readme.en, text: `# ${p.package}\n\nSee [zh](${p.readme.zh}).\n\n## Usage\n\nText.` } },
      icon: i === 0 ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : undefined,
    };
  }
  return data;
}

test("site has every page, install order follows dependencies, and internal links resolve", () => {
  const files = renderSite(catalog, fixture(), { generatedAt: "2026-03-01T00:00:00.000Z" });
  for (const p of catalog.plugins) {
    assert.ok(files.has(`plugins/${p.slug}/index.html`), p.slug);
    assert.ok(files.has(`en/plugins/${p.slug}/index.html`), p.slug);
    assert.ok(files.has(`assets/icons/${p.slug}.svg`), p.slug);
  }
  const recap = files.get("plugins/recap/index.html");
  const dep = recap.indexOf("add @klarkxy/dsh-mood");
  assert.ok(dep > 0 && dep < recap.indexOf("add @klarkxy/dsh-recap"));
  assert.match(recap, /这个包没有中文 README/);
  assert.match(files.get("plugins/mood/index.html"), /被依赖/);

  const json = JSON.parse(files.get("plugins.json"));
  assert.equal(json.plugins.length, catalog.plugins.length);
  assert.deepEqual(json.plugins.find((p) => p.slug === "recap").dependsOn, ["@klarkxy/dsh-mood"]);
  assert.match(files.get("404.html"), /areas/);

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
  const item = catalog.plugins.find(plugin => plugin.slug === "recap");
  const pkg = data[item.package];
  pkg.assets = { "docs/a b.png": Buffer.from([0, 255, 127]).toString("base64"), LICENSE: Buffer.from("Published license").toString("base64") };
  pkg.readme.en = { path: "README.md", text: "# Recap\n\n## Usage\n\n![Example](docs/a%20b.png)\n\n[License](LICENSE#terms)" };
  const options = { generatedAt: "2026-10-01T00:00:00.000Z" };
  const files = renderSite(catalog, data, options);
  for (const [lang, root] of [["", "../../"], ["en/", "../../../"]]) {
    const html = files.get(`${lang}plugins/recap/index.html`);
    assert.ok(html.includes(`src="${root}assets/packages/recap/docs/a%20b.png"`));
    assert.ok(html.includes(`href="${root}assets/packages/recap/LICENSE#terms"`));
    assert.ok(html.includes(`href="${root}assets/packages/recap/LICENSE"`));
    assert.doesNotMatch(html, /jsdelivr/);
  }
  assert.deepEqual(files.get("assets/packages/recap/docs/a b.png"), Buffer.from([0, 255, 127]));
  assert.equal(files.get("assets/packages/recap/LICENSE").toString(), "Published license");
  pkg.assets["../escape.png"] = "AA==";
  assert.throws(() => renderSite(catalog, data, options), /Unsafe package asset path/);
});
