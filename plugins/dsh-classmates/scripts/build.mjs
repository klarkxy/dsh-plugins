import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all(['dist/manager.js', 'dist/manager.js.map'].map(path => rm(path, { force: true })));
await build({ entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', sourcemap: true });
await build({
  entryPoints: ['src/client.tsx'], outfile: 'dist/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'], sourcemap: true,
  banner: { js: 'window.__ModuleLoader__.load({id:"@klarkxy/dsh-classmates",factory(require){const module={exports:{}};const exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
});
