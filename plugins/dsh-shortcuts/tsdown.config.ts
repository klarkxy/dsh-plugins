import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/index.ts', contracts: 'src/contracts.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    outDir: 'lib',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    hash: false,
    deps: { neverBundle: ['@deepseek-ai/cordis', '@klarkxy/dsh-plugin-kit'] },
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
    deps: {
      neverBundle: [
        '@deepseek-ai/cordis',
        'react',
        'react/jsx-runtime',
        'react-dom',
        '@deepseek-ai/dsh-client-shortcuts',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-ui-slots',
        '@deepseek-ai/dsh-client-ui-primitives',
      ],
      alwaysBundle: [
        '@klarkxy/dsh-plugin-kit/client-utils',
        '@klarkxy/dsh-plugin-kit/official-ui',
        '@klarkxy/dsh-plugin-kit/contracts',
      ],
    },
    outExtensions: () => ({ dts: '.d.ts', js: '.cjs' }),
  },
])
