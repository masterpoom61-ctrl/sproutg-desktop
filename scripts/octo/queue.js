'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const {randomUUID, createHash} = require('node:crypto');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function atomicJson(file, data) {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data), {flag:'wx'});
  await fs.rename(tmp, file);
}

async function readOnce(file) {
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function control(queue, action, profile, owner, extra = {}) {
  const dir = path.join(queue, 'profile-control');
  const deadline = Date.now() + 30000;
  let previous, ticket;
  while (Date.now() < deadline) {
    const lease = await readOnce(path.join(dir,'ready.json'));
    if (lease?.ticket && previous?.ticket === lease.ticket && lease.utc !== previous.utc) {
      ticket = lease.ticket;
      break;
    }
    if (lease?.ticket) previous = lease;
    await sleep(400);
  }
  if (!ticket) throw Error('Server profile controller is offline or busy. Check its window and the shared RDM drive.');
  const base = path.join(dir, randomUUID());
  await atomicJson(base + '.job.json', {action, profile, owner, ticket, ...extra});
  const until = Date.now() + 360000;
  while (Date.now() < until) {
    const result = await readOnce(base + '.result.json');
    if (result) {
      if (!result.ok) throw Error(result.error);
      if (['preview','search'].includes(action)) console.log(path.join(dir, result.message));
      else console.log(profile + ' | ' + result.message);
      return result.message;
    }
    await sleep(750);
  }
  throw Error('Profile operation pending. Inspect ' + base + '.result.json before retrying.');
}

async function withBatchLock(queue,work) {
  await fs.access(queue);
  const lock = net.createServer(socket => socket.end());
  const key = createHash('sha256').update(queue.toLowerCase()).digest('hex').slice(0,24);
  await new Promise((resolve, reject) => {
    lock.once('error', err => reject(err.code === 'EADDRINUSE' ? Error('A SproutG batch is already running.') : err));
    lock.listen('\\\\.\\pipe\\SproutG-Octo-' + key, resolve);
  });
  try { return await work(); } finally { lock.close(); }
}

module.exports = {atomicJson, readOnce, control, withBatchLock};
