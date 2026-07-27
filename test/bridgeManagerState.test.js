"use strict";

const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const Module = require("node:module");
const test = require("node:test");
const vm = require("node:vm");

const fakeIpcMain = new EventEmitter();
let nextWebContentsId = 1;

class FakeBrowserWindow extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.webContents = new EventEmitter();
    this.webContents.id = nextWebContentsId++;
    this.webContents.destroyed = false;
    this.webContents.isDestroyed = () => this.webContents.destroyed;
    this.webContents.mainFrame = { framesInSubtree: [] };
    this.webContents.loadURL = async () => {};
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents.destroyed = true;
    this.webContents.emit("destroyed");
    this.emit("closed");
  }
}

const originalLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain) {
  if (request === "electron") {
    return { BrowserWindow: FakeBrowserWindow, ipcMain: fakeIpcMain };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { BridgeManager } = require("../src/main/bridgeManager");
Module._load = originalLoad;

function createManager() {
  return new BridgeManager({
    getSession: () => ({}),
    partition: "persist:test",
    appDir: process.cwd()
  });
}

function createFrame(processId, routingId) {
  const sent = [];
  return {
    processId,
    routingId,
    url: "https://test-script.googleusercontent.com/userCodeAppPanel",
    detached: false,
    sent,
    isDestroyed: () => false,
    send(channel, message) {
      sent.push({ channel, message });
    }
  };
}

function installChallenge(manager, frame, nonce = "nonce", id = "challenge") {
  const key = manager.frameKey(frame);
  manager.frameChallenges.set(key, { frame, key, nonce, id });
  return { key, nonce, id };
}

test("frame-specific main-world relay reaches an Apps Script nested frame", async () => {
  const manager = createManager();
  const listeners = [];
  const relayed = [];
  const frameWindow = {
    location: { origin: "https://test-script.googleusercontent.com" },
    __sproutgNativeBridge230: {
      relay(message) {
        relayed.push(message);
      }
    },
    addEventListener(type, listener) {
      if (type === "message") listeners.push(listener);
    },
    postMessage(message) {
      for (const listener of listeners) {
        listener({ source:frameWindow, data:message });
      }
    }
  };
  const scripts = [];
  const frame = createFrame(9, 19);
  frame.url = "https://test-script.googleusercontent.com/blank";
  frame.executeJavaScript = async (source) => {
    scripts.push(source);
    return vm.runInNewContext(source, { window:frameWindow });
  };

  const challenge = {
    source:"sproutg-desktop",
    type:"PING",
    id:"challenge-iframe",
    bridgeNonce:"nonce-\u2028-safe"
  };
  assert.equal(manager.sendToFrame(frame, challenge), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].includes("\u2028"), false);
  assert.equal(frame.sent.length, 0);
  assert.equal(relayed.length, 0);

  frameWindow.postMessage({
    source:"sproutg-bridge",
    type:"PONG",
    id:challenge.id,
    bridgeNonce:challenge.bridgeNonce
  });
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].type, "PONG");

  for (const listener of listeners) {
    listener({
      source:{},
      data:{ source:"sproutg-bridge", type:"API_RESULT" }
    });
  }
  frameWindow.postMessage({ source:"untrusted", type:"PONG" });
  assert.equal(relayed.length, 1);
  manager.destroy();
});

test("modern bridge pins an exact challenged frame and rejects spoofed results", async () => {
  const manager = createManager();
  const frame = createFrame(10, 20);
  const otherFrame = createFrame(10, 21);
  const challenge = installChallenge(manager, frame);

  manager.handleMessage({
    type: "PONG",
    bridgeVersion: "2.3.0",
    id: challenge.id,
    authenticated: true,
    bridgeNonce: challenge.nonce
  }, frame);
  assert.equal(manager.bridgeFrameKey, challenge.key);
  assert.equal(manager.ready, false);

  manager.handleMessage({
    type: "BRIDGE_READY",
    bridgeVersion: "2.3.0",
    challengeId: challenge.id,
    authenticated: true,
    bridgeNonce: challenge.nonce
  }, frame);
  assert.equal(manager.ready, true);
  assert.equal(manager.bridgeAuthenticated, true);

  const resultPromise = manager.callApi("meta.config", {});
  const request = frame.sent.at(-1).message;
  assert.equal(request.bridgeNonce, challenge.nonce);
  assert.equal(manager.pending.size, 1);

  manager.handleMessage({
    type: "API_RESULT",
    id: request.id,
    authenticated: true,
    bridgeNonce: challenge.nonce,
    result: { ok: true, data: { spoofed: true } }
  }, otherFrame);
  assert.equal(manager.pending.size, 1);

  manager.handleMessage({
    type: "API_RESULT",
    id: request.id,
    authenticated: true,
    bridgeNonce: "wrong",
    result: { ok: true, data: { spoofed: true } }
  }, frame);
  assert.equal(manager.pending.size, 1);

  manager.handleMessage({
    type: "API_RESULT",
    id: request.id,
    authenticated: true,
    bridgeNonce: challenge.nonce,
    result: { ok: true, data: { value: 1 } }
  }, frame);
  assert.deepEqual(await resultPromise, { ok: true, data: { value: 1 } });
  manager.destroy();
});

test("modern bridge rejects a wrong challenge id", () => {
  const manager = createManager();
  const frame = createFrame(11, 22);
  const challenge = installChallenge(manager, frame);
  manager.handleMessage({
    type: "BRIDGE_READY",
    bridgeVersion: "2.3.0",
    challengeId: "wrong",
    authenticated: true,
    bridgeNonce: challenge.nonce
  }, frame);
  assert.equal(manager.ready, false);
  assert.equal(manager.bridgeFrameKey, "");
  manager.destroy();
});

test("legacy 2.1.5 PONG proves frame ownership and legacy result settles", async () => {
  const manager = createManager();
  const frame = createFrame(12, 23);
  const challenge = installChallenge(manager, frame);
  manager.handleMessage({
    type: "PONG",
    bridgeVersion: "2.1.5",
    id: challenge.id
  }, frame);
  assert.equal(manager.ready, true);
  assert.equal(manager.bridgeAuthenticated, false);
  assert.equal(manager.bridgeVersion, "2.1.5");

  const resultPromise = manager.callApi("meta.config", {});
  const request = frame.sent.at(-1).message;
  manager.handleMessage({
    type: "API_RESULT",
    id: request.id,
    result: { ok: true, data: { legacy: true } }
  }, frame);
  assert.deepEqual(await resultPromise, { ok: true, data: { legacy: true } });
  manager.destroy();
});

test("reload rejects active requests and a request cannot start after its deadline", async () => {
  const manager = createManager();
  const frame = createFrame(13, 24);
  manager.bridgeFrame = frame;
  manager.bridgeFrameKey = manager.frameKey(frame);
  manager.ready = true;
  manager.bridgeVersion = "2.1.5";
  manager.url = "https://script.google.com/macros/s/abcdefghijklmnopqrstuvwxyz/exec";

  const active = manager.callApi("meta.config", {});
  manager.reload();
  await assert.rejects(active, (error) => error?.code === "BRIDGE_RECONNECT");

  manager.ready = true;
  manager.bridgeFrame = frame;
  manager.bridgeFrameKey = manager.frameKey(frame);
  let deadlineError = null;
  manager.sendRequest({
    requestId: "expired",
    type: "API_CALL",
    action: "meta.config",
    payload: {},
    attempts: 0,
    retries: 0,
    timeoutMs: 1000,
    deadlineAt: Date.now() - 1,
    settled: false,
    resolve: () => {},
    reject: (error) => { deadlineError = error; }
  });
  assert.equal(deadlineError?.code, "BRIDGE_UNAVAILABLE");

  manager.sendRequest({
    requestId: "capped",
    type: "API_CALL",
    action: "meta.config",
    payload: {},
    attempts: 0,
    retries: 0,
    timeoutMs: 1000,
    deadlineAt: Date.now() + 40,
    settled: false,
    resolve: () => {},
    reject: () => {}
  });
  const capped = Array.from(manager.pending.values())
    .find((item) => item.requestId === "capped");
  assert.ok(capped);
  assert.ok(capped.timer._idleTimeout <= 40);
  manager.destroy();
});

test("subframe load failures and normal navigation aborts do not reset the bridge", () => {
  const manager = createManager();
  manager.load("https://script.google.com/macros/s/abcdefghijklmnopqrstuvwxyz/exec");
  const wc = manager.window.webContents;
  let reconnects = 0;
  manager.scheduleReconnect = () => { reconnects += 1; };
  manager.ready = true;
  manager.bridgeFrameKey = "44:55";
  const nonceBeforeCancelledNavigation = manager.bridgeNonce;

  wc.emit("did-start-navigation", {
    isMainFrame: true,
    isSameDocument: false
  });
  wc.emit("did-fail-load", {}, -3, "aborted", "", true, 1, 1);
  assert.equal(manager.ready, true);
  assert.equal(manager.bridgeNonce, nonceBeforeCancelledNavigation);

  wc.emit("did-fail-load", {}, -105, "subframe failed", "", false, 77, 88);
  assert.equal(manager.ready, true);
  assert.equal(reconnects, 0);

  wc.emit("did-frame-navigate", {}, "", 200, "OK", true, 1, 1);
  assert.equal(manager.ready, false);
  assert.notEqual(manager.bridgeNonce, nonceBeforeCancelledNavigation);

  manager.ready = true;
  manager.bridgeFrameKey = "44:55";
  wc.emit("did-fail-load", {}, -105, "bridge frame failed", "", false, 44, 55);
  assert.equal(manager.ready, false);
  assert.equal(reconnects, 1);
  manager.destroy();
});

test("a queued write cannot cross a reconnect into a legacy bridge", async () => {
  const manager = createManager();
  const frame = createFrame(70, 80);
  manager.bridgeFrame = frame;
  manager.bridgeFrameKey = manager.frameKey(frame);
  manager.bridgeVersion = "2.3.0";
  manager.ready = false;

  const resultPromise = manager.callApi("mcc.updateCellsBatch", {
    items: [{
      row: 2,
      updates: { N: "safe" },
      identity: { profileName: "P", accountName: "A" }
    }]
  }, {
    minBridgeVersion: "2.3.0",
    timeoutMs: 1000,
    queueTimeoutMs: 2000,
    retries: 0
  });
  assert.equal(manager.queue.length, 1);

  const originalSendRequest = manager.sendRequest.bind(manager);
  let switched = false;
  manager.sendRequest = (item) => {
    if (!switched) {
      switched = true;
      manager.bridgeVersion = "2.1.5";
      manager.ready = true;
    }
    originalSendRequest(item);
  };
  manager.ready = true;
  manager.flushQueue();
  assert.equal(frame.sent.length, 0);
  assert.equal(manager.queue.length, 1);

  manager.sendRequest = originalSendRequest;
  manager.bridgeVersion = "2.3.0";
  manager.ready = true;
  manager.flushQueue();
  assert.equal(frame.sent.length, 1);
  assert.equal(manager.queue.length, 0);
  const transportId = Array.from(manager.pending.keys())[0];
  manager.settle(transportId, { ok: true, data: { applied: true } });
  assert.equal((await resultPromise).ok, true);
  manager.destroy();
});
