import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    include: ['.acceptance/query.spec.ts'],
    pool: 'forks',
    execArgv: vitestExecArgv,
    maxWorkers: 1,
    testTimeout: 20_000,
  },
})
