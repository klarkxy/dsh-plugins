import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { discoverPackages } from './release-target.mjs';
import { readReleaseStates, releaseEligibility, releaseStateFile, validateLifecycleTransition, checkLifecycleHistory } from './release-state.mjs';
import { releaseWorkspace } from './release-workspace.mjs';
import { packSnapshot } from './release-content.mjs';
import { plan, preflightReleases, publish, writeVersion } from './publish-npm.mjs';
import { main, syncStateDocs } from './release-status.mjs';

const archive = Buffer.from('synthetic npm archive');
const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
const publication = { version: '1.2.3', publishedAt: '2026-10-01T00:00:00.000Z', integrity };
const reason = { zh: '夹具', en: 'Fixture' };
const table = 'Original prose.\n<!-- plugin-release-states:start -->\n<!-- plugin-release-states:end -->\nTrailing prose.\n';
function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-states-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  const packages = ['dsh-base', 'dsh-feature', 'dsh-other'].map(slug => {
    const directory = `plugins/${slug}`;
    mkdirSync(join(root, directory), { recursive: true });
    const pkg = { name: `@klarkxy/${slug}`, version: '1.2.3', directory };
    writeFileSync(join(root, directory, 'package.json'), JSON.stringify({ ...pkg, files: ['index.js'],
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' }, ...(overrides[slug] ?? {}) }));
    writeFileSync(join(root, directory, 'index.js'), 'export const value = 1;\n');
    return { name: pkg.name, state: 'published', reason, publication };
  });
  writeFileSync(join(root, releaseStateFile), JSON.stringify({ schemaVersion: 2, packages }));
  for (const file of ['README.md', 'README.zh-CN.md']) writeFileSync(join(root, file), table);
  return root;
}
function update(root, action) {
  const file = join(root, releaseStateFile), data = JSON.parse(readFileSync(file, 'utf8'));
  action(data); writeFileSync(file, JSON.stringify(data));
}
function stage(entry, state) { entry.state = state; if (state !== 'published') delete entry.publication; }
const workspace = (root, first = []) => releaseWorkspace(root, discoverPackages(root), first);
const fakePack = (_root, pkg) => ({ hash: `plan-${pkg.name}`, sourceHash: 'a'.repeat(64), packed: { filename: `${pkg.slug}.tgz`, integrity } });
const noRegistry = async () => ({ versions: {}, 'dist-tags': {} });
async function savedPlan(root, first = []) { return plan(root, first, { lookup: noRegistry, packer: fakePack }); }
const npm = (args, cwd) => execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm',
  process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args,
  { cwd, encoding: 'utf8', env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } });

test('registry validates lifecycle and historical proof without source-acceptance tokens', t => {
  const root = fixture(t), initial = readFileSync(join(root, releaseStateFile));
  const failures = [
    d => { d.schemaVersion = 1; }, d => { d.packages = {}; }, d => { d.packages.pop(); },
    d => { d.packages.push(d.packages[0]); }, d => { d.packages[0].name = '@klarkxy/dsh-unknown'; },
    d => { d.packages[0].state = 'ready'; }, d => { d.packages[0].state = 'toString'; },
    d => { d.packages[0].reason.zh = ''; }, d => { delete d.packages[0].publication; },
    d => { d.packages[0].publication.integrity = 'bad'; }, d => { d.packages[0].publication.version = 'x'; },
    d => { d.packages[0].publication.publishedAt = 'invalid'; }, d => { d.packages[0].state = 'testing'; },
    d => { d.packages[0].acceptedContentHash = 'a'.repeat(64); },
    d => { d.packages[0].evidence = []; }, d => { d.packages[0].evidence = { tests: '../outside' }; },
  ];
  for (const corrupt of failures) { writeFileSync(join(root, releaseStateFile), initial); update(root, corrupt); assert.throws(() => readReleaseStates(root)); }
  writeFileSync(join(root, releaseStateFile), initial);
  assert.equal(readReleaseStates(root).get('@klarkxy/dsh-base').state, 'published');
});

test('lifecycle rejects backwards movement, missing history, skipped testing and altered proof', t => {
  const root = fixture(t), previous = JSON.parse(readFileSync(join(root, releaseStateFile)));
  const current = readReleaseStates(root);
  validateLifecycleTransition(previous, current);
  for (const state of ['draft', 'testing']) {
    const altered = structuredClone(current); stage(altered.get('@klarkxy/dsh-base'), state);
    assert.throws(() => validateLifecycleTransition(previous, altered), /cannot go backwards/);
  }
  const removed = new Map(current); removed.delete('@klarkxy/dsh-base');
  assert.throws(() => validateLifecycleTransition(previous, removed), /lose an existing/);
  const altered = structuredClone(current); altered.get('@klarkxy/dsh-base').publication.version = '2.0.0';
  assert.throws(() => validateLifecycleTransition(previous, altered), /preserve/);
  const oldDraft = structuredClone(previous); stage(oldDraft.packages[0], 'draft');
  assert.throws(() => validateLifecycleTransition(oldDraft, current), /testing stage/);
  const oldTesting = structuredClone(previous); stage(oldTesting.packages[0], 'testing');
  validateLifecycleTransition(oldTesting, current);
  validateLifecycleTransition({ schemaVersion: 1, packages: [] }, current);
});

test('retiring source removes build and release membership while retaining immutable publication history', t => {
  const root=fixture(t),before=JSON.parse(readFileSync(join(root,releaseStateFile)));
  update(root,d=>{d.packages[0].retired=true;});
  assert.throws(()=>readReleaseStates(root),/retired entries must have no source/);
  rmSync(join(root,'plugins/dsh-base'),{recursive:true});
  const current=readReleaseStates(root),result=workspace(root);
  validateLifecycleTransition(before,current);
  assert.deepEqual(current.get('@klarkxy/dsh-base').publication,publication);
  assert.equal(current.get('@klarkxy/dsh-base').state,'published');
  assert.equal(result.inventory.some(p=>p.name==='@klarkxy/dsh-base'),false);
  assert.equal(result.candidates.some(p=>p.name==='@klarkxy/dsh-base'),false);
  assert.throws(()=>workspace(root,['@klarkxy/dsh-base']),/public testing/);
  syncStateDocs(root,result,true);
  assert.doesNotMatch(readFileSync(join(root,'README.md'),'utf8'),/dsh-base/);
  const lost=new Map(current);lost.delete('@klarkxy/dsh-base');
  assert.throws(()=>validateLifecycleTransition(before,lost),/lose an existing/);
});

test('Git history checks working tree and the complete supplied push baseline', t => {
  const root = fixture(t);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  git(['init']); git(['config','user.email','fixture@example.invalid']); git(['config','user.name','Fixture']);
  git(['add','.']); git(['commit','-m','Published baseline']); const base = git(['rev-parse','HEAD']);
  update(root, d => { stage(d.packages[0], 'testing'); });
  assert.throws(() => checkLifecycleHistory(root, readReleaseStates(root), 'HEAD'), /backwards/);
  git(['add','.']); git(['commit','-m','Invalid demotion']);
  writeFileSync(join(root, 'unrelated.txt'), 'another commit'); git(['add','.']); git(['commit','-m','Unrelated']);
  assert.throws(() => checkLifecycleHistory(root, readReleaseStates(root), base), /backwards/);
  assert.throws(() => checkLifecycleHistory(root, readReleaseStates(root), 'missing-baseline'));
  // Scope the environment baseline to a child so the runner's CI baseline is untouched.
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { checkLifecycleHistory, readReleaseStates } from ${JSON.stringify(new URL('./release-state.mjs', import.meta.url).href)};
    const root = process.cwd(), states = readReleaseStates(root);
    assert.doesNotThrow(() => checkLifecycleHistory(root, states, 'HEAD'));
    assert.throws(() => checkLifecycleHistory(root, states), /backwards/);
  `], { cwd: root, env: { ...process.env, RELEASE_STATE_BASE: base }, stdio: 'pipe' });
});

test('ordinary source updates remain Published and can prepare a new version without re-acceptance', async t => {
  const root = fixture(t), before = readFileSync(join(root, releaseStateFile), 'utf8');
  writeFileSync(join(root, 'plugins/dsh-base/index.js'), 'export const value = 2;\n');
  const result = await savedPlan(root);
  assert.equal(result.releases.length, 3);
  assert.equal(readFileSync(join(root, releaseStateFile), 'utf8'), before);
  preflightReleases(root, result, fakePack);
});

test('draft and testing stay outside default plans and do not mutate versions', async t => {
  const root = fixture(t); update(root, d => d.packages.forEach((entry,i) => stage(entry, i ? 'testing' : 'draft')));
  const before = discoverPackages(root).map(p => readFileSync(join(root,p.directory,'package.json'),'utf8'));
  assert.deepEqual(await savedPlan(root), { schemaVersion: 2, firstReleases: [], releases: [], changedFiles: [], sourceHashes: {} });
  assert.deepEqual(discoverPackages(root).map(p => readFileSync(join(root,p.directory,'package.json'),'utf8')), before);
});

test('explicit first-release selection survives planning and preflight without early promotion', async t => {
  const root = fixture(t); update(root,d => d.packages.forEach(e => stage(e,'testing')));
  const selected = ['@klarkxy/dsh-base'];
  const result = await savedPlan(root,selected);
  assert.deepEqual(result.firstReleases,selected); assert.equal(result.releases.length,1);
  assert.equal(readReleaseStates(root).get(selected[0]).state,'testing');
  preflightReleases(root,result,fakePack);
  assert.throws(() => preflightReleases(root,{...result,firstReleases:[]},fakePack),/ineligible/);
  update(root,d => stage(d.packages[0],'draft'));
  assert.throws(() => workspace(root,selected),/public testing/);
  assert.throws(() => workspace(root,['@klarkxy/dsh-missing']),/public testing/);
});

test('public dependency first releases require explicit selection; private testing dev code can bundle', t => {
  const root = fixture(t, {'dsh-feature':{devDependencies:{'@klarkxy/dsh-base':'workspace:*'}}});
  update(root,d => { stage(d.packages[0],'testing'); stage(d.packages[1],'testing'); });
  assert.throws(() => workspace(root,['@klarkxy/dsh-feature']),/unpublished dependencies/);
  assert.equal(workspace(root,['@klarkxy/dsh-base','@klarkxy/dsh-feature']).candidates.length,3);
  const file=join(root,'plugins/dsh-base/package.json'), manifest=JSON.parse(readFileSync(file)); manifest.private=true;writeFileSync(file,JSON.stringify(manifest));
  assert.equal(workspace(root,['@klarkxy/dsh-feature']).candidates.length,2);
  assert.throws(() => workspace(root,['@klarkxy/dsh-base']),/public testing/);
  update(root,d=>stage(d.packages[0],'draft'));
  assert.throws(() => workspace(root,['@klarkxy/dsh-feature']),/unpublished dependencies/);
});

test('all local public dependency fields participate and private runtime dependencies remain forbidden', t => {
  for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies']) {
    const root=fixture(t,{'dsh-feature':{[field]:{'@klarkxy/dsh-base':'^1.2.3'}},'dsh-other':{devDependencies:{'@klarkxy/dsh-feature':'workspace:*'}}});
    update(root,d=>stage(d.packages[0],'testing')); assert.deepEqual(workspace(root).candidates,[]);
    assert.ok(releaseEligibility(root).blockers.get('@klarkxy/dsh-other').includes('@klarkxy/dsh-base'));
  }
  for(const field of ['dependencies','optionalDependencies','peerDependencies']) {
    const root=fixture(t,{'dsh-base':{private:true},'dsh-feature':{[field]:{'@klarkxy/dsh-base':'workspace:*'}}});
    assert.throws(()=>workspace(root),/private runtime dependency/);
  }
});

test('holds and migration freezes block first releases and updates without changing lifecycle', async t => {
  const root=fixture(t), result=await savedPlan(root);
  writeFileSync(join(root,'scripts/npm-release-holds.json'),JSON.stringify({packages:[{name:'@klarkxy/dsh-base',reason:'Frozen'}]}));
  assert.throws(()=>preflightReleases(root,result,fakePack),/held/);
  assert.equal(readReleaseStates(root).get('@klarkxy/dsh-base').state,'published');
  assert.throws(()=>workspace(root,['@klarkxy/dsh-base']),/held/);
  writeFileSync(join(root,'scripts/editor-plugin-migration.json'),JSON.stringify({holdPublish:true,packages:[{name:'@klarkxy/dsh-feature'}]}));
  assert.throws(()=>workspace(root,['@klarkxy/dsh-feature']),/held/);
});

test('saved plans reject changed identities, channels and any source or dependency change before network access', async t => {
  const root=fixture(t), result=await savedPlan(root);
  assert.throws(()=>preflightReleases(root,[],fakePack),/obsolete/);
  for(const edit of [r=>{r.directory='../../outside';},r=>{r.version='9.0.0';},r=>{r.distTag='next';}]) {
    const altered=structuredClone(result);edit(altered.releases[0]);assert.throws(()=>preflightReleases(root,altered,fakePack));
  }
  assert.throws(()=>preflightReleases(root,{...result,releases:[...result.releases,result.releases[0]]},fakePack),/duplicate/);
  let network=0;
  await assert.rejects(publish(root,(...args)=>({...fakePack(...args),sourceHash:args[1].name===result.releases.at(-1).name?'b'.repeat(64):'a'.repeat(64)}),{
    lookup:async()=>{network++;throw Error('Unexpected network');},
  }),/changed after planning/);
  assert.equal(network,0);
});

test('a saved plan cannot omit or reorder explicitly selected first-release dependencies', async t => {
  const root=fixture(t,{'dsh-feature':{dependencies:{'@klarkxy/dsh-base':'workspace:*'}}});
  update(root,d=>d.packages.forEach(e=>stage(e,'testing')));
  const result=await savedPlan(root,['@klarkxy/dsh-base','@klarkxy/dsh-feature']);
  let packed=0;const packer=(...args)=>{packed++;return fakePack(...args);};
  assert.throws(()=>preflightReleases(root,{...result,releases:result.releases.slice(1)},packer),/Incomplete/);
  assert.throws(()=>preflightReleases(root,{...result,releases:[...result.releases].reverse()},packer),/reordered/);
  assert.equal(packed,0);
});

test('held bundled dependency changes invalidate this plan without requiring manual acceptance', async t => {
  const root=fixture(t,{'dsh-feature':{devDependencies:{'@klarkxy/dsh-base':'workspace:*'}}});
  writeFileSync(join(root,'scripts/npm-release-holds.json'),JSON.stringify({packages:[{name:'@klarkxy/dsh-base',reason:'Hold'}]}));
  const result=await plan(root,[],{lookup:async()=>({versions:{'1.2.3':{version:'1.2.3'}},'dist-tags':{}}),packer:fakePack});
  assert.throws(()=>preflightReleases(root,result,(...args)=>({...fakePack(...args),sourceHash:args[1].name==='@klarkxy/dsh-base'?'b'.repeat(64):'a'.repeat(64)})),/dependency changed after planning/);
});

function publicationHarness(root, { failSubmission, corruptArchive=false, pending=false }={}) {
  const accepted=new Set(), submits=[];
  const lookup=async(name,_fetch,version='1.2.3')=>({versions:accepted.has(name)?{[version]:{name,version,dist:{tarball:'https://example.invalid/archive',integrity}}}:{},'dist-tags':{},time:{[version]:publication.publishedAt}});
  const submit=async args=>{const name='@klarkxy/'+basename(args[1],'.tgz');submits.push(name);if(name===failSubmission)throw Error('Synthetic submission failure');accepted.add(name);return 'Accepted fixture';};
  const fetcher=async()=>pending?new Response('',{status:404}):new Response(corruptArchive?'wrong archive':archive);
  return {accepted,submits,options:{lookup,submit,fetcher,timeoutMs:0}};
}

test('successful first publication records immutable history only after archive verification and supports retry', async t => {
  const root=fixture(t);update(root,d=>d.packages.forEach(e=>stage(e,'testing')));await savedPlan(root,['@klarkxy/dsh-base']);
  const harness=publicationHarness(root);await publish(root,fakePack,harness.options);
  assert.deepEqual(readReleaseStates(root).get('@klarkxy/dsh-base').publication,publication);
  assert.equal(readReleaseStates(root).get('@klarkxy/dsh-feature').state,'testing');
  syncStateDocs(root,workspace(root));
  const proof=readFileSync(join(root,releaseStateFile),'utf8');
  await publish(root,fakePack,harness.options);
  assert.deepEqual(harness.submits,['@klarkxy/dsh-base']);assert.equal(readFileSync(join(root,releaseStateFile),'utf8'),proof);
  assert.equal(JSON.parse(readFileSync(join(root,'.artifacts/npm-release/verified-publications.json'))).length,1);
});

test('a later failed submission retains earlier verified publication and recovery never resubmits it', async t => {
  const root=fixture(t);update(root,d=>d.packages.forEach(e=>stage(e,'testing')));await savedPlan(root,['@klarkxy/dsh-base','@klarkxy/dsh-feature']);
  const harness=publicationHarness(root,{failSubmission:'@klarkxy/dsh-feature'});
  await assert.rejects(publish(root,fakePack,harness.options),/submission failure/);
  assert.equal(readReleaseStates(root).get('@klarkxy/dsh-base').state,'published');
  assert.equal(readReleaseStates(root).get('@klarkxy/dsh-feature').state,'testing');
  assert.equal(JSON.parse(readFileSync(join(root,'.artifacts/npm-release/verified-publications.json'))).length,1);
  harness.options.submit=async args=>{harness.submits.push('@klarkxy/'+basename(args[1],'.tgz'));harness.accepted.add('@klarkxy/dsh-feature');return 'Recovered';};
  await publish(root,fakePack,harness.options);
  assert.equal(harness.submits.filter(n=>n==='@klarkxy/dsh-base').length,1);
  assert.equal(readReleaseStates(root).get('@klarkxy/dsh-feature').state,'published');
});

test('one archive verification failure does not discard another package that verified successfully', async t => {
  const root=fixture(t);update(root,d=>d.packages.forEach(e=>stage(e,'testing')));await savedPlan(root,['@klarkxy/dsh-base','@klarkxy/dsh-feature']);
  const harness=publicationHarness(root),lookup=harness.options.lookup;
  harness.options.lookup=async(...args)=>{const result=await lookup(...args);for(const remote of Object.values(result.versions))remote.dist.tarball+='?name='+args[0];return result;};
  harness.options.fetcher=async url=>new Response(url.endsWith('dsh-feature')?'wrong archive':archive);
  await assert.rejects(publish(root,fakePack,harness.options),/Downloaded archive mismatch/);
  assert.equal(readReleaseStates(root).get('@klarkxy/dsh-base').state,'published');
  assert.equal(readReleaseStates(root).get('@klarkxy/dsh-feature').state,'testing');
  assert.equal(JSON.parse(readFileSync(join(root,'.artifacts/npm-release/verified-publications.json'))).length,1);
});

test('a failed maintenance release leaves every historical Published record untouched', async t => {
  const root=fixture(t),before=readFileSync(join(root,releaseStateFile),'utf8');await savedPlan(root);
  await assert.rejects(publish(root,fakePack,publicationHarness(root,{corruptArchive:true}).options),/Downloaded archive mismatch/);
  assert.equal(readFileSync(join(root,releaseStateFile),'utf8'),before);
});

test('submission, scanning and archive verification failures never promote Testing', async t => {
  for(const options of [{failSubmission:'@klarkxy/dsh-base'},{pending:true},{corruptArchive:true}]) {
    const root=fixture(t);update(root,d=>d.packages.forEach(e=>stage(e,'testing')));await savedPlan(root,['@klarkxy/dsh-base']);
    await assert.rejects(publish(root,fakePack,publicationHarness(root,options).options));
    assert.equal(readReleaseStates(root).get('@klarkxy/dsh-base').state,'testing');
  }
});

test('exact-version availability waits for packument publication time without losing the pending first release', async t => {
  const root=fixture(t);update(root,d=>d.packages.forEach(e=>stage(e,'testing')));await savedPlan(root,['@klarkxy/dsh-base']);
  const harness=publicationHarness(root),lookup=harness.options.lookup;
  let waited=0;
  harness.options.lookup=async(...args)=>{const metadata=await lookup(...args);if(!waited)delete metadata.time;return metadata;};
  harness.options.wait=async()=>{assert.equal(readReleaseStates(root).get('@klarkxy/dsh-base').state,'testing');waited++;};
  harness.options.timeoutMs=10000;
  await publish(root,fakePack,harness.options);
  assert.equal(waited,1);assert.equal(readReleaseStates(root).get('@klarkxy/dsh-base').state,'published');
});

test('real packed source fingerprints survive version writeback but detect delivered changes', t => {
  const root=fixture(t,{'dsh-feature':{dependencies:{'@klarkxy/dsh-base':'workspace:*'}}});
  const inventory=discoverPackages(root,{includePrivate:true}), base=inventory.find(p=>p.slug==='dsh-base'), feature=inventory.find(p=>p.slug==='dsh-feature');
  const before=packSnapshot(root,feature,inventory,npm);
  writeVersion(root,{...base,version:'1.2.4',hash:'automation'});writeVersion(root,{...feature,version:'1.2.4',hash:'automation'});
  const after=packSnapshot(root,feature,inventory,npm);assert.equal(after.sourceHash,before.sourceHash);assert.notEqual(after.hash,before.hash);
  writeFileSync(join(root,feature.directory,'index.js'),'export const value = 2;\n');
  assert.notEqual(packSnapshot(root,feature,inventory,npm).sourceHash,before.sourceHash);
});

test('docs sync exactly while preserving ordinary prose and repository registry consistency', t => {
  const root=fixture(t);assert.throws(()=>syncStateDocs(root,workspace(root)),/outdated/);
  syncStateDocs(root,workspace(root),true);syncStateDocs(root,workspace(root));
  assert.ok(readFileSync(join(root,'README.md'),'utf8').startsWith('Original prose.\n'));
  assert.throws(()=>main(root,['--fingerprint','@klarkxy/dsh-missing']),/Unknown package/);
  writeFileSync(join(root,'README.md'),'Missing markers');assert.throws(()=>syncStateDocs(root,workspace(root),true),/expected one/);
  const repo=fileURLToPath(new URL('../',import.meta.url));syncStateDocs(repo,workspace(repo));
  for(const pkg of workspace(repo).inventory)assert.match(readFileSync(join(repo,pkg.directory,'README.md'),'utf8'),/<!-- release-state-note -->/);
});
