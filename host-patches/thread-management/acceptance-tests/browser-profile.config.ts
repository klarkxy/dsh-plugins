import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../vitest.shared.ts'
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    include: ['.acceptance/browser-profile.spec.ts'],
    execArgv: vitestExecArgv, pool: 'forks', maxWorkers: 1, testTimeout: 180000, hookTimeout: 120000,
  },
})
