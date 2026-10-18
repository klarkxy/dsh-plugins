import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { grokExecutable, childEnvironment } from './process.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
it('resolves an npm launcher to its Node entry without shell execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grok-launcher-')); roots.push(root)
  const directory = join(root, 'node_modules', '@xai', 'grok', 'bin'); await mkdir(directory, { recursive: true })
  const script = join(directory, 'grok.js'), launcher = join(root, 'grok.cmd')
  await writeFile(script, '')
  await writeFile(launcher, '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\@xai\\grok\\bin\\grok.js" %*\r\n')
  expect(await grokExecutable(launcher)).toEqual({ command: process.execPath, args: [script], displayPath: launcher })
  await writeFile(launcher, '@echo off\r\ncall arbitrary.cmd %*')
  await expect(grokExecutable(launcher)).rejects.toMatchObject({ code: 'unsupported-launcher' })
})
it('does not inherit provider credentials, Node injection, or stale Harness context into the isolated home', () => {
  const env = childEnvironment('private', 'auth', { PATH: 'bin', GROK_HOME: 'global', GROK_MODEL: 'old', DSH_SESSION_ID: 'old', AWS_SECRET_ACCESS_KEY: 'secret', GH_TOKEN: 'secret', NODE_OPTIONS: '--require=inject' })
  expect(env).toMatchObject({ PATH: 'bin', GROK_HOME: 'private', GROK_AUTH_PATH: 'auth' })
  for (const name of ['GROK_MODEL', 'DSH_SESSION_ID', 'AWS_SECRET_ACCESS_KEY', 'GH_TOKEN', 'NODE_OPTIONS']) expect(env).not.toHaveProperty(name)
})
