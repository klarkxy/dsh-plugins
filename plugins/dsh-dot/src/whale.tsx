/**
 * Dorothy's look: DeepSeek's whale in pink, the way a pal species has a second
 * colour variant. She is mirrored so she faces the DeepSeek logo at the top of the
 * sidebar instead of repeating it. The sidebar glyph turns pink when her panel is
 * open; the chat avatar adds the orca's white belly and eye patch, a dark eye and
 * a blush, on a translucent pink badge that reads on light and dark themes.
 */
import { FISH_LOGO_PATH } from '@deepseek-ai/dsh-client-ui-primitives'

/** Dorothy's pink, used only inside her own artwork. */
export const DOT_PINK = '#E85D9B'
const BLUSH = '#FFB0CF'
const EYE = '#3B2230'

// The official path is four subpaths: outline, belly, eye, eye patch.
const PARTS = FISH_LOGO_PATH.split(/(?=M)/)
const BELLY = PARTS[1]
const PATCH = PARTS[3]
/** Mirror inside the 23.16-wide logo box so the whale faces right. */
const MIRROR = 'matrix(-1 0 0 1 23.16 0)'

/** Sidebar glyph: the official silhouette; follows the theme colour, pink while active. */
export function DotIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size * 17.04 / 23.16} viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true">
      <path d={FISH_LOGO_PATH} transform={MIRROR} fill={active ? DOT_PINK : 'currentColor'} />
    </svg>
  )
}

/** Chat avatar: pink orca on a translucent pink badge. */
export function DotAvatar({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-1.4 -4.4 26 26" fill="none" aria-hidden="true">
      <circle cx="11.6" cy="8.6" r="13" fill={DOT_PINK} fillOpacity=".2" />
      <g transform={MIRROR}>
        <path d={FISH_LOGO_PATH} fill={DOT_PINK} />
        {BELLY ? <path d={BELLY} fill="#FFFFFF" /> : null}
        {PATCH ? <path d={PATCH} fill="#FFFFFF" /> : null}
        <circle cx="12.44" cy="8.27" r=".66" fill={EYE} />
        <circle cx="12.24" cy="8.05" r=".21" fill="#FFFFFF" />
        <ellipse cx="11" cy="10.35" rx="1" ry=".55" fill={BLUSH} opacity=".9" />
      </g>
    </svg>
  )
}
