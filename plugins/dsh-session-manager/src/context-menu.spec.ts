import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { findSessionRow, forwardContextMenu, installContextMenuForwarding } from './context-menu.ts'

// Match SessionNodeItem + Menu: the anchor is wrapped, contributed actions
// follow it, and the menu itself portals outside the tree.
const FIXTURE = `<!doctype html><html><body>
<div role="tree" aria-label="browser">
  <div role="treeitem" data-row-key="session:s-1" class="host_sessionRow">
    <span class="host_title">Thread one</span>
    <span class="host_rowActions">
      <div class="menu_root"><button type="button" aria-label="Session actions for Thread one"><svg><path /></svg></button></div>
      <button type="button" aria-label="Pin">Pin</button>
    </span>
  </div>
  <div role="treeitem" data-row-key="workspace:w-1"><span>Workspace</span><span class="host_rowActions"><button type="button">Workspace menu</button></span></div>
  <div role="treeitem" data-row-key="overflow:w-1"><span>Show more</span></div>
  <div role="treeitem"><span>Search result</span></div>
  <div role="treeitem" data-row-key="session:blank"><span>New Session</span></div>
  <div role="treeitem" class="host_sessionRow" inert><span>Exit clone</span></div>
</div>
<div role="treeitem" data-row-key="session:stray"><span>Outside tree</span><span class="host_rowActions"><button>Menu</button></span></div>
</body></html>`

function setup() {
  const dom = new JSDOM(FIXTURE)
  const doc = dom.window.document
  const row = doc.querySelector<HTMLElement>('[data-row-key="session:s-1"]')!
  const trigger = row.querySelector<HTMLButtonElement>('button')!
  const title = row.querySelector('.host_title')!
  const clicks: string[] = []
  row.addEventListener('click', () => { clicks.push('open-session') })
  row.querySelector('.host_rowActions')!.addEventListener('click', event => event.stopPropagation())
  trigger.addEventListener('click', () => {
    clicks.push('menu')
    if (row.classList.toggle('host_menuOpen')) {
      const menu = doc.createElement('div')
      menu.setAttribute('role', 'menu')
      menu.innerHTML = '<button role="menuitem">Rename</button>'
      doc.body.append(menu)
    } else doc.querySelector('[role="menu"]')?.remove()
  })
  row.querySelector('[aria-label="Pin"]')!.addEventListener('click', () => { clicks.push('pin') })
  const uninstall = installContextMenuForwarding(doc)
  const rightClick = (target: Element) => {
    const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    target.dispatchEvent(event)
    return event
  }
  return { dom, doc, row, trigger, title, clicks, rightClick, uninstall }
}

describe('sidebar right-click menu', () => {
  it('opens the host menu without opening the session and focuses its anchor', () => {
    const { doc, title, trigger, clicks, rightClick } = setup()
    expect(rightClick(title).defaultPrevented).toBe(true)
    expect(clicks).toEqual(['menu'])
    expect(doc.querySelector('[role="menu"]')).not.toBeNull()
    expect(doc.activeElement).toBe(trigger)
  })

  it('opens from the row background and keeps an already-open menu open', () => {
    const { doc, row, title, clicks, rightClick } = setup()
    expect(rightClick(row).defaultPrevented).toBe(true)
    expect(rightClick(title).defaultPrevented).toBe(true)
    expect(clicks).toEqual(['menu'])
    expect(doc.querySelector('[role="menu"]')).not.toBeNull()
  })

  it('opens from the ellipsis icon but never invokes other row actions', () => {
    const { row, trigger, clicks, rightClick } = setup()
    expect(rightClick(row.querySelector('[aria-label="Pin"]')!).defaultPrevented).toBe(false)
    expect(clicks).toEqual([])
    expect(rightClick(trigger.querySelector('path')!).defaultPrevented).toBe(true)
    expect(clicks).toEqual(['menu'])
  })

  it('ignores non-session rows, blank rows, exit clones, and rows outside the tree', () => {
    const { doc, clicks, rightClick } = setup()
    for (const selector of [
      '[data-row-key="workspace:w-1"] span',
      '[data-row-key^="overflow:"] span',
      '[role="tree"] > [role="treeitem"]:not([data-row-key]) span',
      '[data-row-key="session:blank"] span',
      '[inert] span',
      '[data-row-key="session:stray"] span',
    ]) expect(rightClick(doc.querySelector(selector)!).defaultPrevented).toBe(false)
    expect(clicks).toEqual([])
  })

  it('ignores a disabled menu anchor and inert keyed rows', () => {
    const { row, title, trigger, clicks, rightClick } = setup()
    trigger.disabled = true
    expect(rightClick(title).defaultPrevented).toBe(false)
    trigger.disabled = false
    row.setAttribute('inert', '')
    expect(rightClick(title).defaultPrevented).toBe(false)
    expect(clicks).toEqual([])
  })

  it('does not relay gestures on the portaled menu', () => {
    const { doc, title, clicks, rightClick } = setup()
    rightClick(title)
    expect(rightClick(doc.querySelector('[role="menuitem"]')!).defaultPrevented).toBe(false)
    expect(clicks).toEqual(['menu'])
  })

  it('leaves ordinary left-click navigation unchanged', () => {
    const { row, clicks } = setup()
    row.click()
    expect(clicks).toEqual(['open-session'])
  })

  it('stops forwarding after disposal', () => {
    const { title, clicks, rightClick, uninstall } = setup()
    uninstall()
    expect(rightClick(title).defaultPrevented).toBe(false)
    expect(clicks).toEqual([])
  })

  it('respects handled events and tolerates events without an element target', () => {
    const { dom, doc, title, clicks } = setup()
    const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    event.preventDefault()
    title.dispatchEvent(event)
    expect(clicks).toEqual([])
    expect(forwardContextMenu(new dom.window.Event('contextmenu'))).toBe(false)
    doc.dispatchEvent(new dom.window.Event('contextmenu'))
    expect(clicks).toEqual([])
  })

  it('resolves only keyed session treeitems', () => {
    const { doc, row, title } = setup()
    expect(findSessionRow(title)).toBe(row)
    expect(findSessionRow(doc.querySelector('[data-row-key="workspace:w-1"] span')!)).toBeNull()
  })
})
