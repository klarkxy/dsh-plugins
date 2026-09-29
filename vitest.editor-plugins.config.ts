import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({
  plugins: [{ name: 'css-as-text', enforce: 'pre', load(id) {
    const file = id.split('?')[0]; if (!file.endsWith('.css')) return null;
    return 'export default ' + JSON.stringify(readFileSync(file, 'utf8'));
  }, transform(_code, id) {
    const file = id.split('?')[0]; if (!file.endsWith('.css')) return null;
    return 'export default ' + JSON.stringify(readFileSync(file, 'utf8'));
  } }],
  resolve: { alias: {
      "@klarkxy/dsh-self-improvement/contracts": root + "plugins/dsh-self-improvement/src/contracts.ts",
      "@klarkxy/dsh-plugin-kit/contracts": root + "plugins/dsh-plugin-kit/src/contracts.ts",
      "@klarkxy/dsh-plugin-kit/host-rpc": root + "plugins/dsh-plugin-kit/src/host-rpc.ts",
      "@klarkxy/dsh-plugin-kit/client-utils": root + "plugins/dsh-plugin-kit/src/client-utils.ts",
      "@klarkxy/dsh-plugin-kit/model-menu": root + "plugins/dsh-plugin-kit/src/model-menu.ts",
      "@klarkxy/dsh-plugin-kit/llm-call": root + "plugins/dsh-plugin-kit/src/llm-call.ts",
      "@klarkxy/dsh-plugin-kit": root + "plugins/dsh-plugin-kit/src/index.ts",
      "@klarkxy/dsh-current-title/contracts": root + "plugins/dsh-current-title/src/contracts.ts",
      "@klarkxy/dsh-fusion/host-contracts": root + "plugins/dsh-fusion/src/host-contracts.ts",
      "@klarkxy/dsh-memory/contracts": root + "plugins/dsh-memory/src/contracts.ts",
      "@klarkxy/dsh-self-improvement": root + "plugins/dsh-self-improvement/src/index.ts",
      "@klarkxy/dsh-fusion/contracts": root + "plugins/dsh-fusion/src/contracts.ts",
      "@klarkxy/dsh-recap/contracts": root + "plugins/dsh-recap/src/contracts.ts",
      "@klarkxy/dsh-mood/contracts": root + "plugins/dsh-mood/src/contracts.ts",
      "@klarkxy/dsh-current-title": root + "plugins/dsh-current-title/src/index.ts",
      "@klarkxy/dsh-memory": root + "plugins/dsh-memory/src/index.ts",
      "@klarkxy/dsh-fusion": root + "plugins/dsh-fusion/src/index.ts",
      "@klarkxy/dsh-recap": root + "plugins/dsh-recap/src/index.ts",
      "@klarkxy/dsh-mood": root + "plugins/dsh-mood/src/index.ts",
  } },
  test: { watch: false, maxWorkers: 2, include: ['plugins/*/src/**/*.spec.{ts,tsx}', 'plugins/*/test/**/*.spec.{ts,tsx}', 'scripts/editor-plugins/*.spec.mjs'] },
})
