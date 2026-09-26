import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CSS = `:root{color-scheme:light dark;--bg:#f8fafc;--panel:#fff;--ink:#17212f;--muted:#526174;--line:#d8e1ec;--link:#245ab0;--code:#edf2f8}
@media(prefers-color-scheme:dark){:root{--bg:#11161e;--panel:#1b2330;--ink:#e9edf4;--muted:#abb8ca;--line:#344255;--link:#8bb9ff;--code:#263244}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}
header,main,article{max-width:76rem;margin-inline:auto;padding-inline:clamp(16px,4vw,48px)}header{padding-block:16px;border-bottom:1px solid var(--line);color:var(--muted);font-size:14px}header p{margin:.2rem 0}
main{padding-block:30px 70px}article{max-width:80ch;padding-block:26px 70px}h1{font-size:clamp(28px,4vw,38px);line-height:1.2;letter-spacing:-.025em;margin:.1em 0 .6em}h2{font-size:1.4rem;margin-top:2.3rem;border-bottom:1px solid var(--line);padding-bottom:.35rem}h3{font-size:1.1rem;margin-top:1.8rem}
p,li{overflow-wrap:anywhere}a{color:var(--link);text-underline-offset:3px}a:hover{text-decoration-thickness:2px}a:focus-visible{outline:2px solid var(--link);outline-offset:3px;border-radius:2px}header code{font-size:12px}code,pre{font-family:ui-monospace,"Cascadia Code",Consolas,monospace}code{background:var(--code);border-radius:3px;padding:.08em .25em}pre{overflow:auto;padding:16px;background:var(--code);border-radius:8px}pre code{padding:0}
nav ul{list-style:none;margin:28px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr));gap:12px}nav li{border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:16px 18px;color:var(--muted)}nav li>a:first-child{display:block;color:var(--ink);font-size:1.05rem;font-weight:650;text-decoration:none;margin-bottom:5px}nav li>a:first-child:hover{text-decoration:underline}nav li>a:last-child{display:inline-block;margin-top:8px;font-size:13px}
table{display:block;overflow-x:auto;border-collapse:collapse;max-width:100%}th,td{border:1px solid var(--line);padding:8px 10px;vertical-align:top}th{background:var(--code);text-align:left}article ul,article ol{padding-left:1.4em}article li+li{margin-top:.35em}@media(max-width:600px){header,main,article{padding-inline:18px}header code{overflow-wrap:anywhere}nav ul{grid-template-columns:1fr}}
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
      `<p>Indexed against <a href="${escapeAttr(commitUrl)}" target="_blank" rel="noopener noreferrer">${escapeText(value.indexed.tag)}</a> <code>${escapeText(value.indexed.commit)}</code>.</p>`,
      `<p>Machine-readable: <a href="index.json">index.json</a> · <a href="meta.json">meta.json</a> · <a href="llms.txt">llms.txt</a></p>`,
      "</header>",
      "<main>",
      "<h1>DSH development index</h1>",
      "<p>Browse DeepSeek Harness features and extension points. Each chapter links to the official source at the recorded revision.</p>",
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
      `<p>索引所对照的版本是 <a href="${escapeAttr(commitUrl)}" target="_blank" rel="noopener noreferrer">${escapeText(value.indexed.tag)}</a> <code>${escapeText(value.indexed.commit)}</code>。</p>`,
      `<p>机器可读文件仍为英文：<a href="../index.json">index.json</a> · <a href="../meta.json">meta.json</a> · 本目录的 <a href="llms.txt">llms.txt</a></p>`,
      "</header>",
      "<main>",
      "<h1>DSH 开发索引</h1>",
      "<p>浏览 DeepSeek Harness 的功能与扩展点。每个章节都附有对应版本的官方源码链接，方便核对接口。</p>",
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
      const external = /^https?:\/\//.test(target) ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${escapeAttr(target)}"${external}>${label}</a>`;
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
