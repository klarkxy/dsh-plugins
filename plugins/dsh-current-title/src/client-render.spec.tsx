import { Context } from '@deepseek-ai/cordis'
import { useNativeSeat } from '@klarkxy/dsh-plugin-kit/client-utils'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TitleSettings } from './client.tsx'
import { createTitleClientMarker } from './marker.ts'

/*
 * `@deepseek-ai/dsh-client-ui-primitives` is host-provided, and its published
 * bundle pulls in packages this workspace deliberately does not install. The
 * editor-plugin vitest config points that specifier at a shared double
 * (`scripts/editor-plugins/ui-primitives-stub.tsx`) that renders the same
 * elements, so this spec renders the seat for real — same tags, same props.
 */

/**
 * The settings seat used to receive the plugin's Cordis context as a prop. A
 * Cordis context throws on any undeclared property read, so `useNativeSeat`
 * reading `props.owner` off it crashed the very first render. The host's entry
 * boundary turned that into a one-shot abdication of the keyed cell: the
 * registration stayed on the ledger but dropped out of `entriesOfSlot`, and the
 * plugin page gates its config section on exactly that set — so the settings UI
 * never rendered again, on this load or any later one.
 *
 * These tests render for real, because a source-text assertion cannot see it.
 */

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
}

function fakeClient() {
  const session = store('session-under-test')
  return {
    uiWorkspace: { current: session },
    uiSession: { adapter: { current: store({ key: 'fallback' }) } },
    locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: store('zh').subscribe },
    sessions: { binding: () => undefined },
    connection: { generation: { subscribe: () => () => {} }, rpc: { call: async () => ({ ok: true, value: {} }) } },
  }
}

/** A loaded plugin's own context — the object `apply` closes over. */
async function pluginScopedContext(client: ReturnType<typeof fakeClient>) {
  let scoped: Context | undefined
  await new Context().plugin({
    name: 'current-title-client-fixture',
    apply(child) {
      child.provide('locale', { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} })
      child.provide('uiWorkspace', client.uiWorkspace)
      child.provide('uiSession', client.uiSession)
      scoped = child
    },
  })
  return scoped as Context
}

describe('current title settings seat', () => {
  it('renders on the plugin page without reading a Cordis context', async () => {
    const client = fakeClient()
    const html = renderToString(<TitleSettings client={client as never} marker={createTitleClientMarker()} />)
    expect(html).toContain('data-testid="current-title-settings"')
  })

  it('tolerates a Cordis context handed to the shared seat resolver', async () => {
    const client = fakeClient()
    const ctx = await pluginScopedContext(client)
    // The failure this pins: the proxy throws rather than yielding undefined,
    // which used to abort the entry and abdicate its keyed cell.
    expect(() => (ctx as unknown as Record<string, unknown>).owner).toThrow(/without inject/)

    function SeatProbe({ owner }: { owner: unknown }) {
      const seat = useNativeSeat(client as never, owner)
      return <p data-seat={seat.sessionId}>{seat.locale}</p>
    }

    // Server rendering uses useSyncExternalStore's server snapshot, so the seat
    // resolves to its inert values; reaching this line at all is the assertion.
    const html = renderToString(<SeatProbe owner={ctx} />)
    expect(html).toContain('<p data-seat="">en</p>')
  })

  it('never hands the plugin context to the component', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('owner={ctx}')
    expect(source).toContain('<TitleSettings client={client} marker={marker} />')
  })
})
