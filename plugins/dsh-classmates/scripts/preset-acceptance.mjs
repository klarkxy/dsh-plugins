import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const root = '.test-output/presets';
await mkdir(root, { recursive: true });
const host = spawn(process.execPath, ['scripts/enhancement-host.mjs'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let output = '';
let errors = '';
host.stdout.on('data', chunk => { output += chunk; });
host.stderr.on('data', chunk => { errors += chunk; });
let browser;
const checks = [];
try {
  const deadline = Date.now() + 30000;
  while (!output.includes('ENHANCEMENT_READY')) {
    if (host.exitCode !== null || Date.now() > deadline) throw Error('Fixture host did not start: ' + errors);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const url = output.match(/http:\/\/127\.0\.0\.1:19441\/\?token=\S+/)?.[0];
  if (!url) throw Error('Fixture URL missing');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url);
  async function settings() {
    await page.getByRole('button', { name: '设置', exact: true }).waitFor();
    const onboarding = page.getByRole('button', { name: '继续', exact: true });
    if (await onboarding.isVisible()) await onboarding.click();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!await page.getByRole('button', { name: 'Classmates', exact: true }).isVisible()) await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('button', { name: 'Classmates', exact: true }).click();
        await page.getByRole('button', { name: '新建角色', exact: true }).waitFor({ timeout: 5000 });
        return;
      } catch (error) {
        if (attempt === 2) {
          await page.screenshot({ path: `${root}/failure.png`, fullPage: true });
          await writeFile(`${root}/failure.txt`, await page.locator('body').innerText());
          throw error;
        }
      }
    }
  }
  await settings();
  const presets = page.getByLabel('从预设添加', { exact: true });
  await expect(presets.locator('option')).toHaveCount(12);
  await presets.selectOption('reviewer');
  await page.getByRole('button', { name: '添加为新角色', exact: true }).click();
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('Reviewer');
  expect(await page.getByLabel('工作指令', { exact: true }).inputValue()).not.toMatch(/\p{Script=Han}/u);
  await expect(page.getByLabel('模型', { exact: true })).toHaveValue('-1');
  await expect(page.getByLabel('思考强度', { exact: true })).toHaveValue('');
  await expect(page.locator('.classmates-editor-meta')).not.toContainText('ID：reviewer（');
  await page.getByLabel('名称', { exact: true }).fill('Preset browser acceptance');
  await page.locator('#classmates-enabled').check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.classmates-notice')).toContainText('已保存');
  await expect(page.locator('.classmates-list .classmates-item')).toHaveCount(3);
  checks.push('11 presets; collision-safe add; enabled role with both fields inherited; original two roles preserved');
  await page.getByLabel('思考强度', { exact: true }).selectOption('low');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.classmates-notice')).toContainText('已保存');
  await page.reload();
  await settings();
  await page.locator('.classmates-item').filter({ hasText: 'Preset browser acceptance' }).click();
  await expect(page.getByLabel('模型', { exact: true })).toHaveValue('-1');
  await expect(page.getByLabel('思考强度', { exact: true })).toHaveValue('low');
  await expect(page.locator('#classmates-enabled')).toBeChecked();
  checks.push('effort-only override persists through settings transport and reload');
  const modelOption = page.getByLabel('模型', { exact: true }).locator('option').filter({ hasText: '审查模型' });
  await page.getByLabel('模型', { exact: true }).selectOption(await modelOption.getAttribute('value'));
  await expect(page.getByLabel('思考强度', { exact: true })).toHaveValue('low');
  await page.getByLabel('思考强度', { exact: true }).selectOption('');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.classmates-notice')).toContainText('已保存');
  checks.push('model change preserves explicit effort; effort can return independently to inheritance');
  await page.getByLabel('从预设添加', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${root}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${root}/mobile.png`, fullPage: true });
  await expect(page.locator('.classmates')).toHaveCount(1);
  const missingHelp = await page.locator('[aria-describedby]').evaluateAll(elements => elements.flatMap(element => (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && !document.getElementById(id))));
  expect(missingHelp).toEqual([]);
  const overflow = await page.locator('.classmates').evaluate(element => element.scrollWidth > element.clientWidth + 2);
  if (overflow) throw Error('Classmates page horizontally overflows');
  expect(pageErrors).toEqual([]);
  checks.push('390px layout without horizontal overflow; no page errors');
  await writeFile(`${root}/browser.json`, JSON.stringify({ checkedAt: new Date().toISOString(), checks, remoteModelCalls: 0 }, null, 2));
  console.log(JSON.stringify({ checks, remoteModelCalls: 0 }));
} finally {
  await browser?.close();
  if (host.exitCode === null) {
    host.stdin.write('stop\n');
    const exited = new Promise(resolve => host.once('exit', resolve));
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (host.exitCode === null) host.kill();
  }
}

