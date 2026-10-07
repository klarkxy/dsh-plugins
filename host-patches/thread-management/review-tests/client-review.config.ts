import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../vitest.shared.ts'
export default defineConfig({ plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()], test: { include: ['.review/integrated_host_review/observer.client.spec.ts', '.review/integrated_host_review/retained-free-fork.client.spec.ts'], environment: 'jsdom', setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-invariants.ts', './scripts/test-dom-environment.ts'], execArgv: vitestExecArgv, pool: 'forks', maxWorkers: 1, testTimeout: 60000 } })
