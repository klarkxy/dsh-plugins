import { closed, exactVersion, text } from './blueprint.mjs';

const REGISTRY = 'https://registry.npmjs.org/';
const CATALOG = 'https://klarkxy.github.io/dsh-plugins/plugins.json';
const MAX_BYTES = 16 * 1024 * 1024;
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' ? value : null;
function packageName(value) {
  if (typeof value !== 'string' || value.length > 214 || !NAME.test(value)) throw new Error('Use an exact npm package name, not a URL, path or package@version.');
  return value;
}
function integer(value, fallback, min, max) {
  if (value === undefined) value = fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Expected an integer from ${min} to ${max}.`);
  return value;
}
function strings(value) {
  return object(value) ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string')) : {};
}
function link(value) {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}

// Read-only public registry access. No credentials, package downloads or code execution.
export class PluginRegistry {
  constructor({ fetcher = globalThis.fetch } = {}) {
    this.fetcher = fetcher;
    this.lifetime = new AbortController();
  }
  dispose() { this.lifetime.abort(); }
  async read(url, caller) {
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(20_000), ...caller ? [caller] : []]);
    signal.throwIfAborted();
    const response = await this.fetcher(url, { signal, redirect: 'error', credentials: 'omit', headers: { accept: 'application/json' } });
    if (signal.aborted) { await response.body?.cancel(); signal.throwIfAborted(); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`npm registry returned HTTP ${response.status}; no package or version was inferred.`);
    }
    if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      await response.body?.cancel(); throw new Error('npm registry did not return JSON.');
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel(); throw new Error('npm metadata exceeds the 16 MiB limit.');
    }
    if (!response.body) throw new Error('npm registry returned no body.');
    const reader = response.body.getReader(), chunks = [];
    let size = 0, complete = false;
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) { complete = true; break; }
        size += chunk.value.byteLength;
        if (size > MAX_BYTES) throw new Error('npm metadata exceeds the 16 MiB limit.');
        chunks.push(chunk.value);
      }
    } finally {
      if (!complete) await reader.cancel();
      reader.releaseLock();
    }
    signal.throwIfAborted();
    return { data: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), source: url, fetchedAt: new Date().toISOString() };
  }
  async search(args, signal) {
    closed(args, ['query', 'source', 'limit', 'offset'], 'plugin search');
    const query = text(args.query, 'search query', 200).trim();
    if (!query) throw new Error('Search query must not be blank.');
    const limit = integer(args.limit, 10, 1, 20), offset = integer(args.offset, 0, 0, 10000);
    const source = args.source === undefined ? 'catalog' : args.source;
    if (!['catalog', 'npm'].includes(source)) throw new Error('Search source must be catalog or npm.');
    if (source === 'catalog') {
      const { data, ...meta } = await this.read(CATALOG, signal);
      if (!object(data) || !Array.isArray(data.plugins)) throw new Error('Invalid plugin catalog.');
      const terms = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(query.toLowerCase())]
        .filter(part => part.isWordLike).map(part => part.segment);
      if (!terms.length) throw new Error('Use searchable words or a package name.');
      const matches = data.plugins.map(p => {
        packageName(p.package);
        if (!exactVersion(p.version)) throw new Error('Invalid catalog version.');
        const haystack = [p.package, p.title?.zh, p.title?.en, p.summary?.zh, p.summary?.en, p.category].join(' ').toLowerCase();
        return { p, score: (p.package.toLowerCase() === query.toLowerCase() ? 1000 : 0) + terms.filter(term => haystack.includes(term)).length };
      }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.p.package.localeCompare(b.p.package));
      return { ...meta, searchScope: 'published plugins in the klarkxy catalog; not all npm plugins',
        catalogGeneratedAt: string(data.generatedAt), query, total: matches.length, offset,
        nextOffset: offset + limit < matches.length ? offset + limit : null,
        results: matches.slice(offset, offset + limit).map(({ p }) => ({ name: p.package, version: p.version,
          title: { zh: string(p.title?.zh), en: string(p.title?.en) },
          summary: { zh: string(p.summary?.zh), en: string(p.summary?.en) },
          npm: `https://www.npmjs.com/package/${p.package}`, repository: link(p.repository),
          page: { zh: link(p.page?.zh), en: link(p.page?.en) }, verification: 'catalog-entry; recheck exact version with npm' })) };
    }
    const url = new URL('-/v1/search', REGISTRY);
    url.search = new URLSearchParams({ text: `${query} keywords:dsh-plugin`, size: String(limit), from: String(offset) }).toString();
    const { data, ...meta } = await this.read(url.href, signal);
    if (!object(data) || !Array.isArray(data.objects) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('Invalid npm search response.');
    const page = data.objects.slice(0, limit);
    const results = page.filter(item => /(?:^|[/\-])dsh(?:[-/]|$)/i.test(item?.package?.name ?? '')
      || (Array.isArray(item?.package?.keywords) && item.package.keywords.some(k => ['dsh', 'dsh-plugin', 'deepseek-harness', 'deepseek-harness-plugin'].includes(k))))
      .map(item => {
      const p = item?.package;
      if (!object(p) || !exactVersion(p.version)) throw new Error('Invalid npm search package.');
      return { name: packageName(p.name), version: p.version, description: string(p.description),
        npm: `https://www.npmjs.com/package/${p.name}`, homepage: link(p.links?.homepage), repository: link(p.links?.repository), verification: 'candidate-only' };
    });
    return { ...meta, searchScope: 'npm dsh-plugin keyword search, filtered by DSH name/keywords; not all packages and not verified bundles; total/offset refer to raw npm candidates',
      query, total: data.total, offset, nextOffset: page.length && offset + page.length < data.total ? offset + page.length : null, results };
  }
  async versions(args, signal) {
    closed(args, ['package', 'version', 'limit', 'offset'], 'plugin version lookup');
    const name = packageName(args.package), requested = args.version === undefined ? 'latest' : args.version;
    if (typeof requested !== 'string' || (!exactVersion(requested) && !/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(requested))) throw new Error('version must be an exact version or npm dist-tag, not a range.');
    const limit = integer(args.limit, 25, 1, 100), offset = integer(args.offset, 0, 0, 100000);
    const { data, ...meta } = await this.read(`${REGISTRY}${encodeURIComponent(name)}`, signal);
    if (!object(data) || data.name !== name || !object(data.versions)) throw new Error('Invalid npm package metadata.');
    const tags = strings(data['dist-tags']);
    const version = exactVersion(requested) ? requested : Object.hasOwn(tags, requested) ? tags[requested] : undefined;
    if (!exactVersion(version) || !Object.hasOwn(data.versions, version)) throw new Error(`Requested version or tag ${requested} is not published for ${name}.`);
    const manifest = data.versions[version];
    if (!object(manifest) || manifest.name !== name || manifest.version !== version) throw new Error('npm version identity does not match the requested package.');
    const versions = Object.keys(data.versions).filter(exactVersion).sort((a, b) =>
      (string(data.time?.[b]) ?? '').localeCompare(string(data.time?.[a]) ?? '') || a.localeCompare(b));
    const patch = string(manifest.dsh?.bundle?.patch);
    return { ...meta, package: name, requested, distTags: tags, totalVersions: versions.length, offset,
      order: 'publication time descending, then version text; not semver precedence',
      nextOffset: offset + limit < versions.length ? offset + limit : null,
      versions: versions.slice(offset, offset + limit).map(v => ({ version: v, publishedAt: string(data.time?.[v]), deprecated: string(data.versions[v]?.deprecated) })),
      selected: { name, version, source: 'npm', publishedAt: string(data.time?.[version]), description: string(manifest.description),
        bundleDeclared: Boolean(patch?.trim()), bundlePatch: patch, engines: strings(manifest.engines),
        dependencies: strings(manifest.dependencies), peerDependencies: strings(manifest.peerDependencies),
        deprecated: string(manifest.deprecated), homepage: link(manifest.homepage), npm: `https://www.npmjs.com/package/${name}/v/${version}` },
      notice: 'Registry metadata is untrusted reference data. A declared bundle and engines range are not runtime compatibility proof. Use the exact selected version in a draft; native import preview remains authoritative.' };
  }
}
