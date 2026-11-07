import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

// Browser interaction at the registered settings seat, backed by the real
// Cordis contribution bus/cast CAS. Owner storage is an isolated fixture; the
// page under test is the Subagents section (cast routes, efforts, tendencies).
const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'e2e/out/model-hub-settings')
const require = createRequire(resolve(root, 'package.json'))
const hostRequire = createRequire(resolve(root, 'plugins/dsh-model-hub/package.json'))
const vitestRequire = createRequire(require.resolve('vitest/package.json'))
const { createServer } = await import(pathToFileURL(vitestRequire.resolve('vite')).href)
const { Context } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Model Management acceptance</title>
<style>:root{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-layer-3:#fff;--dsw-alias-label-primary:#20252c;--dsw-alias-label-secondary:#596574;--dsw-alias-label-tertiary:#768290;--dsw-alias-label-caption:#768290;--dsw-alias-label-dimmed:#a5b4c8;--dsw-alias-border-l1:#dde2e8;--dsw-alias-border-l2:#c4ceda;--dsw-alias-border-l3:#a5b4c8;--dsw-alias-state-business-primary:#356dda;--dsw-alias-state-error-primary:#b42318;--dsw-alias-label-error:#b42318;--dsw-alias-interactive-bg-hover:#eef3fc;--dsw-alias-interactive-bg-active:#e3ecfc;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#356dda;--dsw-radius-sm:8px;--dsw-radius-md:12px;--dsw-radius-lg:12px;--dsw-alias-menu-icon:#596574;--dsw-menu-surface-fill:#fff;--dsw-alias-scrollbar-bg-l2:#bac5d3}body{margin:0;font:14px/1.5 system-ui;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}main{max-width:860px;margin:24px auto;padding:0 20px}h1{font-size:20px}input{box-sizing:border-box;max-width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}button{font:inherit;cursor:pointer}button:disabled{cursor:default;opacity:.6}</style></head>
<body><main><h1>模型管理</h1><div id="root"></div></main><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import * as ReactDOM from 'react-dom'; import * as jsx from 'react/jsx-runtime'; import * as primitives from '/scripts/editor-plugins/ui-primitives-stub.tsx';
let apply;window.__ModuleLoader__={load({id,factory}){if(id!=='@klarkxy/dsh-model-hub')throw Error('Wrong bundle');const modules={'react':React,'react-dom':ReactDOM,'react/jsx-runtime':jsx,'@deepseek-ai/dsh-client-ui-primitives':primitives};apply=factory(name=>{if(!(name in modules))throw Error('Unexpected module '+name);return modules[name]}).apply}};
await new Promise((done,failed)=>{const script=document.createElement('script');script.src='/plugins/dsh-model-hub/lib/client.js';script.onload=done;script.onerror=failed;document.head.append(script)});
let active='zh-CN'; const listeners=new Set(); window.switchLocale=next=>{active=next;document.documentElement.lang=next;document.querySelector('h1').textContent=next.startsWith('zh')?'模型管理':'Model Management';for(const listener of listeners)listener()};
// The fixture carries real Cordis invalidations into the native subscriber's
// stream shape. Installed DSH transport/reconnection remains a separate check.
const streams=new Set(); window.receiveHubChange=frame=>{for(const receive of streams)receive(frame)};
const remote={session:{modelCatalog:()=>window.hostCatalog()},$mount:async()=>async()=>{},KlarkxyDshModelHubModelSettingsChanges:{async *watch(signal){const pending=[];let wake;const receive=frame=>{pending.push(frame);wake?.()};streams.add(receive);const aborted=()=>wake?.();signal.addEventListener('abort',aborted,{once:true});try{yield {kind:'ready'};while(!signal.aborted){if(pending.length){yield pending.shift();continue}await new Promise(done=>{wake=done;if(pending.length||signal.aborted)done()});wake=undefined}}finally{streams.delete(receive);signal.removeEventListener('abort',aborted)}}},$stream({open}){const controller=new AbortController();const iterator=open(controller.signal)[Symbol.asyncIterator]();return {async *[Symbol.asyncIterator](){while(!controller.signal.aborted){const item=await iterator.next();if(item.done)return;yield {generation:1,value:item.value,signal:controller.signal,accept(){}}}},async dispose(){controller.abort();await iterator.return?.()}}}};
const seats=new Set(['settings.section','settings.section.icon','conversation.session.header.lineage','conversation.session.header.actions']);
let spec,component; const api={connection:{rpc:{call:async(_channel,endpoint,payload)=>{try{return {ok:true,value:await window.hubRpc(endpoint,payload)}}catch(error){return {ok:false,error:{message:error.message}}}}}},remote,effect:run=>run(),inject(_deps,run){const cleanup=[];run({remote,effect:effect=>cleanup.push(effect())});return {dispose(){for(const stop of cleanup)stop()}}},get:()=>undefined,locale:{getSnapshot:()=>({active}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},bind:()=>key=>key},sessions:{refreshProjections:async()=>{}},uiWorkspace:{openSession(){}},sidebarRight:{openResource(){}},slots:{inject(name,run){if(!seats.has(name))throw Error('Unexpected slot: '+name);run()},register(options,render){if(options.name==='settings.section'){spec=options;component=render}}}};
await apply(api);if(!spec||spec.name!=='settings.section'||spec.id!=='model-hub'||spec.order!==180)throw Error('Wrong settings seat');createRoot(document.getElementById('root')).render(React.createElement(component,{...spec.inject()}));
</script></body></html>`

const nativeCatalog = { groups: [{ id: 'host', name: 'DSH', models: [
  { id: 'one', name: 'Reasoner', reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }] } },
  { id: 'two', name: 'Writer' },
] }] }
let vite, server, browser
const ctx = new Context()
try {
  await mkdir(output, { recursive: true })
  const aliases = {
    '@deepseek-ai/dsh-client-ui-primitives': resolve(root, 'scripts/editor-plugins/ui-primitives-stub.tsx'),
    '@klarkxy/dsh-model-route/ui': resolve(root, 'plugins/dsh-model-route/src/ui.tsx'),
    '@klarkxy/dsh-model-route': resolve(root, 'plugins/dsh-model-route/src/index.ts'),
    '@klarkxy/dsh-plugin-kit/model-settings': resolve(root, 'plugins/dsh-plugin-kit/src/model-settings.ts'),
    '@klarkxy/dsh-plugin-kit/official-ui': resolve(root, 'plugins/dsh-plugin-kit/src/official-ui.ts'),
    'react-dom/client': require.resolve('react-dom/client'), 'react-dom': require.resolve('react-dom'),
    'react/jsx-runtime': require.resolve('react/jsx-runtime'), 'react/jsx-dev-runtime': require.resolve('react/jsx-dev-runtime'), react: require.resolve('react'),
  }
  vite = await createServer({ configFile: false, root, appType: 'custom', logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null }, resolve: { alias: Object.fromEntries(Object.entries(aliases).map(([key, file]) => [key, file.replaceAll('\\', '/')])) },
    plugins: [{ name: 'hub-fixture', configureServer(instance) { return () => instance.middlewares.use(async (req, res, next) => {
      if (req.url?.split('?')[0] !== '/') return next()
      try { res.setHeader('Content-Type', 'text/html'); res.end(await instance.transformIndexHtml('/index.html', html)) } catch (error) { next(error) }
    }) } }],
  })
  const { notifyModelSettingsChanged, MODEL_SETTINGS_CHANGED_EVENT } = await vite.ssrLoadModule('/plugins/dsh-plugin-kit/src/model-settings.ts')
  const { createCast, CAST_NAMESPACE, CAST_TENDENCIES_NAMESPACE } = await vite.ssrLoadModule('/plugins/dsh-model-hub/src/cast.ts')
  const castFile = resolve(output, 'profile/data/model-hub/cast.json')
  await mkdir(dirname(castFile), { recursive: true })
  // v1 store holds tendencies only; the first preference write migrates to v3.
  await writeFile(castFile, JSON.stringify({ schemaVersion: 1, tendencies: { '["host","one"]': 'reviews' } }))
  let castRevision = 0, castValue = { enabled: false, allowedModels: [{ provider: 'host', model: 'one' }] }
  let castReadFail = false, failCastRefreshAfterCommit = false, nativeWrites = 0
  let castGets = 0, catalogReads = 0, catalogFail = false, preferenceWrites = 0
  const cast = createCast({ profileDir: resolve(output, 'profile'), describe: () => {
    if (castReadFail) throw Error('阵容读取离线')
    return [{ ns: CAST_NAMESPACE, revision: castRevision, schema: {}, value: castValue }]
  },
    async mutate(ns, ops, expectedRevision) {
      assert.equal(ns, CAST_NAMESPACE); assert.equal(expectedRevision, castRevision)
      for (const op of ops) {
        if (op.path[0] === 'enabled') castValue.enabled = op.value
        else if (op.op === 'unset') castValue.allowedModels.splice(Number(op.path[1]), 1)
        else castValue.allowedModels[Number(op.path[1])] = op.value
      }
      castRevision++; nativeWrites++; if (failCastRefreshAfterCommit) castReadFail = true
      await ctx.parallel('settings/document-updated', CAST_NAMESPACE, castRevision)
    }, notifyTendenciesChanged: revision => notifyModelSettingsChanged(ctx, CAST_TENDENCIES_NAMESPACE, revision),
  })
  const pages = new Set()
  ctx.on(MODEL_SETTINGS_CHANGED_EVENT, change => Promise.all([...pages].map(tab => tab.evaluate(frame => window.receiveHubChange(frame), { kind: 'changed', ...change }).catch(() => {}))))
  ctx.on('settings/document-updated', (ns, revision) => Promise.all([...pages].map(tab => tab.evaluate(frame => window.receiveHubChange(frame), { kind: 'changed', ns, revision }).catch(() => {}))))
  const signal = new AbortController().signal
  server = createHttpServer((req, res) => vite.middlewares(req, res, () => { res.statusCode = 404; res.end() }))
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1080, height: 900 } })
  const errors = []
  let tendencyAttempts = 0, tendencyWrites = 0
  const attach = async tab => {
    pages.add(tab)
    tab.on('pageerror', error => errors.push(error.message))
    await tab.exposeFunction('hubRpc', async (endpoint, payload) => {
      if (endpoint === 'cast.get') { castGets++; return cast.getCast() }
      if (endpoint === 'cast.setEnabled') return cast.setEnabled(payload.enabled, payload.expectedRevision)
      if (endpoint === 'cast.addRoute') return cast.addRoute(payload.route, payload.expectedRevision)
      if (endpoint === 'cast.setRoute') return cast.setRoute(payload.index, payload.route, payload.expectedRevision)
      if (endpoint === 'cast.removeRoute') return cast.removeRoute(payload.index, payload.expectedRevision)
      if (endpoint === 'cast.setTendency') {
        tendencyAttempts++
        const result = cast.setTendency(payload.provider, payload.model, payload.tendency, payload.expectedRevision, signal)
        tendencyWrites++; return result
      }
      if (endpoint === 'cast.setPreferences') {
        const result = cast.setRoutePreferences(payload.provider, payload.model, payload.preferences, payload.expectedRevision, signal)
        preferenceWrites++; return result
      }
      throw Error('Unknown endpoint: ' + endpoint)
    })
    await tab.exposeFunction('hostCatalog', () => { catalogReads++; if (catalogFail) throw Error('目录离线'); return nativeCatalog })
  }
  const headRefresh = tab => tab.locator('.cast-head').getByRole('button', { name: '刷新', exact: true })
  const castSwitch = tab => tab.getByRole('switch', { name: '启用子代理选模' })
  await attach(page)
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.locator('.cast-root').waitFor()
  await headRefresh(page).waitFor()
  await castSwitch(page).waitFor()
  // One persisted row: the model menu, its saved tendency, and the remove cell.
  const tendency = () => page.getByRole('textbox', { name: 'host / one 的任务倾向', exact: true })
  assert.equal(await tendency().inputValue(), 'reviews')
  assert.equal(await castSwitch(page).getAttribute('aria-checked'), 'false')
  assert.ok(castGets >= 1 && catalogReads >= 1)
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true })

  // Add a second model through the add control: the native CAS owns the route.
  await page.getByRole('button', { name: '添加模型…', exact: true }).click()
  await page.getByRole('menuitem', { name: /模型/ }).click()
  await page.getByRole('menuitemradio', { name: /Writer/ }).click()
  await page.getByRole('button', { name: 'host / two', exact: true }).waitFor()
  assert.equal(castValue.allowedModels.length, 2); assert.equal(nativeWrites, 1)

  // A reasoning effort is a plugin-side preference write through cast.setPreferences.
  await page.getByRole('button', { name: 'host / one', exact: true }).click()
  await page.getByRole('menuitem', { name: /思考强度/ }).click()
  await page.getByRole('menuitemradio', { name: '高', exact: true }).click()
  await page.getByRole('button', { name: 'host / one', exact: true }).filter({ hasText: '高' }).waitFor()
  assert.equal(preferenceWrites, 1)
  assert.equal(JSON.parse(readFileSync(castFile, 'utf8')).efforts['["host","one"]'], 'high')
  assert.ok((await page.getByRole('button', { name: 'host / one', exact: true }).textContent()).includes('高'))

  // A duplicate route is rejected with a banner; refreshing clears the write error.
  const nativeBefore = nativeWrites
  await page.getByRole('button', { name: 'host / one', exact: true }).click()
  await page.getByRole('menuitem', { name: /模型/ }).click()
  await page.getByRole('menuitemradio', { name: /Writer/ }).click()
  await page.locator('.cast-banner').filter({ hasText: '路由 host/two 已在列表中' }).waitFor()
  assert.equal(nativeWrites, nativeBefore)
  await page.locator('.cast-banner').getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('button', { name: 'host / one', exact: true }).waitFor()

  // A stale native revision surfaces the conflict copy, not a silent retry.
  castRevision++
  await page.getByRole('button', { name: '移除 host / two', exact: true }).click()
  await page.locator('.cast-banner').filter({ hasText: '当前输入保留' }).waitFor()
  assert.equal(nativeWrites, nativeBefore)
  await page.locator('.cast-banner').getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('button', { name: 'host / two', exact: true }).waitFor()

  // Enabling writes through the native CAS and lands after the queued refresh.
  await castSwitch(page).click()
  await page.waitForFunction(() => document.querySelector('.cast-head [role="switch"]')?.getAttribute('aria-checked') === 'true')
  assert.equal(castValue.enabled, true)

  // A committed save is independent of a later refresh failure.
  failCastRefreshAfterCommit = true
  await castSwitch(page).click()
  await page.getByRole('alert').filter({ hasText: '已保存；配置刷新失败' }).waitFor()
  assert.equal(castValue.enabled, false)
  assert.ok(await castSwitch(page).isDisabled())
  assert.equal(await page.getByRole('alert').filter({ hasText: '未保存' }).count(), 0)
  castReadFail = false; failCastRefreshAfterCommit = false
  await headRefresh(page).click()
  await page.waitForFunction(() => document.querySelector('.cast-head [role="switch"]')?.getAttribute('aria-checked') === 'false')

  // Two tabs: a tendency draft never clobbers a newer remote save, and the
  // banner's refresh rebases the draft onto the newer store revision.
  const second = await browser.newPage({ viewport: { width: 1080, height: 900 } })
  await attach(second)
  await second.goto(`http://127.0.0.1:${server.address().port}/`)
  const firstTendency = page.getByRole('textbox', { name: 'host / one 的任务倾向', exact: true })
  const secondTendency = second.getByRole('textbox', { name: 'host / one 的任务倾向', exact: true })
  await secondTendency.waitFor()
  await firstTendency.fill('local draft')
  await secondTendency.fill('remote note'); await secondTendency.press('Tab')
  await page.getByRole('status').filter({ hasText: '当前已保存：remote note' }).waitFor()
  assert.equal(await firstTendency.inputValue(), 'local draft')
  await firstTendency.focus(); await firstTendency.press('Tab')
  await page.locator('.cast-banner').filter({ hasText: '当前输入保留' }).waitFor()
  assert.equal(JSON.parse(readFileSync(castFile, 'utf8')).tendencies['["host","one"]'], 'remote note')
  assert.equal(tendencyWrites, 1)
  await page.locator('.cast-banner').getByRole('button', { name: '刷新', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.cast-row-tendency input')?.disabled === false)
  assert.equal(await firstTendency.inputValue(), 'local draft')
  await firstTendency.focus(); await firstTendency.press('Tab')
  await second.waitForFunction(() => document.querySelector('.cast-row-tendency input')?.value === 'local draft')
  assert.equal(tendencyAttempts, 3); assert.equal(tendencyWrites, 2)
  const migrated = JSON.parse(readFileSync(castFile, 'utf8'))
  assert.equal(migrated.schemaVersion, 3); assert.equal(migrated.revision, 3)
  await second.close(); pages.delete(second)

  // Damage is visible and cannot overwrite the original file; native controls
  // remain usable, and replacing the isolated fixture then refreshing recovers.
  await writeFile(castFile, '{ damaged')
  await headRefresh(page).click()
  await page.getByRole('alert').filter({ hasText: '原文件已保留' }).waitFor()
  assert.equal(readFileSync(castFile, 'utf8'), '{ damaged')
  assert.ok(await tendency().isDisabled())
  assert.ok(await page.getByRole('button', { name: 'host / one', exact: true }).isEnabled())
  await writeFile(castFile, JSON.stringify(migrated))
  await headRefresh(page).click()
  await page.getByRole('alert').filter({ hasText: '原文件已保留' }).waitFor({ state: 'hidden' })
  await page.screenshot({ path: resolve(output, 'cast-recovered.png'), fullPage: true })

  // Removing every route turns the switch off and leaves it disabled.
  await page.getByRole('button', { name: '移除 host / two', exact: true }).click()
  await page.getByRole('button', { name: '移除 host / one', exact: true }).click()
  await page.getByText('先添加模型，再启用显式模型选择。移除最后一个模型会关闭开关。', { exact: true }).waitFor()
  assert.deepEqual(castValue, { enabled: false, allowedModels: [] })
  assert.ok(await castSwitch(page).isDisabled())

  // The layout stays inside a mobile viewport.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

  // Locale is a local render input: it never re-reads or rewrites.
  const beforeLocale = { castGets, catalogReads, nativeWrites, preferenceWrites }
  await page.evaluate(() => window.switchLocale('en-US'))
  await page.locator('.cast-head').getByRole('button', { name: 'Refresh', exact: true }).waitFor()
  await page.getByRole('switch', { name: 'Enable subagent model selection' }).waitFor()
  await page.getByRole('button', { name: 'Add model…', exact: true }).waitFor()
  assert.deepEqual({ castGets, catalogReads, nativeWrites, preferenceWrites }, beforeLocale)
  await page.screenshot({ path: resolve(output, 'mobile-en.png'), fullPage: true })
  await page.setViewportSize({ width: 1080, height: 900 })
  await page.evaluate(() => window.switchLocale('zh-CN'))
  await headRefresh(page).waitFor()
  await page.screenshot({ path: resolve(output, 'desktop-en.png'), fullPage: true })
  assert.deepEqual({ castGets, catalogReads, nativeWrites, preferenceWrites }, beforeLocale)

  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ modelAdd: true, effortPreferenceWrite: true, duplicateRouteRejected: true,
    nativeConflictBanner: true, committedDespiteRefreshFailure: true, twoTabTendencyCas: true, remoteDraftPreserved: true,
    tendencyMigrationV3: true, lastRouteDisables: true, damagedStoreRecovery: true, mobileNoOverflow: true,
    liveLocaleSwitch: true, localeDoesNotReloadOrWrite: true, pageErrors: errors,
    scope: 'isolated browser with host primitives and stream carrier stubs, real Cordis contribution bus; no installed Desktop activation' }, null, 2))
  console.log(`Model management browser acceptance passed; screenshots: ${output}`)
} finally {
  await browser?.close()
  await new Promise(done => server ? server.close(done) : done())
  await vite?.close()
  await ctx.fiber.dispose()
}
