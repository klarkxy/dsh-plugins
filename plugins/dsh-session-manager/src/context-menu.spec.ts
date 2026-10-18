import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { findSessionRow, forwardContextMenu, installContextMenuForwarding } from './context-menu.ts'

const FIXTURE = `<!doctype html><html><body>
<div role="tree" aria-label="browser">
  <div role="treeitem" data-row-key="session:s-1">
    <span class="YDXeBa_title">Thread one</span>
    <span class="YDXeBa_rowActions">
      <button type="button" class="YDXeBa_iconButton" aria-label="Session actions for Thread one">…</button>
      <button type="button" class="YDXeBa_iconButton" aria-label="Pin">📌</button>
    </span>
  </div>
  <div role="treeitem" data-row-key="session:s-2">
    <span class="YDXeBa_title">Thread two</span>
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

describe('sidebar right-click open', () => {
  it('clicks the session row when its title is right-clicked', () => {
    const { doc, clicks, rightClick } = setup()
    const row = doc.querySelector('[data-row-key="session:s-1"]') as HTMLElement
    row.addEventListener('click', () => { clicks.push('row') })
    const title = row.querySelector('.YDXeBa_title')
    const event = rightClick(title)
    expect(event.defaultPrevented).toBe(true)
    expect(clicks).toEqual(['row'])
  })

  it('leaves the action buttons to the native menu when they are right-clicked', () => {
    const { doc, clicks, rightClick } = setup()
    const row = doc.querySelector('[data-row-key="session:s-1"]') as HTMLElement
    row.addEventListener('click', () => { clicks.push('row') })
    const trigger = row.querySelector('.YDXeBa_rowActions button')
    const event = rightClick(trigger)
    expect(event.defaultPrevented).toBe(false)
    expect(clicks).toEqual([])
  })

  it('does not open a workspace group on right-click', () => {
    const { doc, clicks, rightClick } = setup()
    const row = doc.querySelector('[data-row-key="workspace:w-1"]') as HTMLElement
    row.addEventListener('click', () => { clicks.push('workspace') })
    const title = row.querySelector('.YDXeBa_title')
    const event = rightClick(title)
    expect(event.defaultPrevented).toBe(false)
    expect(clicks).toEqual([])
  })

  it('ignores the ungrouped bucket, overflow rows, and search rows, and opens a blank session row', () => {
    const { doc, clicks, rightClick } = setup()
    const blank = doc.querySelector('[data-row-key="session:blank"]') as HTMLElement
    blank.addEventListener('click', () => { clicks.push('blank') })
    for (const selector of [
      '[data-row-key="workspace:"] span',
      '[data-row-key^="overflow:"] span',
      '[role="tree"] > [role="treeitem"]:not([data-row-key]) span',
    ]) {
      const event = rightClick(doc.querySelector(selector))
      expect(event.defaultPrevented).toBe(false)
    }
    const blankEvent = rightClick(blank.querySelector('span'))
    expect(blankEvent.defaultPrevented).toBe(true)
    expect(clicks).toEqual(['blank'])
  })

  it('ignores keyed rows outside the browser tree', () => {
    const { doc, clicks, rightClick } = setup()
    const event = rightClick(doc.querySelector('[data-row-key="session:stray"] span'))
    expect(event.defaultPrevented).toBe(false)
    expect(clicks).toEqual([])
  })

  it('stops forwarding after the disposer runs', () => {
    const { doc, clicks, rightClick, uninstall } = setup()
    const row = doc.querySelector('[data-row-key="session:s-2"]') as HTMLElement
    row.addEventListener('click', () => { clicks.push('row') })
    rightClick(row.querySelector('.YDXeBa_title'))
    expect(clicks).toEqual(['row'])
    uninstall()
    const event = rightClick(row.querySelector('.YDXeBa_title'))
    expect(event.defaultPrevented).toBe(false)
    expect(clicks).toEqual(['row'])
  })

  it('tolerates events without an element target', () => {
    const { dom } = setup()
    const event = new dom.window.Event('contextmenu', { cancelable: true })
    expect(forwardContextMenu(event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('resolves the session row through findSessionRow', () => {
    const { doc } = setup()
    const title = doc.querySelector('[data-row-key="session:s-2"] .YDXeBa_title')
    expect(findSessionRow(title as Element)?.getAttribute('data-row-key')).toBe('session:s-2')
    expect(findSessionRow(doc.querySelector('[data-row-key="session:s-1"] .YDXeBa_rowActions button') as Element)).toBeNull()
    expect(findSessionRow(doc.querySelector('[data-row-key^="overflow:"] span') as Element)).toBeNull()
    expect(findSessionRow(doc.querySelector('[data-row-key="workspace:w-1"] .YDXeBa_title') as Element)).toBeNull()
  })
})
