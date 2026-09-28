import { describe, expect, it } from 'vitest'
import type { ChangedFile } from './git.ts'
import { buildPlanInput, extractJsonObject, parsePlan, sanitizeMessage } from './plan.ts'

const files: ChangedFile[] = [
  { path: 'src/a.ts', status: 'modified', staged: false },
  { path: 'src/b.ts', status: 'modified', staged: false },
  { path: 'docs/c.md', status: 'untracked', staged: false },
]

describe('parsePlan', () => {
  it('accepts a valid plan covering every file once', () => {
    const text = JSON.stringify({
      groups: [
        { message: 'feat: update a', files: ['src/a.ts', 'src/b.ts'] },
        { message: 'docs: add c', files: ['docs/c.md'] },
      ],
    })
    const plan = parsePlan(text, files)
    expect(plan).toHaveLength(2)
    expect(plan?.[1]?.files).toEqual(['docs/c.md'])
  })

  it('unwraps fenced JSON', () => {
    const inner = JSON.stringify({ groups: [{ message: 'fix: both', files: ['src/a.ts', 'src/b.ts', 'docs/c.md'] }] })
    const fence = ['```json', inner, '```'].join('\n')
    expect(parsePlan(fence, files)).toHaveLength(1)
  })

  it('rejects duplicate, unknown, or missing files', () => {
    const dup = JSON.stringify({ groups: [
      { message: 'a', files: ['src/a.ts'] },
      { message: 'b', files: ['src/a.ts', 'src/b.ts', 'docs/c.md'] },
    ] })
    expect(parsePlan(dup, files)).toBeUndefined()
    const unknown = JSON.stringify({ groups: [{ message: 'a', files: ['src/a.ts', 'src/b.ts', 'docs/c.md', 'x'] }] })
    expect(parsePlan(unknown, files)).toBeUndefined()
    const missing = JSON.stringify({ groups: [{ message: 'a', files: ['src/a.ts'] }] })
    expect(parsePlan(missing, files)).toBeUndefined()
  })

  it('rejects malformed output', () => {
    expect(parsePlan('no json here', files)).toBeUndefined()
    expect(parsePlan('{"groups":[]}', files)).toBeUndefined()
    expect(parsePlan('{"groups":[{"message":"","files":["src/a.ts"]}]}', files)).toBeUndefined()
  })
})

describe('extractJsonObject', () => {
  it('finds the first balanced object with strings containing braces', () => {
    expect(extractJsonObject('prefix {"a":"{}","b":1} suffix')).toBe('{"a":"{}","b":1}')
  })
})

describe('sanitizeMessage', () => {
  it('collapses whitespace and strips the trailing period', () => {
    expect(sanitizeMessage('  feat: add\nthing.  ')).toBe('feat: add thing')
  })
  it('rejects empty messages', () => {
    expect(sanitizeMessage('   ')).toBeUndefined()
    expect(sanitizeMessage(42)).toBeUndefined()
  })
})

describe('buildPlanInput', () => {
  it('includes the manifest, recent subjects and untracked previews', () => {
    const input = buildPlanInput({
      files,
      recentSubjects: ['feat: earlier'],
      stat: ' 1 file changed',
      diff: 'diff --git a/src/a.ts b/src/a.ts',
      untracked: [{ path: 'docs/c.md', preview: '# hello', binary: false }],
    })
    expect(input).toContain('M src/a.ts')
    expect(input).toContain('? docs/c.md')
    expect(input).toContain('feat: earlier')
    expect(input).toContain('# hello')
  })
})
