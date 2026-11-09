import { spawnSync } from 'node:child_process'
import { defineConfig, type UserConfig } from 'tsdown'
import { lowerNativeRemoteDecorators } from '../../scripts/editor-plugins/native-remote-decorators.mjs'

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
    // Host half bundles the kit internals it uses: profile-linked entries are
    // the only modules the official loader evicts and re-imports on reload, so
    // fixes must land inside lib/index.js instead of an external kit copy.
    plugins: [lowerNativeRemoteDecorators()],
    deps: {
      alwaysBundle: [
        '@klarkxy/dsh-plugin-kit/host-rpc',
        '@klarkxy/dsh-plugin-kit/llm-call',
        '@klarkxy/dsh-plugin-kit/auxiliary-model',
        '@klarkxy/dsh-plugin-kit/model-settings-changes',
        '@klarkxy/dsh-plugin-kit/contracts',
        '@klarkxy/dsh-plugin-kit/domain',
        '@klarkxy/dsh-plugin-kit/model-settings',
        '@klarkxy/dsh-model-route',
      ],
      neverBundle: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-typert-protocol',
        '@deepseek-ai/schemastery',
        '@deepseek-ai/dsh-session',
        '@deepseek-ai/dsh-session-query',
        '@deepseek-ai/dsh-tools',
        '@deepseek-ai/dsh-llm',
        '@deepseek-ai/dsh-storage-domain',
        'zod',
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
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
      alwaysBundle: [
        '@klarkxy/dsh-plugin-kit/official-ui',
        '@klarkxy/dsh-plugin-kit/client-utils',
        '@klarkxy/dsh-plugin-kit/auxiliary-model-client',
        '@klarkxy/dsh-plugin-kit/model-settings-client',
        '@klarkxy/dsh-plugin-kit/contracts',
        '@klarkxy/dsh-plugin-kit/model-picker',
        '@klarkxy/dsh-model-route',
        '@klarkxy/dsh-model-route/ui',
        '@klarkxy/dsh-model-route/model-picker',
      ],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
