import { describe, expect, it } from 'vitest'
import { isLoopbackHost, normalizeGatewayAddress } from './address.ts'

describe('normalizeGatewayAddress', () => {
  it('accepts loopback and LAN forms', () => {
    expect(normalizeGatewayAddress('http://127.0.0.1:3425')).toEqual({ root: 'http://127.0.0.1:3425', loopback: true })
    expect(normalizeGatewayAddress('192.168.1.5:3425')).toEqual({ root: 'http://192.168.1.5:3425', loopback: false })
    expect(normalizeGatewayAddress('https://gw.example.com')).toEqual({ root: 'https://gw.example.com', loopback: false })
    expect(normalizeGatewayAddress('  localhost:3425  ')).toEqual({ root: 'http://localhost:3425', loopback: true })
    expect(normalizeGatewayAddress('http://[::1]:3425')).toEqual({ root: 'http://[::1]:3425', loopback: true })
  })

  it('strips trailing slashes and a trailing /v1', () => {
    expect(normalizeGatewayAddress('http://127.0.0.1:3425/').root).toBe('http://127.0.0.1:3425')
    expect(normalizeGatewayAddress('http://127.0.0.1:3425/v1').root).toBe('http://127.0.0.1:3425')
    expect(normalizeGatewayAddress('http://127.0.0.1:3425/v1/').root).toBe('http://127.0.0.1:3425')
    expect(normalizeGatewayAddress('https://gw.example.com/proxy/v1').root).toBe('https://gw.example.com/proxy')
    expect(normalizeGatewayAddress('https://gw.example.com/proxy').root).toBe('https://gw.example.com/proxy')
  })

  it('rejects unsupported input', () => {
    for (const input of ['', 'ftp://gw.example.com', 'http://u:p@127.0.0.1:3425', 'http://127.0.0.1:3425/?x=1', 'http://127.0.0.1:3425/#frag', 'http://']) {
      expect(() => normalizeGatewayAddress(input), input).toThrow()
    }
  })
})

describe('isLoopbackHost', () => {
  it('covers 127.0.0.0/8, ::1, and localhost', () => {
    for (const host of ['127.0.0.1', '127.10.20.30', '::1', '[::1]', 'localhost']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
    for (const host of ['128.0.0.1', '192.168.1.5', 'example.com', '::2']) {
      expect(isLoopbackHost(host), host).toBe(false)
    }
  })
})
