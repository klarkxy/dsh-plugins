import { expect, it } from 'vitest';
// @ts-expect-error Development-only acceptance script is JavaScript.
import { acceptanceVersions } from '../scripts/acceptance-versions.mjs';

it('keeps the producer version of saved acceptance after a host upgrade', () => {
  const old = { versions: { host: '0.1.7-rc.2', plugin: '0.1.0-alpha.1' } };
  expect(acceptanceVersions(old, old, old)).toEqual(old.versions);
});

it('refuses to label legacy receipts with the current installation version', () => {
  expect(() => acceptanceVersions({ members: [] })).toThrow('producer versions are missing');
});

it('refuses one host label for acceptance produced across different host or plugin versions', () => {
  const current = { versions: { host: '0.2.0-rc.2', plugin: '0.2.0-alpha.1' } };
  expect(() => acceptanceVersions(current, { versions: { ...current.versions, host: '0.1.7-rc.2' } })).toThrow('versions differ');
  expect(() => acceptanceVersions(current, { versions: { ...current.versions, plugin: '0.1.0-alpha.1' } })).toThrow('versions differ');
});
