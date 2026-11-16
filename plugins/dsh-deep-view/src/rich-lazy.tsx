import { lazy, Suspense } from 'react'
import type { RichNodeProps } from './rich-types.ts'
import { english } from './ui.tsx'

// Load heavy third-party runtimes only when the model actually uses them.
// This also keeps ordinary form/Markdown DOM initialization independent.
const MathView = lazy(() => import('./math.tsx').then(module => ({ default: module.MathView })))
const FlowView = lazy(() => import('./flow.tsx').then(module => ({ default: module.FlowView })))
const ExploreView = lazy(() => import('./explore.tsx').then(module => ({ default: module.ExploreView })))
const MapView = lazy(() => import('./map.tsx').then(module => ({ default: module.MapView })))

export function RichNode(props: RichNodeProps & { editable?: boolean }) {
  const { node, t = english } = props
  const Component = node.type === 'math' ? MathView : node.type === 'flow' ? FlowView : node.type === 'explore' ? ExploreView : node.type === 'map' ? MapView : null
  if (!Component) return null
  return <Suspense fallback={<div className="dvui-tool-loading" role="status">{t('Composing interface…')}</div>}>
    <Component {...props} />
  </Suspense>
}
