// Migrated from deep-view/src/react/ui.js (Apache-2.0).
// Small, host-neutral labels and SVG controls; no private color tokens.
import type { ReactNode } from 'react'
export type ViewT = (key: string, params?: Record<string, unknown>) => string
export const english: ViewT = (key, params) => key.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))

export function LineIcon({ paths }: { paths: string[] }) {
  return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths.map((d, index) => <path key={index} d={d} />)}</svg>
}
export const DotsIcon = () => <LineIcon paths={['M5 10h.01M10 10h.01M15 10h.01']} />
export const CheckIcon = () => <LineIcon paths={['M4.5 10.5l3.5 3.5 7.5-8']} />
export const CopyIcon = () => <LineIcon paths={['M8.5 7h6A1.5 1.5 0 0 1 16 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 7 14.5v-6A1.5 1.5 0 0 1 8.5 7z', 'M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4H13']} />
export const TableIcon = () => <LineIcon paths={['M4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9A1.5 1.5 0 0 1 4.5 4z', 'M3 8.5h14M8 8.5V16']} />
export const InfoIcon = () => <LineIcon paths={['M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'M10 9.25v4', 'M10 6.6h.01']} />
export const LinkIcon = () => <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8.5 11.5l3-3" /><path d="M7 9.5L5.5 11a2.5 2.5 0 0 0 3.5 3.5L10.5 13" /><path d="M13 10.5l1.5-1.5A2.5 2.5 0 0 0 11 5.5L9.5 7" /></svg>
export const keyLetter = (index: number) => String.fromCharCode(65 + index)
export function Segmented({ label, value, className, children }: { label: string; value: number; className?: string; children: ReactNode }) {
  return <div className={className ? `dvui-seg ${className}` : 'dvui-seg'} role="group" aria-label={label} data-active={value}>{children}</div>
}
