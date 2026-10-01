// Read the exact published npm archive in memory; never unpack files to disk.
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";

const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_UNPACKED = 128 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_ASSET = 5 * 1024 * 1024;
const IMAGE = /\.(?:svg|png|jpe?g|gif|webp|avif|ico)$/i;
const MANIFEST_FIELDS = ["description", "license", "engines", "dependencies", "peerDependencies", "keywords", "repository", "homepage", "bugs", "dsh", "icon"];

async function get(url, type, { fetcher, sleep }) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetcher(url, {
        headers: { accept: type === "json" ? "application/json" : "*/*" },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (type === "json") return await response.json();
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_ARCHIVE) throw new Error("npm archive exceeds 32 MiB");
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
      await sleep(attempt * 2000);
    }
  }
}

function verifyArchive(archive, dist) {
  const tokens = String(dist.integrity ?? "").split(/\s+/).filter(token => /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(token));
  if (!tokens.length) throw new Error("npm archive has no SHA-512 integrity");
  const actual = "sha512-" + createHash("sha512").update(archive).digest("base64");
  if (!tokens.includes(actual)) throw new Error("npm archive integrity mismatch");
}

export async function readArchive(archive, wanted) {
  const files = [];
  const contents = new Map();
  const seen = new Set();
  const extract = tar.extract();
  let unpacked = 0;
  const bound = new Transform({ transform(chunk, _encoding, done) {
    unpacked += chunk.length;
    done(unpacked > MAX_UNPACKED ? new Error("npm archive exceeds 128 MiB unpacked") : null, chunk);
  } });
  extract.on("entry", (header, stream, next) => {
    stream.on("error", error => extract.destroy(error));
    try {
      if (header.type === "directory" && /^package\/?$/.test(header.name)) { stream.resume(); stream.on("end", next); return; }
      const path = header.name.replace(/\/$/, "");
      if (!path.startsWith("package/") || /[\\\u0000-\u001f]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) {
        throw new Error(`Unsafe npm archive path: ${header.name}`);
      }
      if (seen.size >= 20_000) throw new Error("npm archive has too many entries");
      if (seen.has(path)) throw new Error(`Duplicate npm archive path: ${header.name}`);
      seen.add(path);
      if (header.type !== "file") { stream.resume(); stream.on("end", next); return; }
      const relative = path.slice("package/".length);
      files.push("/" + relative);
      const selected = wanted.has(relative) || IMAGE.test(relative) || relative === "LICENSE";
      const limit = IMAGE.test(relative) ? MAX_ASSET : MAX_TEXT;
      if (selected && header.size > limit) throw new Error(`npm file is too large: ${relative}`);
      const chunks = [];
      if (selected) stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
      else stream.resume();
      stream.on("end", () => {
        if (selected) contents.set(relative, Buffer.concat(chunks));
        next();
      });
    } catch (error) { extract.destroy(error); }
  });
  await pipeline(Readable.from([archive]), createGunzip(), bound, extract);
  return { files: files.sort(), contents };
}

export async function fetchPackage(plugin, {
  fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), warn = console.warn,
} = {}) {
  const name = plugin.package;
  const options = { fetcher, sleep };
  const packument = await get(`https://registry.npmjs.org/${encodeURIComponent(name)}`, "json", options);
  const version = packument["dist-tags"]?.latest;
  if (!version) throw new Error(`${name}: no latest dist-tag on npm`);
  const full = packument.versions?.[version];
  if (full?.name !== name || full.version !== version) throw new Error(`${name}: invalid npm version metadata`);
  const url = new URL(full.dist?.tarball);
  if (url.origin !== "https://registry.npmjs.org" || url.username || url.password) throw new Error(`${name}: invalid npm archive URL`);
  const archive = await get(url.href, "archive", options);
  verifyArchive(archive, full.dist);
  const iconPath = typeof full.icon === "string" ? full.icon.replace(/^\.\//, "") : "icon.svg";
  const { files, contents } = await readArchive(archive, new Set(["package.json", ...Object.values(plugin.readme), iconPath]));
  const published = JSON.parse(contents.get("package.json")?.toString("utf8") ?? "null");
  if (published?.name !== name || published.version !== version) throw new Error(`${name}: archive package identity mismatch`);
  const manifest = Object.fromEntries(MANIFEST_FIELDS.filter(key => published[key] !== undefined).map(key => [key, published[key]]));
  const readme = {};
  for (const [lang, path] of Object.entries(plugin.readme)) {
    const content = contents.get(path);
    if (!content) { warn(`warn: ${name}@${version} does not ship ${path}; the ${lang} page falls back to the other language`); continue; }
    readme[lang] = { path, text: content.toString("utf8") };
  }
  let icon;
  if (contents.has(iconPath) && iconPath.endsWith(".svg")) {
    const svg = contents.get(iconPath).toString("utf8");
    if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg) && svg.length < 100_000) icon = svg;
    else warn(`warn: ${name} icon is not a small SVG; using a monogram`);
  }
  const assets = Object.fromEntries([...contents].filter(([path]) => IMAGE.test(path) || path === "LICENSE")
    .map(([path, content]) => [path, content.toString("base64")]));
  const times = packument.time ?? {};
  const versions = Object.keys(packument.versions).filter(value => times[value])
    .map(value => ({ version: value, date: times[value] })).sort((a, b) => b.date.localeCompare(a.date));
  return { name, version, distTags: packument["dist-tags"], created: times.created ?? versions.at(-1)?.date,
    modified: times[version], versions, manifest, files, readme, icon, assets };
}
