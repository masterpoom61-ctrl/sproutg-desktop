'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const session = require('../src/renderer/core/workSession');
const { saveWorkSession, loadWorkSession } = require('../src/main/workSessionStore');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
function slice(from, to){ return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from))); }
class Element {
  constructor(tag){ this.tagName = tag.toUpperCase(); this.dataset = {}; this.handlers = {}; this.value = ''; this.textContent = ''; }
  addEventListener(type, fn){ (this.handlers[type] ||= []).push(fn); }
  dispatch(type){ for(const fn of this.handlers[type] || []) fn({}); }
  matches(selector){ return selector.split(',').includes(this.tagName.toLowerCase()); }
}
function fioFixture(edit = false, value = ''){
  const writes = [];
  const row = { row:42, accountName:'02', values:{ AC:value } };
  const context = vm.createContext({ document:{ createElement:tag=>new Element(tag) }, mccEditMode:edit,
    mccProfile:{ profileName:'Profile', rows:[row] }, mccIsExpenseCol:()=>false, applySheetCellColorHint:()=>{},
    toast:()=>{}, updateMccTabsColors:()=>{}, syncMccVerificationControls:()=>{}, updateMccPassLookupAndApply:()=>{},
    applyPassGeoBadges:()=>{}, copyText:()=>{}, saveMccCellInstant:(...args)=>writes.push(args) });
  vm.runInContext(slice('  function mccBuildButton(', '  function mccBuildDateInput(')
    + slice('  function mccBuildFioControl_(', '  function mccBuildPlusSelectControl('), context);
  return { context, row, writes };
}
test('empty/whitespace MCC AC accepts paste immediately outside edit mode', ()=>{
  for(const value of ['', '   ']){
    const { context, row, writes } = fioFixture(false, value);
    const control = context.mccBuildFioControl_(row);
    assert.equal(control.tagName, 'INPUT');
    control.value = 'Иванов Иван';
    control.dispatch('input');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].slice(0,3), [42, 'AC', 'Иванов Иван']);
    writes[0][3]();
    control.dispatch('blur');
    assert.equal(writes.length, 1, 'blur must not duplicate an acknowledged paste');
  }
});
test('nonempty FIO remains copy-only outside editing; edit mode saves on blur', ()=>{
  const fixed = fioFixture(false, 'Saved');
  assert.equal(fixed.context.mccBuildFioControl_(fixed.row).tagName, 'BUTTON');
  const editable = fioFixture(true, 'Saved');
  const input = editable.context.mccBuildFioControl_(editable.row);
  input.value = 'Changed'; input.dispatch('input');
  assert.equal(editable.writes.length, 0);
  input.dispatch('blur');
  assert.equal(editable.writes.length, 1);
});
test('failed instant FIO save can retry and superseding input is queued', ()=>{
  const { context, row, writes } = fioFixture();
  const input = context.mccBuildFioControl_(row);
  input.value = 'A'; input.dispatch('input');
  input.value = 'AB'; input.dispatch('input');
  assert.deepEqual(writes.map(args=>args[2]), ['A','AB']);
  writes[1][4]('offline'); input.dispatch('blur');
  assert.equal(writes.length, 3);
});
function passportFixture(){
  const writes = [], copied = [], synced = [];
  let closed = 0;
  const context = vm.createContext({ activePage:'MCC', mccProfile:{ profileName:'P', rows:[
    {row:42,accountName:'01',values:{}}, {row:43,accountName:'02',values:{}} ] },
    copyText:value=>copied.push(value), toast:()=>{}, renderPassModalStatus:()=>{},
    syncMccVerificationControls:(...args)=>synced.push(args), updateMccPassLookupAndApply:()=>{}, applyPassGeoBadges:()=>{},
    saveMccCellInstant:(...args)=>writes.push(args), closePassModal:()=>closed++ });
  vm.runInContext('let passSelectionSession = {profileName:"P",accountName:"02",pending:false};'
    + slice('  function selectMccPassport_(', '  function renderPassModalStatus('), context);
  return { context,writes,copied,synced,closed:()=>closed };
}
test('passport selection writes exact target AC, copies and closes only after durable ACK', ()=>{
  const f = passportFixture();
  f.context.selectMccPassport_('Passport');
  f.context.selectMccPassport_('Duplicate click');
  assert.equal(f.writes.length,1);
  assert.deepEqual(f.writes[0].slice(0,3),[43,'AC','Passport']);
  assert.equal(f.copied.length,0); assert.equal(f.closed(),0);
  f.writes[0][3]();
  assert.deepEqual(f.copied,['Passport']); assert.equal(f.closed(),1);
  assert.equal(f.synced[0][0].accountName,'02');
});
test('passport target follows moved rows but rejects changed profiles and duplicate accounts', ()=>{
  const moved = passportFixture(); moved.context.mccProfile.rows[1].row = 81;
  moved.context.selectMccPassport_('Passport'); assert.equal(moved.writes[0][0],81);
  const changed = passportFixture(); changed.context.mccProfile.profileName = 'Other';
  changed.context.selectMccPassport_('Passport'); assert.equal(changed.writes.length,0);
  const duplicate = passportFixture(); duplicate.context.mccProfile.rows.push({row:82,accountName:'02'});
  duplicate.context.selectMccPassport_('Passport'); assert.equal(duplicate.writes.length,0);
});
test('passport failure keeps picker open and retry enabled; late ACK cannot update another profile', ()=>{
  const f = passportFixture(); f.context.selectMccPassport_('Passport'); f.writes[0][4]('disk failed');
  assert.equal(f.copied.length,0); assert.equal(f.closed(),0);
  f.context.selectMccPassport_('Retry'); assert.equal(f.writes.length,2);
  f.context.mccProfile.profileName = 'Other'; f.writes[1][3]();
  assert.equal(f.synced.length,0);
});
test('AC sync changes button text, not its unrelated HTML value property', ()=>{
  const button = new Element('button'), input = new Element('input');
  const context = vm.createContext({document:{querySelectorAll:()=>[button,input]},updateMccVerificationPairColors:()=>{},updateMccTabsColors:()=>{}});
  vm.runInContext(slice('  function syncMccVerificationControls(', '  function buildMccVerificationDateControl('),context);
  context.syncMccVerificationControls({row:43,values:{}},{AC:'New FIO'});
  assert.equal(button.textContent,'New FIO'); assert.equal(input.value,'New FIO');
});
test('work session validates offsets and matches semantic profile even after sheet row moves', ()=>{
  const value = session.normalize({page:'MCC',profile:'P',row:42,account:'02',scrollTop:1234,scrollLeft:-10});
  assert.equal(value.scrollTop,1234); assert.equal(value.scrollLeft,0);
  assert.equal(session.matches(value,{page:'MCC',profile:'P',row:'81'}),true);
  assert.equal(session.matches(value,{page:'MCC',profile:'p'}),false);
  for(const invalid of [{}, {page:'MCC',profile:'P',row:0}, {page:'MCC',profile:'',row:1}]) assert.equal(session.normalize(invalid),null);
});
test('disk work session survives process termination without shutdown hooks and is endpoint-bound', t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'sproutg-session-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir,'session.json');
  const moduleFile = require.resolve('../src/main/workSessionStore');
  const snapshot = {page:'MCC',profile:'P',row:42,account:'02',scrollTop:5432,scrollLeft:0};
  const child = spawnSync(process.execPath,['-e',`require(${JSON.stringify(moduleFile)}).saveWorkSession(${JSON.stringify(file)},'endpoint-A',${JSON.stringify(snapshot)}); process.exit(17);`]);
  assert.equal(child.status,17);
  assert.deepEqual(loadWorkSession(file,'endpoint-A'),session.normalize(snapshot));
  assert.equal(loadWorkSession(file,'endpoint-B'),null);
  saveWorkSession(file,'endpoint-A',null); assert.equal(loadWorkSession(file,'endpoint-A'),null);
  fs.writeFileSync(file,'{broken'); assert.equal(loadWorkSession(file,'endpoint-A'),null);
});

function resumeFixture(saved){
  const restored = [], persisted = [], listeners = {};
  let now = 1000;
  const context = vm.createContext({window:{SproutWorkSession:session,addEventListener:()=>{},sproutg:{
    getWorkSession:async()=>saved,saveWorkSession:s=>persisted.push(s) }},
    document:{addEventListener:(event,fn)=>listeners[event]=fn},Date:{now:()=>now},
    activePage:'',mccActiveAccount:'01',sproutgScrollRestoreSeq:0,
    captureSproutScroll_:()=>({page:context.activePage,profile:'P',row:'90',scrollTop:0,scrollLeft:0}),
    getCurrentScrollContext_:()=>({page:context.activePage,profile:'P',row:'90'}),
    requestAnimationFrame:()=>{},setTimeout:()=>{},console,
    setActivePage:page=>context.activePage=page,
    mccFindAccountIndexByName:()=>1,updateMccNav:()=>{},restoreSproutScroll_:(s)=>restored.push(s),
    getMccProfileKey:name=>name,mccProfileTabMap:new Map(),openMccProfileTab:()=>{},openByRow:()=>{},
    nextReqToken:()=>{} });
  vm.runInContext(slice('  let workSessionReady = false;', '  function updateAppHeaderHeight('),context);
  return {context,restored,persisted,listeners,setTime:value=>now=value};
}
test('startup restore uses disk page and retains exact offset across immediate cached-profile refresh',async()=>{
  const f=resumeFixture({page:'MCC',profile:'P',row:42,account:'02',scrollTop:3260,scrollLeft:0});
  await f.context.setupWorkSession_();
  assert.equal(f.context.activePage,'MCC');
  f.context.resumeWorkSessionAfterRender_();
  f.context.resumeWorkSessionAfterRender_(); // fresh read can render before the first restore frame
  assert.equal(f.restored.length,2);
  for(const value of f.restored){ assert.equal(value.scrollTop,3260);assert.equal(value.row,'90'); }
  f.context.persistWorkSession_();assert.equal(f.persisted.length,0,'transient zero scroll must not overwrite saved position');
  f.setTime(1400);f.context.persistWorkSession_();assert.equal(f.persisted.length,1);
});
test('trusted user navigation cancels delayed startup restoration',async()=>{
  const f=resumeFixture({page:'MCC',profile:'P',row:42,account:'02',scrollTop:3260});
  await f.context.setupWorkSession_();
  f.listeners.pointerdown({isTrusted:true});
  f.context.resumeWorkSessionAfterRender_();
  assert.equal(f.restored.length,0);
});
