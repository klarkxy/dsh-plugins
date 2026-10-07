import { describe, expect, it } from 'vitest'
import { buildProbeReport, listModelFields, planFieldWrite } from './probe.ts'

const ROUTE_NODE = {
  type: 'object',
  properties: { provider: { type: 'string' }, model: { type: 'string' } },
}

describe('buildProbeReport', () => {
  it('collects only namespaces that expose model-route fields', () => {
    const report = buildProbeReport([
      { ns: 'plain-plugin', schema: { type: 'object', properties: { title: { type: 'string' } } }, value: {} },
      { ns: 'router-plugin', schema: { type: 'object', properties: { summary: ROUTE_NODE } }, value: { summary: { provider: 'a', model: 'b' } } },
    ])
    expect(report.totalNamespaces).toBe(2)
    expect(report.namespacesWithModelFields).toBe(1)
    expect(report.entries).toEqual([{
      ns: 'router-plugin',
      fields: [{ path: ['summary'], via: 'shape', current: { provider: 'a', model: 'b' } }],
    }])
    expect(report.selfTest.extraKey).toBe('absent')
    expect(report.selfTest.role).toBe('absent')
  })

  it('reports both self-test channels from the hub namespace', () => {
    const report = buildProbeReport([{
      ns: '@klarkxy/dsh-model-hub',
      schema: {
        type: 'object',
        properties: {
          selfTestMeta: { ...ROUTE_NODE, 'x-model-route': { purpose: 'self-test-meta' } },
          selfTestRole: { ...ROUTE_NODE },
        },
      },
      value: {},
    }])
    expect(report.selfTest.extraKey).toBe('marker')
    expect(report.selfTest.role).toBe('shape')
    expect(report.selfTest.ownSchema).toBeTruthy()
  })
})

describe('listModelFields', () => {
  it('carries the descriptor revision for write CAS', () => {
    const entries = listModelFields([
      { ns: 'plain-plugin', schema: { type: 'object' }, value: {}, revision: 3 },
      { ns: 'router-plugin', schema: { type: 'object', properties: { summary: ROUTE_NODE } }, value: { summary: { provider: 'a', model: 'b' } }, revision: 7 },
    ])
    expect(entries).toEqual([{
      ns: 'router-plugin',
      revision: 7,
      fields: [{ path: ['summary'], via: 'shape', current: { provider: 'a', model: 'b' } }],
    }])
  })
})

describe('planFieldWrite', () => {
  const entries = listModelFields([
    { ns: 'router-plugin', schema: { type: 'object', properties: { summary: ROUTE_NODE } }, value: {}, revision: 7 },
  ])

  it('sets a normalized concrete route with the descriptor revision', () => {
    expect(planFieldWrite(entries, { ns: 'router-plugin', path: ['summary'], route: { provider: ' p ', model: 'm', reasoningEffort: 'high' }, expectedRevision: 7 }))
      .toEqual({ ns: 'router-plugin', expectedRevision: 7, ops: [{ op: 'set', path: ['summary'], value: { provider: 'p', model: 'm', reasoningEffort: 'high' } }] })
  })

  it('unsets an empty route back to the schema default', () => {
    expect(planFieldWrite(entries, { ns: 'router-plugin', path: ['summary'], route: { provider: '', model: '' } }).ops)
      .toEqual([{ op: 'unset', path: ['summary'] }])
  })

  it('uses the fresh revision when omitted and rejects malformed revisions', () => {
    expect(planFieldWrite(entries, { ns: 'router-plugin', path: ['summary'], route: {} }).expectedRevision).toBe(7)
    for (const revision of [-1, 1.5, NaN, '7']) {
      expect(() => planFieldWrite(entries, { ns: 'router-plugin', path: ['summary'], route: {}, expectedRevision: revision })).toThrow('Invalid revision')
    }
  })

  it('refuses non-model keys, unknown namespaces and malformed references', () => {
    expect(() => planFieldWrite(entries, { ns: 'router-plugin', path: ['title'], route: {} })).toThrow(/Not a detected model field/)
    expect(() => planFieldWrite(entries, { ns: 'other', path: ['summary'], route: {} })).toThrow(/Not a detected model field/)
    expect(() => planFieldWrite(entries, { ns: '', path: ['summary'], route: {} })).toThrow(/Invalid field reference/)
    expect(() => planFieldWrite(entries, { ns: 'router-plugin', path: [], route: {} })).toThrow(/Invalid field reference/)
    expect(() => planFieldWrite(entries, null)).toThrow(/Invalid field reference/)
  })
})
