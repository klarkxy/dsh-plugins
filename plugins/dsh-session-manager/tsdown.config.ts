import { spawnSync } from 'node:child_process'
import { defineConfig, type UserConfig } from 'tsdown'

const wrapClient: NonNullable<UserConfig['plugins']>[number] = {
  name: 'wrap-dsh-client',
  closeBundle() {
    const result = spawnSync(process.execPath, [
      '../../scripts/editor-plugins/wrap-client.mjs',
      '@klarkxy/dsh-session-manager',
    ], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`client wrap exited ${result.status ?? 'unknown'}`)
  },
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'lib',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    hash: false,
    deps: {
      neverBundle: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/schemastery',
        '@deepseek-ai/dsh-session',
        '@deepseek-ai/dsh-session-query',
        '@deepseek-ai/dsh-tools',
        '@klarkxy/dsh-plugin-kit',
      ],
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
      neverBundle: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
      alwaysBundle: ['@klarkxy/dsh-plugin-kit/official-ui', '@klarkxy/dsh-plugin-kit/client-utils'],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
