#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const WINDOWS_INVALID_FILENAME_RE = /[<>:"/\\|?*\u0000-\u001F]/;

class ValidationError extends Error {}

function parseArgs(argv) {
  const result = {
    dir: null,
    exact: false,
    referenceDir: null,
    tag: null,
    version: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--exact") {
      result.exact = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (!["--dir", "--reference-dir", "--tag", "--version"].includes(arg)) {
      throw new ValidationError(`Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ValidationError(`Missing value for ${arg}`);
    }
    const key = arg === "--reference-dir" ? "referenceDir" : arg.slice(2);
    if (result[key] !== null) {
      throw new ValidationError(`Duplicate argument: ${arg}`);
    }
    result[key] = value;
    index += 1;
  }

  if (result.exact && !result.dir) {
    throw new ValidationError("--exact requires --dir");
  }
  if (result.referenceDir && !result.dir) {
    throw new ValidationError("--reference-dir requires --dir");
  }
  if (!result.help && !result.tag && !result.dir) {
    throw new ValidationError("Provide --tag for parity validation, --dir for artifact validation, or both");
  }
  return result;
}

function printHelp() {
  console.log([
    "Usage:",
    "  node scripts/validate-release.js --tag v2.3.0",
    "  node scripts/validate-release.js --dir dist [--version 2.3.0] [--exact]",
    "    [--reference-dir path-to-locally-validated-assets]",
    "",
    "--tag validates exact v<package.version> parity.",
    "--dir validates latest.yml, installer, blockmap, size, and SHA-512.",
    "--exact rejects every file or directory except the three release assets.",
    "--reference-dir requires byte-for-byte equivalent release assets.",
    "Authenticode status is reported as metadata and is non-blocking."
  ].join("\n"));
}

function readPackageMetadata() {
  const packagePath = path.resolve(__dirname, "..", "package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (error) {
    throw new ValidationError(`Cannot read package.json: ${error.message}`);
  }

  const version = String(packageJson.version || "").trim();
  const productName = String(packageJson.productName || "").trim();
  if (!SEMVER_RE.test(version)) {
    throw new ValidationError(`package.json version is not valid SemVer: ${version || "<empty>"}`);
  }
  if (!productName) {
    throw new ValidationError("package.json productName is empty");
  }
  if (WINDOWS_INVALID_FILENAME_RE.test(productName) || /[. ]$/.test(productName)) {
    throw new ValidationError(`productName is not safe for a Windows artifact filename: ${productName}`);
  }

  return { packagePath, productName, version };
}

function decodeYamlScalar(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new ValidationError(`Invalid double-quoted YAML scalar ${value}: ${error.message}`);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function assignUnique(target, key, value, location) {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    throw new ValidationError(`Duplicate ${location} field in latest.yml: ${key}`);
  }
  target[key] = value;
}

function parseLatestYaml(text) {
  const result = { files: [] };
  let inFiles = false;
  let currentFile = null;

  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (indent === 0) {
      currentFile = null;
      const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line);
      if (!match) {
        throw new ValidationError(`Unsupported top-level latest.yml line: ${rawLine}`);
      }
      const key = match[1];
      if (key === "files") {
        inFiles = true;
      } else {
        inFiles = false;
        if (["version", "path", "sha512"].includes(key)) {
          assignUnique(result, key, decodeYamlScalar(match[2]), "top-level");
        }
      }
      continue;
    }

    if (!inFiles) continue;
    if (indent === 2) {
      const match = /^-\s+url:\s*(.+)$/.exec(line);
      if (!match) {
        throw new ValidationError(`Unsupported latest.yml files entry: ${rawLine}`);
      }
      currentFile = { url: decodeYamlScalar(match[1]) };
      result.files.push(currentFile);
      continue;
    }
    if (indent === 4 && currentFile) {
      const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/.exec(line);
      if (!match) {
        throw new ValidationError(`Unsupported latest.yml file field: ${rawLine}`);
      }
      if (["sha512", "size"].includes(match[1])) {
        assignUnique(currentFile, match[1], decodeYamlScalar(match[2]), "file");
      }
    }
  }

  return result;
}

function ensureRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new ValidationError(`${label} is missing: ${filePath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ValidationError(`${label} must be a regular file: ${filePath}`);
  }
  if (stat.size <= 0) {
    throw new ValidationError(`${label} is empty: ${filePath}`);
  }
  return stat;
}

function validateSha512(value, label) {
  const digest = String(value || "").trim();
  let decoded;
  try {
    decoded = Buffer.from(digest, "base64");
  } catch (error) {
    throw new ValidationError(`${label} is not valid base64: ${error.message}`);
  }
  if (decoded.length !== 64 || decoded.toString("base64") !== digest) {
    throw new ValidationError(`${label} is not a canonical SHA-512 base64 digest`);
  }
  return digest;
}

function sha512File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("base64")));
  });
}

function workflowEscape(value) {
  return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function inspectAuthenticode(installerPath) {
  if (process.platform !== "win32") {
    return {
      status: "Unavailable",
      warning: `Authenticode inspection requires Windows; current platform is ${process.platform}`
    };
  }

  const script = [
    "$utf8 = New-Object System.Text.UTF8Encoding($false)",
    "[Console]::OutputEncoding = $utf8",
    "$OutputEncoding = $utf8",
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:SPROUTG_SIGNATURE_FILE",
    "[pscustomobject]@{",
    "  Status = [string]$signature.Status",
    "  StatusMessage = [string]$signature.StatusMessage",
    "  SignerSubject = $(if ($null -ne $signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null })",
    "  SignerThumbprint = $(if ($null -ne $signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { $null })",
    "  TimeStamperSubject = $(if ($null -ne $signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Subject } else { $null })",
    "} | ConvertTo-Json -Compress"
  ].join("\n");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, SPROUTG_SIGNATURE_FILE: installerPath },
      maxBuffer: 1024 * 1024,
      windowsHide: true
    }
  );

  if (result.error || result.status !== 0) {
    return {
      status: "Unavailable",
      warning: `Authenticode inspection failed: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}`
    };
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    const metadata = {
      status: String(parsed.Status || "Unknown"),
      statusMessage: String(parsed.StatusMessage || ""),
      signerSubject: parsed.SignerSubject || null,
      signerThumbprint: parsed.SignerThumbprint || null,
      timeStamperSubject: parsed.TimeStamperSubject || null
    };
    if (metadata.status !== "Valid") {
      metadata.warning = `Installer Authenticode status is ${metadata.status}; signing is not enforced yet`;
    }
    return metadata;
  } catch (error) {
    return {
      status: "Unavailable",
      warning: `Cannot parse Authenticode metadata: ${error.message}`
    };
  }
}

async function validateArtifacts(args, packageMetadata) {
  const expectedVersion = args.version || packageMetadata.version;
  if (expectedVersion !== packageMetadata.version) {
    throw new ValidationError(
      `Requested version ${expectedVersion} does not match package.json ${packageMetadata.version}`
    );
  }

  const directory = path.resolve(args.dir);
  let directoryStat;
  try {
    directoryStat = fs.statSync(directory);
  } catch (error) {
    throw new ValidationError(`Artifact directory is missing: ${directory}`);
  }
  if (!directoryStat.isDirectory()) {
    throw new ValidationError(`Artifact path is not a directory: ${directory}`);
  }

  const installerName = `${packageMetadata.productName}-Setup-${expectedVersion}.exe`;
  const blockmapName = `${installerName}.blockmap`;
  const expectedNames = ["latest.yml", installerName, blockmapName].sort();

  if (args.exact) {
    const actualNames = fs.readdirSync(directory).sort();
    if (
      actualNames.length !== expectedNames.length ||
      actualNames.some((name, index) => name !== expectedNames[index])
    ) {
      throw new ValidationError(
        `Artifact directory must contain exactly ${expectedNames.join(", ")}; found ${actualNames.join(", ") || "<empty>"}`
      );
    }
  }

  const latestPath = path.join(directory, "latest.yml");
  const installerPath = path.join(directory, installerName);
  const blockmapPath = path.join(directory, blockmapName);
  const latestStat = ensureRegularFile(latestPath, "latest.yml");
  const installerStat = ensureRegularFile(installerPath, "Installer");
  const blockmapStat = ensureRegularFile(blockmapPath, "Blockmap");

  let latest;
  try {
    latest = parseLatestYaml(fs.readFileSync(latestPath, "utf8"));
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`Cannot parse latest.yml: ${error.message}`);
  }

  if (latest.version !== expectedVersion) {
    throw new ValidationError(`latest.yml version ${latest.version || "<missing>"} does not match ${expectedVersion}`);
  }
  if (latest.path !== installerName) {
    throw new ValidationError(`latest.yml path ${latest.path || "<missing>"} does not match ${installerName}`);
  }
  if (latest.files.length !== 1) {
    throw new ValidationError(`latest.yml must describe exactly one installer file; found ${latest.files.length}`);
  }

  const fileEntry = latest.files[0];
  if (fileEntry.url !== installerName) {
    throw new ValidationError(`latest.yml file URL ${fileEntry.url || "<missing>"} does not match ${installerName}`);
  }
  const declaredSize = Number(fileEntry.size);
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
    throw new ValidationError(`latest.yml installer size is invalid: ${fileEntry.size || "<missing>"}`);
  }
  if (declaredSize !== installerStat.size) {
    throw new ValidationError(
      `Installer size ${installerStat.size} does not match latest.yml ${declaredSize}`
    );
  }

  const topLevelSha512 = validateSha512(latest.sha512, "latest.yml top-level sha512");
  const fileSha512 = validateSha512(fileEntry.sha512, "latest.yml file sha512");
  if (topLevelSha512 !== fileSha512) {
    throw new ValidationError("latest.yml top-level and file SHA-512 digests differ");
  }
  const actualSha512 = await sha512File(installerPath);
  if (actualSha512 !== fileSha512) {
    throw new ValidationError("Installer SHA-512 does not match latest.yml");
  }
  const latestSha512 = await sha512File(latestPath);
  const blockmapSha512 = await sha512File(blockmapPath);

  let reference = null;
  if (args.referenceDir) {
    const referenceDirectory = path.resolve(args.referenceDir);
    let referenceStat;
    try {
      referenceStat = fs.statSync(referenceDirectory);
    } catch (error) {
      throw new ValidationError(`Reference artifact directory is missing: ${referenceDirectory}`);
    }
    if (!referenceStat.isDirectory()) {
      throw new ValidationError(`Reference artifact path is not a directory: ${referenceDirectory}`);
    }

    const comparisons = [
      { name: "latest.yml", size: latestStat.size, sha512: latestSha512 },
      { name: installerName, size: installerStat.size, sha512: actualSha512 },
      { name: blockmapName, size: blockmapStat.size, sha512: blockmapSha512 }
    ];
    for (const comparison of comparisons) {
      const referencePath = path.join(referenceDirectory, comparison.name);
      const stat = ensureRegularFile(referencePath, `Reference ${comparison.name}`);
      if (stat.size !== comparison.size) {
        throw new ValidationError(
          `${comparison.name} size ${comparison.size} does not match reference size ${stat.size}`
        );
      }
      const digest = await sha512File(referencePath);
      if (digest !== comparison.sha512) {
        throw new ValidationError(`${comparison.name} SHA-512 does not match the reference artifact`);
      }
    }
    reference = {
      artifactDirectory: referenceDirectory,
      matchedExactly: true
    };
  }

  const authenticode = inspectAuthenticode(installerPath);
  if (authenticode.warning) {
    console.warn(`[release-validator] WARNING: ${authenticode.warning}`);
    if (process.env.GITHUB_ACTIONS === "true") {
      console.log(`::warning title=Release Authenticode::${workflowEscape(authenticode.warning)}`);
    }
  } else {
    console.log(`[release-validator] Authenticode: ${authenticode.status}`);
  }

  return {
    schemaVersion: 1,
    packageVersion: packageMetadata.version,
    productName: packageMetadata.productName,
    tag: args.tag || null,
    artifactDirectory: directory,
    exactFileSet: args.exact,
    latestYml: {
      name: "latest.yml",
      size: latestStat.size,
      sha512: latestSha512,
      version: latest.version,
      path: latest.path
    },
    installer: {
      name: installerName,
      size: installerStat.size,
      sha512: actualSha512,
      authenticode
    },
    blockmap: {
      name: blockmapName,
      size: blockmapStat.size,
      sha512: blockmapSha512
    },
    reference
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const packageMetadata = readPackageMetadata();
  if (args.version && args.version !== packageMetadata.version) {
    throw new ValidationError(
      `Requested version ${args.version} does not match package.json ${packageMetadata.version}`
    );
  }
  if (args.tag) {
    const expectedTag = `v${packageMetadata.version}`;
    if (args.tag !== expectedTag) {
      throw new ValidationError(`Release tag ${args.tag} does not match package version tag ${expectedTag}`);
    }
    console.log(`[release-validator] Tag/package parity: ${args.tag}`);
  }

  let metadata = {
    schemaVersion: 1,
    packageVersion: packageMetadata.version,
    productName: packageMetadata.productName,
    tag: args.tag || null
  };
  if (args.dir) {
    metadata = await validateArtifacts(args, packageMetadata);
  }

  console.log("[release-validator] Validation passed");
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[release-validator] ERROR: ${message}`);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::error title=Release validation failed::${workflowEscape(message)}`);
  }
  process.exitCode = 1;
});
