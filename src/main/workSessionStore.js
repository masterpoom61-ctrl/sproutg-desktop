'use strict';
const fs = require('fs');
const { normalize } = require('../renderer/core/workSession');

// Separate from the write queue: navigation must never mutate queued sheet writes.
function saveWorkSession(file, endpoint, snapshot){
  const value = normalize(snapshot);
  const temporary = file + '.tmp';
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify({ schema:2, endpoint, snapshot:value }), 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  return value;
}
function loadWorkSession(file, endpoint){
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if(value.endpoint !== endpoint) return null;
    const snapshot = normalize(value.snapshot);
    // Old O1 snapshots do not distinguish an open tab from a stale closed one.
    if(value.schema === 2 || (value.schema === 1 && snapshot?.page === 'MCC')) return snapshot;
    return null;
  } catch { return null; }
}
module.exports = { saveWorkSession, loadWorkSession };
