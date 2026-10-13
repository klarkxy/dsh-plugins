import { Ajv } from 'ajv'
import { describe, expect, it } from 'vitest'
import { asset, assertBusinessSuccess, businessData, generationAssets, videoResult, voiceCatalogue } from './results.ts'
import speechSchema from './fixtures/batch-speech.schema.json'

describe('batch media result correlation', () => {
  it('keeps the observed 327-voice catalogue complete and marks the hard safety cap explicitly', () => {
    const voices = Array.from({ length: 327 }, (_, index) => ({ voice_id: `voice-${index}`, voice_name: `Voice ${index}`, sample_url: 'https://media.example/?token=hidden' }))
    const result = voiceCatalogue({ code: 0, available_voices: voices })
    expect(result.available_voices).toHaveLength(327)
    expect(result).toMatchObject({ total: 327, truncated: false })
    expect(result.available_voices[326]).toEqual({ voice_id: 'voice-326', voice_name: 'Voice 326' })
    expect(JSON.stringify(result)).not.toContain('hidden')
    expect(voiceCatalogue({ code: 0, available_voices: Array(1001).fill(voices[0]) })).toMatchObject({ total: 1001, truncated: true })
  })
  it('preserves out-of-order successes and an indexed failure in the observed batch TTS shape', () => {
    const response = { code: 0, message: 'partial success', total_requested: 3, total_success: 2, total_failed: 1, success_items: [{ node_id: 'node-2', file_name: 'item-2.mp3' }, { node_id: 'node-0', file_name: 'item-0.mp3' }], failed_items: [{ index: 1, err_code: 1008, error_msg: 'synthesis failed' }] }
    expect(new Ajv({ strict: false }).compile(speechSchema.output_schema!)(response)).toBe(true)
    expect(generationAssets(response, 3, 'audio')).toEqual({ assets: [{ index: 2, kind: 'audio', name: 'item-2.mp3', nodeId: 'node-2' }, { index: 0, kind: 'audio', name: 'item-0.mp3', nodeId: 'node-0' }], failures: [{ index: 1, error: 'MiniMax generation failed (code 1008).' }] })
  })
  it.each([
    { success_items: [{ node_id: 'node', file_name: 'unknown.mp3' }] },
    { success_items: [{ node_id: 'node', file_name: 'item-0.mp3' }, { node_id: 'other', file_name: 'item-0.mp3' }] },
    { success_items: [{ node_id: 'node', file_name: 'item-0.mp3' }], failed_items: [{ index: 0, err_code: 1 }] },
  ])('rejects ambiguous correlation rather than assigning a paid result to the wrong item %#', response => {
    expect(() => generationAssets(response, 2, 'audio')).toThrow(expect.objectContaining({ code: 'unmatched-batch' }))
  })
  it('rejects missing rows and out-of-range failure indices', () => {
    expect(() => generationAssets({ success_items: [{ node_id: 'node', file_name: 'item-0.mp3' }] }, 2, 'audio')).toThrow(expect.objectContaining({ code: 'invalid-output' }))
    expect(() => generationAssets({ success_items: [], failed_items: [{ index: 2, err_code: 1 }] }, 2, 'audio')).toThrow(expect.objectContaining({ code: 'invalid-output' }))
  })
  it('reports a provider business rejection while allowing explicitly returned partial assets', () => {
    expect(() => assertBusinessSuccess({ base_resp: { status_code: 1008 } })).toThrow(expect.objectContaining({ code: 'provider-failed' }))
    expect(generationAssets({ code: 1, success_items: [{ node_id: 'ok', file_name: 'item-0.mp3' }], failed_items: [{ index: 1, err_code: 1 }] }, 2, 'audio').assets).toHaveLength(1)
  })
  it('refuses unsafe node identifiers and prevents returned filenames from carrying directory paths', () => {
    expect(() => asset({ node_id: '../secret' }, 0, 'audio')).toThrow(expect.objectContaining({ code: 'invalid-output' }))
    expect(asset({ node_id: 'valid', file_name: '../../secret.mp3' }, 0, 'audio').name).toBe('item-0.mp3')
  })
})

describe('video receipts and public data', () => {
  it('recognizes queued, successful and failed task envelopes', () => {
    expect(videoResult({ code: 0, task_id: 'task-1', model: 'MiniMax-H3-Max', status: 'submitted' })).toEqual({ taskId: 'task-1', status: 'pending' })
    expect(videoResult({ data: { task_id: 'task-1', status: 'Running' } })).toEqual({ taskId: 'task-1', status: 'pending' })
    expect(videoResult({ task_id: 'task-1', status: 'Succeeded', video_url: 'https://media.example/video' })).toEqual({ taskId: 'task-1', status: 'complete', url: 'https://media.example/video' })
    expect(videoResult({ data: { task_id: 'task-1', status: 'Cancelled' } })).toEqual({ taskId: 'task-1', status: 'failed' })
  })
  it.each([{ status: 'succeeded' }, { status: 'unexpected' }])('refuses an unusable video result %#', value => {
    expect(() => videoResult(value)).toThrow(expect.objectContaining({ code: 'invalid-output' }))
  })
  it('removes credential and signed-media fields recursively while retaining source links and public content', () => {
    expect(businessData({ title: 'Public', source: 'https://example.com/page', token: 'hidden', nested: { headers: {}, download_url: 'hidden', values: ['https://media.example/a?token=secret', 'hello'] } })).toEqual({ title: 'Public', source: 'https://example.com/page', nested: { values: ['[temporary media URL]', 'hello'] } })
  })
  it.each(['x-oss-credential', 'x-oss-date', 'x-oss-expires', 'x-oss-signature'])('redacts synthetic OSS signed source URLs carrying %s while preserving understanding content', key => {
    const value = businessData({ results: [{ source: `https://media.example/audio.mp3?${key}=PRIVATE_URL_SENTINEL`, description: 'Spoken audio description.', nested: { authorization: 'PRIVATE_AUTH_SENTINEL', token: 'PRIVATE_TOKEN_SENTINEL' } }] })
    expect(value).toEqual({ results: [{ source: '[temporary media URL]', description: 'Spoken audio description.', nested: {} }] })
    expect(JSON.stringify(value)).not.toContain('PRIVATE_')
  })
})
