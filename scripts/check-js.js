#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIRS = ["scripts", "src", "test"];
const EXTENSIONS = new Set([".js", ".cjs"]);

function collect(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath, files);
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

const files = SOURCE_DIRS.flatMap((directory) => collect(path.join(ROOT, directory))).sort();
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`Syntax check failed: ${path.relative(ROOT, file)}\n`);
    process.stderr.write(result.stderr || result.stdout || "");
  }
}

if (failed) process.exit(1);
process.stdout.write(`JavaScript syntax: ${files.length} files OK\n`);
