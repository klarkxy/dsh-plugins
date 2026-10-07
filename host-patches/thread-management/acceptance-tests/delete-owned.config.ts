import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../vitest.shared.ts'
export default defineConfig({ plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()], test: { include: ['.acceptance/delete-owned.spec.ts'], execArgv: vitestExecArgv, pool: 'forks', maxWorkers: 1, testTimeout: 60000 } })
