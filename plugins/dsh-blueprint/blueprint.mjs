import { fail, plain, forbidden, parseJson } from './codec.mjs';
export const PACKAGE = '@klarkxy/dsh-blueprint';
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const exactVersion = value => typeof value === 'string' && VERSION.test(value);
export function closed(value, keys, label) {
  if (!plain(value) || Object.keys(value).some(k => !keys.includes(k))) fail('shape', `Invalid ${label}.`);
}
export function text(value, label, max = 512) {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f]/.test(value)) fail('field', `Invalid ${label}.`);
  return value;
}
export function array(value, label, max = 512) {
  if (!Array.isArray(value) || value.length > max) fail('field', `Invalid ${label}.`); return value;
}
export function path(value) {
  array(value, 'field path', 64);
  if (!value.length) fail('path', 'Whole-form replacement is not supported.');
  for (const p of value) { text(p, 'path segment'); if (forbidden(p)) fail('path', 'Unsafe field path.'); }
  return value;
}
export const prefix = (a, b) => a.length <= b.length && a.every((v, i) => v === b[i]);
export const overlaps = (a, b) => prefix(a, b) || prefix(b, a);
export const identity = form => JSON.stringify([form.package, form.row, form.module]);
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function get(value, parts) {
  for (const part of parts) { if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined; value = value[part]; }
  return value;
}
export function validate(value) {
  // Also reject cycles, non-finite values, exotic objects and undefined before JSON conversion.
  function json(v, depth = 0) {
    if (depth > 64) fail('depth', 'Blueprint too deeply nested.');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v))) return;
    if (!Array.isArray(v) && !plain(v)) fail('json', 'Blueprint must contain JSON data only.');
    if (Array.isArray(v) && Object.keys(v).length !== v.length) fail('json', 'Sparse or decorated arrays are not supported.');
    for (const [k, x] of Object.entries(v)) { if (forbidden(k)) fail('key', 'Unsafe object key.'); json(x, depth + 1); }
  }
  json(value); value = parseJson(JSON.stringify(value));
  closed(value, ['kind', 'formatVersion', 'metadata', 'packages', 'bundles', 'settings', 'rows'], 'blueprint');
  if (value.kind !== 'dsh-blueprint' || value.formatVersion !== 2) fail('version', 'Only current-profile dsh-blueprint v2 is supported.');
  closed(value.metadata, ['name', 'version', 'description'], 'metadata'); text(value.metadata.name, 'name', 120);
  if (!exactVersion(value.metadata.version)) fail('version', 'Invalid blueprint release version.');
  if (value.metadata.description !== undefined) text(value.metadata.description, 'description', 4000);
  const names = new Set();
  for (const p of array(value.packages, 'packages', 128)) {
    closed(p, ['name', 'version', 'source'], 'package');
    if (typeof p.name !== 'string' || !NAME.test(p.name) || p.name.length > 214 || p.name === PACKAGE || names.has(p.name)) fail('package', 'Invalid, duplicate or self-referencing package.');
    if (!exactVersion(p.version) || !['npm', 'builtin'].includes(p.source)) fail('package', 'Packages require exact versions and known sources.');
    names.add(p.name);
  }
  const bundles = array(value.bundles, 'bundles', 128);
  if (new Set(bundles).size !== bundles.length || bundles.some(n => !names.has(n))) fail('bundle', 'Bundle order must reference unique selected packages.');
  const forms = new Set();
  for (const s of array(value.settings ?? [], 'settings', 256)) {
    closed(s, ['package', 'row', 'module', 'fields'], 'settings'); text(s.package, 'package'); text(s.row, 'row'); text(s.module, 'module');
    const id = identity(s); if (forms.has(id)) fail('settings', 'Duplicate form.'); forms.add(id);
    const seen = [];
    for (const f of array(s.fields, 'fields', 2048)) {
      closed(f, ['path', 'value'], 'field'); path(f.path);
      if (!Object.hasOwn(f, 'value') || seen.some(p => overlaps(p, f.path))) fail('path', 'Missing value or overlapping fields.');
      seen.push(f.path);
    }
  }
  const rows = new Set();
  for (const r of array(value.rows ?? [], 'rows', 512)) {
    closed(r, ['package', 'row', 'module', 'enabled'], 'row');
    text(r.package, 'package'); text(r.row, 'row'); text(r.module, 'module');
    if (typeof r.enabled !== 'boolean' || !names.has(r.package) || rows.has(identity(r))) fail('row', 'Invalid row state.');
    rows.add(identity(r));
  }
  return value;
}

/** Authors may narrow an editable form; absence means include every public field. */
export function policy(value) {
  if (value === undefined) return { exclude: [], include: null };
  closed(value, ['share', 'include', 'exclude'], 'share policy');
  if (value.share !== undefined && typeof value.share !== 'boolean') fail('policy', 'Invalid share policy.');
  const list = key => array(value[key] ?? [], key).map(path);
  return { exclude: list('exclude'), include: value.share === false ? [] : value.include === undefined ? null : list('include') };
}

/** Keep arrays atomic. If redaction touched an array, omit it instead of corrupting positions or secrets. */
export function publicFields(form, authorPolicy) {
  const p = policy(authorPolicy), omitted = [], fields = [];
  const blocked = [...p.exclude, ...(form.secrets ?? []).map(s => s.path)];
  function visit(v, at) {
    if (blocked.some(b => prefix(b, at))) { omitted.push({ path: at, reason: 'excluded-or-secret' }); return; }
    if (p.include !== null && !p.include.some(b => overlaps(b, at))) return;
    if (Array.isArray(v) && blocked.some(b => overlaps(b, at))) { omitted.push({ path: at, reason: 'array-contains-excluded-field' }); return; }
    if (plain(v) && Object.keys(v).length) {
      for (const [k, child] of Object.entries(v)) { if (!forbidden(k)) visit(child, [...at, k]); }
    } else if (at.length && v !== undefined) {
      if (p.include !== null && !p.include.some(b => prefix(b, at))) { omitted.push({ path: at, reason: 'partial-array-policy' }); return; }
      fields.push({ path: at, value: v });
    }
  }
  visit(form.value, []); return { fields, omitted };
}

/** An editable path must be volatile. Secret declarations in any schema branch win. */
export function schemaAllows(schema, at, proposed) {
  function permission(node, parts, live = false, seen = new Set()) {
    if (!node || seen.has(node)) return undefined;
    if (node.meta?.role === 'secret') return false;
    seen = new Set(seen).add(node); live ||= Boolean(node.meta?.volatile);
    if (node.type === 'union' || node.type === 'intersect') {
      const relevant = (node.list ?? []).map(n => permission(n, parts, live, seen)).filter(v => v !== undefined);
      return relevant.length ? relevant.every(Boolean) : undefined;
    }
    if (node.type === 'transform') return permission(node.inner, parts, live, seen);
    if (!parts.length) return live;
    const [head, ...tail] = parts;
    const next = node.type === 'object' ? node.dict?.[head] : ['dict', 'array'].includes(node.type) ? node.inner : undefined;
    return permission(next, tail, live, seen);
  }
  if (permission(schema, at) !== true) return false;
  if (Array.isArray(proposed) || plain(proposed)) {
    return Object.entries(proposed).every(([key, value]) => schemaAllows(schema, [...at, key], value));
  }
  return true; // The native Settings service validates the complete Config and callbacks on write.
}
