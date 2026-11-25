const test=require('node:test');
const assert=require('node:assert/strict');
const {usd,paymentWarning,paymentAmount,documentStatus,dateISO,nextWeek}=require('../scripts/octo/recheck/rules');
const {videoFindings,profileNames,waitForSheet,beginReport}=require('../scripts/octo/recheck');

test('All time costs keep cents, including a true zero, and reject unloaded metrics',()=>{
  assert.equal(usd('0'),'0.00');
  assert.equal(usd('$1,230.4'),'1230.40');
  for (const blank of ['',null,'—','Loading','€5.10','0.10 EUR']) assert.throws(()=>usd(blank));
});
test('payment amounts come from payment notices and use the available SproutG options',()=>{
  const base='Your account is paused. To run ads again, make a payment';
  assert.equal(paymentWarning(base),true);
  assert.equal(paymentWarning('Confirm your affiliation with the organization'),false);
  assert.equal(paymentAmount([base+' before December 10, 2026.']),'20$');
  assert.equal(paymentAmount([base+' of at least USD 50.00.']),'50$');
  assert.equal(paymentAmount([base+' of 10$.']),'10$');
  for (const banners of [[],[base+' of $15'],[base+' of EUR 20'],[base+' of $10 or $50']]) assert.throws(()=>paymentAmount(banners));
});
test('verification requires matching document details; the task title alone never sets a status',()=>{
  assert.equal(documentStatus('Provide information for Example. Organization. Personal details.'),'QR');
  assert.equal(documentStatus('Organization registration documents. Proof of identity: passport.'),'Взять в работу');
  assert.throws(()=>documentStatus('Submit your documents'));
});
test('delayed Google Sheets writes are verified as a group with increasing waits and zero resubmits',async()=>{
  const records=['01','02','03'].map(account=>({account,cost:'0.19',currency:'USD'}));
  const delays=[];
  let reads=0;
  const read=async(profile,action)=>{
    assert.equal(profile,'Example MCC');
    assert.equal(action,'snapshot');
    reads++;
    return {verificationOptions:[],rows:records.map(({account},i)=>({account,row:7+i,
      values:{X:reads>i?'0.19':'0.02',W:'2026-10-01',Z:'+'}}))};
  };
  await waitForSheet('Example MCC',records,'2026-11-25',read,async ms=>delays.push(ms));
  assert.equal(reads,3);
  assert.deepEqual(delays,[5000,12000]);
});
test('slow confirmation backs off to one read per five minutes and continues the existing run',async()=>{
  const record={account:'03',cost:'0.20',currency:'USD'};
  const waits=[];
  const read=async()=>({verificationOptions:[],rows:[{account:'03',row:4,values:{
    X:waits.length>=9?'0.20':'0.00',W:'2026-11-25',Z:'+'}}]});
  await waitForSheet('Example MCC',[record],'2026-11-25',read,async ms=>waits.push(ms));
  assert.deepEqual(waits.slice(-3),[300000,300000,300000]);
});
test('a new chat reuses an unresolved write for the same profiles and starts fresh after verification',async t=>{
  const fs=require('node:fs/promises');
  const id='12345678-1111-4444-8888-123456789abc';
  const group={profile:'Example MCC',rows:[{account:'01',saved:{accepted:true,verified:false}}]};
  const previous={id,mode:'run',today:'2026-11-24',groups:[group]};
  t.mock.method(fs,'mkdir',async()=>{});
  t.mock.method(fs,'readdir',async()=>[id+'.json']);
  t.mock.method(fs,'readFile',async()=>JSON.stringify(previous));
  assert.equal((await beginReport('run',[group.profile])).id,id);
  group.rows[0].saved.verified=true;
  assert.notEqual((await beginReport('run',[group.profile])).id,id);
});
test('an expired end date is compared to the recheck day, and only an explicit refusal flags the ad',()=>{
  const findings=videoFindings([{id:'a',video:true,endDate:'2026-11-24'},{id:'b',video:true,endDate:'2026-11-25'}],
    [{video:true,status:'Eligible'},{video:true,status:'Ended'},{video:false,status:'Disapproved'}],'2026-11-25');
  assert.equal(findings.replace,false); assert.deepEqual(findings.extensions.map(c=>c.id),['a']);
  assert.equal(videoFindings([], [{video:true,status:'Disapproved'}],'2026-11-25').replace,true);
  const campaign=[{id:'a',video:true,endDate:'none'}];
  assert.equal(videoFindings(campaign,[{video:true,status:'Not eligible'}],'2026-11-25').issues.length,1);
  assert.deepEqual(videoFindings(campaign,[{video:true,status:'Not eligible (Disapproved)'}],'2026-11-25').issues,[]);
  assert.equal(nextWeek('2026-12-28'),'2027-01-04');
  assert.equal(dateISO('Feb 29, 2027'),null);
  assert.equal(dateISO('Dec 1, 2026'),'2026-12-01');
  assert.deepEqual(profileNames(['MCC B','MCC A']),['MCC B','MCC A']);
});
