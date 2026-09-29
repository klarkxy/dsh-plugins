import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: { 'client.inner': 'src/client.jsx' }, format: ['cjs'], dts: false, clean: false, outDir: 'lib',
  platform: 'browser', target: 'es2022', sourcemap: false, hash: false,
  deps: { neverBundle: ['react', 'react/jsx-runtime'] },
  outExtensions: () => ({ js: '.cjs' }),
})
