import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { mediaWorkspace, stageMedia, jobDirectory, confinedPath, publishMedia, MEDIA_LIMITS, type MediaHost, type MediaExec, type PublishedMedia } from '@klarkxy/dsh-plugin-kit/cli-media'
import { CAPABILITIES, MiniMaxCodeError, type Settings, type Status } from './contracts.ts'
import { MiniMaxCli, CONNECTORS, type ConnectorCapability } from './cli.ts'
import { jobSchema, type MediaJob, type JobStore } from './jobs.ts'
import { mapMediaRequest, parseRequest, type MediaOperation } from './media-requests.ts'
import { asset, assertBusinessSuccess, businessData, generationAssets, videoResult, videoTaskId, voiceCatalogue } from './results.ts'
import { downloadMedia } from './download.ts'

export type CapabilityResult = {
  status: string; answer: string; files: PublishedMedia[]; jobId?: string; taskId?: string;
  items?: { index: number; status: string; file?: string; error?: string }[]; data?: any;
}
export type RuntimeDeps = {
  cli?: (settings: Settings) => MiniMaxCli;
  download?: typeof downloadMedia;
  search?: { status(settings: Settings, signal: AbortSignal): Promise<boolean>; run(args: unknown, workspace: string, settings: Settings, signal: AbortSignal): Promise<CapabilityResult> };
}
const fail = (code: string, message: string) => new MiniMaxCodeError(code, message)
const message = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : 'The operation failed.'
const generation = new Set<MediaOperation>(['generate_image', 'generate_video', 'synthesize_speech', 'batch_speech'])
async function sha256(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) { signal.throwIfAborted(); hash.update(chunk) }
  return hash.digest('hex')
}

export class MiniMaxRuntime {
  private lifetime = new AbortController()
  private active = new Set<Promise<unknown>>()
  private busyJobs = new Set<string>()
  constructor(private host: MediaHost, private settings: () => Settings, private jobs: JobStore, private deps: RuntimeDeps = {}) {}
  private cli() { return (this.deps.cli ?? (settings => new MiniMaxCli(settings)))(this.settings()) }
  private track<T>(pending: Promise<T>): Promise<T> {
    this.active.add(pending)
    void pending.finally(() => this.active.delete(pending)).catch(() => {})
    return pending
  }
  status(signal: AbortSignal): Promise<Status> { return this.track(this.probeStatus(signal)) }
  private async probeStatus(signal: AbortSignal): Promise<Status> {
    const combined = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(60_000)])
    const capabilities: Status['capabilities'] = []
    let executable = '', version = '', authenticated: boolean | null = null, error: Status['error']
    const cli = this.cli()
    try {
      const status = await cli.status(combined)
      executable = status.executable; version = status.version; authenticated = status.authenticated
      if (!authenticated) throw fail('login-required', 'Sign in through the official MiniMax Code host.')
      for (const id of Object.keys(CONNECTORS) as ConnectorCapability[]) {
        try { await cli.schema(id, combined); capabilities.push({ id, available: true }) }
        catch (cause) { combined.throwIfAborted(); capabilities.push({ id, available: false, reason: message(cause) }) }
      }
    } catch (cause) {
      combined.throwIfAborted()
      error = { code: cause instanceof MiniMaxCodeError ? cause.code : 'unavailable', message: message(cause) }
      for (const id of Object.keys(CONNECTORS) as ConnectorCapability[]) capabilities.push({ id, available: false, reason: error.message })
    }
    try {
      const available = this.deps.search ? await this.deps.search.status(this.settings(), combined) : false
      capabilities.unshift({ id: 'search', available, ...(!available ? { reason: 'The search-only MiniMax CLI connection is unavailable.' } : {}) })
    } catch (cause) { combined.throwIfAborted(); capabilities.unshift({ id: 'search', available: false, reason: message(cause) }) }
    return { available: capabilities.some(capability => capability.available), executable, version, authenticated, capabilities, ...(error ? { error } : {}) }
  }
  execute(operation: MediaOperation | 'search', args: unknown, exec: MediaExec): Promise<CapabilityResult> {
    const settings = this.settings()
    const signal = AbortSignal.any([exec.signal, this.lifetime.signal, AbortSignal.timeout(settings.timeoutMs)])
    signal.throwIfAborted()
    return this.track(this.executeOwned(operation, args, { ...exec, signal }))
  }
  private async executeOwned(operation: MediaOperation | 'search', input: unknown, exec: MediaExec): Promise<CapabilityResult> {
    if (operation === 'search') {
      if (!this.deps.search) throw fail('search-unavailable', 'The official MiniMax search adapter is unavailable.')
      const root = await mediaWorkspace(this.host, exec, false)
      return this.deps.search.run(input, root, this.settings(), exec.signal)
    }
    const args = parseRequest(operation, input)
    const write = generation.has(operation) || operation === 'recover_media' || operation === 'video_status' || (operation === 'search_images' && args.download)
    const root = await mediaWorkspace(this.host, exec, write)
    if (operation === 'media_jobs') {
      const jobs = (await this.jobs.list(root)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)
      return { status: 'complete', answer: 'Saved MiniMax media jobs in this workspace. Recover or query an existing job; do not submit it again.', files: [], data: jobs.map(job => ({ jobId: job.id, operation: job.operation, status: job.status, createdAt: job.createdAt, ...(job.taskId ? { taskId: job.taskId } : {}) })) }
    }
    if (operation === 'video_status' || operation === 'recover_media') return this.recover(root, args.jobId, exec.signal, operation === 'video_status')
    const cli = this.cli(), stage = await mkdtemp(join(tmpdir(), 'dsh-minimax-media-'))
    let job: MediaJob | undefined, submitted = false
    try {
      const { wire, inputs } = mapMediaRequest(operation, args)
      const staged = await stageMedia(this.host, exec, root, stage, inputs.map(item => item.input))
      // Validate all local media before uploading any input or submitting paid work.
      for (let i = 0; i < staged.length; i++) {
        if (staged[i].bytes > 100 * 1024 * 1024) throw fail('invalid-media', 'MiniMax media uploads are limited to 100 MB.')
        if (operation === 'generate_video' && inputs[i].input.kind === 'audio' && staged[i].bytes > 15 * 1024 * 1024) throw fail('invalid-media', 'H3 reference audio is limited to 15 MB.')
        if (inputs[i].videoReference && staged[i].bytes > 50 * 1024 * 1024) throw fail('invalid-media', 'H3 reference video is limited to 50 MB.')
      }
      await cli.schema(operation as ConnectorCapability, exec.signal)
      for (let i = 0; i < staged.length; i++) {
        const uploaded = await cli.upload(staged[i].path, staged[i].mediaType, exec.signal, inputs[i].videoReference)
        inputs[i].assign(uploaded.url, uploaded.mimeType, uploaded.durationSeconds)
      }
      if (wire.reference_videos?.reduce((sum: number, video: any) => sum + video.duration_seconds, 0) > 15) throw fail('bad-request', 'H3 reference videos must total at most 15 seconds.')
      if (generation.has(operation) || (operation === 'search_images' && args.download)) {
        const { id } = await jobDirectory(root, 'dsh-minimax-code')
        const now = new Date().toISOString()
        job = { version: 1, id, workspace: root, operation, createdAt: now, updatedAt: now, status: 'prepared', assets: [], failures: [], ...(operation === 'generate_video' ? { model: args.model } : {}) }
        this.busyJobs.add(id)
        await this.jobs.put(job)
      }
      exec.signal.throwIfAborted()
      if (job) { job.status = 'submitting'; await this.save(job) }
      submitted = true
      const response = await cli.call(operation as ConnectorCapability, wire, exec.signal, stage)
      if (operation === 'generate_video') {
        const taskId = videoTaskId(response)
        if (taskId) { job!.taskId = taskId; await this.save(job!) }
        const result = videoResult(response)
        if (!result.taskId) throw fail('submission-uncertain', 'MiniMax did not return a video task ID. Do not submit again automatically.')
        job!.taskId = result.taskId; job!.status = result.status; await this.save(job!)
        if (result.status === 'failed') return this.jobResult(job!, [], 'MiniMax reported that this video task failed. It was not resubmitted.')
        // A video tool submits once; subsequent queries keep the same task and refresh its download URL.
        return this.jobResult(job!, [], 'Video submitted. Use minimax_video_status with this jobId until it completes. This does not submit another paid task.')
      }
      if (generation.has(operation)) {
        const kind = operation === 'generate_image' ? 'image' : 'audio', expected = operation === 'synthesize_speech' ? 1 : args.requests.length
        // Persist every valid returned asset before correlation or download, so partial results remain recoverable.
        const rawAssets = response?.node_id ? [response] : Array.isArray(response?.success_items) ? response.success_items : []
        job!.assets = rawAssets.flatMap((item: any, index: number) => { try { return [asset(item, index, kind)] } catch { return [] } })
        if (job!.assets.length) { job!.status = 'pending'; await this.save(job!) }
        const parsed = generationAssets(response, expected, kind)
        job!.assets = parsed.assets; job!.failures = parsed.failures; job!.status = 'pending'; await this.save(job!)
        const files = await this.downloadAssets(job!, stage, exec.signal)
        return this.jobResult(job!, files, !job!.failures.length && files.length === job!.assets.length ? 'Media saved.' : 'Some items could not be delivered. Existing results were preserved; recover this job to retry downloads only.')
      }
      assertBusinessSuccess(response)
      if (operation === 'search_images' && args.download) {
        const assets = collectSearchAssets(response).slice(0, args.limit)
        if (assets.length) {
          job!.assets = assets; job!.status = 'pending'; await this.save(job!)
          const files = await this.downloadAssets(job!, stage, exec.signal)
          return { ...this.jobResult(job!, files, 'Image search results and downloaded files.'), data: businessData(response) }
        }
        job!.status = 'complete'; await this.save(job!)
      }
      return { status: 'complete', answer: operation === 'list_voices' ? 'Available MiniMax voices.' : 'MiniMax result.', files: [], data: operation === 'list_voices' ? voiceCatalogue(response) : businessData(response), ...(job ? { jobId: job.id } : {}) }
    } catch (cause) {
      if (job) {
        if (!job.taskId && submitted && !job.assets.length) job.status = 'uncertain'
        else if (job.assets.length) job.status = 'download_failed'
        else if (!submitted) job.status = 'failed'
        job.error = message(cause); await this.save(job)
        if (!exec.signal.aborted) return this.jobResult(job, [], job.status === 'uncertain' ? 'Submission outcome is uncertain. Do not submit again automatically. Inspect this saved job.' : 'The job was saved. Query or recover it to retrieve existing output without repeating generation.')
      }
      throw cause
    } finally { if (job) this.busyJobs.delete(job.id); await rm(stage, { recursive: true, force: true }) }
  }
  private async save(job: MediaJob): Promise<void> { job.updatedAt = new Date().toISOString(); await this.jobs.put(jobSchema.parse(job)) }
  private async downloadAssets(job: MediaJob, stage: string, signal: AbortSignal, videoUrl?: string): Promise<PublishedMedia[]> {
    const { directory } = await jobDirectory(job.workspace, 'dsh-minimax-code', job.id)
    const files: PublishedMedia[] = [], cli = this.cli()
    for (const item of job.assets) {
      signal.throwIfAborted()
      try {
        let local: string | undefined
        if (item.localPath && item.sha256) {
          try { const path = await confinedPath(job.workspace, item.localPath); if (await sha256(path, signal) === item.sha256) local = path } catch { /* refresh the existing asset without regenerating */ }
        }
        if (!local) {
          const url = item.nodeId ? await cli.assetUrl(item.nodeId, signal) : item.sourceUrl ?? videoUrl
          if (!url) throw fail('download-failed', 'Query this video job to get a fresh download URL.')
          const name = item.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100)
          local = join(stage, `${randomUUID().slice(0, 8)}-${name}`)
          await (this.deps.download ?? downloadMedia)(url, local, MEDIA_LIMITS[item.kind], signal)
        }
        const published = await publishMedia(this.host, local, item.localPath && local === join(job.workspace, item.localPath) ? job.workspace : stage, directory, job.workspace, item.kind, signal)
        item.localPath = published.path; item.sha256 = await sha256(join(job.workspace, published.path), signal); delete item.error
        files.push(published); await this.save(job)
      } catch (cause) {
        item.error = message(cause); await this.save(job)
        signal.throwIfAborted()
      }
    }
    const errors = job.assets.filter(item => item.error).length
    job.status = errors ? files.length ? 'partial' : 'download_failed' : job.failures.length ? 'partial' : 'complete'
    await this.save(job)
    return files
  }
  private async recover(root: string, id: string, signal: AbortSignal, videoOnly: boolean): Promise<CapabilityResult> {
    if (this.busyJobs.has(id)) throw fail('busy', 'This media job is already being queried or downloaded.')
    this.busyJobs.add(id)
    let stage: string | undefined
    try {
      stage = await mkdtemp(join(tmpdir(), 'dsh-minimax-recover-'))
      const value = await this.jobs.get(id)
      if (!value) throw fail('unknown-job', 'This media job was not found.')
      const job = jobSchema.parse(value)
      if (job.workspace !== root) throw fail('unknown-job', 'This job belongs to another workspace.')
      let url: string | undefined
      if (job.operation === 'generate_video') {
        if (!job.taskId || !job.model) return this.jobResult(job, [], 'The video submission has no confirmed task ID. No replacement task was submitted.')
        const result = videoResult(await this.cli().call('video_status', { task_id: job.taskId, model: job.model }, signal, stage))
        job.status = result.status; url = result.url; delete job.error
        if (result.status === 'complete') job.assets = job.assets.length ? job.assets : [{ index: 0, kind: 'video', name: 'video.mp4' }]
        await this.save(job)
        if (result.status !== 'complete') return this.jobResult(job, [], result.status === 'pending' ? 'The video is still processing. Query this same job again later.' : 'MiniMax reported that the video task failed or was cancelled.')
      } else if (videoOnly) throw fail('bad-request', 'This is not a video job. Use minimax_recover_media.')
      if (!job.assets.length) return this.jobResult(job, [], 'No generated assets are recorded for this job. No generation was retried.')
      return this.jobResult(job, await this.downloadAssets(job, stage, signal, url), 'Recovered existing media. No generation request was submitted.')
    } finally { this.busyJobs.delete(id); if (stage) await rm(stage, { recursive: true, force: true }) }
  }
  private jobResult(job: MediaJob, files: PublishedMedia[], answer: string): CapabilityResult {
    return { status: job.status, answer, jobId: job.id, ...(job.taskId ? { taskId: job.taskId } : {}), files,
      items: [...job.assets.map(item => ({ index: item.index, status: item.error ? 'download_failed' : item.localPath ? 'complete' : 'pending', ...(item.localPath ? { file: item.localPath } : {}), ...(item.error ? { error: item.error } : {}) })), ...job.failures.map(item => ({ ...item, status: 'failed' }))].sort((a, b) => a.index - b.index),
      ...(job.error ? { data: { error: job.error } } : {}) }
  }
  async dispose(): Promise<void> { this.lifetime.abort(); await Promise.allSettled([...this.active]) }
}

function collectSearchAssets(value: unknown): MediaJob['assets'] {
  const found: MediaJob['assets'] = [], seen = new Set<string>()
  const visit = (item: any, depth: number) => {
    if (!item || depth > 8 || found.length >= 50) return
    if (Array.isArray(item)) { item.slice(0, 100).forEach(child => visit(child, depth + 1)); return }
    if (typeof item !== 'object') return
    if (typeof item.node_id === 'string' && !seen.has(item.node_id)) {
      try { found.push(asset(item, found.length, 'image')); seen.add(item.node_id) } catch { /* not an asset row */ }
    }
    if (typeof item.image_url === 'string' && !seen.has(item.image_url)) {
      try {
        const url = new URL(item.image_url)
        if (url.protocol === 'https:' && !url.username && !url.password && businessData(url.href) === url.href) {
          const extension = /\.(png|jpe?g|webp|gif)$/i.exec(url.pathname)?.[1] ?? 'bin'
          found.push({ index: found.length, kind: 'image', name: `search-${found.length}.${extension}`, sourceUrl: url.href }); seen.add(url.href)
        }
      } catch { /* not an image URL */ }
    }
    Object.values(item).forEach(child => visit(child, depth + 1))
  }
  visit(value, 0)
  return found
}
