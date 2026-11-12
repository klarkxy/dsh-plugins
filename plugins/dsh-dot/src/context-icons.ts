/*
 * Adapted from dsh-context v0.82.2 (Apache-2.0), bowenliang123.
 * Source: https://github.com/bowenliang123/dsh-context/tree/432c5cbb9911778de070f34b297ca4d982106048
 */
import type { ReactElement } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

type IconComponent = (props: IconProps) => ReactElement | null
const ns = primitives as unknown as Record<string, unknown>
function resolveIcon(name: string): IconComponent {
  let found: unknown
  try { found = ns[name] } catch { found = undefined }
  return typeof found === 'function' ? found as IconComponent : () => null
}

export const IconDatabase = resolveIcon('IconDatabaseOutlineRegular')
export const IconGauge = resolveIcon('IconGaugeOutlineRegular')
