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

function registerApiIpc(ipcMain, bridgeManager) {
  ipcMain.handle('sproutg:bridge-state', () => bridgeManager.getState());

  ipcMain.handle('sproutg:api-call', async (_event, action, payload, opts) => {
    try {
      return normalizeBridgeResult(await callWithLockRetry(() => bridgeManager.callApi(action, payload || {}, opts || {})));
    } catch (err) {
      return { ok: false, error: err?.message || String(err), code: err?.code || 'BRIDGE_ERROR' };
    }
  });

  ipcMain.handle('sproutg:api-batch', async (_event, calls, opts) => {
    try {
      return normalizeBridgeResult(await callWithLockRetry(() => bridgeManager.batchApi(calls || [], opts || {})));
    } catch (err) {
      return { ok: false, error: err?.message || String(err), code: err?.code || 'BRIDGE_ERROR' };
    }
  });

  ipcMain.handle('sproutg:legacy-call', async (_event, action, payload, opts) => {
    try {
      return legacyShape(await callWithLockRetry(() => bridgeManager.callApi(action, payload || {}, opts || {})));
    } catch (err) {
      return { ok: false, error: err?.message || String(err), code: err?.code || 'BRIDGE_ERROR' };
    }
  });
}

module.exports = { registerApiIpc };
