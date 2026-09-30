import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')

describe('git commit client', () => {
  it('keys the catalog effect on route strings, not the settings object', () => {
    // Depending on `settings?.model` refetched after every save and looped.
    expect(source).not.toContain('settings?.model, text.failed]')
    expect(source).toContain('[props.client, boundProvider, boundModel]')
  })

  it('injects its stylesheet once from apply, not inside the header button', () => {
    expect(source).not.toContain('<style>{css}</style>')
    expect(source).toContain("'git-commit.styles'")
  })

  it('asks for confirmation before committing everything', () => {
    expect(source).toContain("onClick={() => setConfirming(true)}")
  })
})
