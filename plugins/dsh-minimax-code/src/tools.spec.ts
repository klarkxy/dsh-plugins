import { describe, expect, it, vi } from 'vitest'
import { CAPABILITIES } from './contracts.ts'
import { registerTools, renderResult, TOOL_SPECS } from './tools.ts'

describe('MiniMax host tool surface', () => {
  it('registers all supported capabilities plus recovery and job listing, without excluded features', () => {
    expect(TOOL_SPECS.map(spec => spec.operation)).toEqual([...CAPABILITIES, 'recover_media', 'media_jobs'])
    expect(new Set(TOOL_SPECS.map(spec => spec.name)).size).toBe(14)
    expect(TOOL_SPECS.some(spec => /understand_image|image_understand|music|twitter|search_x/.test(spec.name))).toBe(false)
    const register = vi.fn()
    registerTools({ tools: { register } } as any, { execute: vi.fn() }, Promise.resolve(), new AbortController().signal)
    expect(register.mock.calls.map(([tool]) => tool.name)).toEqual(TOOL_SPECS.map(spec => spec.name))
  })
  it('renders actual host image and file attachment blocks alongside saved paths and per-item failure details', () => {
    const image = { type: 'image', attachment: { attachmentId: 'image-id', mediaType: 'image/png', bytes: 10, width: 1, height: 1 } }
    const file = { type: 'file', attachment: { attachmentId: 'file-id', name: 'speech.mp3', bytes: 10 } }
    const blocks = renderResult({ status: 'partial', answer: 'Saved output', jobId: 'job', files: [{ path: 'image.png', kind: 'image', attachment: image }, { path: 'speech.mp3', kind: 'audio', attachment: file }] as any, items: [{ index: 1, status: 'failed', error: 'Provider failure' }] })
    expect(blocks.slice(1)).toEqual([image, file])
    expect(blocks[0]).toMatchObject({ type: 'text', text: expect.stringContaining('jobId: job; status: partial') })
    expect(blocks[0].text).toContain('image: image.png'); expect(blocks[0].text).toContain('Provider failure')
  })
  it('waits for host readiness and passes a combined lifetime signal to runtime execution', async () => {
    const registered: any[] = [], execute = vi.fn(async () => ({ status: 'complete', answer: 'ok', files: [] }))
    const lifetime = new AbortController(), caller = new AbortController()
    let ready!: () => void
    registerTools({ tools: { register: (tool: any) => registered.push(tool) } } as any, { execute }, new Promise(resolve => { ready = () => resolve(undefined) }), lifetime.signal)
    const result = registered[0].execute({ query: 'test' }, { signal: caller.signal })
    expect(execute).not.toHaveBeenCalled(); ready(); await result
    expect(execute.mock.calls[0]).toMatchObject(['search', { query: 'test' }, { signal: expect.any(AbortSignal) }])
    const combined = execute.mock.calls[0][2].signal
    expect(combined).not.toBe(caller.signal); lifetime.abort(); expect(combined.aborted).toBe(true)
  })
  it('does not execute a tool after unload even when readiness is still pending', async () => {
    const registered: any[] = [], execute = vi.fn(), lifetime = new AbortController()
    let ready!: () => void
    registerTools({ tools: { register: (tool: any) => registered.push(tool) } } as any, { execute }, new Promise(resolve => { ready = () => resolve(undefined) }), lifetime.signal)
    const result = registered[0].execute({ query: 'test' }, { signal: new AbortController().signal })
    const rejected = expect(result).rejects.toThrow(); lifetime.abort(); ready(); await rejected
    expect(execute).not.toHaveBeenCalled()
  })
})
