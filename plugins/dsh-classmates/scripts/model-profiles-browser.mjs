import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(`.test-output/model-profiles-${Date.now()}`);
await mkdir(root, { recursive: true });
const host = spawn(process.execPath, ['scripts/model-profiles-host.mjs'], {
  env: { ...process.env, CLASSMATES_PROOF_ROOT: root },
  stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
let stdout = '', stderr = '', browser, page;
host.stdout.on('data', chunk => { stdout += chunk; });
host.stderr.on('data', chunk => { stderr += chunk; });
const checks = [];
const pageErrors = [];
async function openModels(target) {
  await target.getByRole('button', { name: '插件', exact: true }).click();
  await target.getByRole('button', { name: /^查看 (?:队友角色|@klarkxy\/dsh-classmates)$/ }).click();
  await target.getByRole('tab', { name: '模型', exact: true }).click();
  await target.getByRole('button', { name: '新建模型预设', exact: true }).waitFor();
}
async function addProfile(target, name, effort) {
  await target.getByRole('button', { name: '新建模型预设', exact: true }).click();
  await target.locator('#classmates-profile-name').fill(name);
  await target.locator('#classmates-profile-description').fill(`${name}的用途说明`);
  const select = target.locator('#classmates-profile-model');
  const option = select.locator('option').filter({ hasText: '审查模型' });
  await select.selectOption(await option.getAttribute('value'));
  await target.locator('#classmates-profile-effort').selectOption(effort);
  await target.getByRole('button', { name: '保存', exact: true }).click();
  await expect(target.locator('.classmates-notice').filter({ hasText: '已保存' })).toBeVisible();
  const toggle = target.getByRole('switch', { name: `启用模型预设 ${name}`, exact: true });
  if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
}
try {
  const deadline = Date.now() + 45000;
  while (!stdout.includes('MODEL_PROFILES_READY')) {
    if (host.exitCode !== null || Date.now() > deadline) throw Error('Host failed to start: ' + stderr);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const url = stdout.match(/http:\/\/127\.0\.0\.1:19449\/\?token=\S+/)?.[0];
  if (!url) throw Error('Host URL missing');
  host.stdin.write('creator-proof\n');
  const creatorDeadline = Date.now() + 20000;
  while (!stdout.includes('CREATOR_MODEL_PROOF ')) {
    if (host.exitCode !== null || Date.now() > creatorDeadline) throw Error('Creator proof failed: ' + stderr);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  checks.push('Built plugin Creator tools save into the UI library; ordinary session mutation denied');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url);
  await openModels(page);
  await expect(page.getByRole('button', { name: /创造模式审查.*创造模式工具/ })).toBeVisible();
  await addProfile(page, '快速审查', 'low');
  await addProfile(page, '复杂审查', 'high');
  checks.push('UI saves two enabled profiles on the same model with different efforts');
  await page.locator('#classmates-profile-description').fill('切换页签时保留的草稿');
  await page.getByRole('tab', { name: '模型', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: '模板', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '模型', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#classmates-profile-description')).toHaveValue('切换页签时保留的草稿');
  await page.locator('#classmates-profile-description').fill('复杂审查的用途说明');
  checks.push('Keyboard tab navigation preserves unsaved model-profile input');
  await page.getByRole('tab', { name: '模板', exact: true }).click();
  await page.getByRole('button', { name: '新建角色', exact: true }).click();
  await expect(page.locator('#classmates-panel-roles #classmates-model')).toHaveCount(0);
  await expect(page.locator('#classmates-panel-roles #classmates-effort')).toHaveCount(0);
  await page.locator('#classmates-panel-roles').getByLabel('名称', { exact: true }).fill('无需绑定模型的模板');
  await page.getByLabel('职责说明', { exact: true }).fill('检查任务结果');
  await page.getByLabel('工作指令', { exact: true }).fill('Review the task and report concrete findings.');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.classmates-notice').filter({ hasText: '已保存' }).first()).toBeVisible();
  await page.getByRole('tab', { name: '模型', exact: true }).click();
  await expect(page.getByRole('button', { name: /复杂审查.*用途说明/ })).toBeVisible();
  checks.push('New duty template saves without model fields and preserves the model library');
  await page.reload();
  await openModels(page);
  await page.getByRole('button', { name: /复杂审查.*用途说明/ }).click();
  await expect(page.locator('#classmates-profile-effort')).toHaveValue('high');
  checks.push('Profiles persist through real settings RPC and browser reload');
  await page.screenshot({ path: `${root}/desktop.png`, fullPage: true });

  const second = await context.newPage();
  await second.goto(url);
  await openModels(second);
  await second.getByRole('button', { name: /复杂审查.*用途说明/ }).click();
  await page.locator('#classmates-profile-description').fill('本窗口尚未保存的用途');
  await second.locator('#classmates-profile-description').fill('另一个窗口保存的用途');
  await second.getByRole('button', { name: '保存', exact: true }).click();
  await expect(second.locator('.classmates-notice').filter({ hasText: '已保存' })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '保存失败' })).toBeVisible();
  await expect(page.locator('#classmates-profile-description')).toHaveValue('本窗口尚未保存的用途');
  await page.getByRole('button', { name: '加载最新版本', exact: true }).click();
  await expect(page.getByRole('group', { name: '最新版本对照' })).toContainText('另一个窗口保存的用途');
  await expect(page.locator('#classmates-profile-description')).toHaveValue('本窗口尚未保存的用途');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.classmates-notice').filter({ hasText: '已保存' })).toBeVisible();
  checks.push('Concurrent save rejects stale revision, retains draft, and supports reviewed resave');
  await second.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#classmates-profile-name').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${root}/mobile.png`, fullPage: true });
  const overflow = await page.locator('.classmates').evaluate(element => element.scrollWidth > element.clientWidth + 2);
  expect(overflow).toBe(false);
  const brokenLabels = await page.locator('[aria-describedby]').evaluateAll(elements => elements.flatMap(element =>
    (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && !document.getElementById(id))));
  expect(brokenLabels).toEqual([]);
  await page.locator('#classmates-profile-effort').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${root}/mobile-fields.png`, fullPage: true });
  checks.push('390px layout has no plugin overflow or broken descriptive references');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('#classmates-profile-name').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${root}/dark.png`, fullPage: true });
  const colors = await page.getByRole('button', { name: '保存', exact: true }).evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  expect(colors.color).not.toBe(colors.background);
  checks.push('Native dark theme keeps the editor and save control readable');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除预设', exact: true }).click();
  await expect(page.locator('.classmates-notice').filter({ hasText: '已删除' })).toBeVisible();
  await page.reload();
  await openModels(page);
  await expect(page.getByRole('button', { name: /复杂审查/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /快速审查.*用途说明/ })).toHaveCount(1);
  checks.push('Deletion persists without removing the other profile');
  expect(pageErrors).toEqual([]);
  await writeFile(`${root}/result.json`, JSON.stringify({ checks, pageErrors }, null, 2));
  console.log(JSON.stringify({ root, checks, pageErrors }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${root}/failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${root}/failure.txt`, await page.locator('body').innerText().catch(() => '')).catch(() => {});
  }
  await writeFile(`${root}/error.txt`, String(error) + '\n' + stderr);
  console.error('MODEL_PROFILE_BROWSER_FAILED ' + root);
  throw error;
} finally {
  await browser?.close();
  host.stdin.write('stop\n');
  const deadline = Date.now() + 15000;
  while (host.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (host.exitCode === null) { host.kill(); throw Error('Host did not stop cleanly'); }
}
