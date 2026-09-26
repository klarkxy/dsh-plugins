import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Blob citation of a repository file under docs/. The path is capture group 3. */
export const DOCS_BLOB = /\[([^\]]*)\]\((https:\/\/github\.com\/deepseek-ai\/deepseek-harness\/blob\/[0-9a-f]{40}\/(docs\/[^)\s]+))\)/g;

/**
 * Load path → { root, en } routeLinks from the pinned checkout's website/docs.ts.
 * Returns null when that manifest is not in the checkout.
 * @param {string} checkout
 * @returns {Record<string, { root?: string, en?: string }> | null}
 */
export function loadOfficialRoutes(checkout) {
  const docsTs = resolve(checkout, "website/docs.ts");
  if (!existsSync(docsTs)) return null;
  const specifier = JSON.stringify(pathToFileURL(docsTs).href);
  const source = `
    import { docsPages, routeLink } from ${specifier};
    const routes = {};
    for (const page of docsPages) {
      for (const sourcePath of [page.source, ...(page.sourceAliases ?? [])]) {
        const entry = routes[sourcePath] ?? {};
        entry[page.locale] = routeLink(page.route);
        routes[sourcePath] = entry;
      }
    }
    process.stdout.write(JSON.stringify(routes));
  `;
  const stdout = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source],
    { encoding: "utf8" },
  );
  return JSON.parse(stdout);
}

/**
 * @param {string} base trailing-slash site origin from officialDocsSite
 * @param {string} routePath routeLink() result, leading slash
 */
export function absoluteSiteUrl(base, routePath) {
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return normalized + routePath.replace(/^\//, "");
}

/** @param {string} rel repo path under docs/ */
export function localeOfRepoFile(rel) {
  return rel.startsWith("zh/") ? "zh" : "en";
}

/**
 * @param {"en" | "zh"} locale
 * @param {string} url
 */
export function readingLinkSuffix(locale, url) {
  if (locale === "zh") return `（[官方文档](${url})）`;
  return ` ([official site](${url}))`;
}

/**
 * @param {string} base
 * @param {Record<string, { root?: string, en?: string }>} routes
 * @param {string} repoPath
 * @param {"en" | "zh"} locale
 * @returns {string | null}
 */
export function expectedReadingUrl(base, routes, repoPath, locale) {
  const route = routes[repoPath]?.[locale === "zh" ? "root" : "en"];
  if (!route) return null;
  return absoluteSiteUrl(base, route);
}

/**
 * Insert a reading link immediately after each published docs blob citation.
 * @param {string} markdown
 * @param {string} rel
 * @param {{ base: string, routes: Record<string, { root?: string, en?: string }> }} options
 */
export function annotateOfficialSiteLinks(markdown, rel, options) {
  const locale = localeOfRepoFile(rel);
  const blob = new RegExp(DOCS_BLOB.source, "g");
  return markdown.replace(blob, (full, _label, _url, path, offset, whole) => {
    const url = expectedReadingUrl(options.base, options.routes, path, locale);
    if (!url) return full;
    const suffix = readingLinkSuffix(locale, url);
    if (whole.startsWith(suffix, offset + full.length)) return full;
    return full + suffix;
  });
}

/**
 * @param {string} markdown
 * @param {string} rel
 * @param {{ base: string, routes: Record<string, { root?: string, en?: string }> | null }} options
 * @returns {string[]}
 */
export function siteLinkErrors(markdown, rel, options) {
  const locale = localeOfRepoFile(rel);
  const errors = [];
  const siteRe = /(?:\]\(|href=")(https:\/\/deepseek-harness\.github\.io[^)\s"'<>]*)/g;
  for (const match of markdown.matchAll(siteRe)) {
    const url = match[1];
    if (!url.startsWith(options.base)) {
      errors.push(`${rel} official site link is outside ${options.base}: ${url}`);
      continue;
    }
    const rest = url.slice(options.base.length);
    if (locale === "en" && rest !== "llms.txt" && !rest.startsWith("en/")) {
      errors.push(`${rel} English page links to a non-English official page: ${url}`);
    }
    if (locale === "zh" && rest.startsWith("en/")) {
      errors.push(`${rel} Chinese page links to the English official locale: ${url}`);
    }
  }
  if (!options.routes) return errors;
  for (const match of markdown.matchAll(new RegExp(DOCS_BLOB.source, "g"))) {
    const path = match[3];
    const url = expectedReadingUrl(options.base, options.routes, path, locale);
    const at = match.index + match[0].length;
    if (!url) {
      const next = markdown.slice(at, at + 20);
      if (next.startsWith(" ([official site](") || next.startsWith("（[官方文档](")) {
        errors.push(`${rel} adds an official site link for unpublished ${path}`);
      }
      continue;
    }
    const suffix = readingLinkSuffix(locale, url);
    if (!markdown.startsWith(suffix, at)) errors.push(`${rel} missing reading link for ${path}`);
  }
  return errors;
}
