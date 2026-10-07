import { createHash } from 'node:crypto';
import { readFile as readExisting, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { ModelBinding, ModelProfile, ModelRoute, NormalizedRole } from './contracts.js';
import { validateRoles } from './config.js';
import { validateModelProfiles } from './model-profiles.js';
import { validateProtectedModels } from './model-protection.js';

const ACTIVE_TASK_STATES = new Set(['dispatching', 'working', 'review', 'decision']);
const PROFILE_NAME_MAX = 100;
const PROFILE_DESCRIPTION_MAX = 200;

export class FusionMigrateError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FusionMigrateError';
    this.code = code;
  }
}

export type FusionMigrateCode =
  | 'INVALID_STORE'
  | 'INVALID_CLASSMATES'
  | 'HASH_MISMATCH'
  | 'ACTIVE_TASK'
  | 'CONFLICT'
  | 'PATH_COLLISION'
  | 'DESTINATION_CONFLICT';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: FusionMigrateCode, message: string): never {
  throw new FusionMigrateError(code, message);
}

function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) {
    fail('INVALID_STORE', `${label} must be ${empty ? '0' : '1'}–${max} characters.`);
  }
  return value;
}

export function sha256Hex(bytes: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface FusionArchiveCandidate {
  id: string;
  revision: number;
  hash: string;
  text: string;
  report: string;
  createdAt: number;
}

export interface FusionArchiveReview {
  candidateId: string;
  candidateHash: string;
  verdict: string;
  feedback: string;
  createdAt: number;
}

export interface FusionArchiveTask {
  id: string;
  revision: number;
  state: string;
  title: string;
  goal: string;
  candidates: FusionArchiveCandidate[];
  reviews: FusionArchiveReview[];
  cleanup?: string;
  applicationState?: string;
  adoption?: string;
}

export interface FusionArchivePair {
  id: string;
  leadSessionId: string;
  childSessionId: string;
  project: string;
  profile: string;
  route: { provider: string; model: string; reasoningEffort?: string };
  tasks: FusionArchiveTask[];
}

export interface ExtractedRoute {
  provider: string;
  id: string;
  reasoningEffort?: string;
  sources: string[];
}

export interface ClassmatesConfigShape {
  roles: NormalizedRole[];
  modelProfiles: ModelProfile[];
  protectedModels: ModelRoute[];
}

export interface ProfileDelta {
  added: ModelProfile[];
  reused: Array<{ id: string; reason: 'same-id' | 'same-route' }>;
}

export interface FusionMigrationResult {
  sourceSha256: string;
  sourceBytes: Buffer;
  classmates: ClassmatesConfigShape;
  delta: ProfileDelta;
  routes: ExtractedRoute[];
  pairs: FusionArchivePair[];
  apply: string;
}

export const APPLY_INSTRUCTIONS = [
  'This utility never writes .dsh, credentials, native settings, or sessions.',
  'Review the generated modelProfiles, then apply them with existing native settings or Creator APIs:',
  '1. Creator: classmates_read, then classmates_models_batch upsert each added profile at revision 0 (they are disabled).',
  '2. Or replace the classmates namespace value { roles, modelProfiles, protectedModels } in native plugin settings with the --output JSON after review. Do not paste into credential files.',
  '3. Enable only the profiles you want. In the role editor, choose Inherit, Model preset (a binding to an enabled profile), or Specific model. A missing or disabled bound profile rejects dispatch; no fallback is selected.',
  'Legacy recommendedModelProfileId migrates to a profile binding when the role has no fixed model. A legacy fixed model takes precedence and retains the old recommendation only as a migration note.',
  'Original Fusion store bytes are exported unchanged. Native sessions and the input Fusion file are not modified. Local apply/cutover belongs to primary.',
].join('\n');

function fusionUnit(parsed: Record<string, unknown>): { name: unknown; version: unknown } | undefined {
  if (parsed.name === 'dsh_fusion') return { name: parsed.name, version: parsed.version };
  if (isRecord(parsed.unit) && parsed.unit.name === 'dsh_fusion') {
    return { name: parsed.unit.name, version: parsed.unit.version };
  }
  return undefined;
}

function unwrapFusionState(parsed: unknown): unknown {
  if (!isRecord(parsed)) fail('INVALID_STORE', 'Fusion input must be a JSON object.');
  const unit = fusionUnit(parsed);
  if (unit) {
    if (unit.version !== 1 && unit.version !== 2) {
      fail('INVALID_STORE', 'Fusion envelope version must be 1 or 2.');
    }
    const tables = isRecord(parsed.tables) ? parsed.tables : undefined;
    const table = tables && isRecord(tables.state) ? tables.state : undefined;
    if (!table) fail('INVALID_STORE', 'Fusion envelope is missing tables.state.');
    if ('state' in table) return table.state;
    const records = isRecord(table.records) ? table.records : undefined;
    if (records && 'state' in records) return records.state;
    fail('INVALID_STORE', 'Fusion envelope is missing tables.state.state.');
  }
  if ('pairs' in parsed) return parsed;
  if (isRecord(parsed.state) && Array.isArray(parsed.state.pairs)) return parsed.state;
  fail('INVALID_STORE', 'Unsupported Fusion JSON. Use dsh-storage-domain { unit: { name: "dsh_fusion", version: 1|2 }, tables: { state: { state } } }, a root name envelope, or a raw { version, revision, pairs } document.');
}

function parseRoute(value: unknown, label: string): { provider: string; model: string; reasoningEffort?: string } {
  if (!isRecord(value)) fail('INVALID_STORE', `${label} route is invalid.`);
  const provider = text(value.provider, `${label} provider`, 300);
  const model = text(value.model, `${label} model`, 300);
  const reasoningEffort = value.reasoningEffort === undefined
    ? undefined
    : text(value.reasoningEffort, `${label} reasoningEffort`, 100);
  return reasoningEffort ? { provider, model, reasoningEffort } : { provider, model };
}

function selectionMode(row: Record<string, unknown>): 'off' | 'follow' | 'fixed' {
  if (row.mode === 'off' || row.mode === 'follow' || row.mode === 'fixed') return row.mode;
  if (row.mode !== undefined) fail('INVALID_STORE', 'Unknown Sidekick selection mode.');
  const provider = typeof row.provider === 'string' ? row.provider : '';
  const model = typeof row.model === 'string' ? row.model : '';
  return provider && model ? 'fixed' : 'follow';
}

function maybeFixedSelection(value: unknown, source: string): ExtractedRoute | undefined {
  if (!isRecord(value)) fail('INVALID_STORE', `${source} selection is invalid.`);
  const mode = selectionMode(value);
  if (mode === 'off' || mode === 'follow') return undefined;
  const route = parseRoute(value, source);
  return {
    provider: route.provider,
    id: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
    sources: [source],
  };
}

function parseCandidate(value: unknown, index: number): FusionArchiveCandidate {
  if (!isRecord(value)) fail('INVALID_STORE', 'Candidate is invalid.');
  const id = text(value.id, 'candidate id', 200);
  const textValue = text(value.text, 'candidate', 200_000, true);
  const hash = text(value.hash, 'candidate hash', 64);
  if (!/^[a-f0-9]{64}$/.test(hash)) fail('INVALID_STORE', 'Invalid candidate hash.');
  if (sha256Hex(textValue) !== hash) {
    fail('HASH_MISMATCH', `Candidate ${id} content does not match its stored SHA-256.`);
  }
  if (!Number.isSafeInteger(value.revision) || value.revision !== index + 1) {
    fail('INVALID_STORE', 'Invalid candidate order.');
  }
  if (typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    fail('INVALID_STORE', 'Invalid candidate timestamp.');
  }
  return {
    id,
    revision: value.revision as number,
    hash,
    text: textValue,
    report: text(value.report ?? '', 'report', 16_000, true),
    createdAt: value.createdAt,
  };
}

function parseReview(value: unknown, hashes: Map<string, string>): FusionArchiveReview {
  if (!isRecord(value)) fail('INVALID_STORE', 'Review is invalid.');
  const candidateId = text(value.candidateId, 'review candidate', 200);
  const candidateHash = text(value.candidateHash, 'review hash', 64);
  if (hashes.get(candidateId) !== candidateHash) {
    fail('HASH_MISMATCH', `Review for ${candidateId} does not match a stored candidate hash.`);
  }
  if (!['accept', 'revise', 'reject'].includes(String(value.verdict))) {
    fail('INVALID_STORE', 'Invalid review verdict.');
  }
  if (typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    fail('INVALID_STORE', 'Invalid review timestamp.');
  }
  return {
    candidateId,
    candidateHash,
    verdict: String(value.verdict),
    feedback: text(value.feedback ?? '', 'feedback', 16_000, true),
    createdAt: value.createdAt,
  };
}

function unsettledTaskReason(
  state: string,
  cleanup: string | undefined,
  adoption: string | undefined,
  applicationState: string | undefined,
): string | undefined {
  if (ACTIVE_TASK_STATES.has(state)) return state;
  if (cleanup === 'pending' || cleanup === 'failed') return `cleanup ${cleanup}`;
  if (adoption === 'pending' || adoption === 'conflict') return `adoption ${adoption}`;
  if (applicationState === 'pending') return `application ${applicationState}`;
  if (applicationState === 'conflict' && adoption !== 'dismissed') return `application ${applicationState}`;
  return undefined;
}

function parseTask(value: unknown): FusionArchiveTask {
  if (!isRecord(value)) fail('INVALID_STORE', 'Task is invalid.');
  const id = text(value.id, 'task id', 200);
  const state = text(value.state, 'task state', 40);
  const cleanup = value.cleanup === undefined ? undefined : text(value.cleanup, 'cleanup', 20);
  const adoption = value.adoption === undefined ? undefined : text(value.adoption, 'adoption', 20);
  let applicationState: string | undefined;
  if (value.application !== undefined) {
    if (!isRecord(value.application)) fail('INVALID_STORE', 'Application is invalid.');
    applicationState = text(value.application.state, 'application state', 20);
  }
  // Conservatively require settlement before retirement. Fusion writing tasks
  // become accepted with adoption:'pending' and no application; pending/conflict
  // adoption, application pending, application conflict unless dismissed, and
  // cleanup failed are still unresolved. Dismissed historical application
  // conflict is settled (Fusion dismiss changes only adoption) and archived
  // unchanged. This tool never replays, cancels, adopts, or mutates Fusion state.
  const unsettled = unsettledTaskReason(state, cleanup, adoption, applicationState);
  if (unsettled) {
    fail('ACTIVE_TASK', `Task ${id} is still ${unsettled}; refuse replay or cancel. Settle it in Fusion before migrating.`);
  }
  if (!Array.isArray(value.candidates) || value.candidates.length > 16) fail('INVALID_STORE', 'Invalid candidate history.');
  if (!Array.isArray(value.reviews) || value.reviews.length > 32) fail('INVALID_STORE', 'Invalid review history.');
  const candidates = value.candidates.map((item, index) => parseCandidate(item, index));
  const hashes = new Map(candidates.map(item => [item.id, item.hash]));
  const reviews = value.reviews.map(item => parseReview(item, hashes));
  const brief = isRecord(value.brief) ? value.brief : fail('INVALID_STORE', 'Task brief is invalid.');
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    fail('INVALID_STORE', 'Invalid task revision.');
  }
  return {
    id,
    revision: value.revision as number,
    state,
    title: text(brief.title, 'title', 120),
    goal: text(brief.goal, 'goal', 8000),
    candidates,
    reviews,
    ...cleanup === undefined ? {} : { cleanup },
    ...applicationState === undefined ? {} : { applicationState },
    ...adoption === undefined ? {} : { adoption },
  };
}

function parsePair(value: unknown): FusionArchivePair {
  if (!isRecord(value)) fail('INVALID_STORE', 'Pair is invalid.');
  if (!Array.isArray(value.tasks) || value.tasks.length > 128) fail('INVALID_STORE', 'Invalid task table.');
  const route = parseRoute(value.route, 'pair');
  return {
    id: text(value.id, 'pair id', 200),
    leadSessionId: text(value.leadSessionId, 'lead id', 200),
    childSessionId: text(value.childSessionId, 'child id', 200),
    project: text(value.project, 'project identity', 8192),
    profile: text(value.profile, 'profile', 40),
    route,
    tasks: value.tasks.map(parseTask),
  };
}

function collectRoutes(
  pairs: FusionArchivePair[],
  settings: unknown,
  selections: unknown,
): ExtractedRoute[] {
  const byKey = new Map<string, ExtractedRoute>();
  const add = (route: ExtractedRoute) => {
    const key = routeKey(route);
    const existing = byKey.get(key);
    if (existing) {
      for (const source of route.sources) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
      }
      return;
    }
    byKey.set(key, { ...route, sources: [...route.sources] });
  };
  for (const pair of pairs) {
    add({
      provider: pair.route.provider,
      id: pair.route.model,
      ...pair.route.reasoningEffort === undefined ? {} : { reasoningEffort: pair.route.reasoningEffort },
      sources: [`pair:${pair.id}`],
    });
  }
  if (settings !== undefined) {
    if (!isRecord(settings)) fail('INVALID_STORE', 'Fusion settings are invalid.');
    const fixed = maybeFixedSelection(settings.model ?? { provider: '', model: '' }, 'settings.model');
    if (fixed) add(fixed);
  }
  if (selections !== undefined && selections !== null) {
    if (!isRecord(selections)) fail('INVALID_STORE', 'Fusion selections are invalid.');
    for (const [leadId, item] of Object.entries(selections)) {
      const fixed = maybeFixedSelection(item, `selections.${leadId}`);
      if (fixed) add(fixed);
    }
  }
  return [...byKey.values()].sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
}

export function fusionProfileId(route: Pick<ExtractedRoute, 'provider' | 'id' | 'reasoningEffort'>): string {
  return `fusion-${createHash('sha256')
    .update(route.provider)
    .update('\0')
    .update(route.id)
    .update('\0')
    .update(route.reasoningEffort ?? '')
    .digest('hex')
    .slice(0, 16)}`;
}

function routeKey(route: Pick<ExtractedRoute, 'provider' | 'id' | 'reasoningEffort'>): string {
  return `${route.provider}\0${route.id}\0${route.reasoningEffort ?? ''}`;
}

function sameBinding(model: ModelBinding, route: Pick<ExtractedRoute, 'provider' | 'id' | 'reasoningEffort'>): boolean {
  return model.provider === route.provider
    && model.id === route.id
    && (model.reasoningEffort ?? '') === (route.reasoningEffort ?? '');
}

function profileForRoute(route: ExtractedRoute): ModelProfile {
  const effortLabel = route.reasoningEffort ?? 'model default';
  const name = `Fusion ${route.provider}/${route.id} ${effortLabel}`.slice(0, PROFILE_NAME_MAX);
  const description = 'Fixed Fusion route captured from pairs, settings, or selections. Disabled until you enable it. Catalog membership is not connectivity.'.slice(0, PROFILE_DESCRIPTION_MAX);
  return {
    id: fusionProfileId(route),
    revision: 0,
    name,
    description,
    enabled: false,
    model: route.reasoningEffort === undefined
      ? { provider: route.provider, id: route.id }
      : { provider: route.provider, id: route.id, reasoningEffort: route.reasoningEffort },
  };
}

export function unwrapClassmatesConfig(parsed: unknown): ClassmatesConfigShape {
  if (!isRecord(parsed)) fail('INVALID_CLASSMATES', 'Classmates config must be a JSON object.');
  const candidates: Record<string, unknown>[] = [parsed];
  if (isRecord(parsed.value)) candidates.push(parsed.value);
  if (isRecord(parsed.classmates)) candidates.push(parsed.classmates);
  if (isRecord(parsed['@klarkxy/dsh-classmates'])) candidates.push(parsed['@klarkxy/dsh-classmates']);
  if (isRecord(parsed.config)) candidates.push(parsed.config);
  for (const candidate of candidates) {
    if ('roles' in candidate || 'modelProfiles' in candidate || 'protectedModels' in candidate) {
      try {
        return {
          roles: validateRoles(candidate.roles ?? []),
          modelProfiles: validateModelProfiles(candidate.modelProfiles),
          protectedModels: validateProtectedModels(candidate.protectedModels),
        };
      } catch (error) {
        fail('INVALID_CLASSMATES', error instanceof Error ? error.message : String(error));
      }
    }
  }
  fail('INVALID_CLASSMATES', 'Classmates JSON must contain roles, modelProfiles, or protectedModels (native settings export or { classmates: ... }).');
}

function mergeProfiles(existing: ModelProfile[], routes: ExtractedRoute[]): { profiles: ModelProfile[]; delta: ProfileDelta } {
  const next = [...existing];
  const added: ModelProfile[] = [];
  const reused: ProfileDelta['reused'] = [];
  const conflicts: string[] = [];
  for (const route of routes) {
    const id = fusionProfileId(route);
    const byId = next.find(profile => profile.id === id);
    const byRoute = next.find(profile => sameBinding(profile.model, route));
    if (byId && !sameBinding(byId.model, route)) {
      conflicts.push(`${id}: existing ${byId.model.provider}/${byId.model.id} conflicts with ${route.provider}/${route.id}`);
      continue;
    }
    if (byId) {
      reused.push({ id: byId.id, reason: 'same-id' });
      continue;
    }
    if (byRoute) {
      reused.push({ id: byRoute.id, reason: 'same-route' });
      continue;
    }
    const profile = profileForRoute(route);
    next.push(profile);
    added.push(profile);
  }
  if (conflicts.length > 0) {
    fail('CONFLICT', `Model profile conflicts (all-or-nothing, nothing written):\n${conflicts.join('\n')}`);
  }
  return { profiles: validateModelProfiles(next), delta: { added, reused } };
}

export function migrateFusion(input: {
  fusionBytes: Buffer;
  classmatesJson?: unknown;
}): FusionMigrationResult {
  const sourceSha256 = sha256Hex(input.fusionBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.fusionBytes.toString('utf8'));
  } catch {
    fail('INVALID_STORE', 'Fusion input is not valid JSON.');
  }
  const state = unwrapFusionState(parsed);
  if (!isRecord(state)) fail('INVALID_STORE', 'Fusion state is invalid.');
  if (state.version !== 1 && state.version !== 2) fail('INVALID_STORE', 'Unsupported Fusion storage version.');
  if (!Number.isSafeInteger(state.revision) || (state.revision as number) < 0) {
    fail('INVALID_STORE', 'Invalid Fusion revision.');
  }
  if (!Array.isArray(state.pairs) || state.pairs.length > 512) fail('INVALID_STORE', 'Invalid Fusion pair table.');
  const pairs = state.pairs.map(parsePair);
  const routes = collectRoutes(pairs, state.settings, state.selections);
  const current = input.classmatesJson === undefined
    ? { roles: [] as NormalizedRole[], modelProfiles: [] as ModelProfile[], protectedModels: [] as ModelRoute[] }
    : unwrapClassmatesConfig(input.classmatesJson);
  const merged = mergeProfiles(current.modelProfiles, routes);
  return {
    sourceSha256,
    sourceBytes: input.fusionBytes,
    classmates: {
      roles: current.roles,
      modelProfiles: merged.profiles,
      protectedModels: current.protectedModels,
    },
    delta: merged.delta,
    routes,
    pairs,
    apply: APPLY_INSTRUCTIONS,
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] ?? character));
}

export interface FusionMigrateIo {
  readFile(path: string): Promise<Buffer | string>;
  writeFile(path: string, data: string | Buffer, options: { flag: 'wx' }): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
}

function usage(): string {
  return `Usage:
  node dist/migrate-fusion.js --fusion <file> --output <file> [--classmates <file>] [--archive <file-or-dir>]
  node scripts/migrate-fusion.mjs --fusion <file> --output <file> [--classmates <file>] [--archive <file-or-dir>]

Requires a built dist/migrate-fusion.js (npm run build). Node >= 24, no TypeScript loader.
Reads only the given files. Does not scan .dsh, and does not edit credentials, native settings, or sessions.
--output is a reviewable merged Classmates config JSON ({ roles, modelProfiles, protectedModels }).
--archive writes an offline HTML report; a directory also keeps the exact original Fusion bytes as source.json.
Pre-flight refuses before any write if --output or generated archive files would overwrite an input, each other, or an existing destination whose bytes are not already identical (Windows case, symlink realpath, and hardlink identity included).
New files use exclusive creation. A file created after pre-flight causes a visible EEXIST destination conflict; earlier completed files remain for inspection and are never rolled back. Writes are not a multi-file transaction.`;
}

function readFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

function parseJsonFile(bytes: Buffer | string, label: string): unknown {
  try {
    return JSON.parse(typeof bytes === 'string' ? bytes : bytes.toString('utf8'));
  } catch {
    throw new FusionMigrateError('INVALID_CLASSMATES', `${label} is not valid JSON.`);
  }
}

function foldPathCase(path: string): string {
  const unified = path.replace(/\\/gu, '/');
  return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

async function existingParentReal(path: string): Promise<string> {
  const resolved = resolve(path);
  const tail: string[] = [];
  let current = resolved;
  while (true) {
    try {
      const real = await realpath(current);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolved;
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

interface PathIdentity {
  label: string;
  path: string;
  comparable: string;
  inode?: string;
}

async function identifyPath(label: string, path: string): Promise<PathIdentity> {
  const resolved = resolve(path);
  const comparable = foldPathCase(await existingParentReal(resolved));
  try {
    // Filesystem identities can exceed Number.MAX_SAFE_INTEGER on Windows.
    // Both device and inode must remain exact to distinguish adjacent files
    // while retaining the hardlink guard.
    const info = await stat(resolved, { bigint: true });
    const inode = info.ino ? `${info.dev}:${String(info.ino)}` : undefined;
    let real = comparable;
    try { real = foldPathCase(await realpath(resolved)); } catch { /* keep parent-based */ }
    return { label, path: resolved, comparable: real, inode };
  } catch {
    return { label, path: resolved, comparable };
  }
}

function samePathIdentity(left: PathIdentity, right: PathIdentity): boolean {
  if (left.comparable === right.comparable) return true;
  return Boolean(left.inode && right.inode && left.inode === right.inode);
}

interface PlannedDestination {
  label: string;
  path: string;
  bytes: Buffer;
}

function classmatesOutputBytes(result: FusionMigrationResult): Buffer {
  return Buffer.from(`${JSON.stringify({
    roles: result.classmates.roles,
    modelProfiles: result.classmates.modelProfiles,
    protectedModels: result.classmates.protectedModels,
  }, null, 2)}\n`);
}

function archiveReportBytes(result: FusionMigrationResult): Buffer {
  return Buffer.from(`${JSON.stringify({
    sourceSha256: result.sourceSha256,
    delta: result.delta,
    routes: result.routes,
    apply: result.apply,
  }, null, 2)}\n`);
}

function planDestinations(output: string, archive: string | undefined, result: FusionMigrationResult): {
  files: PlannedDestination[];
  archiveDir?: string;
} {
  const files: PlannedDestination[] = [];
  let archiveDir: string | undefined;
  if (archive) {
    const archivePath = resolve(archive);
    const html = Buffer.from(renderArchiveHtml(result));
    if (extname(archivePath).toLowerCase() === '.html') {
      files.push({ label: '--archive', path: archivePath, bytes: html });
      files.push({
        label: '--archive source',
        path: archivePath.replace(/\.html$/iu, '.source.json'),
        bytes: result.sourceBytes,
      });
    } else {
      archiveDir = archivePath;
      files.push({ label: '--archive source.json', path: join(archivePath, 'source.json'), bytes: result.sourceBytes });
      files.push({ label: '--archive archive.html', path: join(archivePath, 'archive.html'), bytes: html });
      files.push({ label: '--archive report.json', path: join(archivePath, 'report.json'), bytes: archiveReportBytes(result) });
    }
  }
  files.push({ label: '--output', path: resolve(output), bytes: classmatesOutputBytes(result) });
  return { files, archiveDir };
}

async function assertNoPathCollision(inputs: Array<{ label: string; path: string }>, dests: PlannedDestination[], archiveDir?: string) {
  const inputIds = await Promise.all(inputs.map(item => identifyPath(item.label, item.path)));
  const destIds = await Promise.all(dests.map(item => identifyPath(item.label, item.path)));
  const reserved = archiveDir === undefined
    ? destIds
    : [...destIds, await identifyPath('--archive', archiveDir)];
  for (let i = 0; i < reserved.length; i++) {
    for (let j = i + 1; j < reserved.length; j++) {
      if (samePathIdentity(reserved[i]!, reserved[j]!)) {
        fail('PATH_COLLISION', `${reserved[i]!.label} and ${reserved[j]!.label} resolve to the same destination. Refusing to write.`);
      }
    }
  }
  for (const dest of reserved) {
    for (const input of inputIds) {
      if (samePathIdentity(dest, input)) {
        fail('PATH_COLLISION', `${dest.label} would overwrite ${input.label}. Refusing to write.`);
      }
    }
  }
}

async function existingDestinationConflict(dest: PlannedDestination): Promise<boolean> {
  try {
    const info = await stat(dest.path);
    if (info.isDirectory()) {
      fail('PATH_COLLISION', `${dest.label} exists as a directory. Refusing to write.`);
    }
    const current = await readExisting(dest.path);
    if (!Buffer.from(current).equals(dest.bytes)) {
      fail('DESTINATION_CONFLICT', `${dest.label} already exists with different bytes. Refusing to destroy it.`);
    }
    return true;
  } catch (error) {
    if (error instanceof FusionMigrateError) throw error;
    // An unreadable destination is not an absent destination: never authorize
    // a write after permissions or I/O prevent checking its existing bytes.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Pre-flight all destinations, then create new files exclusively; partial writes are retained on failure. */
export async function migrateFusionCli(
  argv: string[],
  io: FusionMigrateIo,
): Promise<{ code: number; stdout: string; files: string[]; result?: FusionMigrationResult }> {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { code: 0, stdout: usage(), files: [] };
  }
  const fusion = readFlag(argv, '--fusion');
  const output = readFlag(argv, '--output');
  const classmates = readFlag(argv, '--classmates');
  const archive = readFlag(argv, '--archive');
  const known = new Set(['--fusion', '--output', '--classmates', '--archive', '--help', '-h']);
  for (const token of argv) {
    if (token.startsWith('--') && !known.has(token)) throw new Error(`Unknown flag ${token}\n${usage()}`);
  }
  if (!fusion || !output) throw new Error(usage());
  const fusionPath = resolve(fusion);
  const outputPath = resolve(output);
  const classmatesPath = classmates === undefined ? undefined : resolve(classmates);
  const fusionBytes = Buffer.from(await io.readFile(fusionPath));
  const classmatesJson = classmatesPath === undefined
    ? undefined
    : parseJsonFile(await io.readFile(classmatesPath), 'Classmates config');
  const result = migrateFusion({ fusionBytes, classmatesJson });
  const planned = planDestinations(outputPath, archive, result);
  const inputs = [{ label: '--fusion', path: fusionPath }];
  if (classmatesPath) inputs.push({ label: '--classmates', path: classmatesPath });
  await assertNoPathCollision(inputs, planned.files, planned.archiveDir);
  const skip = new Set<string>();
  for (const dest of planned.files) {
    if (await existingDestinationConflict(dest)) skip.add(dest.path);
  }
  const files: string[] = [];
  for (const dest of planned.files) {
    files.push(dest.path);
    if (skip.has(dest.path)) continue;
    await io.mkdir(dirname(dest.path), { recursive: true });
    try {
      // Pre-flight is advisory; exclusive creation owns the commit boundary.
      // Never replace a file another writer created while mkdir was pending.
      await io.writeFile(dest.path, dest.bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        fail('DESTINATION_CONFLICT', `${dest.label} appeared after pre-flight (EEXIST). Refusing to overwrite it. Earlier completed destinations are retained; inspect them before retrying.`);
      }
      throw error;
    }
  }
  return {
    code: 0,
    stdout: `sourceSha256 ${result.sourceSha256}\nadded ${result.delta.added.length}\nreused ${result.delta.reused.length}\n${result.apply}\n`,
    files,
    result,
  };
}

export function renderArchiveHtml(result: FusionMigrationResult): string {
  const rows = result.pairs.flatMap(pair => pair.tasks.map(task => {
    const candidates = task.candidates.map(candidate => `
      <section>
        <h4>Candidate ${escapeHtml(candidate.id)} · ${escapeHtml(candidate.hash)}</h4>
        <pre>${escapeHtml(candidate.text)}</pre>
        <p>Report</p>
        <pre>${escapeHtml(candidate.report)}</pre>
      </section>`).join('');
    const reviews = task.reviews.map(review => `
      <li>${escapeHtml(review.verdict)} · ${escapeHtml(review.candidateId)} · ${escapeHtml(review.candidateHash)}
        <pre>${escapeHtml(review.feedback)}</pre>
      </li>`).join('');
    return `
      <article>
        <h3>Task ${escapeHtml(task.id)} · ${escapeHtml(task.state)}${task.adoption ? ` · adoption ${escapeHtml(task.adoption)}` : ''}${task.cleanup ? ` · cleanup ${escapeHtml(task.cleanup)}` : ''}${task.applicationState ? ` · application ${escapeHtml(task.applicationState)}` : ''}</h3>
        <p>${escapeHtml(task.title)}</p>
        <pre>${escapeHtml(task.goal)}</pre>
        <p>Pair ${escapeHtml(pair.id)} · Lead ${escapeHtml(pair.leadSessionId)} · Child ${escapeHtml(pair.childSessionId)}</p>
        ${candidates}
        ${reviews ? `<h4>Reviews</h4><ul>${reviews}</ul>` : ''}
      </article>`;
  })).join('');
  const routeList = result.routes.map(route => {
    const effort = route.reasoningEffort ?? 'model default';
    return `<li>${escapeHtml(route.provider)}/${escapeHtml(route.id)} · ${escapeHtml(effort)} · ${escapeHtml(fusionProfileId(route))} · ${escapeHtml(route.sources.join(', '))}</li>`;
  }).join('');
  const added = result.delta.added.map(profile => `<li>add ${escapeHtml(profile.id)} (disabled)</li>`).join('');
  const reused = result.delta.reused.map(item => `<li>reuse ${escapeHtml(item.id)} (${escapeHtml(item.reason)})</li>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fusion archive</title>
  <style>
    body { font: 16px/1.45 sans-serif; margin: 24px; color: #111; background: #f7f7f4; }
    pre { white-space: pre-wrap; word-break: break-word; background: #fff; padding: 12px; border: 1px solid #ccc; }
    h1, h2, h3 { font-weight: 600; }
  </style>
</head>
<body>
  <h1>Fusion archive (offline)</h1>
  <p>Source SHA-256: <code>${escapeHtml(result.sourceSha256)}</code></p>
  <p>${escapeHtml(result.apply)}</p>
  <h2>Extracted fixed routes</h2>
  <ul>${routeList || '<li>None</li>'}</ul>
  <h2>Model profile delta</h2>
  <ul>${added}${reused || '<li>No profile changes</li>'}</ul>
  <h2>Tasks, candidates, reviews</h2>
  ${rows || '<p>No tasks.</p>'}
</body>
</html>
`;
}
