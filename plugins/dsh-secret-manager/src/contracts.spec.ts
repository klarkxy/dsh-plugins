import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTH_HEADER,
  DEFAULT_AUTH_PREFIX,
  ENV_KEY_RE,
  MAX_VALUE_LENGTH,
  envKeyOf,
  isAuthHeaderName,
  isAuthPrefix,
  isCanonicalOrigin,
  isSlot,
  originOfUrl,
  parseSecretRef,
  secretRefOf,
  valueProblem,
} from './contracts.ts'

describe('slot and reference grammar', () => {
  it('accepts the slot grammar and rejects everything else', () => {
    for (const slot of ['a', 'db-prod', 'aws-2024', 'x1']) expect(isSlot(slot)).toBe(true)
    for (const slot of ['', 'A', 'db_prod', '-db', 'db-', 'a'.repeat(42), 'db prod', 'db/prod']) {
      expect(isSlot(slot), slot).toBe(false)
    }
  })

  it('derives the injected variable from the slot only', () => {
    expect(envKeyOf('db-prod')).toBe('DSH_SECRET_DB_PROD')
    expect(envKeyOf('aws')).toBe('DSH_SECRET_AWS')
    expect(envKeyOf('a1-b2')).toMatch(ENV_KEY_RE)
  })

  it('round-trips the model-facing reference', () => {
    expect(secretRefOf('db-prod')).toBe('secret://db-prod')
    expect(parseSecretRef('secret://db-prod')).toBe('db-prod')
    expect(parseSecretRef('secret://Bad')).toBeUndefined()
    expect(parseSecretRef('secret://')).toBeUndefined()
    expect(parseSecretRef('db-prod')).toBeUndefined()
    expect(parseSecretRef(undefined)).toBeUndefined()
  })
})

describe('approved origin', () => {
  it('accepts a canonical https origin', () => {
    expect(isCanonicalOrigin('https://api.example.com')).toBe(true)
    expect(isCanonicalOrigin('https://api.example.com:8443')).toBe(true)
  })

  it('rejects a non-canonical spelling of the same origin', () => {
    // WHATWG drops the default port and lower-cases the host, so the sanitised
    // form differs from what the human approved and the comparison fails.
    expect(isCanonicalOrigin('https://api.example.com:443')).toBe(false)
    expect(isCanonicalOrigin('https://API.Example.com')).toBe(false)
    expect(isCanonicalOrigin('https://api.example.com/')).toBe(false)
  })

  it('rejects a suffix, userinfo, plain http and control characters', () => {
    expect(isCanonicalOrigin('https://api.example.com/v1')).toBe(false)
    expect(isCanonicalOrigin('https://api.example.com?v=1')).toBe(false)
    expect(isCanonicalOrigin('https://api.example.com#f')).toBe(false)
    expect(isCanonicalOrigin('https://user:x@api.example.com')).toBe(false)
    expect(isCanonicalOrigin('http://api.example.com')).toBe(false)
    expect(isCanonicalOrigin(' https://api.example.com')).toBe(false)
    expect(isCanonicalOrigin('https://api.example.com\n')).toBe(false)
    expect(isCanonicalOrigin('not an origin')).toBe(false)
  })

  it('derives the origin of a call target', () => {
    expect(originOfUrl('https://api.example.com/v1/items?x=1')).toBe('https://api.example.com')
    expect(originOfUrl('https://api.example.com:443/v1')).toBe('https://api.example.com')
    expect(originOfUrl('https://api.example.com:8443/v1')).toBe('https://api.example.com:8443')
    expect(originOfUrl('http://api.example.com/v1')).toBeUndefined()
    expect(originOfUrl('https://user:x@api.example.com/v1')).toBeUndefined()
    expect(originOfUrl('relative/path')).toBeUndefined()
  })
})

describe('authentication header', () => {
  it('accepts an authentication header name', () => {
    expect(isAuthHeaderName(DEFAULT_AUTH_HEADER)).toBe(true)
    expect(isAuthHeaderName('X-Session-Key')).toBe(true)
  })

  it('refuses transport control and envelope headers', () => {
    for (const name of ['host', 'Host', 'content-length', 'connection', 'transfer-encoding', 'cookie', 'Set-Cookie', 'proxy-authorization']) {
      expect(isAuthHeaderName(name), name).toBe(false)
    }
    expect(isAuthHeaderName('Bad Header')).toBe(false)
    expect(isAuthHeaderName('Authorization\r\n')).toBe(false)
    expect(isAuthHeaderName('')).toBe(false)
  })

  it('takes the prefix verbatim, including its own separator', () => {
    expect(DEFAULT_AUTH_PREFIX).toBe('Bearer ')
    expect(isAuthPrefix('Bearer ')).toBe(true)
    expect(isAuthPrefix('')).toBe(true)
    expect(isAuthPrefix('Token ')).toBe(true)
    expect(isAuthPrefix('Bearer\n')).toBe(false)
    expect(isAuthPrefix('x'.repeat(65))).toBe(false)
  })
})

describe('pasted value', () => {
  it('accepts any non-empty bounded single-line value, short ones included', () => {
    expect(valueProblem('dummy-secret-value')).toBeUndefined()
    // No strength policy: masking covers every non-empty value, so a short
    // credential is stored like any other.
    expect(valueProblem('demo123')).toBeUndefined()
  })

  it('rejects an empty, padded, multi-line or oversized value', () => {
    expect(valueProblem('')).toBeDefined()
    expect(valueProblem('  padded')).toBeDefined()
    expect(valueProblem('line\nbreak')).toBeDefined()
    expect(valueProblem('nul\u0000byte')).toBeDefined()
    expect(valueProblem('a'.repeat(MAX_VALUE_LENGTH + 1))).toBeDefined()
    expect(valueProblem(42)).toBeDefined()
  })
})
