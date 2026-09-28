// Post-run inspection of a copied profile. Model requests are disabled.
import { cp, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
const source = resolve('.test-output/minesweeper/home');
const home = resolve('.test-output/team-review/home');
await mkdir(home, { recursive: true });
await cp(source, home, { recursive: true, dereference: true, filter: p => !p.endsWith('.credentials.yaml') });
process.env.DSH_HOME = home;
process.env.DSH_TELEMETRY_DISABLED = '1';
process.env.OCG_API_KEY = 'post-run-inspection-disabled';
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes(':19042')) throw Error('Model calls disabled during historical inspection');
  return realFetch(input, init);
};
const { loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot');
const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
const workspace = resolve('demo/minesweeper');
process.chdir(workspace);
const { shutdown } = await runProfile({ environment: loadLayeredEnv('classmates-team-review', workspace), profile: 'minesweeper', patchFiles: [], args: ['--host', '127.0.0.1', '--port', '19434', '--no-open'] });
console.log('REVIEW_READY');
for await (const line of createInterface({ input: process.stdin })) if (line.trim() === 'stop') { await shutdown.shutdown(0); break; }
process.exit(0);
