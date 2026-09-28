import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

// @ts-expect-error JS preflight module is the leaf under test
import * as preflight from '../scripts/novice-preflight.mjs';

const {
  BLOCKED_EXIT,
  DEFAULT_OUTPUT_DIR,
  REPO_ROOT,
  WORKSPACE_MARKER,
  WORKSPACE_PREFIX,
  allocateDefaultWorkspace,
  assertAllowedOutput,
  assertAllowedWorkspace,
  buildAgentsMd,
  createReceipt,
  invalidateBrowserReceipt,
  isInsideDirectory,
  parseArgs,
  planBrowserLaunch,
  refuseSuppliedEndpointFile,
} = preflight;

const script = resolve(REPO_ROOT, 'scripts/novice-preflight.mjs');
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`preflight CLI timed out\nstdout=${stdout}\nstderr=${stderr}`));
    }, 15_000);
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

function parseReceipt(stdout: string) {
  const line = stdout.trim().split(/\r?\n/).at(-1);
  if (!line) throw new Error(`empty CLI stdout: ${stdout}`);
  return JSON.parse(line);
}

it('refuses a workspace inside the repository, demo tree, or package test-output', () => {
  expect(() => assertAllowedWorkspace(REPO_ROOT)).toThrow(/must not be created inside/);
  expect(() => assertAllowedWorkspace(join(REPO_ROOT, 'demo'))).toThrow(/demo/);
  expect(() => assertAllowedWorkspace(join(REPO_ROOT, 'demo/novice-minesweeper'))).toThrow(/must not be created inside/);
  expect(() => assertAllowedWorkspace(join(REPO_ROOT, '.test-output/novice-preflight/ws'))).toThrow(/must not be created inside/);
  expect(isInsideDirectory(join(REPO_ROOT, 'demo'), join(REPO_ROOT, 'demo/novice-minesweeper'))).toBe(true);
  expect(isInsideDirectory(tmpdir(), join(REPO_ROOT, 'demo'))).toBe(false);
});

it('allocates a clearly marked workspace only under os.tmpdir', () => {
  const workspace = allocateDefaultWorkspace();
  temps.push(workspace);
  expect(workspace.startsWith(join(tmpdir(), WORKSPACE_PREFIX)) || workspace.includes(WORKSPACE_PREFIX)).toBe(true);
  expect(isInsideDirectory(tmpdir(), workspace)).toBe(true);
  expect(isInsideDirectory(REPO_ROOT, workspace)).toBe(false);
  expect(() => assertAllowedWorkspace(workspace)).not.toThrow();
});

it('keeps receipts under the novice-preflight output dir and rejects demo output paths', () => {
  expect(assertAllowedOutput(join(DEFAULT_OUTPUT_DIR, 'cli.json'))).toBe(resolve(DEFAULT_OUTPUT_DIR, 'cli.json'));
  expect(() => assertAllowedOutput(join(REPO_ROOT, 'demo/novice-preflight.json'))).toThrow(/os.tmpdir/);
});

it('does not consume an inherited browser websocket or a supplied endpoint file', () => {
  const stale = 'ws://127.0.0.1:19436/stale-minesweeper-endpoint';
  expect(planBrowserLaunch(stale)).toEqual({ action: 'launch-own', inheritedEndpointIgnored: stale });
  expect(planBrowserLaunch(undefined)).toEqual({ action: 'launch-own', inheritedEndpointIgnored: null });
  expect(() => refuseSuppliedEndpointFile(join(REPO_ROOT, '.test-output/minesweeper-v2-native/browser-endpoint.txt'))).toThrow(/refusing supplied browser endpoint/);
  expect(refuseSuppliedEndpointFile(null)).toBe(null);
});

it('marks a keep-alive environment receipt invalid after stop without inventing a live endpoint', () => {
  const receipt = createReceipt({
    status: 'ok',
    mode: 'keep-alive',
    browser: { status: 'ok', endpoint: 'ws://127.0.0.1:9/this-run', endpointValid: true },
    env: { DSH_TEST_BROWSER_WS: 'ws://127.0.0.1:9/this-run' },
  });
  invalidateBrowserReceipt(receipt, '2026-09-25T00:00:00.000Z');
  expect(receipt.browser.endpointValid).toBe(false);
  expect(receipt.browser.endpointStatus).toBe('invalid');
  expect(receipt.browser.invalidatedAt).toBe('2026-09-25T00:00:00.000Z');
  expect(receipt.env.DSH_TEST_BROWSER_WS).toBeNull();
  expect(receipt.remoteModelCalls).toBe(0);
});

it('writes environment notes with actual paths and no product, role, or old-demo briefing', () => {
  const workspace = join(tmpdir(), 'dsh-novice-ws-example');
  const text = buildAgentsMd(createReceipt({
    workspace,
    nodePath: process.execPath,
    acl: { status: 'blocked', error: { message: 'SetNamedSecurityInfoW failed' } },
    browser: { status: 'blocked', error: { message: 'not probed' }, endpointValid: false },
  }));
  expect(text).toContain(workspace);
  expect(text).toContain(process.execPath);
  expect(text).toContain('不是盲测');
  expect(text).not.toMatch(/扫雷|minesweeper|classmates_batch|策划|界面制作|settingsRevision|长提示/);
});

it('exits nonzero and blocked when a demo path is requested as workspace, without writing into that demo', async () => {
  const demo = join(REPO_ROOT, 'demo/novice-minesweeper');
  const outputDir = join(DEFAULT_OUTPUT_DIR, 'cli-demo-workspace');
  const result = await cli(['--workspace', demo, '--output-dir', outputDir], {
    DSH_TEST_BROWSER_WS: 'ws://127.0.0.1:19436/should-not-be-used',
  });
  expect(result.code).toBe(BLOCKED_EXIT);
  const receipt = parseReceipt(result.stdout);
  expect(receipt.status).toBe('blocked');
  expect(receipt.remoteModelCalls).toBe(0);
  expect(receipt.acl.status).toBe('blocked');
  expect(receipt.write.status).toBe('blocked');
  expect(receipt.browser.status).toBe('blocked');
  expect(receipt.browser.launchedThisRun).toBe(false);
  expect(receipt.browser.inheritedEndpointIgnored).toContain('19436/should-not-be-used');
  expect(existsSync(join(demo, WORKSPACE_MARKER))).toBe(false);
  expect(existsSync(join(demo, 'AGENTS.md'))).toBe(false);
  const saved = JSON.parse(readFileSync(join(outputDir, 'receipt.json'), 'utf8'));
  expect(saved.status).toBe('blocked');
});

it('exits nonzero when asked to read an old browser endpoint file instead of launching this run', async () => {
  const outputDir = join(DEFAULT_OUTPUT_DIR, 'cli-stale-endpoint');
  const stale = join(REPO_ROOT, '.test-output/minesweeper-v2-native/browser-endpoint.txt');
  const result = await cli(['--endpoint-file', stale, '--output-dir', outputDir]);
  expect(result.code).toBe(BLOCKED_EXIT);
  const receipt = parseReceipt(result.stdout);
  expect(receipt.status).toBe('blocked');
  expect(receipt.browser.status).toBe('blocked');
  expect(String(receipt.error?.message ?? receipt.browser.error?.message)).toMatch(/refusing supplied browser endpoint/);
  expect(receipt.browser.launchedThisRun).not.toBe(true);
});

it('rejects unknown CLI arguments before starting sandbox or browser work', () => {
  expect(() => parseArgs(['--silent-unrestrict'])).toThrow(/unknown argument/);
  expect(parseArgs(['--keep-alive']).keepAlive).toBe(true);
});
