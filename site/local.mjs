// Overlay local repository READMEs and referenced assets onto fetched npm package data.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, posix, resolve, sep } from "node:path";
import { Marked } from "marked";

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_ASSET = 5 * 1024 * 1024;
const IMAGE = /\.(?:svg|png|jpe?g|gif|webp|avif|ico)$/i;
const DOC_ASSETS = new Set(["LICENSE", "NOTICE", "NOTICE.md"]);

const isSafeRelPath = (rel) =>
  typeof rel === "string" &&
  rel.length > 0 &&
  !rel.startsWith("/") &&
  !/[\\\u0000-\u001f]/.test(rel) &&
  rel.split("/").every((part) => part && part !== "." && part !== "..");

function collectRefs(markdown) {
  const refs = [];
  const marked = new Marked({ gfm: true });
  const visit = (tokens) => {
    if (!Array.isArray(tokens)) return;
    for (const token of tokens) {
      if (!token || typeof token !== "object") continue;
      if ((token.type === "link" || token.type === "image") && typeof token.href === "string") {
        refs.push(token.href);
      } else if (token.type === "html" && typeof token.text === "string") {
        for (const match of token.text.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
          refs.push(match[1] ?? match[2] ?? match[3]);
        }
      }
      if (Array.isArray(token.tokens)) visit(token.tokens);
      if (Array.isArray(token.items)) visit(token.items);
      if (Array.isArray(token.header)) {
        for (const cell of token.header) visit(cell?.tokens);
      }
      if (Array.isArray(token.rows)) {
        for (const row of token.rows) {
          for (const cell of row) visit(cell?.tokens);
        }
      }
    }
  };
  visit(marked.lexer(markdown));
  return refs;
}

function readContainedFile(pkgDir, realPkgDir, relPosix, maxSize) {
  if (!isSafeRelPath(relPosix)) return null;
  const candidate = resolve(pkgDir, ...relPosix.split("/"));
  if (!candidate.startsWith(pkgDir + sep) || !existsSync(candidate)) return null;
  const realCandidate = realpathSync(candidate);
  if (!realCandidate.startsWith(realPkgDir + sep)) return null;
  const st = statSync(realCandidate);
  if (!st.isFile() || st.size > maxSize) return null;
  return readFileSync(realCandidate);
}

export function overlayLocalDocs(catalog, packagesData, repoRoot) {
  const sourceRepo = String(catalog.source ?? "").replace(/\/+$/, "");
  const root = resolve(repoRoot);
  const realRoot = existsSync(root) ? realpathSync(root) : root;

  for (const plugin of catalog.plugins ?? []) {
    const pkgData = packagesData?.[plugin.package];
    if (!pkgData) continue;
    if (String(plugin.repository ?? "").replace(/\/+$/, "") !== sourceRepo) continue;

    const dir = String(plugin.directory ?? "");
    if (dir && !isSafeRelPath(dir.replace(/\/+$/, ""))) continue;
    const pkgDir = dir ? resolve(root, ...dir.replace(/\/+$/, "").split("/")) : root;
    if (pkgDir !== root && !pkgDir.startsWith(root + sep)) continue;
    const manifestPath = join(pkgDir, "package.json");
    if (!existsSync(manifestPath)) continue;

    const realPkgDir = realpathSync(pkgDir);
    if (realPkgDir !== realRoot && !realPkgDir.startsWith(realRoot + sep)) continue;

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (manifest?.name !== plugin.package) continue;

    pkgData.readme = { ...(pkgData.readme ?? {}) };
    const overlaid = [];
    for (const lang of ["zh", "en"]) {
      const relPath = plugin.readme?.[lang];
      const buf = readContainedFile(pkgDir, realPkgDir, relPath, MAX_TEXT);
      if (!buf) continue;
      const text = buf.toString("utf8");
      pkgData.readme[lang] = { path: relPath, text };
      overlaid.push({ path: relPath, text });
    }

    const candidates = new Set();
    for (const docFile of DOC_ASSETS) {
      if (existsSync(join(pkgDir, docFile))) candidates.add(docFile);
    }
    for (const { path: readmePath, text } of overlaid) {
      const readmeDir = posix.dirname(readmePath);
      const base = readmeDir === "." ? "" : readmeDir;
      for (const rawRef of collectRefs(text)) {
        const href = String(rawRef ?? "").trim();
        if (!href || href.startsWith("#") || href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
        const clean = href.split(/[?#]/)[0];
        if (!clean) continue;
        let decoded;
        try {
          decoded = decodeURIComponent(clean);
        } catch {
          continue;
        }
        if (decoded.startsWith("/") || /[\\\u0000-\u001f]/.test(decoded)) continue;
        const virtual = posix.resolve("/pkg", base, decoded);
        if (!virtual.startsWith("/pkg/")) continue;
        const relPosix = virtual.slice("/pkg/".length);
        if (isSafeRelPath(relPosix)) candidates.add(relPosix);
      }
    }

    if (candidates.size > 0) {
      const assets = { ...(pkgData.assets ?? {}) };
      const files = new Set(pkgData.files ?? []);
      for (const relPosix of candidates) {
        const isImg = IMAGE.test(relPosix);
        if (!isImg && !DOC_ASSETS.has(relPosix)) continue;
        const buf = readContainedFile(pkgDir, realPkgDir, relPosix, isImg ? MAX_ASSET : MAX_TEXT);
        if (!buf) continue;
        assets[relPosix] = buf.toString("base64");
        files.add(`/${relPosix}`);
      }
      pkgData.assets = assets;
      pkgData.files = [...files].sort();
    }
  }
  return packagesData;
}
