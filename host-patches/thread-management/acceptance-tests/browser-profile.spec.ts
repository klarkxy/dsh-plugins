import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from '../apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../apps/web/tests/support.ts'
import { MockAdapter, textResponse } from '../packages/core/agent-loop/tests/mock-adapter.ts'
import type {} from '@deepseek-ai/dsh-agent-default-model'

const plugin = process.env['DSH_ACCEPTANCE_PLUGIN'] ?? join(process.cwd(), '.acceptance', 'runtime-plugin')
class AcceptanceAdapter extends MockAdapter {
  override providerInfo(provider: string) { return { id: provider, name: 'Acceptance fake model' } }
  override listModels(provider: string) { return Promise.resolve([{ provider, id: 'acceptance', name: 'Acceptance fake model' }]) }
}

it('uses the built native profile for create, same-ID edit/resend, independent fork files and terminal deletion', async () => {
  const scaffold = await launchWebScaffold({ profile: { hmr: false, packages: [{ dir: plugin, enabled: true }] } })
  const browser = await chromium.launch()
  const adapter = new AcceptanceAdapter([textResponse('ACCEPTANCE_RESPONSE_ONE'), textResponse('ACCEPTANCE_RESPONSE_TWO')])
  scaffold.ctx.llm.registerAdapter(['acceptance-provider'], adapter)
  await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'acceptance-provider', model: 'acceptance' })
  const page = await newEnglishPage(browser)
  const errors = watchConsole(page)
  try {
    const managerEntry = [...scaffold.ctx.loader.entries()].find(entry => entry.options.id === 'session-manager')
    expect(managerEntry, 'real plugin bundle entry').toBeDefined()
    if (managerEntry!.fiber === undefined) await managerEntry!.parent.tree.import(managerEntry!.options.name)
    expect(managerEntry!.fiber, 'real plugin bundle activates').toBeDefined()
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'Free chat', exact: true }).click()
    await page.getByRole('heading', { name: 'Free chat', exact: true }).waitFor()
    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    await expect.poll(() => scaffold.ctx.agents.list().filter(agent => agent.session.header.classification === 'free').length).toBe(1)
    const agent = scaffold.ctx.agents.list().find(agent => agent.session.header.classification === 'free')!
    const id = agent.id
    const owned = agent.session.header.ownedDirectory
    expect(owned).toBeDefined()
    await scaffold.ctx.sessionController.selectModel({ sessionId: id, provider: 'acceptance-provider', model: 'acceptance' })
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.waitFor()
    await composer.fill('ACCEPTANCE_ORIGINAL_PROMPT')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByText('ACCEPTANCE_RESPONSE_ONE', { exact: true }).waitFor()
    await agent.whenIdle()
    await page.locator('[data-conversation-scroll]').getByText('ACCEPTANCE_ORIGINAL_PROMPT', { exact: true }).hover()
    await page.getByRole('button', { name: 'Edit and resend', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Edit and resend', exact: true })
    await editor.getByRole('textbox', { name: 'Message text', exact: true }).fill('ACCEPTANCE_EDITED_PROMPT')
    await editor.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByText('ACCEPTANCE_RESPONSE_TWO', { exact: true }).waitFor()
    await agent.whenIdle()
    expect(agent.id).toBe(id)
    expect(adapter.requests).toHaveLength(2)
    expect(await page.getByText('ACCEPTANCE_RESPONSE_ONE', { exact: true }).count()).toBe(0)
    expect(await page.locator('[data-conversation-scroll]').getByText('ACCEPTANCE_ORIGINAL_PROMPT', { exact: true }).count()).toBe(0)
    expect(await page.locator('[data-conversation-scroll]').getByText('ACCEPTANCE_EDITED_PROMPT', { exact: true }).count()).toBe(1)
    await scaffold.ctx.sessionController.rename({ sessionId: id, title: 'ACCEPTANCE_SOURCE_CHAT' })
    await mkdir(join(owned!, 'nested'), { recursive: true })
    await writeFile(join(owned!, 'nested', 'note.txt'), 'preserved free fork files')
    await page.getByRole('button', { name: 'Free chat', exact: true }).click()
    const row = page.getByRole('list', { name: 'Free chat', exact: true }).getByRole('listitem').first()
    await row.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Fork', exact: true }).click()
    await expect.poll(() => scaffold.ctx.agents.list().filter(item => item.session.header.classification === 'free').length).toBe(2)
    const child = scaffold.ctx.agents.list().find(item => item.id !== id && item.session.header.classification === 'free')!
    expect(child.session.header.ownedDirectory).not.toBe(owned)
    expect(await readFile(join(child.session.header.ownedDirectory!, 'nested', 'note.txt'), 'utf8')).toBe('preserved free fork files')
    await scaffold.ctx.sessionController.rename({ sessionId: child.id, title: 'ACCEPTANCE_FORK_CHAT' })
    // Public deletion is driven through the native UI; selection release and list updates are part of this path.
    await page.getByRole('button', { name: 'Free chat', exact: true }).click()
    const rows = page.getByRole('list', { name: 'Free chat', exact: true }).getByRole('listitem')
    const sourceRow = rows.filter({ has: page.getByText('ACCEPTANCE_SOURCE_CHAT', { exact: true }) })
    await sourceRow.getByRole('button', { name: 'Chat actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Delete chat', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete chat', exact: true })
    await dialog.getByRole('button', { name: 'Delete chat', exact: true }).click()
    await expect.poll(() => scaffold.ctx.sessions.get(id)).toBeUndefined()
    await expect(stat(owned!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(child.session.header.ownedDirectory!, 'nested', 'note.txt'), 'utf8')).toBe('preserved free fork files')
    expect(errors.pageErrors).toEqual([])
    await page.screenshot({ path: '.acceptance/native-free-chat-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: '.acceptance/native-free-chat-mobile.png' })
  } catch (error) {
    const timeline = await page.evaluate(() => (globalThis as unknown as { __THREAD_ACCEPTANCE_TIMELINE__?: unknown }).__THREAD_ACCEPTANCE_TIMELINE__).catch(() => undefined)
    await writeFile('.acceptance/browser-timeline.json', JSON.stringify(timeline ?? null, null, 2))
    await page.screenshot({ path: '.acceptance/browser-failure.png' }).catch(() => {})
    await writeFile('.acceptance/browser-failure.txt', await page.locator('body').innerText().catch(() => 'page unavailable'))
    throw error
  } finally {
    await browser.close()
    await scaffold.close()
  }
})

