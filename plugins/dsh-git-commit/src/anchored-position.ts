import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

/**
 * Local replacement for the host's useAnchoredPosition primitive, which was
 * removed from @deepseek-ai/dsh-client-ui-primitives after 0.2.2-rc.1. Same
 * contract: absolute-placement coordinates for the panel, or null until the
 * first measurement. Flips to the side with more room, clamps into the
 * viewport margin, and re-measures on resize and scroll while open.
 */
export function useAnchoredPosition(options: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLElement | null>
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
  gap: number
  margin: number
}): CSSProperties | null {
  const { open, anchorRef, panelRef, side = 'bottom', align = 'start', gap, margin } = options
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const frame = useRef(0)

  const measure = () => {
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor) return
    const anchorRect = anchor.getBoundingClientRect()
    const panelWidth = panel?.offsetWidth ?? 0
    const panelHeight = panel?.offsetHeight ?? 0
    const preferTop = side === 'top' || anchorRect.bottom + gap + panelHeight > window.innerHeight - margin
    const top = preferTop
      ? Math.max(margin, anchorRect.top - gap - panelHeight)
      : Math.min(anchorRect.bottom + gap, window.innerHeight - margin - panelHeight)
    const anchorStart = align === 'end' ? anchorRect.right - panelWidth : anchorRect.left
    const left = Math.min(Math.max(anchorStart, margin), Math.max(margin, window.innerWidth - margin - panelWidth))
    setPosition({ left, top })
  }

  const schedule = () => {
    if (typeof requestAnimationFrame !== 'function') { measure(); return }
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(measure)
  }

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    measure()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      if (frame.current && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [open, anchorRef, panelRef, side, align, gap, margin])

  useEffect(() => () => { if (frame.current && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current) }, [])

  return position
}
