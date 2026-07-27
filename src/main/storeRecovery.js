const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readWalSnapshot } = require('./durableWriteQueue');

function fsyncFile(filePath) {
  const handle = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function parseStoreBuffer(buffer) {
  const parsed = JSON.parse(buffer.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('electron-store root must be a JSON object');
  }
  return parsed;
}

function inspectStoreFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists:false, valid:true, error:'', bytes:null };
  }
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
    parseStoreBuffer(bytes);
    return { exists:true, valid:true, error:'', bytes };
  } catch (error) {
    return {
      exists:true,
      valid:false,
      error:error?.message || String(error),
      bytes:bytes || null
    };
  }
}

function quarantineStoreBytes({
  userDataDir,
  sourcePath,
  bytes,
  label = 'sproutg-desktop'
}) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error(`Cannot quarantine unreadable store: ${sourcePath}`);
  }
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const directory = path.join(userDataDir, 'integrity-quarantine');
  const safeLabel = String(label || 'store').replace(/[^a-z0-9._-]/gi, '_');
  const target = path.join(directory, `${safeLabel}-${digest}.corrupt.json`);
  fs.mkdirSync(directory, { recursive:true });

  if (!fs.existsSync(target)) {
    const temp = `${target}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temp, bytes, { flag:'wx' });
      fsyncFile(temp);
      fs.renameSync(temp, target);
    } finally {
      try { fs.rmSync(temp, { force:true }); } catch (_error) {}
    }
  }

  const verified = fs.readFileSync(target);
  if (!verified.equals(bytes)) {
    throw new Error(`Store quarantine byte verification failed: ${target}`);
  }
  return { path:target, sha256:digest, size:bytes.length };
}

function selectRecoveryStore(userDataDir, baseName, quarantines) {
  for (let index = 1; index <= 32; index += 1) {
    const name = index === 1
      ? `${baseName}-recovery`
      : `${baseName}-recovery-${index}`;
    const filePath = path.join(userDataDir, `${name}.json`);
    const inspected = inspectStoreFile(filePath);
    if (inspected.valid) return { name, path:filePath };
    quarantines.push(quarantineStoreBytes({
      userDataDir,
      sourcePath:filePath,
      bytes:inspected.bytes,
      label:name
    }));
  }
  throw new Error('No safe recovery electron-store slot is available');
}

function prepareStoreBootstrap({
  userDataDir,
  baseName = 'sproutg-desktop',
  walPath
} = {}) {
  const rawRoot = String(userDataDir || '').trim();
  if (!rawRoot) throw new Error('Electron userData directory is unavailable');
  const root = path.resolve(rawRoot);
  const primaryPath = path.join(root, `${baseName}.json`);
  const primary = inspectStoreFile(primaryPath);
  if (primary.valid) {
    return {
      storeName:baseName,
      storePath:primaryPath,
      walPath:String(walPath || ''),
      integrity: {
        active:false,
        code:'',
        message:'',
        primaryPath,
        quarantines:[],
        walValid:false,
        sheetWritesBlocked:false,
        heroSmsBlocked:false
      }
    };
  }

  const quarantines = [quarantineStoreBytes({
    userDataDir:root,
    sourcePath:primaryPath,
    bytes:primary.bytes,
    label:baseName
  })];
  const recovery = selectRecoveryStore(root, baseName, quarantines);
  const wal = readWalSnapshot(walPath);
  const walValid = !!wal.snapshot;
  const message = walValid
    ? 'Основное локальное хранилище повреждено и сохранено в карантин. Очередь Google Таблицы восстановлена из проверенного WAL; операции HeroSMS заблокированы.'
    : 'Основное локальное хранилище повреждено и сохранено в карантин. Проверенный WAL не найден; новые записи в Google Таблицу и операции HeroSMS заблокированы.';

  return {
    storeName:recovery.name,
    storePath:recovery.path,
    walPath:String(walPath || ''),
    integrity: {
      active:true,
      code:'LOCAL_STORE_CORRUPT',
      message,
      primaryPath,
      recoveryPath:recovery.path,
      quarantines,
      walValid,
      walError:String(wal.error || ''),
      sheetWritesBlocked:!walValid,
      heroSmsBlocked:true
    }
  };
}

module.exports = {
  inspectStoreFile,
  parseStoreBuffer,
  prepareStoreBootstrap,
  quarantineStoreBytes
};
