'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const fields = ['W','X','Y','Z','U','S'];
const empty = value => !String(value ?? '').trim();
const statuses = ['QR','Взять в работу'];
const comment = 'Замена видео';

function day(date=new Date()) {
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function checkedDate(input) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || new Date(input+'T12:00:00Z').toISOString().slice(0,10)!==input)
    throw Error('Неверная дата речека.');
  return input;
}
function sameCost(left,right) {
  const value=String(left ?? '').replace(',','.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return false;
  const [d,c='']=value.split('.');
  return BigInt(d).toString()+'.'+c.padEnd(2,'0')===right;
}
function sameDate(left,right) {
  const s=String(left ?? '').trim(), m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  return (m ? [m[3],m[2],m[1]].join('-') : s.slice(0,10))===right;
}
function projection(profile,data) {
  if (data?.profileName!==profile || !Array.isArray(data.rows)) throw Error('SproutG вернул другой MCC.');
  const rows=data.rows.map(row=>({account:String(row.accountName ?? '').trim(),row:row.row,deleted:!!row.isDeleted,
    values:Object.fromEntries(fields.map(col=>[col,row.values?.[col] ?? '']))}));
  return {rows,verificationOptions:Array.isArray(data.dropdowns?.U)?data.dropdowns.U:[]};
}
function findRow(snapshot,account) {
  const matches=snapshot.rows.filter(r=>r.account===account);
  if (matches.length!==1 || matches[0].deleted || !Number.isSafeInteger(matches[0].row) || matches[0].row<1)
    throw Error('Строка '+account+' отсутствует, удалена или неоднозначна.');
  return matches[0];
}
function changes(values,record,when,options) {
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(record.cost) || record.currency!=='USD') throw Error('Нет подтверждённой суммы в USD.');
  const updates={};
  if (!sameCost(values.X,record.cost)) updates.X=record.cost;
  if (empty(values.W)) updates.W=checkedDate(when);
  if (empty(values.Z)) updates.Z='+';
  if (record.verification!=null) {
    if (!statuses.includes(record.verification) || !options.includes(record.verification)) throw Error('Статус отсутствует в списке верификаций.');
    if (values.U!==record.verification) updates.U=record.verification;
  }
  if (record.prepay!=null) {
    if (!/^(?:[1-9]0|100)\$$/.test(record.prepay)) throw Error('Суммы нет в списке PrePay.');
    if (values.S!==record.prepay) updates.S=record.prepay;
  }
  if (record.replace===true && !String(values.Y).toLocaleLowerCase('ru').includes(comment.toLocaleLowerCase('ru')))
    updates.Y=empty(values.Y)?comment:String(values.Y).trimEnd()+'\n'+comment;
  return updates;
}
async function processRequest(req,call) {
  const {profile,action,record}=req;
  if (typeof profile!=='string' || !profile.trim() || profile.length>128 || !['snapshot','save'].includes(action)) throw Error('Неверный запрос речека.');
  if (typeof call!=='function') throw Error('SproutG ещё загружается.');
  const read=async()=>{
    const reply=await call('mcc.profile',{profileName:profile,fields,dropdowns:true},{timeoutMs:30000});
    if (!reply?.ok) throw Error(reply?.error || 'Не удалось загрузить MCC.');
    return projection(profile,reply.data);
  };
  const snapshot=await read();
  if (action==='snapshot') return snapshot;
  if (!record || !/^\d{1,5}$/.test(record.account) || !/^\d{3}-\d{3}-\d{4}$/.test(record.customerId)) throw Error('Неверный аккаунт.');
  const row=findRow(snapshot,record.account);
  const updates=changes(row.values,record,checkedDate(req.today),snapshot.verificationOptions);
  const columns=Object.keys(updates);
  if (!columns.length) return {account:record.account,columns,verified:true};
  const identity={profileName:profile,accountName:record.account};
  const result=await call('mcc.updateCells',{row:row.row,updates,identity});
  if (!result?.ok || result.data?.superseded) throw Error(result?.error || 'Запись не подтверждена. Проверьте очередь SproutG.');
  const after=findRow(await read(),record.account).values;
  for (const col of columns) {
    const equal=col==='X'?sameCost(after.X,updates.X):col==='W'?sameDate(after.W,updates.W):after[col]===updates[col];
    if (!equal) throw Error('Таблица не подтвердила запись '+record.account+' / '+col+'.');
  }
  return {account:record.account,columns,verified:true};
}
async function handleRecheck(directory,id,call) {
  const base=path.join(directory,id);
  let response;
  try {
    const req=JSON.parse(await fs.readFile(base+'.request.json','utf8'));
    response={profile:req.profile,action:req.action,result:await processRequest(req,call)};
  } catch (e) { response={error:e.message}; }
  await fs.writeFile(base+'.tmp',JSON.stringify(response),{flag:'wx'});
  await fs.rename(base+'.tmp',base+'.response.json');
}
module.exports={day,changes,findRow,handleRecheck,processRequest};
