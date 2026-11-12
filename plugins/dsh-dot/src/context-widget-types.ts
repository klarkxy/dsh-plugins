/*
 * Adapted from dsh-context v0.82.2 (Apache-2.0), bowenliang123.
 * Source: https://github.com/bowenliang123/dsh-context/tree/432c5cbb9911778de070f34b297ca4d982106048
 */
export interface PartsPart {
  key: string
  color: string
  value: number
  raw?: number
  label?: string
  group?: string
}

export interface ContextReserve {
  threshold: number
  headroom: number
  output: number
}

export interface Headline {
  tokens: number
  window?: number
  pct: number | null
  parts: PartsPart[]
  reserve?: ContextReserve
}

export interface ViewKit {
  t: (key: string, params?: Record<string, string | number>) => string
  fmt: (value: number) => string
  fmtShare: (value: number, total: number) => string
  catLabel: (key: string) => string
}
