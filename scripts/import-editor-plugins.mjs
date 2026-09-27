/** One-time, reproducible extraction from the pinned Editor revision. No runtime code changes. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const SOURCE_REVISION = '66d03814ecdac679947e9198c2e9be931462703a';
export const NAMES = ['dsh-ai-services', 'dsh-current-title', 'dsh-mood', 'dsh-recap', 'dsh-memory', 'dsh-self-improvement', 'dsh-model-center', 'dsh-fusion', 'dsh-web-search-manager'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? '../source');
const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const writeJson = (path, value) => write(path, JSON.stringify(value, null, 2) + '\n');
const selected = new Set(NAMES.map(name => '@klarkxy/' + name));
if (existsSync(join(root, 'scripts/editor-plugin-migration.json'))) throw new Error('Extraction already applied; do not overwrite migrated source');
const origin = { repository: 'klarkxy/dsh-editor', revision: SOURCE_REVISION, holdPublish: true, packages: [], files: {} };
function recordFiles(dir, prefix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name), key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) recordFiles(path, key);
    else if (entry.isFile()) origin.files[key] = createHash('sha256').update(readFileSync(path)).digest('hex');
    else throw new Error(`Non-regular source entry: ${path}`);
  }
}
for (const name of NAMES) {
  const from = join(source, 'packages', name), to = join(root, 'plugins', name);
  const pkg = json(join(from, 'package.json'));
  if (existsSync(to) || pkg.private || pkg.name !== '@klarkxy/' + name || pkg.publishConfig?.access !== 'public') throw new Error(`Unsafe migration target: ${name}`);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const [dependency, spec] of Object.entries(pkg[field] ?? {})) {
      if (dependency.startsWith('dsh-editor-') || (spec.startsWith('workspace:') && !selected.has(dependency))) throw new Error(`${name}: non-portable ${field}: ${dependency}`);
    }
  }
  recordFiles(from, `packages/${name}`);
  cpSync(from, to, { recursive: true });
  pkg.repository = { type: 'git', url: 'git+https://github.com/klarkxy/dsh-plugins.git', directory: `plugins/${name}` };
  pkg.homepage = `https://klarkxy.github.io/dsh-plugins/plugins/${name.slice(4)}/`;
  pkg.bugs = { url: 'https://github.com/klarkxy/dsh-plugins/issues' };
  if (pkg.scripts?.test?.startsWith('vitest ')) pkg.scripts.test = `vitest run --root ../.. --config vitest.editor-plugins.config.ts --maxWorkers=2 plugins/${name}/src`;
  if (pkg.scripts?.build) pkg.scripts.build = pkg.scripts.build.replace('../../scripts/wrap-client.mjs', '../../scripts/editor-plugins/wrap-client.mjs');
  writeJson(join(to, 'package.json'), pkg);
  const tsconfig = json(join(to, 'tsconfig.json'));
  tsconfig.extends = '../../tsconfig.editor-plugins.json';
  writeJson(join(to, 'tsconfig.json'), tsconfig);
  origin.packages.push({ name: pkg.name, version: pkg.version, directory: `plugins/${name}` });
}
for (const file of ['wrap-client.mjs', 'client-node-shims.cjs', 'client-node-shims.spec.mjs']) {
  write(join(root, 'scripts/editor-plugins', file), read(join(source, 'scripts', file)));
}
// Keep public settings stylesheet regressions with their implementation.
let styles = read(join(source, 'scripts/client-style-ownership.spec.mjs'));
styles = styles.replace(/^import \{ apply as (plugins|zhihu) \}.*\n/gm, '').replace('../packages/dsh-web-search-manager/', '../../plugins/dsh-web-search-manager/');
styles = styles.replace("[['dsh-editor-plugins', plugins], ['@klarkxy/dsh-web-search-manager', search], ['@klarkxy/dsh-zhihu', zhihu]]", "[['@klarkxy/dsh-web-search-manager', search]]");
styles = styles.slice(0, styles.indexOf("  it('recreates Zhihu styles")) + '})\n';
write(join(root, 'scripts/editor-plugins/client-style-ownership.spec.mjs'), styles);
const compiler = json(join(source, 'tsconfig.base.json'));
compiler.compilerOptions.paths = Object.fromEntries(Object.entries(compiler.compilerOptions.paths).filter(([key]) => [...selected].some(name => key === name || key.startsWith(name + '/'))).map(([key, paths]) => [key, paths.map(path => path.replace(/^packages\//, 'plugins/'))]));
writeJson(join(root, 'tsconfig.editor-plugins.json'), compiler);
const aliases = Object.entries(compiler.compilerOptions.paths).sort(([a], [b]) => b.length - a.length).map(([key, paths]) => `      ${JSON.stringify(key)}: root + ${JSON.stringify(paths[0])},`).join('\n');
write(join(root, 'vitest.editor-plugins.config.ts'), `import { readFileSync } from 'node:fs'\nimport { fileURLToPath } from 'node:url'\nimport { defineConfig } from 'vitest/config'\nconst root = fileURLToPath(new URL('.', import.meta.url))\nexport default defineConfig({\n  plugins: [{ name: 'css-as-text', enforce: 'pre', load(id) {\n    const file = id.split('?')[0]; if (!file.endsWith('.css')) return null;\n    return 'export default ' + JSON.stringify(readFileSync(file, 'utf8'));\n  }, transform(_code, id) {\n    const file = id.split('?')[0]; if (!file.endsWith('.css')) return null;\n    return 'export default ' + JSON.stringify(readFileSync(file, 'utf8'));\n  } }],\n  resolve: { alias: {\n${aliases}\n  } },\n  test: { watch: false, maxWorkers: 2, include: ['plugins/*/src/**/*.spec.{ts,tsx}', 'plugins/*/test/**/*.spec.{ts,tsx}', 'scripts/editor-plugins/*.spec.mjs'] },\n})\n`);
const manifest = json(join(root, 'package.json'));
Object.assign(manifest.devDependencies, { tsdown: '^0.22.14', react: '^18.2.0', 'react-dom': '^18.2.0', '@types/react': '~18.3.1', playwright: '1.62.1' });
manifest.pnpm = { ...manifest.pnpm, onlyBuiltDependencies: ['esbuild'], overrides: { ...manifest.pnpm?.overrides, ...json(join(source, 'package.json')).pnpm.overrides } };
manifest.scripts.test = 'pnpm --workspace-concurrency=2 --filter "{plugins/*}" test';
manifest.scripts['test:editor-build'] = 'vitest run --config vitest.editor-plugins.config.ts scripts/editor-plugins';
manifest.scripts['test:e2e:web-search'] = 'node e2e/web-search-settings.mjs';
manifest.scripts.check = manifest.scripts.check.replace('pnpm site:test &&', 'pnpm site:test && pnpm test:editor-build &&');
writeJson(join(root, 'package.json'), manifest);
write(join(root, '.npmrc'), '@deepseek-ai:registry=https://registry.npmjs.org\n');
write(join(root, 'e2e/web-search-settings.mjs'), read(join(source, 'e2e/web-search-settings.mjs')).replaceAll('packages/dsh-web-search-manager/', 'plugins/dsh-web-search-manager/'));
write(join(root, '.gitignore'), read(join(root, '.gitignore')) + '\n# Migrated browser test output\ne2e/out/\n');
write(join(root, 'docs/editor-plugins/portable-learning.md'), `> Maintained here after extraction from dsh-editor ${SOURCE_REVISION}.\n\n` + read(join(source, 'docs/portable-learning.md')));
const catalog = json(join(root, 'site/catalog.json'));
const updateCatalog = value => {
  if (!value || typeof value !== 'object') return;
  if (selected.has(value.package)) { value.repository = 'https://github.com/klarkxy/dsh-plugins'; value.directory = `plugins/${value.package.split('/')[1]}`; }
  for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(updateCatalog); else if (child && typeof child === 'object') updateCatalog(child);
};
updateCatalog(catalog); writeJson(join(root, 'site/catalog.json'), catalog);
for (const filename of ['README.md', 'README.zh-CN.md']) {
  let text = read(join(root, filename));
  for (const name of NAMES) text = text.replaceAll(`https://github.com/klarkxy/dsh-editor/tree/main/packages/${name}`, `https://github.com/klarkxy/dsh-plugins/tree/main/plugins/${name}`);
  text = text.replace('## Published plugins from other repositories', '## Additional published plugins').replace('## 其他仓库已发布的插件', '## 更多已发布插件');
  text += filename === 'README.md' ? '\n## Editor public-plugin extraction\n\nNine portable packages are now maintained under `plugins/`. Package names, runtime code and persisted settings are unchanged. Zhihu, manuscript, proofread and application-private packages remain in Editor. Desktop preinstallation and offline startup are unchanged. See [handoff and validation](docs/editor-plugin-migration.md).\n' : '\n## Editor 公共插件迁移\n\n9 个可独立运行的包迁入 `plugins/`，保留包名、运行时代码与持久化设置。知乎、稿纸、校对及应用私有包暂留 Editor。桌面预装和离线启动方式不变。参见[交接与验收](docs/editor-plugin-migration.md)。\n';
  write(join(root, filename), text);
}
// Release planning resolves workspace dependencies in topological order and holds migrated packages.
let publisher = read(join(root, 'scripts/publish-npm.mjs'));
publisher = publisher.replace("import { discoverPackages } from './release-target.mjs';", "import { discoverPackages } from './release-target.mjs';\nimport { orderedPackages, packRelease, releaseCandidates } from './release-workspace.mjs';");
publisher = publisher.replace("  for (const pkg of discoverPackages(root)) {\n    const directory = join(root, pkg.directory);\n    const [packed] = JSON.parse(npm(['pack', '--dry-run', '--ignore-scripts', '--json'], directory));\n    const hash = contentHash(packed.files, path => readFileSync(join(directory, path)));", "  const packages = orderedPackages(root, releaseCandidates(root, discoverPackages(root)));\n  for (const pkg of packages) {\n    const { hash } = packRelease(root, pkg, packages, npm, contentHash);");
publisher = publisher.replace("  const pending = [];", "  const pending = [];\n  const packages = orderedPackages(root, releaseCandidates(root, discoverPackages(root)));\n  const allowed = new Set(packages.map(pkg => pkg.name));\n  if (releases.some(release => !allowed.has(release.name))) throw new Error('Release plan contains a held or removed package');");
publisher = publisher.replace("    const directory = join(root, release.directory);\n    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', join(root, '.artifacts/npm-release')], directory));\n    const currentHash = contentHash(packed.files, path => readFileSync(join(directory, path)));", "    const { packed, hash: currentHash } = packRelease(root, release, packages, npm, contentHash);");
if (publisher.includes("for (const pkg of discoverPackages(root))") || publisher.includes('const currentHash = contentHash')) throw new Error('Publisher patch did not apply');
write(join(root, 'scripts/publish-npm.mjs'), publisher);
writeJson(join(root, 'scripts/editor-plugin-migration.json'), origin);
console.log(`Extracted ${origin.packages.length} public plugins from ${SOURCE_REVISION}`);
