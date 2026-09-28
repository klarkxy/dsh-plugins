// Isolated installed-profile acceptance. Real DSH runtime, local mock model.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
const repo = resolve('.');
const profileName = 'plugin-settings';
const root = resolve('.test-output/plugin-settings');
const workspace = join(root, 'workspace');
process.env.DSH_HOME = join(root, 'home');
process.env.DSH_TELEMETRY_DISABLED = '1';
process.env.NO_UPDATE_NOTIFIER = '1';
const profile = join(process.env.DSH_HOME, 'profiles', profileName);
await mkdir(workspace, { recursive: true });
// Loader associates a file plugin with its nearest package. Give the fixture
// its own package boundary so it never advertises Classmates' browser entry.
const mockRoot = join(root, 'mock-runtime');
await mkdir(mockRoot, { recursive: true });
await writeFile(join(mockRoot, 'package.json'), JSON.stringify({ name: 'classmates-acceptance-mock', private: true, type: 'module' }));
const mockPath = join(mockRoot, 'index.mjs');
await cp(join(repo, 'scripts/enhancement-mock.mjs'), mockPath);
await import(pathToFileURL(mockPath).href);
const { initProfile, loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot');
const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-agent-team-profile', '@klarkxy/dsh-classmates'];
initProfile(profile, bundles);
const manifestPath = join(profile, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.dependencies = { ...manifest.dependencies, '@klarkxy/dsh-classmates': 'file:' + repo.replaceAll('\\', '/') };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
const localPlugin = join(profile, 'node_modules', '@klarkxy', 'dsh-classmates');
await mkdir(localPlugin, { recursive: true });
for (const item of ['dist', 'package.json', 'cordis.patch.yml', 'icon.svg', 'locale']) await cp(join(repo, item), join(localPlugin, item), { recursive: true });
const roles = process.env.DSH_SETTINGS_ALL_PRESETS === '1' ? (await import('../src/presets.ts')).createPresets() : [
  { id: 'designer', name: '界面制作同学', description: '实现清晰易用的页面和交互', model: { provider: 'fixture', id: 'design-model' } },
  { id: 'reviewer', name: '独立审查同学', description: '检查实现、提出具体问题', model: { provider: 'fixture', id: 'review-model', reasoningEffort: 'high' } },
].map(role => ({ schemaVersion: 1, revision: 1, enabled: true, instructions: '这是一项本地验收任务，只需简短回复，无需调用工具。', ...role }));
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
  { id: 'agent-default-model', config: { provider: 'fixture', model: 'lead-model' } },
  { id: 'session-title-llm', disabled: true },
  { id: 'classmates', config: { roles } },
  { id: 'ui-theme', config: { preference: 'light' } },
  { id: 'ui-settings-general', name: '@deepseek-ai/dsh-client-ui-settings-general', config: { welcomeNoticeVersion: '2026-08-13.1' } },
  { insert: [{ id: 'enhancement-mock', name: pathToFileURL(mockPath).href }] },
], null, 2));
// Do not implicitly load the repository's cordis.patch.yml as a project patch.
process.chdir(workspace);
const { ctx, shutdown } = await runProfile({ environment: loadLayeredEnv('classmates-enhancement', workspace), profile: profileName, patchFiles: [], args: ['--host', '127.0.0.1', '--port', '19445', '--no-open'] });
await ctx.workspaceRegistry.create(workspace, '插件设置验收');
console.log('PLUGIN_SETTINGS_READY');
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === 'stop') { await shutdown.shutdown(0); break; }
}
process.exit(0);
