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
    checkCompanyDuplicate: { action: 'company.checkDuplicate', payload: ([value]) => ({ value }) },
    addCompanyRow: { action: 'company.addRow', payload: ([values]) => ({ values }) },

    smspoolOrderO1: { action: 'smspool.orderO1', payload: () => ({}) },
    smspoolCheckO1: { action: 'smspool.checkO1', payload: ([orderId]) => ({ orderId }) },
    smspoolRefundO1: { action: 'smspool.refundO1', payload: ([orderId]) => ({ orderId }) },
    smspoolGetStateO1: { action: 'smspool.stateO1', payload: () => ({}) },
    smspoolBalanceO1: { action: 'smspool.balanceO1', payload: () => ({}) },
    heroSmsOrderO1: { action: 'herosms.orderO1', payload: () => ({}) },
    heroSmsCheckO1: { action: 'herosms.checkO1', payload: ([orderId]) => ({ orderId }) },
    heroSmsRefundO1: { action: 'herosms.refundO1', payload: ([orderId]) => ({ orderId }) },
    heroSmsGetStateO1: { action: 'herosms.stateO1', payload: () => ({}) },
    heroSmsBalanceO1: { action: 'herosms.balanceO1', payload: () => ({}) }
  };

  const readCache = new Map();
  let lastVersion = '';
  let pendingRequests = 0;
  let localQueuePending = 0;
  let savedTimer = null;

  const READ_ACTIONS = new Set([
    'meta.config', 'dropdown.maps',
    'o1.profileByName', 'o1.profileByRow', 'o1.profilesByRows', 'o1.appealRow', 'o1.lists', 'o1.workLists', 'o1.groupDateList', 'o1.cleanupList',
    'mcc.profile', 'mcc.overview', 'mcc.lists', 'mcc.stageList', 'mcc.workList', 'mcc.verificationPools',
    'apell.index', 'pass.lookupFios', 'company.formMeta', 'company.checkDuplicate',
    'smspool.checkO1', 'smspool.stateO1', 'smspool.balanceO1',
    'herosms.checkO1', 'herosms.stateO1', 'herosms.balanceO1'
  ]);

  function cacheKey(action, payload) {
    return `${action}:${JSON.stringify(payload || {})}`;
  }

  function normalizeError(err) {
    return { ok: false, error: err?.message || String(err || 'Unknown API error'), code: err?.code || 'CLIENT_ERROR' };
  }

  function setLoading(delta) {
    const wasBusy = Math.max(pendingRequests, localQueuePending) > 0;
    pendingRequests = Math.max(0, pendingRequests + delta);
    const totalPending = Math.max(0, pendingRequests, localQueuePending);
    const isBusy = totalPending > 0;
    document.documentElement.classList.toggle('api-busy', isBusy);
    const count = document.getElementById('apiPendingCount');
    if (count) {
      count.textContent = totalPending > 1 ? String(totalPending) : '';
      count.style.display = totalPending > 1 ? '' : 'none';
    }
    if (isBusy) {
      clearTimeout(savedTimer);
      document.documentElement.classList.remove('api-saved');
    } else if (wasBusy) {
      clearTimeout(savedTimer);
      document.documentElement.classList.remove('api-saved');
    }
  }

  window.addEventListener('sproutg-local-queue', (event) => {
    localQueuePending = Math.max(0, Number(event?.detail?.pending || 0));
    setLoading(0);
  });

  function isPriorityRead(action) {
    return READ_ACTIONS.has(action) && /^(o1\.profile|mcc\.profile|company\.formMeta|o1\.lists|mcc\.lists)/.test(String(action || ''));
  }

  function emitPriority(action, active) {
    if (!isPriorityRead(action)) return;
    window.dispatchEvent(new CustomEvent(active ? 'sproutg-api-priority-start' : 'sproutg-api-priority-end', { detail: { action } }));
  }

  async function callApi(action, payload = {}, opts = {}) {
    const useCache = opts.cache !== false && READ_ACTIONS.has(action);
    const key = useCache ? cacheKey(action, payload) : '';
    if (useCache && readCache.has(key)) return readCache.get(key);

    emitPriority(action, true);
    setLoading(1);
    try {
      const res = await window.sproutg.apiCall(action, payload, opts);
      if (res && res.version && lastVersion && res.version !== lastVersion) readCache.clear();
      if (res && res.version) lastVersion = res.version;
      if (useCache && res && res.ok) readCache.set(key, res);
      if (res && !res.ok && useCache && readCache.has(key)) return { ...readCache.get(key), stale: true, warning: res.error };
      return res;
    } finally {
      setLoading(-1);
      emitPriority(action, false);
    }
  }

  async function batchApi(calls = [], opts = {}) {
    setLoading(1);
    try {
      const res = await window.sproutg.apiBatch(calls, opts);
      if (res && res.version && lastVersion && res.version !== lastVersion) readCache.clear();
      if (res && res.version) lastVersion = res.version;
      return res;
    } finally {
      setLoading(-1);
    }
  }

  async function legacyCall(name, args) {
    const spec = LEGACY_TO_ACTION[name];
    if (!spec) return { ok: false, error: `Unknown legacy API method: ${name}`, code: 'UNKNOWN_LEGACY_METHOD' };
    const opts = name === 'addCompanyRow' ? { cache: false, timeoutMs: 60000 } : {};
    setLoading(1);
    try {
      return await window.sproutg.legacyCall(spec.action, spec.payload(Array.from(args || [])), opts);
    } catch (err) {
      return normalizeError(err);
    } finally {
      setLoading(-1);
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
    checkCompanyDuplicate: (value) => callApi('company.checkDuplicate', { value }),
    addCompanyRow: (values) => callApi('company.addRow', { values }, { cache: false, timeoutMs: 60000 }),
    smsPoolOrderO1: () => callApi('smspool.orderO1', {}, { cache: false }),
    smsPoolCheckO1: (orderId) => callApi('smspool.checkO1', { orderId }, { cache: false }),
    smsPoolRefundO1: (orderId) => callApi('smspool.refundO1', { orderId }, { cache: false }),
    smsPoolGetStateO1: () => callApi('smspool.stateO1', {}, { cache: false }),
    smsPoolBalanceO1: () => callApi('smspool.balanceO1', {}),
    heroSmsOrderO1: () => callApi('herosms.orderO1', {}, { cache: false }),
    heroSmsCheckO1: (orderId) => callApi('herosms.checkO1', { orderId }, { cache: false }),
    heroSmsRefundO1: (orderId) => callApi('herosms.refundO1', { orderId }, { cache: false }),
    heroSmsGetStateO1: () => callApi('herosms.stateO1', {}, { cache: false }),
    heroSmsBalanceO1: () => callApi('herosms.balanceO1', {})
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

  let latestBridgeState = null;
  let bridgePopup = null;

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatMs(ms) {
    const n = Number(ms || 0);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return n < 1000 ? `${Math.round(n)} мс` : `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} с`;
  }

  function secondsAgo(ts) {
    const n = Number(ts || 0);
    if (!n) return '—';
    const sec = Math.max(0, Math.round((Date.now() - n) / 1000));
    if (sec < 60) return `${sec} с назад`;
    const min = Math.round(sec / 60);
    return `${min} мин назад`;
  }

  function bridgeHealth(state) {
    const status = state?.status || 'idle';
    const m = state?.metrics || {};
    if (['error', 'disconnected', 'missing-url', 'login-required'].includes(status)) return 'bad';
    if (status === 'timeout') return 'bad';
    const total = Number(m.total || 0);
    const failed = Number(m.failed || 0);
    const ratio = total >= 5 ? failed / Math.max(1, total) : 0;
    if (Number(m.pending || 0) >= 8 || Number(m.queued || 0) >= 4 || Number(m.lastDurationMs || 0) > 9000 || Number(m.avgDurationMs || 0) > 6500 || ratio > 0.28) return 'bad';
    if (['connecting', 'reconnecting'].includes(status) || Number(m.pending || 0) >= 4 || Number(m.lastDurationMs || 0) > 4500 || Number(m.avgDurationMs || 0) > 3200 || ratio > 0.12) return 'warn';
    return state?.ready ? 'ok' : 'warn';
  }

  function renderBridgePopup(state = latestBridgeState) {
    if (!bridgePopup || !state) return;
    const m = state.metrics || {};
    const total = Number(m.total || 0);
    const ok = Number(m.ok || 0);
    const success = total ? Math.round((ok / Math.max(1, total)) * 100) : 0;
    const health = bridgeHealth(state);
    bridgePopup.dataset.health = health;
    bridgePopup.innerHTML = `
      <div class="bridgeStatusPopup__head">
        <b>${health === 'bad' ? 'Проблемы с подключением' : (health === 'warn' ? 'Подключение нестабильно' : 'Подключение стабильно')}</b>
        <span>${escapeHtml(state.status || 'idle')}</span>
      </div>
      <div class="bridgeStatusPopup__grid">
        <span>Последний запрос</span><b>${secondsAgo(m.lastFinishedAt || m.lastStartedAt)}</b>
        <span>Последняя задержка</span><b>${formatMs(m.lastDurationMs)}</b>
        <span>Средняя задержка</span><b>${formatMs(m.avgDurationMs)}</b>
        <span>Очередь</span><b>${Number(m.pending || 0)} / ${Number(m.queued || 0)}</b>
        <span>Успешность</span><b>${total ? `${success}% (${ok}/${total})` : '—'}</b>
        <span>Действие</span><b>${escapeHtml(m.lastAction || '—')}</b>
      </div>
      <div class="bridgeStatusPopup__message">${escapeHtml(state.error || state.message || '')}</div>
      <div class="bridgeStatusPopup__actions">
        <button type="button" data-bridge-action="reload">Переподключить</button>
        <button type="button" data-bridge-action="login">Вход</button>
      </div>
    `;
  }

  function toggleBridgePopup() {
    if (bridgePopup) {
      bridgePopup.remove();
      bridgePopup = null;
      return;
    }
    bridgePopup = document.createElement('div');
    bridgePopup.className = 'bridgeStatusPopup';
    document.body.appendChild(bridgePopup);
    bridgePopup.addEventListener('click', (event) => {
      const action = event.target?.closest?.('[data-bridge-action]')?.dataset?.bridgeAction;
      if (action === 'reload') window.sproutg.reloadWeb();
      if (action === 'login') window.sproutg.openBridgeLogin();
    });
    renderBridgePopup();
  }

  function renderBridgeState(state) {
    latestBridgeState = state || latestBridgeState;
    const badge = document.getElementById('bridgeBadge');
    if (!badge) return;
    const status = state?.status || 'idle';
    const marks = {
      idle: '...',
      connecting: '',
      reconnecting: '',
      ready: '✓',
      'login-required': '!',
      timeout: '',
      error: '!',
      disconnected: '×',
      'missing-url': 'URL'
    };
    const details = {
      idle: 'Подключение к Google Таблице ещё не началось.',
      connecting: 'Подключаемся к сервису Google Таблицы.',
      reconnecting: 'Переподключаемся к Google Таблице.',
      ready: 'Подключение к Google Таблице активно.',
      'login-required': 'Нужен вход в Google. Нажмите, чтобы открыть окно авторизации.',
      timeout: 'Google Таблица отвечает медленно. Запрос будет повторён.',
      error: 'Ошибка подключения к Google Таблице.',
      disconnected: 'Подключение отключено. Нажмите, чтобы переподключиться.',
      'missing-url': 'Не задан URL подключения к Google Таблице.'
    };
    badge.dataset.status = status;
    badge.dataset.health = bridgeHealth(state);
    badge.innerHTML = '<span class="bridgeBadge__label">Статус:</span><span class="bridgeBadge__mark" aria-hidden="true"></span>';
    const mark = badge.querySelector('.bridgeBadge__mark');
    if (mark) {
      const busy = status === 'connecting' || status === 'reconnecting' || status === 'timeout';
      mark.classList.toggle('bridgeBadge__spinner', busy);
      mark.textContent = busy ? '' : (marks[status] || '...');
    }
    badge.title = state?.error || details[status] || state?.message || 'Статус подключения к Google Таблице';
    renderBridgePopup(state);
  }

  function showNotice(payload) {
    const box = document.createElement('div');
    box.className = 'desktopNotice';
    if (payload?.type) box.dataset.type = String(payload.type);
    box.innerHTML = `<b>${payload?.title || 'SproutG'}</b><span>${payload?.body || ''}</span>`;
    document.body.appendChild(box);
    const close = () => {
      box.classList.remove('show');
      setTimeout(() => box.remove(), 220);
    };
    if (payload?.dismissible !== false) box.addEventListener('click', close, { once:true });
    requestAnimationFrame(() => box.classList.add('show'));
    setTimeout(() => {
      close();
    }, Math.max(1000, Number(payload?.durationMs || 6500)));
  }

  window.addEventListener('DOMContentLoaded', () => {
    const badge = document.getElementById('bridgeBadge');
    if (badge) {
      badge.addEventListener('click', async (event) => {
        event.stopPropagation();
        const state = await window.sproutg.getBridgeState().catch(() => null);
        if (state) renderBridgeState(state);
        toggleBridgePopup();
      });
    }
    document.addEventListener('pointerdown', (event) => {
      if (!bridgePopup) return;
      const badgeEl = document.getElementById('bridgeBadge');
      if (bridgePopup.contains(event.target) || badgeEl?.contains(event.target)) return;
      bridgePopup.remove();
      bridgePopup = null;
    }, true);
  });

  window.sproutg.onBridgeState(renderBridgeState);
  window.sproutg.onNotice(showNotice);
  window.sproutg.getBridgeState().then(renderBridgeState).catch(() => {});
})();
