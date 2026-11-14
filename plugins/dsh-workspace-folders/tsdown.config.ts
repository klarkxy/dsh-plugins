import { defineConfig } from 'tsdown'
export default defineConfig([
  { entry: { index: 'src/index.ts' }, format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node24', sourcemap: true, hash: false,
    deps: { neverBundle: [/^@deepseek-ai\//, /^@klarkxy\/dsh-plugin-kit(\/|$)/, 'zod'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }) },
  { entry: { 'client.inner': 'src/client.tsx' }, format: ['cjs'], dts: false, clean: false, outDir: 'lib', platform: 'browser', target: 'es2022', sourcemap: true, hash: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'], alwaysBundle: ['@klarkxy/dsh-plugin-kit/official-ui', '@klarkxy/dsh-plugin-kit/client-utils', '@klarkxy/dsh-plugin-kit/client-logger', '@klarkxy/dsh-plugin-kit/log-shared'] },
    outExtensions: () => ({ js: '.cjs' }) },
])
