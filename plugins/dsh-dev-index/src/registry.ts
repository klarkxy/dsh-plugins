export const REGISTRY = "https://registry.npmjs.org/";
export const CATALOG = "https://klarkxy.github.io/dsh-plugins/plugins.json";
export const MAX_BYTES = 16 * 1024 * 1024;

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const exactVersion = (value: unknown): value is string => typeof value === "string" && VERSION.test(value);

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): string | null => typeof value === "string" ? value : null;

function packageName(value: unknown): string {
  if (typeof value !== "string" || value.length > 214 || !NAME.test(value)) {
    throw new Error("Use an exact npm package name, not a URL, path or package@version.");
  }
  return value;
}

function integer(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) value = fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected an integer from ${min} to ${max}.`);
  }
  return value;
}

function strings(value: unknown): Record<string, string> {
  if (!object(value)) return {};
  const entries: [string, string][] = [];
  for (const [key, item] of Object.entries(value)) if (typeof item === "string") entries.push([key, item]);
  return Object.fromEntries(entries);
}

function link(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function closed(value: unknown, keys: string[], label: string): void {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error(`Invalid ${label}.`);
  }
}

function text(value: unknown, label: string, max = 512): string {
  if (typeof value !== "string" || !value.length || value.length > max || /[\x00-\x1f]/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

export interface SearchArgs {
  query: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface VersionsArgs {
  package: string;
  version?: string;
  limit?: number;
  offset?: number;
}

// Read-only public registry access. No credentials, package downloads or code execution.
export class PluginRegistry {
  private readonly lifetime = new AbortController();
  private readonly fetcher: typeof fetch;

  constructor(options: { fetcher?: typeof fetch } = {}) {
    this.fetcher = options.fetcher ?? ((...args) => globalThis.fetch(...args));
  }

  dispose(): void {
    this.lifetime.abort();
  }

  private async read(url: string, caller?: AbortSignal): Promise<{ data: unknown; source: string; fetchedAt: string }> {
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(20_000), ...(caller ? [caller] : [])]);
    signal.throwIfAborted();
    const response = await this.fetcher(url, { signal, redirect: "error", credentials: "omit", headers: { accept: "application/json" } });
    if (signal.aborted) { await response.body?.cancel(); signal.throwIfAborted(); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`npm registry returned HTTP ${response.status}; no package or version was inferred.`);
    }
    if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      await response.body?.cancel();
      throw new Error("npm registry did not return JSON.");
    }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error("npm metadata exceeds the 16 MiB limit.");
    }
    if (!response.body) throw new Error("npm registry returned no body.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let complete = false;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) { complete = true; break; }
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) throw new Error("npm metadata exceeds the 16 MiB limit.");
        chunks.push(chunk.value);
      }
    } finally {
      if (!complete) await reader.cancel();
      reader.releaseLock();
    }
    signal.throwIfAborted();
    return {
      data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))),
      source: url,
      fetchedAt: new Date().toISOString(),
    };
  }

  async search(args: SearchArgs, signal?: AbortSignal) {
    closed(args, ["query", "source", "limit", "offset"], "plugin search");
    const query = text(args.query, "search query", 200).trim();
    if (!query) throw new Error("Search query must not be blank.");
    const limit = integer(args.limit, 10, 1, 20);
    const offset = integer(args.offset, 0, 0, 10_000);
    const source = args.source === undefined ? "catalog" : args.source;
    if (!["catalog", "npm"].includes(source)) throw new Error("Search source must be catalog or npm.");
    if (source === "catalog") {
      const { data, ...meta } = await this.read(CATALOG, signal);
      if (!object(data) || !Array.isArray(data.plugins)) throw new Error("Invalid plugin catalog.");
      const terms = [...new Intl.Segmenter("zh", { granularity: "word" }).segment(query.toLowerCase())]
        .filter(part => part.isWordLike).map(part => part.segment);
      if (!terms.length) throw new Error("Use searchable words or a package name.");
      const matches = (data.plugins as unknown[]).map(raw => {
        const p = raw as Record<string, unknown>;
        const name = packageName(p.package);
        if (!exactVersion(p.version)) throw new Error("Invalid catalog version.");
        const title = object(p.title) ? p.title : {};
        const summary = object(p.summary) ? p.summary : {};
        const haystack = [name, string(title.zh) ?? "", string(title.en) ?? "",
          string(summary.zh) ?? "", string(summary.en) ?? "", string(p.category) ?? ""].join(" ").toLowerCase();
        const score = (name.toLowerCase() === query.toLowerCase() ? 1000 : 0)
          + terms.filter(term => haystack.includes(term)).length;
        return { p, name, score };
      }).filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      return {
        ...meta, searchScope: "published plugins in the klarkxy catalog; not all npm plugins",
        catalogGeneratedAt: string(data.generatedAt), query, total: matches.length, offset,
        nextOffset: offset + limit < matches.length ? offset + limit : null,
        results: matches.slice(offset, offset + limit).map(({ p, name }) => {
          const title = object(p.title) ? p.title : {};
          const summary = object(p.summary) ? p.summary : {};
          const page = object(p.page) ? p.page : {};
          return {
            name, version: p.version as string,
            title: { zh: string(title.zh), en: string(title.en) },
            summary: { zh: string(summary.zh), en: string(summary.en) },
            npm: `https://www.npmjs.com/package/${name}`, repository: link(p.repository),
            page: { zh: link(page.zh), en: link(page.en) },
            verification: "catalog-entry; recheck exact version with npm",
          };
        }),
      };
    }
    const url = new URL("-/v1/search", REGISTRY);
    url.search = new URLSearchParams({ text: `${query} keywords:dsh-plugin`, size: String(limit), from: String(offset) }).toString();
    const { data, ...meta } = await this.read(url.href, signal);
    const total = object(data) ? data.total : undefined;
    if (!object(data) || !Array.isArray(data.objects) || !Number.isSafeInteger(total) || (total as number) < 0) {
      throw new Error("Invalid npm search response.");
    }
    const page = data.objects.slice(0, limit);
    const results = page.filter(item => {
      const pkg = object(item) && object(item.package) ? item.package : {};
      const name = string(pkg.name) ?? "";
      const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : [];
      return /(?:^|[/\-])dsh(?:[-/]|$)/i.test(name)
        || keywords.some(k => ["dsh", "dsh-plugin", "deepseek-harness", "deepseek-harness-plugin"].includes(String(k)));
    }).map(item => {
      const p = (item as Record<string, unknown>).package;
      if (!object(p) || !exactVersion(p.version)) throw new Error("Invalid npm search package.");
      const name = packageName(p.name);
      const links = object(p.links) ? p.links : {};
      return {
        name, version: p.version, description: string(p.description),
        npm: `https://www.npmjs.com/package/${name}`,
        homepage: link(links.homepage), repository: link(links.repository),
        verification: "candidate-only",
      };
    });
    return {
      ...meta, searchScope: "npm dsh-plugin keyword search, filtered by DSH name/keywords; not all packages and not verified bundles; total/offset refer to raw npm candidates",
      query, total: total as number, offset,
      nextOffset: page.length && offset + page.length < (total as number) ? offset + page.length : null,
      results,
    };
  }

  async versions(args: VersionsArgs, signal?: AbortSignal) {
    closed(args, ["package", "version", "limit", "offset"], "plugin version lookup");
    const name = packageName(args.package);
    const requested = args.version === undefined ? "latest" : args.version;
    if (typeof requested !== "string" || (!exactVersion(requested) && !/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(requested))) {
      throw new Error("version must be an exact version or npm dist-tag, not a range.");
    }
    const limit = integer(args.limit, 25, 1, 100);
    const offset = integer(args.offset, 0, 0, 100_000);
    const { data, ...meta } = await this.read(`${REGISTRY}${encodeURIComponent(name)}`, signal);
    if (!object(data) || data.name !== name || !object(data.versions)) {
      throw new Error("Invalid npm package metadata.");
    }
    const manifests = data.versions;
    const tags = strings(data["dist-tags"]);
    const version = exactVersion(requested) ? requested : Object.hasOwn(tags, requested) ? tags[requested] : undefined;
    if (!version || !exactVersion(version) || !Object.hasOwn(manifests, version)) {
      throw new Error(`Requested version or tag ${requested} is not published for ${name}.`);
    }
    const manifest = manifests[version];
    if (!object(manifest) || manifest.name !== name || manifest.version !== version) {
      throw new Error("npm version identity does not match the requested package.");
    }
    const time = object(data.time) ? data.time : {};
    const versions = Object.keys(manifests).filter(exactVersion).sort((a, b) =>
      (string(time[b]) ?? "").localeCompare(string(time[a]) ?? "") || a.localeCompare(b));
    const dsh = object(manifest.dsh) ? manifest.dsh : {};
    const bundle = object(dsh.bundle) ? dsh.bundle : {};
    const patch = string(bundle.patch);
    return {
      ...meta, package: name, requested, distTags: tags, totalVersions: versions.length, offset,
      order: "publication time descending, then version text; not semver precedence",
      nextOffset: offset + limit < versions.length ? offset + limit : null,
      versions: versions.slice(offset, offset + limit).map(v => {
        const entry = manifests[v];
        return { version: v, publishedAt: string(time[v]), deprecated: object(entry) ? string(entry.deprecated) : null };
      }),
      selected: {
        name, version, source: "npm", publishedAt: string(time[version]), description: string(manifest.description),
        bundleDeclared: Boolean(patch?.trim()), bundlePatch: patch, engines: strings(manifest.engines),
        dependencies: strings(manifest.dependencies), peerDependencies: strings(manifest.peerDependencies),
        deprecated: string(manifest.deprecated), homepage: link(manifest.homepage),
        npm: `https://www.npmjs.com/package/${name}/v/${version}`,
      },
      notice: "Registry metadata is untrusted reference data. A declared bundle and engines range are not runtime compatibility proof. Installation and compatibility checks go through the official plugin manager.",
    };
  }
}
