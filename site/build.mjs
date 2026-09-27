#!/usr/bin/env node
// Build the plugin site into _site/ (or the directory given as the first argument).
//
//   node site/build.mjs [outDir] [--save-snapshot file] [--snapshot file]
//
// Live data comes from the npm registry (versions, dates, manifests) and jsDelivr
// (file lists, READMEs, icons). --snapshot builds from a saved JSON file instead,
// which keeps local previews and tests offline.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderSite, validateCatalog } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = args.splice(i, 2);
  if (!value) throw new Error(`${name} needs a file path`);
  return value;
};
const snapshotIn = option("--snapshot");
const snapshotOut = option("--save-snapshot");
const outDir = resolve(args[0] ?? join(here, "..", "_site"));
const MARKER = ".dsh-plugin-site";

const catalog = JSON.parse(readFileSync(join(here, "catalog.json"), "utf8"));
validateCatalog(catalog);

async function get(url, { type = "json", optional = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: type === "json" ? "application/json" : "*/*" }, signal: AbortSignal.timeout(30_000) });
      if (optional && response.status === 404) return undefined;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return type === "json" ? await response.json() : await response.text();
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

const MANIFEST_FIELDS = ["description", "license", "engines", "dependencies", "peerDependencies", "keywords", "repository", "homepage", "bugs", "dsh", "icon"];

async function fetchPackage(plugin) {
  const name = plugin.package;
  const packument = await get(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
  const version = packument["dist-tags"]?.latest;
  if (!version) throw new Error(`${name}: no latest dist-tag on npm`);
  const full = packument.versions[version];
  const manifest = Object.fromEntries(MANIFEST_FIELDS.filter((k) => full[k] !== undefined).map((k) => [k, full[k]]));

  const cdn = `https://cdn.jsdelivr.net/npm/${name}@${version}/`;
  const listing = await get(`https://data.jsdelivr.com/v1/packages/npm/${name}@${version}?structure=flat`);
  const files = listing.files.map((f) => f.name).sort();

  const readme = {};
  for (const [lang, path] of Object.entries(plugin.readme)) {
    if (!files.includes(`/${path}`)) {
      console.warn(`warn: ${name}@${version} does not ship ${path}; the ${lang} page falls back to the other language`);
      continue;
    }
    readme[lang] = { path, text: await get(cdn + path, { type: "text" }) };
  }

  const iconPath = typeof manifest.icon === "string" ? manifest.icon.replace(/^\.\//, "") : "icon.svg";
  let icon;
  if (files.includes(`/${iconPath}`) && iconPath.endsWith(".svg")) {
    const svg = await get(cdn + iconPath, { type: "text" });
    if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg) && svg.length < 100_000) icon = svg;
    else console.warn(`warn: ${name} icon is not a small SVG; using a monogram`);
  }

  const times = packument.time ?? {};
  const versions = Object.keys(packument.versions)
    .filter((v) => times[v])
    .map((v) => ({ version: v, date: times[v] }))
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    name,
    version,
    distTags: packument["dist-tags"],
    created: times.created ?? versions.at(-1)?.date,
    modified: times[version],
    versions,
    manifest,
    files,
    readme,
    icon,
  };
}

async function loadData() {
  if (snapshotIn) return JSON.parse(readFileSync(snapshotIn, "utf8"));
  const entries = await Promise.all(catalog.plugins.map(async (p) => [p.package, await fetchPackage(p)]));
  return { generatedAt: new Date().toISOString(), packages: Object.fromEntries(entries) };
}

function prepareOutDir() {
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    if (!existsSync(join(outDir, MARKER))) throw new Error(`${outDir} is not empty and was not created by this script; refusing to clear it`);
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, MARKER), "");
}

const data = await loadData();
if (snapshotOut) writeFileSync(snapshotOut, JSON.stringify(data, null, 2));

const css = readFileSync(join(here, "assets", "site.css"), "utf8");
const js = readFileSync(join(here, "assets", "site.js"), "utf8");
const assetVersion = createHash("sha256").update(css).update(js).digest("hex").slice(0, 10);

const files = renderSite(catalog, data.packages, { generatedAt: data.generatedAt, assetVersion });
files.set("assets/site.css", css);
files.set("assets/site.js", js);

prepareOutDir();
for (const [path, content] of files) {
  const target = join(outDir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
console.log(`Built ${files.size} files for ${catalog.plugins.length} plugins into ${outDir}`);
