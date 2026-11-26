import { createHash } from 'node:crypto'

export const ZHIHU_RESPONSE_CACHE_TTL_MS: Record<string, number> = {
  '/api/v1/content/hot_list': 300_000,
  '/api/v1/content/zhihu_search': 600_000,
  '/api/v1/content/global_search': 600_000,
  '/api/v1/content/question_answers': 600_000,
}
export const ZHIHU_RESPONSE_CACHE_MAX_ENTRIES = 200

function deepCopy<T>(value: T): T {
  return structuredClone(value)
}

export function zhihuResponseCacheKey(accessSecret: string, path: string, params: Record<string, string>, envelope: boolean): string {
  const pairs = Object.entries(params).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  const digest = createHash('sha256').update(accessSecret, 'utf8').digest('hex').slice(0, 16)
  return `${digest}|${path}|${envelope ? 'envelope' : 'raw'}|${JSON.stringify(pairs)}`
}

/** Small in-process LRU for successful GET responses. */
export class ZhihuResponseCache {
  private readonly entries = new Map<string, { expires: number; value: unknown }>()

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxEntries = ZHIHU_RESPONSE_CACHE_MAX_ENTRIES,
  ) {}

  get(key: string): unknown {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (this.now() >= entry.expires) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return deepCopy(entry.value)
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.entries.delete(key)
    this.entries.set(key, { expires: this.now() + ttlMs, value: deepCopy(value) })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}
