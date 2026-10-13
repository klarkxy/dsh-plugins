import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { findRowMenuTrigger, forwardContextMenu, installContextMenuForwarding } from './context-menu.ts'

const FIXTURE = `<!doctype html><html><body>
<div role="tree" aria-label="browser">
  <div role="treeitem" data-row-key="session:s-1">
    <span class="YDXeBa_title">Thread one</span>
    <span class="YDXeBa_rowActions">
      <button type="button" class="YDXeBa_iconButton" aria-label="Session actions for Thread one">…</button>
      <button type="button" class="YDXeBa_iconButton" aria-label="Pin">📌</button>
    </span>
  </div>
  <div role="treeitem" data-row-key="workspace:w-1">
    <span class="YDXeBa_title">Workspace one</span>
    <span class="YDXeBa_rowActions">
      <button type="button" class="YDXeBa_iconButton" aria-label="Workspace actions for Workspace one">…</button>
    </span>
  </div>
  <div role="treeitem" data-row-key="workspace:"><span>Ungrouped</span></div>
  <div role="treeitem" data-row-key="overflow:w-1"><span>Show more</span></div>
  <div role="treeitem"><span>Search result without a row key</span></div>
  <div role="treeitem" data-row-key="session:blank"><span>New Session</span></div>
</div>
<div data-row-key="session:stray">
  <span class="YDXeBa_rowActions"><button type="button">…</button></span>
</div>
</body></html>`

function setup() {
  const dom = new JSDOM(FIXTURE)
  const doc = dom.window.document
  const clicks: string[] = []
  for (const button of doc.querySelectorAll('button')) {
    button.addEventListener('click', () => { clicks.push(button.textContent ?? '') })
  }
  const uninstall = installContextMenuForwarding(doc)
  const rightClick = (target: Element | null) => {
    if (target === null) throw new Error('fixture target missing')
    const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    target.dispatchEvent(event)
    return event
  }
  return { dom, doc, clicks, rightClick, uninstall }
}

describe('sidebar context menu forwarding', () => {
  it('clicks the session row trigger when its title is right-clicked', () => {
    const { doc, clicks, rightClick } = setup()
    const title = doc.querySelector('[data-row-key="session:s-1"] .YDXeBa_title')
    const event = rightClick(title)
    expect(event.defaultPrevented).toBe(true)
    expect(clicks).toEqual(['…'])
  })

  it('clicks the trigger itself once when it is right-clicked', () => {
    const { doc, clicks, rightClick } = setup()
    const trigger = doc.querySelector('[data-row-key="session:s-1"] .YDXeBa_rowActions button')
    const event = rightClick(trigger)
    expect(event.defaultPrevented).toBe(true)
    expect(clicks).toEqual(['…'])
  })

  it('forwards right-clicks on workspace group rows', () => {
    const { doc, clicks, rightClick } = setup()
    const title = doc.querySelector('[data-row-key="workspace:w-1"] .YDXeBa_title')
    const event = rightClick(title)
    expect(event.defaultPrevented).toBe(true)
    expect(clicks).toEqual(['…'])
  })

  it('ignores the ungrouped bucket, overflow rows, search rows, and blank rows', () => {
    const { doc, clicks, rightClick } = setup()
    for (const selector of [
      '[data-row-key="workspace:"] span',
      '[data-row-key^="overflow:"] span',
      '[role="tree"] > [role="treeitem"]:not([data-row-key]) span',
      '[data-row-key="session:blank"] span',
    ]) {
      const event = rightClick(doc.querySelector(selector))
      expect(event.defaultPrevented).toBe(false)
    }
    expect(clicks).toEqual([])
  })

  it('ignores keyed rows outside the browser tree', () => {
    const { doc, clicks, rightClick } = setup()
    const event = rightClick(doc.querySelector('[data-row-key="session:stray"] span'))
    expect(event.defaultPrevented).toBe(false)
    expect(clicks).toEqual([])
  })

  it('stops forwarding after the disposer runs', () => {
    const { doc, clicks, rightClick, uninstall } = setup()
    rightClick(doc.querySelector('[data-row-key="session:s-1"] .YDXeBa_title'))
    expect(clicks).toEqual(['…'])
    uninstall()
    const event = rightClick(doc.querySelector('[data-row-key="session:s-1"] .YDXeBa_title'))
    expect(event.defaultPrevented).toBe(false)
    expect(clicks).toEqual(['…'])
  })

  it('tolerates events without an element target', () => {
    const { dom } = setup()
    const event = new dom.window.Event('contextmenu', { cancelable: true })
    expect(forwardContextMenu(event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('resolves the trigger through findRowMenuTrigger', () => {
    const { doc } = setup()
    const title = doc.querySelector('[data-row-key="session:s-1"] .YDXeBa_title')
    const trigger = findRowMenuTrigger(title as Element)
    expect(trigger?.getAttribute('aria-label')).toBe('Session actions for Thread one')
    expect(findRowMenuTrigger(doc.querySelector('[data-row-key^="overflow:"] span') as Element)).toBeNull()
  })
})
