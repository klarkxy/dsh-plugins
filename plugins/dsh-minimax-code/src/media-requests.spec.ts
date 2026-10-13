import { Ajv } from 'ajv'
import { describe, expect, it } from 'vitest'
import { mapMediaRequest, parseRequest } from './media-requests.ts'
import imageSchema from './fixtures/generate-image.schema.json'
import speechSchema from './fixtures/batch-speech.schema.json'
import videoSchema from './fixtures/video.schema.json'

const image = { path: 'frame.png' }, audio = { path: 'voice.mp3' }, video = { path: 'clip.mp4' }
const base = { prompt: 'Wind in the trees', model: 'MiniMax-H3', duration: 6 }

describe('video model and mode validation', () => {
  it.each([
    { ...base, duration: 4, resolution: '2K', aspectRatio: '16:9' },
    { ...base, inputImage: image, lastFrame: image, referenceType: 'first_frame', aspectRatio: 'adaptive' },
    { ...base, referenceImages: [image], referenceVideos: [video], referenceAudios: [audio] },
    { ...base, model: 'MiniMax-H3-Max', duration: 5, resolution: '480P' },
    { ...base, model: 'MiniMax-H3-Max', duration: 15, resolution: '768P', inputImage: image, lastFrame: image },
    { ...base, model: 'MiniMax-Hailuo-2.3', duration: 10, resolution: '768P' },
    { ...base, model: 'MiniMax-Hailuo-2.3', duration: 6, resolution: '1080P', inputImage: image, referenceType: 'subject' },
  ])('accepts supported options %#', args => { expect(parseRequest('generate_video', args)).toMatchObject(args) })

  it.each([
    { ...base, model: undefined }, { ...base, duration: 3 }, { ...base, prompt: 'x'.repeat(7001) },
    { ...base, resolution: '1080P' }, { ...base, referenceType: 'subject', inputImage: image },
    { ...base, lastFrame: image }, { ...base, referenceType: 'last_frame' },
    { ...base, inputImage: image, aspectRatio: '16:9' }, { ...base, aspectRatio: 'adaptive' },
    { ...base, inputImage: image, referenceImages: [image] }, { ...base, referenceAudios: [audio] },
    { ...base, referenceImages: Array(9).fill(image), referenceVideos: Array(3).fill(video), referenceAudios: [audio] },
    { ...base, model: 'MiniMax-H3-Max', duration: 4 }, { ...base, model: 'MiniMax-H3-Max', resolution: '2K' },
    { ...base, model: 'MiniMax-H3-Max', referenceImages: [image] },
    { ...base, model: 'MiniMax-Hailuo-2.3', duration: 8 }, { ...base, model: 'MiniMax-Hailuo-2.3', duration: 10, resolution: '1080P' },
    { ...base, model: 'MiniMax-Hailuo-2.3', aspectRatio: '16:9' }, { ...base, model: 'MiniMax-Hailuo-2.3', lastFrame: image, inputImage: image },
    { ...base, model: 'MiniMax-Hailuo-2.3', referenceImages: [image] },
    { ...base, model: 'MiniMax-Hailuo-2.3', duration: 10, inputImage: image, referenceType: 'subject' },
  ])('rejects unsupported options %# before media work', args => {
    expect(() => parseRequest('generate_video', args)).toThrow(expect.objectContaining({ code: 'bad-request' }))
  })
})

describe('public requests map to the observed vendor schemas', () => {
  it.each([
    ['generate_image', { requests: [{ prompt: 'tree', images: [image], aspectRatio: '16:9', resolution: '2K' }] }, imageSchema],
    ['batch_speech', { requests: [{ text: 'hello', voiceId: 'voice-1', speed: 0.5, volume: 0, pitch: -12, emotion: 'neutral' }] }, speechSchema],
    ['generate_video', { ...base, inputImage: image, lastFrame: image, aspectRatio: 'adaptive' }, videoSchema],
    ['generate_video', { ...base, referenceImages: [image], referenceVideos: [video], referenceAudios: [audio] }, videoSchema],
  ] as const)('maps %s to schema-compatible wire data %#', (operation, args, schema) => {
    const mapped = mapMediaRequest(operation, parseRequest(operation, args))
    mapped.inputs.forEach((input, index) => input.assign(`https://media.example/input-${index}`, `${input.input.kind}/${input.input.kind === 'image' ? 'png' : input.input.kind === 'audio' ? 'mpeg' : 'mp4'}`, input.videoReference ? 7 : undefined))
    const validate = new Ajv({ strict: false }).compile(schema.input_schema)
    expect(validate(mapped.wire), JSON.stringify(validate.errors)).toBe(true)
    expect(JSON.stringify(mapped.wire)).not.toContain('frame.png')
    expect(JSON.stringify(mapped.wire)).not.toContain('voice.mp3')
    expect(JSON.stringify(mapped.wire)).not.toContain('clip.mp4')
  })

  it('keeps positional output names and zero-valued speech controls for partial correlation', () => {
    expect(mapMediaRequest('batch_speech', parseRequest('batch_speech', { requests: [{ text: 'first', volume: 0, pitch: 0 }, { text: 'second' }] })).wire).toEqual({ requests: [{ text: 'first', output_file: 'item-0.mp3', volume: 0, pitch: 0 }, { text: 'second', output_file: 'item-1.mp3' }] })
  })
  it.each([{}, { path: 'a.wav', attachmentId: 'same' }, { path: 'a.wav', url: 'https://foreign.example/a' }])('refuses ambiguous or extra media input fields %#', audio => {
    expect(() => parseRequest('transcribe_audio', { audio })).toThrow(expect.objectContaining({ code: 'bad-request' }))
  })
})
