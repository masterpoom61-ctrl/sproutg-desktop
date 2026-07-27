const test = require('node:test');
const assert = require('node:assert/strict');

const { MutationRegistry } = require('../src/main/mutationRegistry');

test('mutation registry keeps a shutdown barrier closed until direct writes settle', async () => {
  const registry = new MutationRegistry();
  let release;
  const mutation = registry.run(() => new Promise((resolve) => {
    release = resolve;
  }));

  await Promise.resolve();
  assert.equal(registry.pending, 1);
  assert.equal(await registry.drain(10), 1);

  release('saved');
  assert.equal(await mutation, 'saved');
  assert.equal(await registry.drain(100), 0);
  assert.equal(registry.pending, 0);
});

test('mutation registry removes rejected operations after the barrier observes them', async () => {
  const registry = new MutationRegistry();
  await assert.rejects(
    registry.run(async () => {
      throw new Error('provider failed');
    }),
    /provider failed/
  );
  assert.equal(await registry.drain(100), 0);
});
