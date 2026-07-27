(function () {
  function smsOwnedOptions(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
      ...input,
      ownerIdentity:{
        profileName:String(input.ownerIdentity?.profileName || '').trim()
      }
    };
  }

  const smsPoolOrderSpec = {
    action:'smspool.orderO1',
    payload:([options])=>smsOwnedOptions(options)
  };
  const smsPoolCheckSpec = {
    action:'smspool.checkO1',
    payload:([orderId, options])=>({ ...smsOwnedOptions(options), orderId })
  };
  const smsPoolRefundSpec = {
    action:'smspool.refundO1',
    payload:([orderId, options])=>({ ...smsOwnedOptions(options), orderId })
  };
  const smsPoolStateSpec = {
    action:'smspool.stateO1',
    payload:([options])=>smsOwnedOptions(options)
  };

  const LEGACY_TO_ACTION = {
    findProfile: { action: 'o1.profileByName', payload: ([profileName]) => ({ profileName }) },
    getProfileByRow: { action: 'o1.profileByRow', payload: ([row, identity]) => ({ row, identity }) },
    getO1AppealRowData: { action: 'o1.appealRow', payload: ([row, identity]) => ({ row, identity }) },
    getProfilesByRows: { action: 'o1.profilesByRows', payload: ([rows]) => ({ rows }) },
    listProfilesForCleanup: { action: 'o1.cleanupList', payload: ([limit]) => ({ limit }) },
    listProfilesByGroupDate: { action: 'o1.groupDateList', payload: ([group, fromIso, toIso, limit]) => ({ group, fromIso, toIso, limit }) },
    getWorkLists: { action: 'o1.workLists', payload: ([mode, fromIso, toIso]) => ({ mode, fromIso, toIso }) },
    updateCell: { action: 'o1.updateCells', payload: ([row, col, value, identity]) => ({ row, updates: { [String(col || '').toUpperCase()]: value }, identity }) },
    updateCells: { action: 'o1.updateCells', payload: ([row, updates, identity]) => ({ row, updates, identity }) },
    updateProxyFromValue: { action: 'o1.proxyFields', payload: ([row, value, identity]) => ({ row, value, identity }) },
    toggleProfileDeleted: { action: 'o1.toggleDeleted', payload: ([row, enabled, identity]) => ({ row, enabled, identity }) },
    setGroupNumber: { action: 'o1.setNumber', payload: ([row, group, enabled, identity]) => ({ row, group, enabled, identity }) },

    getMccProfile: { action: 'mcc.profile', payload: ([profileName]) => ({ profileName }) },
    listMccProfilesByStageDate: { action: 'mcc.stageList', payload: ([stage, fromIso, toIso, limit]) => ({ stage, fromIso, toIso, limit }) },
    getMccWorkFilter: { action: 'mcc.workList', payload: ([mode, limit]) => ({ mode, limit }) },
    getMccProfilesOverview: { action: 'mcc.overview', payload: ([limit]) => ({ limit }) },
    getMccVerificationDropdownPools: { action: 'mcc.verificationPools', payload: () => ({}) },
    updateMccCell: { action: 'mcc.updateCells', payload: ([row, col, value, identity]) => ({ row, updates: { [String(col || '').toUpperCase()]: value }, identity }) },
    updateMccCells: { action: 'mcc.updateCells', payload: ([row, updates, identity]) => ({ row, updates, identity }) },
    mccSetUnderReviewBg: { action: 'mcc.setUnderReviewBg', payload: ([row, identity]) => ({ row, identity }) },
    updateMccProxyFromValue: { action: 'mcc.proxyFields', payload: ([row, value, identity]) => ({ row, value, identity }) },
    updateMccProfileName: { action: 'mcc.updateProfileName', payload: ([rows, value, oldProfileName]) => ({ rows, value, oldProfileName }) },
    toggleMccProfileDeleted: { action: 'mcc.toggleProfileDeleted', payload: ([profileName, enabled]) => ({ profileName, enabled }) },
    toggleMccAccountDeleted: { action: 'mcc.toggleAccountDeleted', payload: ([row, enabled, identity]) => ({ row, enabled, identity }) },

    getApellDataIndex: { action: 'apell.index', payload: ([options]) => (options || {}) },
    getPassLookupForFios: { action: 'pass.lookupFios', payload: ([fios]) => ({ fios }) },
    getPassCatalog: { action: 'pass.catalog', payload: ([geos]) => ({ geos }) },
    updatePassCell: { action: 'pass.updateCell', payload: ([row, col, value, identity]) => ({ row, col, value, identity }) },
    getCompanyFormMeta: { action: 'company.formMeta', payload: () => ({}) },
    checkCompanyDuplicate: { action: 'company.checkDuplicate', payload: ([value]) => ({ value }) },
    addCompanyRow: { action: 'company.addRow', payload: ([values]) => ({ values }) },

    smsPoolOrderO1: smsPoolOrderSpec,
    smsPoolCheckO1: smsPoolCheckSpec,
    smsPoolRefundO1: smsPoolRefundSpec,
    smsPoolGetStateO1: smsPoolStateSpec,
    smspoolOrderO1: smsPoolOrderSpec,
    smspoolCheckO1: smsPoolCheckSpec,
    smspoolRefundO1: smsPoolRefundSpec,
    smspoolGetStateO1: smsPoolStateSpec,
    smspoolBalanceO1: { action: 'smspool.balanceO1', payload: () => ({}) },
    heroSmsOrderO1: { action: 'herosms.orderO1', payload: ([options]) => smsOwnedOptions(options) },
    heroSmsCheckO1: { action: 'herosms.checkO1', payload: ([orderId, options]) => ({ ...smsOwnedOptions(options), orderId }) },
    heroSmsRefundO1: { action: 'herosms.refundO1', payload: ([orderId, options]) => ({ ...smsOwnedOptions(options), orderId }) },
    heroSmsGetStateO1: { action: 'herosms.stateO1', payload: ([options]) => smsOwnedOptions(options) },
    heroSmsBalanceO1: { action: 'herosms.balanceO1', payload: () => ({}) }
  };

  const readCache = new Map();
  const inflightReads = new Map();
  const READ_CACHE_MAX_ENTRIES = 200;
  const DEFAULT_READ_TTL_MS = 15000;
  const DEFAULT_READ_STALE_MS = 30000;
  let cacheGeneration = 0;
  let lastVersion = '';
  let pendingRequests = 0;
  let pendingMutations = 0;
  let localQueuePending = 0;
  let lastQueueConfirmationRevision = 0;
  let savedTimer = null;

  const READ_ACTIONS = new Set([
    'meta.config', 'dropdown.maps',
    'o1.profileByName', 'o1.profileByRow', 'o1.profilesByRows', 'o1.appealRow', 'o1.lists', 'o1.workLists', 'o1.groupDateList', 'o1.cleanupList', 'o1.proxyFields',
    'mcc.profile', 'mcc.overview', 'mcc.lists', 'mcc.stageList', 'mcc.workList', 'mcc.verificationPools', 'mcc.proxyFields',
    'apell.index', 'pass.lookupFios', 'pass.catalog', 'company.formMeta', 'company.checkDuplicate',
    'smspool.balanceO1',
    'herosms.balanceO1'
  ]);
  const DURABLE_ACTIONS = new Set([
    'o1.updateCells', 'mcc.updateCells', 'pass.updateCell',
    'o1.toggleDeleted', 'o1.setNumber',
    'mcc.setUnderReviewBg', 'mcc.updateProfileName',
    'mcc.toggleProfileDeleted', 'mcc.toggleAccountDeleted',
    'company.addRow'
  ]);
  const DURABLE_FAILURES_KEY = 'sproutg:durableApiFailures:v1';
  const RETRYABLE_LOCAL_WRITE_CODES = new Set([
    'BRIDGE_ERROR',
    'CLIENT_ERROR',
    'MISSING_WRITE_ENDPOINT',
    'WRITE_GATE_CLOSED',
    'WRITE_PERSIST_FAILED',
    'WRITE_QUEUE_INTEGRITY_BLOCKED',
    'LOCAL_STORE_INTEGRITY_BLOCKED'
  ]);
  const durableTargetApi = window.SproutgDurableFailureTargets;
  if (!durableTargetApi || typeof durableTargetApi.entries !== 'function') {
    throw new Error('Durable failure target helper is unavailable');
  }
  const durableFailures = new Map();
  const latestDurableAttempt = new Map();
  let durableAttemptSequence = 0;
  let durableFailureIntegrityBlocked = false;
  let durableFailureIntegrityError = '';
  let durableFailureQuarantineKey = '';
  function publishDurableFailureIntegrity() {
    const risk = durableFailureIntegrityBlocked || !!durableFailureIntegrityError ? 1 : 0;
    window.__sproutgDurableFailureIntegrityRisk = risk;
    window.__sproutgDurableFailureIntegrityError = durableFailureIntegrityError;
    window.__sproutgDurableFailurePending = durableFailures.size + risk;
  }
  try {
    const raw = localStorage.getItem(DURABLE_FAILURES_KEY);
    const stored = JSON.parse(raw || '[]');
    if (!Array.isArray(stored)) throw new Error('Durable failure journal is not an array');
    if (stored.some((item) => (
      !item
      || typeof item !== 'object'
      || !String(item.action || '').trim()
      || !item.payload
      || typeof item.payload !== 'object'
    ))) {
      throw new Error('Durable failure journal contains unsupported records');
    }
    const normalized = durableTargetApi.normalizeRecords(stored);
    for (const item of normalized) {
      if (item?.key) durableFailures.set(String(item.key), item);
    }
  } catch (error) {
    let raw = null;
    try {
      raw = localStorage.getItem(DURABLE_FAILURES_KEY);
      if (raw != null) {
        durableFailureQuarantineKey = `${DURABLE_FAILURES_KEY}:quarantine:${Date.now()}`;
        localStorage.setItem(durableFailureQuarantineKey, raw);
        if (localStorage.getItem(durableFailureQuarantineKey) !== raw) {
          throw new Error('durable failure quarantine verification failed');
        }
      }
    } catch (quarantineError) {
      durableFailureQuarantineKey = '';
      durableFailureIntegrityError = `Quarantine failed: ${quarantineError?.message || quarantineError}`;
    }
    durableFailureIntegrityBlocked = true;
    durableFailureIntegrityError = [
      String(error?.message || error),
      durableFailureIntegrityError
    ].filter(Boolean).join('; ');
  }
  publishDurableFailureIntegrity();

  function beginDurableAttempt(action, payload) {
    if (!DURABLE_ACTIONS.has(action)) return null;
    const targets = durableTargetApi.entries(action, payload);
    const token = ++durableAttemptSequence;
    for (const target of targets) latestDurableAttempt.set(target.key, token);
    return { targets, token };
  }

  function persistDurableFailures() {
    if (durableFailureIntegrityBlocked) {
      durableFailureIntegrityError = (
        'Unreadable durable failure journal is preserved without overwrite'
        + (durableFailureQuarantineKey ? ` (${durableFailureQuarantineKey})` : '')
      );
      publishDurableFailureIntegrity();
      return false;
    }
    try {
      const serialized = JSON.stringify(Array.from(durableFailures.values()));
      localStorage.setItem(DURABLE_FAILURES_KEY, serialized);
      if (localStorage.getItem(DURABLE_FAILURES_KEY) !== serialized) {
        throw new Error('durable failure journal verification failed');
      }
      durableFailureIntegrityError = '';
      publishDurableFailureIntegrity();
      return true;
    } catch (error) {
      durableFailureIntegrityError = String(error?.message || error);
      publishDurableFailureIntegrity();
      return false;
    }
  }

  function updateDurableFailure(action, payload, result, attempt = null) {
    if (!DURABLE_ACTIONS.has(action)) return;
    const targets = attempt?.targets || durableTargetApi.entries(action, payload);
    let changed = false;
    for (const target of targets) {
      if (attempt && latestDurableAttempt.get(target.key) !== attempt.token) continue;
      if (result && result.ok !== false) {
        changed = durableFailures.delete(target.key) || changed;
        continue;
      }
      if (!RETRYABLE_LOCAL_WRITE_CODES.has(String(result?.code || ''))) {
        changed = durableFailures.delete(target.key) || changed;
        continue;
      }
      durableFailures.set(target.key, {
        ...target,
        error:String(result?.error || 'Write was not accepted'),
        updatedAt:Date.now()
      });
      changed = true;
    }
    if (changed) persistDurableFailures();
  }

  let durableFailureRecovery = null;
  window.sproutgRetryDurableFailures = function retryDurableFailures() {
    if (durableFailureRecovery) return durableFailureRecovery;
    durableFailureRecovery = (async () => {
      for (const item of Array.from(durableFailures.values())) {
        const attempt = beginDurableAttempt(item.action, item.payload);
        try {
          const result = await window.sproutg.apiCall(item.action, item.payload || {}, { cache:false });
          updateDurableFailure(item.action, item.payload, result, attempt);
        } catch (_error) {}
      }
      return durableFailures.size;
    })().finally(() => { durableFailureRecovery = null; });
    return durableFailureRecovery;
  };

  function cachePolicy(action) {
    const name = String(action || '');
    if (name === 'company.checkDuplicate') return { ttlMs: 2000, staleMs: 5000 };
    if (/^(o1\.profile|mcc\.profile)/.test(name)) return { ttlMs: 5000, staleMs: 15000 };
    if (
      name === 'meta.config' ||
      name === 'dropdown.maps' ||
      name === 'company.formMeta' ||
      name === 'o1.lists' ||
      name === 'mcc.lists' ||
      name === 'mcc.verificationPools'
    ) {
      return { ttlMs: 60000, staleMs: 60000 };
    }
    if (/^(smspool|herosms)\.(checkO1|stateO1|balanceO1)$/.test(name)) {
      return { ttlMs: 3000, staleMs: 10000 };
    }
    return { ttlMs: DEFAULT_READ_TTL_MS, staleMs: DEFAULT_READ_STALE_MS };
  }

  function cacheKey(action, payload) {
    return `${action}:${JSON.stringify(payload || {})}`;
  }

  function invalidateReadCache() {
    cacheGeneration += 1;
    readCache.clear();
  }

  function pruneReadCache(now = Date.now()) {
    for (const [key, entry] of readCache) {
      if (!entry || entry.generation !== cacheGeneration || now > entry.staleUntil) {
        readCache.delete(key);
      }
    }
    while (readCache.size > READ_CACHE_MAX_ENTRIES) {
      const oldestKey = readCache.keys().next().value;
      if (oldestKey === undefined) break;
      readCache.delete(oldestKey);
    }
  }

  function readCacheState(key, now = Date.now()) {
    const entry = readCache.get(key);
    if (!entry) return { fresh: null, stale: null };
    if (entry.generation !== cacheGeneration || now > entry.staleUntil) {
      readCache.delete(key);
      return { fresh: null, stale: null };
    }
    readCache.delete(key);
    readCache.set(key, entry);
    return now <= entry.expiresAt
      ? { fresh: entry, stale: null }
      : { fresh: null, stale: entry };
  }

  function storeReadCache(key, action, value, now = Date.now()) {
    const policy = cachePolicy(action);
    const entry = {
      value,
      expiresAt: now + policy.ttlMs,
      staleUntil: now + policy.ttlMs + policy.staleMs,
      generation: cacheGeneration
    };
    readCache.delete(key);
    readCache.set(key, entry);
    pruneReadCache(now);
  }

  function staleFallback(entry, error) {
    if (
      !entry ||
      entry.generation !== cacheGeneration ||
      Date.now() > Number(entry.staleUntil || 0)
    ) {
      return null;
    }
    const warning = error?.error || error?.message || String(error || 'Recent cached data was used');
    const value = entry.value;
    if (value && typeof value === 'object') return { ...value, stale: true, warning };
    return { ok: true, data: value, stale: true, warning };
  }

  function isSuccessfulResult(result) {
    return !!result && result.ok !== false;
  }

  function observeVersion(result) {
    const version = String(result?.version || '').trim();
    if (!version) return;
    if (lastVersion && version !== lastVersion) invalidateReadCache();
    lastVersion = version;
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

  function setMutationPending(delta) {
    pendingMutations = Math.max(0, pendingMutations + Number(delta || 0));
    window.__sproutgMutationPending = pendingMutations;
    window.dispatchEvent(new CustomEvent('sproutg-mutation-pending', {
      detail: { pending: pendingMutations }
    }));
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

  async function performApiCall(action, payload, opts, cacheContext) {
    const durableAttempt = beginDurableAttempt(action, payload);
    try {
      const res = await window.sproutg.apiCall(action, payload, opts);
      updateDurableFailure(action, payload, res, durableAttempt);
      observeVersion(res);

      if (!READ_ACTIONS.has(action) && isSuccessfulResult(res)) {
        invalidateReadCache();
      }

      if (cacheContext?.useCache && res?.ok === true) {
        if (cacheContext.generation === cacheGeneration) {
          storeReadCache(cacheContext.key, action, res);
        }
      } else if (cacheContext?.useCache && res && res.ok === false) {
        const stale = staleFallback(cacheContext.staleEntry, res);
        if (stale) return stale;
      }
      return res;
    } catch (error) {
      updateDurableFailure(action, payload, normalizeError(error), durableAttempt);
      if (cacheContext?.useCache) {
        const stale = staleFallback(cacheContext.staleEntry, error);
        if (stale) return stale;
      }
      throw error;
    }
  }

  async function callApi(action, payload = {}, opts = {}) {
    const requestOpts = opts && typeof opts === 'object' ? opts : {};
    const useCache = requestOpts.cache !== false && READ_ACTIONS.has(action);
    const key = useCache ? cacheKey(action, payload) : '';
    let staleEntry = null;
    if (useCache) {
      const cached = readCacheState(key);
      if (cached.fresh) return cached.fresh.value;
      staleEntry = cached.stale;
    }

    emitPriority(action, true);
    const mutation = !READ_ACTIONS.has(action);
    if (mutation) setMutationPending(1);
    setLoading(1);
    try {
      if (!useCache) {
        return await performApiCall(action, payload, requestOpts, { useCache: false });
      }

      const currentFlight = inflightReads.get(key);
      if (currentFlight && currentFlight.generation === cacheGeneration) {
        return await currentFlight.promise;
      }

      const generation = cacheGeneration;
      const flight = {
        generation,
        promise: performApiCall(action, payload, requestOpts, {
          useCache: true,
          key,
          staleEntry,
          generation
        })
      };
      inflightReads.set(key, flight);
      flight.promise.then(
        () => {
          if (inflightReads.get(key) === flight) inflightReads.delete(key);
        },
        () => {
          if (inflightReads.get(key) === flight) inflightReads.delete(key);
        }
      );
      return await flight.promise;
    } finally {
      setLoading(-1);
      if (mutation) setMutationPending(-1);
      emitPriority(action, false);
    }
  }

  async function batchApi(calls = [], opts = {}) {
    setLoading(1);
    try {
      const res = await window.sproutg.apiBatch(calls, opts);
      observeVersion(res);
      const hasMutation = (Array.isArray(calls) ? calls : [])
        .some((call) => !READ_ACTIONS.has(String(call?.action || '')));
      if (hasMutation && isSuccessfulResult(res)) invalidateReadCache();
      return res;
    } finally {
      setLoading(-1);
    }
  }

  async function legacyCall(name, args) {
    const spec = LEGACY_TO_ACTION[name];
    if (!spec) return { ok: false, error: `Unknown legacy API method: ${name}`, code: 'UNKNOWN_LEGACY_METHOD' };
    const opts = name === 'addCompanyRow' ? { cache: false, timeoutMs: 60000 } : {};
    const payload = spec.payload(Array.from(args || []));
    const durableAttempt = beginDurableAttempt(spec.action, payload);
    const mutation = !READ_ACTIONS.has(spec.action);
    if (mutation) setMutationPending(1);
    setLoading(1);
    try {
      const res = await window.sproutg.legacyCall(spec.action, payload, opts);
      updateDurableFailure(spec.action, payload, res, durableAttempt);
      observeVersion(res);
      if (!READ_ACTIONS.has(spec.action) && isSuccessfulResult(res)) invalidateReadCache();
      return res;
    } catch (err) {
      const normalized = normalizeError(err);
      updateDurableFailure(spec.action, payload, normalized, durableAttempt);
      return normalized;
    } finally {
      setLoading(-1);
      if (mutation) setMutationPending(-1);
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
    invalidate: invalidateReadCache,
    findO1Profile: (profileName) => callApi('o1.profileByName', { profileName }),
    getO1ProfileByRow: (row, identity) => callApi('o1.profileByRow', { row, identity }),
    getO1ProfilesByRows: (rows) => callApi('o1.profilesByRows', { rows }),
    updateO1Cells: (row, updates, identity) => callApi('o1.updateCells', { row, updates, identity }, { cache: false }),
    toggleO1Deleted: (row, enabled, identity) => callApi('o1.toggleDeleted', { row, enabled, identity }, { cache: false }),
    setO1Number: (row, group, enabled, identity) => callApi('o1.setNumber', { row, group, enabled, identity }, { cache: false }),
    getO1WorkLists: (mode, fromIso, toIso) => callApi('o1.workLists', { mode, fromIso, toIso }),
    listO1ProfilesByGroupDate: (group, fromIso, toIso, limit) => callApi('o1.groupDateList', { group, fromIso, toIso, limit }),
    listO1Cleanup: (limit) => callApi('o1.cleanupList', { limit }),
    getMccProfile: (profileName) => callApi('mcc.profile', { profileName }),
    updateMccCells: (row, updates, identity) => callApi('mcc.updateCells', { row, updates, identity }, { cache: false }),
    toggleMccProfileDeleted: (profileName, enabled) => callApi('mcc.toggleProfileDeleted', { profileName, enabled }, { cache: false }),
    toggleMccAccountDeleted: (row, enabled, identity) => callApi('mcc.toggleAccountDeleted', { row, enabled, identity }, { cache: false }),
    setMccUnderReview: (row, identity) => callApi('mcc.setUnderReviewBg', { row, identity }, { cache: false }),
    updateMccProfileName: (rows, value, oldProfileName) => callApi(
      'mcc.updateProfileName',
      { rows, value, oldProfileName },
      { cache: false }
    ),
    getMccStageFilter: (stage, fromIso, toIso, limit) => callApi('mcc.stageList', { stage, fromIso, toIso, limit }),
    getMccWorkFilter: (mode, limit) => callApi('mcc.workList', { mode, limit }),
    getMccOverview: (limit) => callApi('mcc.overview', { limit }),
    getApellDataIndex: (force) => callApi('apell.index', { force }),
    getO1AppealRowData: (row, identity) => callApi('o1.appealRow', { row, identity }),
    getPassLookupForFios: (fios) => callApi('pass.lookupFios', { fios }),
    getPassCatalog: (geos) => callApi('pass.catalog', { geos }, { cache: false }),
    updatePassCell: (row, col, value, identity) => callApi('pass.updateCell', { row, col, value, identity }, { cache: false }),
    getMccVerificationDropdownPools: () => callApi('mcc.verificationPools', {}),
    getCompanyFormMeta: () => callApi('company.formMeta', {}),
    checkCompanyDuplicate: (value) => callApi('company.checkDuplicate', { value }),
    addCompanyRow: (values) => callApi('company.addRow', { values }, { cache: false, timeoutMs: 60000 }),
    smsPoolOrderO1: (options) => callApi('smspool.orderO1', smsOwnedOptions(options), { cache: false }),
    smsPoolCheckO1: (orderId, options) => callApi('smspool.checkO1', { ...smsOwnedOptions(options), orderId }, { cache: false }),
    smsPoolRefundO1: (orderId, options) => callApi('smspool.refundO1', { ...smsOwnedOptions(options), orderId }, { cache: false }),
    smsPoolGetStateO1: (options) => callApi('smspool.stateO1', smsOwnedOptions(options), { cache: false }),
    smsPoolBalanceO1: () => callApi('smspool.balanceO1', {}),
    heroSmsOrderO1: (options) => callApi('herosms.orderO1', smsOwnedOptions(options), { cache: false }),
    heroSmsCheckO1: (orderId, options) => callApi('herosms.checkO1', { ...smsOwnedOptions(options), orderId }, { cache: false }),
    heroSmsRefundO1: (orderId, options) => callApi('herosms.refundO1', { ...smsOwnedOptions(options), orderId }, { cache: false }),
    heroSmsGetStateO1: (options) => callApi('herosms.stateO1', smsOwnedOptions(options), { cache: false }),
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
    const q = state?.writeQueue || {};
    if (state?.storageIntegrity?.active) return 'bad';
    if (
      Number(q.blocked || 0) > 0
      || Number(q.blockedEndpoint || 0) > 0
      || Number(q.blockedBackend || 0) > 0
    ) return 'bad';
    if (['error', 'disconnected', 'missing-url', 'login-required'].includes(status)) return 'bad';
    if (status === 'timeout') return 'bad';
    const total = Number(m.total || 0);
    const failed = Number(m.failed || 0);
    const ratio = total >= 5 ? failed / Math.max(1, total) : 0;
    if (Number(m.pending || 0) >= 8 || Number(m.queued || 0) >= 4 || Number(m.lastDurationMs || 0) > 9000 || Number(m.avgDurationMs || 0) > 6500 || ratio > 0.28) return 'bad';
    if (Number(q.pending || 0) > 0 || ['connecting', 'reconnecting'].includes(status) || Number(m.pending || 0) >= 4 || Number(m.lastDurationMs || 0) > 4500 || Number(m.avgDurationMs || 0) > 3200 || ratio > 0.12) return 'warn';
    return state?.ready ? 'ok' : 'warn';
  }

  function renderBridgePopup(state = latestBridgeState) {
    if (!bridgePopup || !state) return;
    const m = state.metrics || {};
    const q = state.writeQueue || {};
    const total = Number(m.total || 0);
    const ok = Number(m.ok || 0);
    const success = total ? Math.round((ok / Math.max(1, total)) * 100) : 0;
    const health = bridgeHealth(state);
    const backendBlocked = Number(q.blockedBackend || 0);
    const backendVersion = String(q.backendVersion || state.bridgeVersion || '—');
    const minimumBackendVersion = String(q.minimumWriteBackendVersion || '2.3.0');
    const storageIntegrity = state.storageIntegrity || q.storageIntegrity || {};
    const bridgeMessage = storageIntegrity.active
      ? String(storageIntegrity.message || 'Локальное хранилище требует восстановления.')
      : backendBlocked > 0
      ? `Apps Script ${backendVersion} устарел: ${backendBlocked} записей безопасно удерживаются локально. Разверните Apps Script ${minimumBackendVersion} и нажмите «Переподключить».`
      : (q.lastError || state.error || state.message || '');
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
        <span>Надёжная запись</span><b>${Number(q.pending || 0)} (${Number(q.blocked || 0)} ошибок)</b>
        <span>Локальные данные</span><b>${storageIntegrity.active ? 'ТРЕБУЮТ ВОССТАНОВЛЕНИЯ' : 'OK'}</b>
        <span>Apps Script</span><b>${escapeHtml(backendVersion)} / ≥ ${escapeHtml(minimumBackendVersion)}</b>
        <span>Успешность</span><b>${total ? `${success}% (${ok}/${total})` : '—'}</b>
        <span>Действие</span><b>${escapeHtml(m.lastAction || '—')}</b>
      </div>
      <div class="bridgeStatusPopup__message">${escapeHtml(bridgeMessage)}</div>
      <div class="bridgeStatusPopup__actions">
        <button type="button" data-bridge-action="reload">Переподключить</button>
        <button type="button" data-bridge-action="login">Вход</button>
        ${Number(q.blocked || 0) > 0 ? `
          <button type="button" data-bridge-action="retry-blocked">Повторить блокированные</button>
          <button type="button" data-bridge-action="archive-blocked">Архивировать и убрать</button>
        ` : ''}
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
      if (action === 'reload') {
        window.sproutg.reconnectBridge().then((result)=>{
          if(result?.ok === false) showNotice({
            type:'error',
            title:'Переподключение отложено',
            body:result.error || 'Не удалось безопасно переподключить Google Таблицу'
          });
        }).catch((error)=>showNotice({
          type:'error',
          title:'Ошибка переподключения',
          body:String(error?.message || error)
        }));
      }
      if (action === 'login') window.sproutg.openBridgeLogin();
      if (action === 'retry-blocked') {
        if (!confirm('Повторить все блокированные записи после ручной проверки причин?')) return;
        window.sproutg.retryBlockedWrites().then((result)=>{
          showNotice({
            type:result?.ok === false ? 'error' : 'success',
            title:result?.ok === false ? 'Повтор не запущен' : 'Повтор запущен',
            body:result?.ok === false
              ? result.error
              : `Разблокировано записей: ${Number(result?.retried || 0)}`
          });
        }).catch((error)=>showNotice({
          type:'error',
          title:'Ошибка повтора',
          body:String(error?.message || error)
        }));
      }
      if (action === 'archive-blocked') {
        if (!confirm('Сохранить блокированные записи в проверяемый архив и убрать их из очереди?')) return;
        window.sproutg.archiveBlockedWrites().then((result)=>{
          showNotice({
            type:result?.ok === false ? 'error' : 'success',
            title:result?.ok === false ? 'Архивация не выполнена' : 'Записи архивированы',
            body:result?.ok === false
              ? result.error
              : `${Number(result?.archived || 0)} записей. Архив: ${result?.path || 'не создан'}`
          });
        }).catch((error)=>showNotice({
          type:'error',
          title:'Ошибка архивации',
          body:String(error?.message || error)
        }));
      }
    });
    renderBridgePopup();
  }

  function renderBridgeState(state) {
    latestBridgeState = state || latestBridgeState;
    if (state?.writeQueue) {
      const confirmationRevision = Number(
        state.writeQueue.confirmationRevision || 0
      );
      if (confirmationRevision > lastQueueConfirmationRevision) {
        lastQueueConfirmationRevision = confirmationRevision;
        invalidateReadCache();
      }
      window.dispatchEvent(new CustomEvent('sproutg-write-queue-state', {
        detail:state.writeQueue
      }));
    }
    const badge = document.getElementById('bridgeBadge');
    if (!badge) return;
    const status = state?.status || 'idle';
    const queue = state?.writeQueue || {};
    const storageIntegrity = state?.storageIntegrity || queue.storageIntegrity || {};
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
      if (busy) mark.textContent = '';
      else if (
        storageIntegrity.active
        ||
        Number(queue.blocked || 0) > 0
        || Number(queue.blockedEndpoint || 0) > 0
        || Number(queue.blockedBackend || 0) > 0
      ) mark.textContent = '!';
      else if (Number(queue.pending || 0) > 0) mark.textContent = String(queue.pending);
      else mark.textContent = marks[status] || '...';
    }
    badge.title = (storageIntegrity.active
      ? String(storageIntegrity.message || 'Локальное хранилище требует восстановления')
      : '')
      || (Number(queue.blockedBackend || 0) > 0
      ? `Apps Script ${queue.backendVersion || state.bridgeVersion || 'не определён'} ниже ${queue.minimumWriteBackendVersion || '2.3.0'}; локально ожидают ${Number(queue.blockedBackend || 0)} записей`
      : '')
      || queue.lastError
      || (Number(queue.pending || 0) > 0 ? `Ожидают сохранения: ${Number(queue.pending || 0)}` : '')
      || state?.error
      || details[status]
      || state?.message
      || 'Статус подключения к Google Таблице';
    renderBridgePopup(state);
  }

  function showNotice(payload) {
    const box = document.createElement('div');
    box.className = 'desktopNotice';
    if (payload?.type) box.dataset.type = String(payload.type);
    const title = document.createElement('b');
    title.textContent = String(payload?.title || 'SproutG');
    const body = document.createElement('span');
    body.textContent = String(payload?.body || '');
    box.appendChild(title);
    box.appendChild(body);
    document.body.appendChild(box);
    const close = () => {
      box.classList.remove('show');
      setTimeout(() => box.remove(), 220);
    };
    if (payload?.dismissible !== false) box.addEventListener('click', close, { once:true });
    requestAnimationFrame(() => box.classList.add('show'));
    const hasDuration = Object.prototype.hasOwnProperty.call(payload || {}, 'durationMs');
    const durationMs = hasDuration ? Number(payload.durationMs) : 6500;
    if (Number.isFinite(durationMs) && durationMs > 0) {
      setTimeout(close, Math.max(1000, durationMs));
    }
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
