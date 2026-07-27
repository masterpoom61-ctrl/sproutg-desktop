"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("bridge popup reconnects the hidden Apps bridge instead of only reloading UI", () => {
  const preload = source("src/preload.js");
  const rendererApi = source("src/renderer/core/api.js");
  const main = source("src/main.js");

  assert.match(
    preload,
    /reconnectBridge:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('sproutg:reconnect-bridge'\)/
  );
  assert.match(
    rendererApi,
    /action === 'reload'[\s\S]{0,300}window\.sproutg\.reconnectBridge\(\)/
  );
  assert.match(
    main,
    /ipcMain\.handle\('sproutg:reconnect-bridge'[\s\S]{0,300}reloadBridgeAfterLogin\(\)/
  );
});

test("O1 row reads carry stable profile identity and tabs are keyed by profile", () => {
  const renderer = source("src/renderer/app.js");
  const rendererApi = source("src/renderer/core/api.js");

  assert.match(
    rendererApi,
    /getProfileByRow:[\s\S]{0,140}\(\[row,\s*identity\]\)[\s\S]{0,100}\(\{\s*row,\s*identity\s*\}\)/
  );
  assert.match(
    renderer,
    /getProfileByRow\(requestRow,\s*\{\s*profileName:requestProfileName\s*\}\)/
  );
  assert.match(
    renderer,
    /getProfileByRow\([\s\S]{0,180}expectedProfileName\s*\?\s*\{\s*profileName:expectedProfileName\s*\}/
  );
  assert.match(
    renderer,
    /getO1AppealRowData\(rowNum,\s*\{\s*profileName:String\(profile\?\.profileName/
  );
  assert.match(renderer, /return `O1@\$\{encodeURIComponent\(stableName\)\}`/);
});

test("single-instance and corrupt-store recovery gates run before electron-store opens", () => {
  const main = source("src/main.js");
  const lockIndex = main.indexOf("app.requestSingleInstanceLock()");
  const bootstrapIndex = main.indexOf("prepareStoreBootstrap({");
  const storeIndex = main.indexOf("new Store({");
  assert.ok(lockIndex >= 0 && lockIndex < storeIndex);
  assert.ok(bootstrapIndex >= 0 && bootstrapIndex < storeIndex);
  assert.match(main, /clearInvalidConfig:false/);
  assert.match(
    main,
    /storageIntegrity\.heroSmsBlocked[\s\S]{0,260}LOCAL_STORE_INTEGRITY_BLOCKED/
  );
  assert.match(
    main,
    /confirmArchiveBlocked:async[\s\S]{0,900}dialog\.showMessageBox[\s\S]{0,400}result\.response === 1/
  );
});

test("storage-integrity warning is persistent and visible in bridge health", () => {
  const main = source("src/main.js");
  const api = source("src/renderer/core/api.js");
  assert.match(
    main,
    /notifyStorageIntegrity[\s\S]{0,500}durationMs:0[\s\S]{0,100}dismissible:false/
  );
  assert.match(api, /if \(state\?\.storageIntegrity\?\.active\) return 'bad'/);
  assert.match(api, /storageIntegrity\.active[\s\S]{0,220}ТРЕБУЮТ ВОССТАНОВЛЕНИЯ/);
  assert.match(
    api,
    /const durationMs = hasDuration \? Number\(payload\.durationMs\) : 6500;[\s\S]{0,100}durationMs > 0/
  );
});
