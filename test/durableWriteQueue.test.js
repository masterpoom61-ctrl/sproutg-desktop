"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const EventEmitter = require("node:events");
const test = require("node:test");
const {
  DurableWriteQueue,
  normalizeStoredItem,
  partitionServerSafeGroups,
  SNAPSHOT_STORE_KEY,
  snapshotChecksum,
  targetKey,
  validateBlockedArchive,
  validateWalSnapshot,
  writeWalSnapshot
} = require("../src/main/durableWriteQueue");

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

class MemoryStore {
  constructor(values = {}) {
    this.values = clone(values);
    this.failWrites = false;
  }

  get(key) {
    return clone(this.values[key]);
  }

  set(key, value) {
    if (this.failWrites) throw new Error("disk full");
    this.values[key] = clone(value);
  }
}

function successfulBridge() {
  const calls = [];
  return {
    calls,
    async callApi(action, payload) {
      calls.push({ type: "call", action, payload: clone(payload) });
      return {
        ok: true,
        data: {
          results: payload.items.map((item) => ({
            ok: true,
            row: item.row,
            applied: clone(item.updates)
          }))
        }
      };
    },
    async batchApi(batch) {
      calls.push({ type: "batch", batch: clone(batch) });
      return {
        ok: true,
        data: batch.map((item) => ({
          id: item.id,
          result: { ok: true, data: { applied: true } }
        }))
      };
    }
  };
}

function createQueue({
  store = new MemoryStore(),
  bridge = successfulBridge(),
  endpoint,
  walPath
} = {}) {
  let currentEndpoint = endpoint || "https://script.google.com/macros/s/example/exec";
  const states = [];
  if (typeof bridge.getState !== "function") {
    bridge.getState = () => ({ ready: true, bridgeVersion: "2.3.0" });
  }
  const queue = new DurableWriteQueue({
    store,
    bridgeManager: bridge,
    walPath,
    getEndpointKey: () => currentEndpoint,
    onState: (state) => states.push(clone(state))
  });
  return {
    bridge,
    queue,
    states,
    store,
    setEndpoint(value) {
      currentEndpoint = value;
    }
  };
}

async function flushNow(queue) {
  clearTimeout(queue.timer);
  queue.timer = null;
  await queue.flush();
  clearTimeout(queue.timer);
  queue.timer = null;
}

test("stable write identities are semantic targets independent of row", async () => {
  const ctx = createQueue();
  const identity = { profileName: "Profile", accountName: "Account" };
  const first = ctx.queue.enqueue("mcc.updateCells", {
    row: 10,
    updates: { N: "first" },
    identity
  });
  const second = ctx.queue.enqueue("mcc.updateCells", {
    row: 11,
    updates: { N: "second" },
    identity
  });

  assert.equal(
    targetKey("mcc.updateCells", { row: 10, identity }),
    targetKey("mcc.updateCells", { row: 11, identity })
  );
  assert.equal(
    targetKey("o1.updateCells", { row: 10, identity: { profileName: "Profile" } }),
    targetKey("o1.updateCells", { row: 11, identity: { profileName: "Profile" } })
  );
  assert.equal(
    targetKey("pass.updateCell", {
      row: 10,
      col: "F",
      identity: { expectedValue: "old" }
    }),
    targetKey("pass.updateCell", {
      row: 11,
      col: "F",
      identity: { expectedValue: "old" }
    })
  );
  await flushNow(ctx.queue);

  assert.equal((await first).superseded, true);
  assert.equal((await second).ok, true);
  assert.equal(ctx.bridge.calls.length, 1);
  assert.equal(ctx.bridge.calls[0].payload.items[0].row, 11);
  assert.deepEqual(ctx.bridge.calls[0].payload.items[0].updates, { N: "second" });
  assert.equal(ctx.queue.getState().pending, 0);
});

test("newer value supersedes only the same semantic identity and column", async () => {
  const ctx = createQueue();
  const identity = { profileName: "Profile", accountName: "Account" };
  const oldWrite = ctx.queue.enqueue("mcc.updateCells", {
    row: 10,
    updates: { N: "old", O: "keep" },
    identity
  });
  const newWrite = ctx.queue.enqueue("mcc.updateCells", {
    row: 10,
    updates: { N: "new" },
    identity
  });

  await flushNow(ctx.queue);
  assert.equal((await oldWrite).ok, true);
  assert.equal((await newWrite).ok, true);
  assert.equal(ctx.bridge.calls.length, 1);
  const sent = ctx.bridge.calls[0].payload.items[0];
  assert.deepEqual(sent.updates, { O: "keep", N: "new" });
});

test("an inflight failure is not replayed after a newer row for the same identity and column", async () => {
  let releaseFirst;
  const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
  const bridge = {
    calls: [],
    async callApi(action, payload) {
      this.calls.push({ action, payload: clone(payload) });
      if (this.calls.length === 1) return firstResponse;
      return {
        ok: true,
        data: {
          results: payload.items.map((item) => ({
            ok: true,
            row: item.row,
            applied: clone(item.updates)
          }))
        }
      };
    }
  };
  const ctx = createQueue({ bridge });
  const identity = { profileName: "Profile", accountName: "Account" };
  const first = ctx.queue.enqueue("mcc.updateCells", {
    row: 10,
    updates: { N: "A" },
    identity
  });
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
  const firstFlush = ctx.queue.flush();
  while (bridge.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));

  const second = ctx.queue.enqueue("mcc.updateCells", {
    row: 11,
    updates: { N: "B" },
    identity
  });
  releaseFirst({
    ok: true,
    data: {
      results: [{ ok: false, error: "temporary failure" }]
    }
  });
  await firstFlush;
  await flushNow(ctx.queue);
  await flushNow(ctx.queue);

  assert.equal((await first).superseded, true);
  assert.equal((await second).ok, true);
  assert.equal(bridge.calls.length, 2);
  assert.deepEqual(
    bridge.calls.map((call) => ({
      row: call.payload.items[0].row,
      value: call.payload.items[0].updates.N
    })),
    [{ row: 10, value: "A" }, { row: 11, value: "B" }]
  );
  assert.equal(ctx.queue.getState().pending, 0);
});

test("legacy pending writes bind to the current endpoint and survive restart backup", () => {
  const oldItem = {
    id: "legacy-1",
    action: "mcc.updateCells",
    payload: {
      row: 42,
      updates: { N: "queued" },
      identity: { profileName: "P", accountName: "A" }
    },
    seq: 7,
    createdAt: 123
  };
  const store = new MemoryStore({
    pendingWrites: [oldItem],
    pendingWritesBackup: [oldItem]
  });
  const ctx = createQueue({ store });
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;

  const state = ctx.queue.getState();
  assert.equal(state.pending, 1);
  assert.equal(state.blockedEndpoint, 0);
  assert.equal(store.values.pendingWrites[0].endpointKey, state.endpointKey);
  assert.equal(store.values.pendingWritesBackup[0].id, "legacy-1");
});

test("endpoint change blocks replay and is reported", async () => {
  const ctx = createQueue();
  const pending = ctx.queue.enqueue("o1.updateCells", {
    row: 12,
    updates: { AE: "queued" },
    identity: { profileName: "P" }
  });
  assert.equal(
    ctx.queue.hasPendingForEndpointChange("https://script.google.com/macros/s/other/exec"),
    1
  );
  ctx.setEndpoint("https://script.google.com/macros/s/other/exec");
  await flushNow(ctx.queue);

  assert.equal(ctx.bridge.calls.length, 0);
  assert.equal(ctx.queue.getState().blockedEndpoint, 1);
  clearTimeout(ctx.queue.waiters.get(Array.from(ctx.queue.pending.keys())[0])?.timer);
  ctx.queue.resolveWaiter(Array.from(ctx.queue.pending.keys())[0], { ok: true, durable: true });
  await pending;
});

test("failed local persistence rejects the write before acknowledging it", async () => {
  const store = new MemoryStore();
  const ctx = createQueue({ store });
  store.failWrites = true;
  const result = await ctx.queue.enqueue("pass.updateCell", {
    row: 2,
    col: "F",
    value: "x",
    identity: { expectedValue: "old" }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "WRITE_PERSIST_FAILED");
  assert.equal(ctx.queue.getState().pending, 1);
  assert.equal(ctx.queue.getState().persistenceDirty, true);
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
});

test("valid WAL recovers writes when the electron-store snapshot cannot be read", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-wal-read-"));
  try {
    const walPath = path.join(tempDir, "pending.wal.json");
    writeWalSnapshot(walPath, {
      schemaVersion: 1,
      revision: 7,
      writtenAt: 100,
      completedIds: [],
      items: [{
        id: "wal-recovered",
        action: "mcc.updateCells",
        kind: "cells",
        payload: {
          row: 42,
          updates: { N: "queued" },
          identity: { profileName: "Profile", accountName: "Account" }
        },
        endpointKey: "https://script.google.com/macros/s/example/exec",
        seq: 9,
        createdAt: 10,
        attempts: 0,
        nextAttemptAt: 0,
        lastError: "",
        blocked: false
      }]
    });
    const store = new MemoryStore();
    store.get = () => {
      throw new Error("corrupt electron store");
    };
    const ctx = createQueue({ store, walPath });
    clearTimeout(ctx.queue.timer);
    ctx.queue.timer = null;
    assert.equal(ctx.queue.getState().pending, 1);
    assert.equal(Array.from(ctx.queue.pending.keys())[0], "wal-recovered");
    assert.equal(store.values.pendingWritesSnapshot.items[0].id, "wal-recovered");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("corrupt primary WAL falls back to its last valid generation", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-wal-backup-"));
  try {
    const walPath = path.join(tempDir, "pending.wal.json");
    const baseItem = {
      id: "wal-backup",
      action: "o1.updateCells",
      kind: "cells",
      payload: {
        row: 9,
        updates: { AE: "queued" },
        identity: { profileName: "Profile" }
      },
      endpointKey: "https://script.google.com/macros/s/example/exec",
      seq: 3,
      createdAt: 4,
      attempts: 0,
      nextAttemptAt: 0,
      lastError: "",
      blocked: false
    };
    writeWalSnapshot(walPath, {
      schemaVersion: 1,
      revision: 1,
      writtenAt: 10,
      completedIds: [],
      items: [baseItem]
    });
    writeWalSnapshot(walPath, {
      schemaVersion: 1,
      revision: 2,
      writtenAt: 20,
      completedIds: [],
      items: [baseItem]
    });
    fs.writeFileSync(walPath, "{\"checksum\":\"bad\"}", "utf8");

    const ctx = createQueue({ store: new MemoryStore(), walPath });
    clearTimeout(ctx.queue.timer);
    ctx.queue.timer = null;
    assert.equal(ctx.queue.getState().pending, 1);
    assert.equal(Array.from(ctx.queue.pending.keys())[0], "wal-backup");
    assert.ok(validateWalSnapshot(JSON.parse(fs.readFileSync(walPath, "utf8"))));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("checksum-damaged WAL is repaired from a valid electron-store snapshot", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-wal-repair-"));
  try {
    const walPath = path.join(tempDir, "pending.wal.json");
    fs.writeFileSync(walPath, JSON.stringify({
      schemaVersion: 1,
      revision: 4,
      writtenAt: 100,
      completedIds: [],
      items: [],
      checksum: "0".repeat(64)
    }), "utf8");
    const item = {
      id: "store-authoritative",
      action: "pass.updateCell",
      kind: "direct",
      payload: {
        row: 2,
        col: "F",
        value: "new",
        identity: { expectedValue: "old" }
      },
      endpointKey: "https://script.google.com/macros/s/example/exec",
      seq: 8,
      createdAt: 9,
      attempts: 0,
      nextAttemptAt: 0,
      lastError: "",
      blocked: false
    };
    const store = new MemoryStore({
      pendingWritesSnapshot: {
        schemaVersion: 1,
        revision: 5,
        writtenAt: 200,
        completedIds: [],
        items: [item]
      }
    });
    const ctx = createQueue({ store, walPath });
    clearTimeout(ctx.queue.timer);
    ctx.queue.timer = null;
    const repaired = validateWalSnapshot(JSON.parse(fs.readFileSync(walPath, "utf8")));
    assert.ok(repaired);
    assert.equal(repaired.items[0].id, "store-authoritative");
    assert.equal(ctx.queue.getState().pending, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("electron snapshot newer than a valid WAL fails closed", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-wal-order-"));
  try {
    const walPath = path.join(tempDir, "pending.wal.json");
    const walItem = {
      id: "wal-must-not-drop",
      action: "o1.updateCells",
      kind: "cells",
      payload: {
        row: 7,
        updates: { AE: "queued" },
        identity: { profileName: "Profile" }
      },
      endpointKey: "https://script.google.com/macros/s/example/exec",
      seq: 4,
      createdAt: 5,
      attempts: 0,
      nextAttemptAt: 0,
      lastError: "",
      blocked: false
    };
    writeWalSnapshot(walPath, {
      schemaVersion: 1,
      revision: 4,
      writtenAt: 100,
      completedIds: [],
      items: [walItem]
    });
    const newerPayload = {
      schemaVersion: 1,
      revision: 5,
      writtenAt: 200,
      completedIds: ["wal-must-not-drop"],
      items: []
    };
    const store = new MemoryStore({
      pendingWritesSnapshot: {
        ...newerPayload,
        checksum: snapshotChecksum(newerPayload)
      }
    });
    const ctx = createQueue({ store, walPath });
    clearTimeout(ctx.queue.timer);
    ctx.queue.timer = null;
    assert.equal(ctx.queue.getState().integrityBlocked, true);
    assert.match(ctx.queue.getState().restoreError, /новее WAL/);
    const unchangedWal = validateWalSnapshot(JSON.parse(fs.readFileSync(walPath, "utf8")));
    assert.equal(unchangedWal.items[0].id, "wal-must-not-drop");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("authoritative snapshot does not resurrect a completed stale mirror item", async () => {
  const ctx = createQueue();
  const result = ctx.queue.enqueue("mcc.updateCells", {
    row: 20,
    updates: { N: "saved" },
    identity: { profileName: "P", accountName: "A" }
  });
  const staleItem = clone(ctx.store.values.pendingWrites[0]);
  await flushNow(ctx.queue);
  assert.equal((await result).ok, true);
  assert.equal(ctx.store.values.pendingWritesSnapshot.items.length, 0);

  // Simulate a crash after the authoritative snapshot was committed but
  // before an older compatibility mirror was replaced.
  ctx.store.values.pendingWrites = [staleItem];
  const restarted = createQueue({ store: ctx.store, bridge: successfulBridge() });
  clearTimeout(restarted.queue.timer);
  restarted.queue.timer = null;
  assert.equal(restarted.queue.getState().pending, 0);
});

test("snapshot imports an unknown write produced during a temporary 2.2.2 rollback", async () => {
  const ctx = createQueue();
  const first = ctx.queue.enqueue("o1.updateCells", {
    row: 5,
    updates: { AE: "done" },
    identity: { profileName: "P" }
  });
  await flushNow(ctx.queue);
  await first;

  const oldClientWrite = {
    id: "old-client-new-write",
    action: "o1.updateCells",
    payload: {
      row: 6,
      updates: { AE: "new" },
      identity: { profileName: "Other" }
    },
    seq: 1,
    createdAt: 1
  };
  ctx.store.values.pendingWrites = [oldClientWrite];
  const restarted = createQueue({ store: ctx.store, bridge: successfulBridge() });
  clearTimeout(restarted.queue.timer);
  restarted.queue.timer = null;
  assert.equal(restarted.queue.getState().pending, 1);
  assert.equal(Array.from(restarted.queue.pending.values())[0].id, oldClientWrite.id);
});

test("company conflict remains queued and is never accepted by key-only duplicate evidence", async () => {
  const bridge = {
    calls: [],
    async batchApi(batch) {
      this.calls.push(clone(batch));
      return {
        ok: true,
        data: batch.map((item) => ({
          id: item.id,
          result: {
            ok: false,
            code: "COMPANY_CONFLICT",
            error: "Компания с таким ключом существует, но остальные поля отличаются"
          }
        }))
      };
    }
  };
  const ctx = createQueue({ bridge });
  const result = ctx.queue.enqueue("company.addRow", {
    values: ["Company", "B", "C", "D", "EE123456789", "123456789"]
  });
  await flushNow(ctx.queue);
  assert.equal((await result).durable, true);
  assert.equal(ctx.queue.getState().pending, 1);
  assert.equal(bridge.calls.length, 1);
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
});

test("stored item validation rejects malformed rows and columns", () => {
  assert.equal(normalizeStoredItem({
    action: "mcc.updateCells",
    payload: { row: 1, updates: { N: "x" } }
  }), null);
  assert.equal(normalizeStoredItem({
    action: "pass.updateCell",
    payload: { row: 2, col: "1", value: "x" }
  }), null);
  assert.equal(normalizeStoredItem({
    action: "o1.toggleDeleted",
    payload: { row: 2, identity: { profileName: "P" } }
  }), null);
  assert.equal(normalizeStoredItem({
    action: "mcc.updateCells",
    payload: { row: 2, updates: { N: "x" }, identity: {} }
  }), null);
  assert.equal(normalizeStoredItem({
    action: "mcc.updateCells",
    payload: { row: 2, updates: { N: "x" }, identity: { profileName: "P" } }
  }), null);
  assert.equal(normalizeStoredItem({
    action: "mcc.setUnderReviewBg",
    payload: { row: 2, identity: { profileName: "P" } }
  }), null);
  assert.equal(normalizeStoredItem({
    action: "mcc.toggleAccountDeleted",
    payload: { row: 2, enabled: true, identity: { profileName: "P" } }
  }), null);
  assert.equal(normalizeStoredItem({
    action: "mcc.updateProfileName",
    payload: { rows: [2, 3], value: "New profile" }
  }), null);
  assert.notEqual(normalizeStoredItem({
    action: "mcc.updateCells",
    payload: {
      row: 2,
      updates: { N: "x" },
      identity: { profileName: "P", accountName: "A" }
    }
  }), null);
  assert.notEqual(normalizeStoredItem({
    action: "mcc.setUnderReviewBg",
    payload: { row: 2, identity: { profileName: "P", accountName: "A" } }
  }), null);
  assert.notEqual(normalizeStoredItem({
    action: "mcc.toggleAccountDeleted",
    payload: {
      row: 2,
      enabled: true,
      identity: { profileName: "P", accountName: "A" }
    }
  }), null);
  assert.notEqual(normalizeStoredItem({
    action: "mcc.updateProfileName",
    payload: {
      rows: [2, 3],
      value: "New profile",
      oldProfileName: "Old profile"
    }
  }), null);
});

test("restored MCC account writes without a full identity are quarantined", () => {
  const invalidItems = [
    {
      id: "mcc-cells-missing-account",
      action: "mcc.updateCells",
      payload: { row: 2, updates: { N: "x" }, identity: { profileName: "P" } },
      seq: 1,
      createdAt: 1
    },
    {
      id: "mcc-review-missing-account",
      action: "mcc.setUnderReviewBg",
      payload: { row: 2, identity: { profileName: "P" } },
      seq: 2,
      createdAt: 2
    },
    {
      id: "mcc-delete-missing-account",
      action: "mcc.toggleAccountDeleted",
      payload: { row: 2, enabled: true, identity: { profileName: "P" } },
      seq: 3,
      createdAt: 3
    }
  ];
  const ctx = createQueue({
    store: new MemoryStore({ pendingWrites: invalidItems })
  });
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;

  const state = ctx.queue.getState();
  assert.equal(state.pending, 0);
  assert.equal(state.integrityBlocked, true);
  assert.equal(state.quarantineCount, 3);
});

test("rapid PASS re-edit is chained and cannot overtake an inflight failure", async () => {
  let releaseFirst;
  const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
  const bridge = {
    calls: [],
    async batchApi(batch) {
      this.calls.push(clone(batch));
      if (this.calls.length === 1) return firstResponse;
      return {
        ok: true,
        data: batch.map((item) => ({
          id: item.id,
          result: { ok: true, data: { value: item.payload.value } }
        }))
      };
    }
  };
  const ctx = createQueue({ bridge });
  const identity = { expectedValue: "original" };
  const first = ctx.queue.enqueue("pass.updateCell", {
    row: 2,
    col: "F",
    value: "older",
    identity
  });
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
  const firstFlush = ctx.queue.flush();
  while (bridge.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));

  const second = ctx.queue.enqueue("pass.updateCell", {
    row: 9,
    col: "F",
    value: "newer",
    identity
  });
  const chained = Array.from(ctx.queue.pending.values())
    .find((item) => item.payload?.value === "newer");
  assert.equal(chained.payload.identity.expectedValue, "older");
  releaseFirst({
    ok: true,
    data: [{
      id: bridge.calls[0][0].id,
      result: { ok: false, error: "temporary failure" }
    }]
  });
  await firstFlush;
  await flushNow(ctx.queue);

  assert.equal((await first).durable, true);
  assert.equal(bridge.calls.length, 1);
  assert.equal(ctx.queue.getState().pending, 2);
  assert.equal(Array.from(ctx.queue.pending.values()).some((item) => (
    item.payload?.value === "newer"
    && item.payload?.identity?.expectedValue === "older"
  )), true);
  assert.equal((await second).durable, true);
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
});

test("rapid PASS chain survives restart and follows an inserted row", async () => {
  const store = new MemoryStore();
  const firstCtx = createQueue({ store });
  const first = firstCtx.queue.enqueue("pass.updateCell", {
    row: 2,
    col: "F",
    value: "Y",
    identity: { expectedValue: "X" }
  });
  const second = firstCtx.queue.enqueue("pass.updateCell", {
    row: 9,
    col: "F",
    value: "Z",
    identity: { expectedValue: "X" }
  });
  clearTimeout(firstCtx.queue.timer);
  firstCtx.queue.timer = null;
  assert.deepEqual(
    store.values[SNAPSHOT_STORE_KEY].items.map((item) => ({
      row:item.payload.row,
      expected:item.payload.identity.expectedValue,
      value:item.payload.value
    })),
    [
      { row:2, expected:"X", value:"Y" },
      { row:9, expected:"Y", value:"Z" }
    ]
  );

  const bridge = successfulBridge();
  const restarted = createQueue({ store, bridge });
  clearTimeout(restarted.queue.timer);
  restarted.queue.timer = null;
  await flushNow(restarted.queue);

  assert.equal(bridge.calls.length, 2);
  assert.deepEqual(
    bridge.calls.flatMap((call) => call.batch || []).map((item) => ({
      row:item.payload.row,
      expected:item.payload.identity.expectedValue,
      value:item.payload.value
    })),
    [
      { row:2, expected:"X", value:"Y" },
      { row:9, expected:"Y", value:"Z" }
    ]
  );
  assert.equal(restarted.queue.getState().pending, 0);
  assert.equal((await first).durable, true);
  assert.equal((await second).durable, true);
});

test("server success with a failed snapshot commit remains integrity-dirty", async () => {
  const store = new MemoryStore();
  const ctx = createQueue({ store });
  const result = ctx.queue.enqueue("pass.updateCell", {
    row: 2,
    col: "F",
    value: "new",
    identity: { expectedValue: "old" }
  });
  store.failWrites = true;
  await assert.rejects(flushNow(ctx.queue), /disk full/);
  assert.equal((await result).ok, true);
  assert.equal(ctx.queue.getState().pending, 0);
  assert.equal(ctx.queue.getState().persistenceDirty, true);
  assert.ok(await ctx.queue.drain(20) > 0);
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
});

test("drain cannot finish between in-memory completion and its durable commit", async () => {
  const ctx = createQueue();
  const accepted = ctx.queue.enqueue("mcc.updateCells", {
    row: 2,
    updates: { N: "saved" },
    identity: { profileName: "Profile", accountName: "Account" }
  });
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
  const item = Array.from(ctx.queue.pending.values())[0];
  const beforeCommit = clone(ctx.store.values[SNAPSHOT_STORE_KEY]);

  ctx.queue.flushing = true;
  ctx.queue.inflight.add(item.id);
  ctx.queue.complete(item, { ok: true, applied: { N: "saved" } });

  assert.equal(ctx.queue.getState().pending, 0);
  assert.equal(ctx.queue.getState().persistenceDirty, true);
  assert.equal(beforeCommit.items.some((stored) => stored.id === item.id), true);
  assert.ok(await ctx.queue.drain(20) > 0);

  ctx.queue.inflight.delete(item.id);
  ctx.queue.flushing = false;
  ctx.queue.persist();
  assert.equal(ctx.queue.getState().persistenceDirty, false);
  assert.equal(await ctx.queue.drain(20), 0);
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;

  const committed = ctx.store.values[SNAPSHOT_STORE_KEY];
  assert.equal(committed.items.some((stored) => stored.id === item.id), false);
  assert.equal(committed.completedIds.includes(item.id), true);
  assert.equal((await accepted).ok, true);
});

test("retry metadata mutations mark persistence dirty before they can be drained", async () => {
  const ctx = createQueue();
  const accepted = ctx.queue.enqueue("mcc.updateCells", {
    row: 2,
    updates: { N: "retry" },
    identity: { profileName: "Profile", accountName: "Account" }
  });
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
  const item = Array.from(ctx.queue.pending.values())[0];

  ctx.queue.markFailed(item, "temporary failure");
  assert.equal(item.attempts, 1);
  assert.equal(ctx.queue.getState().persistenceDirty, true);

  ctx.queue.complete(item, { ok: true, applied: { N: "retry" } });
  ctx.queue.persist();
  assert.equal((await accepted).ok, true);
  assert.equal(ctx.queue.getState().persistenceDirty, false);
});

test("malformed nested acknowledgments never remove durable writes", async () => {
  const bridge = {
    async callApi(_action, payload) {
      return {
        ok: true,
        data: {
          results: payload.items.map((item) => ({ applied: clone(item.updates) }))
        }
      };
    },
    async batchApi(batch) {
      return {
        ok: true,
        data: batch.map((item) => ({
          id: item.id,
          result: { data: { value: item.payload.value } }
        }))
      };
    }
  };
  const ctx = createQueue({ bridge });
  const cell = ctx.queue.enqueue("o1.updateCells", {
    row: 2,
    updates: { AE: "value" },
    identity: { profileName: "Profile" }
  });
  const direct = ctx.queue.enqueue("pass.updateCell", {
    row: 2,
    col: "F",
    value: "new",
    identity: { expectedValue: "old" }
  });
  await flushNow(ctx.queue);
  assert.equal((await cell).durable, true);
  assert.equal((await direct).durable, true);
  assert.equal(ctx.queue.getState().pending, 2);
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
});

test("server-safe partition allows distinct identities together", () => {
  const groups = [
    { payload: { row: 2, identity: { profileName: "P", accountName: "A" } } },
    { payload: { row: 3, identity: { profileName: "P", accountName: "B" } } },
    { payload: { row: 4, identity: { profileName: "P", accountName: "A" } } }
  ];
  const batches = partitionServerSafeGroups("mcc.updateCells", groups);
  assert.deepEqual(batches.map((batch) => batch.map((group) => group.payload.row)), [[2, 3], [4]]);
});

test("target identities preserve exact case and cannot collide on delimiters", () => {
  assert.notEqual(
    targetKey("mcc.updateCells", {
      row:2,
      identity:{ profileName:"Foo", accountName:"Account" }
    }),
    targetKey("mcc.updateCells", {
      row:2,
      identity:{ profileName:"foo", accountName:"Account" }
    })
  );
  assert.notEqual(
    targetKey("mcc.updateCells", {
      row:2,
      identity:{ profileName:"A:B", accountName:"C" }
    }),
    targetKey("mcc.updateCells", {
      row:2,
      identity:{ profileName:"A", accountName:"B:C" }
    })
  );
  assert.notEqual(
    targetKey("o1.setNumber", {
      row:2,
      group:"C",
      enabled:true,
      identity:{ profileName:"A:B" }
    }),
    targetKey("o1.setNumber", {
      row:2,
      group:"B:C",
      enabled:true,
      identity:{ profileName:"A" }
    })
  );
  assert.notEqual(
    targetKey("mcc.updateProfileName", { oldProfileName:"Foo" }),
    targetKey("mcc.updateProfileName", { oldProfileName:"foo" })
  );
  assert.notEqual(
    targetKey("company.addRow", { values:["Foo"] }),
    targetKey("company.addRow", { values:["foo"] })
  );
});

test("rename is sent before a dependent edit addressed to the new exact profile", async () => {
  const calls = [];
  const bridge = {
    async batchApi(batch) {
      calls.push({ type:"direct", batch:clone(batch) });
      return {
        ok:true,
        data:batch.map((item) => ({
          id:item.id,
          result:{ ok:true, data:{ renamed:true } }
        }))
      };
    },
    async callApi(action, payload) {
      calls.push({ type:"cells", action, payload:clone(payload) });
      return {
        ok:true,
        data:{
          results:payload.items.map((item) => ({
            ok:true,
            row:item.row,
            applied:clone(item.updates)
          }))
        }
      };
    }
  };
  const ctx = createQueue({ bridge });
  const rename = ctx.queue.enqueue("mcc.updateProfileName", {
    rows:[2],
    value:"Q",
    oldProfileName:"P"
  });
  const edit = ctx.queue.enqueue("mcc.updateCells", {
    row:2,
    updates:{ N:"saved" },
    identity:{ profileName:"Q", accountName:"A" }
  });

  await flushNow(ctx.queue);
  assert.deepEqual(calls.map((call) => call.type), ["direct", "cells"]);
  assert.equal(calls[0].batch.length, 1);
  assert.equal(calls[0].batch[0].action, "mcc.updateProfileName");
  assert.equal(calls[1].payload.items[0].identity.profileName, "Q");
  assert.equal((await rename).ok, true);
  assert.equal((await edit).ok, true);
});

test("failed rename blocks dependent Q writes but not unrelated O1 writes", async () => {
  const calls = [];
  const bridge = {
    async batchApi(batch) {
      calls.push({ type:"direct", batch:clone(batch) });
      return {
        ok:true,
        data:batch.map((item) => ({
          id:item.id,
          result:{ ok:false, error:"rename failed" }
        }))
      };
    },
    async callApi(action, payload) {
      calls.push({ type:"cells", action, payload:clone(payload) });
      return {
        ok:true,
        data:{
          results:payload.items.map((item) => ({
            ok:true,
            row:item.row,
            applied:clone(item.updates)
          }))
        }
      };
    }
  };
  const ctx = createQueue({ bridge });
  const rename = ctx.queue.enqueue("mcc.updateProfileName", {
    rows:[2],
    value:"Q",
    oldProfileName:"P"
  });
  const dependent = ctx.queue.enqueue("mcc.updateCells", {
    row:2,
    updates:{ N:"held" },
    identity:{ profileName:"Q", accountName:"A" }
  });
  const unrelated = ctx.queue.enqueue("o1.updateCells", {
    row:8,
    updates:{ AE:"free" },
    identity:{ profileName:"Other" }
  });

  await flushNow(ctx.queue);
  assert.deepEqual(calls.map((call) => (
    call.type === "direct" ? call.batch[0].action : call.action
  )), ["mcc.updateProfileName", "o1.updateCellsBatch"]);
  assert.equal(ctx.queue.getState().pending, 2);
  assert.equal((await rename).durable, true);
  assert.equal((await dependent).durable, true);
  assert.equal((await unrelated).ok, true);
  clearTimeout(ctx.queue.timer);
  ctx.queue.timer = null;
});

test("older P mutation must complete before rename P to Q", async () => {
  let failOld = true;
  const calls = [];
  const bridge = {
    async callApi(action, payload) {
      calls.push({ type:"cells", action, payload:clone(payload) });
      const ok = !failOld;
      failOld = false;
      return {
        ok:true,
        data:{
          results:payload.items.map((item) => ok
            ? { ok:true, row:item.row, applied:clone(item.updates) }
            : { ok:false, error:"temporary" })
        }
      };
    },
    async batchApi(batch) {
      calls.push({ type:"direct", batch:clone(batch) });
      return {
        ok:true,
        data:batch.map((item) => ({
          id:item.id,
          result:{ ok:true, data:{ renamed:true } }
        }))
      };
    }
  };
  const ctx = createQueue({ bridge });
  const oldEdit = ctx.queue.enqueue("mcc.updateCells", {
    row:2,
    updates:{ N:"before rename" },
    identity:{ profileName:"P", accountName:"A" }
  });
  const rename = ctx.queue.enqueue("mcc.updateProfileName", {
    rows:[2],
    value:"Q",
    oldProfileName:"P"
  });

  await flushNow(ctx.queue);
  assert.deepEqual(calls.map((call) => call.type), ["cells"]);
  for(const item of ctx.queue.pending.values()) item.nextAttemptAt = 0;
  await flushNow(ctx.queue);
  assert.deepEqual(calls.map((call) => call.type), ["cells", "cells", "direct"]);
  assert.equal((await oldEdit).durable, true);
  assert.equal((await rename).ok, true);
  assert.equal(ctx.queue.getState().pending, 0);
});

test("legacy backend holds durable writes until a compatible bridge becomes ready", async () => {
  const bridge = new EventEmitter();
  bridge.ready = true;
  bridge.bridgeVersion = "2.1.5";
  bridge.calls = [];
  bridge.getState = () => ({
    ready: bridge.ready,
    bridgeVersion: bridge.bridgeVersion
  });
  bridge.callApi = async (action, payload) => {
    bridge.calls.push({ action, payload: clone(payload) });
    return {
      ok: true,
      data: {
        results: payload.items.map((item) => ({
          ok: true,
          row: item.row,
          applied: clone(item.updates)
        }))
      }
    };
  };
  bridge.batchApi = async () => ({ ok: true, data: [] });
  const ctx = createQueue({ bridge });
  const accepted = ctx.queue.enqueue("mcc.updateCells", {
    row: 18,
    updates: { N: "held" },
    identity: { profileName: "Profile", accountName: "Account" }
  });
  await flushNow(ctx.queue);
  assert.equal(bridge.calls.length, 0);
  assert.equal(ctx.queue.getState().blockedBackend, 1);
  assert.equal((await accepted).durable, true);

  bridge.bridgeVersion = "2.3.0";
  bridge.emit("state", bridge.getState());
  await flushNow(ctx.queue);
  assert.equal(bridge.calls.length, 1);
  assert.equal(ctx.queue.getState().pending, 0);
});

test("bridge queue-state feedback does not recurse", () => {
  const bridge = new EventEmitter();
  bridge.ready = true;
  bridge.bridgeVersion = "2.3.0";
  bridge.getState = () => ({
    ready: bridge.ready,
    bridgeVersion: bridge.bridgeVersion
  });
  let feedbackCount = 0;
  bridge.setWriteQueueState = () => {
    feedbackCount += 1;
    if (feedbackCount > 5) throw new Error("recursive state feedback");
    bridge.emit("state", bridge.getState());
  };
  const queue = new DurableWriteQueue({
    bridgeManager: bridge,
    store: new MemoryStore(),
    getEndpointKey: () => "https://script.google.com/macros/s/example/exec",
    onState: (state) => bridge.setWriteQueueState(state)
  });
  const before = feedbackCount;
  queue.emitState();
  assert.equal(feedbackCount, before + 1);
});

test("server confirmation is correlated before ACK while an unrelated write stays blocked", async () => {
  const bridge = {
    calls:[],
    getState:() => ({ ready:true, bridgeVersion:"2.3.0" }),
    async callApi(_action, payload) {
      this.calls.push(clone(payload));
      return {
        ok:true,
        data:{
          results:payload.items.map((item) => (
            item.identity.profileName === "Missing"
              ? {
                  ok:false,
                  code:"O1_IDENTITY_NOT_FOUND",
                  error:"Profile is gone"
                }
              : { ok:true, applied:clone(item.updates) }
          ))
        }
      };
    }
  };
  const ctx = createQueue({ bridge });
  const blocked = ctx.queue.enqueue("o1.updateCells", {
    row:10,
    updates:{ D:"blocked" },
    identity:{ profileName:"Missing" }
  });
  const confirmed = ctx.queue.enqueue("o1.updateCells", {
    row:20,
    updates:{ D:"confirmed" },
    identity:{ profileName:"Present" }
  });

  await flushNow(ctx.queue);
  const blockedResult = await blocked;
  const confirmedResult = await confirmed;
  assert.equal(blockedResult.blocked, true);
  assert.equal(blockedResult.lastErrorCode, "O1_IDENTITY_NOT_FOUND");
  assert.equal(confirmedResult.serverConfirmed, true);
  assert.match(confirmedResult.writeId, /^write-/);
  assert.equal(ctx.queue.getState().pending, 1);
  assert.equal(ctx.queue.getState().blocked, 1);
  assert.deepEqual(
    ctx.queue.getState().confirmedWrites.map((item) => item.writeId),
    [confirmedResult.writeId]
  );

  const callsBefore = bridge.calls.length;
  const onlyPending = Array.from(ctx.queue.pending.values())[0];
  onlyPending.nextAttemptAt = 0;
  await flushNow(ctx.queue);
  assert.equal(bridge.calls.length, callsBefore);
});

test("blocked identity failure survives restart and only explicit retry reenables it", async () => {
  const store = new MemoryStore();
  const failingBridge = {
    getState:() => ({ ready:true, bridgeVersion:"2.3.0" }),
    async callApi(_action, payload) {
      return {
        ok:true,
        data:{
          results:payload.items.map(() => ({
            ok:false,
            code:"MCC_IDENTITY_NOT_FOUND",
            error:"Account is gone"
          }))
        }
      };
    }
  };
  const first = createQueue({ store, bridge:failingBridge });
  const accepted = first.queue.enqueue("mcc.updateCells", {
    row:15,
    updates:{ N:"value" },
    identity:{ profileName:"P", accountName:"A" }
  });
  await flushNow(first.queue);
  assert.equal((await accepted).blocked, true);
  assert.equal(first.queue.getState().lastErrorCode, "MCC_IDENTITY_NOT_FOUND");

  const recoveryBridge = successfulBridge();
  const restarted = createQueue({ store, bridge:recoveryBridge });
  assert.equal(restarted.queue.getState().blocked, 1);
  await flushNow(restarted.queue);
  assert.equal(recoveryBridge.calls.length, 0);

  assert.deepEqual(restarted.queue.retryBlocked(), { ok:true, retried:1 });
  await flushNow(restarted.queue);
  assert.equal(recoveryBridge.calls.length, 1);
  assert.equal(restarted.queue.getState().pending, 0);
});

test("transient server failures remain eligible for automatic retry", async () => {
  let attempt = 0;
  const bridge = {
    getState:() => ({ ready:true, bridgeVersion:"2.3.0" }),
    async callApi(_action, payload) {
      attempt += 1;
      return {
        ok:true,
        data:{
          results:payload.items.map((item) => (
            attempt === 1
              ? { ok:false, code:"LOCK_TIMEOUT", error:"Lock timed out" }
              : { ok:true, applied:clone(item.updates) }
          ))
        }
      };
    }
  };
  const ctx = createQueue({ bridge });
  const accepted = ctx.queue.enqueue("o1.updateCells", {
    row:8,
    updates:{ D:"retry" },
    identity:{ profileName:"Profile" }
  });
  await flushNow(ctx.queue);
  const firstResult = await accepted;
  assert.equal(firstResult.retrying, true);
  assert.equal(firstResult.blocked, false);
  const item = Array.from(ctx.queue.pending.values())[0];
  item.nextAttemptAt = 0;
  await flushNow(ctx.queue);
  assert.equal(attempt, 2);
  assert.equal(ctx.queue.getState().pending, 0);
});

test("blocked writes are byte-verified in a checksummed archive before removal", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-blocked-archive-"));
  try {
    const walPath = path.join(temp, "pending.wal.json");
    const bridge = {
      getState:() => ({ ready:true, bridgeVersion:"2.3.0" }),
      async batchApi(batch) {
        return {
          ok:true,
          data:batch.map((item) => ({
            id:item.id,
            result:{
              ok:false,
              code:"PASS_WRITE_SUPERSEDED_EXTERNALLY",
              error:"External value won"
            }
          }))
        };
      }
    };
    const ctx = createQueue({ bridge, walPath });
    const accepted = ctx.queue.enqueue("pass.updateCell", {
      row:4,
      col:"F",
      value:"new",
      identity:{ expectedValue:"old" }
    });
    await flushNow(ctx.queue);
    assert.equal((await accepted).blocked, true);

    const archived = ctx.queue.archiveBlocked();
    assert.equal(archived.ok, true);
    assert.equal(archived.archived, 1);
    assert.equal(ctx.queue.getState().pending, 0);
    const raw = fs.readFileSync(archived.path, "utf8");
    const parsed = JSON.parse(raw);
    assert.ok(validateBlockedArchive(parsed));
    assert.equal(parsed.items[0].lastErrorCode, "PASS_WRITE_SUPERSEDED_EXTERNALLY");
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("uncertain MCC rename blocks its transitive chain without retry spin and archives the closure", async () => {
  const calls = [];
  const bridge = {
    getState:() => ({ ready:true, bridgeVersion:"2.3.0" }),
    async callApi() {
      throw new Error("dependent cell writes must not dispatch");
    },
    async batchApi(batch) {
      calls.push(clone(batch));
      return {
        ok:true,
        data:batch.map((item) => ({
          id:item.id,
          result:{
            ok:false,
            code:"MCC_RENAME_OUTCOME_UNCERTAIN",
            error:"Rename outcome cannot be proven"
          }
        }))
      };
    }
  };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-mcc-closure-"));
  try {
    const ctx = createQueue({
      bridge,
      walPath:path.join(temp, "pending.wal.json")
    });
    const renameAB = ctx.queue.enqueue("mcc.updateProfileName", {
      rows:[2],
      value:"B",
      oldProfileName:"A"
    });
    ctx.queue.enqueue("mcc.updateProfileName", {
      rows:[2],
      value:"C",
      oldProfileName:"B"
    });
    ctx.queue.enqueue("mcc.updateCells", {
      row:2,
      updates:{ Q:"after" },
      identity:{ profileName:"C", accountName:"Account" }
    });

    await flushNow(ctx.queue);
    const blocked = await renameAB;
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.lastErrorCode, "MCC_RENAME_OUTCOME_UNCERTAIN");
    assert.equal(calls.length, 1);
    assert.equal(ctx.queue.getState().blocked, 3);
    assert.equal(ctx.queue.getState().dependencyBlocked, 2);
    ctx.queue.scheduleNextRetry();
    assert.equal(ctx.queue.timer, null);

    const archived = ctx.queue.archiveBlocked([blocked.writeId]);
    assert.equal(archived.archived, 3);
    assert.equal(ctx.queue.getState().pending, 0);
    const payload = validateBlockedArchive(JSON.parse(fs.readFileSync(archived.path, "utf8")));
    assert.ok(payload);
    assert.equal(payload.items.filter((item) => item.dependencyBlocked).length, 2);
    await flushNow(ctx.queue);
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("uncertain PASS write quarantines and archives every causal descendant", async () => {
  const calls = [];
  const bridge = {
    getState:() => ({ ready:true, bridgeVersion:"2.3.0" }),
    async batchApi(batch) {
      calls.push(clone(batch));
      return {
        ok:true,
        data:batch.map((item) => ({
          id:item.id,
          result:{
            ok:false,
            code:"PASS_WRITE_OUTCOME_UNCERTAIN",
            error:"PASS outcome cannot be proven"
          }
        }))
      };
    }
  };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-pass-closure-"));
  try {
    const ctx = createQueue({
      bridge,
      walPath:path.join(temp, "pending.wal.json")
    });
    const first = ctx.queue.enqueue("pass.updateCell", {
      row:4,
      col:"F",
      value:"middle",
      identity:{ expectedValue:"old" }
    });
    ctx.queue.enqueue("pass.updateCell", {
      row:4,
      col:"F",
      value:"new",
      identity:{ expectedValue:"middle" }
    });
    ctx.queue.enqueue("pass.updateCell", {
      row:4,
      col:"F",
      value:"final",
      identity:{ expectedValue:"new" }
    });

    await flushNow(ctx.queue);
    const blocked = await first;
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.lastErrorCode, "PASS_WRITE_OUTCOME_UNCERTAIN");
    assert.equal(calls.length, 1);
    assert.equal(ctx.queue.getState().dependencyBlocked, 2);
    ctx.queue.scheduleNextRetry();
    assert.equal(ctx.queue.timer, null);

    const archived = ctx.queue.archiveBlocked([blocked.writeId]);
    assert.equal(archived.archived, 3);
    assert.equal(ctx.queue.getState().pending, 0);
    await flushNow(ctx.queue);
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});
