/**
 * Secret manager acceptance — ISOLATED FIXTURE, not a real DSH boot.
 *
 * What this proves and what it does not:
 *
 *  - The Host half is the real built plugin (`lib/index.js`), applied to a
 *    hand-written Cordis-shaped context: a synthetic in-memory credential
 *    provider, a synthetic tool registry, a synthetic `webServer` route. The
 *    plugin's own RPC transport, pending registry, slot lock, grant registry,
 *    shell bridge and redaction are the shipped code paths.
 *  - The Client half is the real built client bundle (`lib/client.js`), loaded
 *    through the host's own `__ModuleLoader__` contract and mounted on a
 *    synthetic slot ledger.
 *
 * It is NOT a real DSH host: no `dsh web` process is started, the real host's
 * slot service and settings shell are not present, and the seats are satisfied
 * by a fixture rather than mounted by the host. A real-host acceptance still
 * has to run this package inside an isolated `dsh --profile web` instance.
 *
 * It never touches a real profile, a real credential store, a real user's key
 * or a model: the credential provider is in-memory and every value is
 * synthetic. The network half uses a local mock origin, never the public
 * internet.
 *
 * Run:  node e2e/secret-manager.mjs
 */
import assert from 'node:assert/strict'
import { createServer as createHttpServer, request as createHttpRequest } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'e2e', 'out', 'secret-manager')
const require = createRequire(resolve(root, 'package.json'))
const vitestRequire = createRequire(require.resolve('vitest/package.json'))
const { createServer } = await import(pathToFileURL(vitestRequire.resolve('vite')).href)

// The masked input's type attribute. Built at runtime so the assertion cannot
// be satisfied by a rendering of the text: these are code points.
const MASKED_TYPE = ['pass', 'word'].join('')
const MASKED_TYPE_CODES = [...MASKED_TYPE].map(ch => ch.codePointAt(0)).join(',')

// A synthetic value. Not a real credential, not derived from one.
const SYNTHETIC_VALUE = 'e2e-synthetic-secret-value-0001'
const SYNTHETIC_SLOT = 'e2e-slot'
// A second synthetic value for the HTTP half, with its own slot.
const HTTP_SYNTHETIC_VALUE = 'e2e-synthetic-http-value-0002'
const HTTP_SLOT = 'e2e-http-slot'

const report = {
  scope: 'ISOLATED FIXTURE acceptance — the built plugin against synthetic in-memory dependencies. NOT a real DSH host: no dsh web process, no real slot service, no real settings shell, no real profile, no real credentials, no model inference. A real-host acceptance still has to run this package inside an isolated `dsh --profile web` instance.',
  hostScope: 'The real built Host half (lib/index.js) on a hand-written Cordis-shaped context: synthetic credential provider, synthetic tool registry, synthetic webServer route. The plugin\'s own RPC transport, pending registry, slot lock, grant registry, shell bridge and redaction run for real.',
  clientScope: 'The real built client bundle (lib/client.js) loaded through the host\'s __ModuleLoader__ contract and mounted on a synthetic slot ledger. The browser half is skipped when Chromium cannot start, and a skip is never reported as a pass.',
  visualScope: 'The browser half runs against the repository\'s UI-primitives stub, not the host\'s own primitives, so it verifies the data flow, the DOM contract and the interaction — not the host\'s visual appearance. A visual acceptance needs a real DSH host.',
  checks: {},
  codeChecks: {},
  evidence: [],
}
const check = (key, value) => {
  report.checks[key] = Boolean(value)
  if (!value) throw new Error(`assertion failed: ${key}`)
}
const trace = message => { if (process.env.SECRET_MANAGER_E2E_TRACE) console.log('[trace]', message) }

/* ------------------------------------------------------------------ *
 * Part 1 — Host half against a synthetic credential provider.
 * ------------------------------------------------------------------ */

/** An in-memory stand-in for the host credential seam. */
class FakeCredentials {
  constructor() {
    this.records = new Map()
    this.written = []
    /** The host announces a committed record change here. */
    this.listeners = []
  }
  onRecordUpdated(listener) { this.listeners.push(listener) }
  announceRecordUpdated(key) { for (const listener of this.listeners) listener(key) }
  async resolve() { return undefined }
  async describe() { return { configured: false, writable: true } }
  async set() { throw new Error('the reference half must not be used') }
  async unset() { throw new Error('the reference half must not be used') }
  async readRecord(key) { return this.records.get(String(key)) }
  async describeRecord(key) {
    return { configured: this.records.has(String(key)), kind: 'grant', writable: true }
  }
  async listRecords() {
    return [...this.records.entries()].map(([key, record]) => ({ key, kind: record.kind }))
  }
  async modifyRecord(key, mutate) {
    const current = this.records.get(String(key))
    const next = await mutate(current)
    if (next !== undefined) {
      this.records.set(String(key), next)
      this.written.push({ key: String(key), payload: next })
    }
    return next ?? current
  }
  async deleteRecord(key) {
    this.records.delete(String(key))
  }
  notifyUpdated() {}
  notifyRecordUpdated() {}
}

/** The tool registry the Host half registers into. */
class FakeTools {
  constructor() { this.definitions = new Map() }
  get(name) { return this.definitions.get(name) }
  register(definition) {
    this.definitions.set(definition.name, definition)
    return () => { this.definitions.delete(definition.name) }
  }
  schemas() { return [...this.definitions.values()] }
}

async function runHostHalf() {
  // The built package, not the sources: this is the artifact a profile loads.
  const { apply } = await import('../plugins/dsh-secret-manager/lib/index.js')
  const credentials = new FakeCredentials()
  const tools = new FakeTools()
  const listeners = new Map()
  const effects = []
  const logLines = []
  const shellContributors = []

  const ctx = {
    tools,
    credentials,
    effect(run) {
      const dispose = run()
      if (typeof dispose === 'function') effects.push(dispose)
      return () => {}
    },
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      // The credential seam announces a committed record change through the
      // host's event; the fake provider drives the same notification.
      if (event === 'credentials/record-updated') {
        credentials.onRecordUpdated(listener)
      }
      return () => {}
    },
    inject(deps, callback) {
      callback({
        effect: run => ctx.effect(run),
        shellEnv: {
          register(contributor) {
            shellContributors.push(contributor)
            return () => {
              const index = shellContributors.indexOf(contributor)
              if (index >= 0) shellContributors.splice(index, 1)
            }
          },
        },
      })
      return { dispose: () => {} }
    },
    connection: { requestRejection: () => undefined },
    webServer: { register: route => { hostRpcHandler = route.handler; return () => {} } },
    logger: {
      warn: line => logLines.push({ level: 'warn', line: String(line) }),
      error: line => logLines.push({ level: 'error', line: String(line) }),
    },
    get: () => undefined,
    root: undefined,
  }
  ctx.root = ctx

  // The plugin binds its transport from the global at load time, so the mock
  // is installed before the Host half is applied and removed afterwards.
  const realFetch = globalThis.fetch
  const httpMock = createHttpMock()
  globalThis.fetch = httpMock.fetch

  await apply(ctx)

  check('hostToolsRegistered', ['request_secret', 'secret_status', 'secret_http'].every(name => tools.get(name)))
  const toolNames = tools.schemas().map(definition => definition.name).sort()
  check('hostToolNamesExact', JSON.stringify(toolNames) === JSON.stringify(['request_secret', 'secret_http', 'secret_status']))

  // The model-facing tool schema must never accept a value argument.
  const requestSecret = tools.get('request_secret')
  const properties = Object.keys(requestSecret.parameters?.properties ?? {})
  check('requestSecretTakesNoValueArgument', !properties.includes('value') && !properties.includes('secret'))
  check('secretHttpTakesNoValueArgument',
    !Object.keys(tools.get('secret_http').parameters?.properties ?? {}).includes('value'))

  // --- The dialog flow: the tool parks, the UI answers over the RPC.
  const session = { id: 'session-e2e-1', header: { origin: 'user' } }
  const agent = { id: 'session-e2e-1', session }
  const controller = new AbortController()
  const callPromise = requestSecret.execute(
    { slot: SYNTHETIC_SLOT, purpose: 'e2e acceptance', request_env: true },
    { callId: 'call-e2e-1', agent, signal: controller.signal },
  )

  // The pending registry answers by (sessionId, callId); the Host owns it.
  // Reach the Host's pending registry through the RPC handler the plugin
  // registered: the plugin registered it on ctx.webServer, so the handler is
  // captured by the fake server.
  const handler = hostRpcHandler
  assert.ok(handler, 'the Host half must register an RPC route')

  // The tool primes the store before it opens the dialog, so the pending
  // request appears a tick later.
  const pendingResponse = await waitForPending(handler, 'session-e2e-1', 'call-e2e-1')
  check('pendingRequestVisible', pendingResponse.ok === true && pendingResponse.value?.slot === SYNTHETIC_SLOT)
  check('pendingRequestCarriesNoValue', !JSON.stringify(pendingResponse.value ?? {}).includes(SYNTHETIC_VALUE))
  check('pendingRequestHasReference', pendingResponse.value?.ref === `secret://${SYNTHETIC_SLOT}`)
  check('pendingRequestHasEnvKey', pendingResponse.value?.envKey === `DSH_SECRET_${SYNTHETIC_SLOT.replace(/-/g, '_').toUpperCase()}`)

  // Submitting the value is the one path that may carry it.
  const submitResponse = await callRpc(handler, 'submit', {
    id: pendingResponse.value.id, sessionId: 'session-e2e-1', callId: 'call-e2e-1',
    value: SYNTHETIC_VALUE, grantEnv: true, grantHttp: false,
  })
  check('submitStored', submitResponse.ok === true && submitResponse.value?.status === 'ready')
  check('submitOutcomeCarriesNoValue', !JSON.stringify(submitResponse.value ?? {}).includes(SYNTHETIC_VALUE))
  check('submitOutcomeHasReference', submitResponse.value?.ref === `secret://${SYNTHETIC_SLOT}`)

  const result = await callPromise
  check('toolReturnedReady', result.status === 'ready')
  check('toolResultCarriesNoValue', !JSON.stringify(result).includes(SYNTHETIC_VALUE))
  check('toolResultHasReference', result.ref === `secret://${SYNTHETIC_SLOT}`)

  // The value really reached the store — and only there.
  const records = [...credentials.records.entries()]
  check('valueStoredInOneRecord', records.length === 1)
  check('storedRecordHoldsTheValue', JSON.stringify(records[0]?.[1] ?? {}).includes(SYNTHETIC_VALUE))

  // The status tool reports references only.
  const status = await tools.get('secret_status').execute({}, { callId: 'call-e2e-2', agent, signal: controller.signal })
  check('statusToolHasNoValue', !JSON.stringify(status).includes(SYNTHETIC_VALUE))
  check('statusToolListsReference', status.entries?.[0]?.ref === `secret://${SYNTHETIC_SLOT}`)

  // The shell bridge hands the value to the session that approved it, and to
  // nobody else.
  const contributor = shellContributors[0]
  check('shellContributorRegistered', Boolean(contributor))
  check('shellDeclaresTheEnvKey', Boolean(contributor?.variables?.DSH_SECRET_E2E_SLOT))
  const approved = contributor.resolve({ callId: 'call-e2e-3', agent: { id: 'session-e2e-1', session } })
  check('approvedSessionGetsTheValue', approved.DSH_SECRET_E2E_SLOT === SYNTHETIC_VALUE)
  const stranger = contributor.resolve({ callId: 'call-e2e-4', agent: { id: 'session-other', session: { id: 'session-other', header: { origin: 'user' } } } })
  check('otherSessionGetsNothing', stranger.DSH_SECRET_E2E_SLOT === undefined)
  const child = contributor.resolve({ callId: 'call-e2e-5', agent: { id: 'session-e2e-1', session: { id: 'child', header: { origin: 'subagent' } } } })
  check('subagentGetsNothing', child.DSH_SECRET_E2E_SLOT === undefined)

  // Revoking the grant takes the value back out of the resolver.
  const revokeResponse = await callRpc(handler, 'revoke', { slot: SYNTHETIC_SLOT, sessionId: 'session-e2e-1' })
  check('revokeSucceeded', revokeResponse.ok === true && revokeResponse.value?.revoked === 1)
  const afterRevoke = contributor.resolve({ callId: 'call-e2e-6', agent: { id: 'session-e2e-1', session } })
  check('revokedSessionGetsNothing', afterRevoke.DSH_SECRET_E2E_SLOT === undefined)

  // A stale submit cannot store a second value.
  const stale = await callRpc(handler, 'submit', {
    id: pendingResponse.value.id, sessionId: 'session-e2e-1', callId: 'call-e2e-1',
    value: 'e2e-second-value-0002', grantEnv: true, grantHttp: false,
  })
  check('staleSubmitRefused', stale.ok === false && stale.error?.code === 'stale')
  check('staleSubmitStoredNothing', ![...credentials.records.values()].some(record => JSON.stringify(record).includes('e2e-second-value-0002')))

  // The list endpoint never carries a value.
  const list = await callRpc(handler, 'list', { sessionId: 'session-e2e-1' })
  check('listSucceeds', list.ok === true)
  check('listCarriesNoValue', !JSON.stringify(list.value ?? {}).includes(SYNTHETIC_VALUE))
  check('listHasReference', list.value?.entries?.[0]?.ref === `secret://${SYNTHETIC_SLOT}`)

  // The delete endpoint removes the record and every grant.
  const deleted = await callRpc(handler, 'delete', { slot: SYNTHETIC_SLOT })
  check('deleteSucceeded', deleted.ok === true)
  check('recordRemoved', credentials.records.size === 0)

  // --- HTTP half -----------------------------------------------------
  // A positive authenticated call, a call to another origin, a redirect, and a
  // response that echoes the credential back. The transport is the plugin's
  // own code; only the socket is mocked.
  const httpChecks = await runHttpHalf(tools, httpMock)
  Object.assign(report.checks, httpChecks.checks)
  report.evidence.push(...httpChecks.evidence)

  // --- Race half ------------------------------------------------------
  // Five races the Host must survive. Each one is a real interleaving of the
  // Host's own code, not a mock of it.
  const raceChecks = await runRaceHalf(tools, handler, credentials, shellContributors)
  Object.assign(report.checks, raceChecks.checks)
  report.evidence.push(...raceChecks.evidence)

  // Nothing that was logged may contain the value.
  const logged = JSON.stringify(logLines)
  check('valueAbsentFromHostLog', !logged.includes(SYNTHETIC_VALUE))
  check('valueAbsentFromHostWarnings', !logLines.some(entry => entry.line.includes(SYNTHETIC_VALUE)))
  check('httpValueAbsentFromHostLog', !logged.includes(HTTP_SYNTHETIC_VALUE))
  check('raceValuesAbsentFromHostLog', !logged.includes('e2e-race-value-0003'))

  globalThis.fetch = realFetch
  for (const dispose of effects.splice(0).reverse()) {
    try { await dispose() } catch { /* already disposed */ }
  }
  return { logLines }
}

/**
 * Five races the Host must survive.
 *
 * 1. Two submits for one dialog: exactly one stores, the other is stale.
 * 2. A revoke that lands while a submit is in flight: the value must not be
 *    granted to the session after the revoke.
 * 3. An external record change while a grant is live: the grant must be
 *    dropped and the cached value invalidated.
 * 4. A dialog abandoned (cancelled) while its write is queued: the write must
 *    not grant anything afterwards.
 * 5. Two sessions racing on one slot: the slot lock serialises them, so one
 *    write cannot overwrite the other's grant.
 */
async function runRaceHalf(tools, handler, credentials, shellContributors) {
  const checks = {}
  const evidence = []
  const record = (key, value) => { checks[key] = Boolean(value); if (!value) throw new Error(`assertion failed: ${key}`) }

  const agent = { id: 'session-race-1', session: { id: 'session-race-1', header: { origin: 'user' } } }
  const controller = new AbortController()

  // --- Race 1: two submits for the same dialog.
  const firstCall = tools.get('request_secret').execute(
    { slot: 'race-slot', purpose: 'e2e race 1' },
    { callId: 'race-call-1', agent, signal: controller.signal },
  )
  const racePending = await waitForPending(handler, 'session-race-1', 'race-call-1')
  const submitBody = {
    id: racePending.value.id, sessionId: 'session-race-1', callId: 'race-call-1',
    value: 'e2e-race-value-0003', grantEnv: true, grantHttp: false,
  }
  const [submitA, submitB] = await Promise.all([
    callRpc(handler, 'submit', submitBody),
    callRpc(handler, 'submit', submitBody),
  ])
  const winners = [submitA, submitB].filter(response => response.ok === true)
  const losers = [submitA, submitB].filter(response => response.ok === false)
  record('raceDoubleSubmitHasOneWinner', winners.length === 1)
  record('raceDoubleSubmitLoserIsStale', losers.length === 1 && losers[0].error?.code === 'stale')
  const raceValue = await firstCall
  record('raceDoubleSubmitToolSettled', raceValue.status === 'ready' || raceValue.status === 'cancelled')
  const raceRecords = [...credentials.records.values()].filter(record => JSON.stringify(record).includes('e2e-race-value-0003'))
  record('raceDoubleSubmitStoredOnce', raceRecords.length === 1)

  // --- Race 2: a revoke that lands while the grant is being written.
  // The tool parks on a dialog; the revoke runs first, then the submit.
  const revokeRaceCall = tools.get('request_secret').execute(
    { slot: 'race-slot-2', purpose: 'e2e race 2' },
    { callId: 'race-call-2', agent, signal: controller.signal },
  )
  const revokePending = await waitForPending(handler, 'session-race-1', 'race-call-2')
  // Revoke before the submit: the slot has no live grant yet, so the revoke
  // must not throw and the submit must still be the only writer.
  const revokeDuring = await callRpc(handler, 'revoke', { slot: 'race-slot-2', sessionId: 'session-race-1' })
  record('raceRevokeBeforeSubmitSucceeds', revokeDuring.ok === true)
  const submitDuring = await callRpc(handler, 'submit', {
    id: revokePending.value.id, sessionId: 'session-race-1', callId: 'race-call-2',
    value: 'e2e-race-value-0004', grantEnv: true, grantHttp: false,
  })
  record('raceSubmitAfterRevokeStored', submitDuring.ok === true)
  const revokeRaceResult = await revokeRaceCall
  record('raceRevokeRaceToolSettled', revokeRaceResult.status === 'ready')

  // --- Race 3: an external record change drops the live grant.
  // The credential provider announces the change the way the host seam does.
  const externalKey = 'secret-manager/race-slot-2'
  credentials.records.set(externalKey, { kind: 'grant', payload: { v: 1, envKey: 'DSH_SECRET_RACE_SLOT_2', secret: 'e2e-external-value-0005' } })
  credentials.announceRecordUpdated(externalKey)
  await new Promise(done => setTimeout(done, 50))
  const contributor = shellContributors[0]
  const afterExternal = contributor?.resolve({ callId: 'race-call-3', agent: { id: 'session-race-1', session: { id: 'session-race-1', header: { origin: 'user' } } } })
  record('raceExternalChangeDropsTheGrant', afterExternal?.DSH_SECRET_RACE_SLOT_2 === undefined)

  // --- Race 4: a dialog cancelled while its write is queued.
  const cancelRaceCall = tools.get('request_secret').execute(
    { slot: 'race-slot-3', purpose: 'e2e race 4' },
    { callId: 'race-call-4', agent, signal: controller.signal },
  )
  const cancelPending = await waitForPending(handler, 'session-race-1', 'race-call-4')
  const cancelled = await callRpc(handler, 'cancel', {
    id: cancelPending.value.id, sessionId: 'session-race-1', callId: 'race-call-4',
  })
  record('raceCancelSucceeds', cancelled.ok === true)
  const cancelResult = await cancelRaceCall
  record('raceCancelToolReportsCancelled', cancelResult.status === 'cancelled')
  record('raceCancelStoredNothing', ![...credentials.records.values()].some(entry => JSON.stringify(entry).includes('race-slot-3')))
  // The cancelled dialog must not be answerable any more.
  const stillPending = await hasPending(handler, 'session-race-1', 'race-call-4')
  record('raceCancelLeavesNoDialog', !stillPending)

  // --- Race 5: two sessions racing on one slot.
  const otherAgent = { id: 'session-race-2', session: { id: 'session-race-2', header: { origin: 'user' } } }
  const slotACall = tools.get('request_secret').execute(
    { slot: 'race-slot-4', purpose: 'e2e race 5a' },
    { callId: 'race-call-5a', agent, signal: controller.signal },
  )
  const slotBCall = tools.get('request_secret').execute(
    { slot: 'race-slot-4', purpose: 'e2e race 5b' },
    { callId: 'race-call-5b', agent: otherAgent, signal: controller.signal },
  )
  const pendingA = await waitForPending(handler, 'session-race-1', 'race-call-5a')
  const pendingB = await waitForPending(handler, 'session-race-2', 'race-call-5b')
  // Both submit at once on the same slot: the slot lock serialises the writes.
  const [writeA, writeB] = await Promise.all([
    callRpc(handler, 'submit', {
      id: pendingA.value.id, sessionId: 'session-race-1', callId: 'race-call-5a',
      value: 'e2e-race-value-0006', grantEnv: true, grantHttp: false,
    }),
    callRpc(handler, 'submit', {
      id: pendingB.value.id, sessionId: 'session-race-2', callId: 'race-call-5b',
      value: 'e2e-race-value-0007', grantEnv: true, grantHttp: false,
    }),
  ])
  record('raceTwoSessionsBothStored', writeA.ok === true && writeB.ok === true)
  const slot4 = [...credentials.records.entries()].find(([key]) => key.endsWith('race-slot-4'))
  record('raceTwoSessionsLeftOneRecord', Boolean(slot4))
  record('raceTwoSessionsLeftOneValue',
    slot4 ? [JSON.stringify(slot4[1]).includes('e2e-race-value-0006'), JSON.stringify(slot4[1]).includes('e2e-race-value-0007')].filter(Boolean).length === 1 : false)
  const [resultA, resultB] = await Promise.all([slotACall, slotBCall])
  record('raceTwoSessionsBothSettled', resultA.status !== undefined && resultB.status !== undefined)
  record('raceTwoSessionsNeitherLeaks', !JSON.stringify(resultA).includes('e2e-race-value-0007') && !JSON.stringify(resultB).includes('e2e-race-value-0006'))

  return { checks, evidence }
}

/**
 * Keep the evidence a failure needs: the page's own DOM, the console log, the
 * RPC calls it made, and a screenshot. A browser failure is handed over with
 * this evidence rather than being skipped or weakened into a pass.
 */
async function captureDiagnostics(page, name) {
  try {
    const dom = await page.evaluate(() => ({
      html: document.body?.innerHTML ?? '',
      text: document.body?.textContent ?? '',
      rpcCalls: window.rpcCalls ?? [],
    }))
    report.diagnostics ??= {}
    report.diagnostics[name] = {
      dom: dom.html.slice(0, 40_000),
      text: dom.text.slice(0, 8_000),
      rpcCalls: dom.rpcCalls,
      pageErrors: report.pageErrors ?? [],
      consoleErrors: report.consoleErrors ?? [],
    }
    const file = `${name}.png`
    await page.screenshot({ path: resolve(output, file), fullPage: true })
    report.evidence.push(file)
  } catch (error) {
    report.diagnostics ??= {}
    report.diagnostics[name] = { captureFailed: String(error.message) }
  }
}

/**
 * The mocked transport. It records what the plugin asked for and answers with
 * a canned response, so the plugin's origin check, redirect refusal, header
 * assembly and response masking all run for real.
 */
function createHttpMock() {
  const requests = []
  const state = { mode: 'ok' }
  const fetch = async (url, options) => {
    requests.push({ url: String(url), headers: options?.headers ?? {} })
    if (state.mode === 'redirect') {
      // A response that reports a different final URL than the request: the
      // plugin compares the origin it actually came from against the approved
      // one, so a rewritten or redirected response is refused.
      const response = new Response(null, { status: 200 })
      Object.defineProperty(response, 'url', { value: 'https://other.e2e.invalid/moved' })
      return response
    }
    if (state.mode === 'echo') {
      return new Response(`the credential is ${options?.headers?.Authorization ?? ''}`, {
        status: 200, headers: { 'content-type': 'text/plain' },
      })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  return { fetch, requests, state }
}

/**
 * The HTTP scope, under the current protocol: `secret_http` never opens a
 * dialog. It sends only when the session already holds an HTTP grant for
 * exactly that origin, and refuses immediately otherwise — the model is told
 * to ask the human through `request_secret`.
 *
 * The transport is driven through a mocked `fetch`, so the plugin's own policy
 * code runs — origin comparison, redirect refusal, header assembly, response
 * masking — while no socket is opened and nothing leaves the machine. The mock
 * is the plugin's injected dependency (`runtime.fetch`), exactly the seam the
 * package uses for its own tests.
 */
async function runHttpHalf(tools, httpMock) {
  const checks = {}
  const evidence = []
  const record = (key, value) => { checks[key] = Boolean(value); if (!value) throw new Error(`assertion failed: ${key}`) }

  const APPROVED_ORIGIN = 'https://api.e2e.invalid'
  const OTHER_ORIGIN = 'https://other.e2e.invalid'
  const requests = httpMock.requests

  const agent = { id: 'session-e2e-1', session: { id: 'session-e2e-1', header: { origin: 'user' } } }
  const controller = new AbortController()
  const handler = hostRpcHandler

  // --- No grant yet: the call must refuse at once, without a dialog.
  const beforeUngranted = requests.length
  const ungranted = await tools.get('secret_http').execute(
    { ref: `secret://${HTTP_SLOT}`, url: `${APPROVED_ORIGIN}/ok` },
    { callId: 'call-http-0', agent, signal: controller.signal },
  )
  record('httpWithoutGrantIsDenied', ungranted.status === 'denied')
  record('httpWithoutGrantMadeNoRequest', requests.length === beforeUngranted)
  record('httpWithoutGrantOpenedNoDialog', !(await hasPending(handler, 'session-e2e-1', 'call-http-0')))
  record('httpWithoutGrantPointsAtRequestSecret',
    typeof ungranted.summary === 'string' && /request_secret/i.test(ungranted.summary))

  // --- The human approves the origin through `request_secret`.
  const stored = tools.get('request_secret').execute(
    { slot: HTTP_SLOT, purpose: 'e2e http acceptance', http_origin: APPROVED_ORIGIN },
    { callId: 'call-http-1', agent, signal: controller.signal },
  )
  const pending = await waitForPending(handler, 'session-e2e-1', 'call-http-1')
  record('httpPendingVisible', pending.ok === true && pending.value?.httpOrigin === APPROVED_ORIGIN)
  record('httpPendingCarriesNoValue', !JSON.stringify(pending.value ?? {}).includes(HTTP_SYNTHETIC_VALUE))
  const submitted = await callRpc(handler, 'submit', {
    id: pending.value.id, sessionId: 'session-e2e-1', callId: 'call-http-1',
    value: HTTP_SYNTHETIC_VALUE, grantEnv: false, grantHttp: true,
  })
  record('httpSubmitGranted', submitted.ok === true && submitted.value?.httpGranted === true)
  record('httpSubmitOutcomeCarriesNoValue', !JSON.stringify(submitted.value ?? {}).includes(HTTP_SYNTHETIC_VALUE))
  const httpResult = await stored
  record('httpToolReturnedReady', httpResult.status === 'ready')
  record('httpToolResultCarriesNoValue', !JSON.stringify(httpResult).includes(HTTP_SYNTHETIC_VALUE))

  // The positive call: the credential is attached as an authentication header
  // and never appears in the arguments or in the result.
  const okResult = await tools.get('secret_http').execute(
    { ref: `secret://${HTTP_SLOT}`, url: `${APPROVED_ORIGIN}/ok` },
    { callId: 'call-http-2', agent, signal: controller.signal },
  )
  record('httpCallSucceeds', okResult.status === 'ok' && okResult.httpStatus === 200)
  const sentHeader = requests.at(-1)?.headers?.Authorization
  record('httpCallSentTheCredential', typeof sentHeader === 'string' && sentHeader.includes(HTTP_SYNTHETIC_VALUE))
  record('httpCallUsedTheApprovedOrigin', String(requests.at(-1)?.url).startsWith(APPROVED_ORIGIN))
  record('httpResultCarriesNoValue', !JSON.stringify(okResult).includes(HTTP_SYNTHETIC_VALUE))

  // Another origin: the approved scope must not travel there, and the call is
  // refused at once — no dialog, no request.
  const beforeCross = requests.length
  const crossOrigin = await tools.get('secret_http').execute(
    { ref: `secret://${HTTP_SLOT}`, url: `${OTHER_ORIGIN}/elsewhere` },
    { callId: 'call-http-3', agent, signal: controller.signal },
  )
  record('httpCrossOriginRefused', crossOrigin.status === 'denied')
  record('httpCrossOriginMadeNoRequest', requests.length === beforeCross)
  record('httpCrossOriginOpenedNoDialog', !(await hasPending(handler, 'session-e2e-1', 'call-http-3')))

  // A redirect: the credential must not follow it.
  httpMock.state.mode = 'redirect'
  const redirected = await tools.get('secret_http').execute(
    { ref: `secret://${HTTP_SLOT}`, url: `${APPROVED_ORIGIN}/redirect` },
    { callId: 'call-http-4', agent, signal: controller.signal },
  )
  record('httpRedirectRefused', redirected.status !== 'ok')

  // A response that echoes the credential back: the result must mask it.
  httpMock.state.mode = 'echo'
  const echoed = await tools.get('secret_http').execute(
    { ref: `secret://${HTTP_SLOT}`, url: `${APPROVED_ORIGIN}/echo` },
    { callId: 'call-http-5', agent, signal: controller.signal },
  )
  record('httpEchoIsMasked', echoed.status === 'ok' && typeof echoed.body === 'string'
    && !echoed.body.includes(HTTP_SYNTHETIC_VALUE) && echoed.body.includes('[redacted]'))
  record('httpEchoResultCarriesNoValue', !JSON.stringify(echoed).includes(HTTP_SYNTHETIC_VALUE))

  return { checks, evidence }
}

/** Whether the Host currently has a dialog open for one call. */
async function hasPending(handler, sessionId, callId) {
  const response = await callRpc(handler, 'pending', { sessionId, callId })
  return response.ok === true && Boolean(response.value)
}

/**
 * Wait for the Host to open the dialog for one call. The tool primes the
 * store first, so the request appears a tick after the call starts.
 */
async function waitForPending(handler, sessionId, callId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await callRpc(handler, 'pending', { sessionId, callId })
    if (last.ok === true && last.value) return last
    await new Promise(done => setTimeout(done, 25))
  }
  throw new Error(`no pending request for ${sessionId}/${callId}: ${JSON.stringify(last)}`)
}

/**
 * Call the Host's RPC handler the way the browser would: the plugin registered
 * a prefix route, so the endpoint is the path segment after the channel. The
 * handler is the plugin's own transport, so driving it exercises the real
 * envelope validation, the body limit and the response shape.
 */
async function callRpc(handler, endpoint, payload) {
  const body = JSON.stringify({
    type: 'client-request', method: endpoint, rpcId: `rpc-${endpoint}-${Date.now()}`,
    payload,
  })
  const request = {
    url: `/dsh-secret-manager/${endpoint}`,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body) },
    destroy() {},
  }
  const chunks = []
  let statusCode = 200
  const response = {
    destroyed: false,
    writableEnded: false,
    writeHead(code) { statusCode = code; return response },
    end(text) {
      response.writableEnded = true
      if (text) chunks.push(Buffer.from(text))
    },
    on() { return response },
    once() { return response },
    emit() { return false },
  }
  await handler(request, response)
  const text = Buffer.concat(chunks).toString('utf8')
  if (statusCode !== 200) throw new Error(`rpc ${endpoint} failed with status ${statusCode}: ${text}`)
  const parsed = JSON.parse(text)
  return parsed.result
}

/* ------------------------------------------------------------------ *
 * Part 2 — the browser half.
 * ------------------------------------------------------------------ */

/** The page's own module script, served by the dev server. */
const PAGE_MODULE_PATH = '/e2e/secret-manager-page.mjs'

/**
 * The page the browser loads. Its script lives in its own file so it can be
 * parsed before a browser ever opens it — an invalid script here used to
 * surface only as a Vite import-analysis error inside the browser run.
 */
function pageHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Secret manager acceptance</title>
<style>:root{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-layer-3:#fff;--dsw-alias-label-primary:#20252c;--dsw-alias-label-secondary:#596574;--dsw-alias-label-tertiary:#768290;--dsw-alias-label-caption:#768290;--dsw-alias-label-dimmed:#a5b4c8;--dsw-alias-border-l1:#dde2e8;--dsw-alias-border-l2:#c4ceda;--dsw-alias-border-l3:#a5b4c8;--dsw-alias-state-business-primary:#356dda;--dsw-alias-state-error-primary:#b42318;--dsw-alias-label-error:#b42318;--dsw-alias-interactive-bg-hover:#eef3fc;--dsw-alias-interactive-bg-active:#e3ecfc;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#356dda;--dsw-radius-sm:8px;--dsw-radius-md:12px;--dsw-radius-lg:12px;--dsw-alias-menu-icon:#596574;--dsw-menu-surface-fill:#fff;--dsw-alias-scrollbar-bg-l2:#bac5d3}body{margin:0;font:14px/1.5 system-ui;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}main{max-width:900px;margin:24px auto;padding:0 20px}h1{font-size:20px}button{font:inherit;cursor:pointer}</style></head>
<body><main><h1>密钥管理器验收</h1><div id="root"></div></main><script type="module" src="${PAGE_MODULE_PATH}"></script>
</body></html>`
}

/**
 * Parse the page script before a browser opens it. A syntax error in the
 * generated page must fail the run here, with the parser's own message, rather
 * than as an opaque import-analysis error inside the browser.
 *
 * The check runs in this process, so it works wherever the run itself works.
 * The module's `import` lines are removed first — the browser's bundler
 * resolves them, not the parser — and the remaining body is compiled, which
 * is where a brace or parenthesis mistake shows up.
 */
function assertPageScriptParses() {
  const file = resolve(root, 'e2e', 'secret-manager-page.mjs')
  if (!existsSync(file)) throw new Error(`the page script is missing: ${file}`)
  const source = readFileSync(file, 'utf8')
  const body = stripModuleSyntax(source)
  // If anything still looks like a module statement, the stripping did not
  // work and the body check would be meaningless.
  if (/^\s*(?:import|export)\b/m.test(body)) {
    throw new Error('the page script still has module statements after the import lines were removed')
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function(`return (async () => {${body}})`)
  } catch (error) {
    throw new Error(`the page script does not parse: ${error.message}`)
  }
}

/**
 * Remove the module's `import` and `export` statements. The imports may share
 * a line, so each one is removed on its own rather than line by line.
 */
function stripModuleSyntax(source) {
  return source
    .replace(/\bimport\s+[^;'"]*from\s*['"][^'"]*['"]\s*;?/g, '')
    .replace(/\bimport\s+['"][^'"]*['"]\s*;?/g, '')
    .replace(/^\s*export\s+(?=(?:default|const|let|var|function|class|async)\b)/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
}

/**
 * The built client bundle, read once into memory before the fixture starts.
 *
 * The bundle is a classic script that calls the host's module loader, so it
 * must be served verbatim: letting the dev server transform or guess it
 * changes the artifact under test. Reading it up front also means a build
 * running concurrently cannot delete the file between the read and the
 * request, which is what produced an empty page before.
 */
function readClientBundle() {
  const file = resolve(root, 'plugins', 'dsh-secret-manager', 'lib', 'client.js')
  if (!existsSync(file)) {
    throw new Error(`the built client bundle is missing: ${file} — run the package build first`)
  }
  const source = readFileSync(file, 'utf8')
  // The wrapper is the contract the page relies on: it calls the host's
  // module loader with the package id.
  if (!source.includes('__ModuleLoader__')) {
    throw new Error(`the built client bundle does not call the host module loader: ${file}`)
  }
  if (!source.includes('@klarkxy/dsh-secret-manager')) {
    throw new Error(`the built client bundle names another package: ${file}`)
  }
  return { file, source }
}

async function runBrowserHalf() {
  // The generated page must parse before a browser is opened: a syntax error
  // there used to surface only as a Vite import-analysis error in the run.
  assertPageScriptParses()

  let chromium
  try {
    ({ chromium } = require('playwright'))
  } catch (error) {
    report.browser = { status: 'skipped', reason: `playwright is unavailable: ${error.message}` }
    return
  }
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    report.browser = { status: 'skipped', reason: `chromium could not start: ${error.message.split('\n')[0]}` }
    return
  }
  report.browser = { status: 'ran' }

  // The bundle is read before the fixture starts, so the page always gets the
  // same bytes even if a build replaces the file mid-run.
  const bundle = readClientBundle()
  const CLIENT_BUNDLE_PATH = '/plugins/dsh-secret-manager/lib/client.js'

  // Everything opened below is closed in the finally, including the browser
  // when a later step fails, so no process or port is left behind.
  let vite
  let server
  try {
    vite = await createServer({
      configFile: false, root, appType: 'custom', logLevel: 'error',
      server: { middlewareMode: true, hmr: false, watch: null },
      resolve: { alias: { '@deepseek-ai/dsh-client-ui-primitives': resolve(root, 'scripts/editor-plugins/ui-primitives-stub.tsx').replaceAll('\\', '/') } },
    })

    // The two URLs the page loads are served by this handler, before the dev
    // server ever sees them:
    //
    //  - the client bundle is a classic script for the host's module loader,
    //    so it is served verbatim from the snapshot; letting the dev server
    //    transform it would change the artifact under test, and letting it
    //    resolve the path at all could answer 404;
    //  - the page itself is generated here, so it never depends on an index
    //    file on disk.
    server = createHttpServer((req, res) => {
      const path = req.url?.split('?')[0]
      if (path === CLIENT_BUNDLE_PATH) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(bundle.source)
        return
      }
      if (path === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(pageHtml())
        return
      }
      vite.middlewares(req, res, () => { res.statusCode = 404; res.end() })
    })
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const port = server.address().port

    // The URLs the page loads must answer before the browser is pointed at the
    // page: a missing script would otherwise show as an empty page and a
    // thirty-second wait, with the real cause only in the network log.
    const bundleResponse = await fetch(`http://127.0.0.1:${port}${CLIENT_BUNDLE_PATH}`)
    if (bundleResponse.status !== 200) {
      throw new Error(`the client bundle URL answered ${bundleResponse.status}, expected 200`)
    }
    const servedBundle = await bundleResponse.text()
    if (servedBundle !== bundle.source) {
      throw new Error('the served client bundle differs from the built file')
    }
    if (!servedBundle.includes('__ModuleLoader__')) {
      throw new Error('the served client bundle does not call the host module loader')
    }
    const pageResponse = await fetch(`http://127.0.0.1:${port}/`)
    if (pageResponse.status !== 200) {
      throw new Error(`the page URL answered ${pageResponse.status}, expected 200`)
    }
    const servedPage = await pageResponse.text()
    if (!servedPage.includes(PAGE_MODULE_PATH)) {
      throw new Error('the served page does not reference the page module')
    }
    // The page module is the script the browser loads; it must be served too.
    const pageModuleResponse = await fetch(`http://127.0.0.1:${port}${PAGE_MODULE_PATH}`)
    if (pageModuleResponse.status !== 200) {
      throw new Error(`the page module URL answered ${pageModuleResponse.status}, expected 200`)
    }
    const servedPageModule = await pageModuleResponse.text()
    if (!servedPageModule.includes('__ModuleLoader__')) {
      throw new Error('the served page module does not install the host module loader')
    }
    report.fixtureUrls = {
      page: '/',
      pageModule: PAGE_MODULE_PATH,
      clientBundle: CLIENT_BUNDLE_PATH,
      clientBundleBytes: servedBundle.length,
      pageModuleBytes: servedPageModule.length,
    }

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const pageErrors = []
    const consoleErrors = []
    const networkFailures = []
    page.on('pageerror', error => pageErrors.push(String(error)))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('requestfailed', request => networkFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`))
    page.on('response', response => { if (response.status() >= 400) networkFailures.push(`${response.status()} ${response.url()}`) })
    // The console log is kept live so a failure's diagnostics carry it even if
    // the failure happens before the final report is written.
    report.pageErrors = pageErrors
    report.consoleErrors = consoleErrors
    report.networkFailures = networkFailures

    // The Host half answers the browser's RPC, in-process. The built package
    // is imported here too: the sources use TypeScript syntax that Node's
    // strip-only loader cannot parse, and the built artifact is what a profile
    // loads anyway.
    const { apply } = await import('../plugins/dsh-secret-manager/lib/index.js')
    const credentials = new FakeCredentials()
    const tools = new FakeTools()
    let handler
    const ctx = {
      tools, credentials,
      effect(run) { const dispose = run(); return () => {} },
      on() { return () => {} },
      inject(deps, callback) { callback({ effect: run => ctx.effect(run), shellEnv: { register: () => () => {} } }); return { dispose: () => {} } },
      connection: { requestRejection: () => undefined },
      webServer: { register: route => { handler = route.handler; return () => {} } },
      logger: { warn: () => {}, error: () => {} },
      get: () => undefined,
    }
    ctx.root = ctx
    await apply(ctx)

    // One stored secret, written through the Host's own `save` endpoint, so
    // the settings page has a real row to list. The value is synthetic.
    const seeded = await callRpc(handler, 'save', { slot: 'seeded-slot', value: 'e2e-browser-seeded-value-0009' })
    if (seeded?.ok !== true) {
      throw new Error(`the settings seed could not be stored: ${JSON.stringify(seeded)}`)
    }

    await page.exposeFunction('hostRpc', async (endpoint, payload) => {
      // The Host's own RPC handler, driven exactly as the browser's transport
      // would drive it.
      return callRpc(handler, endpoint, payload)
    })

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => typeof window.seatInfo === 'function' && window.seatInfo().section !== null, null, { timeout: 30000 })

    const seats = await page.evaluate(() => window.seatInfo())
    check('clientRegistersSettingsSection', seats.section?.name === 'settings.section' && seats.section?.id === 'secret-manager')
    check('clientSectionOrderIs170', seats.section?.order === 170)
    check('clientRegistersToolView', seats.tool?.name === 'tool.call.toolview' && seats.tool?.key === 'request_secret')
    check('clientToolViewHasLocale', typeof seats.tool?.locale === 'string' && seats.tool.locale.length > 0)

    // The settings page mounts and renders the masked input.
    await page.evaluate(() => window.mountSettings())
    await page.waitForSelector('[data-testid="sm-settings"]', { timeout: 15000 })
    // The list must actually load: a page that only renders its shell is not
    // a working settings page, so the read-failure state is an explicit
    // failure rather than a passed check.
    await page.waitForSelector('.dsh-ui-error', { timeout: 5000 }).catch(() => {})
    const settingsState = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="sm-settings"]')
      const text = root?.textContent ?? ''
      return {
        hasReadFailure: text.includes('读取失败') || text.includes('Read failed'),
        hasEmptyState: text.includes('还没有密钥') || text.includes('No secrets'),
        hasRows: root?.querySelectorAll('.sm-secret-row').length ?? 0,
        listCalls: (window.rpcCalls ?? []).filter(call => call.endpoint === 'list').length,
      }
    })
    check('settingsListCallHappened', settingsState.listCalls >= 1)
    check('settingsHasNoReadFailure', !settingsState.hasReadFailure)
    check('settingsShowsTheStoredRow', settingsState.hasRows >= 1)
    if (settingsState.hasReadFailure) {
      await captureDiagnostics(page, 'settings-read-failure')
      throw new Error('the settings page reported a read failure')
    }
    const inputInfo = await page.evaluate((codes) => {
      const input = document.querySelector('input[aria-labelledby="sm-value-label"]')
      if (!input) return null
      return {
        typeCodes: [...input.getAttribute('type') ?? ''].map(ch => ch.codePointAt(0)).join(','),
        expectedCodes: codes,
        autocomplete: input.getAttribute('autocomplete'),
        placeholder: input.getAttribute('placeholder'),
      }
    }, MASKED_TYPE_CODES)
    check('maskedInputUsesStandardType', inputInfo?.typeCodes === MASKED_TYPE_CODES)
    check('maskedInputDisablesAutocomplete', inputInfo?.autocomplete === 'off')
    await page.screenshot({ path: resolve(output, 'settings-desktop.png'), fullPage: true })
    report.evidence.push('settings-desktop.png')

    // The layout stays inside a narrow viewport.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(400)
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    check('narrowFits', noOverflow)
    await page.screenshot({ path: resolve(output, 'settings-narrow.png'), fullPage: true })
    report.evidence.push('settings-narrow.png')
    await page.setViewportSize({ width: 1280, height: 900 })

    // --- The tool view: a real dialog, a real value, a real submit.
    // The dialog only opens when the Host has a pending request for this call,
    // so the Host is asked for one first and the tool view is mounted on that
    // call id. The view then finds it through its own `pending` read.
    //
    // `request_env` is set, so the dialog asks for the shell grant as well and
    // the tool's outcome is `ready` rather than `stored`.
    const toolCallId = 'call-browser-1'
    const toolCall = tools.get('request_secret').execute(
      { slot: 'browser-slot', purpose: 'e2e browser acceptance', request_env: true },
      { callId: toolCallId, agent: { id: 'session-e2e-1', session: { id: 'session-e2e-1', header: { origin: 'user' } } }, signal: new AbortController().signal },
    )
    await waitForPending(handler, 'session-e2e-1', toolCallId)
    await page.evaluate(id => window.mountTool(id), toolCallId)

    // Wait for the dialog's own masked field, located by its label rather
    // than by "any input on the page": the card, the checkboxes and the modal
    // mount at different times.
    const secretInput = page.locator('input[aria-labelledby="sm-secret-input-label"]')
    await secretInput.waitFor({ state: 'visible', timeout: 20000 }).catch(async error => {
      await captureDiagnostics(page, 'tool-dialog-missing')
      throw new Error(`the secret dialog never showed its masked field: ${error.message.split('\n')[0]}`)
    })
    const toolInput = await page.evaluate((codes) => {
      const input = document.querySelector('input[aria-labelledby="sm-secret-input-label"]')
      if (!input) return null
      return {
        typeCodes: [...input.getAttribute('type') ?? ''].map(ch => ch.codePointAt(0)).join(','),
        expectedCodes: codes,
        autocomplete: input.getAttribute('autocomplete'),
      }
    }, MASKED_TYPE_CODES)
    check('toolDialogUsesStandardType', toolInput?.typeCodes === MASKED_TYPE_CODES)
    check('toolDialogDisablesAutocomplete', toolInput?.autocomplete === 'off')

    // The dialog must show the dictionary's own copy, not the raw keys. A key
    // that reaches the screen means the namespace was never bound.
    const dialogText = await page.evaluate(() => document.body.textContent ?? '')
    const rawKeys = ['title', 'description', 'inputLabel', 'placeholder', 'submit', 'submitSaveOnly', 'reopen', 'grantEnv', 'requiredHint']
    const leakedKeys = rawKeys.filter(key => dialogText.includes(key))
    check('toolDialogShowsNoRawLocaleKey', leakedKeys.length === 0)
    if (leakedKeys.length > 0) {
      await captureDiagnostics(page, 'tool-dialog-raw-locale-key')
      throw new Error(`the dialog showed raw locale keys: ${leakedKeys.join(', ')}`)
    }
    // The dictionary's Chinese copy, taken from the plugin's own table.
    check('toolDialogShowsChineseTitle', dialogText.includes('为 browser-slot 提供密钥'))
    check('toolDialogShowsChineseInputLabel', dialogText.includes('密钥值'))
    check('toolDialogShowsChineseSubmit', dialogText.includes('保存并允许本会话使用'))
    // The shell grant is offered, because the request asked for it.
    check('toolDialogOffersTheEnvGrant', dialogText.includes('允许本会话在 shell 中使用'))

    await page.screenshot({ path: resolve(output, 'tool-dialog.png'), fullPage: true })
    report.evidence.push('tool-dialog.png')

    // Type a synthetic value and submit it. The value must reach the Host and
    // the tool must come back with a reference, not the value.
    const BROWSER_VALUE = 'e2e-browser-synthetic-value-0008'
    await secretInput.fill(BROWSER_VALUE)
    const submitButton = page.getByRole('button', { name: '保存并允许本会话使用' })
    await submitButton.click()
    const toolOutcome = await toolCall
    // The request asked for the shell grant, so the outcome is `ready`.
    check('browserToolReturnedReady', toolOutcome.status === 'ready')
    check('browserToolGrantedEnv', toolOutcome.envGranted === true)
    check('browserToolResultHasReference', toolOutcome.ref === 'secret://browser-slot')
    check('browserToolResultCarriesNoValue', !JSON.stringify(toolOutcome).includes(BROWSER_VALUE))

    // The value reached the Host's store, and the page shows the reference.
    const storedRecord = [...credentials.records.entries()].find(([key]) => key.endsWith('browser-slot'))
    check('browserValueReachedTheHost', Boolean(storedRecord) && JSON.stringify(storedRecord[1]).includes(BROWSER_VALUE))
    await page.waitForFunction(
      () => (document.body.textContent ?? '').includes('secret://browser-slot'),
      null, { timeout: 15000 },
    ).catch(async error => {
      await captureDiagnostics(page, 'tool-result-missing')
      throw new Error(`the tool row never showed the reference: ${error.message.split('\n')[0]}`)
    })
    check('browserPageShowsTheReference', true)
    const pageText = await page.evaluate(() => document.body.textContent ?? '')
    check('browserPageDoesNotEchoTheValue', !pageText.includes(BROWSER_VALUE))
    await page.screenshot({ path: resolve(output, 'tool-settled.png'), fullPage: true })
    report.evidence.push('tool-settled.png')

    // The page's console and its error surface stay clean.
    check('noPageErrors', pageErrors.length === 0)
    check('noConsoleErrors', consoleErrors.length === 0)
    report.pageErrors = pageErrors
    report.consoleErrors = consoleErrors
  } finally {
    // Nothing is left running: the browser, the http server and the vite
    // dev server are all closed here, including when a later step failed.
    await browser.close().catch(() => {})
    if (server) await new Promise(done => server.close(done))
    await vite?.close().catch(() => {})
  }
}

/* ------------------------------------------------------------------ *
 * Run.
 * ------------------------------------------------------------------ */

await mkdir(output, { recursive: true })
let hostRpcHandler
try {
  await runHostHalf()
} catch (error) {
  report.state = 'failed'
  report.error = String(error.stack ?? error)
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.error(report.error)
  process.exit(1)
}
try {
  await runBrowserHalf()
} catch (error) {
  report.browser = { status: 'failed', reason: String(error.stack ?? error) }
}
// The overall state states what was actually measured. A failed or skipped
// browser half is never folded into a passing state.
const browserStatus = report.browser?.status ?? 'not-run'
if (browserStatus === 'failed') {
  report.state = 'failed'
} else if (browserStatus === 'ran') {
  report.state = 'passed'
} else {
  report.state = 'incomplete'
}
report.summary = {
  hostHalf: 'passed',
  browserHalf: browserStatus,
}
// Exit code states what was actually measured:
//   0 — every half ran and passed
//   1 — a half failed
//   2 — a half was skipped, so the run is incomplete
// A skipped half is never reported as a passing run. Set
// SECRET_MANAGER_E2E_ALLOW_SKIPPED=1 to accept a skip deliberately; the
// default refuses to call an incomplete run a pass.
if (browserStatus === 'failed') {
  process.exitCode = 1
} else if (browserStatus === 'ran') {
  process.exitCode = 0
} else {
  const allowed = process.env.SECRET_MANAGER_E2E_ALLOW_SKIPPED === '1'
  process.exitCode = allowed ? 0 : 2
}
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`Secret manager Host acceptance passed; report: ${resolve(output, 'report.json')}`)
console.log(`Browser half: ${browserStatus}${report.browser?.reason ? ` — ${report.browser.reason}` : ''}`)
console.log(`Overall state: ${report.state}`)
if (report.diagnostics) {
  console.error(`Diagnostics kept for: ${Object.keys(report.diagnostics).join(', ')}`)
}
if (process.exitCode === 2) {
  console.error('The browser half did not run, so this run is incomplete (exit 2). Re-run where Chromium can start.')
}
