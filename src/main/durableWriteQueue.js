const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_KEY = 'pendingWrites';
const BACKUP_STORE_KEY = 'pendingWritesBackup';
const SNAPSHOT_STORE_KEY = 'pendingWritesSnapshot';
const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_COMPLETED_IDS = 5000;
const MAX_CONFIRMED_WRITES = 256;
const MAX_BATCH_SIZE = 80;
const MAX_CELL_GROUPS_PER_BATCH = 4;
const MAX_DIRECT_BATCH_SIZE = 8;
const CELL_BATCH_TIMEOUT_MS = 70000;
const DEFAULT_ACK_AFTER_MS = 400;
const MIN_WRITE_BRIDGE_VERSION = '2.3.0';

function versionAtLeast(value, wanted) {
  const parse = (input) => {
    const match = String(input || '').match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
  };
  const left = parse(value);
  const right = parse(wanted);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function snapshotPayload(envelope) {
  return {
    schemaVersion:Number(envelope?.schemaVersion || 0),
    revision:Number(envelope?.revision || 0),
    writtenAt:Number(envelope?.writtenAt || 0),
    completedIds:Array.isArray(envelope?.completedIds) ? envelope.completedIds : [],
    items:Array.isArray(envelope?.items) ? envelope.items : []
  };
}

function snapshotChecksum(envelope) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(snapshotPayload(envelope)))
    .digest('hex');
}

function validateWalSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const payload = snapshotPayload(raw);
  if (
    payload.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    || !Number.isSafeInteger(payload.revision)
    || payload.revision < 1
    || !Array.isArray(payload.completedIds)
    || !Array.isArray(payload.items)
    || !/^[a-f0-9]{64}$/i.test(String(raw.checksum || ''))
    || snapshotChecksum(payload) !== String(raw.checksum).toLowerCase()
  ) {
    return null;
  }
  return payload;
}

function readWalSnapshot(walPath) {
  const target = String(walPath || '').trim();
  if (!target) return { snapshot:null, error:'' };
  const candidates = [target, `${target}.bak`];
  const errors = [];
  let best = null;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const snapshot = validateWalSnapshot(parsed);
      if (!snapshot) {
        errors.push(`${path.basename(candidate)}: checksum/schema mismatch`);
        continue;
      }
      if (!best || snapshot.revision > best.revision) best = snapshot;
    } catch (error) {
      errors.push(`${path.basename(candidate)}: ${error?.message || error}`);
    }
  }
  return { snapshot:best, error:errors.join('; ') };
}

function fsyncFile(filePath) {
  // Windows requires a writable file handle for FlushFileBuffers.
  const handle = fs.openSync(filePath, 'r+');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function replaceFile(source, target) {
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (process.platform !== 'win32' || !fs.existsSync(target)) throw error;
    fs.rmSync(target, { force:true });
    fs.renameSync(source, target);
  }
}

function writeWalSnapshot(walPath, envelope) {
  const target = String(walPath || '').trim();
  if (!target) return;
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive:true });
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const temp = `${target}.${suffix}.tmp`;
  const backup = `${target}.bak`;
  const backupTemp = `${backup}.${suffix}.tmp`;
  const payload = snapshotPayload(envelope);
  const serialized = JSON.stringify({ ...payload, checksum:snapshotChecksum(payload) });
  try {
    fs.writeFileSync(temp, serialized, { encoding:'utf8', flag:'wx' });
    fsyncFile(temp);
    if (fs.existsSync(target)) {
      let currentIsValid = false;
      try {
        currentIsValid = !!validateWalSnapshot(JSON.parse(fs.readFileSync(target, 'utf8')));
      } catch (_error) {}
      if (currentIsValid) {
        fs.copyFileSync(target, backupTemp);
        fsyncFile(backupTemp);
        replaceFile(backupTemp, backup);
      }
    }
    replaceFile(temp, target);
  } finally {
    try { fs.rmSync(temp, { force:true }); } catch (_error) {}
    try { fs.rmSync(backupTemp, { force:true }); } catch (_error) {}
  }
}

function blockedArchivePayload(raw) {
  return {
    schemaVersion:1,
    createdAt:String(raw?.createdAt || ''),
    items:Array.isArray(raw?.items) ? raw.items : []
  };
}

function blockedArchiveChecksum(raw) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(blockedArchivePayload(raw)))
    .digest('hex');
}

function validateBlockedArchive(raw) {
  const payload = blockedArchivePayload(raw);
  if (
    payload.schemaVersion !== 1
    || !payload.createdAt
    || !payload.items.length
    || !/^[a-f0-9]{64}$/i.test(String(raw?.checksum || ''))
    || blockedArchiveChecksum(payload) !== String(raw.checksum).toLowerCase()
  ) return null;
  return payload;
}

function writeBlockedArchive(directory, items, now = new Date()) {
  const root = String(directory || '').trim();
  if (!root) throw new Error('Blocked-write archive directory is unavailable');
  const list = JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
  if (!list.length) throw new Error('No blocked writes to archive');
  fs.mkdirSync(root, { recursive:true });
  const createdAt = new Date(now).toISOString();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const archiveId = crypto.randomBytes(8).toString('hex');
  const target = path.join(root, `${stamp}-${archiveId}-blocked-writes.json`);
  const temp = `${target}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  const payload = { schemaVersion:1, createdAt, items:list };
  const serialized = JSON.stringify({
    ...payload,
    checksum:blockedArchiveChecksum(payload)
  }, null, 2);
  try {
    fs.writeFileSync(temp, serialized, { encoding:'utf8', flag:'wx' });
    fsyncFile(temp);
    replaceFile(temp, target);
    const verified = fs.readFileSync(target, 'utf8');
    if (verified !== serialized || !validateBlockedArchive(JSON.parse(verified))) {
      throw new Error('Blocked-write archive verification failed');
    }
    return target;
  } finally {
    try { fs.rmSync(temp, { force:true }); } catch (_error) {}
  }
}

const ACTION_SPECS = new Map([
  ['o1.updateCells', {
    kind: 'cells',
    batchAction: 'o1.updateCellsBatch',
    ackAfterMs: 180
  }],
  ['mcc.updateCells', {
    kind: 'cells',
    batchAction: 'mcc.updateCellsBatch',
    ackAfterMs: 180
  }],
  ['pass.updateCell', {
    kind: 'direct',
    coalesce: true,
    ackAfterMs: 1500,
    target: (payload) => passTarget(payload)
  }],
  ['o1.toggleDeleted', {
    kind: 'direct',
    coalesce: true,
    ackAfterMs: 400,
    target: (payload) => identityTarget('o1-deleted', payload)
  }],
  ['o1.setNumber', {
    kind: 'direct',
    coalesce: true,
    ackAfterMs: 400,
    target: (payload) => identityTarget('o1-number', payload, [payload?.group])
  }],
  ['mcc.setUnderReviewBg', {
    kind: 'direct',
    coalesce: true,
    ackAfterMs: 600,
    target: (payload) => identityTarget('mcc-review', payload)
  }],
  ['mcc.updateProfileName', {
    kind: 'direct',
    ackAfterMs: 2000,
    target: (payload) => encodeTarget('mcc-rename', [payload?.oldProfileName])
  }],
  ['mcc.toggleProfileDeleted', {
    kind: 'direct',
    coalesce: true,
    ackAfterMs: 600,
    target: (payload) => encodeTarget('mcc-profile-deleted', [payload?.profileName])
  }],
  ['mcc.toggleAccountDeleted', {
    kind: 'direct',
    coalesce: true,
    ackAfterMs: 400,
    target: (payload) => identityTarget('mcc-account-deleted', payload)
  }],
  ['company.addRow', {
    kind: 'direct',
    ackAfterMs: 1500,
    target: (payload) => encodeTarget('company', [payload?.values?.[0]])
  }]
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return null;
  const out = {};
  for (const [rawCol, value] of Object.entries(updates)) {
    const col = String(rawCol || '').trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(col)) return null;
    if (value == null) {
      out[col] = '';
    } else if (
      typeof value === 'string'
      || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))
    ) {
      out[col] = value;
    } else {
      return null;
    }
  }
  return out;
}

function cleanIdentity(identity) {
  const raw = identity && typeof identity === 'object' ? identity : {};
  return {
    profileName: String(raw.profileName || raw.profile || '').trim(),
    accountName: String(raw.accountName || raw.account || '').trim()
  };
}

function encodeTarget(prefix, values) {
  const parts = (Array.isArray(values) ? values : [values])
    .map((value) => String(value ?? '').trim());
  return `${String(prefix || '').trim()}:${JSON.stringify(parts)}`;
}

function identityTarget(prefix, payload, extra = []) {
  const identity = cleanIdentity(payload?.identity);
  const suffix = Array.isArray(extra) ? extra : [extra];
  const profile = identity.profileName;
  const account = identity.accountName;
  if (profile) return encodeTarget(`${prefix}:identity`, [profile, account, ...suffix]);
  const row = Number(payload?.row) || String(payload?.row || '');
  return encodeTarget(`${prefix}:row`, [row, ...suffix]);
}

function passTarget(payload) {
  const col = String(payload?.col || '').trim().toUpperCase();
  const identity = payload?.identity;
  const row = Number(payload?.row) || String(payload?.row || '');
  if (
    identity
    && typeof identity === 'object'
    && Object.prototype.hasOwnProperty.call(identity, 'expectedValue')
  ) {
    return encodeTarget('pass:expected', [col, identity.expectedValue]);
  }
  return encodeTarget('pass:row', [row, col]);
}

function targetKey(action, payload) {
  const spec = ACTION_SPECS.get(action);
  if (spec?.kind === 'cells') return identityTarget(action, payload);
  if (typeof spec?.target === 'function') return spec.target(payload);
  return `${action}:${JSON.stringify(payload || {})}`;
}

function serverIdentityKey(action, payload) {
  const identity = cleanIdentity(payload?.identity);
  const profile = identity.profileName;
  if (!profile) return '';
  const account = identity.accountName;
  return encodeTarget('server-identity', [action, profile, account]);
}

function partitionServerSafeGroups(action, groups, maxGroups = MAX_CELL_GROUPS_PER_BATCH) {
  const batches = [];
  let current = [];
  let identities = new Set();
  const batchLimit = Math.max(1, Number(maxGroups) || MAX_CELL_GROUPS_PER_BATCH);
  for (const group of groups) {
    const identityKey = serverIdentityKey(action, group.payload);
    if (
      current.length
      && (
        current.length >= batchLimit
        || (identityKey && identities.has(identityKey))
      )
    ) {
      batches.push(current);
      current = [];
      identities = new Set();
    }
    current.push(group);
    if (identityKey) identities.add(identityKey);
  }
  if (current.length) batches.push(current);
  return batches;
}

function referencedMccProfile(item) {
  if (!item || typeof item !== 'object') return '';
  const action = String(item.action || '');
  if (
    action === 'mcc.updateCells'
    || action === 'mcc.setUnderReviewBg'
    || action === 'mcc.toggleAccountDeleted'
  ) {
    return cleanIdentity(item.payload?.identity).profileName;
  }
  if (action === 'mcc.toggleProfileDeleted') {
    return String(item.payload?.profileName || '').trim();
  }
  if (action === 'mcc.updateProfileName') {
    return String(item.payload?.oldProfileName || '').trim();
  }
  return '';
}

function passCausalPredecessor(candidate, item) {
  if (
    candidate?.action !== 'pass.updateCell'
    || item?.action !== 'pass.updateCell'
  ) return false;
  const candidateCol = String(candidate.payload?.col || '').trim().toUpperCase();
  const itemCol = String(item.payload?.col || '').trim().toUpperCase();
  const candidateValue = String(candidate.payload?.value ?? '').trim();
  const itemExpected = String(item.payload?.identity?.expectedValue ?? '').trim();
  return !!candidateCol && candidateCol === itemCol && candidateValue === itemExpected;
}

function chainPassExpectedValue(item, pendingItems) {
  if (item?.action !== 'pass.updateCell') return;
  let expected = String(item.payload?.identity?.expectedValue ?? '').trim();
  const candidates = Array.from(pendingItems || [])
    .filter((candidate) => (
      candidate?.action === 'pass.updateCell'
      && Number(candidate.seq || 0) < Number(item.seq || 0)
      && String(candidate.payload?.col || '').trim().toUpperCase()
        === String(item.payload?.col || '').trim().toUpperCase()
    ))
    .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  for (const candidate of candidates) {
    const candidateExpected = String(candidate.payload?.identity?.expectedValue ?? '').trim();
    if (candidateExpected !== expected) continue;
    expected = String(candidate.payload?.value ?? '').trim();
  }
  item.payload.identity.expectedValue = expected;
}

function hasPendingRenameDependency(item, pendingItems) {
  return Array.from(pendingItems || []).some((candidate) => (
    isCausalPredecessor(candidate, item)
  ));
}

function isCausalPredecessor(candidate, item) {
  if (
    !candidate
    || !item
    || candidate.id === item.id
    || Number(candidate.seq || 0) >= Number(item.seq || 0)
  ) return false;
  if (passCausalPredecessor(candidate, item)) return true;
  const profileName = referencedMccProfile(item);
  if (!profileName) return false;
  if (
    candidate.action === 'mcc.updateProfileName'
    && String(candidate.payload?.value || '').trim() === profileName
  ) return true;
  if (item.action !== 'mcc.updateProfileName') return false;
  const oldProfileName = String(item.payload?.oldProfileName || '').trim();
  return !!oldProfileName && referencedMccProfile(candidate) === oldProfileName;
}

function causalDescendantIds(seedIds, pendingItems) {
  const selected = new Set(Array.from(seedIds || []).map(String).filter(Boolean));
  const ordered = Array.from(pendingItems || [])
    .filter(Boolean)
    .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of ordered) {
      if (selected.has(String(item.id || ''))) continue;
      if (ordered.some((candidate) => (
        selected.has(String(candidate.id || ''))
        && isCausalPredecessor(candidate, item)
      ))) {
        selected.add(String(item.id || ''));
        changed = true;
      }
    }
  }
  return selected;
}

function dependencyBlockedIds(pendingItems) {
  const items = Array.from(pendingItems || []);
  const blockedIds = new Set(
    items.filter((item) => item?.blocked).map((item) => String(item.id || ''))
  );
  const closure = causalDescendantIds(blockedIds, items);
  for (const id of blockedIds) closure.delete(id);
  return closure;
}

function dependencyReadyAt(item, pendingItems) {
  let readyAt = Number(item?.nextAttemptAt || 0);
  const profileName = referencedMccProfile(item);
  for (const candidate of Array.from(pendingItems || [])) {
    if (
      candidate
      && candidate.id !== item.id
      && Number(candidate.seq || 0) < Number(item.seq || 0)
    ) {
      if (passCausalPredecessor(candidate, item)) {
        if (candidate.blocked) return Infinity;
        readyAt = Math.max(readyAt, Number(candidate.nextAttemptAt || 0));
        continue;
      }
      if (!profileName) continue;
      const renameToProfile = candidate.action === 'mcc.updateProfileName'
        && String(candidate.payload?.value || '').trim() === profileName;
      const earlierOldProfileMutation = item.action === 'mcc.updateProfileName'
        && referencedMccProfile(candidate) === String(item.payload?.oldProfileName || '').trim();
      if (renameToProfile || earlierOldProfileMutation) {
        if (candidate.blocked) return Infinity;
        readyAt = Math.max(readyAt, Number(candidate.nextAttemptAt || 0));
      }
    }
  }
  return readyAt;
}

function normalizeEndpointKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  } catch (_error) {
    return raw.replace(/\/+$/, '');
  }
}

function normalizeDirectPayload(action, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  let cloned;
  try {
    cloned = cloneJson(payload);
  } catch (_error) {
    return null;
  }

  switch (action) {
    case 'pass.updateCell': {
      const row = Number(cloned.row);
      const col = String(cloned.col || '').trim().toUpperCase();
      const identity = cloned.identity && typeof cloned.identity === 'object'
        ? cloned.identity
        : null;
      if (
        !Number.isSafeInteger(row)
        || row < 1
        || !/^[A-Z]{1,3}$/.test(col)
        || !identity
        || !Object.prototype.hasOwnProperty.call(identity, 'expectedValue')
      ) {
        return null;
      }
      return {
        row,
        col,
        value: String(cloned.value ?? '').trim(),
        identity: { expectedValue: String(identity.expectedValue ?? '').trim() }
      };
    }
    case 'o1.toggleDeleted':
    case 'mcc.toggleAccountDeleted': {
      const row = Number(cloned.row);
      if (!Number.isSafeInteger(row) || row < 2) return null;
      if (typeof cloned.enabled !== 'boolean') return null;
      cloned.row = row;
      cloned.identity = cleanIdentity(cloned.identity);
      if (
        !cloned.identity.profileName
        || (action === 'mcc.toggleAccountDeleted' && !cloned.identity.accountName)
      ) return null;
      cloned.enabled = !!cloned.enabled;
      return cloned;
    }
    case 'o1.setNumber': {
      const row = Number(cloned.row);
      const group = String(cloned.group || cloned.groupName || '').trim();
      if (!Number.isSafeInteger(row) || row < 2 || !group || typeof cloned.enabled !== 'boolean') return null;
      cloned.row = row;
      cloned.group = group;
      cloned.enabled = !!cloned.enabled;
      cloned.identity = cleanIdentity(cloned.identity);
      if (!cloned.identity.profileName) return null;
      return cloned;
    }
    case 'mcc.setUnderReviewBg': {
      const row = Number(cloned.row);
      if (!Number.isSafeInteger(row) || row < 2) return null;
      cloned.row = row;
      cloned.identity = cleanIdentity(cloned.identity);
      if (!cloned.identity.profileName || !cloned.identity.accountName) return null;
      return cloned;
    }
    case 'mcc.updateProfileName': {
      const rows = Array.isArray(cloned.rows)
        ? Array.from(new Set(cloned.rows.map(Number).filter((row) => Number.isSafeInteger(row) && row >= 2)))
        : [];
      const value = String(cloned.value || cloned.profileName || '').trim();
      const oldProfileName = String(cloned.oldProfileName || '').trim();
      if (!rows.length || !value || !oldProfileName) return null;
      return { rows, value, oldProfileName };
    }
    case 'mcc.toggleProfileDeleted': {
      const profileName = String(cloned.profileName || cloned.name || '').trim();
      if (!profileName || typeof cloned.enabled !== 'boolean') return null;
      return { profileName, enabled: cloned.enabled };
    }
    case 'company.addRow': {
      const values = Array.isArray(cloned.values) ? cloned.values.map((value) => String(value ?? '').trim()) : [];
      if (values.length !== 6 || values.some((value) => !value)) return null;
      if (!/^EE\d{9}$/.test(values[4]) || !/^\d{9}$/.test(values[5])) return null;
      return { values };
    }
    default:
      return cloned;
  }
}

function normalizeStoredItem(raw, fallbackEndpointKey = '') {
  const action = String(raw?.action || '').trim();
  const spec = ACTION_SPECS.get(action);
  if (!spec) return null;

  let payload;
  if (spec.kind === 'cells') {
    const row = Number(raw?.payload?.row);
    const updates = cleanUpdates(raw?.payload?.updates || raw?.payload?.cells);
    if (!Number.isSafeInteger(row) || row < 2 || !updates || !Object.keys(updates).length) return null;
    payload = {
      row,
      updates,
      identity: cleanIdentity(raw?.payload?.identity)
    };
    if (
      !payload.identity.profileName
      || (action === 'mcc.updateCells' && !payload.identity.accountName)
    ) return null;
  } else {
    payload = normalizeDirectPayload(action, raw?.payload);
    if (!payload) return null;
  }

  const seq = Number(raw?.seq || 0) || Date.now();
  return {
    id: String(raw?.id || `restored-${seq}-${Math.random().toString(36).slice(2, 8)}`),
    action,
    kind: spec.kind,
    payload,
    endpointKey: normalizeEndpointKey(raw?.endpointKey || fallbackEndpointKey),
    seq,
    createdAt: Number(raw?.createdAt || Date.now()),
    attempts: Math.max(0, Number(raw?.attempts || 0)),
    nextAttemptAt: Math.max(0, Number(raw?.nextAttemptAt || 0)),
    lastError: String(raw?.lastError || ''),
    lastErrorCode: String(raw?.lastErrorCode || ''),
    blocked: !!raw?.blocked
  };
}

function durableAck(item, extra = {}) {
  const result = {
    ok: true,
    queued: true,
    durable: true,
    writeId: item.id,
    action: item.action,
    ...extra
  };
  if (item.kind === 'cells') result.applied = { ...item.payload.updates };
  if (item.action === 'o1.toggleDeleted' || item.action === 'mcc.toggleProfileDeleted' || item.action === 'mcc.toggleAccountDeleted') {
    result.isDeleted = !!item.payload.enabled;
  }
  if (item.action === 'o1.setNumber') result.active = !!item.payload.enabled;
  return result;
}

function confirmationTarget(item) {
  const action = String(item?.action || '');
  const payload = item?.payload || {};
  if (action === 'mcc.updateProfileName') {
    return {
      profileName:String(payload.value || '').trim(),
      oldProfileName:String(payload.oldProfileName || '').trim()
    };
  }
  if (action.startsWith('mcc.')) {
    return {
      profileName:String(
        payload.identity?.profileName
        || payload.profileName
        || ''
      ).trim(),
      accountName:String(payload.identity?.accountName || '').trim()
    };
  }
  if (action.startsWith('o1.')) {
    return {
      profileName:String(payload.identity?.profileName || '').trim(),
      row:Number(payload.row) || payload.row || ''
    };
  }
  if (action === 'pass.updateCell') {
    return {
      col:String(payload.col || '').trim().toUpperCase(),
      value:String(payload.value ?? ''),
      expectedValue:String(payload.identity?.expectedValue ?? '')
    };
  }
  return {};
}

const PERMANENT_FAILURE_CODES = new Set([
  'BAD_ROW',
  'BAD_COL',
  'BAD_DATE',
  'BAD_WRITE',
  'VALIDATION_FAILED',
  'NO_UPDATES',
  'SHEET_EMPTY',
  'IDENTITY_COLUMN_PROTECTED',
  'COMPANY_CONFLICT',
  'COMPANY_SHEET_FULL',
  'COMPANY_TARGET_OCCUPIED',
  'PASS_WRITE_SUPERSEDED_EXTERNALLY',
  'PASS_WRITE_ID_CONFLICT',
  'PASS_WRITE_OUTCOME_UNCERTAIN',
  'MCC_RENAME_TARGET_EXISTS',
  'MCC_RENAME_WRITE_ID_CONFLICT',
  'MCC_RENAME_OUTCOME_UNCERTAIN',
  'PARTIAL_WRITE'
]);

function isPermanentFailure(message, code) {
  const normalizedCode = String(code || '').toUpperCase().trim();
  if (
    PERMANENT_FAILURE_CODES.has(normalizedCode)
    || /(?:^|_)(?:IDENTITY_(?:NOT_FOUND|AMBIGUOUS|REQUIRED)|NOT_FOUND|AMBIGUOUS|CONFLICT|REQUIRED)$/.test(normalizedCode)
  ) return true;
  const text = String(message || '').toLowerCase();
  return [
    'bad row',
    'bad col',
    'bad date',
    'not found',
    'duplicate',
    'дубли',
    'не найден',
    'некоррект',
    'unknown action',
    'no updates'
  ].some((part) => text.includes(part));
}

class DurableWriteQueue {
  constructor({
    bridgeManager,
    store,
    getEndpointKey,
    onState,
    walPath,
    blockedArchiveDir,
    startupWriteBlock
  } = {}) {
    this.bridgeManager = bridgeManager;
    this.store = store;
    this.walPath = String(walPath || '').trim();
    this.blockedArchiveDir = String(
      blockedArchiveDir
      || (this.walPath
        ? path.join(path.dirname(this.walPath), 'blocked-write-archives')
        : '')
    ).trim();
    this.getEndpointKey = typeof getEndpointKey === 'function'
      ? getEndpointKey
      : () => bridgeManager?.getEndpointKey?.() || bridgeManager?.url || '';
    this.onState = typeof onState === 'function' ? onState : () => {};
    this.pending = new Map();
    this.waiters = new Map();
    this.inflight = new Set();
    this.seq = Date.now();
    this.timer = null;
    this.flushing = false;
    this.lastAppliedAt = 0;
    this.lastPersistError = '';
    this.snapshotRevision = 0;
    this.completedIds = new Set();
    this.confirmationRevision = 0;
    this.confirmedWrites = [];
    this.persistenceDirty = false;
    this.restoreError = '';
    this.externalIntegrityBlock = startupWriteBlock
      ? {
          code:String(startupWriteBlock.code || 'LOCAL_STORE_INTEGRITY_BLOCKED'),
          error:String(
            startupWriteBlock.message
            || startupWriteBlock.error
            || 'Локальное хранилище требует безопасного восстановления'
          )
        }
      : null;
    this.quarantinedRecords = [];
    this.handleBridgeState = () => {
      if (
        !this.externalIntegrityBlock
        && this.pending.size
        && this.isBridgeWriteCompatible()
      ) this.schedule(0);
    };
    if (typeof this.bridgeManager?.on === 'function') {
      this.bridgeManager.on('state', this.handleBridgeState);
    }

    const endpointKey = this.currentEndpointKey();
    let primary = [];
    let backup = [];
    let snapshot = null;
    let electronRestoreError = '';
    try {
      const storedPrimary = store?.get(STORE_KEY);
      const storedBackup = store?.get(BACKUP_STORE_KEY);
      const storedSnapshot = store?.get(SNAPSHOT_STORE_KEY);
      primary = Array.isArray(storedPrimary) ? storedPrimary : [];
      backup = Array.isArray(storedBackup) ? storedBackup : [];
      if (
        storedSnapshot
        && Number(storedSnapshot.schemaVersion) === SNAPSHOT_SCHEMA_VERSION
        && Number(storedSnapshot.revision) >= 1
        && Array.isArray(storedSnapshot.items)
        && Array.isArray(storedSnapshot.completedIds)
      ) {
        const hasChecksum = Object.prototype.hasOwnProperty.call(storedSnapshot, 'checksum');
        const validatedSnapshot = hasChecksum ? validateWalSnapshot(storedSnapshot) : null;
        if (hasChecksum && !validatedSnapshot) {
          electronRestoreError = 'Повреждена контрольная сумма снимка надёжной очереди';
        } else {
          snapshot = validatedSnapshot || snapshotPayload(storedSnapshot);
        }
      } else if (storedSnapshot && Number(storedSnapshot.revision) >= 1) {
        electronRestoreError = 'Повреждён или несовместим снимок надёжной очереди';
      }
    } catch (error) {
      electronRestoreError = `Не удалось прочитать надёжную очередь: ${error?.message || error}`;
    }

    const wal = readWalSnapshot(this.walPath);
    if (wal.snapshot) {
      if (!snapshot || wal.snapshot.revision > snapshot.revision) {
        snapshot = wal.snapshot;
      } else if (snapshot.revision > wal.snapshot.revision) {
        this.restoreError = 'Снимок надёжной очереди новее WAL; автоматическое восстановление остановлено';
      } else if (
        wal.snapshot.revision === snapshot.revision
        && JSON.stringify(snapshotPayload(wal.snapshot)) !== JSON.stringify(snapshotPayload(snapshot))
      ) {
        this.restoreError = 'Основной снимок и WAL надёжной очереди расходятся';
      }
      if (electronRestoreError) this.lastPersistError = electronRestoreError;
    } else if (electronRestoreError) {
      this.restoreError = electronRestoreError;
      this.lastPersistError = electronRestoreError;
    } else if (wal.error && !snapshot && !primary.length && !backup.length) {
      this.restoreError = `Не удалось прочитать WAL надёжной очереди: ${wal.error}`;
      this.lastPersistError = this.restoreError;
    } else if (wal.error) {
      this.lastPersistError = `WAL будет восстановлен: ${wal.error}`;
    }

    if (snapshot) {
      this.snapshotRevision = Number(snapshot.revision);
      for (const id of snapshot.completedIds.slice(-MAX_COMPLETED_IDS)) {
        if (id) this.completedIds.add(String(id));
      }
    }
    const restoredById = new Map();
    const authoritative = snapshot ? snapshot.items : [...backup, ...primary];
    for (const raw of authoritative) {
      const item = normalizeStoredItem(raw, endpointKey);
      if (!item) {
        this.quarantinedRecords.push(cloneJson(raw));
        continue;
      }
      const previous = restoredById.get(item.id);
      if (!previous || item.seq >= previous.seq) restoredById.set(item.id, item);
    }
    if (snapshot) {
      // v2.2.2 does not know the snapshot key. If a user temporarily rolls
      // back and creates new writes, import their unknown IDs on the next
      // v2.3.0 start without reviving IDs already confirmed by v2.3.0.
      for (const raw of [...backup, ...primary]) {
        const rawId = String(raw?.id || '');
        if (rawId && this.completedIds.has(rawId)) continue;
        const item = normalizeStoredItem(raw, endpointKey);
        if (!item) {
          this.quarantinedRecords.push(cloneJson(raw));
          continue;
        }
        if (restoredById.has(item.id)) continue;
        restoredById.set(item.id, item);
      }
    }
    if (this.quarantinedRecords.length) {
      this.restoreError = `В очереди найдено неподдерживаемых записей: ${this.quarantinedRecords.length}`;
    }
    for (const item of restoredById.values()) {
      this.pending.set(item.id, item);
      this.completedIds.delete(item.id);
      this.seq = Math.max(this.seq, item.seq);
    }
    if (!this.restoreError && !this.externalIntegrityBlock) {
      try {
        this.persist();
      } catch (error) {
        this.lastPersistError = error?.message || String(error);
        this.emitState();
      }
    } else {
      this.emitState();
    }
    if (this.pending.size && !this.restoreError && !this.externalIntegrityBlock) {
      this.schedule(1200);
    }
  }

  currentEndpointKey() {
    try {
      return normalizeEndpointKey(this.getEndpointKey());
    } catch (_error) {
      return '';
    }
  }

  supports(action) {
    return ACTION_SPECS.has(String(action || '').trim());
  }

  bridgeWriteState() {
    let state = null;
    try {
      state = this.bridgeManager?.getState?.() || null;
    } catch (_error) {}
    return {
      ready: state?.ready === true || this.bridgeManager?.ready === true,
      version: String(state?.bridgeVersion || this.bridgeManager?.bridgeVersion || '')
    };
  }

  isBridgeWriteCompatible() {
    const state = this.bridgeWriteState();
    return state.ready && versionAtLeast(state.version, MIN_WRITE_BRIDGE_VERSION);
  }

  enqueue(action, payload = {}) {
    if (this.externalIntegrityBlock) {
      return Promise.resolve({
        ok:false,
        error:this.externalIntegrityBlock.error,
        code:this.externalIntegrityBlock.code
      });
    }
    if (this.restoreError) {
      return Promise.resolve({
        ok: false,
        error: this.restoreError,
        code: 'WRITE_QUEUE_INTEGRITY_BLOCKED'
      });
    }
    if (this.persistenceDirty) {
      try {
        this.persist();
      } catch (error) {
        this.lastPersistError = error?.message || String(error);
        this.schedule(1000);
        this.emitState();
        return Promise.resolve({
          ok:false,
          error:`Локальная очередь ещё не записана на диск: ${this.lastPersistError}`,
          code:'WRITE_PERSIST_FAILED'
        });
      }
    }
    const endpointKey = this.currentEndpointKey();
    const normalized = normalizeStoredItem({
      id: `write-${Date.now()}-${++this.seq}`,
      action,
      payload,
      endpointKey,
      seq: this.seq,
      createdAt: Date.now()
    }, endpointKey);
    if (!normalized) {
      return Promise.resolve({
        ok: false,
        error: 'Некорректные данные для сохранения',
        code: 'BAD_WRITE'
      });
    }
    if (!endpointKey) {
      return Promise.resolve({
        ok: false,
        error: 'Не задан URL Apps Script; запись не может быть привязана к таблице',
        code: 'MISSING_WRITE_ENDPOINT'
      });
    }

    chainPassExpectedValue(normalized, this.pending.values());
    const superseded = this.removeSuperseded(normalized);
    this.pending.set(normalized.id, normalized);
    this.completedIds.delete(normalized.id);
    try {
      this.persist();
    } catch (error) {
      this.lastPersistError = error?.message || String(error);
      this.schedule(1000);
      this.emitState();
      return Promise.resolve({
        ok: false,
        error: `Не удалось надёжно сохранить локальную очередь: ${this.lastPersistError}`,
        code: 'WRITE_PERSIST_FAILED'
      });
    }

    for (const id of superseded) {
      this.resolveWaiter(id, { ok: true, superseded: true, applied: {} });
    }
    this.schedule(35);

    return new Promise((resolve) => {
      const spec = ACTION_SPECS.get(normalized.action);
      const ackAfterMs = Math.max(0, Number(spec?.ackAfterMs ?? DEFAULT_ACK_AFTER_MS));
      const timer = setTimeout(() => {
        this.resolveWaiter(normalized.id, durableAck(normalized));
      }, ackAfterMs);
      this.waiters.set(normalized.id, { resolve, timer });
    });
  }

  removeSuperseded(newItem) {
    const superseded = [];
    const newKey = targetKey(newItem.action, newItem.payload);
    const newSpec = ACTION_SPECS.get(newItem.action);
    for (const oldItem of this.pending.values()) {
      if (this.inflight.has(oldItem.id)) continue;
      if (oldItem.action !== newItem.action) continue;
      if (targetKey(oldItem.action, oldItem.payload) !== newKey) continue;

      if (newSpec?.kind === 'cells') {
        for (const col of Object.keys(newItem.payload.updates)) delete oldItem.payload.updates[col];
        if (Object.keys(oldItem.payload.updates).length) continue;
      } else if (!newSpec?.coalesce) {
        continue;
      }

      this.pending.delete(oldItem.id);
      this.markCompletedId(oldItem.id);
      superseded.push(oldItem.id);
    }
    return superseded;
  }

  shouldRetryAfterFailure(item) {
    if (item.kind !== 'cells') {
      const spec = ACTION_SPECS.get(item.action);
      if (!spec?.coalesce) return true;
      const itemKey = targetKey(item.action, item.payload);
      return !Array.from(this.pending.values()).some((newer) => (
        newer.id !== item.id
        && newer.seq > item.seq
        && newer.action === item.action
        && targetKey(newer.action, newer.payload) === itemKey
      ));
    }
    const itemKey = targetKey(item.action, item.payload);
    for (const newer of this.pending.values()) {
      if (newer.id === item.id || newer.seq <= item.seq) continue;
      if (targetKey(newer.action, newer.payload) !== itemKey) continue;
      for (const col of Object.keys(newer.payload.updates)) delete item.payload.updates[col];
    }
    return Object.keys(item.payload.updates).length > 0;
  }

  schedule(delayMs = 50) {
    if (this.externalIntegrityBlock) return;
    if (this.timer || this.flushing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, Math.max(0, Number(delayMs || 0)));
  }

  async flush() {
    if (this.flushing || this.restoreError || this.externalIntegrityBlock) {
      this.emitState();
      return;
    }
    if (this.persistenceDirty) {
      try {
        this.persist();
      } catch (error) {
        this.lastPersistError = error?.message || String(error);
        this.scheduleNextRetry();
        this.emitState();
        return;
      }
    }
    if (!this.isBridgeWriteCompatible()) {
      this.emitState();
      return;
    }
    const now = Date.now();
    const endpointKey = this.currentEndpointKey();
    const allPendingItems = Array.from(this.pending.values());
    const dependencyBlocked = dependencyBlockedIds(allPendingItems);
    const ready = allPendingItems
      .filter((item) => (
        !this.inflight.has(item.id)
        && !item.blocked
        && !dependencyBlocked.has(item.id)
        && item.endpointKey === endpointKey
        && Number(item.nextAttemptAt || 0) <= now
      ))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, MAX_BATCH_SIZE);

    if (!ready.length) {
      this.scheduleNextRetry();
      this.emitState();
      return;
    }

    this.flushing = true;
    this.emitState();
    try {
      // Preserve the WAL's global sequence. Only adjacent compatible writes
      // may share one network batch; a direct mutation is a causal boundary
      // for cell batching (and vice versa).
      for (let offset = 0; offset < ready.length;) {
        const first = ready[offset];
        if (hasPendingRenameDependency(first, this.pending.values())) {
          offset += 1;
          continue;
        }
        let end = offset + 1;
        if (first.kind === 'cells') {
          while (
            end < ready.length
            && ready[end].kind === 'cells'
            && ready[end].action === first.action
            && !hasPendingRenameDependency(ready[end], this.pending.values())
          ) end += 1;
          await this.flushCellAction(first.action, ready.slice(offset, end));
        } else {
          while (
            end < ready.length
            && ready[end].kind !== 'cells'
            && first.action !== 'mcc.updateProfileName'
            && ready[end].action !== 'mcc.updateProfileName'
            && !hasPendingRenameDependency(ready[end], this.pending.values())
          ) end += 1;
          await this.flushDirectItems(ready.slice(offset, end));
        }
        offset = end;
      }
    } finally {
      this.flushing = false;
      try {
        this.persist();
      } catch (error) {
        this.lastPersistError = error?.message || String(error);
      }
      this.emitState();
      if (this.pending.size || this.persistenceDirty) this.scheduleNextRetry();
    }
  }

  async flushCellAction(action, items) {
    const spec = ACTION_SPECS.get(action);
    for (const item of items) this.inflight.add(item.id);
    const groupedMap = new Map();
    for (const item of items) {
      const key = targetKey(item.action, item.payload);
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          payload: {
            row: item.payload.row,
            updates: {},
            identity: item.payload.identity
          },
          items: []
        });
      }
      const group = groupedMap.get(key);
      Object.assign(group.payload.updates, item.payload.updates);
      group.items.push(item);
    }
    const groups = Array.from(groupedMap.values());
    try {
      // Apps Script <=2.2.2 cached a stable row by profile/account inside one
      // batch. Keep repeated identities in separate calls so two physical rows
      // can never inherit one another's resolved row while clients upgrade.
      const safeBatches = partitionServerSafeGroups(action, groups);
      for (const batch of safeBatches) {
        await this.flushCellGroups(spec.batchAction, batch);
        this.persist();
      }
    } finally {
      for (const item of items) this.inflight.delete(item.id);
    }
  }

  async flushCellGroups(batchAction, groups) {
    let response;
    try {
      response = await this.bridgeManager.callApi(batchAction, {
        items: groups.map((group) => group.payload)
      }, {
        timeoutMs: CELL_BATCH_TIMEOUT_MS,
        retries: 0,
        minBridgeVersion: MIN_WRITE_BRIDGE_VERSION
      });
    } catch (error) {
      const message = error?.message || String(error || 'Ошибка пакетного сохранения');
      for (const group of groups) {
        for (const item of group.items) this.markFailed(item, message, error?.code);
      }
      return;
    }
    if (!response || response.ok !== true) {
      const message = response?.error || 'Google Таблица не подтвердила пакетное сохранение';
      for (const group of groups) {
        for (const item of group.items) this.markFailed(item, message, response?.code);
      }
      return;
    }

    const data = response.data && typeof response.data === 'object' ? response.data : {};
    const results = Array.isArray(data.results) ? data.results : [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const result = results[index];
      if (result?.ok === true) {
        const applied = result.applied && typeof result.applied === 'object'
          ? result.applied
          : group.payload.updates;
        for (const item of group.items) {
          const itemApplied = {};
          for (const col of Object.keys(item.payload.updates)) {
            itemApplied[col] = Object.prototype.hasOwnProperty.call(applied, col)
              ? applied[col]
              : item.payload.updates[col];
          }
          this.complete(item, {
            ok: true,
            ...result,
            applied: itemApplied,
            version: response.version || '',
            ts: response.ts || ''
          });
        }
      } else {
        for (const item of group.items) {
          item.lastResultCode = result?.code || result?.causeCode || response?.code || '';
          this.markFailed(item, result?.error || 'Не удалось сохранить строку');
        }
      }
    }
  }

  async flushDirectItems(items) {
    for (let offset = 0; offset < items.length; offset += MAX_DIRECT_BATCH_SIZE) {
      const chunk = items.slice(offset, offset + MAX_DIRECT_BATCH_SIZE);
      await this.flushDirectChunk(chunk);
      this.persist();
    }
  }

  async flushDirectChunk(items) {
    for (const item of items) this.inflight.add(item.id);
    let response;
    try {
      response = await this.bridgeManager.batchApi(items.map((item) => ({
        id: item.id,
        action: item.action,
        payload: item.payload
      })), {
        timeoutMs: 55000,
        retries: 0,
        minBridgeVersion: MIN_WRITE_BRIDGE_VERSION
      });
    } catch (error) {
      const message = error?.message || String(error || 'Ошибка сохранения');
      for (const item of items) this.markFailed(item, message, error?.code);
      return;
    } finally {
      for (const item of items) this.inflight.delete(item.id);
    }

    if (!response || response.ok !== true) {
      const message = response?.error || 'Google Таблица не подтвердила сохранение';
      for (const item of items) this.markFailed(item, message, response?.code);
      return;
    }

    const rows = Array.isArray(response.data) ? response.data : [];
    const byId = new Map(rows.map((row) => [String(row?.id || ''), row?.result]));
    for (const item of items) {
      const result = byId.get(item.id);
      item.lastResultCode = result?.code || result?.causeCode || response?.code || '';
      if (result?.ok === true) {
        const data = result.data && typeof result.data === 'object'
          ? result.data
          : (result.data == null ? {} : { value: result.data });
        this.complete(item, {
          ok: true,
          ...data,
          version: result.version || response.version || '',
          ts: result.ts || response.ts || ''
        });
        continue;
      }

      this.markFailed(item, result?.error || 'Нет результата операции сохранения');
    }
  }

  complete(item, result) {
    if (!this.pending.has(item.id)) return;
    this.persistenceDirty = true;
    this.pending.delete(item.id);
    this.markCompletedId(item.id);
    this.lastAppliedAt = Date.now();
    const confirmedResult = {
      ...(result || {}),
      writeId:item.id,
      serverConfirmed:true
    };
    this.recordServerConfirmation(item);
    this.resolveWaiter(item.id, confirmedResult);
  }

  recordServerConfirmation(item) {
    const confirmation = {
      revision:++this.confirmationRevision,
      writeId:String(item?.id || ''),
      action:String(item?.action || ''),
      confirmedAt:this.lastAppliedAt || Date.now(),
      target:confirmationTarget(item)
    };
    if (!confirmation.writeId) return;
    this.confirmedWrites.push(confirmation);
    if (this.confirmedWrites.length > MAX_CONFIRMED_WRITES) {
      this.confirmedWrites.splice(
        0,
        this.confirmedWrites.length - MAX_CONFIRMED_WRITES
      );
    }
  }

  markFailed(item, error, code) {
    if (!this.pending.has(item.id)) return;
    this.persistenceDirty = true;
    if (!this.shouldRetryAfterFailure(item)) {
      this.pending.delete(item.id);
      this.markCompletedId(item.id);
      this.resolveWaiter(item.id, { ok: true, superseded: true, applied: {} });
      return;
    }
    item.attempts += 1;
    item.lastError = String(error || 'Ошибка сохранения');
    item.lastErrorCode = String(code || item.lastResultCode || '');
    delete item.lastResultCode;
    item.blocked = isPermanentFailure(item.lastError, item.lastErrorCode);
    const delay = item.blocked
      ? 5 * 60 * 1000
      : (item.attempts <= 2
          ? 900 * item.attempts
          : Math.min(60000, 5000 * Math.pow(2, Math.min(4, item.attempts - 3))));
    item.nextAttemptAt = Date.now() + delay;
    this.resolveWaiter(item.id, durableAck(item, {
      retrying: !item.blocked,
      blocked: item.blocked,
      lastError: item.lastError,
      lastErrorCode:item.lastErrorCode
    }));
  }

  resolveWaiter(id, result) {
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    this.waiters.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  }

  markCompletedId(id) {
    const value = String(id || '');
    if (!value) return;
    this.completedIds.delete(value);
    this.completedIds.add(value);
    while (this.completedIds.size > MAX_COMPLETED_IDS) {
      const oldest = this.completedIds.values().next().value;
      if (!oldest) break;
      this.completedIds.delete(oldest);
    }
  }

  scheduleNextRetry() {
    if (this.persistenceDirty) {
      this.schedule(1000);
      return;
    }
    if (!this.pending.size) return;
    const endpointKey = this.currentEndpointKey();
    const allItems = Array.from(this.pending.values());
    const dependencyBlocked = dependencyBlockedIds(allItems);
    const currentItems = allItems
      .filter((item) => (
        item.endpointKey === endpointKey
        && !this.inflight.has(item.id)
        && !item.blocked
        && !dependencyBlocked.has(item.id)
      ));
    if (!currentItems.length) return;
    const now = Date.now();
    let nextAt = Infinity;
    for (const item of currentItems) {
      nextAt = Math.min(nextAt, dependencyReadyAt(item, allItems));
    }
    if (!Number.isFinite(nextAt)) return;
    const delay = Math.max(80, Math.min(60000, nextAt - now));
    this.schedule(delay);
  }

  getState() {
    const now = Date.now();
    const endpointKey = this.currentEndpointKey();
    const items = Array.from(this.pending.values());
    const dependencyBlocked = dependencyBlockedIds(items);
    const blockedEndpoint = items.filter((item) => item.endpointKey !== endpointKey).length;
    const errors = items
      .filter((item) => item.lastError)
      .sort((a, b) => b.seq - a.seq);
    const oldest = items.reduce((min, item) => Math.min(min, item.createdAt), Infinity);
    const bridge = this.bridgeWriteState();
    const backendCompatible = bridge.ready && versionAtLeast(bridge.version, MIN_WRITE_BRIDGE_VERSION);
    const blockedBackend = backendCompatible
      ? 0
      : items.filter((item) => item.endpointKey === endpointKey).length;
    return {
      pending: items.length,
      inflight: this.inflight.size,
      retrying: items.filter((item) => item.attempts > 0 && !item.blocked).length,
      blocked: items.filter((item) => item.blocked).length + dependencyBlocked.size,
      dependencyBlocked: dependencyBlocked.size,
      blockedEndpoint,
      blockedBackend,
      backendCompatible,
      backendVersion: bridge.version,
      minimumWriteBackendVersion: MIN_WRITE_BRIDGE_VERSION,
      oldestAgeMs: Number.isFinite(oldest) ? Math.max(0, now - oldest) : 0,
      lastError: errors[0]?.lastError
        || this.externalIntegrityBlock?.error
        || this.lastPersistError
        || '',
      lastErrorCode:errors[0]?.lastErrorCode
        || this.externalIntegrityBlock?.code
        || '',
      lastAppliedAt: this.lastAppliedAt,
      confirmationRevision:this.confirmationRevision,
      confirmedWrites:this.confirmedWrites.map((item) => ({ ...item })),
      endpointKey,
      integrityBlocked: !!this.restoreError || !!this.externalIntegrityBlock,
      externalIntegrityBlocked:!!this.externalIntegrityBlock,
      quarantineCount: this.quarantinedRecords.length,
      restoreError: this.restoreError,
      persistenceDirty: this.persistenceDirty
    };
  }

  emitState() {
    try {
      this.onState(this.getState());
    } catch (_error) {}
  }

  retryBlocked(writeIds) {
    if (this.externalIntegrityBlock) {
      return {
        ok:false,
        retried:0,
        error:this.externalIntegrityBlock.error,
        code:this.externalIntegrityBlock.code
      };
    }
    const requested = Array.isArray(writeIds)
      ? new Set(writeIds.map((value) => String(value || '')).filter(Boolean))
      : null;
    const items = Array.from(this.pending.values()).filter((item) => (
      item.blocked && (!requested || requested.has(item.id))
    ));
    if (!items.length) return { ok:true, retried:0 };
    for (const item of items) {
      item.blocked = false;
      item.nextAttemptAt = 0;
      item.manualRetryAt = Date.now();
    }
    this.persistenceDirty = true;
    this.persist();
    this.schedule(0);
    return { ok:true, retried:items.length };
  }

  archiveBlocked(writeIds) {
    const requested = Array.isArray(writeIds)
      ? new Set(writeIds.map((value) => String(value || '')).filter(Boolean))
      : null;
    const pendingItems = Array.from(this.pending.values());
    const seeds = pendingItems.filter((item) => (
      item.blocked && (!requested || requested.has(item.id))
    ));
    const archiveIds = causalDescendantIds(
      seeds.map((item) => item.id),
      pendingItems
    );
    const items = pendingItems.filter((item) => archiveIds.has(item.id));
    if (!items.length) return { ok:true, archived:0, path:'' };
    const serializable = items.map((item) => ({
      id:item.id,
      action:item.action,
      kind:item.kind,
      payload:item.payload,
      endpointKey:item.endpointKey,
      seq:item.seq,
      createdAt:item.createdAt,
      attempts:item.attempts,
      nextAttemptAt:item.nextAttemptAt,
      lastError:item.lastError,
      lastErrorCode:item.lastErrorCode,
      blocked:!!item.blocked,
      dependencyBlocked:!item.blocked
    }));
    const archivePath = writeBlockedArchive(
      this.blockedArchiveDir,
      serializable
    );
    for (const item of items) {
      this.pending.delete(item.id);
      this.markCompletedId(item.id);
      this.resolveWaiter(item.id, {
        ok:false,
        archived:true,
        archivePath,
        writeId:item.id
      });
    }
    this.persistenceDirty = true;
    try {
      this.persist();
    } catch (error) {
      for (const item of items) {
        this.pending.set(item.id, item);
        this.completedIds.delete(item.id);
      }
      this.persistenceDirty = true;
      this.emitState();
      throw new Error(
        `Blocked writes were archived at ${archivePath}, but queue removal failed: ${error?.message || error}`,
        { cause:error }
      );
    }
    return {
      ok:true,
      archived:items.length,
      path:archivePath
    };
  }

  hasPendingForEndpointChange(nextEndpoint) {
    const next = normalizeEndpointKey(nextEndpoint);
    if (!next || next === this.currentEndpointKey()) return 0;
    return Array.from(this.pending.values()).filter((item) => item.endpointKey !== next).length;
  }

  hasBoundPendingForEndpointChange(nextEndpoint) {
    const next = normalizeEndpointKey(nextEndpoint);
    if (!next) return this.pending.size;
    return Array.from(this.pending.values())
      .filter((item) => item.endpointKey && item.endpointKey !== next)
      .length;
  }

  bindUnboundToEndpoint(nextEndpoint) {
    if (this.externalIntegrityBlock) {
      return {
        ok:false,
        error:this.externalIntegrityBlock.error,
        code:this.externalIntegrityBlock.code
      };
    }
    if (this.restoreError) return { ok:false, error:this.restoreError };
    const endpointKey = normalizeEndpointKey(nextEndpoint);
    if (!endpointKey) {
      return { ok: false, error: 'Невозможно привязать очередь к пустому URL' };
    }
    const unbound = Array.from(this.pending.values())
      .filter((item) => !item.endpointKey);
    if (!unbound.length) return { ok: true, bound: 0 };

    for (const item of unbound) item.endpointKey = endpointKey;
    try {
      this.persist();
      this.emitState();
      return { ok: true, bound: unbound.length };
    } catch (error) {
      this.lastPersistError = error?.message || String(error);
      this.schedule(1000);
      this.emitState();
      return {
        ok: false,
        error: `Не удалось надёжно привязать очередь к Apps Script: ${this.lastPersistError}`
      };
    }
  }

  async drain(timeoutMs = 60000) {
    if (this.externalIntegrityBlock) {
      return this.pending.size + Math.max(1, this.persistenceDirty ? 1 : 0);
    }
    const startedAt = Date.now();
    this.schedule(0);
    while (
      (
        this.pending.size
        || this.flushing
        || this.inflight.size
        || this.persistenceDirty
      )
      && Date.now() - startedAt < timeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.pending.size
      + this.inflight.size
      + (this.flushing ? 1 : 0)
      + (this.persistenceDirty ? 1 : 0)
      + (this.restoreError ? Math.max(1, this.quarantinedRecords.length) : 0);
  }

  persist() {
    if (!this.store) return;
    if (this.restoreError) throw new Error(this.restoreError);
    const serializable = Array.from(this.pending.values())
      .sort((a, b) => a.seq - b.seq)
      .map((item) => ({
        id: item.id,
        action: item.action,
        kind: item.kind,
        payload: item.payload,
        endpointKey: item.endpointKey,
        seq: item.seq,
        createdAt: item.createdAt,
        attempts: item.attempts,
        nextAttemptAt: item.nextAttemptAt,
        lastError: item.lastError,
        lastErrorCode:item.lastErrorCode,
        blocked: item.blocked
      }));
    for (const item of serializable) this.completedIds.delete(item.id);
    const revision = this.snapshotRevision + 1;
    const payload = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      revision,
      writtenAt: Date.now(),
      completedIds: Array.from(this.completedIds).slice(-MAX_COMPLETED_IDS),
      items: serializable
    };
    const envelope = { ...payload, checksum:snapshotChecksum(payload) };

    // Commit a checksummed, independently recoverable WAL generation first.
    // The electron-store snapshot is the second authoritative copy; the two
    // legacy arrays remain compatibility mirrors for v2.2.2 rollback.
    this.persistenceDirty = true;
    writeWalSnapshot(this.walPath, envelope);
    this.store.set(SNAPSHOT_STORE_KEY, envelope);
    this.snapshotRevision = revision;
    this.persistenceDirty = false;

    const mirrorErrors = [];
    try {
      this.store.set(STORE_KEY, serializable);
    } catch (error) {
      mirrorErrors.push(`primary: ${error?.message || error}`);
    }
    try {
      this.store.set(BACKUP_STORE_KEY, serializable);
    } catch (error) {
      mirrorErrors.push(`backup: ${error?.message || error}`);
    }
    this.lastPersistError = mirrorErrors.join('; ');
    this.emitState();
  }
}

module.exports = {
  ACTION_SPECS,
  BACKUP_STORE_KEY,
  DurableWriteQueue,
  MIN_WRITE_BRIDGE_VERSION,
  SNAPSHOT_STORE_KEY,
  STORE_KEY,
  cleanIdentity,
  cleanUpdates,
  normalizeEndpointKey,
  normalizeStoredItem,
  partitionServerSafeGroups,
  readWalSnapshot,
  serverIdentityKey,
  snapshotChecksum,
  targetKey,
  validateBlockedArchive,
  validateWalSnapshot,
  versionAtLeast,
  writeBlockedArchive,
  writeWalSnapshot
};
