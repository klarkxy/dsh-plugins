import { defineConfig } from 'tsdown'
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
    deps: { neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-settings', '@klarkxy/dsh-model-route', '@klarkxy/dsh-plugin-kit'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client.tsx' }, format: ['cjs'], dts: false, clean: false, outDir: 'lib',
    platform: 'browser', target: 'es2022', sourcemap: true, hash: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'], alwaysBundle: ['@klarkxy/dsh-model-route', '@klarkxy/dsh-model-route/ui', '@klarkxy/dsh-plugin-kit/official-ui'] },
    outExtensions: () => ({ js: '.cjs' }),
  },
])
