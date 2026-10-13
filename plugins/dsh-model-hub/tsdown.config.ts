import { defineConfig } from 'tsdown'
import { transform } from 'esbuild'
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    // Oxc currently preserves standard decorators; native Typert uses their
    // initializer semantics, so lower them with the existing esbuild toolchain.
    plugins: [{ name: 'native-remote-decorators', transform: {
      order: 'pre',
      async handler(code, id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/changes.ts')) return null
        const result = await transform(code, { loader: 'ts', target: 'node22', format: 'esm', sourcefile: id, sourcemap: 'inline' })
        return { code: result.code, map: null }
      },
    } }],
    format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
    deps: { neverBundle: ['@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-settings', '@klarkxy/dsh-model-route', '@klarkxy/dsh-plugin-kit'] },
    outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
  },
  {
    entry: { 'client.inner': 'src/client.tsx' }, format: ['cjs'], dts: false, clean: false, outDir: 'lib',
    platform: 'browser', target: 'es2022', sourcemap: true, hash: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'], alwaysBundle: ['@klarkxy/dsh-plugin-kit/model-settings-client', '@klarkxy/dsh-model-route', '@klarkxy/dsh-model-route/ui', '@klarkxy/dsh-plugin-kit/official-ui'] },
    outExtensions: () => ({ js: '.cjs' }),
  },
])
