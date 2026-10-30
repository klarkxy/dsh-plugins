/*
 * Audit store for Safe Auto reviews. Owns the `dsh_safe_auto_audit` domain
 * (per-record layout; one row per reviewed approval request) so the runtime
 * and the ui-host history view share one durable log.
 *
 * Design notes:
 * - No delete API and no auto-expire: finish/execution may update a row in
 *   place, but history is never removed.
 * - `put` resolves only after durability and `update` is atomic on the
 *   domain's write chain, so finish/execution/merge patches via `update`
 *   never race; all writes in one domain serialize on its chain anyway.
 *   A local `tail` additionally orders begin->prepare->finish->execution.
 * - A row still `pending` when the domain reopens had its review interrupted
 *   by a host restart — it is reported as outcome `interrupted`, never as
 *   reviewed. Rows begun in this process honestly stay `pending`.
 * - The reviewer's verdict (`outcome`) and the host's native grant
 *   (`approvalState`) are two separate facts. Only an observed native
 *   decision confirms a grant, so a row that says the reviewer allowed the
 *   call but whose grant was never confirmed is reported as `interrupted`
 *   too — a grant nobody confirmed must not read as one. The reviewer's own
 *   details (risk, authorization, rationale) are preserved either way.
 * - Every persisted free-text field passes through `auditRedact` as a
 *   best-effort second line of defence: the caller already redacts, but a
 *   schema-less payload must never leak a raw secret to the medium.
 * - Oversize review payloads are never silently truncated: a field over its
 *   bound is replaced by an explicit marker and the redacted snapshot (up to
 *   1 MiB, sha256-tagged) lands in `capture`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';

export const AUDIT_DOMAIN_NAME = 'dsh_safe_auto_audit';
export const AUDIT_DOMAIN_VERSION = 1;

const MAX_ID = 128;
const MAX_KEY = 256;           // sessionId/agentId/callId
const MAX_SHORT = 256;         // tool/code/risk/authorization/…
const MAX_LONG = 320 * 1024;   // action/environment/input/policy (~320 KiB)
const MAX_TEXT = 64 * 1024;    // rationale/reason/error free text
const MAX_CAPTURE = 1024 * 1024;           // capture snapshot payload
const MAX_CAPTURE_FIELD = MAX_CAPTURE + 8192; // snapshot + truncation marker
const MAX_JSON_DEPTH = 6;        // nested JSON payloads are parsed this deep
const MAX_ATTEMPTS = 32;
const MAX_ATTEMPT_TEXT = MAX_LONG;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_QUERY = 256;
const MAX_CURSOR = 512;

const bounded = max => z.string().max(max);
const isoString = () => z.iso.datetime({ offset: true });

const triggerSchema = z.object({
  kind: z.enum(['dangerous-command', 'sandbox-escalation', 'approval']),
  rule: bounded(MAX_SHORT).optional(),
  reason: bounded(MAX_TEXT),
}).strict();

const reviewerSchema = z.object({
  provider: bounded(4096).optional(),
  model: bounded(4096).optional(),
  reasoningEffort: bounded(4096).optional(),
}).strict();

const settingsSchema = z.object({
  timeoutMs: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  maxTranscriptBytes: z.number().int().nonnegative().optional(),
  reviewerPrompt: bounded(MAX_TEXT).optional(),
}).strict();

const attemptSchema = z.object({
  attempt: z.number().int().nonnegative(),
  startedAt: bounded(64),
  finishedAt: bounded(64),
  response: bounded(MAX_ATTEMPT_TEXT).optional(), // raw reviewer reply, redacted
  error: bounded(MAX_TEXT).optional(),
}).strict();

const executionSchema = z.object({
  state: z.enum(['not-observed', 'succeeded', 'failed']),
  completedAt: bounded(64).optional(),
  error: bounded(MAX_TEXT).optional(),
}).strict();

/* The observed native approval decision, separate from the reviewer's verdict. */
export const APPROVAL_STATES = ['not-observed', 'allowed-once', 'rejected', 'cancelled', 'unavailable'];
const CONFIRMED_APPROVALS = new Set(['allowed-once', 'rejected', 'cancelled']);

const recordSchema = z.object({
  id: bounded(MAX_ID),
  sessionId: bounded(MAX_KEY),
  agentId: bounded(MAX_KEY),
  callId: bounded(MAX_KEY),
  tool: bounded(MAX_SHORT),
  turn: z.number().int().nullable(),
  trigger: triggerSchema,
  // Optional at begin(): the review input/environment/reviewer may not be
  // computed yet — begin persists as early as possible, prepare fills them in.
  action: bounded(MAX_LONG).optional(),      // redacted JSON string
  environment: bounded(MAX_LONG).optional(), // redacted JSON string
  input: bounded(MAX_LONG).optional(),       // redacted review prompt
  policy: bounded(MAX_LONG).optional(),      // system policy text
  reviewer: reviewerSchema.optional(),
  settings: settingsSchema.optional(),
  capture: bounded(MAX_CAPTURE_FIELD).optional(),
  attempts: z.array(attemptSchema).max(MAX_ATTEMPTS).optional(),
  status: z.enum(['pending', 'finished']),
  outcome: z.enum(['pending', 'allowed-once', 'rejected', 'cancelled']),
  // The host's native approval decision, observed after the review. Absent on
  // rows written before this field existed; 'not-observed' means the decision
  // has not been seen (yet).
  approvalState: z.enum(APPROVAL_STATES).optional(),
  code: bounded(MAX_SHORT).optional(),
  risk: bounded(MAX_SHORT).optional(),
  authorization: bounded(MAX_SHORT).optional(), // grant scope, not a credential
  rationale: bounded(MAX_TEXT).optional(),
  durationMs: z.number().nonnegative().optional(),
  startedAt: bounded(64),
  finishedAt: bounded(64).optional(),
  execution: executionSchema,
}).strict();

export const auditDomain = defineDomain({
  name: AUDIT_DOMAIN_NAME,
  version: AUDIT_DOMAIN_VERSION,
  layout: 'per-record',
  tables: { records: domainTable(recordSchema) },
});

/* ------------------------------------------------------------------ *
 * Best-effort audit redaction. Best-effort means: known credential shapes *
 * (sensitive keys, bearer/basic headers, URL credentials, common token    *
 * formats, PEM blocks, JWTs) are masked; an unknown secret shape can      *
 * survive — the caller's primary redaction stays responsible.             *
 *                                                                        *
 * A key is sensitive when its normalized name matches the list below        *
 * (lowercased, `[-_]` folded) or when its word segments name a credential   *
 * (`GITHUB_TOKEN`, `DB_PASSWORD`, `openaiApiKey`). Substring matching is     *
 * wrong: `outputTokens` is numeric review metadata, not a credential. The     *
 * record's own `authorization` field (reviewer grant scope 'high'/'turn') is  *
 * kept verbatim by the store, but this redactor does not exempt the key — a  *
 * caller that passes a nested `headers.Authorization` must still see it       *
 * masked; the store restores the top-level record field after redaction.     *
 * ------------------------------------------------------------------ */
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'pwd', 'passphrase', 'secret', 'apikey', 'apisecret',
  'token', 'accesstoken', 'authtoken', 'refreshtoken', 'idtoken', 'bearertoken',
  'credential', 'credentials', 'cookie', 'sessionkey',
  'privatekey', 'clientsecret', 'accesskey', 'secretkey', 'signingkey', 'sshkey',
  'authorization', 'xapikey', 'proxyauthorization', 'wwwauthenticate',
]);
const normalizeKey = key => key.toLowerCase().replace(/[-_\s]/g, '');
const REDACTED = '[REDACTED]';

/*
 * Credential words. A key names a credential when one of these words appears
 * in it as a whole word: `GITHUB_TOKEN`, `DB_PASSWORD`, `X-Custom-Token` and
 * `sessionSecret` all carry one. Substring matching would be wrong in both
 * directions — `outputTokens` is numeric review metadata, not a credential,
 * and `secretion` is not a secret — so the rules work on whole words.
 */
const SECRET_WORDS = new Set([
  'password', 'passwd', 'pwd', 'passphrase', 'secret', 'token', 'apikey',
  'credential', 'credentials', 'cookie', 'authorization', 'authenticate',
]);
/*
 * `key` alone is too broad — `sortKey`, `primaryKey` and `cacheKey` are not
 * credentials — so it only counts beside a qualifier that names a credential
 * holder: `AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`, `PRIVATE_KEY`.
 */
const KEY_QUALIFIERS = new Set([
  'secret', 'private', 'access', 'api', 'session', 'client', 'server', 'signing',
  'ssh', 'encryption', 'master', 'auth', 'credential', 'account', 'personal',
  'user', 'app', 'service', 'storage', 'database', 'db', 'aws', 'azure', 'gcp',
  'provider', 'bearer', 'refresh',
]);

/** Split a key into lowercased words across separators and camel-case runs. */
const keyWords = key => String(key)
  .split(/[^A-Za-z0-9]+/)
  .filter(Boolean)
  .flatMap(part => part.match(/[A-Z]{2,}(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g) ?? [])
  .map(word => word.toLowerCase());

/** True when the key names a credential, by exact name or by its word segments. */
const isSensitiveKey = key => {
  if (SENSITIVE_KEYS.has(normalizeKey(key))) return true;
  const words = keyWords(key);
  if (words.some(word => SECRET_WORDS.has(word))) return true;
  return words.includes('key') && words.some(word => KEY_QUALIFIERS.has(word));
};

function redactString(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  // Authorization / proxy headers and bearer-style credentials.
  out = out.replace(/\b(bearer|basic|digest|negotiate)\s+[A-Za-z0-9._~+/=-]{4,}/gi, '$1 ' + REDACTED);
  // Credential key=value pairs, including JSON-quoted keys ("apiKey":"v"):
  // the key name is checked against the credential rules, so 'outputTokens'
  // and ordinary keys survive while 'token'/'apiKey'/'GITHUB_TOKEN' mask.
  // The unquoted value is bounded by its delimiters only — a capped value
  // would mask just a prefix and leave the rest of the secret in the text.
  out = out.replace(/("?)([A-Za-z][A-Za-z0-9_-]{0,60})\1\s*[:=]\s*("((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|[^\s,;&"']+)/g,
    (m, _q, key, _val, dq, sq) => {
      if (!isSensitiveKey(key)) return m;
      if (dq !== undefined) return `"${key}":"${REDACTED}"`;
      if (sq !== undefined) return `'${key}':'${REDACTED}'`;
      return `${key}=${REDACTED}`;
    });
  // URL userinfo: scheme://user:pass@host
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]{1,15}:\/\/)([^/\s:@?#]+):([^/\s@?#]+)@/g, `$1${REDACTED}@`);
  // PEM blocks.
  out = out.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, REDACTED);
  // OpenAI / Anthropic / GitHub / Slack / AWS / Google / JWT-shaped tokens.
  out = out.replace(/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}\b/g, REDACTED);
  out = out.replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat|xox[baprs]|glpat|dop_v1|npm|pypi|hf|AIza|ya29|AKIA|ASIA)[A-Za-z0-9_-]{6,}\b/g, REDACTED);
  out = out.replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, REDACTED);
  return out;
}

/**
 * Best-effort recursive redaction for audit-facing data. Strings are scanned
 * for credential shapes; objects mask values of sensitive keys. Cycle-safe.
 * Exported so the caller can pre-redact records before persistence.
 */
export function auditRedact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Whole-string JSON payloads (action/environment/input are serialized
    // JSON) get structural redaction so escaped secrets like "apiKey":"a\b"
    // are masked by key, not just by regex. A nested JSON string is parsed
    // too: the regex cannot see a credential that sits inside a quoted
    // value of a non-sensitive key ("command":"token=…"), so the payload is
    // masked by key instead. The depth cap keeps the expansion bounded.
    if (depth <= MAX_JSON_DEPTH && (value.startsWith('{') || value.startsWith('['))) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          return JSON.stringify(auditRedact(parsed, depth + 1, seen));
        }
      } catch { /* not JSON — fall through to regex pass */ }
    }
    return redactString(value);
  }
  if (typeof value !== 'object') return value;
  if (depth > 24 || seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => auditRedact(item, depth + 1, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key) && item !== null && item !== undefined) { out[key] = REDACTED; continue; }
    out[key] = auditRedact(item, depth + 1, seen);
  }
  return out;
}

/**
 * Redact a record patch while preserving the record's own `authorization`
 * field — the reviewer grant scope, not a credential. Nested authorization
 * headers inside free-text fields are still masked by redactString.
 */
function redactPatch(patch) {
  const authorization = patch.authorization;
  const out = auditRedact(patch);
  if (authorization !== undefined) out.authorization = authorization;
  return out;
}

/**
 * Serialize an arbitrary capture value to a bounded redacted snapshot string.
 * Strings pass through as-is; objects are JSON-serialized; unserializable
 * values degrade to a placeholder. Snapshots over `maxBytes` are truncated
 * with an explicit `[truncated … sha256=…]` marker — never silently.
 * @returns {string|undefined}
 */
export function auditedCapture(value, maxBytes = MAX_CAPTURE) {
  if (value === undefined) return undefined;
  let text;
  if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(auditRedact(value)); }
    catch { text = '[unserializable capture]'; }
  }
  text = redactString(text);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) return text;
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  const marker = `\n…[audit capture truncated: original ${bytes} bytes, sha256=${sha256}]`;
  // Byte-bounded truncation at a code-point boundary: slice the UTF-8 buffer,
  // then back off at most 3 bytes — UTF-8 continuation bytes share the
  // 10xxxxxx pattern, so landing mid-sequence is detected cheaply without a
  // per-character O(n²) rescan. A partial surrogate pair at the cut is also
  // impossible here because the boundary is a whole code point.
  const budget = maxBytes - Buffer.byteLength(marker, 'utf8');
  const buf = Buffer.from(text, 'utf8');
  let end = Math.min(buf.length, Math.max(0, budget));
  // The cut splits a code point when the byte AT the cut is a UTF-8
  // continuation (0b10xxxxxx). Walk back over the whole incomplete sequence —
  // its lead byte is 1–4 bytes earlier (0b110xxxxx 2B / 0b1110xxxx 3B /
  // 0b11110xxx 4B) — so the surviving prefix ends on a complete code point
  // and no U+FFFD / stray surrogate is emitted by toString.
  if (end < buf.length && (buf[end] & 0b1100_0000) === 0b1000_0000) {
    // Walk back over the continuation bytes; `end` lands on the sequence's
    // lead byte index and subarray(0, end) excludes the incomplete sequence.
    while (end > 0 && (buf[end] & 0b1100_0000) === 0b1000_0000) end--;
  }
  return buf.subarray(0, Math.max(0, end)).toString('utf8') + marker;
}

/* ------------------------------------------------ validation helpers */
const invalid = message => { const e = new Error(message); e.code = 'AUDIT_INVALID'; return e; };

function boundedString(value, field, max) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw invalid(`audit: ${field} must be a string of at most ${max} chars`);
  return value;
}

const listPayloadSchema = z.object({
  sessionId: bounded(MAX_SHORT).optional(),
  tool: bounded(MAX_SHORT).optional(),
  outcome: z.enum(['pending', 'interrupted', 'allowed-once', 'rejected', 'cancelled']).optional(),
  risk: bounded(MAX_SHORT).optional(),
  from: isoString().optional(),
  to: isoString().optional(),
  query: bounded(MAX_QUERY).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  cursor: bounded(MAX_CURSOR).optional(),
}).strict();

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.startedAt, row.id]), 'utf8').toString('base64url');
}
function decodeCursor(cursor) {
  let parsed;
  try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { throw invalid('audit: invalid cursor'); }
  if (!Array.isArray(parsed) || parsed.length !== 2
    || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string'
    || parsed[0].length > 64 || parsed[1].length > MAX_ID) throw invalid('audit: invalid cursor');
  return { startedAt: parsed[0], id: parsed[1] };
}

/* Stable ordering: startedAt desc, id desc. */
const byStartedDesc = (a, b) => a.startedAt === b.startedAt
  ? (a.id < b.id ? 1 : -1)
  : (a.startedAt < b.startedAt ? 1 : -1);
const afterCursor = (row, c) => row.startedAt < c.startedAt
  || (row.startedAt === c.startedAt && row.id < c.id);

/** Fields kept out of list summaries: the heavy context/action payloads. */
const HEAVY = new Set(['action', 'environment', 'input', 'policy', 'capture', 'attempts', 'settings']);

/* Fields that may carry oversize content moved into capture. */
const OVERSIZE_FIELDS = new Set(['action', 'environment', 'input', 'policy']);

/**
 * Apply oversize handling to a patch before persistence: any long field over
 * its bound is replaced by an explicit marker and its redacted snapshot (up
 * to 1 MiB, sha256-tagged) is appended to `capture`.
 */
function foldOversize(patch) {
  const captures = [];
  const next = { ...patch };
  for (const field of OVERSIZE_FIELDS) {
    const value = next[field];
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') <= MAX_LONG) continue;
    const bytes = Buffer.byteLength(value, 'utf8');
    const sha256 = createHash('sha256').update(value, 'utf8').digest('hex');
    captures.push(`--- ${field} (${bytes} bytes, sha256=${sha256}) ---\n${auditedCapture(value)}`);
    next[field] = `[${field}: ${bytes} bytes over the ${MAX_LONG}-byte audit field limit; redacted snapshot in capture, sha256=${sha256}]`;
  }
  if (captures.length > 0) {
    const prior = typeof next.capture === 'string' && next.capture.length > 0 ? `${next.capture}\n` : '';
    next.capture = auditedCapture(prior + captures.join('\n'), MAX_CAPTURE_FIELD);
  }
  return next;
}

/**
 * Open the audit store over the given storageDomain service.
 * Minimal table contract the store relies on (see test/audit.test.js for a
 * fake): `get(key)` sync read; `entries()` sync snapshot iterator;
 * `put(key, row)` resolves after durability (a rejection leaves reads
 * unchanged); `update(key, fn)` is an atomic serialized read-modify-write
 * that rejects when the key is missing; `close()` drains queued writes.
 * @param {{open: (spec: typeof auditDomain) => Promise<{table: (name: string) => object, close: () => Promise<void>}>}} storageDomain
 */
export async function openAudit(storageDomain) {
  if (!storageDomain || typeof storageDomain.open !== 'function') throw invalid('audit: storageDomain.open is required');
  const domain = await storageDomain.open(auditDomain);
  const table = domain.table('records');
  // Rows unfinished when the domain reopened: their review never resolved
  // (host restart mid-review). Report them interrupted, never as reviewed.
  const interrupted = new Set();
  // Rows stored before this process opened the domain whose reviewer verdict
  // was a grant: no native decision confirmed them here, so they must not
  // read as a confirmed grant once the domain is reopened.
  const unconfirmedGrants = new Set();
  for (const [id, row] of table.entries()) {
    if (row?.outcome === 'pending') interrupted.add(id);
    else if (row?.outcome === 'allowed-once' && !CONFIRMED_APPROVALS.has(row.approvalState)) unconfirmedGrants.add(id);
  }
  // Local write tail keeps begin/prepare/finish/execution strictly ordered
  // even under concurrent callers; the domain chain serializes durability.
  let tail = Promise.resolve();
  const enqueue = op => {
    const run = tail.then(op, op);
    tail = run.then(() => {}, () => {});
    return run;
  };
  /*
   * The outcome a reader sees. Two facts are kept apart: `outcome` is the
   * reviewer's verdict, `approvalState` is the native decision the host
   * reported. A pending row that was still unfinished when the domain reopened
   * never resolved ('interrupted'). A grant is only effective when the host
   * confirmed it: an observed rejection or cancellation stands, and a grant
   * nobody confirmed is reported as interrupted. The reviewer's own details
   * (code, risk, authorization, rationale) are preserved either way.
   */
  const reportedOutcome = row => {
    if (row.outcome === 'pending') return interrupted.has(row.id) ? 'interrupted' : 'pending';
    if (row.outcome !== 'allowed-once') return row.outcome;
    if (row.approvalState === 'allowed-once') return 'allowed-once';
    if (row.approvalState === 'rejected' || row.approvalState === 'cancelled') return row.approvalState;
    return unconfirmedGrants.has(row.id) ? 'interrupted' : 'allowed-once';
  };
  /** Apply the reported outcome and its marker to a copy of the record. */
  const decorate = (row, out) => {
    const outcome = reportedOutcome(row);
    if (outcome !== row.outcome) {
      out.outcome = outcome;
      // The reviewer's own verdict stays visible next to the reported one.
      out.reviewOutcome = row.outcome;
    }
    if (row.outcome === 'pending' && interrupted.has(row.id)) out.interrupted = true;
    else if (outcome === 'interrupted' && row.outcome === 'allowed-once') out.unconfirmed = true;
    return out;
  };
  const view = row => {
    if (row === undefined) return undefined;
    // Schema-validated rows may retain undefined optional fields in memory.
    // Match their persisted JSON form and detach the caller's copy.
    const next = { ...JSON.parse(JSON.stringify(row)), executionState: row.execution?.state ?? 'not-observed' };
    return decorate(row, next);
  };
  /*
   * List summary. The heavy payloads (action/environment/input/policy/capture/
   * attempts/settings) are dropped from a summary anyway, so only the
   * lightweight fields are collected and copied — cloning the whole row would
   * copy the entire history on every page. The collected fields are copied
   * once, so a caller cannot reach the authoritative row through a summary.
   */
  const summary = row => {
    const light = {};
    for (const [key, value] of Object.entries(row)) if (!HEAVY.has(key)) light[key] = value;
    const out = JSON.parse(JSON.stringify(light));
    out.executionState = row.execution?.state ?? 'not-observed';
    decorate(row, out);
    return out;
  };
  /*
   * Free-text search over the record's fields, in full — the heavy fields are
   * searched as they are stored, never truncated. Each field is searched on
   * its own and the scan short-circuits on the first hit, so a query costs
   * one pass per field instead of one concatenated haystack.
   */
  const SEARCH_VALUES = row => [row.tool, row.callId, row.sessionId, row.agentId, row.trigger?.reason,
    row.code, row.rationale, row.risk, row.outcome, row.action, row.input];
  const matchesNeedle = (row, needle) => {
    for (const value of SEARCH_VALUES(row)) {
      if (typeof value === 'string' && value.toLowerCase().includes(needle)) return true;
    }
    return false;
  };

  const validateAttempts = attempts => {
    if (!Array.isArray(attempts) || attempts.length > MAX_ATTEMPTS) throw invalid('audit: attempts must be a bounded array');
    for (const a of attempts) {
      if (!a || typeof a !== 'object' || !Number.isInteger(a.attempt) || a.attempt < 0) throw invalid('audit: malformed attempt');
      boundedString(a.startedAt, 'attempts.startedAt', 64);
      boundedString(a.finishedAt, 'attempts.finishedAt', 64);
      boundedString(a.response, 'attempts.response', MAX_ATTEMPT_TEXT);
      boundedString(a.error, 'attempts.error', MAX_TEXT);
    }
  };
  const validatePatch = patch => {
    if (patch.code !== undefined) boundedString(patch.code, 'code', MAX_SHORT);
    if (patch.risk !== undefined) boundedString(patch.risk, 'risk', MAX_SHORT);
    if (patch.authorization !== undefined) boundedString(patch.authorization, 'authorization', MAX_SHORT);
    if (patch.rationale !== undefined) boundedString(patch.rationale, 'rationale', MAX_TEXT);
    if (patch.durationMs !== undefined && (typeof patch.durationMs !== 'number' || !(patch.durationMs >= 0))) {
      throw invalid('audit: durationMs must be a non-negative number');
    }
    if (patch.attempts !== undefined) validateAttempts(patch.attempts);
    // Oversize long fields are folded into capture before the bound check so
    // the check applies to the explicit marker that remains.
    for (const field of OVERSIZE_FIELDS) {
      if (patch[field] !== undefined && typeof patch[field] !== 'string') throw invalid(`audit: ${field} must be a string`);
    }
    if (patch.capture !== undefined && typeof patch.capture !== 'string') throw invalid('audit: capture must be a string');
    if (patch.reviewer !== undefined) reviewerSchema.parse(patch.reviewer);
    if (patch.settings !== undefined) settingsSchema.parse(patch.settings);
  };
  const checkId = id => { if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID) throw invalid('audit: id is required'); };

  const store = {
    /** Persist a fresh pending review record as early as possible; resolves with its id. */
    begin(record) {
      return enqueue(async () => {
        const now = new Date().toISOString();
        const id = randomUUID();
        if (!record || typeof record !== 'object') throw invalid('audit: begin requires a record');
        const row = {
          id,
          sessionId: boundedString(record.sessionId, 'sessionId', MAX_KEY),
          agentId: boundedString(record.agentId, 'agentId', MAX_KEY) ?? '',
          callId: boundedString(record.callId, 'callId', MAX_KEY) ?? '',
          tool: boundedString(record.tool, 'tool', MAX_SHORT),
          turn: record.turn === undefined ? null : record.turn,
          trigger: record.trigger,
          action: record.action,
          environment: record.environment,
          input: record.input,
          policy: record.policy,
          reviewer: record.reviewer,
          settings: record.settings,
          capture: record.capture,
          status: 'pending',
          outcome: 'pending',
          approvalState: 'not-observed',
          startedAt: now,
          execution: { state: 'not-observed' },
        };
        if (row.sessionId === undefined) throw invalid('audit: sessionId is required');
        if (row.tool === undefined) throw invalid('audit: tool is required');
        if (row.turn !== null && !Number.isInteger(row.turn)) throw invalid('audit: turn must be an integer or null');
        for (const field of OVERSIZE_FIELDS) {
          if (row[field] !== undefined && typeof row[field] !== 'string') throw invalid(`audit: ${field} must be a string`);
        }
        if (row.capture !== undefined && typeof row.capture !== 'string') throw invalid('audit: capture must be a string');
        const persisted = recordSchema.parse(redactPatch(foldOversize(row)));
        await table.put(id, persisted);
        return id;
      });
    },

    /**
     * Persist the actual review request before calling the model, and each
     * finished review attempt's raw reply/error before retrying:
     * input/environment/reviewer/capture/action/policy/attempts on a
     * still-pending record. Never sets finishedAt; rejects once the record
     * is finished.
     */
    prepare(id, patch) {
      return enqueue(async () => {
        checkId(id);
        if (!patch || typeof patch !== 'object') throw invalid('audit: prepare requires a patch');
        const allowed = ['input', 'environment', 'reviewer', 'capture', 'action', 'policy', 'attempts'];
        const merged = {};
        for (const key of Object.keys(patch)) {
          if (!allowed.includes(key)) throw invalid(`audit: prepare cannot set ${key}`);
          if (patch[key] !== undefined) merged[key] = patch[key];
        }
        validatePatch(merged);
        await table.update(id, current => {
          if (current.outcome !== 'pending') throw invalid('audit: prepare rejected — record already finished');
          const next = { ...current, ...redactPatch(foldOversize(merged)) };
          recordSchema.parse(next); // validate before returning — never persist a bad row
          return next;
        });
      });
    },

    /** Merge the review verdict patch into a record; sets finishedAt and attempts. */
    finish(id, patch) {
      return enqueue(async () => {
        checkId(id);
        const outcome = patch?.outcome;
        if (!['allowed-once', 'rejected', 'cancelled'].includes(outcome)) {
          throw invalid('audit: outcome must be allowed-once, rejected or cancelled');
        }
        const allowed = ['code', 'durationMs', 'risk', 'authorization', 'rationale',
          'input', 'environment', 'reviewer', 'capture', 'attempts', 'settings', 'policy', 'action'];
        const merged = {};
        for (const key of Object.keys(patch)) {
          if (key === 'outcome') continue;
          if (!allowed.includes(key)) throw invalid(`audit: finish cannot set ${key}`);
          if (patch[key] !== undefined) merged[key] = patch[key];
        }
        merged.outcome = outcome;
        validatePatch(merged);
        const finishedAt = new Date().toISOString();
        await table.update(id, current => {
          // Transitions: pending may take any verdict; a finished row may only
          // be re-written to 'cancelled' by the final pre-approval re-check
          // (a granted review invalidated while its durable write was in flight).
          if (current.outcome !== 'pending' && !(current.outcome === 'allowed-once' && outcome === 'cancelled')) {
            throw invalid('audit: cannot finish a record with outcome ' + current.outcome);
          }
          const next = { ...current, ...redactPatch(foldOversize(merged)), status: 'finished', finishedAt };
          recordSchema.parse(next);
          return next;
        });
      });
    },

    /**
     * Record the native approval decision the host reported for this review.
     * The reviewer's verdict is untouched: `outcome` says what the reviewer
     * decided, `approvalState` says what the host confirmed. Only an observed
     * decision counts as a confirmation, so a row whose grant was never
     * confirmed is reported as interrupted instead of allowed.
     */
    approval(id, result) {
      return enqueue(async () => {
        checkId(id);
        const state = result?.outcome;
        if (!['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(state)) {
          throw invalid('audit: approval outcome must be allowed-once, rejected, cancelled or unavailable');
        }
        await table.update(id, current => {
          const next = { ...current, approvalState: state };
          recordSchema.parse(next);
          return next;
        });
      });
    },

    /** Record whether the approved call actually ran afterwards. */
    execution(id, result) {
      return enqueue(async () => {
        checkId(id);
        const state = result?.state;
        if (!['succeeded', 'failed'].includes(state)) throw invalid('audit: execution state must be succeeded or failed');
        const completedAt = result?.completedAt === undefined
          ? new Date().toISOString()
          : boundedString(result.completedAt, 'completedAt', 64);
        const error = boundedString(result?.error, 'error', MAX_TEXT);
        await table.update(id, current => {
          const next = { ...current, execution: { state, completedAt, ...(error ? { error: redactString(error) } : {}) } };
          recordSchema.parse(next);
          return next;
        });
      });
    },

    /**
     * Synchronous filtered listing, newest first, keyset-paginated so new
     * inserts during iteration never shift page boundaries.
     * @returns {{items: object[], nextCursor?: string, total: number}}
     */
    list(payload = {}) {
      const filter = listPayloadSchema.parse(payload ?? {});
      const limit = filter.limit ?? DEFAULT_LIMIT;
      const cursor = filter.cursor === undefined ? undefined : decodeCursor(filter.cursor);
      const needle = filter.query === undefined ? undefined : filter.query.toLowerCase();
      const fromMs = filter.from === undefined ? undefined : Date.parse(filter.from);
      const toMs = filter.to === undefined ? undefined : Date.parse(filter.to);
      if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) throw invalid('audit: from must not be after to');
      const rows = [];
      let total = 0;
      for (const [, row] of table.entries()) {
        if (!row) continue;
        if (filter.sessionId !== undefined && row.sessionId !== filter.sessionId) continue;
        if (filter.tool !== undefined && row.tool !== filter.tool) continue;
        if (filter.risk !== undefined && row.risk !== filter.risk) continue;
        const startedMs = Date.parse(row.startedAt);
        if (fromMs !== undefined && !(startedMs >= fromMs)) continue;
        if (toMs !== undefined && !(startedMs <= toMs)) continue;
        if (filter.outcome !== undefined && reportedOutcome(row) !== filter.outcome) continue;
        if (needle !== undefined && !matchesNeedle(row, needle)) continue;
        total++;
        rows.push(row);
      }
      rows.sort(byStartedDesc);
      const page = [];
      for (const row of rows) {
        if (page.length >= limit) break;
        if (cursor && !afterCursor(row, cursor)) continue;
        page.push(row);
      }
      const last = page[page.length - 1];
      const hasMore = last !== undefined && rows.some(row => afterCursor(row, { startedAt: last.startedAt, id: last.id }));
      return { items: page.map(summary), ...(hasMore ? { nextCursor: encodeCursor(last) } : {}), total };
    },

    /** Synchronous full record read, including heavy fields. */
    get(payload = {}) {
      if (!payload || typeof payload !== 'object') throw invalid('audit: get requires {id}');
      for (const key of Object.keys(payload)) if (key !== 'id') throw invalid(`audit: unknown get field ${key}`);
      if (typeof payload.id !== 'string' || payload.id.length > MAX_ID) throw invalid('audit: get requires {id}');
      const row = view(table.get(payload.id));
      if (row === undefined) { const e = new Error('audit: record not found'); e.code = 'AUDIT_NOT_FOUND'; throw e; }
      return row;
    },

    /** Drain queued writes and close the domain. */
    async close() {
      await tail.catch(() => {});
      await domain.close();
    },
  };
  return store;
}
