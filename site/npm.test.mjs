import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import tar from "tar-stream";
import { fetchPackage, readArchive } from "./npm.mjs";

const plugin = { package: "@example/new-plugin", readme: { zh: "docs/README.zh-CN.md", en: "README.md" } };
const version = "1.2.3";
const tarball = "https://registry.npmjs.org/@example/new-plugin/-/new-plugin-1.2.3.tgz";
const integrity = buffer => "sha512-" + createHash("sha512").update(buffer).digest("base64");

async function archive(entries) {
  const pack = tar.pack();
  const chunks = [];
  const collecting = (async () => { for await (const chunk of pack) chunks.push(chunk); return gzipSync(Buffer.concat(chunks)); })();
  for (const [name, value, type = "file"] of entries) {
    pack.entry({ name, type, ...(type === "symlink" ? { linkname: "../../private" } : {}) }, value);
  }
  pack.finalize();
  return collecting;
}

async function fixture(extra = [], published = { name: plugin.package, version, license: "SEE LICENSE IN LICENSE", engines: { node: ">=22" } }) {
  const buffer = await archive([
    ["package/package.json", JSON.stringify(published)], ["package/README.md", "# New package\n\nLatest English README"],
    ["package/docs/README.zh-CN.md", "# 新插件\n\n最新中文说明"],
    ["package/icon.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>'], ["package/LICENSE", "License text"],
    ["package/docs/a b.png", Buffer.from([0, 255, 127])], ...extra,
  ]);
  const metadata = { "dist-tags": { latest: version }, time: { created: "2026-01-01", [version]: "2026-10-01" },
    versions: { [version]: { name: plugin.package, version, dist: { tarball, integrity: integrity(buffer) } } } };
  const calls = [];
  return { buffer, metadata, calls, fetcher: async url => {
    calls.push(url);
    if (url === tarball) return new Response(buffer);
    if (url === `https://registry.npmjs.org/${encodeURIComponent(plugin.package)}`) return Response.json(metadata);
    return new Response("CDN has not synchronized", { status: 404 });
  }, sleep: async () => {}, warn: () => {} };
}

test("a newly published version builds from its registry archive without any CDN calls", async () => {
  const input = await fixture();
  const result = await fetchPackage(plugin, input);
  assert.equal(result.version, version);
  assert.match(result.readme.zh.text, /最新中文说明/);
  assert.equal(result.manifest.license, "SEE LICENSE IN LICENSE");
  assert.equal(result.icon, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.ok(result.files.includes("/docs/a b.png"));
  assert.deepEqual(Buffer.from(result.assets["docs/a b.png"], "base64"), Buffer.from([0, 255, 127]));
  assert.equal(Buffer.from(result.assets.LICENSE, "base64").toString(), "License text");
  assert.equal(input.calls.length, 2);
  assert.ok(input.calls.every(url => new URL(url).hostname === "registry.npmjs.org"));
});

test("an unavailable published archive fails after bounded retries, without old data or a CDN fallback", async () => {
  const input = await fixture();
  const original = input.fetcher;
  let attempts = 0;
  input.fetcher = url => url === tarball ? (attempts++, new Response("missing", { status: 404 })) : original(url);
  await assert.rejects(fetchPackage(plugin, input), /HTTP 404/);
  assert.equal(attempts, 3);
});

test("archive integrity and its embedded package identity must match npm", async () => {
  const input = await fixture();
  input.metadata.versions[version].dist.integrity = integrity(Buffer.from("different"));
  await assert.rejects(fetchPackage(plugin, input), /integrity mismatch/);
  delete input.metadata.versions[version].dist.integrity;
  await assert.rejects(fetchPackage(plugin, input), /no SHA-512 integrity/);
  await assert.rejects(fetchPackage(plugin, await fixture([], { name: "other", version })), /identity mismatch/);
});

test("missing latest metadata and foreign archive URLs fail explicitly", async () => {
  const input = await fixture();
  input.metadata["dist-tags"] = {};
  await assert.rejects(fetchPackage(plugin, input), /no latest/);
  input.metadata["dist-tags"].latest = version;
  input.metadata.versions[version].dist.tarball = "http://127.0.0.1/private";
  await assert.rejects(fetchPackage(plugin, input), /invalid npm archive URL/);
});

test("a missing README language warns and retains the shipped language", async () => {
  const input = await fixture();
  const warnings = [];
  const result = await fetchPackage({ ...plugin, readme: { ...plugin.readme, zh: "missing.md" } }, { ...input, warn: text => warnings.push(text) });
  assert.equal(result.readme.zh, undefined);
  assert.match(result.readme.en.text, /Latest English/);
  assert.match(warnings[0], /does not ship missing.md/);
});

test("archive readers ignore symlinks and drain files not needed by the site", async () => {
  const input = await fixture([["package/secret-link", "", "symlink"], ["package/lib/code.js", "not retained"]]);
  const result = await readArchive(input.buffer, new Set(["package.json"]));
  assert.ok(result.files.includes("/lib/code.js"));
  assert.ok(!result.files.includes("/secret-link"));
  assert.ok(!result.contents.has("lib/code.js"));
});

test("archives reject traversal, ambiguous paths and duplicate entries without extracting to disk", async () => {
  for (const path of ["package/../outside", "/package/outside", "package/a\\b", "package/a/./b", "package//b"]) {
    await assert.rejects(readArchive(await archive([[path, "bad"]]), new Set()), /Unsafe npm archive path/);
  }
  await assert.rejects(readArchive(await archive([["package/a", "first"], ["package/a", "second"]]), new Set()), /Duplicate npm archive path/);
});

test("corrupt gzip and oversized retained files reject the archive", async () => {
  const input = await fixture();
  await assert.rejects(readArchive(input.buffer.subarray(0, input.buffer.length - 8), new Set()));
  await assert.rejects(readArchive(await archive([["package/README.md", Buffer.alloc(2 * 1024 * 1024 + 1)]]), new Set(["README.md"])), /too large/);
});
