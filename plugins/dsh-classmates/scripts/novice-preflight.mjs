import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  AclSandbox,
  assertTempRootOutsideWorkspace,
  tempWriteSid,
  workspaceWriteSid,
} from '@deepseek-ai/dsh-sandbox-windows-acl';

export const DSH_VERSION = createRequire(import.meta.url)('@deepseek-ai/dsh/package.json').version;
export const BLOCKED_EXIT = 1;
export const WORKSPACE_PREFIX = 'dsh-novice-ws-';
export const ACL_TEMP_PREFIX = 'dsh-novice-acltemp-';
export const WORKSPACE_MARKER = 'dsh-novice-preflight.marker';
export const WRITE_PROBE_FILE = 'novice-preflight-write.txt';
export const WRITE_PROBE_MARKER = 'novice-preflight workspace write succeeded';
export const SCREENSHOT_FILE = 'novice-preflight-click.png';
export const BUTTON_NAME = 'novice-preflight-click';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '..');
export const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, '.test-output', 'novice-preflight');
const PLAYWRIGHT_ROOT = join(REPO_ROOT, 'node_modules', '@playwright', 'test');
const NODE_MODULES_ROOT = join(REPO_ROOT, 'node_modules');

export class BlockedError extends Error {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  constructor(message, detail = {}) {
    super(message);
    this.name = 'BlockedError';
    this.blocked = true;
    this.detail = detail;
  }
}

export function isInsideDirectory(parent, target) {
  const root = resolve(parent);
  const path = resolve(target);
  const rel = relative(root, path);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return !rel.startsWith('..');
}

export function assertAllowedWorkspace(workspace, repoRoot = REPO_ROOT) {
  const resolved = resolve(workspace);
  if (isInsideDirectory(repoRoot, resolved)) {
    throw new BlockedError(
      `novice workspace must not be created inside the repository or demo tree: workspace=${resolved}; repo=${resolve(repoRoot)}`,
      { workspace: resolved, repoRoot: resolve(repoRoot), code: 'workspace-in-repo' },
    );
  }
  return resolved;
}

export function assertAllowedOutput(outputPath, repoRoot = REPO_ROOT) {
  const resolved = resolve(outputPath);
  const outputRoot = resolve(repoRoot, '.test-output', 'novice-preflight');
  const tempRoot = resolve(tmpdir());
  if (isInsideDirectory(outputRoot, resolved) || isInsideDirectory(tempRoot, resolved)) return resolved;
  throw new BlockedError(
    `preflight artifacts must stay under .test-output/novice-preflight or os.tmpdir: path=${resolved}`,
    { path: resolved, code: 'output-not-allowed' },
  );
}

export function refuseSuppliedEndpointFile(endpointFile) {
  if (endpointFile == null || endpointFile === '') return null;
  throw new BlockedError(
    `refusing supplied browser endpoint file ${resolve(String(endpointFile))}; this preflight launches its own local Edge service and does not read old endpoints`,
    { endpointFile: resolve(String(endpointFile)), code: 'stale-endpoint-refused' },
  );
}

export function planBrowserLaunch(inheritedEndpoint) {
  return {
    action: 'launch-own',
    inheritedEndpointIgnored: inheritedEndpoint ? String(inheritedEndpoint) : null,
  };
}

export function allocateDefaultWorkspace(tempRoot = tmpdir()) {
  const dir = mkdtempSync(join(tempRoot, WORKSPACE_PREFIX));
  try {
    return assertAllowedWorkspace(dir);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

export function assertTempDisjoint(workspace, tempDir) {
  if (isInsideDirectory(workspace, tempDir) || isInsideDirectory(tempDir, workspace)) {
    throw new BlockedError(
      `ACL temp must be disjoint from workspace: workspace=${resolve(workspace)}; temp=${resolve(tempDir)}`,
      { code: 'temp-overlap' },
    );
  }
}

export function parseArgs(argv) {
  const out = {
    keepAlive: false,
    workspace: null,
    receipt: null,
    outputDir: null,
    endpointFile: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keep-alive') {
      out.keepAlive = true;
      continue;
    }
    const takesValue = new Set(['--workspace', '--receipt', '--output-dir', '--endpoint-file']);
    if (takesValue.has(arg)) {
      const value = argv[i + 1];
      if (value == null || value.startsWith('--')) {
        throw new BlockedError(`missing value for ${arg}`, { code: 'usage' });
      }
      i += 1;
      if (arg === '--workspace') out.workspace = value;
      if (arg === '--receipt') out.receipt = value;
      if (arg === '--output-dir') out.outputDir = value;
      if (arg === '--endpoint-file') out.endpointFile = value;
      continue;
    }
    throw new BlockedError(`unknown argument: ${arg}`, { code: 'usage' });
  }
  return out;
}

export function emptyCheck(name) {
  return { name, status: 'pending', error: null };
}

export function formatError(error) {
  if (error == null) return null;
  const detail = {
    name: error.name ?? 'Error',
    message: error.message ?? String(error),
  };
  if (error.api != null) detail.api = error.api;
  if (error.win32Code != null) detail.win32Code = error.win32Code;
  if (error.detail != null) detail.detail = error.detail;
  if (error.code != null && error.win32Code == null) detail.code = error.code;
  return detail;
}

export function createReceipt(partial = {}) {
  return {
    checkedAt: new Date().toISOString(),
    status: 'blocked',
    mode: partial.mode ?? 'probe',
    dsh: DSH_VERSION,
    node: process.version,
    platform: process.platform,
    workspace: null,
    workspaceAncestry: { insideRepo: false, insideDemo: false, inTmpdir: false },
    blindTest: false,
    remoteModelCalls: 0,
    acl: emptyCheck('acl'),
    write: emptyCheck('write'),
    browser: emptyCheck('browser'),
    agentsMd: null,
    env: {},
    cleanup: { browserClosed: false, sandboxDisposed: false, processesStarted: [] },
    notes: 'This is an environment preflight, not a blind product trial. Receipt records actual ACL/write/browser results.',
    ...partial,
  };
}

export function invalidateBrowserReceipt(receipt, at = new Date().toISOString()) {
  const browser = receipt.browser ?? {};
  browser.endpointValid = false;
  browser.endpointStatus = 'invalid';
  browser.invalidatedAt = at;
  receipt.browser = browser;
  if (receipt.env) receipt.env.DSH_TEST_BROWSER_WS = null;
  return receipt;
}

export function buildAgentsMd(receipt) {
  const workspace = receipt.workspace ?? '(unavailable)';
  const aclLine = receipt.acl?.status === 'ok'
    ? `Windows AclSandbox workspace-write 已在本工作区完成写入探针。`
    : `Windows AclSandbox 未通过：${receipt.acl?.error?.message ?? receipt.acl?.error ?? 'blocked'}。未宣称工作区写入可用。`;
  const browserLine = receipt.browser?.status === 'ok' && receipt.browser?.endpointValid
    ? `独立本机 Edge 服务已预检真实点击与截图。已验证的连接方式：chromium.connect(process.env.DSH_TEST_BROWSER_WS)。使用后断开连接即可，由预检进程管理服务生命周期。`
    : receipt.browser?.status === 'ok'
      ? `本轮探针已真实点击并截图，但浏览器服务已关闭，端点已失效。后续宿主必须自行启动新的独立 Edge 服务，不能复用旧端点。`
      : `浏览器预检未通过：${receipt.browser?.error?.message ?? receipt.browser?.error ?? 'blocked'}。未宣称浏览器可用。`;
  const endpointLine = receipt.browser?.endpointValid
    ? `DSH_TEST_BROWSER_WS=${receipt.browser.endpoint}`
    : 'DSH_TEST_BROWSER_WS 当前无效。';
  return [
    '# 本轮工作区环境',
    '',
    `工作区绝对路径：${workspace}`,
    `预检时间：${receipt.checkedAt}`,
    '本说明只记录本轮实际路径和已检查的工具能力。不是产品实现、不是角色指令、不是盲测。',
    '',
    '## 运行时',
    `- Node：${receipt.nodePath ?? process.execPath} (${receipt.node ?? process.version})`,
    `- DSH：${receipt.dsh ?? DSH_VERSION}`,
    `- 系统：${receipt.platform ?? process.platform}`,
    `- Playwright 模块：${PLAYWRIGHT_ROOT}`,
    `- NODE_PATH=${NODE_MODULES_ROOT}`,
    '- NODE_PATH 可用于 CommonJS require；ES module 脚本请通过上述模块绝对路径的 index.mjs 导入。',
    '',
    '## 写入边界',
    `- ${aclLine}`,
    '',
    '## 浏览器',
    `- ${browserLine}`,
    `- ${endpointLine}`,
    '',
    '## 禁止',
    '- 不读取凭据，不调用远程模型。',
    '- 不把仓库 demo/ 或其它旧工作区当作本轮上下文。',
    `- remoteModelCalls=${receipt.remoteModelCalls ?? 0}`,
    '',
  ].join('\n');
}

export function environmentFromReceipt(receipt) {
  return {
    workspace: receipt.workspace,
    browserEndpoint: receipt.browser?.endpointValid ? receipt.browser.endpoint : null,
    endpointValid: Boolean(receipt.browser?.endpointValid),
    env: {
      DSH_TEST_BROWSER_WS: receipt.browser?.endpointValid ? receipt.browser.endpoint : null,
      NODE_PATH: NODE_MODULES_ROOT,
    },
    agentsMd: receipt.agentsMd,
    receipt: receipt.receiptPath ?? null,
    remoteModelCalls: 0,
    status: receipt.status,
    mode: receipt.mode,
  };
}

function ancestry(workspace, repoRoot = REPO_ROOT) {
  const resolved = resolve(workspace);
  return {
    insideRepo: isInsideDirectory(repoRoot, resolved),
    insideDemo: isInsideDirectory(join(repoRoot, 'demo'), resolved),
    inTmpdir: isInsideDirectory(tmpdir(), resolved),
  };
}

function canonical(path) {
  return realpathSync.native(resolve(path));
}

function buildProbeSource({ endpoint, writeFileName, screenshotName, buttonName }) {
  return `import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const result = { write: null, browser: null, remoteModelCalls: 0 };
try {
  await writeFile(${JSON.stringify(writeFileName)}, ${JSON.stringify(WRITE_PROBE_MARKER)});
  result.write = { status: 'ok', file: ${JSON.stringify(writeFileName)} };
} catch (error) {
  result.write = { status: 'blocked', error: error?.message ?? String(error) };
}
try {
  const endpoint = ${JSON.stringify(endpoint ?? '')};
  if (!endpoint) throw new Error('no browser endpoint from this run');
  const browser = await chromium.connect(endpoint);
  const page = await browser.newPage();
  await page.setContent(${JSON.stringify(`<!doctype html><button type="button" id="n">${buttonName}</button><script>
    document.getElementById('n').addEventListener('click', () => {
      document.getElementById('n').textContent = 'clicked';
      document.body.dataset.clicked = '1';
    });
  </script>`)});
  await page.getByRole('button', { name: ${JSON.stringify(buttonName)} }).click();
  const clicked = await page.locator('body').getAttribute('data-clicked');
  if (clicked !== '1') throw new Error('click did not update the page');
  await page.screenshot({ path: ${JSON.stringify(screenshotName)} });
  await browser.close();
  result.browser = { status: 'ok', clicked: true, screenshot: ${JSON.stringify(screenshotName)} };
} catch (error) {
  result.browser = { status: 'blocked', error: error?.message ?? String(error) };
}
console.log('NOVICE_PROBE_RESULT ' + JSON.stringify(result));
if (result.write?.status !== 'ok' || result.browser?.status !== 'ok') process.exit(2);
`;
}

function parseProbeStdout(stdout) {
  const text = String(stdout ?? '');
  const line = text.split(/\r?\n/).find(item => item.startsWith('NOVICE_PROBE_RESULT '));
  if (!line) return null;
  try {
    return JSON.parse(line.slice('NOVICE_PROBE_RESULT '.length));
  } catch {
    return null;
  }
}

async function persist(receipt, paths) {
  receipt.receiptPath = paths.receipt;
  const json = `${JSON.stringify(receipt, null, 2)}\n`;
  await mkdir(dirname(paths.receipt), { recursive: true });
  await writeFile(paths.receipt, json);
  await writeFile(paths.environment, `${JSON.stringify(environmentFromReceipt(receipt), null, 2)}\n`);
  if (receipt.workspace && receipt.agentsMdContent) {
    await writeFile(join(receipt.workspace, 'AGENTS.md'), receipt.agentsMdContent);
    await writeFile(paths.agentsMd, receipt.agentsMdContent);
  }
}

function waitForStop() {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve();
    };
    rl.on('line', line => {
      if (line.trim() === 'stop') done();
    });
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { onTimeout?.(); } catch {}
      reject(new BlockedError(`timed out after ${ms}ms`, { code: 'timeout' }));
    }, ms);
    promise.then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * @param {ReturnType<typeof parseArgs>} options
 */
export async function run(options = {}) {
  const mode = options.keepAlive ? 'keep-alive' : 'probe';
  const receipt = createReceipt({ mode, nodePath: process.execPath, remoteModelCalls: 0 });
  let paths = {
    outputDir: DEFAULT_OUTPUT_DIR,
    receipt: join(DEFAULT_OUTPUT_DIR, 'receipt.json'),
    environment: join(DEFAULT_OUTPUT_DIR, 'environment.json'),
    agentsMd: join(DEFAULT_OUTPUT_DIR, 'AGENTS.md'),
    probe: join(DEFAULT_OUTPUT_DIR, 'probe.mjs'),
  };
  receipt.outputDir = DEFAULT_OUTPUT_DIR;

  let browserServer = null;
  let sandbox = null;
  let sandboxInited = false;
  const previousTemp = process.env.TEMP;
  const previousTmp = process.env.TMP;
  const started = receipt.cleanup.processesStarted;

  const restoreTemp = () => {
    if (previousTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = previousTemp;
    if (previousTmp === undefined) delete process.env.TMP;
    else process.env.TMP = previousTmp;
  };

  const shutdownOwned = async () => {
    if (sandbox && sandboxInited) {
      try {
        sandbox.dispose();
        receipt.cleanup.sandboxDisposed = true;
      } catch (error) {
        receipt.cleanup.sandboxDisposeError = formatError(error);
      }
      sandboxInited = false;
    }
    if (browserServer) {
      try {
        await browserServer.close();
        receipt.cleanup.browserClosed = true;
      } catch (error) {
        receipt.cleanup.browserCloseError = formatError(error);
      }
      browserServer = null;
    }
    restoreTemp();
  };

  try {
    const outputDir = assertAllowedOutput(options.outputDir ?? DEFAULT_OUTPUT_DIR);
    const receiptPath = assertAllowedOutput(options.receipt ?? join(outputDir, 'receipt.json'));
    paths = {
      outputDir,
      receipt: receiptPath,
      environment: join(outputDir, 'environment.json'),
      agentsMd: join(outputDir, 'AGENTS.md'),
      probe: join(outputDir, 'probe.mjs'),
    };
    receipt.outputDir = outputDir;
    refuseSuppliedEndpointFile(options.endpointFile);
    const browserPlan = planBrowserLaunch(process.env.DSH_TEST_BROWSER_WS);
    receipt.browser.inheritedEndpointIgnored = browserPlan.inheritedEndpointIgnored;
    receipt.browser.launchedThisRun = false;
    receipt.browser.endpointValid = false;

    let workspace;
    if (options.workspace) {
      workspace = assertAllowedWorkspace(options.workspace);
      await mkdir(workspace, { recursive: true });
    } else {
      workspace = allocateDefaultWorkspace();
    }
    workspace = canonical(workspace);
    assertAllowedWorkspace(workspace);
    receipt.workspace = workspace;
    receipt.workspaceAncestry = ancestry(workspace);
    await writeFile(join(workspace, WORKSPACE_MARKER), `novice-preflight workspace\ncreatedAt=${receipt.checkedAt}\n`);

    const aclTemp = canonical(mkdtempSync(join(tmpdir(), ACL_TEMP_PREFIX)));
    assertTempRootOutsideWorkspace(workspace, aclTemp);
    assertTempDisjoint(workspace, aclTemp);
    receipt.acl.tempDir = aclTemp;
    receipt.acl.writableDirs = [workspace];
    receipt.acl.mode = 'workspace-write';

    let endpoint = '';
    try {
      browserServer = await chromium.launchServer({
        channel: 'msedge',
        headless: true,
        host: '127.0.0.1',
        port: 0,
      });
      endpoint = browserServer.wsEndpoint();
      receipt.browser.launchedThisRun = true;
      receipt.browser.endpoint = endpoint;
      receipt.browser.host = '127.0.0.1';
      const child = browserServer.process?.();
      if (child?.pid) {
        receipt.browser.pid = child.pid;
        started.push({ role: 'edge-browser-service', pid: child.pid });
      }
    } catch (error) {
      receipt.browser.status = 'blocked';
      receipt.browser.error = formatError(error);
      endpoint = '';
    }

    const probeSource = buildProbeSource({
      endpoint,
      writeFileName: WRITE_PROBE_FILE,
      screenshotName: SCREENSHOT_FILE,
      buttonName: BUTTON_NAME,
    });
    await mkdir(outputDir, { recursive: true });
    await writeFile(paths.probe, probeSource);

    const spawnSpec = {
      command: process.execPath,
      args: [paths.probe],
      cwd: workspace,
    };
    receipt.acl.command = spawnSpec;

    process.env.TEMP = aclTemp;
    process.env.TMP = aclTemp;
    try {
      const writeSid = workspaceWriteSid(workspace);
      const tempSid = tempWriteSid(aclTemp);
      receipt.acl.writeSid = writeSid;
      receipt.acl.tempWriteSid = tempSid;
      sandbox = new AclSandbox({
        writableDirs: [workspace],
        tempDir: aclTemp,
        writeSid,
        tempWriteSid: tempSid,
        mode: 'workspace-write',
      });
      await sandbox.init();
      sandboxInited = true;
      receipt.acl.status = 'ok';
    } catch (error) {
      receipt.acl.status = 'blocked';
      receipt.acl.error = formatError(error);
    }

    if (receipt.acl.status === 'ok' && sandbox) {
      try {
        const child = sandbox.spawn(spawnSpec);
        started.push({ role: 'acl-probe', pid: child.pid });
        receipt.acl.pid = child.pid;
        const result = await withTimeout(child.wait(), 60_000, () => {
          try { process.kill(child.pid); } catch {}
        });
        receipt.acl.exitCode = result.exitCode;
        receipt.acl.stdout = result.stdout.toString();
        receipt.acl.stderr = result.stderr.toString();
        const probe = parseProbeStdout(receipt.acl.stdout);
        receipt.write = {
          name: 'write',
          status: probe?.write?.status === 'ok' ? 'ok' : 'blocked',
          file: join(workspace, WRITE_PROBE_FILE),
          error: probe?.write?.status === 'ok' ? null : formatError(new Error(probe?.write?.error ?? `probe exit ${result.exitCode}`)),
        };
        if (receipt.browser.status !== 'blocked' || receipt.browser.error == null) {
          receipt.browser = {
            ...receipt.browser,
            name: 'browser',
            status: probe?.browser?.status === 'ok' ? 'ok' : 'blocked',
            clicked: Boolean(probe?.browser?.clicked),
            screenshot: join(workspace, SCREENSHOT_FILE),
            error: probe?.browser?.status === 'ok' ? null : formatError(new Error(probe?.browser?.error ?? `probe exit ${result.exitCode}`)),
            launchedThisRun: receipt.browser.launchedThisRun,
            inheritedEndpointIgnored: receipt.browser.inheritedEndpointIgnored,
            endpoint,
            host: '127.0.0.1',
            pid: receipt.browser.pid,
            endpointValid: false,
          };
        }
      } catch (error) {
        receipt.write.status = receipt.write.status === 'ok' ? 'ok' : 'blocked';
        if (receipt.write.status !== 'ok') receipt.write.error = formatError(error);
        if (receipt.browser.status !== 'ok') {
          receipt.browser.status = 'blocked';
          receipt.browser.error = receipt.browser.error ?? formatError(error);
        }
      }
    } else {
      receipt.write.status = 'blocked';
      receipt.write.error = formatError(new Error('write probe not started because ACL init is blocked'));
      if (receipt.browser.status !== 'blocked') {
        receipt.browser.status = 'blocked';
        receipt.browser.error = formatError(new Error('browser click probe requires the same restricted process; ACL is blocked'));
      }
      receipt.browser.endpoint = endpoint || null;
    }

    if (receipt.acl.status === 'ok' && receipt.write.status === 'ok' && receipt.browser.status === 'ok') {
      receipt.status = 'ok';
    } else {
      receipt.status = 'blocked';
    }

    receipt.browser.endpointValid = Boolean(
      options.keepAlive && receipt.status === 'ok' && receipt.browser.status === 'ok' && endpoint,
    );
    receipt.env = {
      DSH_TEST_BROWSER_WS: receipt.browser.endpointValid ? endpoint : null,
      NODE_PATH: NODE_MODULES_ROOT,
    };

    if (sandbox && sandboxInited) {
      try {
        sandbox.dispose();
        receipt.cleanup.sandboxDisposed = true;
      } catch (error) {
        receipt.cleanup.sandboxDisposeError = formatError(error);
      }
      sandboxInited = false;
    }

    receipt.agentsMdContent = buildAgentsMd(receipt);
    receipt.agentsMd = join(workspace, 'AGENTS.md');
    await persist(receipt, paths);

    if (receipt.write.status === 'ok') {
      try { await copyFile(join(workspace, WRITE_PROBE_FILE), join(outputDir, WRITE_PROBE_FILE)); } catch {}
    }
    if (receipt.browser.status === 'ok') {
      try { await copyFile(join(workspace, SCREENSHOT_FILE), join(outputDir, SCREENSHOT_FILE)); } catch {}
    }

    if (options.keepAlive && receipt.status === 'ok') {
      console.error('NOVICE_PREFLIGHT_READY');
      await waitForStop();
      invalidateBrowserReceipt(receipt);
      receipt.agentsMdContent = buildAgentsMd(receipt);
      await persist(receipt, paths);
    }

    return { code: receipt.status === 'ok' ? 0 : BLOCKED_EXIT, receipt };
  } catch (error) {
    receipt.status = 'blocked';
    receipt.error = formatError(error);
    for (const key of ['acl', 'write', 'browser']) {
      if (receipt[key]?.status === 'pending') {
        receipt[key].status = 'blocked';
        receipt[key].error = formatError(error);
      }
    }
    if (!receipt.agentsMdContent) receipt.agentsMdContent = buildAgentsMd(receipt);
    try { await persist(receipt, paths); } catch {}
    return { code: BLOCKED_EXIT, receipt };
  } finally {
    await shutdownOwned();
    if (receipt.mode === 'probe') {
      receipt.browser.endpointValid = false;
      receipt.env = { ...receipt.env, DSH_TEST_BROWSER_WS: null, NODE_PATH: NODE_MODULES_ROOT };
    }
    try { await persist(receipt, paths); } catch {}
  }
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(fileURLToPath(import.meta.url)) === resolve(entry);
}

if (isMain()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { code, receipt } = await run(options);
    console.log(JSON.stringify(receipt));
    process.exit(code);
  } catch (error) {
    const receipt = createReceipt({ status: 'blocked', error: formatError(error) });
    for (const key of ['acl', 'write', 'browser']) {
      receipt[key].status = 'blocked';
      receipt[key].error = formatError(error);
    }
    try {
      await mkdir(DEFAULT_OUTPUT_DIR, { recursive: true });
      await writeFile(join(DEFAULT_OUTPUT_DIR, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    } catch {}
    console.log(JSON.stringify(receipt));
    process.exit(BLOCKED_EXIT);
  }
}
