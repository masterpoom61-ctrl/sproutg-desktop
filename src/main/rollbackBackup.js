"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function fileDigest(fsImpl, filePath) {
  const bytes = fsImpl.readFileSync(filePath);
  return {
    size:bytes.length,
    sha256:crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

function inventoryTree(fsImpl, rootPath) {
  const rootStat = fsImpl.lstatSync(rootPath);
  if (rootStat.isFile()) {
    return [{ relativePath:"", ...fileDigest(fsImpl, rootPath) }];
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`unsupported backup source type: ${rootPath}`);
  }
  const files = [];
  const visit = (directory, prefix) => {
    const names = fsImpl.readdirSync(directory).slice().sort();
    for (const name of names) {
      const absolute = path.join(directory, name);
      const relativePath = prefix ? path.join(prefix, name) : name;
      const stat = fsImpl.lstatSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute, relativePath);
      } else if (stat.isFile()) {
        files.push({
          relativePath:relativePath.replace(/\\/g, "/"),
          ...fileDigest(fsImpl, absolute)
        });
      } else {
        throw new Error(`unsupported backup entry type: ${absolute}`);
      }
    }
  };
  visit(rootPath, "");
  return files;
}

function assertInventoryMatch(sourceFiles, targetFiles, name) {
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) {
    throw new Error(`byte/hash verification failed for ${name}`);
  }
}

function createRollbackBackup({
  userData,
  storePath,
  fromVersion,
  targetVersion,
  now = new Date(),
  fsImpl = fs
}) {
  const root = String(userData || "").trim();
  if (!root) throw new Error("Rollback backup requires a userData directory");
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(root, "rollback-backups", `${stamp}-to-${targetVersion}`);
  fsImpl.mkdirSync(backupDir, { recursive:true });
  const copied = [];
  const verifiedFiles = [];

  const copy = (source, name) => {
    if (!source || !fsImpl.existsSync(source)) return;
    const target = path.join(backupDir, name);
    try {
      const sourceFiles = inventoryTree(fsImpl, source);
      fsImpl.cpSync(source, target, {
        recursive:true,
        force:true,
        errorOnExist:false
      });
      if (!fsImpl.existsSync(target)) {
        throw new Error("copy completed without a destination");
      }
      const targetFiles = inventoryTree(fsImpl, target);
      assertInventoryMatch(sourceFiles, targetFiles, name);
      copied.push(name);
      for (const file of targetFiles) {
        verifiedFiles.push({
          path:file.relativePath ? `${name}/${file.relativePath}` : name,
          size:file.size,
          sha256:file.sha256
        });
      }
    } catch (error) {
      throw new Error(
        `Rollback backup failed for ${name}: ${error?.message || error}`,
        { cause:error }
      );
    }
  };

  copy(storePath, path.basename(storePath || "config.json"));
  copy(path.join(root, "sproutg.config.json"), "sproutg.config.json");
  copy(path.join(root, "sproutg-pending-writes.wal.json"), "sproutg-pending-writes.wal.json");
  copy(path.join(root, "sproutg-pending-writes.wal.json.bak"), "sproutg-pending-writes.wal.json.bak");
  copy(
    path.join(root, "Partitions", "sproutg", "Local Storage"),
    "SproutG Partition Local Storage"
  );
  copy(path.join(root, "Local Storage"), "Default Local Storage");

  if (!copied.length) {
    throw new Error(
      "Rollback backup found no recoverable store, WAL, or Local Storage data"
    );
  }

  const manifestPath = path.join(backupDir, "rollback.json");
  const manifest = {
    fromVersion:String(fromVersion || ""),
    toVersion:String(targetVersion || ""),
    createdAt:new Date(now).toISOString(),
    copied,
    verification:{
      algorithm:"sha256",
      verified:true,
      fileCount:verifiedFiles.length,
      totalBytes:verifiedFiles.reduce((sum, file) => sum + file.size, 0),
      files:verifiedFiles
    }
  };
  const serializedManifest = JSON.stringify(manifest, null, 2);
  fsImpl.writeFileSync(manifestPath, serializedManifest, "utf8");
  if (!fsImpl.existsSync(manifestPath)) {
    throw new Error("Rollback backup manifest was not written");
  }
  if (fsImpl.readFileSync(manifestPath, "utf8") !== serializedManifest) {
    throw new Error("Rollback backup manifest byte verification failed");
  }
  return backupDir;
}

module.exports = {
  assertInventoryMatch,
  createRollbackBackup,
  inventoryTree
};
