import { afterEach, beforeEach, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyRequest } from '@deepseek-ai/dsh-sandbox-policy'
import { FolderRuntime, installFolderPolicy, type PolicyResolver } from './runtime.ts'
import { WorkspaceFoldersService, type WorkspaceLike } from './service.ts'
import type { FolderRecord } from './contracts.ts'

let root: string, primary: string, extra: string, outside: string
let service: WorkspaceFoldersService, runtime: FolderRuntime, parent: Session
let sessions: Map<string, Session>, workspaces: Map<string, WorkspaceLike>
let resolver: PolicyResolver, stop: () => void
const signal = () => new AbortController().signal
function session(id: string, cwd = primary, lineage = {}) {
  const value = Session.create(SessionId(id), [], { version: 4, id: SessionId(id), createdAt: 0, cwd, isSeeded: false, ...lineage }, (lineage as { isSeeded?: boolean }).isSeeded ? SessionLogOffset(0) : undefined)
  sessions.set(id, value); return value
}
beforeEach(async () => {
  await mkdir('.scratch/workspace-folders-unit', { recursive: true })
  root = await mkdtemp(path.resolve('.scratch/workspace-folders-unit/runtime-'))
  primary = path.join(root, 'primary'); extra = path.join(root, 'extra'); outside = path.join(root, 'outside')
  await Promise.all([mkdir(primary), mkdir(extra), mkdir(outside)])
  sessions = new Map(); parent = session('parent')
  const rows = new Map<string, FolderRecord>()
  workspaces = new Map([['one', { id: 'one', path: primary, title: 'One', sessionIds: ['parent'] }]])
  service = new WorkspaceFoldersService({ get: id => workspaces.get(id), list: () => [...workspaces.values()] }, {
    get: id => rows.get(id), put: async (id, value) => { rows.set(id, value) },
  })
  await service.save('one', [extra], 0, signal())
  runtime = new FolderRuntime(service, id => sessions.get(id))
  resolver = { resolve: (request = {}) => ({ mode: request.mode ?? 'workspace-write', workspaceRoot: request.session?.header.cwd ?? primary, sessionId: request.session?.id }) }
  stop = installFolderPolicy(resolver, runtime)
})
afterEach(async () => { stop(); await service.dispose(); await rm(root, { recursive: true, force: true }) })

it('freezes prompt and tool roots until the next turn', async () => {
  expect(resolver.resolve({ session: parent }).additionalWritableRoots).toBeUndefined()
  runtime.begin(parent)
  const text = runtime.text(parent)
  expect(text).toContain(JSON.stringify(extra))
  await service.save('one', [outside], 1, signal())
  expect(runtime.text(parent)).toBe(text)
  expect(resolver.resolve({ session: parent }).additionalWritableRoots).toEqual([extra])
  runtime.end(parent); runtime.begin(parent)
  expect(runtime.text(parent)).toContain(JSON.stringify(outside))
  expect(resolver.resolve({ session: parent }).additionalWritableRoots).toEqual([outside])
})
it('preserves read-only, full access, approved override and agentless policy', () => {
  runtime.begin(parent)
  for (const mode of ['read-only', 'danger-full-access'] as const) {
    expect(resolver.resolve({ session: parent, mode })).toMatchObject({ mode, workspaceRoot: primary })
    expect(resolver.resolve({ session: parent, mode }).additionalWritableRoots).toBeUndefined()
  }
  expect(resolver.resolve().additionalWritableRoots).toBeUndefined()
})
it('isolates workspace members and does not grant by matching cwd alone', () => {
  const unrelated = session('unrelated')
  runtime.begin(unrelated)
  expect(runtime.text(unrelated)).toBe('')
  expect(resolver.resolve({ session: unrelated }).additionalWritableRoots).toBeUndefined()
  workspaces.set('two', { id: 'two', path: outside, title: 'Two', sessionIds: ['other'] })
  const other = session('other', outside); runtime.begin(other)
  expect(resolver.resolve({ session: other }).additionalWritableRoots).toBeUndefined()
})
it('children inherit the parent snapshot even if the workspace was edited meanwhile', async () => {
  runtime.begin(parent)
  await service.save('one', [outside], 1, signal())
  const child = session('child', primary, { origin: 'subagent', parentSession: parent.id, delegationDepth: 1 })
  runtime.begin(child)
  expect(resolver.resolve({ session: child }).additionalWritableRoots).toEqual([extra])
  const grandchild = session('grandchild', primary, { origin: 'subagent', parentSession: child.id, delegationDepth: 2 })
  runtime.begin(grandchild)
  expect(resolver.resolve({ session: grandchild }).additionalWritableRoots).toEqual([extra])
  const changed = session('different', outside, { origin: 'subagent', parentSession: parent.id })
  runtime.begin(changed)
  expect(resolver.resolve({ session: changed }).additionalWritableRoots).toBeUndefined()
})
it('ordinary forks do not inherit unregistered membership through parentSession', () => {
  runtime.begin(parent)
  const fork = session('fork', primary, { parentSession: parent.id, isSeeded: true })
  runtime.begin(fork)
  expect(resolver.resolve({ session: fork }).additionalWritableRoots).toBeUndefined()
})
it('continues with current workspace settings after parent becomes idle', async () => {
  runtime.begin(parent); runtime.end(parent)
  await service.save('one', [outside], 1, signal())
  const child = session('child', primary, { origin: 'subagent', parentSession: parent.id })
  runtime.begin(child)
  expect(resolver.resolve({ session: child }).additionalWritableRoots).toEqual([outside])
})
it('retains deployment roots and restores the original method on unload', () => {
  stop()
  const original = resolver.resolve
  resolver.resolve = request => ({ ...original(request), additionalWritableRoots: [outside] })
  const before = resolver.resolve
  stop = installFolderPolicy(resolver, runtime)
  runtime.begin(parent)
  expect(resolver.resolve({ session: parent }).additionalWritableRoots).toEqual([outside, extra])
  stop()
  expect(resolver.resolve).toBe(before)
})
it('becomes inert when another decorator still wraps it at unload', () => {
  runtime.begin(parent)
  const installed = resolver.resolve
  resolver.resolve = request => installed(request)
  stop()
  expect(resolver.resolve({ session: parent }).additionalWritableRoots).toBeUndefined()
})
it('decorates the raw Cordis service across independent traced consumers', async () => {
  class TestPolicy extends Service {
    constructor(ctx: Context) { super(ctx, 'sandboxPolicy') }
    resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy { return { mode: request.mode ?? 'workspace-write', workspaceRoot: primary } }
  }
  const ctx = new Context(); const policy = new TestPolicy(ctx)
  const remove = installFolderPolicy(ctx.sandboxPolicy, runtime)
  runtime.begin(parent)
  expect(policy.resolve({ session: parent }).additionalWritableRoots).toEqual([extra])
  expect(ctx.sandboxPolicy.resolve({ session: parent }).additionalWritableRoots).toEqual([extra])
  remove()
  expect(Object.hasOwn(policy, 'resolve')).toBe(false)
  await ctx.fiber.dispose()
})
it('real DSH filesystem allows the added folder and rejects unrelated or read-only writes', async () => {
  const ctx = new Context()
  ctx.provide('sandboxPolicy', { ...resolver, defaultMode: 'workspace-write' } as any)
  const fs = new SandboxedFileSystem(ctx, { cwd: primary, diffBasisMaxBytes: 1024 * 1024 })
  runtime.begin(parent)
  const target = await fs.resolve(path.join(extra, 'written.txt'))
  await fs.writeText(target, 'hello', undefined, undefined, resolver.resolve({ session: parent }))
  expect(await fs.readText(target)).toBe('hello')
  const denied = await fs.resolve(path.join(outside, 'denied.txt'))
  await expect(fs.writeText(denied, 'bad', undefined, undefined, resolver.resolve({ session: parent }))).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  await expect(fs.writeText(target, 'bad', undefined, undefined, resolver.resolve({ session: parent, mode: 'read-only' }))).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  await service.save('one', [], 1, signal()); runtime.end(parent); runtime.begin(parent)
  await expect(fs.writeText(target, 'removed', undefined, undefined, resolver.resolve({ session: parent }))).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  await ctx.fiber.dispose()
})
