const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cellStateKey,
  editDraftKey,
  entries,
  mccOwnerKey,
  normalizeRecords,
  o1OwnerKey,
  smsProfileStateKey
} = require('../src/renderer/core/durableFailureTargets');

test('stable identity supersedes a failed write after its sheet row moves', () => {
  const before = entries('mcc.updateCells', {
    row: 10,
    updates: { D: 'old' },
    identity: { profileName: 'Profile A', accountName: 'Account A' }
  });
  const after = entries('mcc.updateCells', {
    row: 11,
    updates: { D: 'new' },
    identity: { profileName: 'Profile A', accountName: 'Account A' }
  });

  assert.equal(before[0].key, after[0].key);
  assert.equal(after[0].payload.row, 11);
  assert.equal(after[0].payload.updates.D, 'new');
});

test('multi-cell failures are split so a newer cell value cannot replay an older value', () => {
  const records = normalizeRecords([
    {
      action: 'o1.updateCells',
      payload: {
        row: 50,
        updates: { D: 'old-D', E: 'keep-E' },
        identity: { profileName: 'Profile B' }
      },
      updatedAt: 1
    },
    {
      action: 'o1.updateCells',
      payload: {
        row: 51,
        updates: { D: 'new-D' },
        identity: { profileName: 'Profile B' }
      },
      updatedAt: 2
    }
  ]);

  assert.equal(records.length, 2);
  const d = records.find((item) => item.key.endsWith(':col:D'));
  const e = records.find((item) => item.key.endsWith(':col:E'));
  assert.equal(d.payload.row, 51);
  assert.deepEqual(d.payload.updates, { D: 'new-D' });
  assert.equal(e.payload.row, 50);
  assert.deepEqual(e.payload.updates, { E: 'keep-E' });
});

test('PASS failure target follows expected identity rather than a stale row number', () => {
  const first = entries('pass.updateCell', {
    row: 7,
    col: 'F',
    value: 'A',
    identity: { expectedValue: 'Stable Person' }
  })[0];
  const second = entries('pass.updateCell', {
    row: 9,
    col: 'F',
    value: 'B',
    identity: { expectedValue: 'Stable Person' }
  })[0];

  assert.equal(first.key, second.key);
});

test('stable owner and draft keys preserve case and delimiter boundaries', () => {
  assert.notEqual(
    o1OwnerKey({ profileName:'Foo' }),
    o1OwnerKey({ profileName:'foo' })
  );
  assert.notEqual(
    mccOwnerKey({ profileName:'A:B', accountName:'C' }),
    mccOwnerKey({ profileName:'A', accountName:'B:C' })
  );
  const p = o1OwnerKey({ profileName:'Profile P' });
  const q = o1OwnerKey({ profileName:'Profile Q' });
  assert.notEqual(cellStateKey('O1', p, 'D'), cellStateKey('O1', q, 'D'));
  assert.equal(
    cellStateKey('O1', p, 'D'),
    cellStateKey('O1', o1OwnerKey({ profileName:'Profile P' }), 'd')
  );
  assert.notEqual(
    smsProfileStateKey('herosms', p),
    smsProfileStateKey('herosms', q)
  );
  assert.notEqual(
    editDraftKey('MCC', ['A:B', 'C'], 'N'),
    editDraftKey('MCC', ['A', 'B:C'], 'N')
  );
  assert.notEqual(
    editDraftKey('O1', ['Foo'], 'D'),
    editDraftKey('O1', ['foo'], 'D')
  );
});

test('PASS failure identities preserve exact expected value case', () => {
  const upper = entries('pass.updateCell', {
    row:7,
    col:'F',
    value:'A',
    identity:{ expectedValue:'Foo' }
  })[0];
  const lower = entries('pass.updateCell', {
    row:7,
    col:'F',
    value:'A',
    identity:{ expectedValue:'foo' }
  })[0];
  assert.notEqual(upper.key, lower.key);
});
