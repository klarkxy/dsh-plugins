/*
 * Adapted from dsh-context v0.82.2 (Apache-2.0), bowenliang123.
 * Source: https://github.com/bowenliang123/dsh-context/tree/432c5cbb9911778de070f34b297ca4d982106048
 */
import { type ReactElement } from 'react'
import type { Headline, ViewKit } from './context-widget-types.ts'
import { IconGauge } from './context-icons.ts'
import type { StackedBarProps, LegendProps } from './context-stacked-bar.tsx'

type LegendFn = (props: LegendProps) => ReactElement

export interface CurrentCompositionProps {
  head: Headline
  subtitle?: string
  hoverKey?: string | null
  onHoverKey?: (key: string | null) => void
}

export function makeCurrentComposition(
  kit: ViewKit,
  StackedBar: (props: StackedBarProps) => ReactElement,
  Legend: LegendFn,
): (props: CurrentCompositionProps) => ReactElement {
  const { t, fmt } = kit
  return function CurrentComposition(props: CurrentCompositionProps): ReactElement {
    const head = props.head
    return (
      <div className="lc-card" data-lc-current>
        <div className="lc-card-title">
          <span className="lc-card-title-text">
            <IconGauge size={14} />
            {t('overview.title')}
          </span>
          {props.subtitle !== undefined && props.subtitle !== ''
            ? <span className="lc-card-sub">{props.subtitle}</span>
            : null}
        </div>
        <div className="lc-overview-num">
          <b>{fmt(head.tokens)}</b>
          <span>
            {head.window
              ? ' / ' + fmt(head.window) + ' tokens'
              : ' ' + t('overview.estimate')}
          </span>
          {head.pct !== null ? (
            <span className="lc-overview-pct">
              <b>{`${head.pct.toFixed(1)}%`}</b>
              {t('overview.used')}
            </span>
          ) : null}
        </div>
        <StackedBar
          parts={head.parts}
          height={16}
          max={head.window}
          hoverKey={props.hoverKey}
          onHoverKey={props.onHoverKey}
          reserve={head.reserve}
        />
        <Legend parts={head.parts} hoverKey={props.hoverKey} onHoverKey={props.onHoverKey} />
      </div>
    )
  }
}
