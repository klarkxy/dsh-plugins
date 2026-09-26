import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CSS = `body{margin:0 auto;max-width:52rem;padding:1.5rem;font:1rem/1.5 system-ui,sans-serif;color:#1c1917;background:#fafaf9}
a{color:#9a3412} code,pre{font-family:ui-monospace,monospace} pre{overflow:auto;padding:0.75rem;background:#f5f5f4}
table{border-collapse:collapse;width:100%} th,td{border:1px solid #d6d3d1;padding:0.35rem 0.5rem;vertical-align:top}
nav ul{padding-left:1.2rem} header{margin-bottom:1rem}
`;

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "../..");
const docsDir = resolve(repoRoot, "docs");
const outDir = resolve(process.argv[2] ?? docsDir);
const inPlace = outDir === docsDir;

const catalog = JSON.parse(await readFile(resolve(docsDir, "index.json"), "utf8"));
if (!/^[0-9a-f]{40}$/.test(catalog.indexed?.commit ?? "")) {
  throw new Error("docs/index.json indexed.commit must be a 40-character hex sha");
}
const commitUrl = `${catalog.indexed.repository}/tree/${catalog.indexed.commit}`;
const meta = {
  officialRepository: catalog.indexed.repository,
  officialTag: catalog.indexed.tag,
  officialCommit: catalog.indexed.commit,
};

if (!inPlace) {
  await rm(outDir, { recursive: true, force: true });
}
await mkdir(resolve(outDir, "areas"), { recursive: true });
await mkdir(resolve(outDir, "zh", "areas"), { recursive: true });
await mkdir(resolve(outDir, "assets"), { recursive: true });

if (!inPlace) {
  await writeFile(resolve(outDir, "index.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  for (const area of catalog.areas) {
    const markdown = await readFile(resolve(docsDir, area.file), "utf8");
    await writeFile(resolve(outDir, area.file), markdown);
    const zhMarkdown = await readFile(resolve(docsDir, area.fileZh), "utf8");
    await writeFile(resolve(outDir, area.fileZh), zhMarkdown);
  }
}

const zhAreas = [];
for (const area of catalog.areas) {
  const markdown = await readFile(resolve(docsDir, area.fileZh), "utf8");
  zhAreas.push({ ...area, ...parseZhPage(markdown, area.id), markdown });
}

await writeFile(resolve(outDir, ".nojekyll"), "");
await writeFile(resolve(outDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
await writeFile(resolve(outDir, "llms.txt"), renderLlms(catalog));
await writeFile(resolve(outDir, "zh/llms.txt"), renderLlmsZh(catalog, zhAreas));
await writeFile(resolve(outDir, "assets/site.css"), CSS);
await writeFile(resolve(outDir, "index.html"), renderIndex(catalog));
await writeFile(resolve(outDir, "zh/index.html"), renderIndexZh(catalog, zhAreas));

for (const area of catalog.areas) {
  const markdown = await readFile(resolve(docsDir, area.file), "utf8");
  await writeFile(
    resolve(outDir, `areas/${area.id}.html`),
    renderArea(area, markdown),
  );
}

for (const area of zhAreas) {
  await writeFile(resolve(outDir, `zh/areas/${area.id}.html`), renderAreaZh(area));
}

function renderLlms(value) {
  const lines = [
    "# DSH development index",
    "",
    `> Feature and extension-point index for DeepSeek Harness ${value.indexed.tag} (${value.indexed.commit}). For agents writing plugins, presets, patches, profiles, and providers. Do not invent APIs.`,
    "",
    `Source: ${value.indexed.repository}`,
    `Commit: ${value.indexed.commit}`,
    `Tag: ${value.indexed.tag}`,
    "",
    "## Docs",
    "",
    `- [Index JSON](${value.pagesBaseUrl}index.json): Machine-readable catalog of every area, summary, and official source path.`,
    `- [Recorded revision](${value.pagesBaseUrl}meta.json): officialRepository, officialTag, and officialCommit for the daily comparator.`,
    `- [Index](${value.pagesBaseUrl}index.html): Area list with stable anchors.`,
    `- [中文](${value.pagesBaseUrl}zh/llms.txt): Simplified Chinese mirror of the human-readable pages.`,
  ];
  for (const area of value.areas) {
    lines.push(`- [${area.title}](${value.pagesBaseUrl}${area.file}): ${area.summary}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderLlmsZh(value, areas) {
  const lines = [
    "# DSH 开发索引",
    "",
    `> DeepSeek Harness ${value.indexed.tag}（${value.indexed.commit}）的功能与扩展点索引。供编写插件、预设、补丁、profile 与 provider 的 agent 使用。不要发明 API。`,
    "",
    `来源：${value.indexed.repository}`,
    `提交：${value.indexed.commit}`,
    `标签：${value.indexed.tag}`,
    "",
    "## 文档",
    "",
    `- [English](${value.pagesBaseUrl}llms.txt)：人类可读页面的英文版。`,
    `- [索引 JSON](${value.pagesBaseUrl}index.json)：每个章节的 id、英文摘要和官方源路径。机器可读目录保持英文。`,
    `- [所记录的修订](${value.pagesBaseUrl}meta.json)：每日比对用的 officialRepository、officialTag 与 officialCommit。`,
    `- [索引](${value.pagesBaseUrl}zh/index.html)：带稳定锚点的章节列表。`,
  ];
  for (const area of areas) {
    lines.push(`- [${area.zhTitle}](${value.pagesBaseUrl}${area.fileZh})：${area.zhSummary}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderIndex(value) {
  const items = value.areas.map((area) => [
    `<li id="${escapeAttr(area.id)}">`,
    `<a href="areas/${area.id}.html">${escapeText(area.title)}</a>`,
    ` — ${escapeText(area.summary)}`,
    ` <a href="${escapeAttr(area.file)}">markdown</a>`,
    "</li>",
  ].join(""));
  return page({
    title: "DSH development index",
    lang: "en",
    css: "assets/site.css",
    alternate: { hreflang: "zh-CN", href: "zh/index.html" },
    body: [
      "<!-- agent: prefer index.json, llms.txt, meta.json, and areas/*.md; Chinese mirror is zh/ -->",
      `<script type="application/json" id="dsh-dev-index">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`,
      "<header>",
      `<p><a href="zh/index.html" lang="zh-CN">中文</a></p>`,
      `<p>Indexed against <a href="${escapeAttr(commitUrl)}">${escapeText(value.indexed.tag)}</a> <code>${escapeText(value.indexed.commit)}</code>.</p>`,
      `<p>Machine-readable: <a href="index.json">index.json</a> · <a href="meta.json">meta.json</a> · <a href="llms.txt">llms.txt</a></p>`,
      "</header>",
      "<main>",
      "<h1>DSH development index</h1>",
      "<p>DeepSeek Harness features and extension points for an agent doing secondary development. Each area cites official files at the pinned commit. The recorded revision is <a href=\"meta.json\">meta.json</a>.</p>",
      "<nav><ul>",
      ...items,
      "</ul></nav>",
      "</main>",
    ].join("\n"),
  });
}

function renderIndexZh(value, areas) {
  const items = areas.map((area) => [
    `<li id="${escapeAttr(area.id)}">`,
    `<a href="areas/${area.id}.html">${escapeText(area.zhTitle)}</a>`,
    ` — ${inline(area.zhSummary)}`,
    ` <a href="areas/${area.id}.md">Markdown</a>`,
    "</li>",
  ].join(""));
  return page({
    title: "DSH 开发索引",
    lang: "zh-CN",
    css: "../assets/site.css",
    alternate: { hreflang: "en", href: "../index.html" },
    body: [
      "<header>",
      `<p><a href="../index.html" lang="en">English</a></p>`,
      `<p>索引所对照的版本是 <a href="${escapeAttr(commitUrl)}">${escapeText(value.indexed.tag)}</a> <code>${escapeText(value.indexed.commit)}</code>。</p>`,
      `<p>机器可读文件仍为英文：<a href="../index.json">index.json</a> · <a href="../meta.json">meta.json</a> · 本目录的 <a href="llms.txt">llms.txt</a></p>`,
      "</header>",
      "<main>",
      "<h1>DSH 开发索引</h1>",
      "<p>这是给做二次开发的 agent 用的 DeepSeek Harness 功能与扩展点索引。每一章都引用上述固定提交里的官方文件。所记录的修订见 <a href=\"../meta.json\">meta.json</a>。</p>",
      "<p>先读索引，再打开对应章节。不要发明 API。</p>",
      "<nav><ul>",
      ...items,
      "</ul></nav>",
      "</main>",
    ].join("\n"),
  });
}

function renderArea(area, markdown) {
  return page({
    title: area.title,
    lang: "en",
    css: "../assets/site.css",
    alternate: { hreflang: "zh-CN", href: `../zh/areas/${area.id}.html` },
    body: [
      "<header>",
      `<p><a href="../zh/areas/${area.id}.html" lang="zh-CN">中文</a> · <a href="../index.html">Index</a> · <a href="../index.json">index.json</a> · <a href="../meta.json">meta.json</a> · <a href="${escapeAttr(area.file.slice("areas/".length))}">markdown</a></p>`,
      "</header>",
      "<article>",
      renderMarkdown(markdown),
      "</article>",
    ].join("\n"),
  });
}

function renderAreaZh(area) {
  return page({
    title: area.zhTitle,
    lang: "zh-CN",
    css: "../../assets/site.css",
    alternate: { hreflang: "en", href: `../../areas/${area.id}.html` },
    body: [
      "<header>",
      `<p><a href="../../areas/${area.id}.html" lang="en">English</a> · <a href="../index.html">索引</a> · <a href="../../index.json">index.json</a> · <a href="../../meta.json">meta.json</a> · <a href="${area.id}.md">Markdown</a></p>`,
      "</header>",
      "<article>",
      renderMarkdown(area.markdown),
      "</article>",
    ].join("\n"),
  });
}

function parseZhPage(markdown, id) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const heading = lines.find((line) => line.startsWith("# "));
  if (!heading) throw new Error(`docs/zh/areas/${id}.md is missing an h1`);
  const zhTitle = heading.slice(2).trim();
  if (!zhTitle) throw new Error(`docs/zh/areas/${id}.md has an empty h1`);
  const prose = [];
  let seenHeading = false;
  for (const line of lines) {
    if (!seenHeading) {
      if (line.startsWith("# ")) seenHeading = true;
      continue;
    }
    if (line.startsWith("## ")) break;
    if (/^\[English\]\(/.test(line)) continue;
    if (line.trim() === "") {
      if (prose.length > 0) break;
      continue;
    }
    prose.push(line.trim());
  }
  if (prose.length === 0) throw new Error(`docs/zh/areas/${id}.md is missing an opening paragraph`);
  return { zhTitle, zhSummary: prose.join(" ") };
}

function page({ title, lang, css, alternate, body }) {
  return [
    "<!DOCTYPE html>",
    `<html lang="${escapeAttr(lang)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeText(title)}</title>`,
    `<link rel="stylesheet" href="${escapeAttr(css)}">`,
    `<link rel="alternate" hreflang="${escapeAttr(alternate.hreflang)}" href="${escapeAttr(alternate.href)}">`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("```")) {
      const body = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(`<pre><code>${escapeText(body.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (index < lines.length && lines[index].startsWith("|")) {
        rows.push(lines[index]);
        index += 1;
      }
      html.push(renderTable(rows));
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      html.push(`<h${level} id="${escapeAttr(slug(text))}">${inline(text)}</h${level}>`);
      index += 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const items = [];
      while (index < lines.length && lines[index].startsWith("- ")) {
        items.push(`<li>${inline(lines[index].slice(2))}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\. /.test(lines[index])) {
        items.push(`<li>${inline(lines[index].replace(/^\d+\. /, ""))}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() !== "" && !blockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return html.join("\n");
}

function blockStart(line) {
  return line.startsWith("```") || line.startsWith("|") || line.startsWith("- ") || /^#{1,3} /.test(line) || /^\d+\. /.test(line);
}

function renderTable(rows) {
  const cells = rows
    .filter((row) => !row.includes("---"))
    .map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()));
  if (cells.length === 0) return "";
  const head = cells[0].map((cell) => `<th>${inline(cell)}</th>`).join("");
  const body = cells.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function inline(text) {
  const escaped = escapeText(text);
  return escaped
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const target = href.endsWith(".md") && !href.includes("://") ? href.replace(/\.md$/, ".html") : href;
      return `<a href="${escapeAttr(target)}">${label}</a>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
}

function escapeText(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}
