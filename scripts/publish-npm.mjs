import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { discoverPackages } from './release-target.mjs';

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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function contentHash(files, read) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'))) {
    let content = read(file.path);
    if (file.path === 'package.json' || file.path === 'dsh.plugin.json') {
      const manifest = JSON.parse(content.toString());
      delete manifest.version;
      delete manifest.dshRelease;
      content = Buffer.from(JSON.stringify(canonical(manifest)));
    }
    hash.update(JSON.stringify([file.path, file.mode, content.length]));
    hash.update(content);
  }
  return hash.digest('hex');
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

async function plan(root) {
  const releases = [];
  const changedFiles = [];
  for (const pkg of discoverPackages(root)) {
    const directory = join(root, pkg.directory);
    const [packed] = JSON.parse(npm(['pack', '--dry-run', '--ignore-scripts', '--json'], directory));
    const hash = contentHash(packed.files, path => readFileSync(join(directory, path)));
    const release = selectRelease(pkg, hash, await readRegistry(pkg.name, fetch, pkg.version));
    changedFiles.push(...writeVersion(root, release));
    releases.push(release);
    console.log(`${release.publish ? 'Publish' : 'Unchanged'} ${release.name}@${release.version}`);
  }
  mkdirSync(join(root, '.artifacts/npm-release'), { recursive: true });
  writeFileSync(join(root, planFile), JSON.stringify({ releases, changedFiles }, null, 2) + '\n');
}

async function publish(root) {
  const { releases } = JSON.parse(readFileSync(join(root, planFile), 'utf8'));
  const pending = [];
  // Submit every changed package before waiting for npm's publish-time scanning.
  for (const release of releases) {
    const directory = join(root, release.directory);
    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', join(root, '.artifacts/npm-release')], directory));
    const currentHash = contentHash(packed.files, path => readFileSync(join(directory, path)));
    if (currentHash !== release.hash) throw new Error(`Package changed after planning: ${release.name}`);
    const archive = join(root, '.artifacts/npm-release', packed.filename);
    const before = await readRegistry(release.name, fetch, release.version);
    const existing = before.versions[release.version];
    if (existing) {
      if (existing.dist?.integrity !== packed.integrity) {
        throw new Error(`Already published with different contents: ${release.name}@${release.version}`);
      }
      console.log(`Already accepted: ${release.name}@${release.version}`);
    } else if (release.publish) {
      console.log(npm(['publish', archive, '--ignore-scripts', '--access', 'public', '--provenance', '--tag', release.distTag, '--registry', registry], root));
    } else {
      throw new Error(`Previously published version is unavailable: ${release.name}@${release.version}`);
    }
    pending.push({ release, integrity: packed.integrity });
  }
  // npm documents a typical 5-minute scan, sometimes 15+ minutes. Verify actual
  // anonymous tarball availability, not just acceptance of the publish request.
  const deadline = Date.now() + 20 * 60_000;
  while (pending.length) {
    for (let index = pending.length - 1; index >= 0; index--) {
      const { release, integrity } = pending[index];
      const remote = (await readRegistry(release.name)).versions[release.version];
      if (!remote) continue;
      if (remote.dist?.integrity !== integrity) throw new Error(`Registry integrity mismatch: ${release.name}@${release.version}`);
      const archive = await fetch(remote.dist.tarball, { signal: AbortSignal.timeout(30_000) });
      if (archive.status === 404) continue;
      if (!archive.ok) throw new Error(`Archive download failed: HTTP ${archive.status}`);
      const actual = 'sha512-' + createHash('sha512').update(Buffer.from(await archive.arrayBuffer())).digest('base64');
      if (actual !== integrity) throw new Error(`Downloaded archive mismatch: ${release.name}@${release.version}`);
      const line = `Verified ${release.name}@${release.version} (${release.distTag}); anonymous archive integrity matched.\n`;
      console.log(line);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line);
      pending.splice(index, 1);
    }
    if (!pending.length) break;
    if (Date.now() >= deadline) throw new Error(`npm scanning/availability still pending: ${pending.map(item => item.release.name).join(', ')}; retry from latest main after npm makes the packages available`);
    console.log(`Waiting for npm scanning/availability: ${pending.map(item => item.release.name).join(', ')}`);
    await new Promise(resolve => setTimeout(resolve, 20_000));
  }
}

function commit(root) {
  const { changedFiles } = JSON.parse(readFileSync(join(root, planFile), 'utf8'));
  if (!changedFiles.length) return;
  run('git', ['add', '--', ...changedFiles], root);
  run('git', ['commit', '-m', 'chore: record npm package versions and content fingerprints'], root);
  // Normal fast-forward push: a concurrent human change fails safely, never force-push.
  run('git', ['push', 'origin', 'HEAD:main'], root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = process.cwd();
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/publish-npm.mjs plan|commit|publish');
    if (process.argv[2] === 'plan') await plan(root);
    else if (process.argv[2] === 'commit') commit(root);
    else if (process.argv[2] === 'publish') await publish(root);
    else throw new Error('Expected plan, commit, or publish');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
