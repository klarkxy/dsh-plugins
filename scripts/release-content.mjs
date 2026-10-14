import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packRelease } from './release-workspace.mjs';

/** User-facing prose: it ships in the archive, but editing it must not force an npm release. */
const documentationPattern = /(?:^|\/)(?:docs\/|README(?:\.[a-z-]+)?\.md|ACCEPTANCE\.md|NOTICE\.md|CHANGELOG(?:\.[a-z-]+)?\.md)$/i;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function contentHash(files, read, { excludeDocumentation = false } = {}) {
  const hash = createHash('sha256');
  const selected = excludeDocumentation ? files.filter(file => !documentationPattern.test(file.path)) : files;
  for (const file of [...selected].sort((a, b) => a.path.localeCompare(b.path, 'en'))) {
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

/** Review the same selected files, retaining source workspace ranges before CI version substitution.
 * Own version/writeback fields are already normalized by contentHash. Dependencies are reviewed separately.
 * The publication hash and exact archive integrity still include resolved workspace versions.
 */
export function packSnapshot(root, pkg, packages, npm) {
  let sourceHash;
  const result = packRelease(root, pkg, packages, npm, (files, read) => {
    sourceHash = contentHash(files, path => path === 'package.json'
      ? readFileSync(join(root, pkg.directory, path)) : read(path));
    // Publication fingerprint ignores documentation-only edits; the archive hash above
    // still records them, and publish-time tarball integrity keeps checking the full archive.
    return contentHash(files, read, { excludeDocumentation: true });
  });
  return { ...result, sourceHash };
}

export function packWorkspace(root, workspace, packer) {
  const packed = new Map();
  for (const pkg of workspace.reviewPackages) {
    const result = packer(root, pkg, workspace.inventory);
    packed.set(pkg.name, result);
  }
  return packed;
}
