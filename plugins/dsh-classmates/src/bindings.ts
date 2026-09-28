import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { withFileLock as lockFile, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { dirname, join } from 'node:path';
import { SessionId } from '@deepseek-ai/dsh-session';
import { MEMBER_NAME, type ClassmateDefinition, type ModelBinding } from './contracts.js';

export interface BindingSnapshot {
  schemaVersion: 1;
  profileId: string;
  leadId: string;
  name: string;
  role: ClassmateDefinition;
  taskHash: string;
  /** Original user-configured choice, retained for idempotent creation retries. */
  modelProfileId?: string;
  checksum: string;
  childId?: SessionId;
}

const SCHEMA_VERSION = 1 as const;


function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const next = record[key];
    if (next === undefined) continue;
    out[key] = canonical(next);
  }
  return out;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as object)) deepFreeze(nested);
  return value;
}

function cloneRole(role: ClassmateDefinition): ClassmateDefinition {
  return deepFreeze(structuredClone(role));
}

function taskHashOf(task: string): string {
  return sha256(task);
}

function payloadForChecksum(snapshot: Omit<BindingSnapshot, 'checksum'>): unknown {
  return {
    schemaVersion: snapshot.schemaVersion,
    profileId: snapshot.profileId,
    leadId: snapshot.leadId,
    name: snapshot.name,
    role: snapshot.role,
    taskHash: snapshot.taskHash,
    ...snapshot.modelProfileId === undefined ? {} : { modelProfileId: snapshot.modelProfileId },
    ...snapshot.childId === undefined ? {} : { childId: snapshot.childId },
  };
}

function checksumOf(snapshot: Omit<BindingSnapshot, 'checksum'>): string {
  return sha256(canonicalJson(payloadForChecksum(snapshot)));
}

function samePreparedValue(
  existing: BindingSnapshot,
  next: Omit<BindingSnapshot, 'checksum' | 'childId'>,
): boolean {
  return canonicalJson({
    schemaVersion: existing.schemaVersion,
    profileId: existing.profileId,
    leadId: existing.leadId,
    name: existing.name,
    role: existing.role,
    taskHash: existing.taskHash,
    ...existing.modelProfileId === undefined ? {} : { modelProfileId: existing.modelProfileId },
  }) === canonicalJson({
    schemaVersion: next.schemaVersion,
    profileId: next.profileId,
    leadId: next.leadId,
    name: next.name,
    role: next.role,
    taskHash: next.taskHash,
    ...next.modelProfileId === undefined ? {} : { modelProfileId: next.modelProfileId },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function parseModel(value: Record<string, unknown>, path: string): ModelBinding {
  const provider = value.provider;
  const id = value.id;
  const reasoningEffort = value.reasoningEffort;
  if (typeof provider !== 'string' || typeof id !== 'string') {
    throw new Error(`classmates: corrupt binding at ${path}`);
  }
  if (reasoningEffort !== undefined && typeof reasoningEffort !== 'string') {
    throw new Error(`classmates: corrupt binding at ${path}`);
  }
  return {
    provider,
    id,
    ...typeof reasoningEffort === 'string' ? { reasoningEffort } : {},
  };
}

function parseRole(value: Record<string, unknown>, path: string): ClassmateDefinition {
  const id = value.id;
  const revision = value.revision;
  const name = value.name;
  const description = value.description;
  const instructions = value.instructions;
  const enabled = value.enabled;
  const model = value.model;
  if (
    value.schemaVersion !== 1
    || typeof id !== 'string'
    || typeof revision !== 'number'
    || typeof name !== 'string'
    || typeof description !== 'string'
    || typeof instructions !== 'string'
    || typeof enabled !== 'boolean'
    || (model !== null && !isRecord(model))
  ) {
    throw new Error(`classmates: corrupt binding at ${path}`);
  }
  return cloneRole({
    schemaVersion: 1,
    id,
    revision,
    name,
    description,
    instructions,
    enabled,
    model: model === null ? null : parseModel(model, path),
  });
}

function parseSnapshot(raw: string, path: string): BindingSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`classmates: corrupt binding at ${path}`, { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error(`classmates: corrupt binding at ${path}`);
  }
  const schemaVersion = parsed.schemaVersion;
  const profileId = parsed.profileId;
  const leadId = parsed.leadId;
  const name = parsed.name;
  const taskHash = parsed.taskHash;
  const checksum = parsed.checksum;
  const childId = parsed.childId;
  const modelProfileId = parsed.modelProfileId;
  if (
    schemaVersion !== SCHEMA_VERSION
    || typeof profileId !== 'string'
    || typeof leadId !== 'string'
    || typeof name !== 'string'
    || typeof taskHash !== 'string'
    || typeof checksum !== 'string'
    || !isRecord(parsed.role)
    || (childId !== undefined && typeof childId !== 'string')
    || (modelProfileId !== undefined && (typeof modelProfileId !== 'string' || !MEMBER_NAME.test(modelProfileId) || modelProfileId.length > 80))
  ) {
    throw new Error(`classmates: corrupt binding at ${path}`);
  }
  const snapshot: BindingSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    profileId,
    leadId,
    name,
    role: parseRole(parsed.role, path),
    taskHash,
    checksum,
    ...typeof modelProfileId === 'string' ? { modelProfileId } : {},
    ...typeof childId === 'string' ? { childId: SessionId(childId) } : {},
  };
  if (checksumOf(snapshot) !== checksum) {
    throw new Error(`classmates: binding checksum mismatch at ${path}`);
  }
  return snapshot;
}

async function withFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return lockFile(path, operation);
}

async function atomicWriteFile(dest: string, body: string): Promise<void> {
  await writeFileAtomic(dest, body, { mode: 0o600, dirMode: 0o700 });
}
function assertMemberName(name: string): void {
  if (!MEMBER_NAME.test(name) || name.length > 64 || name === 'lead') {
    throw new Error(
      'classmates: member name must be lower-kebab-case, at most 64 characters, and not "lead"',
    );
  }
}

/** Immutable per-profile classmate bindings. Does not store Team runtime state. */
export class BindingStore {
  constructor(
    private readonly root: string,
    private readonly profileId: string,
  ) {
    if (this.profileId.length === 0) throw new Error('classmates: profileId is required');
  }

  async prepare(
    leadId: string,
    name: string,
    role: ClassmateDefinition,
    task: string,
    modelProfileId?: string,
  ): Promise<BindingSnapshot> {
    assertMemberName(name);
    if (modelProfileId !== undefined && (!MEMBER_NAME.test(modelProfileId) || modelProfileId.length > 80)) throw new Error('classmates: invalid model profile id');
    if (leadId.length === 0) throw new Error('classmates: leadId is required');
    const path = this.filePath(leadId, name);
    const next = {
      schemaVersion: SCHEMA_VERSION,
      profileId: this.profileId,
      leadId,
      name,
      role: cloneRole(role),
      taskHash: taskHashOf(task),
      ...modelProfileId === undefined ? {} : { modelProfileId },
    };
    return withFileLock(path, async () => {
      const existing = await this.readFile(path);
      if (existing !== undefined) {
        if (!samePreparedValue(existing, next)) {
          throw new Error(
            `classmates: binding conflict for ${name}; existing snapshot does not match this prepare`,
          );
        }
        return existing;
      }
      const snapshot: BindingSnapshot = { ...next, checksum: checksumOf(next) };
      await atomicWriteFile(path, `${canonicalJson(snapshot)}\n`);
      return snapshot;
    });
  }

  async read(leadId: string, name: string): Promise<BindingSnapshot | undefined> {
    return withFileLock(this.filePath(leadId, name), () => this.readFile(this.filePath(leadId, name)));
  }

  async claim(leadId: string, name: string, childId: SessionId): Promise<BindingSnapshot> {
    if (childId.length === 0) throw new Error('classmates: childId is required');
    const path = this.filePath(leadId, name);
    return withFileLock(path, async () => {
      const existing = await this.readFile(path);
      if (existing === undefined) {
        throw new Error(`classmates: missing binding for ${name}`);
      }
      if (existing.childId !== undefined) {
        if (existing.childId !== childId) {
          throw new Error(`classmates: binding for ${name} is already claimed by another child`);
        }
        return existing;
      }
      const claimedBase = {
        ...existing.modelProfileId === undefined ? {} : { modelProfileId: existing.modelProfileId },
        schemaVersion: existing.schemaVersion,
        profileId: existing.profileId,
        leadId: existing.leadId,
        name: existing.name,
        role: existing.role,
        taskHash: existing.taskHash,
        childId,
      };
      const claimed: BindingSnapshot = { ...claimedBase, checksum: checksumOf(claimedBase) };
      await atomicWriteFile(path, `${canonicalJson(claimed)}\n`);
      return claimed;
    });
  }

  private filePath(leadId: string, name: string): string {
    const digest = sha256(`v1\0${this.profileId}\0${leadId}\0${name}`);
    return join(this.root, `${digest}.json`);
  }

  private async readFile(path: string): Promise<BindingSnapshot | undefined> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined;
      throw error;
    }
    return parseSnapshot(raw, path);
  }
}
