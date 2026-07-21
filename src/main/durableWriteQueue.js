const WRITE_ACTIONS = new Map([
  ['o1.updateCells', 'o1.updateCellsBatch'],
  ['mcc.updateCells', 'mcc.updateCellsBatch']
]);

const STORE_KEY = 'pendingWrites';
const MAX_BATCH_SIZE = 80;

function cleanUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return {};
  const out = {};
  for (const [rawCol, value] of Object.entries(updates)) {
    const col = String(rawCol || '').trim().toUpperCase();
    if (col) out[col] = value;
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

function targetKey(action, payload) {
  const identity = cleanIdentity(payload?.identity);
  const profile = identity.profileName.toLocaleLowerCase('ru-RU');
  const account = identity.accountName.toLocaleLowerCase('ru-RU');
  if (profile) return `${action}:${profile}:${account}`;
  return `${action}:row:${Number(payload?.row) || String(payload?.row || '')}`;
}

function normalizeStoredItem(raw) {
  const action = String(raw?.action || '').trim();
  if (!WRITE_ACTIONS.has(action)) return null;
  const row = Number(raw?.payload?.row);
  const updates = cleanUpdates(raw?.payload?.updates || raw?.payload?.cells);
  if (!row || row < 2 || !Object.keys(updates).length) return null;
  const seq = Number(raw?.seq || 0) || Date.now();
  return {
    id: String(raw?.id || `restored-${seq}-${Math.random().toString(36).slice(2, 8)}`),
    action,
    payload: {
      row,
      updates,
      identity: cleanIdentity(raw?.payload?.identity)
    },
    seq,
    createdAt: Number(raw?.createdAt || Date.now()),
    attempts: Math.max(0, Number(raw?.attempts || 0)),
    nextAttemptAt: Math.max(0, Number(raw?.nextAttemptAt || 0)),
    lastError: String(raw?.lastError || '')
  };
}

class DurableWriteQueue {
  constructor({ bridgeManager, store }) {
    this.bridgeManager = bridgeManager;
    this.store = store;
    this.pending = new Map();
    this.waiters = new Map();
    this.inflight = new Set();
    this.seq = Date.now();
    this.timer = null;
    this.flushing = false;

    const restored = Array.isArray(store?.get(STORE_KEY)) ? store.get(STORE_KEY) : [];
    for (const raw of restored) {
      const item = normalizeStoredItem(raw);
      if (!item) continue;
      this.pending.set(item.id, item);
      this.seq = Math.max(this.seq, item.seq);
    }
    this.persist();
    if (this.pending.size) this.schedule(1200);
  }

  supports(action) {
    return WRITE_ACTIONS.has(String(action || '').trim());
  }

  enqueue(action, payload = {}) {
    const normalized = normalizeStoredItem({
      id: `write-${Date.now()}-${++this.seq}`,
      action,
      payload,
      seq: this.seq,
      createdAt: Date.now()
    });
    if (!normalized) {
      return Promise.resolve({ ok: false, error: 'Некорректные данные для сохранения', code: 'BAD_WRITE' });
    }

    this.removeSupersededColumns(normalized);
    this.pending.set(normalized.id, normalized);
    this.persist();
    this.schedule(35);

    return new Promise((resolve) => {
      this.waiters.set(normalized.id, resolve);
    });
  }

  removeSupersededColumns(newItem) {
    const newKey = targetKey(newItem.action, newItem.payload);
    const newCols = new Set(Object.keys(newItem.payload.updates));
    for (const oldItem of this.pending.values()) {
      if (this.inflight.has(oldItem.id)) continue;
      if (targetKey(oldItem.action, oldItem.payload) !== newKey) continue;
      for (const col of newCols) delete oldItem.payload.updates[col];
      if (Object.keys(oldItem.payload.updates).length) continue;
      this.pending.delete(oldItem.id);
      this.resolveWaiter(oldItem.id, { ok: true, superseded: true, applied: {} });
    }
  }

  stripColumnsSupersededAfter(item) {
    const itemKey = targetKey(item.action, item.payload);
    for (const newer of this.pending.values()) {
      if (newer.id === item.id || newer.seq <= item.seq) continue;
      if (targetKey(newer.action, newer.payload) !== itemKey) continue;
      for (const col of Object.keys(newer.payload.updates)) delete item.payload.updates[col];
    }
    return Object.keys(item.payload.updates).length > 0;
  }

  schedule(delayMs = 50) {
    if (this.timer || this.flushing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, Math.max(0, Number(delayMs || 0)));
  }

  async flush() {
    if (this.flushing) return;
    const now = Date.now();
    const ready = Array.from(this.pending.values())
      .filter((item) => !this.inflight.has(item.id) && Number(item.nextAttemptAt || 0) <= now)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, MAX_BATCH_SIZE);

    if (!ready.length) {
      this.scheduleNextRetry();
      return;
    }

    this.flushing = true;
    try {
      const byAction = new Map();
      for (const item of ready) {
        if (!byAction.has(item.action)) byAction.set(item.action, []);
        byAction.get(item.action).push(item);
      }
      for (const [action, items] of byAction) await this.flushAction(action, items);
    } finally {
      this.flushing = false;
      this.persist();
      if (this.pending.size) this.scheduleNextRetry();
    }
  }

  async flushAction(action, items) {
    const batchAction = WRITE_ACTIONS.get(action);
    for (const item of items) this.inflight.add(item.id);
    const groupedMap = new Map();
    for (const item of items) {
      const key = targetKey(item.action, item.payload);
      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          payload:{
            row:item.payload.row,
            updates:{},
            identity:item.payload.identity
          },
          items:[]
        });
      }
      const group = groupedMap.get(key);
      Object.assign(group.payload.updates, item.payload.updates);
      group.items.push(item);
    }
    const groups = Array.from(groupedMap.values());

    let response;
    try {
      response = await this.bridgeManager.callApi(batchAction, {
        items:groups.map((group) => group.payload)
      }, { timeoutMs: 55000, retries: 1 });
    } catch (error) {
      const message = error?.message || String(error || 'Ошибка пакетного сохранения');
      for (const item of items) this.markFailed(item, message);
      return;
    } finally {
      for (const item of items) this.inflight.delete(item.id);
    }

    if (!response || response.ok === false) {
      const message = response?.error || 'Google Таблица не подтвердила пакетное сохранение';
      for (const item of items) this.markFailed(item, message);
      return;
    }

    const data = response.data && typeof response.data === 'object' ? response.data : {};
    const results = Array.isArray(data.results) ? data.results : [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const result = results[index];
      if (result && result.ok !== false) {
        const applied = result.applied && typeof result.applied === 'object' ? result.applied : group.payload.updates;
        for (const item of group.items) {
          const itemApplied = {};
          for (const col of Object.keys(item.payload.updates)) {
            itemApplied[col] = Object.prototype.hasOwnProperty.call(applied, col) ? applied[col] : item.payload.updates[col];
          }
          this.pending.delete(item.id);
          this.resolveWaiter(item.id, {
            ok:true,
            ...result,
            applied:itemApplied,
            version:response.version || '',
            ts:response.ts || ''
          });
        }
      } else {
        for (const item of group.items) this.markFailed(item, result?.error || 'Не удалось сохранить строку');
      }
    }
  }

  markFailed(item, error) {
    if (!this.pending.has(item.id)) return;
    if (!this.stripColumnsSupersededAfter(item)) {
      this.pending.delete(item.id);
      this.resolveWaiter(item.id, { ok: true, superseded: true, applied: {} });
      return;
    }
    item.attempts += 1;
    item.lastError = String(error || 'Ошибка сохранения');
    const delay = item.attempts <= 2
      ? 900 * item.attempts
      : Math.min(60000, 5000 * Math.pow(2, Math.min(4, item.attempts - 3)));
    item.nextAttemptAt = Date.now() + delay;
    this.resolveWaiter(item.id, { ok: false, error: item.lastError, code: 'WRITE_QUEUED_FOR_RETRY' });
  }

  resolveWaiter(id, result) {
    const resolve = this.waiters.get(id);
    if (!resolve) return;
    this.waiters.delete(id);
    resolve(result);
  }

  scheduleNextRetry() {
    if (!this.pending.size) return;
    const now = Date.now();
    let nextAt = Infinity;
    for (const item of this.pending.values()) nextAt = Math.min(nextAt, Number(item.nextAttemptAt || 0));
    const delay = Number.isFinite(nextAt) ? Math.max(80, Math.min(60000, nextAt - now)) : 1000;
    this.schedule(delay);
  }

  persist() {
    if (!this.store) return;
    const serializable = Array.from(this.pending.values())
      .sort((a, b) => a.seq - b.seq)
      .map((item) => ({
        id: item.id,
        action: item.action,
        payload: item.payload,
        seq: item.seq,
        createdAt: item.createdAt,
        attempts: item.attempts,
        nextAttemptAt: item.nextAttemptAt,
        lastError: item.lastError
      }));
    this.store.set(STORE_KEY, serializable);
  }
}

module.exports = { DurableWriteQueue };
