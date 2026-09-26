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
if (typeof catalog.officialDocsSite !== "string" || !catalog.officialDocsSite.endsWith("/")) {
  throw new Error("docs/index.json officialDocsSite must be an absolute URL with a trailing slash");
}
const meta = {
  officialRepository: catalog.indexed.repository,
  officialTag: catalog.indexed.tag,
  officialCommit: catalog.indexed.commit,
  officialDocsSite: catalog.officialDocsSite,
};

if (!inPlace) {
  await rm(outDir, { recursive: true, force: true });
}
await mkdir(resolve(outDir, "areas"), { recursive: true });
await mkdir(resolve(outDir, "zh", "areas"), { recursive: true });
await mkdir(resolve(outDir, "tasks"), { recursive: true });
await mkdir(resolve(outDir, "zh", "tasks"), { recursive: true });
await mkdir(resolve(outDir, "assets"), { recursive: true });

const docEntries = [...catalog.areas, ...catalog.tasks, ...catalog.guides];

if (!inPlace) {
  await writeFile(resolve(outDir, "index.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  const copies = [
    ...docEntries.flatMap((entry) => [entry.file, entry.fileZh]),
    "tasks/index.md",
    "zh/tasks/index.md",
    "REFRESH.md",
  ];
  for (const rel of copies) {
    const markdown = await readFile(resolve(docsDir, rel), "utf8");
    await writeFile(resolve(outDir, rel), markdown);
  }
}

const zhAreas = [];
for (const area of catalog.areas) {
  const markdown = await readFile(resolve(docsDir, area.fileZh), "utf8");
  zhAreas.push({ ...area, ...parseZhPage(markdown, area.fileZh), markdown });
}

const zhTasks = [];
for (const task of catalog.tasks) {
  const markdown = await readFile(resolve(docsDir, task.fileZh), "utf8");
  zhTasks.push({ ...task, ...parseZhPage(markdown, task.fileZh), markdown });
}

const zhGuides = [];
for (const guide of catalog.guides) {
  const markdown = await readFile(resolve(docsDir, guide.fileZh), "utf8");
  zhGuides.push({ ...guide, ...parseZhPage(markdown, guide.fileZh), markdown });
}

await writeFile(resolve(outDir, ".nojekyll"), "");
await writeFile(resolve(outDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
await writeFile(resolve(outDir, "llms.txt"), renderLlms(catalog));
await writeFile(resolve(outDir, "zh/llms.txt"), renderLlmsZh(catalog, zhAreas, zhTasks, zhGuides));
await writeFile(resolve(outDir, "assets/site.css"), CSS);
await writeFile(resolve(outDir, "index.html"), renderIndex(catalog));
await writeFile(resolve(outDir, "zh/index.html"), renderIndexZh(catalog, zhAreas, zhTasks, zhGuides));

for (const area of catalog.areas) {
  const markdown = await readFile(resolve(docsDir, area.file), "utf8");
  await writeFile(resolve(outDir, `areas/${area.id}.html`), renderArea(area, markdown));
}

for (const area of zhAreas) {
  await writeFile(resolve(outDir, `zh/areas/${area.id}.html`), renderAreaZh(area));
}

for (const task of [...catalog.tasks, ...catalog.guides]) {
  const markdown = await readFile(resolve(docsDir, task.file), "utf8");
  await writeFile(resolve(outDir, `tasks/${task.id}.html`), renderTask(task, markdown));
}

for (const task of [...zhTasks, ...zhGuides]) {
  await writeFile(resolve(outDir, `zh/tasks/${task.id}.html`), renderTaskZh(task));
}

const taskIndex = await readFile(resolve(docsDir, "tasks/index.md"), "utf8");
await writeFile(resolve(outDir, "tasks/index.html"), renderTaskIndex(taskIndex));
const taskIndexZh = await readFile(resolve(docsDir, "zh/tasks/index.md"), "utf8");
await writeFile(resolve(outDir, "zh/tasks/index.html"), renderTaskIndexZh(taskIndexZh));

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
    `- [Recorded revision](${value.pagesBaseUrl}meta.json): officialRepository, officialTag, and officialCommit for the daily comparator. officialDocsSite is the human-readable official documentation.`,
    `- [Official documentation](${value.officialDocsSite}en/): Latest published release. English lives under /en/. Chinese is the site root. [llms.txt](${value.officialDocsSite}llms.txt) lists both. Compare it with the target version. Pinned citations in this index are what you verify.`,
    `- [Index](${value.pagesBaseUrl}index.html): Area list with stable anchors.`,
    `- [中文](${value.pagesBaseUrl}zh/llms.txt): Simplified Chinese mirror of the human-readable pages.`,
    `- [Task index](${value.pagesBaseUrl}tasks/index.md): Which extension task to open before the area reference.`,
    `- [Architecture rules](${value.pagesBaseUrl}tasks/architecture-rules.md): Anti-patterns from the official plugin practices.`,
  ];
  for (const task of value.tasks) {
    lines.push(`- [${task.title}](${value.pagesBaseUrl}${task.file}): ${task.summary}`);
  }
  for (const area of value.areas) {
    lines.push(`- [${area.title}](${value.pagesBaseUrl}${area.file}): ${area.summary}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderLlmsZh(value, areas, tasks, guides) {
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
    `- [所记录的修订](${value.pagesBaseUrl}meta.json)：每日比对用的 officialRepository、officialTag 与 officialCommit。officialDocsSite 是给人读的官方文档站点。`,
    `- [官方文档](${value.officialDocsSite})：简体中文在站点根路径。它是最近发布的版本，要和目标版本对照。[llms.txt](${value.officialDocsSite}llms.txt) 列出两个语言。核对仍用本索引钉住的提交。`,
    `- [索引](${value.pagesBaseUrl}zh/index.html)：带稳定锚点的章节列表。`,
    `- [任务索引](${value.pagesBaseUrl}zh/tasks/index.md)：先打开哪一个扩展任务，再读参考章节。`,
    `- [架构规则](${value.pagesBaseUrl}zh/tasks/architecture-rules.md)：来自官方插件实践的反模式。`,
  ];
  for (const task of [...tasks, ...guides]) {
    lines.push(`- [${task.zhTitle}](${value.pagesBaseUrl}${task.fileZh})：${task.zhSummary}`);
  }
  for (const area of areas) {
    lines.push(`- [${area.zhTitle}](${value.pagesBaseUrl}${area.fileZh})：${area.zhSummary}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderIndex(value) {
  const tasks = value.tasks.map((task) => [
    `<li id="${escapeAttr(task.id)}">`,
    `<a href="tasks/${task.id}.html">${escapeText(task.title)}</a>`,
    ` — ${escapeText(task.summary)}`,
    ` <a href="${escapeAttr(task.file)}">markdown</a>`,
    "</li>",
  ].join(""));
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
      "<h2>Official documentation</h2>",
      `<p>Read the official docs on <a href="${escapeAttr(value.officialDocsSite)}en/">the English site</a>. Simplified Chinese is the site root. <a href="${escapeAttr(value.officialDocsSite)}llms.txt">llms.txt</a> lists both locales. The site is the latest published release, so compare it with the target version. Citations on these pages stay pinned to the recorded commit. The site link is for reading.</p>`,
      "<p>DeepSeek Harness features and extension points for an agent doing secondary development. Start with a task when the goal is to ship a plugin. Area pages remain the reference layer. Each page cites official files at the pinned commit. The recorded revision is <a href=\"meta.json\">meta.json</a>. If the target DSH version differs, treat these pages as unverified for that version.</p>",
      "<h2>Tasks</h2>",
      "<nav><ul>",
      `<li><a href="tasks/index.html">Task index</a></li>`,
      `<li><a href="tasks/architecture-rules.html">Architecture rules and anti-patterns</a></li>`,
      ...tasks,
      "</ul></nav>",
      "<h2>Areas</h2>",
      "<nav><ul>",
      ...items,
      "</ul></nav>",
      "</main>",
    ].join("\n"),
  });
}

function renderIndexZh(value, areas, tasks, guides) {
  const taskItems = [...tasks, ...guides].map((task) => [
    `<li id="${escapeAttr(task.id)}">`,
    `<a href="tasks/${task.id}.html">${escapeText(task.zhTitle)}</a>`,
    ` — ${inline(task.zhSummary)}`,
    ` <a href="tasks/${task.id}.md">Markdown</a>`,
    "</li>",
  ].join(""));
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
      "<h2>官方文档</h2>",
      `<p>给人读的官方文档在<a href="${escapeAttr(value.officialDocsSite)}">官方站点</a>，简体中文在站点根路径。<a href="${escapeAttr(value.officialDocsSite)}llms.txt">llms.txt</a> 列出两个语言。该站点是最近发布的版本，要和目标版本对照。本索引的引用仍钉在记录的提交和路径上，站点链接只供阅读。</p>`,
      "<p>这是给做二次开发的 agent 用的 DeepSeek Harness 功能与扩展点索引。要交付插件时先打开任务。章节页仍是参考层。每一页都引用上述固定提交里的官方文件。所记录的修订见 <a href=\"../meta.json\">meta.json</a>。目标版本不同时，把这些页面当作未经核实。</p>",
      "<p>不要发明 API。</p>",
      "<h2>任务</h2>",
      "<nav><ul>",
      `<li><a href="tasks/index.html">任务索引</a></li>`,
      ...taskItems,
      "</ul></nav>",
      "<h2>章节</h2>",
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

function renderTask(task, markdown) {
  return page({
    title: task.title,
    lang: "en",
    css: "../assets/site.css",
    alternate: { hreflang: "zh-CN", href: `../zh/tasks/${task.id}.html` },
    body: [
      "<header>",
      `<p><a href="../zh/tasks/${task.id}.html" lang="zh-CN">中文</a> · <a href="../tasks/index.html">Tasks</a> · <a href="../index.html">Index</a> · <a href="${task.id}.md">markdown</a></p>`,
      "</header>",
      "<article>",
      renderMarkdown(markdown),
      "</article>",
    ].join("\n"),
  });
}

function renderTaskZh(task) {
  return page({
    title: task.zhTitle,
    lang: "zh-CN",
    css: "../../assets/site.css",
    alternate: { hreflang: "en", href: `../../tasks/${task.id}.html` },
    body: [
      "<header>",
      `<p><a href="../../tasks/${task.id}.html" lang="en">English</a> · <a href="../index.html">索引</a> · <a href="${task.id}.md">Markdown</a></p>`,
      "</header>",
      "<article>",
      renderMarkdown(task.markdown),
      "</article>",
    ].join("\n"),
  });
}

function renderTaskIndex(markdown) {
  return page({
    title: "Task index",
    lang: "en",
    css: "../assets/site.css",
    alternate: { hreflang: "zh-CN", href: "../zh/tasks/index.html" },
    body: [
      "<header>",
      `<p><a href="../zh/tasks/index.html" lang="zh-CN">中文</a> · <a href="../index.html">Index</a></p>`,
      "</header>",
      "<article>",
      renderMarkdown(markdown),
      "</article>",
    ].join("\n"),
  });
}

function renderTaskIndexZh(markdown) {
  return page({
    title: "任务索引",
    lang: "zh-CN",
    css: "../../assets/site.css",
    alternate: { hreflang: "en", href: "../../tasks/index.html" },
    body: [
      "<header>",
      `<p><a href="../../tasks/index.html" lang="en">English</a> · <a href="../index.html">索引</a></p>`,
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
  if (!heading) throw new Error(`docs/${id} is missing an h1`);
  const zhTitle = heading.slice(2).trim();
  if (!zhTitle) throw new Error(`docs/${id} has an empty h1`);
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
  if (prose.length === 0) throw new Error(`docs/${id} is missing an opening paragraph`);
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
