import { describe, expect, it } from 'vitest'
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
import { ReleaseMetadataResolver, resolveGitHubRepoRef } from './releases.ts'

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
})
