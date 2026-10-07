import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    zod: 'src/zod.ts',
    schemastery: 'src/schemastery.ts',
    ui: 'src/ui.tsx',
  },
  format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'neutral', target: 'es2022', sourcemap: true, hash: false,
  deps: { neverBundle: ['zod', '@deepseek-ai/schemastery', 'react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] },
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
