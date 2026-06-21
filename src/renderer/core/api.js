(function () {
  const LEGACY_TO_ACTION = {
    findProfile: { action: 'o1.profileByName', payload: ([profileName]) => ({ profileName }) },
    getProfileByRow: { action: 'o1.profileByRow', payload: ([row]) => ({ row }) },
    getO1AppealRowData: { action: 'o1.appealRow', payload: ([row]) => ({ row }) },
    getProfilesByRows: { action: 'o1.profilesByRows', payload: ([rows]) => ({ rows }) },
    listProfilesForCleanup: { action: 'o1.cleanupList', payload: ([limit]) => ({ limit }) },
    listProfilesByGroupDate: { action: 'o1.groupDateList', payload: ([group, fromIso, toIso, limit]) => ({ group, fromIso, toIso, limit }) },
    getWorkLists: { action: 'o1.workLists', payload: ([mode, fromIso, toIso]) => ({ mode, fromIso, toIso }) },
    updateCell: { action: 'o1.updateCells', payload: ([row, col, value]) => ({ row, updates: { [String(col || '').toUpperCase()]: value } }) },
    updateCells: { action: 'o1.updateCells', payload: ([row, updates]) => ({ row, updates }) },
    updateProxyFromValue: { action: 'o1.proxyFields', payload: ([row, value]) => ({ row, value }) },
    toggleBan: { action: 'o1.toggleBan', payload: ([row, group]) => ({ row, group }) },
    toggleProfileDeleted: { action: 'o1.toggleDeleted', payload: ([row, enabled]) => ({ row, enabled }) },
    setGroupNumber: { action: 'o1.setNumber', payload: ([row, group, enabled]) => ({ row, group, enabled }) },

    getMccProfile: { action: 'mcc.profile', payload: ([profileName]) => ({ profileName }) },
    listMccProfilesByStageDate: { action: 'mcc.stageList', payload: ([stage, fromIso, toIso, limit]) => ({ stage, fromIso, toIso, limit }) },
    getMccWorkFilter: { action: 'mcc.workList', payload: ([mode, limit]) => ({ mode, limit }) },
    getMccProfilesOverview: { action: 'mcc.overview', payload: ([limit]) => ({ limit }) },
    getMccVerificationDropdownPools: { action: 'mcc.verificationPools', payload: () => ({}) },
    updateMccCell: { action: 'mcc.updateCells', payload: ([row, col, value]) => ({ row, updates: { [String(col || '').toUpperCase()]: value } }) },
    updateMccCells: { action: 'mcc.updateCells', payload: ([row, updates]) => ({ row, updates }) },
    mccSetUnderReviewBg: { action: 'mcc.setUnderReviewBg', payload: ([row]) => ({ row }) },
    updateMccProxyFromValue: { action: 'mcc.proxyFields', payload: ([row, value]) => ({ row, value }) },
    updateMccProfileName: { action: 'mcc.updateProfileName', payload: ([rows, value]) => ({ rows, value }) },
    toggleMccProfileDeleted: { action: 'mcc.toggleProfileDeleted', payload: ([profileName, enabled]) => ({ profileName, enabled }) },
    toggleMccAccountDeleted: { action: 'mcc.toggleAccountDeleted', payload: ([row, enabled]) => ({ row, enabled }) },

    getApellDataIndex: { action: 'apell.index', payload: ([options]) => (options || {}) },
    getPassLookupForFios: { action: 'pass.lookupFios', payload: ([fios]) => ({ fios }) },
    getCompanyFormMeta: { action: 'company.formMeta', payload: () => ({}) },
    addCompanyRow: { action: 'company.addRow', payload: ([values]) => ({ values }) },

    smspoolOrderO1: { action: 'smspool.orderO1', payload: () => ({}) },
    smspoolCheckO1: { action: 'smspool.checkO1', payload: ([orderId]) => ({ orderId }) },
    smspoolRefundO1: { action: 'smspool.refundO1', payload: ([orderId]) => ({ orderId }) },
    smspoolGetStateO1: { action: 'smspool.stateO1', payload: () => ({}) },
    smspoolBalanceO1: { action: 'smspool.balanceO1', payload: () => ({}) }
  };

  const readCache = new Map();
  let lastVersion = '';

  const READ_ACTIONS = new Set([
    'meta.config', 'dropdown.maps',
    'o1.profileByName', 'o1.profileByRow', 'o1.profilesByRows', 'o1.appealRow', 'o1.lists', 'o1.workLists', 'o1.groupDateList', 'o1.cleanupList',
    'mcc.profile', 'mcc.overview', 'mcc.lists', 'mcc.stageList', 'mcc.workList', 'mcc.verificationPools',
    'apell.index', 'pass.lookupFios', 'company.formMeta',
    'smspool.checkO1', 'smspool.stateO1', 'smspool.balanceO1'
  ]);

  function cacheKey(action, payload) {
    return `${action}:${JSON.stringify(payload || {})}`;
  }

  function normalizeError(err) {
    return { ok: false, error: err?.message || String(err || 'Unknown API error'), code: err?.code || 'CLIENT_ERROR' };
  }

  async function callApi(action, payload = {}, opts = {}) {
    const useCache = opts.cache !== false && READ_ACTIONS.has(action);
    const key = useCache ? cacheKey(action, payload) : '';
    if (useCache && readCache.has(key)) return readCache.get(key);

    const res = await window.sproutg.apiCall(action, payload, opts);
    if (res && res.version && lastVersion && res.version !== lastVersion) readCache.clear();
    if (res && res.version) lastVersion = res.version;
    if (useCache && res && res.ok) readCache.set(key, res);
    if (res && !res.ok && useCache && readCache.has(key)) return { ...readCache.get(key), stale: true, warning: res.error };
    return res;
  }

  async function batchApi(calls = [], opts = {}) {
    const res = await window.sproutg.apiBatch(calls, opts);
    if (res && res.version && lastVersion && res.version !== lastVersion) readCache.clear();
    if (res && res.version) lastVersion = res.version;
    return res;
  }

  async function legacyCall(name, args) {
    const spec = LEGACY_TO_ACTION[name];
    if (!spec) return { ok: false, error: `Unknown legacy API method: ${name}`, code: 'UNKNOWN_LEGACY_METHOD' };
    try {
      return await window.sproutg.legacyCall(spec.action, spec.payload(Array.from(args || [])));
    } catch (err) {
      return normalizeError(err);
    }
  }

  function createRunner(successHandler, failureHandler) {
    const runner = {
      withSuccessHandler(handler) {
        return createRunner(handler, failureHandler);
      },
      withFailureHandler(handler) {
        return createRunner(successHandler, handler);
      }
    };

    return new Proxy(runner, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return (...args) => {
          legacyCall(String(prop), args).then((res) => {
            if (successHandler) successHandler(res);
          }).catch((err) => {
            if (failureHandler) failureHandler(err);
            else if (successHandler) successHandler(normalizeError(err));
          });
          return createRunner(successHandler, failureHandler);
        };
      }
    });
  }

  window.sproutgApi = {
    callApi,
    batchApi,
    invalidate: () => readCache.clear(),
    findO1Profile: (profileName) => callApi('o1.profileByName', { profileName }),
    getO1ProfileByRow: (row) => callApi('o1.profileByRow', { row }),
    getO1ProfilesByRows: (rows) => callApi('o1.profilesByRows', { rows }),
    updateO1Cells: (row, updates) => callApi('o1.updateCells', { row, updates }, { cache: false }),
    toggleO1Ban: (row, group) => callApi('o1.toggleBan', { row, group }, { cache: false }),
    toggleO1Deleted: (row, enabled) => callApi('o1.toggleDeleted', { row, enabled }, { cache: false }),
    setO1Number: (row, group, enabled) => callApi('o1.setNumber', { row, group, enabled }, { cache: false }),
    getO1WorkLists: (mode, fromIso, toIso) => callApi('o1.workLists', { mode, fromIso, toIso }),
    listO1ProfilesByGroupDate: (group, fromIso, toIso, limit) => callApi('o1.groupDateList', { group, fromIso, toIso, limit }),
    listO1Cleanup: (limit) => callApi('o1.cleanupList', { limit }),
    getMccProfile: (profileName) => callApi('mcc.profile', { profileName }),
    updateMccCells: (row, updates) => callApi('mcc.updateCells', { row, updates }, { cache: false }),
    toggleMccProfileDeleted: (profileName, enabled) => callApi('mcc.toggleProfileDeleted', { profileName, enabled }, { cache: false }),
    toggleMccAccountDeleted: (row, enabled) => callApi('mcc.toggleAccountDeleted', { row, enabled }, { cache: false }),
    setMccUnderReview: (row) => callApi('mcc.setUnderReviewBg', { row }, { cache: false }),
    updateMccProfileName: (rows, value) => callApi('mcc.updateProfileName', { rows, value }, { cache: false }),
    getMccStageFilter: (stage, fromIso, toIso, limit) => callApi('mcc.stageList', { stage, fromIso, toIso, limit }),
    getMccWorkFilter: (mode, limit) => callApi('mcc.workList', { mode, limit }),
    getMccOverview: (limit) => callApi('mcc.overview', { limit }),
    getApellDataIndex: (force) => callApi('apell.index', { force }),
    getO1AppealRowData: (row) => callApi('o1.appealRow', { row }),
    getPassLookupForFios: (fios) => callApi('pass.lookupFios', { fios }),
    getMccVerificationDropdownPools: () => callApi('mcc.verificationPools', {}),
    getCompanyFormMeta: () => callApi('company.formMeta', {}),
    addCompanyRow: (values) => callApi('company.addRow', { values }, { cache: false }),
    smsPoolOrderO1: () => callApi('smspool.orderO1', {}, { cache: false }),
    smsPoolCheckO1: (orderId) => callApi('smspool.checkO1', { orderId }, { cache: false }),
    smsPoolRefundO1: (orderId) => callApi('smspool.refundO1', { orderId }, { cache: false }),
    smsPoolGetStateO1: () => callApi('smspool.stateO1', {}, { cache: false }),
    smsPoolBalanceO1: () => callApi('smspool.balanceO1', {})
  };

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = createRunner(null, null);

  window.addEventListener('message', (event) => {
    const data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.source === 'sproutg-web' || data.type === 'STATUS_EVENT' || data.type === 'POINT_EVENT') {
      window.sproutg.postWebMessage(data);
    }
  });

  window.sproutg.onApplySettings((settings) => {
    window.postMessage({ source: 'sproutg-desktop', type: 'SETTINGS', payload: settings || {} }, '*');
  });

  function renderBridgeState(state) {
    const badge = document.getElementById('bridgeBadge');
    if (!badge) return;
    const status = state?.status || 'idle';
    badge.dataset.status = status;
    badge.textContent = `Bridge: ${status}`;
    badge.title = state?.error || state?.message || 'Bridge status';
  }

  window.addEventListener('DOMContentLoaded', () => {
    const badge = document.getElementById('bridgeBadge');
    if (badge) {
      badge.addEventListener('click', async () => {
        const state = await window.sproutg.getBridgeState().catch(() => null);
        if (state && state.status === 'ready') {
          window.sproutg.reloadWeb();
          return;
        }
        window.sproutg.openBridgeLogin();
      });
    }
  });

  window.sproutg.onBridgeState(renderBridgeState);
  window.sproutg.getBridgeState().then(renderBridgeState).catch(() => {});
})();
