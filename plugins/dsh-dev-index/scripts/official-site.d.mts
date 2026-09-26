export const DOCS_BLOB: RegExp;

export function loadOfficialRoutes(
  checkout: string,
): Record<string, { root?: string; en?: string }> | null;

export function absoluteSiteUrl(base: string, routePath: string): string;

export function localeOfRepoFile(rel: string): "en" | "zh";

export function readingLinkSuffix(locale: "en" | "zh", url: string): string;

export function expectedReadingUrl(
  base: string,
  routes: Record<string, { root?: string; en?: string }>,
  repoPath: string,
  locale: "en" | "zh",
): string | null;

export function annotateOfficialSiteLinks(
  markdown: string,
  rel: string,
  options: { base: string; routes: Record<string, { root?: string; en?: string }> },
): string;

export function siteLinkErrors(
  markdown: string,
  rel: string,
  options: { base: string; routes: Record<string, { root?: string; en?: string }> | null },
): string[];
