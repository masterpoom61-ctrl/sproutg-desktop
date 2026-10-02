'use strict';
const fs = require('fs');
const { normalize } = require('../renderer/core/workSession');

// Separate from the write queue: navigation must never mutate queued sheet writes.
function saveWorkSession(file, endpoint, snapshot){
  const value = normalize(snapshot);
  const temporary = file + '.tmp';
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify({ schema:1, endpoint, snapshot:value }), 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  return value;
}
function loadWorkSession(file, endpoint){
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value.schema === 1 && value.endpoint === endpoint ? normalize(value.snapshot) : null;
  } catch { return null; }
}
module.exports = { saveWorkSession, loadWorkSession };
