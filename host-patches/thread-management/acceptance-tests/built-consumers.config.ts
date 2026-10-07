import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../vitest.shared.ts'
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    include: ['packages/sdk/server/tests/built-scope-carrier.e2e.ts', 'packages/api/remotes/tests/built-lib.e2e.ts'],
    execArgv: vitestExecArgv, pool: 'forks', maxWorkers: 1, testTimeout: 120000,
  },
})
