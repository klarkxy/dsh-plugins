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

export async function readRegistry(name, fetcher = fetch) {
  const response = await fetcher(`${registry}${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return { versions: {}, 'dist-tags': {} };
  if (!response.ok) throw new Error(`npm registry ${name}: HTTP ${response.status}`);
  const metadata = await response.json();
  if (!metadata.versions || !metadata['dist-tags']) throw new Error(`Invalid registry metadata for ${name}`);
  return metadata;
}

export function selectRelease(pkg, hash, metadata) {
  const prerelease = semver.prerelease(pkg.version);
  const distTag = prerelease ? 'next' : 'latest';
  const versions = Object.keys(metadata.versions).filter(version => semver.valid(version));
  const channelVersions = versions.filter(version => prerelease || !semver.prerelease(version));
  const highest = channelVersions.sort(semver.rcompare)[0];
  const tagged = metadata.versions[metadata['dist-tags'][distTag]];
  const previous = tagged ?? metadata.versions[highest];
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
    const release = selectRelease(pkg, hash, await readRegistry(pkg.name));
    changedFiles.push(...writeVersion(root, release));
    releases.push(release);
    console.log(`${release.publish ? 'Publish' : 'Unchanged'} ${release.name}@${release.version}`);
  }
  mkdirSync(join(root, '.artifacts/npm-release'), { recursive: true });
  writeFileSync(join(root, planFile), JSON.stringify({ releases, changedFiles }, null, 2) + '\n');
}

async function publish(root) {
  const { releases } = JSON.parse(readFileSync(join(root, planFile), 'utf8'));
  for (const release of releases.filter(item => item.publish)) {
    const directory = join(root, release.directory);
    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', join(root, '.artifacts/npm-release')], directory));
    const currentHash = contentHash(packed.files, path => readFileSync(join(directory, path)));
    if (currentHash !== release.hash) throw new Error(`Package changed after planning: ${release.name}`);
    const archive = join(root, '.artifacts/npm-release', packed.filename);
    const before = await readRegistry(release.name);
    if (before.versions[release.version]) {
      if (before.versions[release.version].dist?.integrity !== packed.integrity) {
        throw new Error(`Already published with different contents: ${release.name}@${release.version}`);
      }
      console.log(`Already published: ${release.name}@${release.version}`);
    } else {
      npm(['publish', archive, '--ignore-scripts', '--access', 'public', '--provenance', '--tag', release.distTag, '--registry', registry], root);
    }
    // Verify the anonymous registry serves exactly the archive we sent.
    let verified = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const remote = (await readRegistry(release.name)).versions[release.version];
      if (remote?.dist?.integrity === packed.integrity) { verified = true; break; }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (!verified) throw new Error(`Registry archive verification failed: ${release.name}@${release.version}`);
    const line = `Published ${release.name}@${release.version} (${release.distTag}); archive integrity verified.\n`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line);
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
