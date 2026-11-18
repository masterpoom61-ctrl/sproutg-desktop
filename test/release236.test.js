'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const renderer = read('src/renderer/app.js');
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

test('O1 search captures every submission, waits for prior results, and continues after failure', async () => {
  const field = { value:'' };
  const requests = [];
  const opened = [];
  const context = vm.createContext({
    document:{getElementById:()=>field}, o1SearchGeneration:0, o1OpenQueue:Promise.resolve(), editMode:false,
    current:null,setError:()=>{},toast:()=>{},apiPayload:value=>value,apiErrorText:()=>'',renderProfile:()=>{},
    ensureTab:profile=>opened.push(profile.profileName),
    google:{script:{get run(){
      return {
        withSuccessHandler(handler){ this.ok=handler; return this; },
        withFailureHandler(handler){ this.fail=handler; return this; },
        findProfile(name){ requests.push({name,ok:this.ok,fail:this.fail}); }
      };
    }}}
  });
  vm.runInContext(section(renderer,'  function search(){','  function openByRow('),context);
  for(const name of ['A','B','C']){
    field.value=name;
    context.search();
  }
  field.value='unsent';
  const tick = () => new Promise(resolve=>setImmediate(resolve));
  await tick();
  assert.deepEqual(requests.map(r=>r.name),['A']);
  requests[0].ok({profileName:'A'});
  await tick();
  assert.deepEqual(requests.map(r=>r.name),['A','B']);
  requests[1].fail('lookup failed');
  await tick();
  assert.deepEqual(requests.map(r=>r.name),['A','B','C']);
  requests[2].ok({profileName:'C'});
  await context.o1OpenQueue;
  assert.deepEqual(opened,['A','C']);
});

test('a late O1 confirmation refresh cannot add back a closed or replaced tab', () => {
  let scheduled;
  let success;
  const adopted = [];
  const context = vm.createContext({
    window:{},_o1ConfirmedRefreshTimers:new Map(),clearTimeout:()=>{},setTimeout:fn=>{scheduled=fn;},
    tabData:{tab:{row:72,profileName:'Old'}},openTabs:['tab'],tabNav:{},activeTabKey:'other',
    apiPayload:x=>x,mergeO1LocalValues_:()=>{},renderTabs:()=>{},adoptLoadedO1Tab_:(key)=>adopted.push(key),
    google:{script:{run:{
      withSuccessHandler(fn){success=fn;return this;}, withFailureHandler(){return this;},getProfileByRow(){}
    }}}
  });
  vm.runInContext(section(renderer,'  function scheduleO1ConfirmedRefresh_(', '  function retireO1LocalValues_('),context);
  const entry = {ownerKey:'owner',profileName:'Old',row:72,tabKey:'tab'};
  for(const reopen of [false,true]){
    context.openTabs.splice(0,Infinity,'tab');
    context.tabData.tab={row:72,profileName:'Old'};
    context.scheduleO1ConfirmedRefresh_(entry);
    scheduled();
    delete context.tabData.tab;
    context.openTabs.length=0;
    if(reopen){
      context.tabData.tab={row:72,profileName:'Old'};
      context.openTabs.push('tab');
    }
    success({ok:true,row:72,profileName:'Old'});
  }
  assert.deepEqual(adopted,[]);
});

test('O1 drag order keeps the active tab and models intact', () => {
  const context = vm.createContext({openTabs:['A','B','C'],activeTabKey:'B'});
  vm.runInContext(section(renderer,'  function moveO1Tab_(', '  function renderTabs('),context);
  assert.equal(context.moveO1Tab_('A','C',true),true);
  assert.deepEqual(context.openTabs,['B','C','A']);
  assert.equal(context.moveO1Tab_('A','B',false),true);
  assert.deepEqual(context.openTabs,['A','B','C']);
  assert.equal(context.moveO1Tab_('A','gone',false),false);
  assert.equal(context.activeTabKey,'B');
});

test('connected badge is green for slow responses, amber for backlog and red on loss', () => {
  const context = vm.createContext({});
  const api = read('src/renderer/core/api.js');
  vm.runInContext(section(api,'  function bridgeHealth(', '  function renderBridgePopup('),context);
  assert.equal(context.bridgeHealth({
    ready:true,status:'ready',metrics:{lastDurationMs:10000,avgDurationMs:8900,total:20,failed:8},
    writeQueue:{pending:1}
  }),'ok');
  assert.equal(context.bridgeHealth({ready:true,status:'ready',metrics:{pending:4,queued:2}}),'warn');
  assert.equal(context.bridgeHealth({ready:true,status:'ready',writeQueue:{pending:5}}),'warn');
  assert.equal(context.bridgeHealth({ready:true,status:'ready',writeQueue:{blockedBackend:1}}),'warn');
  assert.equal(context.bridgeHealth({ready:false,status:'disconnected'}),'bad');
});
