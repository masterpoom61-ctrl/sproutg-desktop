const test = require('node:test');
const assert = require('node:assert/strict');
const {changes,processRequest,day}=require('../src/main/octoRecheck');
const profile='Example MCC',today='2026-11-25';
const record={account:'01',customerId:'111-222-3333',cost:'0.00',currency:'USD'};
test('zero is a real expense, existing recheck date and status are independent',()=>{
  assert.deepEqual(changes({X:'',W:'2026-10-01',Z:'pending'},record,today,[]),{X:'0.00'});
  assert.deepEqual(changes({X:0,W:'',Z:'done'},record,today,[]),{W:today});
  assert.deepEqual(changes({X:'0,00',W:today,Z:''},record,today,[]),{Z:'+'});
  assert.throws(()=>changes({}, {...record,cost:''},today,[]));
  assert.equal(day(new Date('2026-11-25T22:00:00Z')),'2026-11-26');
});
test('recheck preserves comments, deduplicates, and writes only supported verification / PrePay options',()=>{
  const status={...record,verification:'QR',prepay:'20$',replace:true};
  const values={W:today,X:'0.00',Z:'+',Y:'Другой комментарий'};
  const updates=changes(values,status,today,['QR']);
  assert.deepEqual(updates,{U:'QR',S:'20$',Y:'Другой комментарий\nЗамена видео'});
  assert.deepEqual(changes({...values,...updates},status,today,['QR']),{});
  assert.throws(()=>changes(values,{...status,prepay:'5$'},today,['QR']));
  assert.throws(()=>changes(values,status,today,[]));
});
test('fresh row lookup, persistent queue and server readback, with no unrelated data in snapshot',async()=>{
  const row={row:7,accountName:'01',values:{X:0,W:'',Z:'+',AO:'private'}};
  const calls=[];
  const api=async(action,payload)=>{
    calls.push(action);
    if (action==='mcc.profile') return {ok:true,data:{profileName:profile,rows:[row],dropdowns:{U:['QR']}}};
    assert.deepEqual(payload,{row:7,updates:{W:today},identity:{profileName:profile,accountName:'01'}});
    row.values.W='25.11.2026';
    return {ok:true,data:{}};
  };
  assert.deepEqual((await processRequest({profile,action:'save',today,record},api)).columns,['W']);
  assert.deepEqual(calls,['mcc.profile','mcc.updateCells','mcc.profile']);
  assert.equal(JSON.stringify(await processRequest({profile,action:'snapshot'},api)).includes('private'),false);
  row.isDeleted=true;
  await assert.rejects(()=>processRequest({profile,action:'save',today,record},api),/удалена/);
});
