import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PostToolDecision, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  HIDDEN_NOTE_FILENAME,
  findBlockedTargetForTool,
  guardToolSecretCall,
  installSandboxAndSecretGuard,
  maskAmbientTokenText,
  maskSandboxArgv,
  redactAmbientTokensInDecision,
  resolveMaskedTargets,
  resolveSandboxGuardConfig,
} from './sandbox-guard.ts'

describe('credential file target resolution and sandbox masking', () => {
  it('masks dsh, cloud, and registry groups by default while leaving git and npm opt-in', () => {
    const defaults = resolveMaskedTargets(resolveSandboxGuardConfig({}), {
      homeDir: '/home/dev',
      dshHome: '/custom/dsh-home',
      platform: 'linux',
      wslUsersRoot: '/nonexistent-wsl',
    })
    const paths = defaults.map(entry => entry.path)
    expect(paths).toContain('/custom/dsh-home/.credentials.yaml')
    expect(paths).toContain('/home/dev/.aws/credentials')
    expect(paths).toContain('/home/dev/.config/gcloud')
    expect(paths).toContain('/home/dev/.cargo/credentials.toml')
    expect(paths).not.toContain('/home/dev/.ssh')
    expect(paths).not.toContain('/home/dev/.npmrc')

    const withGitAndNpm = resolveMaskedTargets(
      resolveSandboxGuardConfig({ maskGroups: ['dsh', 'git', 'npm'] }),
      { homeDir: '/home/dev', platform: 'linux', wslUsersRoot: '/nonexistent-wsl' },
    )
    expect(withGitAndNpm.map(entry => entry.path)).toEqual(
      expect.arrayContaining(['/home/dev/.ssh', '/home/dev/.config/gh/hosts.yml', '/home/dev/.npmrc']),
    )
  })

  it('rewrites bwrap and sandbox-exec command lines with read-only masks', () => {
    const targets = [
      { group: 'dsh' as const, path: '/home/dev/.dsh/.credentials.yaml', kind: 'file' as const },
      { group: 'cloud' as const, path: '/home/dev/.config/gcloud', kind: 'dir' as const },
    ]
    const existing = new Set(['/tmp/mask/HIDDEN-BY-DSH.txt', '/home/dev/.dsh/.credentials.yaml', '/home/dev/.config/gcloud'])
    const bwrap = maskSandboxArgv(
      ['bwrap', '--ro-bind', '/', '/', '--', 'bash', '-lc', 'ls'],
      targets,
      '/tmp/mask/HIDDEN-BY-DSH.txt',
      p => existing.has(p),
      p => ({ isDirectory: () => p.endsWith('gcloud') }),
    )
    expect(bwrap).toEqual([
      'bwrap', '--ro-bind', '/', '/',
      '--ro-bind', '/tmp/mask/HIDDEN-BY-DSH.txt', '/home/dev/.dsh/.credentials.yaml',
      '--tmpfs', '/home/dev/.config/gcloud',
      '--ro-bind', '/tmp/mask/HIDDEN-BY-DSH.txt', `/home/dev/.config/gcloud/${HIDDEN_NOTE_FILENAME}`,
      '--remount-ro', '/home/dev/.config/gcloud',
      '--', 'bash', '-lc', 'ls',
    ])

    const seatbelt = maskSandboxArgv(
      ['sandbox-exec', '-p', '(version 1)\n(allow default)', 'bash', '-lc', 'ls'],
      targets,
      '/tmp/mask/HIDDEN-BY-DSH.txt',
    )
    expect(seatbelt[2]).toContain('(deny file-read* (literal "/home/dev/.dsh/.credentials.yaml"))')
    expect(seatbelt[2]).toContain('(deny file-read* (subpath "/home/dev/.config/gcloud"))')
  })

  it('blocks direct read/write/open_sidebar and parent-directory grep over masked credential paths', () => {
    const targets = resolveMaskedTargets(resolveSandboxGuardConfig({}), {
      homeDir: '/home/dev',
      platform: 'linux',
      wslUsersRoot: '/nonexistent-wsl',
    })
    const opts = { cwd: '/home/dev/project', homeDir: '/home/dev', platform: 'linux' as const, realpathSync: (p: string) => path.resolve(p) }

    expect(findBlockedTargetForTool('read', { file_path: '~/.dsh/.credentials.yaml' }, targets, opts)?.group).toBe('dsh')
    expect(findBlockedTargetForTool('open_sidebar', { path: '/home/dev/.aws/credentials' }, targets, opts)?.group).toBe('cloud')
    // Grepping `/home/dev` would traverse `/home/dev/.dsh/.credentials.yaml`.
    expect(findBlockedTargetForTool('grep', { path: '/home/dev' }, targets, opts)).toBeDefined()
    expect(findBlockedTargetForTool('grep', { path: '/home/dev/project' }, targets, opts)).toBeUndefined()
  })
})

describe('tool secret solicitation, raw argument, and ambient output guards', () => {
  const ghPat = `github_pat_${'A1b2C3d4E5f6'.repeat(2)}`
  const ghp = `ghp_${'x9Y8z7W6v5U4'.repeat(3)}`
  const sk = `sk-${'abcdEFGH1234567890_-'.repeat(1)}xy`

  it('blocks chat secret solicitation, gh auth token extraction, and raw token arguments', () => {
    expect(guardToolSecretCall('ask_user_question', {
      questions: [{ question: 'Please paste your GitHub Personal Access Token here.' }],
    })).toContain('request_secret')
    expect(guardToolSecretCall('ask_view', {
      title: '配置密钥',
      prompt: '请在下方输入你的 API Key 或访问令牌',
    })).toContain('request_secret')
    expect(guardToolSecretCall('ask_user_question', {
      questions: [{ question: 'Which target branch should we open the PR against?' }],
    })).toBeUndefined()

    expect(guardToolSecretCall('bash', { command: 'TOKEN=$(gh auth token) && echo ok' })).toContain('gh auth token')
    expect(guardToolSecretCall('bash', { command: 'gh pr view 46 --json state' })).toBeUndefined()

    expect(guardToolSecretCall('bash', { command: `curl -H "Authorization: Bearer ${ghPat}" https://api.github.com` }))
      .toContain('github-token')
    expect(guardToolSecretCall('request_secret', { slot: 'github-token', purpose: 'Call GitHub API' })).toBeUndefined()
  })

  it('redacts ambient token patterns in tool outputs while wiring cleanly on Host context', async () => {
    expect(maskAmbientTokenText(`pat=${ghPat} classic=${ghp} key=${sk}`))
      .toBe('pat=[REDACTED:github-token] classic=[REDACTED:github-token] key=[REDACTED:api-key]')

    const rawResult = {
      isError: false,
      content: [{ type: 'text', text: `Authorization: Bearer ${ghp}` }],
      value: { stdout: `export OPENAI_API_KEY=${sk}` },
    } as unknown as ToolExecutionResult
    const decision: PostToolDecision = { kind: 'accept' }
    const guarded = redactAmbientTokensInDecision(decision, rawResult)
    expect(guarded).toEqual({
      kind: 'accept',
      value: { stdout: 'export OPENAI_API_KEY=[REDACTED:api-key]' },
    })

    const hooks: Array<{ event: string; prepend?: boolean; fn: (...args: any[]) => any }> = []
    let sandboxService: { confine: (cmd: { argv?: string[] }) => Promise<{ argv?: string[] }> } = {
      confine: async cmd => cmd,
    }
    const disposers: Array<() => void> = []
    const ctx = {
      inject: (_deps: string[], cb: (inner: any) => void) => {
        cb({
          sandbox: sandboxService,
          effect: (run: () => (() => void) | void) => {
            const stop = run()
            if (typeof stop === 'function') disposers.push(stop)
          },
        })
      },
      effect: (run: () => (() => void) | void) => {
        const stop = run()
        if (typeof stop === 'function') disposers.push(stop)
      },
      on: (event: string, fn: (...args: any[]) => any, opts?: { prepend?: boolean }) => {
        hooks.push({ event, prepend: opts?.prepend, fn })
        return () => {}
      },
    }

    installSandboxAndSecretGuard(ctx as never, { maskCredentialFiles: true, guardToolSecrets: true, redactTokenPatterns: true })
    expect(hooks.find(h => h.event === 'tools/post-execute')?.prepend).toBe(true)

    const pre = hooks.find(h => h.event === 'tools/pre-execute')!.fn
    const blocked = await pre({ name: 'bash', args: { command: 'gh auth token' } }, async () => ({ kind: 'allow' }))
    expect(blocked).toMatchObject({ kind: 'block' })

    for (const stop of disposers) stop()
  })
})
