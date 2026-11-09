import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelMenu, modelMenuCss } from './ui.tsx'
import { parseModelMenuChoices } from './catalog.ts'

const CATALOG = {
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'Chat', reasoning: { efforts: [{ id: 'high', name: '高' }] } }] },
    { id: 'openai', models: [{ id: 'gpt-5' }] },
  ],
}
const choices = parseModelMenuChoices(CATALOG)
const anchor = createElement('button', { type: 'button', className: 'dsh-model-menu-trigger' }, 'DeepSeek / Chat')

describe('ModelMenu', () => {
  it('renders only the anchor in a document-less SSR context, open or closed', () => {
    const closed = renderToStaticMarkup(createElement(ModelMenu, { open: false, onOpenChange: () => {}, anchor, choices, onPick: () => {} }))
    expect(closed).toContain('dsh-model-menu-root')
    expect(closed).toContain('DeepSeek / Chat')
    expect(closed).not.toContain('dsh-model-menu-menu')
    // The menu is a body portal, so without a document nothing else mounts —
    // an SSR render must not throw even when the consumer believes it is open.
    const open = renderToStaticMarkup(createElement(ModelMenu, {
      open: true, onOpenChange: () => {}, anchor, choices, onPick: () => {},
      selected: { provider: 'deepseek', model: 'deepseek-chat' },
      efforts: [{ id: 'high', name: '高' }], selectedEffort: 'high', onPickEffort: () => {},
      leading: [{ id: 'follow', label: 'Follow', selected: false }], onPickLeading: () => {},
    }))
    expect(open).toContain('dsh-model-menu-root')
    expect(open).not.toContain('dsh-model-menu-menu')
  })

  it('ships only theme-token colors in its stylesheet', () => {
    expect(modelMenuCss).toContain('--dsw-')
    expect(modelMenuCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(modelMenuCss).not.toMatch(/\brgba?\(/)
    // The enhanced-mode slider keeps the same theme-token-only discipline.
    expect(modelMenuCss).toContain('.dsh-model-menu-sliderGroup')
    expect(modelMenuCss).not.toMatch(/:\s*#[0-9a-fA-F]{3,8}\b/)
    // The transparent native input pins the painted thumb/track geometry so
    // webkit's 16px default thumb cannot skew the end-point hit mapping.
    expect(modelMenuCss).toContain('::-webkit-slider-thumb')
    expect(modelMenuCss).toContain('::-moz-range-thumb')
    expect(modelMenuCss).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('accepts the enhanced-mode props without changing the document-less render', () => {
    const closed = renderToStaticMarkup(createElement(ModelMenu, {
      open: false, onOpenChange: () => {}, anchor, choices, onPick: () => {},
      initialPane: 'model', alwaysShowSearch: true, reasoningSlider: true,
    }))
    expect(closed).toContain('dsh-model-menu-root')
    expect(closed).not.toContain('dsh-model-menu-menu')
    // Open is still a body portal: no menu markup in SSR, no throw.
    const open = renderToStaticMarkup(createElement(ModelMenu, {
      open: true, onOpenChange: () => {}, anchor, choices, onPick: () => {},
      initialPane: 'model', alwaysShowSearch: true, reasoningSlider: true,
      efforts: [{ id: 'high', name: '高' }], selectedEffort: 'high', onPickEffort: () => {},
    }))
    expect(open).not.toContain('dsh-model-menu-menu')
  })
})
