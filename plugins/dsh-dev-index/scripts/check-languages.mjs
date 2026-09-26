import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs");
const catalog = JSON.parse(await readFile(resolve(docsDir, "index.json"), "utf8"));
const errors = [];
const HAN = /\p{Script=Han}/u;
const ENGLISH_RUN = /\b[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){3,}\b/g;

function stripLanguageSwitch(text) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, "")
    .replace(/<code\b[\s\S]*?<\/code>/gi, "")
    .replace(/\[中文\]\([^)\n]*\)/g, "")
    .replace(/<a\b[^>]*>\s*中文\s*<\/a>/g, "");
}

function visibleProse(text) {
  return stripLanguageSwitch(text)
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, "\n")
    .replace(/<code\b[\s\S]*?<\/code>/gi, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (_match, label) => (label === "English" || label === "中文" ? " " : ` ${label} `))
    .replace(/https?:\/\/\S+/g, " ");
}

async function read(rel) {
  return readFile(resolve(docsDir, rel), "utf8");
}

const englishFiles = [
  "index.html",
  "llms.txt",
  "REFRESH.md",
  "index.json",
  "meta.json",
  ...catalog.areas.flatMap((area) => [area.file, `areas/${area.id}.html`]),
];

for (const rel of englishFiles) {
  const path = resolve(docsDir, rel);
  if (!existsSync(path)) {
    errors.push(`${rel} is missing`);
    continue;
  }
  const raw = await read(rel);
  const stripped = stripLanguageSwitch(raw);
  if (HAN.test(stripped)) {
    const line = stripped.split("\n").find((item) => HAN.test(item));
    errors.push(`${rel} contains CJK outside the 中文 language link: ${line?.trim()}`);
  }
  if (rel.endsWith(".html")) {
    if (!raw.includes('<html lang="en">')) errors.push(`${rel} must set html lang="en"`);
    if (!/<a\b[^>]*>\s*中文\s*<\/a>/.test(raw)) errors.push(`${rel} is missing a 中文 link`);
    for (const match of raw.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>\s*中文\s*<\/a>/g)) {
      if (match[1].startsWith("/")) errors.push(`${rel} language link is root-absolute: ${match[1]}`);
    }
  }
  if (rel.endsWith(".md") && rel.startsWith("areas/")) {
    const id = rel.slice("areas/".length, -".md".length);
    const expected = `../zh/areas/${id}.md`;
    if (!raw.includes(`[中文](${expected})`)) errors.push(`${rel} must link to ${expected}`);
  }
}

if (!existsSync(resolve(docsDir, "llms.txt")) || !(await read("llms.txt")).includes("[中文](")) {
  errors.push("llms.txt must link to the Chinese mirror");
}

const zhFiles = [
  "zh/index.html",
  "zh/llms.txt",
  ...catalog.areas.flatMap((area) => [area.fileZh, `zh/areas/${area.id}.html`]),
];

for (const rel of zhFiles) {
  const path = resolve(docsDir, rel);
  if (!existsSync(path)) {
    errors.push(`missing Chinese page ${rel}`);
    continue;
  }
  const raw = await read(rel);
  if (rel.endsWith(".html")) {
    if (!raw.includes('<html lang="zh-CN">')) errors.push(`${rel} must set html lang="zh-CN"`);
    if (!/<a\b[^>]*>\s*English\s*<\/a>/.test(raw)) errors.push(`${rel} is missing an English link`);
    for (const match of raw.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>\s*English\s*<\/a>/g)) {
      if (match[1].startsWith("/")) errors.push(`${rel} language link is root-absolute: ${match[1]}`);
    }
  }
  const prose = visibleProse(raw);
  if (!HAN.test(prose)) errors.push(`${rel} has no Chinese prose`);
  for (const line of prose.split("\n")) {
    for (const hit of line.matchAll(ENGLISH_RUN)) {
      errors.push(`${rel} has an English run: ${hit[0]}`);
    }
  }
}

for (const area of catalog.areas) {
  if (area.fileZh !== `zh/areas/${area.id}.md`) {
    errors.push(`${area.id} fileZh must be zh/areas/${area.id}.md`);
    continue;
  }
  if (!existsSync(resolve(docsDir, area.fileZh))) continue;
  const zh = await read(area.fileZh);
  if (!zh.includes(catalog.indexed.commit)) errors.push(`${area.fileZh} does not name the indexed commit`);
  for (const source of area.sources) {
    if (!zh.includes(source)) errors.push(`${area.fileZh} does not mention ${source}`);
  }
  if (!zh.includes(`[English](../../areas/${area.id}.md)`)) {
    errors.push(`${area.fileZh} must link back to ../../areas/${area.id}.md`);
  }
}

if (existsSync(resolve(docsDir, "zh/llms.txt"))) {
  const llms = await read("zh/llms.txt");
  if (!llms.includes("[English](")) errors.push("zh/llms.txt must link back to the English llms.txt");
}

if (errors.length > 0) {
  for (const line of errors) process.stderr.write(`${line}\n`);
  process.exit(1);
}

process.stdout.write(`language check ok (${catalog.areas.length} areas)\n`);
