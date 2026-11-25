'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {control,withBatchLock,readOnce}=require('./queue');
const {home,jobs,sleep,online,request,appRequest,clearAppReceipt}=require('./recheck/transport');
const {day,findRow,changes}=require('../../src/main/octoRecheck');
const {nextWeek}=require('./recheck/rules');
const queue=path.join(home,'queue'), reports=path.join(home,'rechecks');
const readbackDelays=[0,5000,12000,25000,45000,60000,60000];
function matchesSheet(snapshot,record,today) {
  const row=findRow(snapshot,record.account);
  return !Object.keys(changes(row.values,record,today,snapshot.verificationOptions)).length;
}
async function waitForSheet(profile,records,today,readProfile=appRequest,wait=sleep) {
  let details='';
  for (const delay of readbackDelays) {
    if (delay) await wait(delay);
    try {
      const snapshot=await readProfile(profile,'snapshot');
      const missing=records.filter(record=>!matchesSheet(snapshot,record,today));
      if (!missing.length) return snapshot;
      details=missing.map(r=>r.account).join(', ');
    } catch(e) { details=e.message; }
  }
  throw Error('Ждём подтверждения таблицы: '+details+'. Результат сохранён в журнале.');
}
function desired(entry) {
  const r={account:entry.account,customerId:entry.customerId,cost:entry.cost,currency:entry.currency};
  if (entry.policy?.verification) r.verification=entry.policy.verification;
  if (entry.policy?.prepay) r.prepay=entry.policy.prepay;
  if (entry.videos?.replace) r.replace=true;
  return r;
}
async function saveExpense(report,group,entry,record) {
  entry.pendingWrite??={id:randomUUID(),record,durableReceipt:true};
  const {id}=entry.pendingWrite;
  const today=entry.checkedOn || report.today;
  await saveReport(report);
  try {
    const saved=await appRequest(group.profile,'save',{today,record},id);
    if (!saved?.verified || saved.account!==entry.account) throw Error('Ответ SproutG не подтвердил запись.');
    entry.saved=saved;
  } catch (err) {
    if (err.message.includes('Таблица не подтвердила запись')) {
      // SproutG's durable queue already acknowledged the write. Re-read several accepted rows together.
      entry.saved={account:entry.account,accepted:true,verified:false};
    } else {
      // A write may already have reached Apps Script. Only issue fresh reads while it settles.
      console.log(group.profile+' / '+entry.account+' | ожидаю запись в таблице');
      try { await waitForSheet(group.profile,[record],today); }
      catch (pending) { throw Error(err.message+' '+pending.message); }
      entry.saved={account:entry.account,verified:true,delayed:true};
    }
  }
  delete entry.pendingWrite;
  await saveReport(report);
  await clearAppReceipt(id);
}
async function verifyGroup(report,group) {
  if (report.mode==='review') return;
  await waitForSheet(group.profile,group.rows.filter(e=>e.saved).map(desired),report.today);
  for (const e of group.rows.filter(e=>e.saved)) {
    e.saved.verified=true;
    e.complete=!e.issues.length && !e.pendingDate;
  }
  group.sheetVerifiedAt=new Date().toISOString();
  await saveReport(report);
}

function profileNames(names) {
  const result=names.map(s=>s.trim());
  if (!result.length || result.some(s=>!s || s.length>128) || new Set(result.map(s=>s.toLowerCase())).size!==result.length)
    throw Error('Укажите неповторяющиеся имена MCC по порядку.');
  return result;
}
function videoFindings(campaigns,ads,today) {
  const replace=ads.some(a=>a.video && /\bdisapproved\b/i.test(a.status));
  const videos=campaigns.filter(c=>c.video);
  const extensions=videos.filter(c=>c.endDate && c.endDate!=='none' && c.endDate<today);
  const issues=[];
  if (!videos.length) issues.push('В таблице нет видеокампаний.');
  if (videos.some(c=>!c.endDate)) issues.push('Не видна дата окончания видеокампании.');
  if (!ads.some(a=>a.video)) issues.push('В таблице Ads нет подтверждённого видеообъявления.');
  const other=ads.filter(a=>a.video && !/\b(?:eligible|disapproved|ended|paused|removed|pending|under review)\b/i.test(a.status));
  if (other.length) issues.push('Неизвестный статус объявления: '+other.map(a=>a.status).join(', '));
  if (ads.some(a=>a.video && /^not eligible\b/i.test(a.status) && !/\bdisapproved\b/i.test(a.status)))
    issues.push('Статус Not eligible без подтверждённой причины отказа.');
  return {replace,extensions,issues};
}
async function saveReport(report) {
  await fs.mkdir(reports,{recursive:true});
  const file=path.join(reports,report.id+'.json'), temp=file+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temp,JSON.stringify(report,null,2),{flag:'wx'}); await fs.rename(temp,file);
}
async function readReport(id) {
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw Error('Нужен идентификатор отчёта.');
  const report=await readOnce(path.join(reports,id+'.json'));
  if (!report || report.id!==id) throw Error('Отчёт не найден.');
  return report;
}
async function openProfile(profile,owner,action='acquire',extra={}) {
  const ticket=await online();
  let settled=false;
  const start=control(queue,action,profile,owner,extra).finally(()=>{settled=true;});
  const prepare=async()=>{
    while(!settled) {
      await sleep(1200);
      if (!settled && (await request(ticket,profile,'manager',{launching:true})).ready) break;
    }
  };
  await Promise.all([start,prepare()]);
}
async function ensureProfile(profile,owner) {
  const ticket=await online();
  if ((await request(ticket,profile,'manager')).ready) return;
  const status=await control(queue,'state',profile,owner);
  if (!status.startsWith('Active MCC: ')) throw Error('Неизвестное состояние Octo.');
  const current=status.slice('Active MCC: '.length).trim();
  if (current===profile) {
    if ((await request(ticket,profile,'manager',{launching:true})).ready) return;
    throw Error('Страница управляющего аккаунта ещё не загрузилась для '+profile+'.');
  }
  if (current) await control(queue,'switch-stop',current,owner);
  await openProfile(profile,owner);
}
async function runProfile(report,group) {
  const p=group.profile;
  await ensureProfile(p,report.id);
  const ticket=await online();
  const audit=(action,fields={},hook)=>request(ticket,p,action,fields,hook);
  const inventory=await audit('inventory');
  if (inventory.period!=='All time' || !Array.isArray(inventory.rows)) throw Error('All time не подтверждён.');
  const awaiting=group.rows.filter(e=>!e.saved && e.issues?.some(s=>s.includes('Таблица не подтвердила запись')));
  if (awaiting.length) {
    await waitForSheet(p,awaiting.map(desired),report.today);
    for (const entry of awaiting) {
      entry.saved={verified:true,delayed:true,account:entry.account};
      entry.issues=entry.issues.filter(s=>!s.includes('Таблица не подтвердила запись'));
      entry.complete=!entry.issues.length;
    }
    await saveReport(report);
  }
  const snapshot=await appRequest(p,'snapshot');
  const previouslyAccepted=group.rows.filter(e=>e.saved?.accepted && !e.saved.verified);
  if (previouslyAccepted.length) {
    await waitForSheet(p,previouslyAccepted.map(desired),report.today);
    for (const e of previouslyAccepted) { e.saved.verified=true; e.complete=!e.issues.length && !e.pendingDate; }
    await saveReport(report);
  }
  // Check the entire join before writing a single expense; account names retain their leading zeros.
  for (const row of inventory.rows) findRow(snapshot,row.account);
  const found=new Set(inventory.rows.map(r=>r.account));
  group.missing=snapshot.rows.filter(r=>!r.deleted && /^\d{1,5}$/.test(r.account) && !found.has(r.account)).map(r=>r.account);
  if (group.missing.length) throw Error('В Performance не видны строки SproutG '+group.missing.join(', ')+'. Проверьте фильтры таблицы.');
  if (group.manager && group.manager!==inventory.manager) throw Error('Изменился Customer ID MCC.');
  group.manager=inventory.manager; group.total=inventory.rows.length;
  if (group.rows.some(old=>!inventory.rows.some(row=>row.account===old.account && row.customerId===old.customerId)))
    throw Error('После остановки изменилось соответствие номеров и Customer ID.');
  console.log(p+' | All time | '+group.total+' аккаунтов');
  await saveReport(report);
  for (const row of inventory.rows) {
    let entry=group.rows.find(r=>r.account===row.account);
    if (entry?.pendingWrite) {
      const pending=entry.pendingWrite, priorDay=entry.checkedOn || report.today;
      if (pending.durableReceipt && !matchesSheet(snapshot,pending.record,priorDay)) {
        await saveExpense(report,group,entry,pending.record);
        if (!entry.saved.verified) await waitForSheet(p,[pending.record],priorDay);
      } else if (!matchesSheet(snapshot,pending.record,priorDay)) {
        await waitForSheet(p,[pending.record],priorDay);
      }
      entry.saved={verified:true,delayed:true,account:entry.account};
      delete entry.pendingWrite;
      entry.issues=entry.issues.filter(s=>!s.startsWith('SproutG — '));
      entry.complete=!entry.issues.length && !entry.pendingDate;
      await saveReport(report);
      if (pending.durableReceipt) await clearAppReceipt(pending.id);
    }
    if (entry?.complete && entry.cost===row.cost && entry.active===row.active) continue;
    if (!entry) { entry={account:row.account,customerId:row.customerId}; group.rows.push(entry); }
    const checkedOn=day();
    Object.assign(entry,{cost:row.cost,active:row.active,currency:row.currency,checkedOn,complete:false,issues:[]});
    delete entry.policy; delete entry.videos; delete entry.saved; delete entry.proposedDates;
    const child={account:row.account,customerId:row.customerId};
    const record={...child,cost:row.cost,currency:row.currency};
    group.current=row.account;
    let stage='верификация';
    await saveReport(report);
    try {
      if (row.active) {
        const result=await audit('policy',child);
        entry.policy={prepay:result.prepay || null,verification:result.verification || null,clear:result.clear===true};
        if (result.documentPending) entry.issues.push('Не распознаны требования документов.');
        if (result.review) entry.issues.push(result.review);
        if (result.verification) record.verification=result.verification;
        if (result.prepay) record.prepay=result.prepay;
        if (row.cost==='0.00' && result.clear===true) {
          stage='видеокампании';
          const campaigns=(await audit('campaigns',child)).rows;
          stage='статусы видео';
          const ads=(await audit('ads',child)).rows;
          const findings=videoFindings(campaigns,ads,checkedOn);
          record.replace=findings.replace;
          entry.videos={campaigns,ads:ads.map(({campaignId,status,video})=>({campaignId,status,video})),replace:findings.replace};
          entry.issues.push(...findings.issues);
          for (const c of findings.extensions) {
            const newDate=nextWeek(checkedOn);
            if (report.mode==='review') { (entry.proposedDates??=[]).push({campaign:c.id,from:c.endDate,to:newDate}); continue; }
            stage='продление '+c.id;
            // Reconfirm both live preconditions immediately before a potentially serving change.
            const fresh=(await audit('inventory')).rows.find(r=>r.account===row.account && r.customerId===row.customerId);
            if (!fresh?.active || fresh.cost!=='0.00' || !(await audit('policy',child)).clear) throw Error('Изменились условия продления.');
            const confirmation=await audit('extend',{...child,campaign:c.id,endDate:c.endDate,today:checkedOn,newDate},
              async job=>{entry.pendingDate={...job,from:c.endDate,to:newDate,campaign:c.id};await saveReport(report);});
            if (!confirmation.confirmed || confirmation.endDate!==newDate) throw Error('Новая дата ещё не подтверждена.');
            const refreshed=(await audit('campaigns',child)).rows.find(item=>item.id===c.id);
            if (refreshed?.endDate!==newDate) throw Error('В таблице кампаний новая дата ещё не появилась.');
            (entry.changedDates??=[]).push({campaign:c.id,from:c.endDate,to:newDate});
            delete entry.pendingDate;
          }
        }
      }
    } catch (e) { entry.issues.push(stage+' — '+e.message); }
    if (report.mode==='run') {
      try {
        // The profile was fetched fresh on entry. Skip an identical write and verify all rows again together at the end.
        if (matchesSheet(snapshot,record,checkedOn)) entry.saved={verified:true,unchanged:true,account:entry.account};
        else await saveExpense(report,group,entry,record);
      } catch(e) {
        entry.issues.push('SproutG — '+e.message); await saveReport(report);
        throw Error('Очередь записи приостановлена на '+row.account+'. '+e.message);
      }
    }
    entry.complete=!entry.issues.length && !entry.pendingDate && entry.saved?.verified!==false;
    console.log(p+' / '+row.account+' | '+row.cost+' USD | '+(entry.issues.length?entry.issues.join(' | '):entry.complete?'OK':'принято SproutG, ожидается сверка'));
    await saveReport(report);
    const pending=group.rows.filter(e=>e.saved?.accepted && !e.saved.verified);
    if (pending.length>=3) {
      await waitForSheet(p,pending.map(desired),report.today);
      for(const e of pending) {e.saved.verified=true; e.complete=!e.issues.length && !e.pendingDate;}
      await saveReport(report);
    }
    if (entry.pendingDate) throw Error('Сначала нужно проверить результат сохранения даты для '+p+' / '+row.account+'.');
  }
  await verifyGroup(report,group);
  group.complete=group.rows.length===group.total && group.rows.every(r=>r.complete);
  delete group.current;
  await saveReport(report);
  await audit('finish');
}
async function reconcileDate(report,group,entry) {
  const pending=entry.pendingDate;
  const base=path.join(jobs,pending.id);
  if (!await readOnce(base+'.result.json') && (await readOnce(base+'.running.json') || await readOnce(base+'.job.json')))
    throw Error('Предыдущее сохранение даты ещё выполняется: '+pending.id);
  await ensureProfile(group.profile,report.id);
  const ticket=await online();
  await request(ticket,group.profile,'inventory');
  const {rows}=await request(ticket,group.profile,'campaigns',{account:entry.account,customerId:entry.customerId});
  const campaign=rows.find(c=>c.id===pending.campaign);
  if (campaign?.endDate!==pending.to && campaign?.endDate!==pending.from) throw Error('Текущая дата кампании не совпала с журналом.');
  if (campaign.endDate===pending.to) (entry.changedDates??=[]).push({campaign:pending.campaign,from:pending.from,to:pending.to});
  delete entry.pendingDate;await saveReport(report);
}
async function beginReport(mode,profiles) {
  const groups=profiles.map(profile=>({profile,rows:[]}));
  const fresh={id:randomUUID(),today:day(),mode,groups};
  if (mode!=='run') return fresh;
  await fs.mkdir(reports,{recursive:true});
  let resume;
  for (const file of await fs.readdir(reports)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
    const previous=await readReport(file.slice(0,-5));
    if (previous.mode!=='run') continue;
    const overlap=previous.groups.filter(g=>!g.complete && profiles.includes(g.profile));
    for (const g of overlap) {
      const pending=g.rows.filter(e=>e.pendingWrite || e.pendingDate || e.saved?.accepted && !e.saved.verified);
      if (!pending.length) continue;
      if (!resume && JSON.stringify(previous.groups.map(v=>v.profile))===JSON.stringify(profiles)) {
        resume=previous;
        break;
      }
      // A different profile list can overlap a delayed write from a prior chat.
      // Only reconcile those rows. Other MCCs in the earlier request stay untouched.
      try {
        for (const e of pending) if(e.pendingDate) await reconcileDate(previous,g,e);
        const writes=pending.filter(e=>e.pendingWrite || e.saved?.accepted && !e.saved.verified);
        const receiptIds=writes.filter(e=>e.pendingWrite?.durableReceipt).map(e=>e.pendingWrite.id);
        if (writes.length) await waitForSheet(g.profile,writes.map(e=>e.pendingWrite?.record || desired(e)),previous.today);
        for (const e of writes) {
          e.saved={account:e.account,verified:true,delayed:true};
          delete e.pendingWrite;
          e.issues=e.issues.filter(s=>!s.startsWith('SproutG — '));
          e.complete=!e.issues.length && !e.pendingDate;
        }
        await saveReport(previous);
        for (const id of receiptIds) await clearAppReceipt(id);
      } catch (error) { throw Error('Ожидается предыдущий речек '+g.profile+' ('+previous.id+'). '+error.message); }
    }
  }
  if (resume) console.log('Продолжаю журнал ожидающих записей '+resume.id);
  return resume || fresh;
}
async function main() {
  const [mode,...args]=process.argv.slice(2);
  if (mode==='open' && args.length===4) {
    const [profile,preview,x,y]=args;
    if (!/^[a-f\d-]{36}$/i.test(preview) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) throw Error('Неверный снимок или координаты.');
    return withBatchLock(queue,()=>openProfile(profile,randomUUID(),'press-start',{preview,x:Number(x),y:Number(y)}));
  }
  if (mode==='stage' && !args.length) {
    const dest=path.join(queue,'recheck-tools');
    await fs.mkdir(dest,{recursive:true});
    for (const name of ['page.js','rules.js','setup.cmd','worker.ps1']) {
      const temp=path.join(dest,name+'.'+randomUUID()+'.tmp');
      await fs.copyFile(path.join(__dirname,'recheck',name),temp);
      await replaceFile(temp,path.join(dest,name));
    }
    console.log(dest);return;
  }
  if (!['run','review','resume','status','inspect'].includes(mode)) throw Error('recheck.js run|review "MCC" ["MCC" …] | resume|status ID | inspect "MCC" inventory|policy|campaigns|ads [номер]');
  if (mode==='status') {
    const report=await readReport(args[0]);
    for(const g of report.groups) {
      const waiting=g.rows.filter(e=>e.pendingWrite || e.saved?.accepted && !e.saved.verified).map(e=>e.account);
      console.log(g.profile,g.rows.filter(e=>e.complete).length+'/'+(g.total??'?'),g.current||'',
        waiting.length?'ожидают таблицу '+waiting.join(', '):'',g.error||'');
    }
    return;
  }
  await withBatchLock(queue,async()=>{
    if (mode==='inspect') {
      const [p,screen,account]=args;
      if(!['inventory','policy','campaigns','ads'].includes(screen)) throw Error('Unknown screen.');
      await ensureProfile(p,randomUUID());
      const k=await online();
      try {
        const inv=await request(k,p,'inventory');
        const child=account && inv.rows.find(r=>r.account===account);
        if(screen!=='inventory' && !child)throw Error('Аккаунт отсутствует в Performance.');
        const info=await request(k,p,'inspect',{screen,account:child?.account,customerId:child?.customerId});
        console.log(JSON.stringify(info,null,2));
      } finally { await request(k,p,'finish'); }
      return;
    }
    const report=mode==='resume'?await readReport(args[0]):await beginReport(mode,profileNames(args));
    console.log('Речек '+report.id+' | '+report.mode+' | '+report.today);
    await saveReport(report);
    for(const group of report.groups) {
      if(group.complete) { if (!group.sheetVerifiedAt) await verifyGroup(report,group); continue; }
      delete group.error;
      try{
        for(const row of group.rows) if(row.pendingDate)await reconcileDate(report,group,row);
        await runProfile(report,group);
      } catch(e){group.error=e.message;await saveReport(report);throw e;}
    }
    console.log('Отчёт: '+path.join(reports,report.id+'.json'));
    if (report.groups.some(g=>!g.complete)) process.exitCode=2;
  });
}
async function replaceFile(temp,dest) {
  for (let i=0;;i++) {
    try { await fs.rename(temp,dest);return; }
    catch (e) { if(i>=29 || !['EBUSY','EACCES','EPERM'].includes(e.code)) throw e; await sleep(350); }
  }
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={profileNames,videoFindings,waitForSheet,beginReport};
