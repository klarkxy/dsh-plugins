import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/migrate-fusion.js');
if (!existsSync(dist)) {
  process.stderr.write('Missing dist/migrate-fusion.js. From this package directory run: npm run build\n');
  process.exit(1);
}
await import(pathToFileURL(dist).href);
