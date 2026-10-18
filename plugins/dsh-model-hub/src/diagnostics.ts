/** Invalidation is constant-time. Only startup and explicit reads request a
 * diagnostic; a burst shares one deferred run. Work never reschedules itself. */
export function createProbeDiagnostics(run: () => Promise<void>, onError: (error: unknown) => void) {
  let dirty = true
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined
  return {
    invalidate() { if (!stopped) dirty = true },
    request() {
      if (stopped || !dirty || timer !== undefined || running) return
      timer = setTimeout(() => {
        timer = undefined
        if (stopped || !dirty) return
        dirty = false
        running = Promise.resolve().then(run).catch(onError).finally(() => { running = undefined })
      }, 0)
    },
    async dispose() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      await running
    },
  }
}
