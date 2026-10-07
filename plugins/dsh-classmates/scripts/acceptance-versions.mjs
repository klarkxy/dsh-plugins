import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function installedAcceptanceVersions() {
  return { host: require('@deepseek-ai/dsh/package.json').version, plugin: require('../package.json').version };
}

/** Saved acceptance keeps the versions of its producers, even after an upgrade. */
export function acceptanceVersions(...receipts) {
  const versions = receipts.map(receipt => receipt?.versions);
  if (!versions.length || versions.some(row => typeof row?.host !== 'string' || !row.host || typeof row?.plugin !== 'string' || !row.plugin)) {
    throw new Error('Acceptance producer versions are missing; rerun acceptance before exporting.');
  }
  const first = versions[0];
  if (versions.some(row => row.host !== first.host || row.plugin !== first.plugin)) {
    throw new Error('Acceptance producer versions differ; export each version separately.');
  }
  return { host: first.host, plugin: first.plugin };
}
