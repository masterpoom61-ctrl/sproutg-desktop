'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawn} = require('node:child_process');
const {atomicJson,readOnce} = require('../queue');
const home = path.join(process.env.LOCALAPPDATA || '.', 'SproutG-Octo');
const jobs = path.join(home,'queue','recheck-jobs');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const appDir=path.join(home,'recheck-app');

async function clearAppReceipt(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Неверный идентификатор запроса SproutG.');
  await Promise.all(['.request.json','.response.json'].map(ext=>fs.rm(path.join(appDir,id+ext),{force:true})));
}

async function online() {
  let prev;
  const due=Date.now()+30000;
  while (Date.now()<due || Date.now()<due+200000 && (await fs.readdir(jobs).catch(()=>[])).some(name=>name.endsWith('.running.json'))) {
    const ready = await readOnce(path.join(jobs,'ready.json'));
    if (ready?.version===1 && prev?.ticket===ready.ticket && ready.utc!==prev.utc) return ready.ticket;
    if (ready) prev=ready;
    await sleep(400);
  }
  throw Error('Нет ответа от обработчика «Речек» на Windows Server. Проверьте RDM и recheck-tools\\setup.cmd.');
}

async function request(ticket, profile, action, fields={}, onJob) {
  const id=randomUUID(), base=path.join(jobs,id);
  const job={...fields,ticket,profile,action};
  await onJob?.({id,profile,action,account:fields.account,customerId:fields.customerId});
  await atomicJson(base+'.job.json',job);
  const deadline=Date.now()+330000;
  while (Date.now()<deadline) {
    const reply=await readOnce(base+'.result.json');
    if (reply) {
      if (!reply.ok) throw Error(reply.error);
      if (reply.profile!==profile || reply.action!==action || (fields.account && reply.account!==fields.account))
        throw Error('Ответ Речека принадлежит другому заданию.');
      if (action==='policy' && reply.result.verification==='registration-id') reply.result.verification='Взять в работу';
      return reply.result;
    }
    await sleep(350);
  }
  throw Error('Нет результата операции '+action+'. Проверьте '+base+'.result.json перед повтором.');
}

async function appRequest(profile, action, fields={}, id=randomUUID()) {
  const base=path.join(appDir,id);
  await fs.mkdir(appDir,{recursive:true});
  const exe=process.env.SPROUTG_EXE || path.join(process.env.LOCALAPPDATA,'Programs','SproutG','SproutG.exe');
  await fs.access(exe);
  const existing=await readOnce(base+'.request.json');
  if (existing) {
    if (existing.profile!==profile || existing.action!==action || existing.today!==fields.today ||
        JSON.stringify(existing.record)!==JSON.stringify(fields.record)) throw Error('Конфликт идентификатора записи.');
  } else if (!await readOnce(base+'.response.json')) {
    await atomicJson(base+'.request.json',{...fields,profile,action});
    const child=spawn(exe,['--octo-recheck='+id],{stdio:'ignore',windowsHide:true});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
  }
  const until=Date.now()+(action==='save'?150000:45000);
  while (Date.now()<until) {
    const reply=await readOnce(base+'.response.json');
    if (reply) {
      // Keep write receipts until the laptop has durably checkpointed the outcome.
      if (action==='snapshot') await clearAppReceipt(id);
      if (reply.error) throw Error(reply.error);
      if (reply.profile!==profile || reply.action!==action) throw Error('Неверный ответ SproutG.');
      return reply.result;
    }
    await sleep(400);
  }
  throw Error('SproutG не ответил на '+action+'. Проверьте, что открыта сборка с поддержкой Речека. Запрос '+id+'.');
}
module.exports={home,jobs,sleep,online,request,appRequest,clearAppReceipt};
