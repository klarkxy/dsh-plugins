import { createServer, request as httpRequest, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RPC_CHANNEL,
  apply,
  compareSemver,
  extractTagVersion,
  parseSemver,
  selectReleasesBetween,
  splitBilingualReleaseBody,
} from './index.ts'
import { PluginUpdateService, normalizeUpdateOutcome, type HostBundleSummary, type HostPluginManagerLike } from './plugin-updater.ts'
import { FALLBACK_NPM_REGISTRY, ReleaseMetadataResolver, resolveGitHubRepoRef } from './releases.ts'

describe('dsh-update contracts & release range logic', () => {
  it('orders prerelease and stable SemVer versions per SemVer 2.0', () => {
    expect(compareSemver('0.2.2-rc.1', '0.2.2-rc.4')).toBe(-1)
    expect(compareSemver('0.2.2-rc.4', '0.2.2')).toBe(-1)
    expect(compareSemver('0.2.2', '0.2.2')).toBe(0)
    expect(parseSemver('v0.3.7')?.version).toBe('0.3.7')
  })

  it('extracts DSH core tags and monorepo package tags accurately', () => {
    expect(extractTagVersion('dsh-v0.2.2-rc.4', { dshCore: true })).toEqual({
      version: '0.2.2-rc.4',
      scopedMatch: true,
    })
    expect(
      extractTagVersion('@klarkxy/dsh-git-commit@0.3.7', {
        packageName: '@klarkxy/dsh-git-commit',
        directory: 'plugins/dsh-git-commit',
      }),
    ).toEqual({
      version: '0.3.7',
      scopedMatch: true,
    })
    expect(
      extractTagVersion('dsh-git-commit-v0.3.8', {
        packageName: '@klarkxy/dsh-git-commit',
      }),
    ).toEqual({
      version: '0.3.8',
      scopedMatch: true,
    })
  })

  it('filters releases strictly in (currentVersion, targetVersion] sorted newest-first', () => {
    const sample = [
      { tag: 'dsh-v0.2.2-rc.1', version: '0.2.2-rc.1', title: 'rc1', body: 'rc1 notes', publishedAt: '2026-11-01T00:00:00Z', url: 'https://example.com/1', prerelease: true },
      { tag: 'dsh-v0.2.2-rc.2', version: '0.2.2-rc.2', title: 'rc2', body: 'rc2 notes', publishedAt: '2026-11-05T00:00:00Z', url: 'https://example.com/2', prerelease: true },
      { tag: 'dsh-v0.2.2-rc.3', version: '0.2.2-rc.3', title: 'rc3', body: 'rc3 notes', publishedAt: '2026-11-10T00:00:00Z', url: 'https://example.com/3', prerelease: true },
      { tag: 'dsh-v0.2.2-rc.4', version: '0.2.2-rc.4', title: 'rc4', body: 'rc4 notes', publishedAt: '2026-11-15T00:00:00Z', url: 'https://example.com/4', prerelease: true },
    ]
    const selected = selectReleasesBetween(sample, '0.2.2-rc.1', '0.2.2-rc.4')
    expect(selected.map(item => item.version)).toEqual(['0.2.2-rc.4', '0.2.2-rc.3', '0.2.2-rc.2'])
  })

  it('splits bilingual DSH release notes into zh and en sections', () => {
    const md = [
      '[中文](#zh) | [English](#en)',
      '',
      '### 新增与优化',
      '- 支持桌面端更新日志预览与插件热重载修复',
      '',
      '---',
      '',
      '### Added & Improved',
      '- Support desktop changelog preview and plugin HMR fix',
    ].join('\n')
    const split = splitBilingualReleaseBody(md)
    expect(split?.zh).toContain('支持桌面端更新日志预览')
    expect(split?.zh).not.toContain('Added & Improved')
    expect(split?.en).toContain('Support desktop changelog preview')
  })

  it('resolves GitHub repository metadata from git source, repository object, bugs, and GitHub Pages', () => {
    expect(
      resolveGitHubRepoRef({
        source: 'git+https://github.com/klarkxy/dsh-plugins.git#abcdef1234567890abcdef1234567890abcdef12&path:/plugins/dsh-update',
      }),
    ).toEqual({
      owner: 'klarkxy',
      repo: 'dsh-plugins',
      directory: 'plugins/dsh-update',
      url: 'https://github.com/klarkxy/dsh-plugins',
    })
    expect(
      resolveGitHubRepoRef({
        homepage: 'https://klarkxy.github.io/dsh-plugins/plugins/update/',
      }),
    ).toEqual({
      owner: 'klarkxy',
      repo: 'dsh-plugins',
      url: 'https://github.com/klarkxy/dsh-plugins',
    })
  })
})

describe('PluginUpdateService & Host RPC safety', () => {
  it('checks DSH and plugin updates in read-only mode and preserves Git bundle selection on confirmed update (#13609)', async () => {
    const resolver = new ReleaseMetadataResolver({
      ghApiFn: async endpoint => {
        if (endpoint.includes('deepseek-ai/deepseek-harness/releases')) {
          return [
            { tag_name: 'dsh-v0.2.2-rc.4', name: '0.2.2-rc.4', body: 'Fix desktop updater', published_at: '2026-11-16T00:00:00Z', prerelease: true },
            { tag_name: 'dsh-v0.2.2-rc.3', name: '0.2.2-rc.3', body: 'Add plugin slots', published_at: '2026-11-12T00:00:00Z', prerelease: true },
            { tag_name: 'dsh-v0.2.2-rc.2', name: '0.2.2-rc.2', body: 'Earlier fix', published_at: '2026-11-08T00:00:00Z', prerelease: true },
          ]
        }
        if (endpoint.includes('klarkxy/dsh-plugins/releases')) {
          return [
            { tag_name: '@klarkxy/dsh-git-commit@0.3.9', name: 'v0.3.9', body: '### Changelog\n- Better commit message streaming', published_at: '2026-11-17T00:00:00Z' },
            { tag_name: '@klarkxy/dsh-git-commit@0.3.8', name: 'v0.3.8', body: '### Changelog\n- Handle amended commits', published_at: '2026-11-10T00:00:00Z' },
          ]
        }
        if (endpoint.includes('example/git-plugin/releases')) {
          return [
            { tag_name: 'v1.2.0', name: 'v1.2.0', body: 'Add Git release notes', published_at: '2026-11-17T00:00:00Z' },
          ]
        }
        if (endpoint.includes('example/git-plugin/commits/v1.2.0')) {
          return { sha: '65018178591b3bcc7fd22a966485e2838c22e0a9' }
        }
        return undefined
      },
      fetchFn: (async (url: string | URL) => {
        const href = String(url)
        if (href.includes('@klarkxy%2fdsh-git-commit')) {
          return new Response(
            JSON.stringify({
              name: '@klarkxy/dsh-git-commit',
              versions: {
                '0.3.7': { version: '0.3.7', engines: { dsh: '>=0.2.0-rc.2' } },
                '0.3.8': { version: '0.3.8', engines: { dsh: '>=0.2.0-rc.2' } },
                '0.3.9': {
                  version: '0.3.9',
                  engines: { dsh: '>=0.2.0-rc.2' },
                  repository: { type: 'git', url: 'git+https://github.com/klarkxy/dsh-plugins.git', directory: 'plugins/dsh-git-commit' },
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch,
    })

    const calls: string[] = []
    let gitPluginEnabled = true
    let gitPluginVersion = '1.1.0'

    const bundles = (): HostBundleSummary[] => [
      {
        name: '@deepseek-ai/dsh-base',
        version: '0.2.2-rc.2',
        installed: true,
        official: true,
        enabled: true,
      },
      {
        name: '@klarkxy/dsh-git-commit',
        version: '0.3.7',
        installed: true,
        enabled: true,
        removable: true,
        source: '^0.3.7',
        update: 'registry',
      },
      {
        name: 'example-git-plugin',
        version: gitPluginVersion,
        installed: true,
        enabled: gitPluginEnabled,
        removable: true,
        source: 'github:example/git-plugin#525571f0c568b55b3e8657d0542264178aedc59f',
        update: 'git',
      },
    ]

    const manager: HostPluginManagerLike = {
      listBundles: async () => bundles(),
      updateBundle: async (name, version, options) => {
        calls.push(`update:${name}@${version}:${options?.spec ?? 'registry'}`)
        if (name === 'example-git-plugin') {
          gitPluginVersion = version
          // Simulate upstream DSH #13609 bug dropping `enabled` from `dsh.profile.bundles`:
          gitPluginEnabled = false
        }
        return { application: 'applied', version }
      },
      setBundleEnabled: async (name, enabled) => {
        calls.push(`enable:${name}:${String(enabled)}`)
        if (name === 'example-git-plugin') gitPluginEnabled = enabled
        return { application: 'applied' }
      },
    }

    const service = new PluginUpdateService({
      resolver,
      getPluginManager: () => manager,
      getProfileDir: () => null,
      getDshVersion: () => '0.2.2-rc.2',
      isDesktopHost: () => true,
    })

    const dshCheck = await resolver.checkDshUpdates('0.2.2-rc.2', true)
    expect(dshCheck.hasUpdate).toBe(true)
    expect(dshCheck.releases.map(r => r.version)).toEqual(['0.2.2-rc.4', '0.2.2-rc.3'])
    expect(calls).toEqual([])

    const pluginCheck = await service.checkAllPlugins()
    expect(calls).toEqual([])
    expect(pluginCheck.plugins).toHaveLength(2)

    const npmPlugin = pluginCheck.plugins.find(p => p.name === '@klarkxy/dsh-git-commit')!
    expect(npmPlugin.hasUpdate).toBe(true)
    expect(npmPlugin.latestVersion).toBe('0.3.9')
    expect(npmPlugin.releases.map(r => r.version)).toEqual(['0.3.9', '0.3.8'])

    const gitPlugin = pluginCheck.plugins.find(p => p.name === 'example-git-plugin')!
    expect(gitPlugin.hasUpdate).toBe(true)
    expect(gitPlugin.latestVersion).toBe('1.2.0')
    expect(gitPlugin.targetSpec).toBe('git+https://github.com/example/git-plugin.git#65018178591b3bcc7fd22a966485e2838c22e0a9')

    // Confirmed update executes and restores bundle selection when dropped (#13609)
    const applied = await service.applyPluginUpdate({
      name: 'example-git-plugin',
      targetVersion: '1.2.0',
      targetSpec: gitPlugin.targetSpec,
    })
    expect(applied.status).toBe('applied')
    expect(applied.bundlePreservedInProfile).toBe(true)
    expect(gitPluginEnabled).toBe(true)
    expect(calls).toEqual([
      'update:example-git-plugin@1.2.0:git+https://github.com/example/git-plugin.git#65018178591b3bcc7fd22a966485e2838c22e0a9',
      'enable:example-git-plugin:true',
    ])
  })

  it('reads pluginManager.updateBundle results from the envelope the Host actually answers with', async () => {
    const resolver = new ReleaseMetadataResolver({
      ghApiFn: async () => undefined,
      fetchFn: (async () => new Response('not found', { status: 404 })) as typeof fetch,
    })
    let version = '0.3.7'
    const manager: HostPluginManagerLike = {
      listBundles: async () => [{
        name: '@klarkxy/dsh-git-commit',
        version,
        installed: true,
        enabled: true,
        removable: true,
        source: '^0.3.7',
        update: 'registry',
      }],
      // DSH 0.2.2 answers `updateBundle` with `{ from, to, step, result }`, where the
      // change result — not the envelope — carries `application` and `restartReason`.
      updateBundle: async (_name, next) => {
        version = next
        return {
          from: '0.3.7',
          to: next,
          step: 'install',
          result: {
            changed: true,
            application: 'restart-required',
            restartReason: 'no-hmr',
            stage: 'install',
            target: next,
            enabled: true,
            bundle: '@klarkxy/dsh-git-commit',
            packageResult: { kind: 'registry', version: next },
          },
        }
      },
      setBundleEnabled: async () => ({ application: 'applied' }),
    }
    const service = new PluginUpdateService({
      resolver,
      getPluginManager: () => manager,
      getProfileDir: () => null,
      getDshVersion: () => '0.2.2-rc.1',
      isDesktopHost: () => false,
    })

    const applied = await service.applyPluginUpdate({ name: '@klarkxy/dsh-git-commit', targetVersion: '0.3.9' })
    expect(applied.status).toBe('restart-required')
    expect(applied.restartReason).toBe('no-hmr')
    expect(applied.installedVersion).toBe('0.3.9')

    const failure = normalizeUpdateOutcome({
      from: '0.3.7',
      to: '0.3.9',
      step: 'install',
      result: { changed: false, application: 'failed', stage: 'install', target: '0.3.9', error: { code: 'incompatible-version', diagnostic: 'rejected by running DSH' } },
    })
    expect(failure.application).toBe('failed')
    expect(failure.diagnostic).toBe('rejected by running DSH')
  })

  it('registers authenticated Host RPC route on apply()', () => {
    const routes: string[] = []
    const provided: string[] = []
    apply({
      provide(key: string) { provided.push(key); return () => {} },
      effect(fn: () => () => void) { fn(); return () => {} },
      connection: { requestRejection: () => undefined },
      webServer: {
        register(route: { path: string }) {
          routes.push(route.path)
          return () => {}
        },
      },
    } as never)
    expect(provided).toContain('dshUpdate')
    expect(routes).toEqual([RPC_CHANNEL])
  })

  it('does not treat a mirror packument as the install registry', async () => {
    const resolver = new ReleaseMetadataResolver({
      ghApiFn: async () => [],
      fetchFn: (async (url: string | URL) => {
        const href = String(url)
        if (href.startsWith('https://registry.npmjs.org/')) return new Response('missing', { status: 404 })
        if (href.startsWith(`${FALLBACK_NPM_REGISTRY}/`)) {
          return new Response(JSON.stringify({
            name: 'example-plugin',
            versions: {
              '1.0.0': { version: '1.0.0' },
              '1.2.0': { version: '1.2.0' },
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response('no', { status: 404 })
      }) as typeof fetch,
    })
    const updates: Array<string | undefined> = []
    const manager: HostPluginManagerLike = {
      listBundles: async () => [{
        name: 'example-plugin',
        version: '1.0.0',
        installed: true,
        enabled: true,
        removable: true,
        updatable: true,
        source: '^1.0.0',
      }],
      updateBundle: async (_name, _version, options) => {
        updates.push(options?.registry)
        return { application: 'applied', version: '1.2.0' }
      },
    }
    const service = new PluginUpdateService({
      resolver,
      getPluginManager: () => manager,
      getProfileDir: () => null,
      getDshVersion: () => '0.2.2-rc.1',
      isDesktopHost: () => false,
    })
    const [entry] = (await service.checkAllPlugins()).plugins
    expect(entry?.latestVersion).toBe('1.2.0')
    expect(entry?.registry).toBeUndefined()
    const applied = await service.applyPluginUpdate({ name: 'example-plugin', targetVersion: '1.2.0', registry: FALLBACK_NPM_REGISTRY })
    expect(applied.status).toBe('applied')
    expect(updates).toEqual([undefined])
  })

  it('follows DSH 0.2.2-rc.1 updatable bundles and refuses a result with no application', async () => {
    let version = '1.0.0'
    const manager: HostPluginManagerLike = {
      listBundles: async () => [{
        name: 'example-plugin',
        version,
        installed: true,
        enabled: true,
        removable: true,
        updatable: true,
        source: '^1.0.0',
      }],
      updateBundle: async (_name, next) => {
        version = next
        return { from: '1.0.0', to: next, step: 'install', result: { changed: true, stage: 'install', target: 'example-plugin' } }
      },
    }
    const service = new PluginUpdateService({
      resolver: new ReleaseMetadataResolver({ ghApiFn: async () => undefined, fetchFn: (async () => new Response('no', { status: 404 })) as typeof fetch }),
      getPluginManager: () => manager,
      getProfileDir: () => null,
      getDshVersion: () => '0.2.2-rc.1',
      isDesktopHost: () => false,
    })
    const applied = await service.applyPluginUpdate({ name: 'example-plugin', targetVersion: '1.2.0' })
    expect(applied.status).toBe('failed')
    expect(applied.installedVersion).toBe('1.0.0')
    expect(applied.bundlePreservedInProfile).toBe(true)
  })

  it('reinstalls the previous Git plugin when the replacement has no successful application', async () => {
    let present = true
    const calls: string[] = []
    const previous = 'github:example/git-plugin'
    const target = 'git+https://github.com/example/git-plugin.git#65018178591b3bcc7fd22a966485e2838c22e0a9'
    const manager: HostPluginManagerLike = {
      listBundles: async () => present ? [{
        name: 'example-git-plugin',
        version: '1.1.0',
        installed: true,
        enabled: true,
        removable: true,
        source: previous,
      }] : [],
      updateBundle: async () => { throw new Error('registry updateBundle must not run for this Git source') },
      removeBundle: async () => {
        calls.push('remove')
        present = false
        return { application: 'applied' }
      },
      installBundle: async spec => {
        calls.push(`install:${spec}`)
        if (spec === target) return {}
        present = true
        return { application: 'applied' }
      },
    }
    const service = new PluginUpdateService({
      resolver: new ReleaseMetadataResolver({ ghApiFn: async () => undefined, fetchFn: (async () => new Response('no', { status: 404 })) as typeof fetch }),
      getPluginManager: () => manager,
      getProfileDir: () => null,
      getDshVersion: () => '0.2.2-rc.1',
      isDesktopHost: () => false,
    })
    const applied = await service.applyPluginUpdate({
      name: 'example-git-plugin',
      targetVersion: '1.2.0',
      targetSpec: target,
    })
    expect(applied.status).toBe('failed')
    expect(applied.bundlePreservedInProfile).toBe(true)
    expect(present).toBe(true)
    expect(calls).toEqual(['remove', `install:${target}`, `install:${previous}`])
  })

  it('trusts a host restore and does not install again after a failed updateBundle', async () => {
    const calls: string[] = []
    let listed = true
    const manager: HostPluginManagerLike = {
      listBundles: async () => listed ? [{
        name: 'example-plugin',
        version: '1.0.0',
        installed: true,
        enabled: true,
        updatable: true,
        source: '^1.0.0',
      }] : [],
      updateBundle: async () => {
        listed = false
        return {
          from: '1.0.0',
          to: '1.2.0',
          step: 'install',
          result: { changed: false, application: 'failed', stage: 'install', target: 'example-plugin' },
          restore: { changed: true, application: 'applied', stage: 'install', target: 'example-plugin@1.0.0' },
        }
      },
      installBundle: async () => {
        calls.push('install')
        return { application: 'applied' }
      },
    }
    const service = new PluginUpdateService({
      resolver: new ReleaseMetadataResolver({ ghApiFn: async () => undefined, fetchFn: (async () => new Response('no', { status: 404 })) as typeof fetch }),
      getPluginManager: () => manager,
      getProfileDir: () => null,
      getDshVersion: () => '0.2.2-rc.1',
      isDesktopHost: () => false,
    })
    const applied = await service.applyPluginUpdate({ name: 'example-plugin', targetVersion: '1.2.0' })
    expect(applied.status).toBe('failed')
    expect(applied.bundlePreservedInProfile).toBe(true)
    expect(calls).toEqual([])
  })
})

describe('host RPC approval gate', () => {
  const servers: Server[] = []
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })))
  })

  async function boot(options: {
    approval?: { confirm: (request: unknown, signal?: AbortSignal) => Promise<boolean> } | undefined
    manager?: HostPluginManagerLike
    fixture?: {
      plugins?: unknown[]
      applyPlugin?: (request: unknown) => Promise<unknown>
      applyCli?: (version: string) => Promise<unknown>
    }
  } = {}) {
    let handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
    apply({
      provide() { return () => {} },
      effect(fn: () => () => void) { fn(); return () => {} },
      get(name: string) {
        if (name === 'dshUpdateApproval') return options.approval
        if (name === 'dshUpdateFixture') return options.fixture
        if (name === 'pluginManager') return options.manager
        return undefined
      },
      pluginManager: options.manager,
      connection: { requestRejection: () => undefined },
      webServer: {
        register(route: { handler: typeof handler }) {
          handler = route.handler
          return () => {}
        },
      },
    } as never)
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No server address')
    return `http://127.0.0.1:${address.port}${RPC_CHANNEL}`
  }

  async function post(base: string, endpoint: string, payload: Record<string, unknown>) {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(`${base}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }, res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.from(chunk)))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      })
      req.on('error', reject)
      req.end(JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: endpoint, payload }))
    })
    return { status: response.status, json: response.body ? JSON.parse(response.body) as { result?: { ok?: boolean; error?: { code?: string }; value?: unknown } } : {} }
  }

  it('serves camelCase check routes and refuses writes that the host did not approve', async () => {
    const updates: string[] = []
    const cli: string[] = []
    const base = await boot({
      manager: {
        listBundles: async () => [],
        updateBundle: async name => {
          updates.push(name)
          return { application: 'applied', version: '1.2.0' }
        },
      },
      fixture: {
        applyCli: async version => {
          cli.push(version)
          return { previousVersion: '0.2.2-rc.1', targetVersion: version, status: 'failed', message: 'fixture' }
        },
      },
    })
    const checked = await post(base, 'plugins.checkAll', {})
    expect(checked.status).toBe(200)
    expect(checked.json.result?.ok).toBe(true)
    const one = await post(base, 'plugins.checkOne', { name: 'missing-plugin' })
    expect(one.status).toBe(200)
    expect(one.json.result?.ok).toBe(false)

    const forged = await post(base, 'plugins.apply', { name: 'example-plugin', targetVersion: '1.2.0', approved: true })
    expect(forged.status).toBe(200)
    expect(forged.json.result?.error?.code).toBe('HOST_APPROVAL_UNAVAILABLE')
    const cliRefused = await post(base, 'dsh.applyCli', { targetVersion: '0.2.2-rc.4', confirmed: true })
    expect(cliRefused.json.result?.error?.code).toBe('HOST_APPROVAL_UNAVAILABLE')
    expect(updates).toEqual([])
    expect(cli).toEqual([])
  })

  it('runs a write only after the host approval service accepts it', async () => {
    const updates: string[] = []
    const cli: string[] = []
    let decision = false
    const base = await boot({
      approval: { confirm: async () => decision },
      manager: {
        listBundles: async () => [{
          name: 'example-plugin',
          version: '1.0.0',
          installed: true,
          enabled: true,
          updatable: true,
          source: '^1.0.0',
        }],
        updateBundle: async name => {
          updates.push(name)
          return { application: 'applied', version: '1.2.0' }
        },
      },
      fixture: {
        applyCli: async version => {
          cli.push(version)
          return { previousVersion: null, targetVersion: version, status: 'failed', message: 'fixture cli' }
        },
      },
    })
    const rejected = await post(base, 'plugins.apply', { name: 'example-plugin', targetVersion: '1.2.0' })
    expect(rejected.json.result?.error?.code).toBe('HOST_APPROVAL_REJECTED')
    expect(updates).toEqual([])
    decision = true
    const approved = await post(base, 'plugins.apply', { name: 'example-plugin', targetVersion: '1.2.0' })
    expect(approved.json.result?.ok).toBe(true)
    expect(updates).toEqual(['example-plugin'])
    const cliApproved = await post(base, 'dsh.applyCli', { targetVersion: '0.2.2-rc.4' })
    expect(cliApproved.json.result?.ok).toBe(true)
    expect(cli).toEqual(['0.2.2-rc.4'])
  })
})
