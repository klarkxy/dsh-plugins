#!/usr/bin/env node
// Keep the Git-published Discover index in sync with catalog.json and npm.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchPackage } from "./npm.mjs";
import { derive, marketIndex, validateCatalog } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "..", "index.json");
const check = process.argv.length === 3 && process.argv[2] === "--check";
if (!check && process.argv.length !== 2) throw new Error("Usage: node site/market.mjs [--check]");

const catalog = JSON.parse(readFileSync(join(here, "catalog.json"), "utf8"));
validateCatalog(catalog);
const entries = await Promise.all(catalog.plugins.map(async (plugin) => [plugin.package, await fetchPackage(plugin)]));
const content = marketIndex({ catalog, plugins: derive(catalog, Object.fromEntries(entries)) });

if (check) {
  const current = existsSync(output) ? readFileSync(output, "utf8") : "";
  if (current !== content) throw new Error("index.json is missing or stale; run pnpm site:market and commit the result");
  console.log("Git plugin market index is up to date");
} else {
  writeFileSync(output, content);
  console.log(`Updated ${output}`);
}
