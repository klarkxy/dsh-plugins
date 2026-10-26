import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { discoverPackages } from './release-target.mjs';
import { releaseWorkspace } from './release-workspace.mjs';
import { packSnapshot, packWorkspace } from './release-content.mjs';
import { readReleaseStates, releaseStateFile, checkLifecycleHistory } from './release-state.mjs';
import { syncStateDocs } from './release-status.mjs';
export { contentHash } from './release-content.mjs';

const registry = 'https://registry.npmjs.org/';
const planFile = '.artifacts/npm-release/plan.json';

function run(command, args, cwd = process.cwd()) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function npm(args, cwd) {
  // pnpm provides npm_execpath for itself, so resolve npm via PATH on Windows.
  return process.platform === 'win32'
    ? run('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], cwd)
    : run('npm', args, cwd);
}

export async function readRegistry(name, fetcher = fetch, knownVersion) {
  const get = async suffix => {
    const response = await fetcher(`${registry}${encodeURIComponent(name)}${suffix}`, {
      signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`npm registry ${name}: HTTP ${response.status}`);
    return response.json();
  };
  const metadata = await get('') ?? { versions: {}, 'dist-tags': {} };
  if (!metadata.versions || !metadata['dist-tags']) throw new Error(`Invalid registry metadata for ${name}`);
  // During npm scanning, exact-version metadata can appear before the packument.
  // Recognize accepted versions so a retry never blindly republishes them.
  if (knownVersion && !metadata.versions[knownVersion]) {
    const pending = await get(`/${knownVersion}`);
    if (pending) {
      if (pending.name !== name || pending.version !== knownVersion) throw new Error(`Invalid version metadata for ${name}`);
      metadata.versions[knownVersion] = pending;
    }
  }
  return metadata;
}

export function selectRelease(pkg, hash, metadata) {
  const prerelease = semver.prerelease(pkg.version);
  const distTag = prerelease ? 'next' : 'latest';
  const versions = Object.keys(metadata.versions).filter(version => semver.valid(version));
  const channelVersions = versions.filter(version => prerelease || !semver.prerelease(version));
  const highest = channelVersions.sort(semver.rcompare)[0];
  const previous = metadata.versions[highest];
  if (previous?.dshRelease?.contentHash === hash && semver.lte(pkg.version, previous.version)) {
    return { ...pkg, version: previous.version, hash, distTag, publish: false };
  }
  let version = pkg.version;
  if (highest && semver.lte(version, highest)) {
    version = prerelease
      ? semver.inc(highest, semver.prerelease(highest) ? 'prerelease' : 'prepatch', String(prerelease[0]))
      : semver.inc(highest, 'patch');
  }
  while (metadata.versions[version]) {
    version = semver.inc(version, prerelease ? 'prerelease' : 'patch');
  }
  return { ...pkg, version, hash, distTag, publish: true };
}

export function writeVersion(root, release) {
  const changed = [];
  for (const filename of ['package.json', 'dsh.plugin.json']) {
    const relative = `${release.directory}/${filename}`;
    const path = join(root, relative);
    if (!existsSync(path)) continue;
    const before = readFileSync(path, 'utf8');
    const manifest = JSON.parse(before);
    manifest.version = release.version;
    if (filename === 'package.json') manifest.dshRelease = { contentHash: release.hash };
    // Preserve existing formatting except the fields owned by release automation.
    let after = before.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, `$1${release.version}$2`);
    if (filename === 'package.json') {
      const json = JSON.parse(after);
      json.dshRelease = manifest.dshRelease;
      after = JSON.stringify(json, null, 2) + '\n';
    }
    if (after !== before) { writeFileSync(path, after); changed.push(relative); }
  }
  return changed;
}

export async function validateHeldDependencies(dependencies, lookup = readRegistry) {
  for (const dependency of dependencies) {
    const metadata = await lookup(dependency.name, fetch, dependency.version);
    if (!metadata.versions[dependency.version]) {
      throw new Error(`Held workspace dependency is not published: ${dependency.name}@${dependency.version}`);
    }
  }
}

export async function plan(root, firstReleases = [], { lookup = readRegistry, packer = (root, pkg, packages) => packSnapshot(root, pkg, packages, npm) } = {}) {
  const releases = [];
  const changedFiles = [];
  const workspace = releaseWorkspace(root, discoverPackages(root), firstReleases);
  checkLifecycleHistory(root, workspace.states);
  const { inventory, candidates, heldDependencies } = workspace;
  if (!candidates.length) console.log('No eligible published packages or explicit first releases; nothing to publish.');
  await validateHeldDependencies(heldDependencies, lookup);
  for (const pkg of candidates) {
    const { hash } = packer(root, pkg, inventory);
    const release = selectRelease(pkg, hash, await lookup(pkg.name, fetch, pkg.version));
    changedFiles.push(...writeVersion(root, release));
    releases.push(release);
    console.log(`${release.publish ? 'Publish' : 'Unchanged'} ${release.name}@${release.version}`);
  }
  mkdirSync(join(root, '.artifacts/npm-release'), { recursive: true });
  // Capture the final dependency closure after version substitution. This is a
  // per-run freshness check, never a human-maintained lifecycle acceptance token.
  const sourceHashes = Object.fromEntries([...packWorkspace(root, workspace, packer)].map(([name, packed]) => [name, packed.sourceHash]));
  const result = { schemaVersion: 2, firstReleases, releases, changedFiles, sourceHashes };
  writeFileSync(join(root, planFile), JSON.stringify(result, null, 2) + '\n');
  return result;
}

/** No npm submission is permitted until the entire saved plan and dependency closure pass. */
export function preflightReleases(root, plan, packer = (root, pkg, packages) => packSnapshot(root, pkg, packages, npm)) {
  const { releases, firstReleases, sourceHashes } = plan ?? {};
  if (plan?.schemaVersion !== 2 || !Array.isArray(releases) || !Array.isArray(firstReleases) ||
      !sourceHashes || typeof sourceHashes !== 'object' || Array.isArray(sourceHashes)) throw new Error('Invalid or obsolete release plan; create a new plan');
  const workspace = releaseWorkspace(root, discoverPackages(root), firstReleases);
  checkLifecycleHistory(root, workspace.states);
  const allowed = new Map(workspace.candidates.map(pkg => [pkg.name, pkg]));
  const seen = new Set();
  for (const release of releases) {
    const pkg = allowed.get(release?.name);
    if (!pkg || seen.has(pkg.name)) throw new Error('Release plan contains a held, ineligible, duplicate or removed package');
    if (release.directory !== pkg.directory || release.version !== pkg.version) throw new Error(`Release plan no longer matches source: ${pkg.name}`);
    if (typeof release.publish !== 'boolean' || release.distTag !== (semver.prerelease(pkg.version) ? 'next' : 'latest')) throw new Error(`Invalid release channel: ${pkg.name}`);
    seen.add(pkg.name);
  }
  if (releases.length !== workspace.candidates.length || releases.some((release, index) => release.name !== workspace.candidates[index].name)) {
    throw new Error('Incomplete or reordered release plan; regenerate the complete dependency-ordered plan');
  }
  const packed = packWorkspace(root, workspace, packer);
  if (Object.keys(sourceHashes).length !== packed.size) throw new Error('Dependency closure changed after planning');
  for (const [name, result] of packed) {
    if (!/^[a-f0-9]{64}$/.test(sourceHashes[name] ?? '') || sourceHashes[name] !== result.sourceHash) throw new Error(`Package or dependency changed after planning: ${name}`);
  }
  for (const release of releases) {
    if (packed.get(release.name).hash !== release.hash) throw new Error(`Package changed after planning: ${release.name}`);
  }
  return { workspace, packed };
}

export function isAcceptedVersionConflict(error) {
  try {
    const { error: detail } = JSON.parse(error.stdout?.toString() ?? '');
    return detail?.code === 'EPUBLISHCONFLICT' || (detail?.code === 'E403' &&
      /cannot publish over the previously published versions|cannot modify pre-existing version/i.test(`${detail.summary} ${detail.detail}`));
  } catch { return false; }
}

export function recordVerifiedPublication(root, release, publication) {
  const inventory = discoverPackages(root, { includePrivate: true });
  const states = readReleaseStates(root, inventory);
  const entry = states.get(release.name);
  if (!entry || entry.state === 'draft') throw new Error(`${release.name}: cannot skip the testing stage`);
  const artifact = join(root, '.artifacts/npm-release/verified-publications.json');
  const verified = existsSync(artifact) ? JSON.parse(readFileSync(artifact, 'utf8')) : [];
  if (!verified.some(item => item.name === release.name && item.publication.version === publication.version)) {
    verified.push({ name: release.name, publication });
    writeFileSync(artifact, JSON.stringify(verified, null, 2) + '\n');
  }
  if (entry.state === 'published') return;
  entry.state = 'published';
  entry.publication = publication;
  entry.reason = { zh: '已有 npm 发布记录；后续版本按正常更新流程维护。', en: 'Published on npm; subsequent versions follow the normal update workflow.' };
  const changed = JSON.parse(readFileSync(join(root, planFile), 'utf8'));
  changed.changedFiles = [...new Set([...(changed.changedFiles ?? []), releaseStateFile, 'README.md', 'README.zh-CN.md'])];
  writeFileSync(join(root, planFile), JSON.stringify(changed, null, 2) + '\n');
  writeFileSync(join(root, releaseStateFile), JSON.stringify({ schemaVersion: 2, packages: [...states.values()] }, null, 2) + '\n');
  syncStateDocs(root, { inventory, states }, true);
}

export async function publish(root, packer, { lookup = readRegistry, fetcher = fetch,
  submit = archive => npm(archive, root), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 20 * 60_000 } = {}) {
  const savedPlan = JSON.parse(readFileSync(join(root, planFile), 'utf8'));
  const { releases } = savedPlan;
  const pending = [];
  const failures = [];
  const { workspace, packed: prepared } = preflightReleases(root, savedPlan, packer);
  await validateHeldDependencies(workspace.heldDependencies, lookup);
  // Submit every changed package before waiting for npm's publish-time scanning.
  for (const release of releases) {
    try {
      const { packed } = prepared.get(release.name);
      const archive = join(root, '.artifacts/npm-release', packed.filename);
      const before = await lookup(release.name, fetcher, release.version);
      const existing = before.versions[release.version];
      if (existing) {
        if (existing.dist?.integrity !== packed.integrity) {
          throw new Error(`Already published with different contents: ${release.name}@${release.version}`);
        }
        console.log(`Already accepted: ${release.name}@${release.version}`);
      } else if (release.publish) {
        try {
          console.log(await submit(['publish', archive, '--json', '--ignore-scripts', '--access', 'public', '--provenance', '--tag', release.distTag, '--registry', registry]));
        } catch (error) {
          // Scanning can hide even exact-version metadata. A duplicate-version
          // rejection only enters verification; auth and other failures still fail.
          if (!isAcceptedVersionConflict(error)) throw error;
          console.log(`Version already accepted; waiting to verify ${release.name}@${release.version}`);
        }
      } else {
        throw new Error(`Previously published version is unavailable: ${release.name}@${release.version}`);
      }
      pending.push({ release, integrity: packed.integrity });
      } catch (error) {
        failures.push(error);
        break; // Still verify and retain earlier submissions before reporting failure.
      }
    }
    // npm documents a typical 5-minute scan, sometimes 15+ minutes. Verify actual
    // anonymous tarball availability, not just acceptance of the publish request.
    const deadline = Date.now() + timeoutMs;
    while (pending.length) {
      for (let index = pending.length - 1; index >= 0; index--) {
        const { release, integrity } = pending[index];
        try {
          const metadata = await lookup(release.name, fetcher, release.version);
          const remote = metadata.versions[release.version];
          if (!remote?.dist?.tarball || !remote.dist.integrity) continue;
          if (remote.dist?.integrity !== integrity) throw new Error(`Registry integrity mismatch: ${release.name}@${release.version}`);
        // Exact-version metadata can precede the packument's publication time.
        // Keep the package pending until both can support a historical record.
        const publishedAt = metadata.time?.[release.version];
        if (!Number.isFinite(Date.parse(publishedAt))) continue;
          const archive = await fetcher(remote.dist.tarball, { signal: AbortSignal.timeout(30_000) });
          if (archive.status === 404) continue;
          if (!archive.ok) throw new Error(`Archive download failed: HTTP ${archive.status}`);
          const actual = 'sha512-' + createHash('sha512').update(Buffer.from(await archive.arrayBuffer())).digest('base64');
          if (actual !== integrity) throw new Error(`Downloaded archive mismatch: ${release.name}@${release.version}`);
          recordVerifiedPublication(root, release, { version: release.version, publishedAt, integrity });
          const line = `Verified ${release.name}@${release.version} (${release.distTag}); anonymous archive integrity matched.\n`;
          console.log(line);
          if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line);
          pending.splice(index, 1);
          } catch (error) {
            failures.push(error);
            pending.splice(index, 1);
          }
        }
        if (!pending.length) break;
        if (Date.now() >= deadline) {
          failures.push(new Error(`npm scanning/availability still pending: ${pending.map(item => item.release.name).join(', ')}; retry the explicit first-release selection after availability is restored`));
          break;
        }
        console.log(`Waiting for npm scanning/availability: ${pending.map(item => item.release.name).join(', ')}`);
        await wait(20_000);
      }
      if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
    }

    function commit(root) {
      const { changedFiles } = JSON.parse(readFileSync(join(root, planFile), 'utf8'));
      if (!changedFiles.length) return;
      run('git', ['add', '--', ...changedFiles, 'index.json'], root);
      run('git', ['commit', '-m', 'chore: record npm releases and plugin market index'], root);
      // Normal fast-forward push: a concurrent human change fails safely, never force-push.
      run('git', ['push', 'origin', 'HEAD:main'], root);
    }

    if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
      try {
        const root = process.cwd();
        if (process.argv[2] === 'plan') {
          const args = process.argv.slice(3);
          if (args.length && (args.shift() !== '--first-release' || !args.length)) throw new Error('Usage: plan [--first-release @klarkxy/dsh-name ...]');
          await plan(root, args);
        }
        else if (process.argv.length !== 3) throw new Error('Usage: node scripts/publish-npm.mjs plan [--first-release NAME ...]|commit|publish');
        else if (process.argv[2] === 'commit') commit(root);
        else if (process.argv[2] === 'publish') await publish(root);
        else throw new Error('Expected plan, commit, or publish');
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
