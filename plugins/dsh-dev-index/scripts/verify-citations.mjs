import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = resolve(process.argv[2] ?? "");
if (!checkout || !existsSync(resolve(checkout, "packages"))) {
  process.stderr.write("usage: node scripts/verify-citations.mjs <deepseek-harness-checkout>\n");
  process.exit(2);
}

const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs");
const catalog = JSON.parse(await readFile(resolve(docsDir, "index.json"), "utf8"));
const meta = JSON.parse(await readFile(resolve(docsDir, "meta.json"), "utf8"));
const missing = [];

if (meta.officialRepository !== catalog.indexed.repository) {
  missing.push("meta.json officialRepository does not match index.json indexed.repository");
}
if (meta.officialTag !== catalog.indexed.tag) {
  missing.push("meta.json officialTag does not match index.json indexed.tag");
}
if (meta.officialCommit !== catalog.indexed.commit) {
  missing.push("meta.json officialCommit does not match index.json indexed.commit");
}

for (const area of catalog.areas) {
  const markdown = await readFile(resolve(docsDir, area.file), "utf8");
  if (!markdown.includes(catalog.indexed.commit)) {
    missing.push(`${area.file} does not name ${catalog.indexed.commit}`);
  }
  for (const source of area.sources) {
    if (!markdown.includes(source)) missing.push(`${area.file} does not mention ${source}`);
    if (!existsSync(resolve(checkout, source))) missing.push(`${source} missing from checkout (cited by ${area.id})`);
  }
  const blobs = markdown.matchAll(/https:\/\/github\.com\/deepseek-ai\/deepseek-harness\/blob\/([0-9a-f]{40})\/([^)\s]+)/g);
  for (const match of blobs) {
    if (match[1] !== catalog.indexed.commit) {
      missing.push(`${area.file} links commit ${match[1]}`);
    }
    if (!existsSync(resolve(checkout, match[2]))) {
      missing.push(`${match[2]} missing from checkout (linked by ${area.id})`);
    }
  }
}

if (missing.length > 0) {
  for (const line of missing) process.stderr.write(`${line}\n`);
  process.exit(1);
}

process.stdout.write(`verified ${catalog.areas.length} areas against ${checkout}\n`);
