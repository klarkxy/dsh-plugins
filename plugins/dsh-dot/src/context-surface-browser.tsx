/** Current-context item browser; intentionally has no step history or comparison. */
import { useMemo, useState } from 'react'
import type { DotContextCategory, DotContextNode, DotContextSurface } from './contracts.ts'
import { IconDatabase } from './context-icons.ts'
import { formatTokens, t, type CopyLocale } from './ui-copy.ts'

export const SURFACE_CATEGORIES: readonly DotContextCategory[] = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool']
export const SURFACE_COLORS: Record<DotContextCategory, string> = {
  system: 'var(--dsw-alias-brand-primary)',
  tools: 'var(--dsw-alias-state-warn-primary)',
  user: 'var(--dsw-alias-state-success-primary)',
  inject: 'var(--dsw-alias-state-business-primary)',
  skill: 'var(--dsw-alias-state-error-primary)',
  assistant: 'var(--dsw-alias-label-secondary)',
  tool: 'var(--dsw-alias-state-idle-primary)',
}

const CATEGORY_KEYS: Record<DotContextCategory, Parameters<typeof t>[1]> = {
  system: 'ctxSystem', tools: 'ctxTools', user: 'ctxUserMessages', inject: 'ctxInjections',
  skill: 'ctxSkillInjections', assistant: 'ctxAssistantMessages', tool: 'ctxToolResults',
}

function toggle(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function pretty(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

function NodeRow({ locale, node, open, onToggle }: { locale: CopyLocale; node: DotContextNode; open: boolean; onToggle: () => void }) {
  const preview = node.text.replace(/\s+/g, ' ').trim().slice(0, 100)
  return (
    <div className="dsh-dot-surface-node">
      <button type="button" aria-expanded={open} onClick={onToggle}>
        <span className="dsh-dot-surface-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="dsh-dot-surface-node-name">{node.name || preview || t(locale, 'ctxEmptyNode')}</span>
        {node.name && preview ? <span className="dsh-dot-surface-node-preview">{preview}</span> : null}
        <span className="dsh-dot-surface-node-tokens">≈{formatTokens(node.tokens)}</span>
      </button>
      {open ? (
        <div className="dsh-dot-surface-node-content">
          <pre>{pretty(node.text) || t(locale, 'ctxEmptyNode')}</pre>
          {node.clipped ? <span className="dsh-ui-help">{t(locale, 'trClipped')}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

export function SurfaceBrowser({ locale, surface }: { locale: CopyLocale; surface: DotContextSurface }) {
  const [categoriesOpen, setCategoriesOpen] = useState<ReadonlySet<string>>(new Set())
  const [nodesOpen, setNodesOpen] = useState<ReadonlySet<string>>(new Set())
  const groups = useMemo(() => SURFACE_CATEGORIES.map(category => ({ category, nodes: surface.nodes.filter(node => node.category === category) })), [surface.nodes])
  const total = SURFACE_CATEGORIES.reduce((sum, key) => sum + surface.parts[key], 0)
  return (
    <section className="dsh-dot-ctx-section dsh-dot-surface-browser" aria-label={t(locale, 'ctxBrowser')}>
      <div className="lc-card-title">
        <span className="lc-card-title-text"><IconDatabase size={14} />{t(locale, 'ctxBrowser')}</span>
        <span className="lc-card-sub">{t(locale, 'ctxEstimatedTotal')} ≈{formatTokens(total)}</span>
      </div>
      <div className="dsh-dot-surface-groups">
        {groups.map(({ category, nodes }) => {
          const open = categoriesOpen.has(category)
          return (
            <div className="dsh-dot-surface-group" key={category}>
              <button type="button" className="dsh-dot-surface-category" aria-expanded={open} disabled={nodes.length === 0} onClick={() => setCategoriesOpen(current => toggle(current, category))}>
                <span className="dsh-dot-surface-chevron" aria-hidden="true">{nodes.length > 0 ? (open ? '▾' : '▸') : ''}</span>
                <i style={{ background: SURFACE_COLORS[category] }} />
                <span className="dsh-dot-surface-category-label">{t(locale, CATEGORY_KEYS[category])}</span>
                <span className="dsh-dot-surface-category-count">{nodes.length} {t(locale, 'ctxItems')}</span>
                <span className="dsh-dot-surface-category-tokens">≈{formatTokens(surface.parts[category])}</span>
              </button>
              {open ? <div className="dsh-dot-surface-nodes">{nodes.map(node => <NodeRow key={node.id} locale={locale} node={node} open={nodesOpen.has(node.id)} onToggle={() => setNodesOpen(current => toggle(current, node.id))} />)}</div> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
