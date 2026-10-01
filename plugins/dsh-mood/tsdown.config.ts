import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: { index: 'src/index.ts', contracts: 'src/contracts.ts' },
  format: ['esm'], dts: true, clean: true, outDir: 'lib', platform: 'node', target: 'node22', sourcemap: true, hash: false,
  deps: { neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-storage-domain', '@klarkxy/dsh-plugin-kit'] },
  outExtensions: () => ({ dts: '.d.ts', js: '.js' }),
})
