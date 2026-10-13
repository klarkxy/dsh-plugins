import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = new URL('../', import.meta.url);

try {
  require.resolve('@klarkxy/dsh-plugin-kit/contracts');
} catch (error) {
  // Only defer a clean monorepo install. Missing/broken published dependencies
  // must fail Git installs, not silently produce a package without lib/.
  const workspaceKit = new URL('../../dsh-plugin-kit/package.json', import.meta.url);
  const workspaceFile = new URL('../../../pnpm-workspace.yaml', import.meta.url);
  if (
    error.code !== 'MODULE_NOT_FOUND' ||
    !existsSync(workspaceFile) ||
    !existsSync(workspaceKit) ||
    realpathSync(require.resolve('@klarkxy/dsh-plugin-kit/package.json')) !== realpathSync(workspaceKit)
  ) {
    throw error;
  }
  console.log('prepare: deferred until workspace plugin-kit is built; prepack still requires a build');
  process.exit(0);
}

// npm and pnpm supply their JS entry point to lifecycle scripts. Launch it
// through Node so paths with spaces and Windows .cmd wrappers need no shell.
if (!process.env.npm_execpath) {
  throw new Error('prepare must run through a package manager (npm_execpath is missing)');
}
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  cwd: fileURLToPath(packageRoot),
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`prepare build terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;
