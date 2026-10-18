import { describe, expect, it, vi } from 'vitest'
import { createProbeDiagnostics } from './diagnostics.ts'

describe('on-demand probe diagnostics', () => {
  it('coalesces requests and keeps invalidation free of scans and writes', async () => {
    vi.useFakeTimers()
    try {
      const run = vi.fn().mockResolvedValue(undefined)
      const probe = createProbeDiagnostics(run, vi.fn())
      for (let i = 0; i < 100; i++) { probe.invalidate(); probe.request() }
      expect(run).not.toHaveBeenCalled()
      await vi.runAllTimersAsync()
      expect(run).toHaveBeenCalledTimes(1)
      for (let i = 0; i < 100; i++) probe.invalidate()
      await vi.runAllTimersAsync()
      expect(run).toHaveBeenCalledTimes(1)
      probe.request()
      await vi.runAllTimersAsync()
      expect(run).toHaveBeenCalledTimes(2)
      await probe.dispose()
    } finally { vi.useRealTimers() }
  })

  it('does not recursively run on invalidation during work and awaits unloading', async () => {
    vi.useFakeTimers()
    try {
      let finish!: () => void
      const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
      const probe = createProbeDiagnostics(run, vi.fn())
      probe.request()
      await vi.advanceTimersByTimeAsync(0)
      probe.invalidate(); probe.request()
      let disposed = false
      const draining = probe.dispose().then(() => { disposed = true })
      await Promise.resolve()
      expect(disposed).toBe(false)
      finish(); await draining
      probe.invalidate(); probe.request()
      await vi.runAllTimersAsync()
      expect(run).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('cancels queued work and reports rejected work once', async () => {
    vi.useFakeTimers()
    try {
      const run = vi.fn().mockRejectedValue(new Error('write failed')), error = vi.fn()
      const cancelled = createProbeDiagnostics(run, error)
      cancelled.request(); await cancelled.dispose(); await vi.runAllTimersAsync()
      expect(run).not.toHaveBeenCalled()
      const probe = createProbeDiagnostics(run, error)
      probe.request(); await vi.runAllTimersAsync(); await probe.dispose()
      expect(error).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
})
