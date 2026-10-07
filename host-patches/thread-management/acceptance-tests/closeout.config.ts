import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../vitest.shared.ts'
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    include: [
      '.acceptance/ownership-collision.spec.ts', '.acceptance/free-blank.spec.ts',
      '.acceptance/recovery.spec.ts', '.acceptance/delete-owned.spec.ts',
      '.acceptance/compaction-search.spec.ts',
    ],
    execArgv: vitestExecArgv, pool: 'forks', maxWorkers: 1, testTimeout: 60000,
  },
})
