import { createHash } from "node:crypto";

export const DOCS_ROOT = "https://deepseek-harness.github.io/deepseek-harness/";
export const DOCS_INDEX = `${DOCS_ROOT}llms.txt`;
export const CACHE_TTL_MS = 5 * 60_000;
export const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CACHED_PAGES = 32;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

export interface DocEntry {
  id: string;
  title: string;
  description: string;
  url: string;
  language: "zh" | "en";
}

interface Page {
  text: string;
  bytes: number;
  fetchedAt: string;
  expiresAt: number;
  revision: string;
  startedAt: number;
}

function revision(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// IDs are relative Markdown paths, never arbitrary URLs or filesystem paths.
export function docUrl(id: string): string {
  if (id.length > 300 || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.md$/.test(id)) {
    throw new Error("Invalid document ID. Use an id returned by dsh_docs_search.");
  }
  return `${DOCS_ROOT}${id}`;
}

export function parseIndex(text: string): DocEntry[] {
  const docs = new Map<string, DocEntry>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*-\s+\[([^\]]+)\]\(([^\s)]+)\)\s*:?\s*(.*)$/.exec(line);
    if (!match) continue;
    let url: URL;
    try { url = new URL(match[2], DOCS_INDEX); } catch { continue; }
    if (!url.href.startsWith(DOCS_ROOT) || url.search || url.hash || url.username || url.password) continue;
    const id = url.href.slice(DOCS_ROOT.length);
    try { if (docUrl(id) !== url.href) continue; } catch { continue; }
    if (match[1].length > 200 || match[3].length > 600) throw new Error("Official docs index entry is too large.");
    docs.set(id, { id, title: match[1], description: match[3], url: url.href, language: id.startsWith("en/") ? "en" : "zh" });
    if (docs.size > 2000) throw new Error("Official docs index exceeds 2000 entries.");
  }
  if (!docs.size) throw new Error("Official docs index has no usable Markdown entries; its format may have changed.");
  return [...docs.values()];
}

function tokens(query: string): string[] {
  // The catalog is small; standard-library segmentation handles Chinese and English.
  const segments = new Intl.Segmenter("zh", { granularity: "word" }).segment(query.toLowerCase());
  return [...new Set([...segments].filter(s => s.isWordLike).map(s => s.segment))];
}

export class DocsClient {
  private readonly shutdown = new AbortController();
  private readonly pages = new Map<string, Page>();
  private readonly pending = new Set<Promise<Page>>();
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(options: { fetcher?: typeof fetch; now?: () => number } = {}) {
    this.fetcher = options.fetcher ?? ((...args) => globalThis.fetch(...args));
    this.now = options.now ?? Date.now;
  }

  async dispose(): Promise<void> {
    this.shutdown.abort();
    this.pages.clear();
    await Promise.allSettled([...this.pending]);
  }

  private async download(url: string, caller: AbortSignal): Promise<Page> {
    const signal = AbortSignal.any([caller, this.shutdown.signal, AbortSignal.timeout(20_000)]);
    signal.throwIfAborted();
    const startedAt = this.now();
    // Keep the host's global dispatcher/proxy policy and normal TLS verification.
    // No credentials, model-provided URLs, redirects, or shell subprocesses.
    const response = await this.fetcher(url, { signal, redirect: "error", credentials: "omit", headers: { accept: "text/plain, text/markdown" } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Official documentation returned HTTP ${response.status}.`);
    }
    const type = response.headers.get("content-type")?.split(";")[0].trim();
    if (type !== "text/plain" && type !== "text/markdown") {
      await response.body?.cancel();
      throw new Error(`Expected official Markdown/text, received ${type ?? "no content type"}.`);
    }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error("Official document exceeds the 2 MiB limit.");
    }
    if (!response.body) throw new Error("Official document has no body.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let complete = false;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) { complete = true; break; }
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error("Official document exceeds the 2 MiB limit.");
        chunks.push(chunk.value);
      }
    } finally {
      if (!complete) await reader.cancel();
      reader.releaseLock();
    }
    signal.throwIfAborted();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const fetched = this.now();
    return { text, bytes, fetchedAt: new Date(fetched).toISOString(), expiresAt: fetched + CACHE_TTL_MS, revision: revision(text), startedAt };
  }

  private async page(url: string, signal: AbortSignal, refresh: boolean, validate?: (text: string) => unknown) {
    signal.throwIfAborted();
    this.shutdown.signal.throwIfAborted();
    const cached = this.pages.get(url);
    if (!refresh && cached && cached.expiresAt > this.now()) return { ...cached, cached: true };
    const work = this.download(url, signal);
    this.pending.add(work);
    let page: Page;
    try { page = await work; } finally { this.pending.delete(work); }
    signal.throwIfAborted();
    this.shutdown.signal.throwIfAborted();
    validate?.(page.text);
    if ((this.pages.get(url)?.startedAt ?? -Infinity) <= page.startedAt) {
      this.pages.delete(url);
      this.pages.set(url, page);
    }
    while (this.pages.size > MAX_CACHED_PAGES || [...this.pages.values()].reduce((n, p) => n + p.bytes, 0) > MAX_CACHE_BYTES) {
      this.pages.delete(this.pages.keys().next().value!);
    }
    return { ...page, cached: false };
  }

  async search(args: { query: string; language?: string; limit?: number; refresh?: boolean }, signal: AbortSignal) {
    if (!args.query.trim() || args.query.length > 200) throw new Error("query must contain 1–200 characters.");
    const terms = tokens(args.query);
    if (!terms.length) throw new Error("query must contain searchable words.");
    const limit = args.limit ?? 8;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be an integer from 1 to 20.");
    if (args.language !== undefined && !["zh", "en", "all"].includes(args.language)) throw new Error("language must be zh, en, or all.");
    const page = await this.page(DOCS_INDEX, signal, args.refresh ?? false, parseIndex);
    const entries = parseIndex(page.text);
    const ranked = entries.filter(e => !args.language || args.language === "all" || e.language === args.language).map(entry => {
      const title = entry.title.toLowerCase();
      const description = entry.description.toLowerCase();
      const path = entry.id.toLowerCase();
      const score = terms.reduce((n, term) => n + (title.includes(term) ? 5 : 0) + (description.includes(term) ? 2 : 0) + (path.includes(term) ? 1 : 0), 0);
      return { entry, score };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
    return {
      source: DOCS_INDEX, fetchedAt: page.fetchedAt, cached: page.cached, revision: page.revision,
      searchScope: "directory", version: "Current official website; not pinned to your installed DSH version.",
      totalMatches: ranked.length, results: ranked.slice(0, limit).map(r => r.entry),
      note: "Searches titles, categories and paths, not full text. No matches does not mean a topic is absent from document bodies.",
    };
  }

  async read(args: { id: string; offset?: number; length?: number; revision?: string; refresh?: boolean }, signal: AbortSignal) {
    const url = docUrl(args.id);
    const offset = args.offset ?? 0;
    const length = args.length ?? 12_000;
    if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer.");
    if (!Number.isInteger(length) || length < 1 || length > 16_000) throw new Error("length must be an integer from 1 to 16000.");
    if (offset > 0 && !args.revision) throw new Error("Pass the revision from the previous response when continuing a document.");
    const catalog = await this.page(DOCS_INDEX, signal, args.refresh ?? false, parseIndex);
    const entry = parseIndex(catalog.text).find(e => e.id === args.id);
    if (!entry) throw new Error("Document ID is not in the current official index. Search again.");
    const page = await this.page(url, signal, args.refresh ?? false);
    if (args.revision && args.revision !== page.revision) throw new Error("Document changed since the previous response. Read again from offset 0 without revision.");
    if (offset > page.text.length) throw new Error("offset is past the end of this document.");
    const end = Math.min(offset + length, page.text.length);
    return {
      ...entry, fetchedAt: page.fetchedAt, cached: page.cached, revision: page.revision,
      version: "Current official website; verify APIs against the running DSH version.",
      offset, totalCharacters: page.text.length, nextOffset: end < page.text.length ? end : null,
      content: page.text.slice(offset, end),
    };
  }
}
