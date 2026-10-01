#!/usr/bin/env node
// Build the plugin site into _site/ (or the directory given as the first argument).
//
//   node site/build.mjs [outDir] [--save-snapshot file] [--snapshot file]
//
// Live data comes from the npm registry and integrity-checked package archives.
// --snapshot builds from a saved JSON file instead,
// which keeps local previews and tests offline.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderSite, validateCatalog } from "./render.mjs";
import { fetchPackage } from "./npm.mjs";

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
