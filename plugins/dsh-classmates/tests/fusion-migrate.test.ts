import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  escapeHtml,
  fusionProfileId,
  migrateFusion,
  migrateFusionCli,
  renderArchiveHtml,
  sha256Hex,
} from '../src/fusion-migrate.js';
import type { ModelProfile } from '../src/contracts.js';

const destinationFault = vi.hoisted(() => ({ path: '', operation: '', code: '' }));
const identityOverride = vi.hoisted(() => ({
  inodes: {} as Record<string, string>,
  calls: [] as Array<{ path: string; bigint: boolean }>,
}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const fault = (path: unknown, operation: string) => {
    if (String(path) === destinationFault.path && operation === destinationFault.operation) {
      throw Object.assign(new Error(`Injected ${destinationFault.code}`), { code: destinationFault.code });
    }
  };
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      fault(args[0], 'stat');
      const info = await actual.stat(...args);
      const path = String(args[0]);
      const inode = identityOverride.inodes[path];
      if (inode === undefined) return info;
      const bigint = args[1]?.bigint === true;
      identityOverride.calls.push({ path, bigint });
      // Match native stat's precision difference while retaining its mode and
      // directory methods, so this is a realistic identity-only fixture.
      return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
        dev: bigint ? 7n : 7,
        ino: bigint ? BigInt(inode) : Number(inode),
      });
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => { fault(args[0], 'read'); return actual.readFile(...args); },
  };
});

const pkgRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const documentedCli = join(pkgRoot, 'scripts', 'migrate-fusion.mjs');
const compiledCli = join(pkgRoot, 'dist', 'migrate-fusion.js');

const roots: string[] = [];
afterEach(() => {
  destinationFault.path = '';
  identityOverride.inodes = {};
  identityOverride.calls = [];
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-migrate-'));
  roots.push(dir);
  return dir;
}

function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function settledTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const text = 'Exact candidate <script>alert(1)</script>';
  return {
    id: 'task-1',
    revision: 1,
    state: 'accepted',
    brief: { title: 'Scene', goal: 'Write it', context: '', constraints: [], acceptance: [] },
    candidates: [{
      id: 'cand-1',
      taskRevision: 1,
      revision: 1,
      text,
      hash: hashText(text),
      report: 'Checked',
      createdAt: 1,
    }],
    reviews: [{
      candidateId: 'cand-1',
      candidateHash: hashText(text),
      verdict: 'accept',
      feedback: 'ok',
      createdAt: 2,
    }],
    messageIds: [],
    dispatchId: 'd1',
    reportIds: [],
    delivery: 'accepted',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function fusionState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    revision: 3,
    pairs: [{
      id: 'pair-1',
      leadSessionId: 'lead-1',
      childSessionId: 'child-1',
      project: '/work',
      profile: 'generic',
      route: { provider: 'ocg', model: 'minimax-m3', reasoningEffort: 'high' },
      established: true,
      tasks: [settledTask()],
      createdAt: 1,
    }],
    settings: { revision: 1, model: { mode: 'follow', provider: '', model: '' } },
    selections: {
      'lead-1': { mode: 'fixed', provider: 'ocg', model: 'minimax-m3', reasoningEffort: 'high' },
      'lead-2': { mode: 'off', provider: '', model: '' },
      'lead-3': { mode: 'follow', provider: '', model: '' },
      'lead-4': { mode: 'fixed', provider: 'fixture', model: 'review-model' },
    },
    ...overrides,
  };
}

function pairOf(state: Record<string, unknown>): Record<string, unknown> {
  return (state.pairs as Record<string, unknown>[])[0];
}

function taskOf(state: Record<string, unknown>): Record<string, unknown> {
  return (pairOf(state).tasks as Record<string, unknown>[])[0];
}

function writingPair(taskOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pair-write',
    leadSessionId: 'lead-w',
    childSessionId: 'child-w',
    project: '/work',
    profile: 'writing',
    route: { provider: 'ocg', model: 'minimax-m3' },
    established: true,
    tasks: [settledTask({
      target: { domain: 'editor', data: { path: 'scene.md', kind: 'create' } },
      ...taskOverrides,
    })],
    createdAt: 1,
  };
}

function expectActive(state: Record<string, unknown>) {
  try {
    migrateFusion({ fusionBytes: Buffer.from(JSON.stringify(domainEnvelope(state))) });
    throw new Error('expected ACTIVE_TASK');
  } catch (error) {
    expect(error).toMatchObject({ code: 'ACTIVE_TASK' });
  }
}

/** Exact dsh-storage-domain JSON supplied by primary inspection. */
const REAL_EMPTY_DOMAIN_JSON = '{"unit":{"name":"dsh_fusion","version":2},"global":null,"tables":{"state":{"state":{"version":1,"revision":77,"pairs":[],"settings":{"revision":11,"model":{"mode":"follow","provider":"","model":""}},"selections":{}}}}}';

function domainEnvelope(state: unknown, version: 1 | 2 = 2) {
  return { unit: { name: 'dsh_fusion', version }, global: null, tables: { state: { state } } };
}

function rootNameEnvelope(state: unknown, version: 1 | 2 = 2) {
  return { name: 'dsh_fusion', version, tables: { state: { state } } };
}

function classmatesConfig(profiles: ModelProfile[] = []) {
  return {
    roles: [{
      schemaVersion: 1, id: 'reviewer', revision: 1, name: 'Reviewer',
      description: 'review', instructions: 'Review the change.', enabled: false, model: null,
      recommendedModelProfileId: 'coding-high',
    }],
    modelProfiles: profiles,
    protectedModels: [{ provider: 'ocg', id: 'keep-me' }],
  };
}

const io = { readFile, writeFile, mkdir };

async function ensureCompiledCli() {
  // Exercise the documented production build rather than replacing its output
  // with a differently configured test bundle after release fingerprinting.
  const result = await spawnNode(join(pkgRoot, 'scripts', 'build.mjs'), []);
  if (result.code !== 0) throw new Error(`CLI build failed: ${result.stderr}`);
}

function spawnNode(entry: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: pkgRoot,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => done({ code, stdout, stderr }));
  });
}

describe('fusion migrate utility', () => {
  it('distinguishes adjacent large inode identities whose numeric values collide on an idempotent archive rerun', async () => {
    const dir = tmp();
    const fusionPath = join(dir, 'fusion.json');
    const outputPath = join(dir, 'out.json');
    const archiveDir = join(dir, 'archive');
    const sourcePath = join(archiveDir, 'source.json');
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(fusionState())));
    writeFileSync(fusionPath, fusionBytes);
    const argv = ['--fusion', fusionPath, '--output', outputPath, '--archive', archiveDir];
    expect((await migrateFusionCli(argv, io)).code).toBe(0);
    const snapshots = [sourcePath, join(archiveDir, 'archive.html'), join(archiveDir, 'report.json'), outputPath]
      .map(path => ({ path, bytes: readFileSync(path) }));
    const directoryInode = 27866022698440711n;
    const sourceInode = directoryInode - 1n;
    expect(directoryInode).not.toBe(sourceInode);
    expect(Number(directoryInode)).toBe(Number(sourceInode));
    identityOverride.inodes = {
      [archiveDir]: String(directoryInode),
      [sourcePath]: String(sourceInode),
    };
    const write = vi.fn();
    expect((await migrateFusionCli(argv, { ...io, writeFile: write })).code).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(identityOverride.calls).toContainEqual({ path: archiveDir, bigint: true });
    expect(identityOverride.calls).toContainEqual({ path: sourcePath, bigint: true });
    for (const { path, bytes } of snapshots) expect(readFileSync(path)).toEqual(bytes);
    expect(readFileSync(fusionPath)).toEqual(fusionBytes);
  });

  it.each([0, 1, 2, 3])('exclusively creates destination %i and preserves competing and earlier files on a mkdir race', async raceIndex => {
    const dir = tmp();
    const fusionPath = join(dir, 'fusion.json');
    const outputPath = join(dir, 'out.json');
    const archiveDir = join(dir, 'archive');
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(fusionState())));
    writeFileSync(fusionPath, fusionBytes);
    const destinations = [
      join(archiveDir, 'source.json'), join(archiveDir, 'archive.html'),
      join(archiveDir, 'report.json'), outputPath,
    ];
    const sentinel = Buffer.from('created by another writer; do not replace or delete');
    const completed = new Map<string, Buffer>();
    let mkdirCount = 0;
    const commit = vi.fn(async (path: string, data: string | Buffer, options: { flag: 'wx' }) => {
      await writeFile(path, data, options);
      completed.set(path, readFileSync(path));
    });
    await expect(migrateFusionCli([
      '--fusion', fusionPath, '--output', outputPath, '--archive', archiveDir,
    ], {
      readFile,
      writeFile: commit,
      mkdir: async (path, options) => {
        const result = await mkdir(path, options);
        if (mkdirCount++ === raceIndex) writeFileSync(destinations[raceIndex]!, sentinel, { flag: 'wx' });
        return result;
      },
    })).rejects.toMatchObject({
      code: 'DESTINATION_CONFLICT', message: expect.stringContaining('EEXIST'),
    });
    expect(readFileSync(destinations[raceIndex]!)).toEqual(sentinel);
    expect(readFileSync(fusionPath)).toEqual(fusionBytes);
    expect(commit).toHaveBeenCalledTimes(raceIndex + 1);
    for (const [, , options] of commit.mock.calls) expect(options).toEqual({ flag: 'wx' });
    for (const [index, path] of destinations.entries()) {
      if (index < raceIndex) expect(readFileSync(path)).toEqual(completed.get(path));
      if (index > raceIndex) expect(existsSync(path)).toBe(false);
    }
    expect(completed.size).toBe(raceIndex);
  });

  it.each([0, 1, 2, 3])('retains earlier outputs and partial destination %i on an I/O commit failure', async failureIndex => {
    const dir = tmp();
    const fusionPath = join(dir, 'fusion.json');
    const outputPath = join(dir, 'out.json');
    const archiveDir = join(dir, 'archive');
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(fusionState())));
    writeFileSync(fusionPath, fusionBytes);
    const destinations = [
      join(archiveDir, 'source.json'), join(archiveDir, 'archive.html'),
      join(archiveDir, 'report.json'), outputPath,
    ];
    const partial = Buffer.from('partial write before I/O failure');
    const completed = new Map<string, Buffer>();
    let commitCount = 0;
    await expect(migrateFusionCli([
      '--fusion', fusionPath, '--output', outputPath, '--archive', archiveDir,
    ], {
      readFile, mkdir,
      writeFile: async (path, data, options) => {
        if (commitCount++ === failureIndex) {
          await writeFile(path, partial, options);
          throw Object.assign(new Error('Injected commit I/O failure'), { code: 'EIO' });
        }
        await writeFile(path, data, options);
        completed.set(path, readFileSync(path));
      },
    })).rejects.toMatchObject({ code: 'EIO' });
    expect(readFileSync(fusionPath)).toEqual(fusionBytes);
    expect(readFileSync(destinations[failureIndex]!)).toEqual(partial);
    for (const [index, path] of destinations.entries()) {
      if (index < failureIndex) expect(readFileSync(path)).toEqual(completed.get(path));
      if (index > failureIndex) expect(existsSync(path)).toBe(false);
    }
    expect(completed.size).toBe(failureIndex);
  });

  it.each(['stat', 'read'].flatMap(operation => ['EACCES', 'EIO'].map(code => ({ operation, code }))))(
    'writes nothing when checking an existing destination fails with $operation/$code', async ({ operation, code }) => {
      const dir = tmp();
      const fusionPath = join(dir, 'fusion.json');
      const outputPath = join(dir, 'out.json');
      const archiveDir = join(dir, 'archive');
      writeFileSync(fusionPath, JSON.stringify(domainEnvelope(fusionState())));
      const original = Buffer.from('do not truncate');
      writeFileSync(outputPath, original);
      Object.assign(destinationFault, { path: outputPath, operation, code });
      const write = vi.fn();
      const makeDirectory = vi.fn();
      await expect(migrateFusionCli([
        '--fusion', fusionPath, '--output', outputPath, '--archive', archiveDir,
      ], { readFile, writeFile: write, mkdir: makeDirectory })).rejects.toMatchObject({ code });
      expect(write).not.toHaveBeenCalled();
      expect(makeDirectory).not.toHaveBeenCalled();
      expect(readFileSync(outputPath)).toEqual(original);
      expect(existsSync(archiveDir)).toBe(false);
    },
  );
  it('reads the actual dsh-storage-domain unit envelope', () => {
    const emptyBytes = Buffer.from(REAL_EMPTY_DOMAIN_JSON);
    const empty = migrateFusion({ fusionBytes: emptyBytes });
    expect(JSON.parse(emptyBytes.toString('utf8'))).toEqual({
      unit: { name: 'dsh_fusion', version: 2 },
      global: null,
      tables: {
        state: {
          state: {
            version: 1,
            revision: 77,
            pairs: [],
            settings: { revision: 11, model: { mode: 'follow', provider: '', model: '' } },
            selections: {},
          },
        },
      },
    });
    expect(empty.sourceSha256).toBe(sha256Hex(emptyBytes));
    expect(empty.sourceBytes.equals(emptyBytes)).toBe(true);
    expect(empty.routes).toEqual([]);
    expect(empty.classmates.modelProfiles).toEqual([]);
    expect(empty.pairs).toEqual([]);

    const tasked = domainEnvelope(fusionState(), 2);
    const taskedBytes = Buffer.from(JSON.stringify(tasked));
    const fromDomain = migrateFusion({ fusionBytes: taskedBytes });
    expect(fromDomain.sourceSha256).toBe(sha256Hex(taskedBytes));
    expect(fromDomain.sourceBytes.equals(taskedBytes)).toBe(true);
    expect(fromDomain.routes.map(route => `${route.provider}/${route.id}/${route.reasoningEffort ?? ''}`).sort()).toEqual([
      'fixture/review-model/',
      'ocg/minimax-m3/high',
    ]);
    expect(fromDomain.classmates.modelProfiles.every(profile => profile.enabled === false)).toBe(true);
    expect(fromDomain.pairs[0].tasks[0].candidates[0].text).toBe('Exact candidate <script>alert(1)</script>');
    expect(fromDomain.pairs[0].tasks[0].candidates[0].hash).toBe(hashText('Exact candidate <script>alert(1)</script>'));
  });

  it('still accepts root-name envelopes, records.state, nested state, and raw pairs', () => {
    const state = fusionState();
    const fromDomain = migrateFusion({ fusionBytes: Buffer.from(JSON.stringify(domainEnvelope(state, 2))) });
    const fromRoot = migrateFusion({ fusionBytes: Buffer.from(JSON.stringify(rootNameEnvelope(state, 1))) });
    const records = Buffer.from(JSON.stringify({
      unit: { name: 'dsh_fusion', version: 1 }, global: null, tables: { state: { records: { state } } },
    }));
    const nested = Buffer.from(JSON.stringify({ state }));
    const raw = Buffer.from(JSON.stringify(state));
    expect(migrateFusion({ fusionBytes: records }).routes).toEqual(fromDomain.routes);
    expect(fromRoot.routes).toEqual(fromDomain.routes);
    expect(migrateFusion({ fusionBytes: nested }).routes).toEqual(fromDomain.routes);
    expect(migrateFusion({ fusionBytes: raw }).routes).toEqual(fromDomain.routes);
    expect(fromDomain.sourceSha256).not.toBe(sha256Hex(raw));
  });

  it('is repeat-safe against the merged classmates config', () => {
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(fusionState())));
    const first = migrateFusion({ fusionBytes });
    const second = migrateFusion({
      fusionBytes,
      classmatesJson: first.classmates,
    });
    expect(second.delta.added).toEqual([]);
    expect(second.delta.reused.every(item => item.reason === 'same-id')).toBe(true);
    expect(second.classmates.modelProfiles).toEqual(first.classmates.modelProfiles);
  });

  it('reuses an existing same-route profile without duplicating and keeps roles', () => {
    const existing: ModelProfile = {
      id: 'coding-high',
      revision: 4,
      name: 'Already here',
      description: 'keep me',
      enabled: true,
      model: { provider: 'ocg', id: 'minimax-m3', reasoningEffort: 'high' },
    };
    const result = migrateFusion({
      fusionBytes: Buffer.from(JSON.stringify(domainEnvelope(fusionState({
        selections: { 'lead-2': { mode: 'off', provider: '', model: '' } },
        pairs: [{
          ...pairOf(fusionState()),
          route: { provider: 'ocg', model: 'minimax-m3', reasoningEffort: 'high' },
        }],
      })))),
      classmatesJson: { classmates: classmatesConfig([existing]) },
    });
    expect(result.classmates.roles[0]).toMatchObject({
      id: 'reviewer',
      // Roles round-trip through validation and come back normalized.
      model: { kind: 'profile', profileId: 'coding-high' },
    });
    expect(result.classmates.roles[0]).not.toHaveProperty('recommendedModelProfileId');
    expect(result.classmates.protectedModels).toEqual([{ provider: 'ocg', id: 'keep-me' }]);
    expect(result.classmates.modelProfiles.filter(profile => profile.model.provider === 'ocg')).toHaveLength(1);
    expect(result.delta.reused.some(item => item.id === 'coding-high' && item.reason === 'same-route')).toBe(true);
    expect(result.classmates.modelProfiles.find(profile => profile.id === 'coding-high')).toMatchObject({
      enabled: true, name: 'Already here', revision: 4,
    });
  });

  it('rejects conflicts all-or-nothing without returning a merged config', () => {
    const id = fusionProfileId({ provider: 'ocg', id: 'minimax-m3', reasoningEffort: 'high' });
    const conflicting: ModelProfile = {
      id,
      revision: 1,
      name: 'Taken',
      description: 'different route',
      enabled: false,
      model: { provider: 'other', id: 'elsewhere' },
    };
    try {
      migrateFusion({
        fusionBytes: Buffer.from(JSON.stringify(domainEnvelope(fusionState()))),
        classmatesJson: classmatesConfig([conflicting]),
      });
      throw new Error('expected conflict');
    } catch (error) {
      expect(error).toMatchObject({ code: 'CONFLICT' });
    }
  });

  it('rejects candidate hash mismatch and active work instead of replaying', () => {
    const broken = fusionState();
    ((taskOf(broken).candidates as Array<{ hash: string }>)[0]).hash = '0'.repeat(64);
    try {
      migrateFusion({ fusionBytes: Buffer.from(JSON.stringify(domainEnvelope(broken))) });
      throw new Error('expected hash mismatch');
    } catch (error) {
      expect(error).toMatchObject({ code: 'HASH_MISMATCH' });
    }

    for (const state of ['dispatching', 'working', 'review', 'decision'] as const) {
      const active = fusionState();
      taskOf(active).state = state;
      try {
        migrateFusion({ fusionBytes: Buffer.from(JSON.stringify(domainEnvelope(active))) });
        throw new Error(`expected ${state} to fail`);
      } catch (error) {
        expect(error).toMatchObject({ code: 'ACTIVE_TASK' });
      }
    }
    const cleanupPending = fusionState();
    taskOf(cleanupPending).state = 'accepted';
    taskOf(cleanupPending).cleanup = 'pending';
    expectActive(cleanupPending);
    const cleanupFailed = fusionState();
    taskOf(cleanupFailed).state = 'accepted';
    taskOf(cleanupFailed).cleanup = 'failed';
    expectActive(cleanupFailed);
    const applicationPending = fusionState();
    taskOf(applicationPending).application = {
      id: 'app-1', candidateId: 'cand-1', candidateHash: hashText('Exact candidate <script>alert(1)</script>'),
      path: 'scene.md', beforeVersion: '', afterHash: 'a'.repeat(64), state: 'pending',
    };
    expectActive(applicationPending);

    const pendingAdoption = fusionState({
      pairs: [writingPair({ adoption: 'pending' })],
    });
    expect(taskOf(pendingAdoption).application).toBeUndefined();
    expect(taskOf(pendingAdoption).state).toBe('accepted');
    expectActive(pendingAdoption);

    expectActive(fusionState({ pairs: [writingPair({ adoption: 'conflict' })] }));
    const unresolvedConflict = fusionState({
      pairs: [writingPair({
        adoption: 'conflict',
        application: {
          id: 'app-1', candidateId: 'cand-1', candidateHash: hashText('Exact candidate <script>alert(1)</script>'),
          path: 'scene.md', beforeVersion: '', afterHash: 'a'.repeat(64), state: 'conflict',
        },
      })],
    });
    expect(taskOf(unresolvedConflict)).toMatchObject({
      state: 'accepted', adoption: 'conflict', application: { state: 'conflict' },
    });
    expectActive(unresolvedConflict);
  });

  it('archives settled writing adoption without mutating original bytes', () => {
    const state = fusionState({
      pairs: [writingPair({
        adoption: 'applied',
        cleanup: 'done',
        application: {
          id: 'app-1', candidateId: 'cand-1', candidateHash: hashText('Exact candidate <script>alert(1)</script>'),
          path: 'scene.md', beforeVersion: '', afterHash: 'b'.repeat(64), state: 'applied', version: 'v1',
        },
      })],
    });
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(state)));
    const result = migrateFusion({ fusionBytes });
    expect(result.sourceBytes.equals(fusionBytes)).toBe(true);
    expect(result.pairs[0].tasks[0]).toMatchObject({
      state: 'accepted', adoption: 'applied', cleanup: 'done', applicationState: 'applied',
    });
    expect(renderArchiveHtml(result)).toContain('adoption applied');
    const dismissed = migrateFusion({
      fusionBytes: Buffer.from(JSON.stringify(domainEnvelope(fusionState({
        pairs: [writingPair({ adoption: 'dismissed' })],
      })))),
    });
    expect(dismissed.pairs[0].tasks[0].adoption).toBe('dismissed');
  });

  it('archives dismissed writing with historical application conflict', () => {
    const application = {
      id: 'app-1',
      candidateId: 'cand-1',
      candidateHash: hashText('Exact candidate <script>alert(1)</script>'),
      path: 'scene.md',
      beforeVersion: '',
      afterHash: 'a'.repeat(64),
      state: 'conflict',
    };
    const state = fusionState({
      pairs: [writingPair({
        state: 'accepted',
        adoption: 'dismissed',
        application,
      })],
    });
    expect(taskOf(state)).toMatchObject({
      state: 'accepted', adoption: 'dismissed', application,
    });
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(state)));
    const result = migrateFusion({ fusionBytes });
    expect(result.sourceBytes.equals(fusionBytes)).toBe(true);
    expect(result.pairs[0].tasks[0]).toMatchObject({
      state: 'accepted', adoption: 'dismissed', applicationState: 'conflict',
    });
    const html = renderArchiveHtml(result);
    expect(html).toContain('adoption dismissed');
    expect(html).toContain('application conflict');
  });

  it('escapes archive HTML and stays offline', () => {
    const result = migrateFusion({ fusionBytes: Buffer.from(JSON.stringify(domainEnvelope(fusionState()))) });
    const html = renderArchiveHtml(result);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script src=/);
    expect(escapeHtml('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&#39;');
  });

  it('CLI writes only after success and writes nothing on conflict or hash failure', async () => {
    const dir = tmp();
    const fusionPath = join(dir, 'fusion.json');
    const outputPath = join(dir, 'out.json');
    const archiveDir = join(dir, 'archive');
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(fusionState(), 1)));
    writeFileSync(fusionPath, fusionBytes);
    const ok = await migrateFusionCli([
      '--fusion', fusionPath, '--output', outputPath, '--archive', archiveDir,
    ], io);
    expect(ok.code).toBe(0);
    expect(readFileSync(join(archiveDir, 'source.json'))).toEqual(fusionBytes);
    expect(JSON.parse(readFileSync(join(archiveDir, 'report.json'), 'utf8')).sourceSha256).toBe(sha256Hex(fusionBytes));
    expect(readFileSync(join(archiveDir, 'archive.html'), 'utf8')).toContain(sha256Hex(fusionBytes));
    const merged = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(merged.modelProfiles.length).toBeGreaterThan(0);

    const conflictDir = tmp();
    const conflictFusion = join(conflictDir, 'fusion.json');
    const conflictOut = join(conflictDir, 'out.json');
    const conflictArchive = join(conflictDir, 'archive.html');
    const id = fusionProfileId({ provider: 'ocg', id: 'minimax-m3', reasoningEffort: 'high' });
    writeFileSync(conflictFusion, JSON.stringify(domainEnvelope(fusionState())));
    writeFileSync(join(conflictDir, 'classmates.json'), JSON.stringify(classmatesConfig([{
      id, revision: 1, name: 'Taken', description: 'nope', enabled: false,
      model: { provider: 'other', id: 'elsewhere' },
    }])));
    await expect(migrateFusionCli([
      '--fusion', conflictFusion,
      '--classmates', join(conflictDir, 'classmates.json'),
      '--output', conflictOut,
      '--archive', conflictArchive,
    ], io)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(existsSync(conflictOut)).toBe(false);
    expect(existsSync(conflictArchive)).toBe(false);
    expect(existsSync(conflictArchive.replace(/\.html$/u, '.source.json'))).toBe(false);

    const hashDir = tmp();
    const hashFusion = join(hashDir, 'fusion.json');
    const hashOut = join(hashDir, 'out.json');
    const broken = fusionState();
    ((taskOf(broken).candidates as Array<{ hash: string }>)[0]).hash = '0'.repeat(64);
    writeFileSync(hashFusion, JSON.stringify(domainEnvelope(broken)));
    await expect(migrateFusionCli([
      '--fusion', hashFusion, '--output', hashOut,
    ], io)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
    expect(existsSync(hashOut)).toBe(false);
  });

  it('runs the documented Node CLI as a subprocess against a real unit envelope', async () => {
    await ensureCompiledCli();
    const compiled = readFileSync(compiledCli, 'utf8');
    expect(compiled).not.toMatch(/readonly code/);
    expect(compiled).not.toMatch(/from ['"]\.\.\/src\/.*\.ts['"]/);

    const dir = tmp();
    const fusionPath = join(dir, 'fusion.json');
    const outputPath = join(dir, 'out.json');
    const archiveDir = join(dir, 'archive');
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(fusionState(), 2)));
    writeFileSync(fusionPath, fusionBytes);
    const ok = await spawnNode(documentedCli, [
      '--fusion', fusionPath, '--output', outputPath, '--archive', archiveDir,
    ]);
    expect(ok.stderr, ok.stderr).toBe('');
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/sourceSha256 /);
    expect(readFileSync(join(archiveDir, 'source.json'))).toEqual(fusionBytes);
    expect(JSON.parse(readFileSync(outputPath, 'utf8')).modelProfiles.every((profile: { enabled: boolean }) => profile.enabled === false)).toBe(true);

    const emptyPath = join(dir, 'empty.json');
    const emptyOut = join(dir, 'empty-out.json');
    writeFileSync(emptyPath, REAL_EMPTY_DOMAIN_JSON);
    const emptyRun = await spawnNode(compiledCli, ['--fusion', emptyPath, '--output', emptyOut]);
    expect(emptyRun.stderr, emptyRun.stderr).toBe('');
    expect(emptyRun.code).toBe(0);
    expect(JSON.parse(readFileSync(emptyOut, 'utf8')).modelProfiles).toEqual([]);

    const conflictDir = tmp();
    const conflictFusion = join(conflictDir, 'fusion.json');
    const conflictOut = join(conflictDir, 'out.json');
    const id = fusionProfileId({ provider: 'ocg', id: 'minimax-m3', reasoningEffort: 'high' });
    writeFileSync(conflictFusion, JSON.stringify(domainEnvelope(fusionState())));
    writeFileSync(join(conflictDir, 'classmates.json'), JSON.stringify(classmatesConfig([{
      id, revision: 1, name: 'Taken', description: 'nope', enabled: false,
      model: { provider: 'other', id: 'elsewhere' },
    }])));
    const conflict = await spawnNode(documentedCli, [
      '--fusion', conflictFusion,
      '--classmates', join(conflictDir, 'classmates.json'),
      '--output', conflictOut,
    ]);
    expect(conflict.code).toBe(1);
    expect(conflict.stderr).toMatch(/^CONFLICT:/);
    expect(existsSync(conflictOut)).toBe(false);
  }, 20_000);

  it('CLI pre-flights path collisions and leaves input bytes untouched', async () => {
    const dir = tmp();
    const fusionPath = join(dir, 'same.json');
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(fusionState())));
    writeFileSync(fusionPath, fusionBytes);
    await expect(migrateFusionCli(['--fusion', fusionPath, '--output', fusionPath], io))
      .rejects.toMatchObject({ code: 'PATH_COLLISION' });
    expect(readFileSync(fusionPath)).toEqual(fusionBytes);

    const archive = join(dir, 'archive');
    await expect(migrateFusionCli([
      '--fusion', fusionPath, '--output', join(archive, 'source.json'), '--archive', archive,
    ], io)).rejects.toMatchObject({ code: 'PATH_COLLISION' });
    expect(existsSync(join(archive, 'source.json'))).toBe(false);
    expect(existsSync(join(archive, 'archive.html'))).toBe(false);
    expect(existsSync(join(archive, 'report.json'))).toBe(false);
    expect(readFileSync(fusionPath)).toEqual(fusionBytes);

    if (process.platform === 'win32') {
      await expect(migrateFusionCli(['--fusion', fusionPath, '--output', join(dir, 'SAME.json')], io))
        .rejects.toMatchObject({ code: 'PATH_COLLISION' });
      expect(readFileSync(fusionPath)).toEqual(fusionBytes);
    }

    const linkedOut = join(dir, 'linked-out.json');
    try {
      linkSync(fusionPath, linkedOut);
      await expect(migrateFusionCli(['--fusion', fusionPath, '--output', linkedOut], io))
        .rejects.toMatchObject({ code: 'PATH_COLLISION' });
      expect(readFileSync(fusionPath)).toEqual(fusionBytes);
      expect(readFileSync(linkedOut)).toEqual(fusionBytes);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !['EPERM', 'ENOTSUP', 'EACCES', 'EXDEV'].includes(code)) throw error;
    }

    const alias = join(dir, 'alias.json');
    try {
      symlinkSync(fusionPath, alias, 'file');
      await expect(migrateFusionCli(['--fusion', fusionPath, '--output', alias], io))
        .rejects.toMatchObject({ code: 'PATH_COLLISION' });
      expect(readFileSync(fusionPath)).toEqual(fusionBytes);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !['EPERM', 'ENOTSUP', 'EACCES', 'EEXIST'].includes(code)) throw error;
    }
  });

  it('refuses a different existing archive and accepts an identical rerun', async () => {
    const dir = tmp();
    const fusionPath = join(dir, 'fusion.json');
    const outputPath = join(dir, 'out.json');
    const archiveDir = join(dir, 'archive');
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(fusionState())));
    writeFileSync(fusionPath, fusionBytes);
    mkdirSync(archiveDir);
    writeFileSync(join(archiveDir, 'source.json'), 'earlier-archive');
    await expect(migrateFusionCli([
      '--fusion', fusionPath, '--output', outputPath, '--archive', archiveDir,
    ], io)).rejects.toMatchObject({ code: 'DESTINATION_CONFLICT' });
    expect(readFileSync(join(archiveDir, 'source.json'), 'utf8')).toBe('earlier-archive');
    expect(existsSync(join(archiveDir, 'archive.html'))).toBe(false);
    expect(existsSync(join(archiveDir, 'report.json'))).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
    expect(readFileSync(fusionPath)).toEqual(fusionBytes);

    rmSync(join(archiveDir, 'source.json'));
    const first = await migrateFusionCli([
      '--fusion', fusionPath, '--output', outputPath, '--archive', archiveDir,
    ], io);
    expect(first.code).toBe(0);
    const sourceAfter = readFileSync(join(archiveDir, 'source.json'));
    const htmlAfter = readFileSync(join(archiveDir, 'archive.html'));
    const reportAfter = readFileSync(join(archiveDir, 'report.json'));
    const outAfter = readFileSync(outputPath);
    const second = await migrateFusionCli([
      '--fusion', fusionPath, '--output', outputPath, '--archive', archiveDir,
    ], io);
    expect(second.code).toBe(0);
    expect(readFileSync(join(archiveDir, 'source.json'))).toEqual(sourceAfter);
    expect(readFileSync(join(archiveDir, 'archive.html'))).toEqual(htmlAfter);
    expect(readFileSync(join(archiveDir, 'report.json'))).toEqual(reportAfter);
    expect(readFileSync(outputPath)).toEqual(outAfter);
  });

  it('documented CLI subprocess refuses collisions without partial outputs', async () => {
    await ensureCompiledCli();
    const dir = tmp();
    const fusionPath = join(dir, 'same.json');
    const fusionBytes = Buffer.from(JSON.stringify(domainEnvelope(fusionState(), 2)));
    writeFileSync(fusionPath, fusionBytes);
    const same = await spawnNode(documentedCli, ['--fusion', fusionPath, '--output', fusionPath]);
    expect(same.code).toBe(1);
    expect(same.stderr).toMatch(/^PATH_COLLISION:/);
    expect(readFileSync(fusionPath)).toEqual(fusionBytes);

    const archive = join(dir, 'archive');
    const nested = await spawnNode(documentedCli, [
      '--fusion', fusionPath, '--output', join(archive, 'source.json'), '--archive', archive,
    ]);
    expect(nested.code).toBe(1);
    expect(nested.stderr).toMatch(/^PATH_COLLISION:/);
    expect(existsSync(join(archive, 'source.json'))).toBe(false);
    expect(existsSync(join(archive, 'archive.html'))).toBe(false);
    expect(existsSync(join(archive, 'report.json'))).toBe(false);
    expect(readFileSync(fusionPath)).toEqual(fusionBytes);

    mkdirSync(archive);
    writeFileSync(join(archive, 'source.json'), 'earlier-archive');
    const outputPath = join(dir, 'out.json');
    const existing = await spawnNode(documentedCli, [
      '--fusion', fusionPath, '--output', outputPath, '--archive', archive,
    ]);
    expect(existing.code).toBe(1);
    expect(existing.stderr).toMatch(/^DESTINATION_CONFLICT:/);
    expect(readFileSync(join(archive, 'source.json'), 'utf8')).toBe('earlier-archive');
    expect(existsSync(join(archive, 'archive.html'))).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
    expect(readFileSync(fusionPath)).toEqual(fusionBytes);
  }, 20_000);
});
