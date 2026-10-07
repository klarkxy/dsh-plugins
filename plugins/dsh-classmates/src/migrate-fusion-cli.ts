import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { FusionMigrateError, migrateFusionCli } from './fusion-migrate.js';

migrateFusionCli(process.argv.slice(2), { readFile, writeFile, mkdir }).then(result => {
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}, error => {
  const message = error instanceof FusionMigrateError
    ? `${error.code}: ${error.message}`
    : error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
