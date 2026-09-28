/** Pack a publishable snapshot without leaking pnpm workspace specifiers. */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
function workspaceDependencies(root, pkg) {
  const manifest = JSON.parse(readFileSync(join(root, pkg.directory, 'package.json'), 'utf8'));
  return dependencyFields.flatMap(field => Object.entries(manifest[field] ?? {})
    .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('workspace:')).map(([name]) => name));
}

export function orderedPackages(root, packages) {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]));
  const visiting = new Set(), complete = new Set(), ordered = [];
  const visit = pkg => {
    if (complete.has(pkg.name)) return;
    if (visiting.has(pkg.name)) throw new Error(`Cyclic workspace release dependency: ${pkg.name}`);
    visiting.add(pkg.name);
    for (const name of workspaceDependencies(root, pkg)) {
      if (!byName.has(name)) throw new Error(`${pkg.name}: workspace dependency ${name} is not a release target`);
      visit(byName.get(name));
    }
    visiting.delete(pkg.name); complete.add(pkg.name); ordered.push(pkg);
  };
  for (const pkg of [...packages].sort((a, b) => a.name.localeCompare(b.name))) visit(pkg);
  return ordered;
}

export function publishManifest(manifest, versions) {
  const result = structuredClone(manifest);
  for (const field of dependencyFields) {
    for (const [name, spec] of Object.entries(result[field] ?? {})) {
      if (!spec.startsWith('workspace:')) continue;
      const version = versions.get(name);
      if (!version) throw new Error(`Missing workspace version: ${name}`);
      const prefix = spec.slice('workspace:'.length);
      if (!['*', '^', '~'].includes(prefix)) throw new Error(`Unsupported workspace range: ${name}@${spec}`);
      result[field][name] = (prefix === '*' ? '' : prefix) + version;
    }
  }
  return result;
}

export function packRelease(root, pkg, packages, npm, fingerprint) {
  const directory = join(root, pkg.directory);
  const [selection] = JSON.parse(npm(['pack', '--dry-run', '--ignore-scripts', '--json'], directory));
  const versions = new Map(packages.map(item => [item.name,
    JSON.parse(readFileSync(join(root, item.directory, 'package.json'), 'utf8')).version]));
  const output = join(root, '.artifacts/npm-release');
  mkdirSync(output, { recursive: true });
  const stage = mkdtempSync(join(output, '.stage-'));
  try {
    for (const file of selection.files) {
      const destination = resolve(stage, file.path);
      if (isAbsolute(file.path) || !destination.startsWith(stage + sep)) throw new Error(`Unsafe npm pack path: ${file.path}`);
      mkdirSync(dirname(destination), { recursive: true });
      if (file.path === 'package.json') {
        const manifest = JSON.parse(readFileSync(join(directory, file.path), 'utf8'));
        writeFileSync(destination, JSON.stringify(publishManifest(manifest, versions), null, 2) + '\n');
      } else {
        copyFileSync(join(directory, file.path), destination);
      }
    }
    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', output], stage));
    const hash = fingerprint(packed.files, path => readFileSync(join(stage, path)));
    return { packed, hash, archive: join(output, packed.filename) };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Imported packages stay unpublished until the old publisher has relinquished ownership. */
export function releaseCandidates(root, packages) {
  const file = join(root, 'scripts/editor-plugin-migration.json');
  if (!existsSync(file)) return packages;
  const migration = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof migration.holdPublish !== 'boolean' || !Array.isArray(migration.packages)) throw new Error('Invalid editor migration release gate');
  if (!migration.holdPublish) return packages;
  const held = new Set(migration.packages.map(pkg => pkg.name));
  return packages.filter(pkg => !held.has(pkg.name));
}

/** Held packages remain version inputs without becoming publication targets. */
export function releaseWorkspace(root, packages) {
  const ordered = orderedPackages(root, packages);
  const candidates = releaseCandidates(root, ordered);
  const targets = new Set(candidates.map(pkg => pkg.name));
  const dependencies = new Set(candidates.flatMap(pkg => workspaceDependencies(root, pkg)));
  return {
    packages: ordered,
    candidates,
    heldDependencies: ordered.filter(pkg => !targets.has(pkg.name) && dependencies.has(pkg.name)),
  };
}
