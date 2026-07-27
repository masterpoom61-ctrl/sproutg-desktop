"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createRollbackBackup } = require("../src/main/rollbackBackup");

test("rollback backup copies existing durable state and writes a manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-rollback-backup-"));
  try {
    const storePath = path.join(root, "config.json");
    fs.writeFileSync(storePath, "store", "utf8");
    fs.writeFileSync(
      path.join(root, "sproutg-pending-writes.wal.json"),
      "wal",
      "utf8"
    );
    const backupDir = createRollbackBackup({
      userData:root,
      storePath,
      fromVersion:"2.3.0",
      targetVersion:"2.2.2",
      now:new Date("2026-07-27T12:00:00.000Z")
    });
    assert.equal(fs.readFileSync(path.join(backupDir, "config.json"), "utf8"), "store");
    assert.equal(
      fs.readFileSync(path.join(backupDir, "sproutg-pending-writes.wal.json"), "utf8"),
      "wal"
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(backupDir, "rollback.json"), "utf8")
    );
    assert.deepEqual(
      manifest.copied.sort(),
      ["config.json", "sproutg-pending-writes.wal.json"].sort()
    );
    assert.equal(manifest.verification.verified, true);
    assert.equal(manifest.verification.algorithm, "sha256");
    assert.equal(manifest.verification.fileCount, 2);
    assert.equal(manifest.verification.totalBytes, 8);
    assert.ok(
      manifest.verification.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))
    );
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test("rollback backup fails closed when any existing source cannot be copied", () => {
  const fakeFs = {
    mkdirSync() {},
    existsSync(value) {
      return String(value).endsWith("config.json");
    },
    cpSync() {
      throw new Error("disk read failure");
    },
    lstatSync() {
      return {
        isFile:() => true,
        isDirectory:() => false
      };
    },
    readFileSync() {
      return Buffer.from("source");
    },
    writeFileSync() {
      throw new Error("manifest must not be written after copy failure");
    }
  };
  assert.throws(
    () => createRollbackBackup({
      userData:"C:\\Users\\Test\\AppData",
      storePath:"C:\\Users\\Test\\AppData\\config.json",
      fromVersion:"2.3.0",
      targetVersion:"2.2.2",
      now:new Date("2026-07-27T12:00:00.000Z"),
      fsImpl:fakeFs
    }),
    /Rollback backup failed for config\.json: disk read failure/
  );
});

test("rollback backup fails closed when no recoverable source exists", () => {
  let manifestWritten = false;
  const fakeFs = {
    mkdirSync() {},
    existsSync() {
      return false;
    },
    cpSync() {
      throw new Error("nothing should be copied");
    },
    writeFileSync() {
      manifestWritten = true;
    }
  };
  assert.throws(
    () => createRollbackBackup({
      userData:"C:\\Users\\Test\\Empty",
      storePath:"C:\\Users\\Test\\Empty\\config.json",
      fromVersion:"2.3.0",
      targetVersion:"2.2.2",
      now:new Date("2026-07-27T12:00:00.000Z"),
      fsImpl:fakeFs
    }),
    /no recoverable store, WAL, or Local Storage data/
  );
  assert.equal(manifestWritten, false);
});

test("rollback backup rejects a destination whose bytes differ from the source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sproutg-rollback-tamper-"));
  try {
    const storePath = path.join(root, "config.json");
    fs.writeFileSync(storePath, "complete-store", "utf8");
    const tamperingFs = {
      ...fs,
      cpSync(source, target, options) {
        fs.cpSync(source, target, options);
        fs.writeFileSync(target, "short", "utf8");
      }
    };
    assert.throws(
      () => createRollbackBackup({
        userData:root,
        storePath,
        fromVersion:"2.3.0",
        targetVersion:"2.2.2",
        now:new Date("2026-07-27T12:00:00.000Z"),
        fsImpl:tamperingFs
      }),
      /byte\/hash verification failed for config\.json/
    );
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});
