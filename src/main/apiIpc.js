const { DurableWriteQueue } = require('./durableWriteQueue');
const { isReadAction } = require('../shared/actions');

function normalizeBridgeResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, error: 'Empty bridge response', code: 'EMPTY_RESPONSE' };
  }

  if (result.ok === false) {
    return {
      ok: false,
      error: result.error || 'Apps Script error',
      code: result.code || 'API_ERROR',
      version: result.version || '',
      ts: result.ts || ''
    };
  }

  return {
    ok: true,
    data: result.data == null ? {} : result.data,
    version: result.version || '',
    ts: result.ts || ''
  };
}

function legacyShape(result) {
  const normalized = normalizeBridgeResult(result);
  if (!normalized.ok) return normalized;
  const data = normalized.data && typeof normalized.data === 'object' ? normalized.data : { value: normalized.data };
  return { ok: true, ...data, version: normalized.version, ts: normalized.ts };
}

function isLockTimeout(result) {
  const text = String(result?.error || result?.code || '').toLowerCase();
  return text.includes('lock') || text.includes('блокиров');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithLockRetry(fn, retries = 2) {
  let result = await fn();
  for (let attempt = 0; attempt < retries && result && result.ok === false && isLockTimeout(result); attempt++) {
    await wait(650 + attempt * 850);
    result = await fn();
  }
  return result;
}

function queuedWriteAsApiResult(result) {
  if (!result || result.ok === false) return result || { ok: false, error: 'Empty write response' };
  const data = { ...result };
  delete data.ok;
  delete data.version;
  delete data.ts;
  return { ok: true, data, version: result.version || '', ts: result.ts || '' };
}

function unsafeLegacyWrite(action) {
  return String(action || '') === 'o1.toggleBan';
}

function writeIntegrityFailure(options) {
  const state = options.getWriteIntegrityBlock?.();
  if (!state) return null;
  return {
    ok:false,
    error:String(
      state.message
      || 'Локальное хранилище повреждено; новые записи заблокированы до безопасного восстановления'
    ),
    code:String(state.code || 'LOCAL_STORE_INTEGRITY_BLOCKED')
  };
}

function registerApiIpc(ipcMain, bridgeManager, store, options = {}) {
  const trackMutation = typeof options.trackMutation === 'function'
    ? options.trackMutation
    : (work) => Promise.resolve().then(work);
  const durableWrites = new DurableWriteQueue({
    bridgeManager,
    store,
    walPath: options.walPath,
    getEndpointKey: options.getEndpointKey,
    onState: options.onQueueState,
    startupWriteBlock:options.getWriteIntegrityBlock?.() || null
  });
  ipcMain.handle('sproutg:bridge-state', () => ({
    ...bridgeManager.getState(),
    storageIntegrity:options.getStorageIntegrity?.() || null
  }));
  ipcMain.handle('sproutg:write-queue-state', () => durableWrites.getState());
  ipcMain.handle('sproutg:write-queue-retry-blocked', (_event, writeIds) => {
    try {
      return durableWrites.retryBlocked(writeIds);
    } catch (error) {
      return {
        ok:false,
        error:error?.message || String(error),
        code:'WRITE_QUEUE_RETRY_FAILED'
      };
    }
  });
  ipcMain.handle('sproutg:write-queue-archive-blocked', async (_event, writeIds) => {
    try {
      if (typeof options.confirmArchiveBlocked !== 'function') {
        return {
          ok:false,
          canceled:true,
          error:'Архивация не подтверждена главным процессом',
          code:'WRITE_QUEUE_ARCHIVE_CONFIRMATION_REQUIRED'
        };
      }
      const confirmed = await options.confirmArchiveBlocked({
        writeIds:Array.isArray(writeIds) ? writeIds.map(String) : null,
        state:durableWrites.getState()
      });
      if (confirmed !== true) {
        return {
          ok:false,
          canceled:true,
          error:'Архивация отменена',
          code:'WRITE_QUEUE_ARCHIVE_CANCELED'
        };
      }
      return durableWrites.archiveBlocked(writeIds);
    } catch (error) {
      return {
        ok:false,
        error:error?.message || String(error),
        code:'WRITE_QUEUE_ARCHIVE_FAILED'
      };
    }
  });

  ipcMain.handle('sproutg:api-call', async (_event, action, payload, opts) => {
    try {
      if (!isReadAction(action)) {
        const integrityFailure = writeIntegrityFailure(options);
        if (integrityFailure) return integrityFailure;
      }
      if (options.isWriteGateClosed?.() && !isReadAction(action)) {
        return {
          ok:false,
          error:'Операция временно остановлена: приложение завершает сохранение данных',
          code:'WRITE_GATE_CLOSED'
        };
      }
      if (unsafeLegacyWrite(action)) {
        return {
          ok:false,
          error:'Небезопасное переключение отключено; используйте запись явного значения',
          code:'UNSAFE_NON_IDEMPOTENT_WRITE'
        };
      }
      if (durableWrites.supports(action)) {
        return queuedWriteAsApiResult(await durableWrites.enqueue(action, payload || {}));
      }
      const invoke = () => callWithLockRetry(() => bridgeManager.callApi(action, payload || {}, opts || {}));
      const raw = isReadAction(action) ? await invoke() : await trackMutation(invoke);
      return normalizeBridgeResult(raw);
    } catch (err) {
      return { ok: false, error: err?.message || String(err), code: err?.code || 'BRIDGE_ERROR' };
    }
  });

  ipcMain.handle('sproutg:api-batch', async (_event, calls, opts) => {
    try {
      const list = Array.isArray(calls) ? calls : [];
      if (list.some((call) => !isReadAction(call?.action))) {
        return {
          ok: false,
          error: 'Изменяющие batch-запросы должны проходить через надёжную очередь',
          code: 'UNSAFE_WRITE_BATCH'
        };
      }
      return normalizeBridgeResult(await callWithLockRetry(() => bridgeManager.batchApi(list, opts || {})));
    } catch (err) {
      return { ok: false, error: err?.message || String(err), code: err?.code || 'BRIDGE_ERROR' };
    }
  });

  ipcMain.handle('sproutg:legacy-call', async (_event, action, payload, opts) => {
    try {
      if (!isReadAction(action)) {
        const integrityFailure = writeIntegrityFailure(options);
        if (integrityFailure) return integrityFailure;
      }
      if (options.isWriteGateClosed?.() && !isReadAction(action)) {
        return {
          ok:false,
          error:'Операция временно остановлена: приложение завершает сохранение данных',
          code:'WRITE_GATE_CLOSED'
        };
      }
      if (unsafeLegacyWrite(action)) {
        return {
          ok:false,
          error:'Небезопасное переключение отключено; используйте запись явного значения',
          code:'UNSAFE_NON_IDEMPOTENT_WRITE'
        };
      }
      if (durableWrites.supports(action)) {
        return await durableWrites.enqueue(action, payload || {});
      }
      const invoke = () => callWithLockRetry(() => bridgeManager.callApi(action, payload || {}, opts || {}));
      const raw = isReadAction(action) ? await invoke() : await trackMutation(invoke);
      return legacyShape(raw);
    } catch (err) {
      return { ok: false, error: err?.message || String(err), code: err?.code || 'BRIDGE_ERROR' };
    }
  });

  return {
    durableWrites,
    bindUnboundToEndpoint: (endpoint) => durableWrites.bindUnboundToEndpoint(endpoint),
    drain: (timeoutMs) => durableWrites.drain(timeoutMs),
    getState: () => durableWrites.getState(),
    hasBoundPendingForEndpointChange: (endpoint) => durableWrites.hasBoundPendingForEndpointChange(endpoint),
    hasPendingForEndpointChange: (endpoint) => durableWrites.hasPendingForEndpointChange(endpoint)
  };
}

module.exports = { registerApiIpc };
