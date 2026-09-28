import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = resolve(`.test-output/model-approval-${Date.now()}`);
await mkdir(root, { recursive: true });
const host = spawn(process.execPath, ['scripts/model-profiles-host.mjs'], {
  env: { ...process.env, CLASSMATES_PROOF_ROOT: root },
  stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
});
let stdout = '', stderr = '', browser, page;
host.stdout.on('data', chunk => { stdout += chunk; });
host.stderr.on('data', chunk => { stderr += chunk; });
const checks = [], pageErrors = [];
async function waitForOutput(prefix, offset = 0) {
  const deadline = Date.now() + 45000;
  while (!stdout.slice(offset).includes(prefix)) {
    if (host.exitCode !== null || Date.now() > deadline) throw Error(`Host missing ${prefix}: ${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return stdout.slice(offset).split(/\r?\n/).find(line => line.startsWith(prefix));
}
async function command(text, prefix) {
  const offset = stdout.length;
  host.stdin.write(text + '\n');
  return waitForOutput(prefix, offset);
}
async function openModels(target) {
  await target.getByRole('button', { name: '插件', exact: true }).click();
  await target.getByRole('button', { name: /^查看 (?:队友角色|@klarkxy\/dsh-classmates)$/ }).click();
  await target.getByRole('tab', { name: '模型', exact: true }).click();
  await target.getByRole('region', { name: '启动审批' }).waitFor();
}
const route = JSON.stringify({ provider: 'fixture', id: 'review-model' });
async function approvalState() {
  const line = await command('approval-state', 'APPROVAL_PROOF_STATE ');
  return JSON.parse(line.slice('APPROVAL_PROOF_STATE '.length));
}
async function startApprovalSession() {
  const started = JSON.parse((await command('approval-start', 'APPROVAL_PROOF_STARTED ')).slice('APPROVAL_PROOF_STARTED '.length));
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click();
  const composer = page.getByRole('textbox', { name: '描述你想要构建的内容, / 调用指令, @ 文件或对话', exact: true });
  await composer.fill(started.prompt);
  await expect(page.getByRole('button', { name: /选择模型，当前 主控模型/ })).toBeVisible();
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}
try {
  await waitForOutput('MODEL_PROFILES_READY');
  const url = stdout.match(/http:\/\/127\.0\.0\.1:19449\/\?token=\S+/)?.[0];
  if (!url) throw Error('Host URL missing');
  await command('creator-proof', 'CREATOR_MODEL_PROOF ');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url);
  if (!process.argv.includes('--approval-only')) {
  await openModels(page);
  await page.getByRole('button', { name: /创造模式审查.*创造模式工具/ }).click();
  await page.locator('#classmates-profile-description').fill('开关保存后仍应保留的草稿');
  await page.locator('#classmates-protection-model').selectOption(route);
  const toggle = page.getByRole('switch', { name: /^使用前确认：.*审查模型/ });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#classmates-profile-description')).toHaveValue('开关保存后仍应保留的草稿');
  checks.push('Keyboard toggle saves route protection through native settings RPC and retains profile draft');
  await page.screenshot({ path: `${root}/desktop.png`, fullPage: true });
  await page.reload();
  await openModels(page);
  await expect(page.getByRole('list', { name: '已开启使用前确认的模型' })).toContainText('审查模型');
  checks.push('Protection persists through browser reload');
  await page.getByRole('button', { name: /创造模式审查.*创造模式工具/ }).click();
  await page.locator('#classmates-profile-description').fill('并发刷新后保留草稿');
  await page.locator('#classmates-protection-model').selectOption(route);
  const second = await context.newPage();
  await second.goto(url);
  await openModels(second);
  await second.getByRole('switch', { name: /^关闭使用前确认：.*审查模型/ }).click();
  await expect(second.getByRole('list', { name: '已开启使用前确认的模型' })).toHaveCount(0);
  await toggle.click();
  await expect(page.getByRole('alert').filter({ hasText: '未能关闭' })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('region', { name: '启动审批' }).getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '未能关闭' })).toHaveCount(0);
  await expect(page.locator('#classmates-profile-description')).toHaveValue('并发刷新后保留草稿');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await second.close();
  checks.push('Stale toggle is rejected; explicit refresh clears its error and preserves unsaved profile text');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除预设', exact: true }).click();
  await expect(page.getByRole('list', { name: '已开启使用前确认的模型' })).toContainText('审查模型');
  await command('hide-review', 'REVIEW_VISIBILITY_UPDATED');
  await page.reload();
  await openModels(page);
  await expect(page.getByRole('list', { name: '已开启使用前确认的模型' })).toContainText('此模型已不在当前目录中');
  await expect(page.getByRole('switch', { name: /^关闭使用前确认：.*review-model/ })).toBeEnabled();
  checks.push('Protection remains visible and removable after deleting the only profile and removing the catalog entry');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('region', { name: '启动审批' }).scrollIntoViewIfNeeded();
  expect(await page.locator('.classmates').evaluate(el => el.scrollWidth > el.clientWidth + 2)).toBe(false);
  await page.screenshot({ path: `${root}/mobile.png`, fullPage: true });
  checks.push('390px model protection layout fits without horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await command('show-review', 'REVIEW_VISIBILITY_UPDATED');
  }
  await startApprovalSession();
  const approve = page.getByRole('button', { name: /允许一次|批准一次|仅此一次/ });
  await expect(approve).toBeVisible({ timeout: 20000 });
  const before = await approvalState();
  expect(before.requests.filter(item => item.model === 'review-model')).toHaveLength(0);
  await page.screenshot({ path: `${root}/native-approval.png`, fullPage: true });
  await approve.click();
  await expect.poll(async () => (await approvalState()).requests.filter(item => item.model === 'review-model').length, { timeout: 30000 }).toBe(1);
  const accepted = await approvalState();
  expect(accepted.events.some(event => event.type === 'approval/decided' && event.data.outcome === 'allowed-once')).toBe(true);
  checks.push('Real Web approval holds native child creation until user clicks allow once, then starts one local child');
  await startApprovalSession();
  await expect(approve).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect.poll(async () => (await approvalState()).events.some(event => event.type === 'approval/decided' && event.data.outcome === 'rejected')).toBe(true);
  const rejected = await approvalState();
  expect(rejected.requests.filter(item => item.model === 'review-model')).toHaveLength(1);
  checks.push('Rejecting the next creation records native rejection and starts no second child');
  expect(pageErrors).toEqual([]);
  await writeFile(`${root}/result.json`, JSON.stringify({ checks, pageErrors, upstreamCalls: 0, accepted, rejected }, null, 2));
  console.log(JSON.stringify({ root, checks, pageErrors }, null, 2));
} catch (error) {
  if (host.exitCode === null && stdout.includes('APPROVAL_PROOF_STARTED ')) {
    await writeFile(`${root}/approval-failure.json`, JSON.stringify(await approvalState(), null, 2)).catch(() => {});
  }
  if (page) {
    await page.screenshot({ path: `${root}/failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${root}/failure.txt`, await page.locator('body').innerText().catch(() => '')).catch(() => {});
    await writeFile(`${root}/failure-aria.txt`, await page.locator('body').ariaSnapshot().catch(() => '')).catch(() => {});
  }
  await writeFile(`${root}/error.txt`, String(error) + '\n' + stderr);
  console.error('MODEL_APPROVAL_BROWSER_FAILED ' + root);
  throw error;
} finally {
  await browser?.close();
  host.stdin.write('stop\n');
  const deadline = Date.now() + 15000;
  while (host.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (host.exitCode === null) { host.kill(); throw Error('Host did not stop cleanly'); }
}
