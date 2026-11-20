import { defineConfig } from 'tsdown'
import { lowerNativeRemoteDecorators } from '../../scripts/editor-plugins/native-remote-decorators.mjs'
export default defineConfig([
  {
    entry: { index: 'src/index.ts', contracts: 'src/contracts.ts' },
    format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
    // The host half bundles the kit internals it uses: profile-linked entries
    // are the only modules the official loader evicts and re-imports on
    // reload, so shared-host fixes must land inside lib/index.js.
    plugins: [lowerNativeRemoteDecorators()],
    deps: {
      alwaysBundle: [
        '@klarkxy/dsh-plugin-kit',
        '@klarkxy/dsh-plugin-kit/host-rpc',
        '@klarkxy/dsh-plugin-kit/contracts',
        '@klarkxy/dsh-plugin-kit/logger',
        '@klarkxy/dsh-plugin-kit/log-shared',
        '@klarkxy/dsh-model-route',
      ],
      neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-storage-domain', 'zod'],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client.tsx' }, format: ['cjs'], dts: false, clean: false, outDir: 'lib',
    platform: 'browser', target: 'es2022', sourcemap: true, hash: false,
    deps: {
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
      alwaysBundle: [
        '@klarkxy/dsh-plugin-kit/model-menu', '@klarkxy/dsh-plugin-kit/model-picker',
        '@klarkxy/dsh-plugin-kit/contracts', '@klarkxy/dsh-plugin-kit/client-utils',
        '@klarkxy/dsh-plugin-kit/client-logger', '@klarkxy/dsh-plugin-kit/log-shared',
        '@klarkxy/dsh-plugin-kit/official-ui',
        '@klarkxy/dsh-model-route', '@klarkxy/dsh-model-route/ui', '@klarkxy/dsh-model-route/model-picker',
      ],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
