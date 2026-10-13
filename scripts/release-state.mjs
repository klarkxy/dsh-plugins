import { readFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import semver from 'semver';
import { join, resolve, sep } from 'node:path';
import { discoverPackages } from './release-target.mjs';

export const releaseStateFile = 'scripts/plugin-release-states.json';
export const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
export const stateLabels = {
  zh: { draft: '草稿', testing: '测试中', published: '已发布' },
  en: { draft: 'Draft', testing: 'Testing', published: 'Published' },
};
const evidenceKinds = ['packedContent', 'tests', 'targetHost'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

/** Lifecycle is historical; acceptance of a new version is checked by the release run. */
export function readReleaseStates(root, packages = discoverPackages(root, { includePrivate: true })) {
  const data = JSON.parse(readFileSync(join(root, releaseStateFile), 'utf8'));
  if (data.schemaVersion !== 2 || !Array.isArray(data.packages)) throw new Error('Invalid plugin release states: expected schemaVersion 2 and packages');
  const known = new Set(packages.map(pkg => pkg.name));
  const states = new Map();
  for (const entry of data.packages) {
    if (!entry || !/^@klarkxy\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name ?? '') || states.has(entry.name)) {
      throw new Error(`Invalid plugin release state: unknown or duplicate package ${entry?.name}`);
    }
    if (entry.retired !== undefined && typeof entry.retired !== 'boolean') throw new Error(`${entry.name}: retired must be a boolean`);
    // Retirement removes workspace membership, never historical lifecycle proof.
    if (entry.retired ? known.has(entry.name) : !known.has(entry.name)) {
      throw new Error(`${entry.name}: retired entries must have no source package; active entries require one`);
    }
    if (!Object.hasOwn(stateLabels.en, entry.state) || !nonempty(entry.reason?.zh) || !nonempty(entry.reason?.en)) {
      throw new Error(`${entry.name}: expected draft/testing/published and reasons in zh/en`);
    }
    if (entry.acceptedContentHash !== undefined) throw new Error(`${entry.name}: acceptedContentHash is not a lifecycle field`);
    if (entry.state === 'published') {
      const proof = entry.publication;
      if (!proof || semver.valid(proof.version) !== proof.version || !Number.isFinite(Date.parse(proof.publishedAt)) ||
          !/^sha512-[A-Za-z0-9+/]{86}==$/.test(proof.integrity ?? '')) {
        throw new Error(`${entry.name}: published requires a verified npm publication (version, publishedAt, integrity)`);
      }
    } else if (entry.publication !== undefined) {
      throw new Error(`${entry.name}: a publication record cannot be demoted to ${entry.state}`);
    }
    if (entry.evidence !== undefined && (!entry.evidence || typeof entry.evidence !== 'object' || Array.isArray(entry.evidence))) {
      throw new Error(`${entry.name}: invalid evidence`);
    }
    for (const kind of evidenceKinds) {
      const reference = entry.evidence?.[kind];
      if (reference === undefined) continue;
      // Evidence is committed repository text, never an external URL or a machine-local path.
      if (!nonempty(reference) || reference.includes('\\') || !/^[\w./-]+$/.test(reference) || reference.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error(`${entry.name}: ${kind} evidence must be a repository-relative file`);
      }
      const path = resolve(root, reference);
      if (!path.startsWith(resolve(root) + sep)) throw new Error(`${entry.name}: evidence escapes repository`);
      try { if (!statSync(path).isFile()) throw new Error('not a file'); }
      catch { throw new Error(`${entry.name}: missing ${kind} evidence file ${reference}`); }
    }
    if (Object.keys(entry.evidence ?? {}).some(kind => !evidenceKinds.includes(kind))) throw new Error(`${entry.name}: unknown evidence kind`);
    states.set(entry.name, entry);
  }
  for (const name of known) if (!states.has(name)) throw new Error(`Missing plugin release state: ${name}; add draft or testing before development`);
  return states;
}

export function validateLifecycleTransition(previous, current) {
  // schema 1 described source readiness, so it is not a lifecycle baseline.
  if (previous.schemaVersion === 1) return;
  if (previous.schemaVersion !== 2 || !Array.isArray(previous.packages)) throw new Error('Invalid lifecycle baseline');
  const rank = { draft: 0, testing: 1, published: 2 };
  for (const before of previous.packages) {
    if (!Object.hasOwn(rank, before.state)) throw new Error('Invalid lifecycle baseline stage');
    const after = current.get(before.name);
    if (!after || rank[after.state] < rank[before.state]) throw new Error(`${before.name}: lifecycle cannot go backwards or lose an existing package`);
    if (before.state === 'draft' && after.state === 'published') throw new Error(`${before.name}: first complete the testing stage`);
    if (before.state === 'published' && ['version', 'publishedAt', 'integrity'].some(key => before.publication?.[key] !== after.publication?.[key])) {
      throw new Error(`${before.name}: preserve the historical publication record`);
    }
  }
}

export function checkLifecycleHistory(root, states, base = process.env.RELEASE_STATE_BASE || 'HEAD') {
  if (!existsSync(join(root, '.git'))) return;
  if (/^0+$/.test(base)) return; // First push has no previous commit.
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['rev-parse', '--verify', `${base}^{commit}`]);
  if (!git(['ls-tree', '--name-only', base, '--', releaseStateFile]).trim()) return;
  validateLifecycleTransition(JSON.parse(git(['show', `${base}:${releaseStateFile}`])), states);
}

export function localDependencyGraph(root, packages) {
  const known = new Set(packages.map(pkg => pkg.name));
  return new Map(packages.map(pkg => {
    const manifest = JSON.parse(readFileSync(join(root, pkg.directory, 'package.json'), 'utf8'));
    const names = dependencyFields.flatMap(field => Object.keys(manifest[field] ?? {})).filter(name => known.has(name));
    return [pkg.name, [...new Set(names)]];
  }));
}

export function dependencyClosure(graph, names) {
  const visited = new Set();
  const visit = name => {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency);
  };
  for (const name of names) visit(name);
  return visited;
}

export function releaseEligibility(root, firstReleases = []) {
  const inventory = discoverPackages(root, { includePrivate: true });
  const states = readReleaseStates(root, inventory);
  const graph = localDependencyGraph(root, inventory);
  const first = new Set(firstReleases);
  if (first.size !== firstReleases.length) throw new Error('Duplicate first-release selection');
  for (const name of first) {
    const pkg = inventory.find(pkg => pkg.name === name);
    if (!pkg || pkg.private || !['testing', 'published'].includes(states.get(name).state)) {
      throw new Error(`${name}: first release requires a public testing package`);
    }
  }
  const byName = new Map(inventory.map(pkg => [pkg.name, pkg]));
  const blockers = new Map(inventory.map(pkg => [pkg.name,
    [...dependencyClosure(graph, [pkg.name])].filter(name => states.get(name).state !== 'published' &&
      !(states.get(name).state === 'testing' && (first.has(name) || (name !== pkg.name && byName.get(name).private)))) ]));
  return { inventory, states, graph, blockers };
}

export function renderStateTable(packages, states, language) {
  const lines = language === 'zh'
    ? ['| 包 | 生命周期 | 说明 |', '| --- | --- | --- |']
    : ['| Package | Lifecycle | Notes |', '| --- | --- | --- |'];
  const escape = value => value.replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ');
  for (const pkg of [...packages].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const entry = states.get(pkg.name);
    lines.push(`| [${pkg.name}](${pkg.directory}/README.md) | ${stateLabels[language][entry.state]} (\`${entry.state}\`)${pkg.private ? (language === 'zh' ? '；私有包' : '; private') : ''} | ${escape(entry.reason[language])} |`);
  }
  return lines.join('\n');
}
