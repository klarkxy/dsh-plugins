import { spawnSync } from 'node:child_process'
import { defineConfig, type UserConfig } from 'tsdown'

const wrapClient: NonNullable<UserConfig['plugins']>[number] = {
  name: 'wrap-dsh-client',
  closeBundle() {
    const result = spawnSync(process.execPath, ['../../scripts/editor-plugins/wrap-client.mjs', '@klarkxy/dsh-dot'], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`client wrap exited ${result.status ?? 'unknown'}`)
  },
}

const hostExternal = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-agent-preset-registry',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-user-questions',
  'zod',
]

export default defineConfig([
  {
    // Three host entries: the plugin itself, the preset row that carries dot's
    // tools, and the internal reflection preset's tool row.
    entry: { index: 'src/index.ts', tools: 'src/tools.ts', reflection: 'src/reflection.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'lib',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    hash: false,
    deps: {
      alwaysBundle: ['@klarkxy/dsh-plugin-kit/contracts', '@klarkxy/dsh-plugin-kit/domain', '@klarkxy/dsh-plugin-kit/host-rpc'],
      neverBundle: hostExternal,
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client.tsx' },
    format: ['cjs'],
    dts: false,
    clean: false,
    outDir: 'lib',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    hash: false,
    plugins: [wrapClient],
    deps: {
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
      alwaysBundle: ['@klarkxy/dsh-plugin-kit/official-ui', '@klarkxy/dsh-plugin-kit/model-menu'],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
