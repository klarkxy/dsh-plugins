import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { discoverPackages } from './release-target.mjs';
import { renderStateTable, stateLabels, checkLifecycleHistory } from './release-state.mjs';
import { releaseWorkspace } from './release-workspace.mjs';
import { packSnapshot } from './release-content.mjs';

export function syncStateDocs(root, workspace, write = false) {
  for (const language of ['zh', 'en']) {
    const filename = language === 'zh' ? 'README.zh-CN.md' : 'README.md';
    const path = join(root, filename);
    const before = readFileSync(path, 'utf8');
    const marker = /<!-- plugin-release-states:start -->[\s\S]*?<!-- plugin-release-states:end -->/g;
    if ([...before.matchAll(marker)].length !== 1) throw new Error(`${filename}: expected one release states table`);
    const table = `<!-- plugin-release-states:start -->\n${renderStateTable(workspace.inventory, workspace.states, language)}\n<!-- plugin-release-states:end -->`;
    const after = before.replace(marker, () => table);
    if (write) { if (after !== before) writeFileSync(path, after); }
    else if (after !== before) throw new Error(`${filename}: release states are outdated; run pnpm release:docs`);
  }
}

function npm(args, cwd) {
  return execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args,
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

export function main(root, args) {
  const workspace = releaseWorkspace(root, discoverPackages(root));
  if (args.length === 1 && args[0] === '--write-docs') return syncStateDocs(root, workspace, true);
  if (args.length === 1 && args[0] === '--check-docs') {
    checkLifecycleHistory(root, workspace.states);
    return syncStateDocs(root, workspace);
  }
  if (args.length === 2 && args[0] === '--fingerprint') {
    const pkg = workspace.inventory.find(pkg => pkg.name === args[1]);
    if (!pkg) throw new Error(`Unknown package: ${args[1]}`);
    const result = packSnapshot(root, pkg, workspace.inventory, npm);
    console.log(JSON.stringify({ name: pkg.name, sourceHash: result.sourceHash, archive: result.archive }, null, 2));
    return;
  }
  if (args.length) throw new Error('Usage: release-status.mjs [--write-docs|--check-docs|--fingerprint @klarkxy/dsh-xxx]');
  const candidates = new Set(workspace.candidates.map(pkg => pkg.name));
  for (const pkg of workspace.inventory) {
    const state = workspace.states.get(pkg.name);
    const blockers = workspace.blockers.get(pkg.name).filter(name => name !== pkg.name);
    const eligibility = pkg.private ? 'private; no npm publication'
      : candidates.has(pkg.name) ? 'eligible for normal version updates; release checks still apply'
      : blockers.length ? `blocked by unpublished dependencies: ${blockers.join(', ')}`
      : state.state !== 'published' ? 'no automatic publication; first release must be explicitly selected' : 'held by release gate';
    console.log(`${pkg.name}: ${stateLabels.zh[state.state]} (${state.state}); ${eligibility}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.cwd(), process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
