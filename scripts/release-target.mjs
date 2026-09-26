import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';

export function discoverPackages(root) {
  const packages = readdirSync(join(root, 'plugins'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const directory = `plugins/${entry.name}`;
      const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'));
      if (!/^dsh-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name) || /\s/.test(entry.name) ||
          manifest.name !== `@klarkxy/${entry.name}`) {
        throw new Error(`${directory}: package name must be @klarkxy/${entry.name} (dsh-xxx)`);
      }
      if (manifest.private || semver.valid(manifest.version) !== manifest.version || manifest.version.includes('+')) {
        throw new Error(`${directory}: expected a public package with a release version`);
      }
      if (manifest.publishConfig?.access !== 'public' ||
          manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') {
        throw new Error(`${directory}: publishConfig must select public access and the npm registry`);
      }
      return { slug: entry.name, directory, name: manifest.name, version: manifest.version };
    });
  if (!packages.length) throw new Error('No plugins found');
  return packages;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(discoverPackages(process.cwd()).map(pkg => `${pkg.name}@${pkg.version}`).join('\n'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
