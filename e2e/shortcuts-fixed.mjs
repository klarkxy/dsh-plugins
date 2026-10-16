import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const ts = require('typescript')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const findPackage = name => {
  const direct = path.join(root, 'node_modules', name)
  if (fs.existsSync(direct)) return direct
  for (const item of fs.readdirSync(path.join(root, 'node_modules/.pnpm'))) {
    const candidate = path.join(root, 'node_modules/.pnpm', item, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
  }
  throw Error(`Installed test dependency missing: ${name}`)
}
// Test-only exports expose the installed owners; production does not access private editors.
const conversation = fs.readFileSync(path.join(findPackage('@deepseek-ai/dsh-client-ui-conversation'), 'lib/client.js'), 'utf8')
  .replace('exports.Config = Config;', 'exports.__probe = { DraftEditorRuntime, installDraftKeymap, installStopShortcut }; exports.Config = Config;')
const approval = fs.readFileSync(path.join(findPackage('@deepseek-ai/dsh-client-ui-approval'), 'lib/client.js'), 'utf8')
  .replace('exports.apply = apply;', 'exports.__probe = { ApprovalFlow }; exports.apply = apply;')
const dispatcher = ts.transpileModule(read('plugins/dsh-shortcuts/src/fixed-dispatch.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const browser = await chromium.launch({ headless: true })
const results = []
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<div data-conversation-session="test"><div data-conversation-region="composer"><div data-composer-card><div id="editor" contenteditable="true" data-composer-input data-lexical-editor="true"></div></div></div></div><div id="approval"></div><input id="outside">')
  await page.addScriptTag({ path: path.join(findPackage('react'), 'umd/react.development.js') })
  await page.addScriptTag({ path: path.join(findPackage('react-dom'), 'umd/react-dom.development.js') })
  await page.addScriptTag({ content: 'window.__modules={};window.__ModuleLoader__={load(row){window.__modules[row.id]=row}};' })
  await page.addScriptTag({ content: conversation })
  await page.addScriptTag({ content: approval })
  await page.addScriptTag({ content: `window.exports={};${dispatcher};window.installFixedDispatcher=exports.installFixedDispatcher;` })
  await page.evaluate(() => {
    const React = window.React
    const jsx = (type, props, key) => React.createElement(type, {...props,key})
    const stub = new Proxy(function(){}, { get: (_t,key) => key === 'Service' ? class {} : () => ({}), apply:()=>({}) })
    const primitives = { Button: ({variant,size,icon,children,...props}) => React.createElement('button', props, children), StateDot:()=>null }
    const load = name => name === 'react' ? React : name === 'react-dom' ? window.ReactDOM : name === 'react/jsx-runtime' ? {jsx,jsxs:jsx,Fragment:React.Fragment} : name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : stub
    const mod = window.__modules['@deepseek-ai/dsh-client-ui-conversation'].factory(load)
    const runtime = new mod.__probe.DraftEditorRuntime({onUpdate:()=>runtime.refreshProjection(),openReference:()=>false,activeClaimToken:()=>null,lexicon:()=>new Map(),resolveLexicon:()=>undefined})
    runtime.register(); runtime.editor.setRootElement(document.querySelector('#editor')); runtime.setDraft('hello'); runtime.editor.focus()
    window.runtime = runtime; window.submits = []; window.failures = []; window.mappings = []
    window.mod=mod; window.menuChoice=null; window.menuMoves=[]
    window.gate={current:{locked:false,machineBusy:false,canSteerQueue:false,uploadsPending:false,busyEnter:'steer',running:true,steeringAvailable:true,showToast:()=>window.submits.push('upload-blocked'),t:key=>key}}
    mod.__probe.installDraftKeymap(runtime.editor, {arbitrate:key=> {if(document.querySelector('[data-trigger-menu]')) {window.menuMoves.push(key); return 'consumed'} return 'pass'},space:()=>false,dismissPopup:()=>{},submit:(...args)=>window.submits.push(args),steerQueue:()=>window.submits.push('steer-queue'),paste:()=>{}}, window.gate)
    window.setMapping=(id,original,binding,group='input') => { window.mappings=[{id,group,original:{bindings:[original]},bindings:[binding],modified:true}] }
    window.disposeFixed=window.installFixedDispatcher({window,getMappings:()=>window.mappings,isRecording:()=>!!window.recording,onError:e=>window.failures.push(e.message)})
    const approval=window.__modules['@deepseek-ai/dsh-client-ui-approval'].factory(load)
    window.decisions=[]
    window.ReactDOM.createRoot(document.querySelector('#approval')).render(React.createElement(approval.__probe.ApprovalFlow,{pending:{key:'test-approval',answerable:true,answer:async value=>window.decisions.push(value)},reason:'Test approval only',detail:null,t:key=>key}))
  })
  const mapping = (id, original, binding, group='input') => page.evaluate(args => window.setMapping(...args), [id,original,binding,group])
  const press = async key => { await page.keyboard.press(key); await page.waitForTimeout(30) }
  await mapping('fixed.send',{code:'Enter',modifiers:[]},{code:'KeyS',modifiers:['alt']})
  await press('Alt+s')
  assert.deepEqual(await page.evaluate(()=>window.submits), [['steer','enter']])
  await press('Enter')
  assert.equal(await page.evaluate(()=>window.submits.length),1)
  assert.equal(await page.evaluate(()=>window.runtime.projection.clipboardText),'hello')
  await page.evaluate(()=>window.gate.current.uploadsPending=true)
  await press('Alt+s')
  assert.deepEqual(await page.evaluate(()=>window.submits),[['steer','enter'],'upload-blocked'])
  await page.evaluate(()=>{window.gate.current.uploadsPending=false;window.gate.current.locked=true})
  await press('Alt+s')
  assert.equal(await page.evaluate(()=>window.submits.length),2)
  await page.evaluate(()=>window.gate.current.locked=false)
  results.push('trusted remapped send preserves busy delivery, upload guard, lock, and disables old Enter')
  await mapping('fixed.newline',{code:'Enter',modifiers:['shift']},{code:'KeyN',modifiers:['alt']})
  await press('Alt+n')
  assert.equal(await page.evaluate(()=>window.runtime.projection.clipboardText),'hello\n')
  assert.equal(await page.evaluate(()=>window.runtime.editor.getEditorState().toJSON().root.children[0].children.at(-1).type),'linebreak')
  await press('Shift+Enter')
  assert.equal(await page.evaluate(()=>window.runtime.projection.clipboardText),'hello\n')
  await press('Control+z')
  assert.equal(await page.evaluate(()=>window.runtime.projection.clipboardText),'hello')
  results.push('remapped newline creates a real linebreak node, disables old key, and supports undo')
  for (const [id, original, next, text] of [
    ['fixed.slash',{code:'Slash',modifiers:[]},'j','/'],
    ['fixed.mention',{code:'Digit2',modifiers:['shift']},'m','@'],
  ]) {
    await mapping(id,original,{code:`Key${next.toUpperCase()}`,modifiers:['alt']})
    const before=await page.evaluate(()=>window.runtime.projection.clipboardText)
    await press(`Alt+${next}`)
    assert.equal(await page.evaluate(()=>window.runtime.projection.clipboardText),before+text)
  }
  results.push('slash and mention insert through the installed editor without leaking physical characters')
  await mapping('fixed.send',{code:'Enter',modifiers:[]},{code:'KeyS',modifiers:['alt']})
  await page.evaluate(()=>document.querySelector('#editor').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
  await press('Alt+s')
  assert.equal(await page.evaluate(()=>window.submits.length),2)
  await page.evaluate(()=>document.querySelector('#editor').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})))
  await page.waitForTimeout(25)
  await page.evaluate(()=>window.recording=true)
  await press('Alt+s')
  assert.equal(await page.evaluate(()=>window.submits.length),2)
  await page.evaluate(()=>window.recording=false)
  results.push('IME and recording leave the owner input untouched')
  await mapping('approval.reject',{code:'Escape',modifiers:[]},{code:'KeyR',modifiers:['alt']},'approval')
  await page.locator('[data-approval-scroll]').focus()
  await press('Escape')
  assert.deepEqual(await page.evaluate(()=>window.decisions),[])
  await page.locator('#outside').focus(); await press('Alt+r')
  assert.deepEqual(await page.evaluate(()=>window.decisions),[])
  await page.locator('[data-approval-scroll]').focus(); await press('Alt+r'); await press('Alt+r')
  assert.deepEqual(await page.evaluate(()=>window.decisions),['rejected'])
  results.push('actual ApprovalFlow rejects once, only within the focused approval, and old Esc is disabled')
  await page.locator('#editor').focus()
  await page.evaluate(()=>{
    const trigger=document.createElement('div'); trigger.dataset.triggerMenu=''; trigger.setAttribute('role','listbox'); document.querySelector('[data-composer-card]').append(trigger)
    window.mappings=[{id:'fixed.move',group:'menus',original:{bindings:[{code:'ArrowUp',modifiers:[]},{code:'ArrowDown',modifiers:[]}]},bindings:[{code:'KeyK',modifiers:['alt']},{code:'KeyJ',modifiers:['alt']}],modified:true},{id:'fixed.select',group:'menus',original:{bindings:[{code:'Enter',modifiers:[]}]},bindings:[{code:'KeyS',modifiers:['alt']}],modified:true}]
  })
  await press('Alt+k'); await press('Alt+j'); await press('Alt+s')
  assert.deepEqual(await page.evaluate(()=>window.menuMoves),['up','down','enter'])
  await press('ArrowDown'); await press('Enter')
  assert.deepEqual(await page.evaluate(()=>window.menuMoves),['up','down','enter'])
  await page.evaluate(()=>document.querySelector('[data-trigger-menu]').remove())
  results.push('menu movement and selection reach the actual composer arbitration before send; old keys are disabled')
  await page.evaluate(()=>{
    window.cancelled=[]; window.stopInputs=[]; let observer
    const source=value=>({getSnapshot:()=>value,subscribe:()=>()=>{}})
    const binding={session:source({running:true,removed:false,subagent:null})}
    window.mod.__probe.installStopShortcut({stopSequenceMs:500,observeFixedInput:fn=>{observer=fn;return()=>{}}},{binding:()=>binding},()=>source('turn-one'),{sessionStatus:source(new Map())},id=>window.cancelled.push(id))
    // The normal host observer is registered before the plugin's bubble completion check.
    window.disposeFixed()
    window.addEventListener('keydown',event=>{window.stopInputs.push({key:event.key,code:event.code,prevented:event.defaultPrevented,alt:event.altKey,target:event.target.outerHTML});observer({type:'keydown',gesture:{code:event.code,control:event.ctrlKey,alt:event.altKey,shift:event.shiftKey,meta:event.metaKey,repeat:event.repeat,composing:event.isComposing,defaultPrevented:event.defaultPrevented},context:{target:event.target,region:'editable',modal:null},consume:()=>event.preventDefault()})})
    window.disposeFixed=window.installFixedDispatcher({window,getMappings:()=>window.mappings,onError:e=>window.failures.push(e.message)})
  })
  await mapping('response.stop',{code:'Escape',modifiers:[]},{code:'F8',modifiers:[]})
  await press('F8')
  assert.deepEqual(await page.evaluate(()=>window.cancelled),[])
  await press('F8')
  assert.deepEqual(await page.evaluate(()=>window.cancelled),['test'])
  await press('Escape'); await press('Escape')
  assert.deepEqual(await page.evaluate(()=>window.cancelled),['test'])
  results.push('actual stop owner keeps two-press timing and session identity while old Esc is disabled')
  assert.deepEqual(await page.evaluate(()=>window.failures),[])
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({browser:await browser.version(),results,status:'passed'},null,2))
} finally { await browser.close() }
