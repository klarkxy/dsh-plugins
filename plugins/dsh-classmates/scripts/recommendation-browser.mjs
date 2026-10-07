import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

/**
 * Portable source browser acceptance: actual React pages, isolated in-memory
 * CAS storage, repository host-primitive doubles. No DSH install, fixed port,
 * credentials or model calls. Run from any cwd with this script's path.
 * Artifacts: package .test-output/model-source-*. Native dispatch is verified
 * by package tests; this fixture does not claim installed-host acceptance.
 */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(pkgRoot, `.test-output/model-source-${Date.now()}`);
await mkdir(root, { recursive: true });
const bundle = await build({
  entryPoints: [resolve(pkgRoot, 'tests/helpers/model-browser-fixture.tsx')],
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  alias: { '@deepseek-ai/dsh-client-ui-primitives': resolve(pkgRoot, '../../scripts/editor-plugins/ui-primitives-stub.tsx') },
});
const route = { provider: 'fixture', id: 'review-model' };
const state = {
  roles: [{ schemaVersion: 1, id: 'reviewer', revision: 1, name: 'Reviewer', description: 'Review the brief',
    instructions: 'Original instructions', enabled: false, model: { kind: 'inherit' } }],
  modelProfiles: [{ id: 'review-high', revision: 1, name: 'Review high', description: 'Careful review', enabled: true,
    model: { ...route, reasoningEffort: 'high' } }],
  protectedModels: [], settingsRevision: 1, writable: true,
  models: [{ ...route, name: 'Review model', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }],
};
const attempts = [];
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return;
    }
    if (req.method === 'GET' && req.url !== '/state') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script type="module" src="/app.js"></script>'); return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      let bytes = ''; for await (const chunk of req) bytes += chunk;
      const body = JSON.parse(bytes);
      attempts.push({ path: req.url, ...structuredClone(body) });
      if (body.revision !== state.settingsRevision) throw Error('Settings revision conflict');
      const profile = req.url.includes('profile');
      const list = profile ? state.modelProfiles : state.roles;
      const value = profile ? body.profile : body.role;
      const id = value?.id ?? body.id;
      const index = list.findIndex(item => item.id === id);
      const revision = value?.revision ?? body.profileRevision ?? body.roleRevision;
      if (revision !== (list[index]?.revision ?? 0)) throw Error('Role/profile revision conflict');
      if (req.url.startsWith('/remove-')) list.splice(index, 1);
      else {
        const saved = { ...value, revision: revision + 1 };
        if (index < 0) list.push(saved); else list[index] = saved;
      }
      state.settingsRevision++;
    }
    res.end(JSON.stringify(state));
  } catch (error) { res.statusCode = 409; res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const checks = [];
const pageErrors = [];
let browser;
let page;
const save = target => target.getByRole('button', { name: /^(Save|保存)$/ });
const roleRow = target => target.locator('#classmates-panel-roles .dsh-ui-list-item').filter({ hasText: 'Reviewer' });
const accepted = () => state.roles.find(role => role.id === 'reviewer');
async function ready(target, locale = 'en') {
  target.on('pageerror', error => pageErrors.push(error.message));
  await target.goto(`${url}/?locale=${locale}`);
  await roleRow(target).click();
  await expect(target.locator('#classmates-model-source')).toBeVisible();
}
async function source(target, kind) {
  await target.locator('#classmates-model-source').selectOption(kind);
  await expect(target.locator('#classmates-model-source')).toBeEnabled();
}
try {
  browser = await chromium.launch({ channel: process.env.CLASSMATES_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  page = await context.newPage(); await ready(page);

  // Ordinary immediate save must preserve dirty text and advance its CAS base.
  await page.locator('#classmates-instructions').fill('Local ordinary edit');
  const before = attempts.length;
  await source(page, 'fixed');
  expect(attempts).toHaveLength(before); // incomplete route is not submitted
  await page.locator('#classmates-model-fixed').selectOption(JSON.stringify(route));
  await expect(page.locator('#classmates-model-effort')).toBeEnabled();
  await expect(page.locator('#classmates-model-effort option[value=""]')).toHaveText('Inherit conversation effort');
  expect(accepted().model).toEqual({ kind: 'fixed', ...route });
  expect(accepted().instructions).toBe('Original instructions');
  await expect(page.locator('#classmates-instructions')).toHaveValue('Local ordinary edit');
  await save(page).click();
  await expect(page.locator('.dsh-ui-notice')).toContainText('Saved');
  expect(accepted().instructions).toBe('Local ordinary edit');
  await page.locator('#classmates-model-effort').selectOption('low');
  await expect(page.locator('#classmates-model-effort')).toBeEnabled();
  expect(accepted().model.effort).toBe('low');
  await source(page, 'inherit');
  expect(accepted().model).toEqual({ kind: 'inherit' });
  checks.push('Immediate inherit/fixed/effort changes preserve dirty text and permit its ordinary save');

  // Two mounted editors: remote text -> refresh -> model save -> stale text
  // save. Refresh is exposed after the real stale enable-toggle CAS failure.
  const remote = await context.newPage(); await ready(remote);
  await page.locator('#classmates-instructions').fill('Unsaved stale local text');
  await remote.locator('#classmates-instructions').fill('Text saved by the other editor');
  await save(remote).click();
  await expect(remote.locator('.dsh-ui-notice')).toContainText('Saved');
  await page.getByRole('switch', { name: 'Enable Reviewer', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh list', exact: true }).click();
  await expect(page.locator('#classmates-model-source')).toBeEnabled();
  const staleRevision = attempts.at(-1).role.revision;
  await source(page, 'fixed'); // remembered route makes this save immediately
  expect(accepted().instructions).toBe('Text saved by the other editor');
  await expect(page.locator('#classmates-instructions')).toHaveValue('Unsaved stale local text');
  await expect(page.getByRole('alert').filter({ hasText: 'updated elsewhere' })).toBeVisible();
  await save(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'revision conflict' })).toBeVisible();
  expect(attempts.at(-1).role.revision).toBe(staleRevision);
  expect(accepted().instructions).toBe('Text saved by the other editor');
  expect(accepted().model.kind).toBe('fixed');
  checks.push('Two editors: refresh and model save retain stale text CAS and reject overwrite');
  await remote.close();

  await page.reload(); await roleRow(page).click();
  await source(page, 'profile');
  await page.locator('#classmates-model-profile').selectOption('review-high');
  await expect(page.locator('#classmates-model-profile')).toBeEnabled();
  expect(accepted().model).toEqual({ kind: 'profile', profileId: 'review-high' });
  await page.locator('#classmates-tab-models').click();
  await page.getByRole('switch', { name: 'Enable Review high', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Reviewer');
  await page.getByRole('dialog').getByRole('button', { name: /Disable/ }).click();
  await expect(page.getByRole('switch', { name: 'Enable Review high', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.locator('#classmates-tab-roles').click();
  await expect(page.locator('#classmates-model-profile-warning')).toContainText('dispatching this role will fail');
  expect(accepted().model).toEqual({ kind: 'profile', profileId: 'review-high' });
  checks.push('Disabled strong reference stays bound and warns of dispatch failure without fallback');

  await page.locator('#classmates-tab-models').click();
  await page.locator('#classmates-panel-models .dsh-ui-list-item').filter({ hasText: 'Review high' }).click();
  await page.getByRole('button', { name: 'Delete model preset', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Reviewer');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.locator('#classmates-tab-roles').click();
  await expect(page.locator('#classmates-model-profile-warning')).toContainText('does not exist');
  expect(accepted().model).toEqual({ kind: 'profile', profileId: 'review-high' });
  await source(page, 'inherit');
  expect(accepted().model).toEqual({ kind: 'inherit' });
  checks.push('Deleting a referenced preset names affected roles, retains missing binding, allows explicit inherit recovery');

  const zh = await context.newPage(); await ready(zh, 'zh');
  await source(zh, 'fixed');
  await zh.locator('#classmates-model-fixed').selectOption(JSON.stringify(route));
  await expect(zh.locator('#classmates-model-effort option[value=""]')).toHaveText('继承会话思考强度');
  await zh.locator('#classmates-tab-roles').focus(); await zh.keyboard.press('ArrowRight');
  await expect(zh.locator('#classmates-tab-models')).toHaveAttribute('aria-selected', 'true');
  await zh.keyboard.press('ArrowLeft');
  await expect(zh.locator('#classmates-tab-roles')).toHaveAttribute('aria-selected', 'true');
  await zh.setViewportSize({ width: 390, height: 844 });
  expect(await zh.locator('.classmates').evaluate(element => element.scrollWidth > element.clientWidth + 2)).toBe(false);
  checks.push('English/Chinese effort labels, keyboard tabs and 390px layout pass');
  expect(pageErrors).toEqual([]);
  await writeFile(resolve(root, 'result.json'), JSON.stringify({ checks, pageErrors, attempts }, null, 2));
  console.log(JSON.stringify({ root, checks, pageErrors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: resolve(root, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(root, 'error.txt'), String(error));
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
