const test = require('node:test');
const assert = require('node:assert/strict');
const {projectAccounts} = require('../src/main/octoExport');

test('Octo export projects only requested MCC rows in caller order', () => {
  const data={profileName:'Test KG',rows:['21','22','23'].map(n=>({
    accountName:n,values:{J:'https://youtu.be/abcdefghijk',K:'Video '+n,unused:'private'}
  }))};
  const rows=projectAccounts('Test KG',['23','21'],data);
  assert.deepEqual(rows.map(r=>r.account),['23','21']);
  assert.deepEqual(Object.keys(rows[0]).sort(),['account','link','name']);
  assert.throws(()=>projectAccounts('Other',['21'],data));
  assert.throws(()=>projectAccounts('Test KG',['24'],data));
  data.rows[0].isDeleted=true;
  assert.throws(()=>projectAccounts('Test KG',['21'],data));
});
