"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DurableWriteQueue,
  snapshotChecksum,
  writeWalSnapshot
} = require("../src/main/durableWriteQueue");
const { registerApiIpc } = require("../src/main/apiIpc");
const { prepareStoreBootstrap } = require("../src/main/storeRecovery");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class MemoryStore {
  constructor(values = {}) {
    this.values = clone(values);
  }
  get(key) {
    return clone(this.values[key]);
  }
  set(key, value) {
    this.values[key] = clone(value);
  }
}

function validWalEnvelope(items = []) {
  const payload = {
    schemaVersion:1,
    revision:1,
    writtenAt:Date.now(),
    completedIds:[],
    items
  };
  return { ...payload, checksum:snapshotChecksum(payload) };
}

test("healthy or missing primary store keeps the canonical store name", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-store-healthy-"));
  try {
    fs.writeFileSync(path.join(temp, "sproutg-desktop.json"), JSON.stringify({ settings:{} }));
    const result = prepareStoreBootstrap({
      userDataDir:temp,
      walPath:path.join(temp, "queue.wal.json")
    });
    assert.equal(result.storeName, "sproutg-desktop");
    assert.equal(result.integrity.active, false);
    assert.equal(result.integrity.sheetWritesBlocked, false);
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("corrupt primary store is preserved byte-for-byte and a stable recovery store is selected", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-store-corrupt-"));
  try {
    const primaryPath = path.join(temp, "sproutg-desktop.json");
    const corruptBytes = Buffer.from('{"heroSms":{"activeOrder":"paid"}', "utf8");
    fs.writeFileSync(primaryPath, corruptBytes);

    const first = prepareStoreBootstrap({
      userDataDir:temp,
      walPath:path.join(temp, "missing.wal.json")
    });
    assert.equal(first.integrity.active, true);
    assert.equal(first.integrity.sheetWritesBlocked, true);
    assert.equal(first.integrity.heroSmsBlocked, true);
    assert.equal(first.storeName, "sproutg-desktop-recovery");
    assert.deepEqual(fs.readFileSync(primaryPath), corruptBytes);
    assert.deepEqual(
      fs.readFileSync(first.integrity.quarantines[0].path),
      corruptBytes
    );

    fs.writeFileSync(first.storePath, JSON.stringify({ settings:{ theme:"dark-classic" } }));
    const second = prepareStoreBootstrap({
      userDataDir:temp,
      walPath:path.join(temp, "missing.wal.json")
    });
    assert.equal(second.storeName, first.storeName);
    assert.equal(second.storePath, first.storePath);
    assert.deepEqual(fs.readFileSync(primaryPath), corruptBytes);
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("a checksummed WAL permits recovery-store sheet work and is imported", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-store-wal-"));
  try {
    const endpoint = "https://script.google.com/macros/s/example/exec";
    const primaryPath = path.join(temp, "sproutg-desktop.json");
    const walPath = path.join(temp, "queue.wal.json");
    fs.writeFileSync(primaryPath, "{broken");
    const item = {
      id:"write-recovered",
      action:"o1.updateCells",
      kind:"cells",
      payload:{
        row:2,
        updates:{ D:"recover" },
        identity:{ profileName:"Profile" }
      },
      endpointKey:endpoint,
      seq:1,
      createdAt:1,
      attempts:0,
      nextAttemptAt:0,
      lastError:"",
      blocked:false
    };
    writeWalSnapshot(walPath, validWalEnvelope([item]));

    const bootstrap = prepareStoreBootstrap({ userDataDir:temp, walPath });
    assert.equal(bootstrap.integrity.walValid, true);
    assert.equal(bootstrap.integrity.sheetWritesBlocked, false);
    assert.equal(bootstrap.integrity.heroSmsBlocked, true);

    const queue = new DurableWriteQueue({
      store:new MemoryStore(),
      walPath,
      getEndpointKey:() => endpoint,
      bridgeManager:{
        getState:() => ({ ready:false, bridgeVersion:"2.3.0" })
      }
    });
    clearTimeout(queue.timer);
    queue.timer = null;
    assert.equal(queue.getState().pending, 1);
    assert.equal(queue.getState().integrityBlocked, false);
    assert.equal(queue.pending.get("write-recovered").payload.updates.D, "recover");
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("integrity gate blocks every sheet mutation before dispatch when WAL is unproven", async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
  let calls = 0;
  const bridge = {
    getState:() => ({ ready:true, bridgeVersion:"2.3.0" }),
    async callApi() {
      calls += 1;
      return { ok:true, data:{} };
    },
    async batchApi() {
      calls += 1;
      return { ok:true, data:[] };
    }
  };
  const controller = registerApiIpc(ipcMain, bridge, new MemoryStore(), {
    getEndpointKey:() => "https://script.google.com/macros/s/example/exec",
    getWriteIntegrityBlock:() => ({
      code:"LOCAL_STORE_CORRUPT",
      message:"blocked until recovery"
    })
  });
  clearTimeout(controller.durableWrites.timer);
  controller.durableWrites.timer = null;

  const mutation = await handlers.get("sproutg:api-call")(
    {},
    "o1.updateCells",
    { row:2, updates:{ D:"x" }, identity:{ profileName:"P" } },
    {}
  );
  assert.equal(mutation.ok, false);
  assert.equal(mutation.code, "LOCAL_STORE_CORRUPT");
  assert.equal(controller.getState().pending, 0);
  assert.equal(calls, 0);

  await handlers.get("sproutg:api-call")({}, "meta.config", {}, {});
  assert.equal(calls, 1);
});

test("missing WAL on a later corrupt-store restart cannot flush recovery-store mirrors", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-store-restart-"));
  try {
    const endpoint = "https://script.google.com/macros/s/example/exec";
    const walPath = path.join(temp, "queue.wal.json");
    const item = {
      id:"write-recovery-mirror",
      action:"o1.updateCells",
      kind:"cells",
      payload:{
        row:2,
        updates:{ D:"must-not-dispatch" },
        identity:{ profileName:"Profile" }
      },
      endpointKey:endpoint,
      seq:1,
      createdAt:1,
      attempts:0,
      nextAttemptAt:0,
      lastError:"",
      blocked:false
    };
    writeWalSnapshot(walPath, validWalEnvelope([item]));
    const recoveryStore = new MemoryStore();
    const first = new DurableWriteQueue({
      store:recoveryStore,
      walPath,
      getEndpointKey:() => endpoint,
      bridgeManager:{
        getState:() => ({ ready:false, bridgeVersion:"2.3.0" })
      }
    });
    clearTimeout(first.timer);
    first.timer = null;
    assert.equal(first.getState().pending, 1);
    fs.rmSync(walPath, { force:true });
    fs.rmSync(`${walPath}.bak`, { force:true });

    let dispatches = 0;
    const restarted = new DurableWriteQueue({
      store:recoveryStore,
      walPath,
      startupWriteBlock:{
        code:"LOCAL_STORE_CORRUPT",
        message:"valid WAL is unavailable"
      },
      getEndpointKey:() => endpoint,
      bridgeManager:{
        getState:() => ({ ready:true, bridgeVersion:"2.3.0" }),
        async callApi() {
          dispatches += 1;
          return { ok:true, data:{ results:[] } };
        }
      }
    });
    assert.equal(restarted.timer, null);
    assert.equal(restarted.getState().pending, 1);
    assert.equal(restarted.getState().externalIntegrityBlocked, true);
    await restarted.flush();
    assert.equal(dispatches, 0);
    assert.equal(fs.existsSync(walPath), false);
    assert.equal(restarted.retryBlocked().ok, false);
    const enqueueResult = await restarted.enqueue("o1.updateCells", {
      row:3,
      updates:{ D:"new" },
      identity:{ profileName:"Other" }
    });
    assert.equal(enqueueResult.ok, false);
    assert.equal(enqueueResult.code, "LOCAL_STORE_CORRUPT");
    assert.equal(dispatches, 0);
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});

test("blocked-write archive is default-deny and requires native confirmation", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-archive-confirm-"));
  try {
    const deniedHandlers = new Map();
    registerApiIpc(
      { handle:(channel, handler) => deniedHandlers.set(channel, handler) },
      { getState:() => ({ ready:false, bridgeVersion:"2.3.0" }) },
      new MemoryStore(),
      { getEndpointKey:() => "" }
    );
    const defaultDenied = await deniedHandlers.get(
      "sproutg:write-queue-archive-blocked"
    )({}, null);
    assert.equal(defaultDenied.ok, false);
    assert.equal(
      defaultDenied.code,
      "WRITE_QUEUE_ARCHIVE_CONFIRMATION_REQUIRED"
    );

    const handlers = new Map();
    const ipcMain = {
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    };
    let allow = false;
    let confirmationCalls = 0;
    const endpoint = "https://script.google.com/macros/s/example/exec";
    const controller = registerApiIpc(
      ipcMain,
      {
        getState:() => ({ ready:false, bridgeVersion:"2.3.0" })
      },
      new MemoryStore(),
      {
        walPath:path.join(temp, "queue.wal.json"),
        getEndpointKey:() => endpoint,
        confirmArchiveBlocked:async () => {
          confirmationCalls += 1;
          return allow;
        }
      }
    );
    const blockedItem = {
      id:"blocked-write",
      action:"o1.updateCells",
      kind:"cells",
      payload:{
        row:2,
        updates:{ D:"blocked" },
        identity:{ profileName:"Profile" }
      },
      endpointKey:endpoint,
      seq:1,
      createdAt:1,
      attempts:1,
      nextAttemptAt:0,
      lastError:"identity not found",
      lastErrorCode:"O1_IDENTITY_NOT_FOUND",
      blocked:true
    };
    controller.durableWrites.pending.set(blockedItem.id, blockedItem);
    controller.durableWrites.persist();

    const archive = handlers.get("sproutg:write-queue-archive-blocked");
    const canceled = await archive({}, [blockedItem.id]);
    assert.equal(canceled.ok, false);
    assert.equal(canceled.code, "WRITE_QUEUE_ARCHIVE_CANCELED");
    assert.equal(controller.getState().pending, 1);
    assert.equal(confirmationCalls, 1);

    allow = true;
    const confirmed = await archive({}, [blockedItem.id]);
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.archived, 1);
    assert.equal(controller.getState().pending, 0);
    assert.equal(confirmationCalls, 2);
    assert.ok(fs.existsSync(confirmed.path));
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
  }
});
