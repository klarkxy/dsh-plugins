import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

// Browser interaction at the registered settings seat, backed by the real
// Cordis contribution bus/hub. Owner storage is an isolated fixture; individual
// adapters have native service integration tests in their owning packages.
const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'e2e/out/model-hub-settings')
const require = createRequire(resolve(root, 'package.json'))
const hostRequire = createRequire(resolve(root, 'plugins/dsh-model-hub/package.json'))
const vitestRequire = createRequire(require.resolve('vitest/package.json'))
const { createServer } = await import(pathToFileURL(vitestRequire.resolve('vite')).href)
const { Context } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Model Hub acceptance</title>
<style>:root{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-layer-3:#fff;--dsw-alias-label-primary:#20252c;--dsw-alias-label-secondary:#596574;--dsw-alias-label-tertiary:#768290;--dsw-alias-border-l1:#dde2e8;--dsw-alias-border-l2:#c4ceda;--dsw-alias-border-l3:#a5b4c8;--dsw-alias-state-business-primary:#356dda;--dsw-alias-label-error:#b42318;--dsw-alias-interactive-bg-hover:#eef3fc;--dsw-alias-interactive-bg-active:#e3ecfc;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#356dda;--dsw-radius-sm:8px;--dsw-radius-md:12px;--dsw-alias-menu-icon:#596574;--dsw-menu-surface-fill:#fff;--dsw-alias-scrollbar-bg-l2:#bac5d3}body{margin:0;font:14px/1.5 system-ui;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}main{max-width:860px;margin:24px auto;padding:0 20px}h1{font-size:20px}input{box-sizing:border-box;max-width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}button{font:inherit;cursor:pointer}button:disabled{cursor:default;opacity:.6}</style></head>
<body><main><h1>模型枢纽</h1><div id="root"></div></main><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import * as ReactDOM from 'react-dom'; import * as jsx from 'react/jsx-runtime'; import * as primitives from '/scripts/editor-plugins/ui-primitives-stub.tsx';
let apply;window.__ModuleLoader__={load({id,factory}){if(id!=='@klarkxy/dsh-model-hub')throw Error('Wrong bundle');const modules={'react':React,'react-dom':ReactDOM,'react/jsx-runtime':jsx,'@deepseek-ai/dsh-client-ui-primitives':primitives};apply=factory(name=>{if(!(name in modules))throw Error('Unexpected module '+name);return modules[name]}).apply}};
await new Promise((done,failed)=>{const script=document.createElement('script');script.src='/plugins/dsh-model-hub/lib/client.js';script.onload=done;script.onerror=failed;document.head.append(script)});
let active='zh-CN'; const listeners=new Set(); window.switchLocale=next=>{active=next;document.documentElement.lang=next;document.querySelector('h1').textContent=next.startsWith('zh')?'模型设置':'Model Settings';for(const listener of listeners)listener()};
// The fixture carries real Cordis invalidations into the native subscriber's
// stream shape. Installed DSH transport/reconnection remains a separate check.
const streams=new Set(); window.receiveHubChange=frame=>{for(const receive of streams)receive(frame)};
const remote={session:{modelCatalog:()=>window.hostCatalog()},$mount:async()=>async()=>{},KlarkxyDshModelHubModelSettingsChanges:{async *watch(signal){const pending=[];let wake;const receive=frame=>{pending.push(frame);wake?.()};streams.add(receive);const aborted=()=>wake?.();signal.addEventListener('abort',aborted,{once:true});try{yield {kind:'ready'};while(!signal.aborted){if(pending.length){yield pending.shift();continue}await new Promise(done=>{wake=done;if(pending.length||signal.aborted)done()});wake=undefined}}finally{streams.delete(receive);signal.removeEventListener('abort',aborted)}}},$stream({open}){const controller=new AbortController();const iterator=open(controller.signal)[Symbol.asyncIterator]();return {async *[Symbol.asyncIterator](){while(!controller.signal.aborted){const item=await iterator.next();if(item.done)return;yield {generation:1,value:item.value,signal:controller.signal,accept(){}}}},async dispose(){controller.abort();await iterator.return?.()}}}};
let spec,component; const api={connection:{rpc:{call:async(_channel,endpoint,payload)=>{try{return {ok:true,value:await window.hubRpc(endpoint,payload)}}catch(error){return {ok:false,error:{message:error.message}}}}}},remote,effect:run=>run(),inject(_deps,run){const cleanup=[];run({remote,effect:effect=>cleanup.push(effect())});return {dispose(){for(const stop of cleanup)stop()}}},locale:{getSnapshot:()=>({active}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}},slots:{inject(name,run){if(name!=='plugins.bundle.config')throw Error(name);run()},register(options,render){spec=options;component=render}}};
await apply(api);if(spec.key!=='@klarkxy/dsh-model-hub')throw Error('Wrong settings seat');createRoot(document.getElementById('root')).render(React.createElement(component,{...spec.inject(),view:'page'}));
</script></body></html>`

const nativeCatalog = { groups: [{ id: 'host', name: 'DSH', models: [
  { id: 'one', name: 'Reasoner', reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }] } },
  { id: 'two', name: 'Writer' },
] }] }
const externalCatalog = { groups: [{ id: 'codex', name: 'Codex', models: [{ id: 'external', name: 'External model' }] }] }
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
  const { createHubSettings } = await vite.ssrLoadModule('/plugins/dsh-model-hub/src/owners.ts')
  const { registerModelSettings, notifyModelSettingsChanged, MODEL_SETTINGS_CHANGED_EVENT } = await vite.ssrLoadModule('/plugins/dsh-plugin-kit/src/model-settings.ts')
  const { createCast, CAST_NAMESPACE, CAST_TENDENCIES_NAMESPACE } = await vite.ssrLoadModule('/plugins/dsh-model-hub/src/cast.ts')
  const settings = { revision: 0, model: { provider: 'host', model: 'one', reasoningEffort: 'low' }, prompt: 'keep' }
  let conflict = false, catalogFail = false, listFail = false, failRefreshAfterCommit = false, writes = 0, lists = 0, catalogReads = 0
  const owner = { ns: '@klarkxy/dsh-current-title', title: { zh: '会话标题', en: 'Session title' }, read: () => ({ revision: settings.revision,
    fields: [{ path: ['model'], label: { zh: '标题生成', en: 'Title generation' }, current: settings.model, followLabel: { zh: '当前会话模型', en: 'Current session model' } }] }),
    async write(_path, route, expected) { if (conflict || expected !== settings.revision) throw Error('设置已在其他页面修改')
      settings.model = route; settings.revision++; writes++; if (failRefreshAfterCommit) listFail = true },
  }
  registerModelSettings(ctx, owner)
  for (const [ns, title, label] of [
    ['git-commit', { zh: 'Git 提交', en: 'Git Commit' }, { zh: '提交说明', en: 'Commit message' }],
    ['safe-auto', { zh: '安全审核', en: 'Safety review' }, { zh: '审核模型', en: 'Reviewer model' }],
  ]) {
    registerModelSettings(ctx, { ns: `@klarkxy/dsh-${ns}`, title, read: () => ({ revision: 0, fields: [{ path: ['model'], label,
      current: { provider: '', model: '' }, followLabel: { zh: '当前会话模型', en: 'Current session model' } }] }), write: async () => {} })
  }
  registerModelSettings(ctx, { ns: '@fixture/model-settings', title: { zh: '字段示例', en: 'Field examples' }, read: () => ({ revision: 0, fields: [
    { path: ['linked', 'model'], label: { zh: '只读引用', en: 'Read-only reference' }, editable: false, description: { zh: '由所属设置管理。', en: 'Managed by its settings owner.' } },
    { path: ['fixed', 'model'], label: { zh: '固定模型', en: 'Fixed model' }, allowFollow: false, current: { provider: 'host', model: 'one', reasoningEffort: 'high' } },
  ] }), write: async () => {} })
  registerModelSettings(ctx, { ns: '@fixture/external-catalog', title: 'ChatGPT', read: () => ({ revision: 0, catalog: externalCatalog, fields: [{ path: ['model'], label: { zh: 'ChatGPT 模型', en: 'ChatGPT model' },
    current: { provider: 'codex', model: 'external' }, followLabel: { zh: 'Codex 默认模型', en: 'Codex default model' } }] }), write: async () => {} })
  const hub = createHubSettings(ctx, { describe: () => [], mutate: async () => { throw Error('Unexpected native write') } })
  const castFile = resolve(output, 'profile/data/model-hub/cast.json')
  await mkdir(dirname(castFile), { recursive: true })
  await writeFile(castFile, JSON.stringify({ schemaVersion: 1, tendencies: { '["host","one"]': 'reviews' } }))
  let castRevision = 0, castValue = { enabled: false, allowedModels: [{ provider: 'host', model: 'one' }] }
  let castReadFail = false, failCastRefreshAfterCommit = false, nativeWrites = 0
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
      if (endpoint === 'fields.list') { lists++; if (listFail) throw Error('字段读取离线'); return hub.list(signal) }
      if (endpoint === 'fields.set') return hub.set(payload, signal)
      if (endpoint === 'cast.get') return cast.getCast()
      if (endpoint === 'cast.setEnabled') return cast.setEnabled(payload.enabled, payload.expectedRevision)
      if (endpoint === 'cast.addRoute') return cast.addRoute(payload.route, payload.expectedRevision)
      if (endpoint === 'cast.setRoute') return cast.setRoute(payload.index, payload.route, payload.expectedRevision)
      if (endpoint === 'cast.removeRoute') return cast.removeRoute(payload.index, payload.expectedRevision)
      if (endpoint === 'cast.setTendency') {
        tendencyAttempts++
        const result = cast.setTendency(payload.provider, payload.model, payload.tendency, payload.expectedRevision, signal)
        tendencyWrites++; return result
      }
      throw Error('Unknown endpoint')
    })
    await tab.exposeFunction('hostCatalog', () => { catalogReads++; if (catalogFail) throw Error('目录离线'); return nativeCatalog })
  }
  await attach(page)
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.getByRole('button', { name: '刷新', exact: true }).waitFor()
  assert.equal(await page.locator('.hub-group').count(), 5)
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true })
  const titleTrigger = () => page.getByRole('button', { name: /^标题生成:/ })
  await titleTrigger().focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: /模型/ }).click()
  await page.getByRole('menuitemradio', { name: /Writer/ }).click()
  await page.getByRole('button', { name: /标题生成: DSH \/ Writer/ }).waitFor()
  assert.equal(settings.model.model, 'two'); assert.equal(settings.prompt, 'keep'); assert.equal(writes, 1)
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '标题生成: DSH / Writer')
  await page.getByRole('searchbox').fill('审核')
  assert.equal(await page.locator('.hub-group').count(), 1)
  await page.getByRole('searchbox').fill('')
  await page.getByRole('button', { name: /^ChatGPT 模型:/ }).click()
  await page.getByRole('menuitem', { name: /模型/ }).click()
  assert.equal(await page.getByRole('menuitemradio', { name: /External model/ }).count(), 1)
  assert.equal(await page.getByRole('menuitemradio', { name: /Writer/ }).count(), 0)
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  conflict = true
  await titleTrigger().click(); await page.getByRole('menuitem', { name: /模型/ }).click()
  await page.getByRole('menuitemradio', { name: /Reasoner/ }).click()
  await page.getByRole('alert').filter({ hasText: '未保存' }).waitFor()
  assert.equal(writes, 1)
  assert.ok(await titleTrigger().isDisabled())
  conflict = false
  const before = { lists, catalogReads }
  catalogFail = true
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '目录离线' }).waitFor()
  assert.ok(lists > before.lists && catalogReads > before.catalogReads)
  assert.equal(await page.locator('.hub-group').count(), 5)
  catalogFail = false
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('button', { name: '刷新', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const beforeLocale = { lists, catalogReads, writes }
  await page.getByRole('searchbox').fill('Writer')
  await page.evaluate(() => window.switchLocale('en-US'))
  await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor()
  assert.equal(await page.getByRole('searchbox').inputValue(), 'Writer')
  assert.equal(await page.getByRole('button', { name: /^Title generation: DSH \/ Writer/ }).count(), 1)
  assert.deepEqual({ lists, catalogReads, writes }, beforeLocale)
  await page.screenshot({ path: resolve(output, 'mobile-en.png'), fullPage: true })
  await page.getByRole('searchbox').fill('')
  await page.setViewportSize({ width: 1080, height: 900 })
  await page.screenshot({ path: resolve(output, 'desktop-en.png'), fullPage: true })
  await page.evaluate(() => window.switchLocale('zh-CN'))
  await page.getByRole('button', { name: '刷新', exact: true }).waitFor()
  assert.deepEqual({ lists, catalogReads, writes }, beforeLocale)

  // A committed field save is independent of any owner's later list failure.
  failRefreshAfterCommit = true
  await titleTrigger().click(); await page.getByRole('menuitem', { name: /模型/ }).click()
  await page.getByRole('menuitemradio', { name: /Reasoner/ }).click()
  await page.getByRole('alert').filter({ hasText: '已保存；页面刷新失败' }).waitFor()
  assert.equal(writes, 2); assert.equal(settings.model.model, 'one')
  assert.equal(await page.getByRole('alert').filter({ hasText: '未保存' }).count(), 0)
  assert.ok(await titleTrigger().isDisabled())
  listFail = false; failRefreshAfterCommit = false
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('button', { name: /^标题生成: DSH \/ Reasoner/ }).waitFor()
  assert.equal(writes, 2)

  const second = await browser.newPage({ viewport: { width: 1080, height: 900 } })
  await attach(second)
  await second.goto(`http://127.0.0.1:${server.address().port}/`)
  for (const tab of [page, second]) {
    await tab.getByRole('tab', { name: '子代理阵容', exact: true }).click()
    await tab.getByRole('textbox', { name: 'host / one 的任务倾向', exact: true }).waitFor()
  }
  const firstTendency = page.getByRole('textbox', { name: 'host / one 的任务倾向', exact: true })
  const secondTendency = second.getByRole('textbox', { name: 'host / one 的任务倾向', exact: true })
  await firstTendency.fill('local draft')
  await secondTendency.fill('remote note'); await secondTendency.press('Tab')
  await page.getByRole('status').filter({ hasText: '当前已保存：remote note' }).waitFor()
  assert.equal(await firstTendency.inputValue(), 'local draft')
  await firstTendency.focus(); await firstTendency.press('Tab')
  await page.getByRole('alert').filter({ hasText: '当前输入保留' }).waitFor()
  assert.equal(JSON.parse(readFileSync(castFile, 'utf8')).tendencies['["host","one"]'], 'remote note')
  assert.equal(tendencyWrites, 1)
  await page.locator('.cast-banner').getByRole('button', { name: '刷新', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.cast-row-tendency input')?.disabled === false)
  assert.equal(await firstTendency.inputValue(), 'local draft')
  await firstTendency.focus(); await firstTendency.press('Tab')
  await second.waitForFunction(() => document.querySelector('.cast-row-tendency input')?.value === 'local draft')
  assert.equal(tendencyAttempts, 3); assert.equal(tendencyWrites, 2)
  const migrated = JSON.parse(readFileSync(castFile, 'utf8'))
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.revision, 2)
  const castPanel = page.getByRole('tabpanel', { name: '子代理阵容', exact: true })
  const beforeNativeSave = nativeWrites
  failCastRefreshAfterCommit = true
  await castPanel.getByRole('switch', { name: '启用子代理阵容' }).click()
  await castPanel.getByRole('alert').filter({ hasText: '已保存；阵容刷新失败' }).waitFor()
  assert.equal(nativeWrites, beforeNativeSave + 1); assert.equal(castValue.enabled, true)
  assert.equal(await castPanel.getByRole('switch', { name: '启用子代理阵容' }).getAttribute('aria-checked'), 'false')
  assert.ok(await castPanel.getByRole('switch', { name: '启用子代理阵容' }).isDisabled())
  assert.ok(await castPanel.getByRole('button', { name: '移除 host / one', exact: true }).isDisabled())
  assert.equal(await castPanel.getByRole('alert').filter({ hasText: '未保存' }).count(), 0)
  castReadFail = false; failCastRefreshAfterCommit = false
  await castPanel.getByRole('button', { name: '刷新', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.cast-head [role="switch"]')?.getAttribute('aria-checked') === 'true')
  assert.equal(nativeWrites, beforeNativeSave + 1)
  await castPanel.getByRole('button', { name: '移除 host / one', exact: true }).click()
  await castPanel.getByText('先添加模型，再启用显式模型选择。移除最后一个模型会关闭开关。', { exact: true }).waitFor()
  assert.deepEqual(castValue, { enabled: false, allowedModels: [] })
  assert.ok(await castPanel.getByRole('switch', { name: '启用子代理阵容' }).isDisabled())

  // Damage is visible and cannot overwrite the original file; native controls
  // remain usable, and replacing the isolated fixture then refreshing recovers.
  await writeFile(castFile, '{ damaged')
  await castPanel.getByRole('button', { name: '刷新', exact: true }).click()
  await castPanel.getByRole('alert').filter({ hasText: '原文件已保留' }).waitFor()
  assert.equal(readFileSync(castFile, 'utf8'), '{ damaged')
  await writeFile(castFile, JSON.stringify(migrated))
  await castPanel.getByRole('button', { name: '刷新', exact: true }).click()
  await castPanel.getByRole('alert').filter({ hasText: '原文件已保留' }).waitFor({ state: 'hidden' })
  await page.screenshot({ path: resolve(output, 'cast-recovered.png'), fullPage: true })
  await second.close(); pages.delete(second)
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ groups: 5, keyboardSelection: true, focusReturned: true,
    search: true, separateCatalog: true, conflictRecovery: true, dualRefresh: true, retainedOnCatalogFailure: true,
    mobileNoOverflow: true, liveLocaleSwitch: true, localePreservesSearch: true, localeDoesNotReloadOrWrite: true,
    committedDespiteRefreshFailure: true, twoTabTendencyCas: true, remoteDraftPreserved: true, tendencyMigration: true,
    nativeCommitDespiteRefreshFailure: true, nativeRevisionFromRefresh: true, lastRouteDisables: true, damagedStoreRecovery: true,
    pageErrors: errors, scope: 'isolated browser with host primitives and stream carrier stubs, real Cordis contribution bus; no installed Desktop activation' }, null, 2))
  console.log(`Model hub browser acceptance passed; screenshots: ${output}`)
} finally {
  await browser?.close()
  await new Promise(done => server ? server.close(done) : done())
  await vite?.close()
  await ctx.fiber.dispose()
}
