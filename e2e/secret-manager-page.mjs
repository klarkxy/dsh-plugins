/**
 * The page the secret-manager browser acceptance loads.
 *
 * It is a separate file, not a string embedded in the test, so it can be
 * parsed on its own before a browser ever opens it. An invalid script here
 * used to surface only as a Vite import-analysis error inside the browser run.
 *
 * The page mounts the real built client bundle (`lib/client.js`) through the
 * host's own `__ModuleLoader__` contract, on a synthetic slot ledger.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import * as ReactDOM from 'react-dom'
import * as jsx from 'react/jsx-runtime'
import * as primitives from '/scripts/editor-plugins/ui-primitives-stub.tsx'

const PLUGIN_ID = '@klarkxy/dsh-secret-manager'

let apply
window.__ModuleLoader__ = {
  load({ id, factory }) {
    if (id !== PLUGIN_ID) throw new Error('Wrong bundle: ' + id)
    const modules = {
      'react': React,
      'react-dom': ReactDOM,
      'react/jsx-runtime': jsx,
      '@deepseek-ai/dsh-client-ui-primitives': primitives,
    }
    apply = factory(name => {
      if (!(name in modules)) throw new Error('Unexpected module ' + name)
      return modules[name]
    }).apply
  },
}

// The host loads the client bundle as a classic script.
await new Promise((done, failed) => {
  const script = document.createElement('script')
  script.src = '/plugins/dsh-secret-manager/lib/client.js'
  script.onload = done
  script.onerror = failed
  document.head.append(script)
})

let active = 'zh-CN'
const listeners = new Set()
window.switchLocale = next => {
  active = next
  document.documentElement.lang = next
  for (const listener of listeners) listener()
}

// The locale registry, following the host's contract:
//
//   register(ns, locale, dict) — the single-locale form the plugin uses; it
//     stores one dictionary under one namespace and locale.
//   bind(ns) — returns the translate function the host's `t` seat carries for
//     that namespace. The plugin's tool view declares `locale: PLUGIN_ID`, so
//     the host binds that namespace and hands the bound function to the view.
//
// Without this the tool view would receive the raw key as its text, and the
// dialog would render key names instead of copy.
const dictionaries = new Map()
const NAMESPACE_SEPARATOR = '::'

function fill(template, params) {
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`))
}

const localeService = {
  getSnapshot: () => ({ active, revision: dictionaries.size }),
  subscribe: fn => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  register: (ns, locale, dict) => {
    if (typeof ns !== 'string' || !ns) throw new Error('a locale namespace is required')
    if (typeof locale !== 'string' || !locale) throw new Error('a locale tag is required')
    if (!dict || typeof dict !== 'object') throw new Error('a dictionary is required')
    const key = `${ns}::${locale}`
    if (dictionaries.has(key)) throw new Error(`the namespace ${ns} already owns ${locale}`)
    dictionaries.set(key, { ...dict })
    // A registration bumps the revision so mounted outlets pick it up.
    for (const listener of listeners) listener()
    return () => { dictionaries.delete(key) }
  },
  bind: ns => {
    return (key, params) => {
      const language = active.startsWith('zh') ? 'zh' : 'en'
      const table = dictionaries.get(`${ns}::${language}`) ?? dictionaries.get(`${ns}::en`)
      const template = table?.[key]
      // A key the dictionary does not carry stays the key itself, exactly as
      // the host would show it — that is what makes a missing key visible.
      return template === undefined ? key : fill(template, params)
    }
  },
}

const rpcCalls = []
window.rpcCalls = rpcCalls

const seats = new Set(['tool.call.toolview', 'settings.section', 'settings.section.icon'])
let sectionSpec
let sectionRender
let toolSpec
let toolRender

// The Host's RPC result already carries the { ok, value } envelope, so it is
// passed through unchanged. Wrapping it again would make every client reader
// see a shape it does not understand, and the settings page would report a
// read failure instead of the list.
const api = {
  connection: {
    rpc: {
      call: async (_channel, endpoint, payload) => {
        rpcCalls.push({ endpoint, payload })
        try {
          return await window.hostRpc(endpoint, payload)
        } catch (error) {
          return { ok: false, error: { code: 'transport', message: String(error.message) } }
        }
      },
    },
  },
  locale: localeService,
  uiWorkspace: {
    current: {
      getSnapshot: () => ({ sessionId: 'session-e2e-1' }),
      subscribe: fn => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    },
  },
  uiSession: {
    adapter: {
      current: {
        getSnapshot: () => ({ key: 'session-e2e-1' }),
        subscribe: fn => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      },
    },
  },
  effect: run => run(),
  inject(_deps, run) {
    const cleanup = []
    run({
      remote: {},
      effect: effect => cleanup.push(effect()),
    })
    return {
      dispose() {
        for (const stop of cleanup) stop()
      },
    }
  },
  get: () => undefined,
  slots: {
    inject(name, run) {
      if (!seats.has(name)) throw new Error('Unexpected slot: ' + name)
      return run()
    },
    register(options, render) {
      if (options.name === 'settings.section') {
        sectionSpec = options
        sectionRender = render
      }
      if (options.name === 'tool.call.toolview') {
        toolSpec = options
        toolRender = render
      }
      return () => {}
    },
  },
}

await apply(api)

window.seatInfo = () => ({
  section: sectionSpec
    ? { name: sectionSpec.name, id: sectionSpec.id, order: sectionSpec.order }
    : null,
  tool: toolSpec
    ? { name: toolSpec.name, key: toolSpec.key, locale: toolSpec.locale }
    : null,
})

// One React root for the whole page. React warns when the same container is
// handed to createRoot twice, so the root is created here and both mounts
// render into it.
const root = createRoot(document.getElementById('root'))

window.mountSettings = () => {
  if (!sectionRender) throw new Error('settings section not registered')
  root.render(
    React.createElement(sectionRender, { close: () => {} }),
  )
}

window.mountTool = (callId) => {
  if (!toolRender) throw new Error('toolview not registered')
  // The host binds the namespace the tool view declares and hands the bound
  // function to it as `t`. The view's own `locale` declaration names that
  // namespace, so the text comes from the dictionary the plugin registered.
  const translate = localeService.bind(toolSpec.locale)
  root.render(
    React.createElement(toolRender, {
      sessionId: 'session-e2e-1',
      callId,
      phase: 'start',
      block: {
        callId,
        args: { has: () => false, complete: () => false, text: () => undefined, value: () => undefined },
      },
      t: translate,
      call: async (endpoint, payload) => window.hostRpc(endpoint, payload),
    }),
  )
}
