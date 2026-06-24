const $ = (id) => document.getElementById(id);

let __btnLock = { stats:false, settings:false };
function lockBtn(key, ms=220){
  if (__btnLock[key]) return false;
  __btnLock[key] = true;
  setTimeout(() => { __btnLock[key] = false; }, ms);
  return true;
}

$('btnHome').addEventListener('click', () => toggleHomeScreen());
$('btnCompany').addEventListener('click', () => window.sproutg.openCompany());
$('btnStats').addEventListener('click', () => { if (!lockBtn('stats')) return; window.sproutg.openStats(); });
$('btnSettings').addEventListener('click', () => { if (!lockBtn('settings')) return; window.sproutg.openSettings(); });
$('btnMin').addEventListener('click', () => window.sproutg.windowControl('minimize'));
$('btnMax').addEventListener('click', () => window.sproutg.windowControl('maximize-toggle'));
$('btnClose').addEventListener('click', () => window.sproutg.windowControl('close'));

let __themeSwitchTimer = null;
const DESKTOP_THEME_ALIASES = { dark:'dark-classic', light:'light-classic', 'midnight-pro':'dark-midnight-pro', forest:'dark-forest', 'cyberpunk-neon':'cyberpunk' };
function normalizeDesktopTheme(theme){
  return DESKTOP_THEME_ALIASES[String(theme || '')] || String(theme || '') || 'dark-classic';
}
function setTopbarTheme(theme){
  const normalized = normalizeDesktopTheme(theme);
  document.documentElement.style.removeProperty('--topbar-bg');
  document.documentElement.style.removeProperty('--topbar-fg');
  if (document.documentElement.getAttribute('data-theme') === normalized) return;
  document.documentElement.classList.add('theme-switching');
  document.documentElement.setAttribute('data-theme', normalized);
  clearTimeout(__themeSwitchTimer);
  __themeSwitchTimer = setTimeout(() => document.documentElement.classList.remove('theme-switching'), 140);
}

window.sproutg.onThemeColors((p) => {
  if (!p) return;
  const payloadTheme = p.theme ? normalizeDesktopTheme(p.theme) : '';
  const currentTheme = normalizeDesktopTheme(document.documentElement.getAttribute('data-theme'));
  if (payloadTheme && payloadTheme !== currentTheme) return;
  if (p.topbarColor) document.documentElement.style.setProperty('--topbar-bg', p.topbarColor);
  if (p.topbarTextColor) document.documentElement.style.setProperty('--topbar-fg', p.topbarTextColor);
});

window.sproutg.onApplySettings((s) => { if (s && s.theme) setTopbarTheme(s.theme); });

(async () => {
  const s = await window.sproutg.getSettings();
  setTopbarTheme(s.theme || 'dark-classic');
})();

  const APP_VERSION = '2.1.2';
  const PAGE_KEY = 'FarmA.page';
  const HOME_RETURN_KEY = 'FarmA.homeReturnPage';
  const THEME_KEY = 'sproutg.theme';
  const THEMES = ['dark-classic', 'light-classic', 'dark-ios', 'light-ios', 'dark-oldmoney', 'light-oldmoney', 'dark-midnight-pro', 'light-midnight-pro', 'dark-forest', 'light-forest', 'cyberpunk', 'nordic-frost', 'coffee-sepia', 'retro-terminal', 'synthwave', 'vaporwave', 'dark-academia', 'light-academia', 'art-deco', 'bauhaus'];
  const THEME_ALIASES = { dark:'dark-classic', light:'light-classic', 'midnight-pro':'dark-midnight-pro', forest:'dark-forest', 'cyberpunk-neon':'cyberpunk' };

  let current = null;
  let editMode = false;

  const openTabs = [];
  const tabData = {};
  const tabNav  = {};
  let activeTabKey = '';

  let cachedList = [];
  let cachedFilterLabel = '';
  let activeFilterState = null;

  let workCache = { mode: null, groups: {} };
  const workCollapsed = {};
  let activeWorkState = null;

  let mccStageFilterState = { stage: 'D', from: '', to: '', items: [], active: false };
  let mccWorkFilterState = { mode: null, items: [], collapsed: {}, active: false };

  const _saveState = new Map();
  let totpInterval = null;
  const smsPoolProfileStates = new Map();
  const smsPoolUIState = {
    profileRow: null,
    orderRow: null,
    activeOrder: null,
    pollTimerId: null,
    countdownTimerId: null,
    balanceTimerId: null,
    balanceLastTs: 0,
    balanceText: '—',
    apFillPending: false,
    codeText: 'Готов к заказу',
    codeValue: '',
    elements: null
  };

  let activePage = '';
  let homeReturnPage = '';
  let companyDuplicateTimer = null;
  let companyDuplicateState = { value: '', duplicate: false, checking: false };
  const sproutgReq = { profile: 0, filter: 0, work: 0, mcc: 0 };
  let filtersRefreshTimer = null;
  let sproutgScrollRestoreSeq = 0;
  let sproutgProgrammaticScrollUntil = 0;

  let mccProfile = null;
  let mccEditMode = false;
  let mccActiveAccount = '';
  const _mccSaveState = new Map();
  const SAVE_DEBUG = false;
  let _sproutgPriorityReads = 0;
  let _o1WriteQueue = Promise.resolve();
  let _mccWriteQueue = Promise.resolve();
  let _o1PendingWrites = 0;
  let _mccPendingWrites = 0;
  let _o1WriteRevision = 0;
  let _mccWriteRevision = 0;
  let _o1WriteSeq = 0;
  let _o1FailedWrites = 0;
  const O1_SAVE_TIMEOUT_MS = 30000;
  const O1_REFRESH_COLS = new Set(['AZ','BI','BW','CF','BA','BJ','BP','BX','CG','BO','AE','O','AQ','BC','BN','BQ','BZ','D']);
  const _o1RowPendingWrites = new Map();
  const _o1LocalValuesByRow = new Map();
  const _o1PendingNextByCell = new Map();
  const _o1QueuedSingleByCell = new Map();
  const _mccQueuedSingleByCell = new Map();
  function logSave_(scope, msg, meta){
    if(!SAVE_DEBUG && !window.SPROUTG_DEBUG) return;
    const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
    console.info(`[SproutG:${scope}] ${msg}${suffix}`);
  }
  function emitLocalQueue_(){
    window.dispatchEvent(new CustomEvent('sproutg-local-queue', {
      detail: { pending: Math.max(0, _o1PendingWrites + _mccPendingWrites) }
    }));
  }
  window.addEventListener('sproutg-api-priority-start', ()=>{ _sproutgPriorityReads += 1; });
  window.addEventListener('sproutg-api-priority-end', ()=>{ _sproutgPriorityReads = Math.max(0, _sproutgPriorityReads - 1); });
  function waitForPriorityReads_(){
    if(_sproutgPriorityReads <= 0) return Promise.resolve();
    return new Promise((resolve)=>{
      const started = Date.now();
      const check = ()=>{
        if(_sproutgPriorityReads <= 0 || Date.now() - started > 8000){
          resolve();
          return;
        }
        setTimeout(check, 60);
      };
      check();
    });
  }
  function enqueueWrite_(scope, run){
    const base = scope === 'MCC' ? _mccWriteQueue : _o1WriteQueue;
    const next = base.then(()=>waitForPriorityReads_().then(()=>new Promise(run)), ()=>waitForPriorityReads_().then(()=>new Promise(run)));
    if(scope === 'MCC') _mccWriteQueue = next.catch(()=>{});
    else _o1WriteQueue = next.catch(()=>{});
    return next;
  }

  function o1RowKey_(row){
    return String(Number(row) || row || '').trim();
  }

  function o1CellKey_(row, col){
    return `${o1RowKey_(row)}:${String(col || '').toUpperCase().trim()}`;
  }

  function setO1PendingNext_(row, col, value, meta = {}){
    const key = o1CellKey_(row, col);
    if(!key || key === ':') return;
    _o1PendingNextByCell.set(key, {
      value,
      tabKey: meta.tabKey || getTabKey(row),
      profileName: meta.profileName || tabData[getTabKey(row)]?.profileName || '',
      replay: typeof meta.replay === 'function' ? meta.replay : null
    });
  }

  function takeO1PendingNext_(row, col){
    const key = o1CellKey_(row, col);
    const pending = _o1PendingNextByCell.get(key);
    if(pending) _o1PendingNextByCell.delete(key);
    return pending || null;
  }

  function getO1PendingCountForRow(row){
    return _o1RowPendingWrites.get(o1RowKey_(row)) || 0;
  }

  function adjustO1PendingRow_(row, delta){
    const key = o1RowKey_(row);
    if(!key) return;
    const next = Math.max(0, (getO1PendingCountForRow(row) || 0) + Number(delta || 0));
    if(next) _o1RowPendingWrites.set(key, next);
    else _o1RowPendingWrites.delete(key);
  }

  function isActiveO1Row_(row){
    return activePage === 'O1' && current?.row && String(current.row) === String(row);
  }

  function isO1WriteContextActive_(ctx){
    if(!ctx) return false;
    const tabStillOpen = !!ctx.tabKey && !!tabData[ctx.tabKey] && openTabs.includes(ctx.tabKey);
    return activePage === 'O1' && tabStillOpen && activeTabKey === ctx.tabKey && current?.row && String(current.row) === String(ctx.row);
  }

  function isO1ElementCurrent_(el){
    if(!el || !el.isConnected) return false;
    const row = el.dataset?.row || '';
    if(row && current?.row && String(row) !== String(current.row)) return false;
    const out = document.getElementById('out');
    return !!out && out.contains(el);
  }

  function applyO1ValuesToPayload_(payload, values){
    if(!payload || !values || typeof values !== 'object') return;
    for(const [rawCol, value] of Object.entries(values)){
      const col = String(rawCol || '').toUpperCase().trim();
      if(!col) continue;
      for(const g of (payload.groups || [])){
        for(const f of (g.fields || [])){
          if(String(f.col || '').toUpperCase() === col){
            f.value = value;
          }
        }
        if(g.date?.iso !== undefined && O1_GROUP_DATE_COL[g.name] === col) g.date.iso = String(value || '');
        if(g.ban?.col && String(g.ban.col).toUpperCase() === col) g.ban.value = String(value || '').trim();
        if(g.number?.col && String(g.number.col).toUpperCase() === col){
          g.number.value = String(value || '').trim();
          g.number.active = g.number.value === 'Номер';
        }
      }
    }
  }

  function rememberO1LocalValues_(row, values){
    const key = o1RowKey_(row);
    if(!key || !values || typeof values !== 'object') return;
    const cur = _o1LocalValuesByRow.get(key) || {};
    const normalized = {};
    for(const [rawCol, value] of Object.entries(values)){
      const col = String(rawCol || '').toUpperCase().trim();
      if(col) normalized[col] = value;
    }
    Object.assign(cur, normalized);
    _o1LocalValuesByRow.set(key, cur);

    const tabKey = getTabKey(row);
    if(tabData[tabKey]) applyO1ValuesToPayload_(tabData[tabKey], normalized);
    if(current?.row && String(current.row) === String(row)) applyO1ValuesToPayload_(current, normalized);
  }

  function mergeO1LocalValues_(payload){
    if(!payload?.row) return payload;
    const values = _o1LocalValuesByRow.get(o1RowKey_(payload.row));
    if(values) applyO1ValuesToPayload_(payload, values);
    return payload;
  }

  function o1AppliedValue_(res, col, fallback){
    const c = String(col || '').toUpperCase().trim();
    return (res?.applied && Object.prototype.hasOwnProperty.call(res.applied, c)) ? res.applied[c] : fallback;
  }

  function replayInactiveO1PendingNext_(ctx, normalized, activeContext){
    if(activeContext || !ctx?.row) return;
    for(const c of (ctx.cols || [])){
      const pending = takeO1PendingNext_(ctx.row, c);
      if(!pending) continue;
      if(String(pending.value ?? '') === String(normalized?.[c] ?? '')) continue;
      logSave_('O1', 'pendingNextValue replay in background', { row: ctx.row, col: c, value: pending.value, writeId: ctx.writeId });
      if(pending.replay){
        pending.replay(pending.value);
      } else {
        saveCellInstant(ctx.row, c, pending.value, null, null, {
          tabKey: pending.tabKey || ctx.tabKey,
          profileName: pending.profileName || ctx.profileName || ''
        });
      }
    }
  }
  let mccTotpInterval = null;
  const mccProfileTabs = [];
  const mccProfileTabMap = new Map();
  const mccProfileCache = new Map();
  let mccActiveProfileKey = '';
  let mccOverviewState = { items: [], loaded: false, loading: false };
  const MCC_PROFILE_TABS_KEY = 'mcc:profileTabs:v1';
  const MCC_PROFILE_CACHE_KEY = 'mcc:profileCache:v1';
  const MCC_PROFILE_CACHE_LIMIT = 30;
  let mccAccountObserver = null;
  let mccAccountScrollRaf = null;
  let mccAccountScrollHandler = null;
  let mccAccountResizeHandler = null;
  let mccAccountVisible = new Map();
  let mccSectionScrollSeq = 0;
  let mccSectionScrollTimers = [];
  let mccApellIndexCache = null;
  let mccPassLookupState = { inFlight: false, byFio: {}, duplicateFios: new Set(), fioCol: '', addrCol: '' };
  let companyFormMeta = null;

  // BAN color rules
  const BAN_RED_VALUES = new Set([
    'Бан','Ban','ban','бан',
    'Бан почты','бан почты','Бан аккаунта','Аккаунт удален',
    'Обход системы','Деловая практика',
    'Мультиаккаутинг','Мультиаккаунтинг',
    'Проверка рекламодателя','Отказ','Не вышел'
  ]);
  const BAN_YELLOW_VALUES = new Set([
    '?','Аппел','Апелл','Аппеляция','Апелляция',
    'Взять в работу','Подозрительные платежи',
    'Не оплаченный баланс','Будущие платежи','PrePaid'
  ]);
  const O1_WORK_GROUPS = ['Ads Видео', 'Платежка', 'Речек'];
  const O1_GROUP_DATE_COL = { 'Ads Видео':'AQ', 'Платежка':'BC', 'Речек':'BQ' };
  const O1_GROUP_DONE_COL = { 'Ads Видео':'AZ', 'Платежка':'BI', 'Речек':'BW' };
  const MCC_LABEL_OVERRIDES = {
    G:'Карта',
    H:'БИН',
    R:'D-U-N-S',
    'L/M':'РК/Гео',
    Q:'Коммент',
    N:'Статус',
    O:'Статус Бан',
    AG:'Прокси',
    AH:'Регион',
    AI:'Город',
    AJ:'User',
    AK:'ISP',
    AL:'IP',
    AM:'Логин',
    AN:'Пароль',
    AO:'Аутентификатор'
  };

  document.getElementById('profile').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); search(); }});
  document.getElementById('fltText').addEventListener('input', ()=>{ renderFilterList(); updateHeaderNav(); });
  document.getElementById('profilePill').addEventListener('click', async ()=>{ if(current?.profileName) await copyText(current.profileName); });
  document.getElementById('pageSwitchO1').addEventListener('change', (e)=>setActivePage(e.target.value));

  document.getElementById('mccProfileInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); mccSearch(); }});
  document.getElementById('mccProfilePill').addEventListener('click', async ()=>{
    if(mccEditMode) return;
    if(mccProfile?.profileName) await copyText(mccProfile.profileName);
  });
  document.getElementById('pageSwitchMcc').addEventListener('change', (e)=>setActivePage(e.target.value));
  document.getElementById('pageSwitchCompany')?.addEventListener('change', (e)=>setActivePage(e.target.value));
  document.getElementById('companyAddBtn')?.addEventListener('click', ()=>openCompanyForm());
  document.getElementById('companySubmitBtn')?.addEventListener('click', ()=>submitCompanyForm());
  document.getElementById('mccProfileTabsSelect')?.addEventListener('change', (e)=>{
    const key = String(e.target.value || '').trim();
    const entry = mccProfileTabMap.get(key);
    if(!entry) return;
    openMccProfileTab(entry, { targetAccountName: entry.lastAccount || '' });
  });

  window.addEventListener('load', ()=>{
    console.info(`[SproutG] v${APP_VERSION} loaded`);
    setupHeaderResizeObserver();
    requestAnimationFrame(adjustMainTop);
    setupO1TopButton();
    setupMccTopButton();
    setupPanelCollapses();
    setupSideSyncButtons();
    loadMccProfileTabsFromStorage();
    loadMccProfileCacheFromStorage();
    renderMccProfileTabsSelect();
    initTheme();
    setupDesktopIntegration();
  });
  window.addEventListener('resize', ()=>requestAnimationFrame(adjustMainTop));

  function getActiveScrollContainer(){
    const activeRoot = document.querySelector('.pageRoot.active');
    if(!activeRoot) return null;
    return activeRoot.querySelector('#mainScrollO1, #mainScrollMcc, #mainScrollCompany');
  }

  function getVisibleScrollerByIds(ids){
    for(const id of ids){
      const el = document.getElementById(id);
      if(!el) continue;
      const style = getComputedStyle(el);
      const canScroll = /(auto|scroll)/.test(style.overflowY || '') || el.scrollHeight > el.clientHeight + 4;
      const visible = el.clientHeight > 0 && el.scrollHeight > 0;
      if(visible && canScroll) return el;
    }
    return null;
  }

  function getO1Scroller_(){
    return getVisibleScrollerByIds(['mainScroll', 'mainScrollO1', 'outScroll', 'o1Scroll']);
  }

  function getMccScroller_(){
    return getVisibleScrollerByIds(['mainScrollMcc', 'mccScroll', 'mccOutScroll']);
  }

  function getActiveSproutScroller_(){
    const mcc = getMccScroller_();
    if(mcc && document.body.contains(mcc) && mcc.clientHeight > 0) return mcc;
    const o1 = getO1Scroller_();
    if(o1 && document.body.contains(o1) && o1.clientHeight > 0) return o1;
    return document.scrollingElement || document.documentElement;
  }

  function getCurrentScrollContext_(){
    if(typeof activePage !== 'undefined' && activePage === 'MCC'){
      return {
        page: 'MCC',
        row: mccProfile && mccProfile.profileRow ? String(mccProfile.profileRow.row || mccProfile.profileRow) : '',
        profile: mccProfile && mccProfile.profileName ? String(mccProfile.profileName) : ''
      };
    }
    if(typeof current !== 'undefined' && current){
      return {
        page: 'O1',
        row: current.row ? String(current.row) : '',
        profile: current.profileName ? String(current.profileName) : ''
      };
    }
    return { page: '', row: '', profile: '' };
  }

  function captureSproutScroll_(reason){
    const scroller = getActiveSproutScroller_();
    if(!scroller) return null;
    const ctx = getCurrentScrollContext_();
    return {
      reason: reason || '',
      page: ctx.page,
      row: ctx.row,
      profile: ctx.profile,
      scrollTop: scroller.scrollTop || 0,
      scrollLeft: scroller.scrollLeft || 0,
      scrollHeight: scroller.scrollHeight || 0,
      clientHeight: scroller.clientHeight || 0,
      ts: Date.now()
    };
  }

  function isSameScrollContext_(snap){
    if(!snap) return false;
    const ctx = getCurrentScrollContext_();
    return String(snap.page || '') === String(ctx.page || '') &&
      String(snap.row || '') === String(ctx.row || '') &&
      String(snap.profile || '') === String(ctx.profile || '');
  }

  function restoreSproutScroll_(snap, opts = {}){
    if(!snap) return;
    if(Date.now() < sproutgProgrammaticScrollUntil && !opts.force) return;
    if(!opts.ignoreContext && !isSameScrollContext_(snap)) return;

    const seq = ++sproutgScrollRestoreSeq;
    function applyRestore(pass){
      if(seq !== sproutgScrollRestoreSeq) return;
      if(Date.now() < sproutgProgrammaticScrollUntil && !opts.force) return;
      if(!opts.ignoreContext && !isSameScrollContext_(snap)) return;
      const scroller = getActiveSproutScroller_();
      if(!scroller) return;
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const top = Math.max(0, Math.min(Number(snap.scrollTop || 0), maxTop));
      scroller.scrollTop = top;
      scroller.scrollLeft = Number(snap.scrollLeft || 0);
      if(window.SPROUTG_DEBUG){
        console.debug('[SproutG scroll restore]', snap.reason, { pass, top, maxTop, snap });
      }
    }
    requestAnimationFrame(()=>{
      applyRestore(0);
      requestAnimationFrame(()=>applyRestore(1));
    });
    setTimeout(()=>applyRestore(2), 80);
    setTimeout(()=>applyRestore(3), 220);
  }

  function nextReqToken(key){
    sproutgReq[key] = (sproutgReq[key] || 0) + 1;
    return sproutgReq[key];
  }

  function isLatestReq(key, token){
    return sproutgReq[key] === token;
  }

  function scheduleFiltersRefresh(reason){
    clearTimeout(filtersRefreshTimer);
    filtersRefreshTimer = setTimeout(()=>{
      refreshO1Filters();
      refreshMccFilters();
    }, 900);
  }

  function markFieldSaving(el, saving){
    if(!el) return;
    if(saving && !isO1ElementCurrent_(el)){
      logSave_('O1', 'stale callback skipped before saving mark', { row: el.dataset?.row || '', col: el.dataset?.col || '' });
      return;
    }
    el.classList.toggle('sgSaving', !!saving);
    if('disabled' in el) el.disabled = !!saving && el.tagName === 'BUTTON';
  }

  function markFieldSaved(el){
    if(!el) return;
    if(!isO1ElementCurrent_(el)){
      logSave_('O1', 'stale callback skipped before saved mark', { row: el.dataset?.row || '', col: el.dataset?.col || '' });
      return;
    }
    el.classList.remove('sgSaving');
    el.classList.add('sgSavePulse');
    setTimeout(()=>el.classList.remove('sgSavePulse'), 650);
  }

  function markFieldSaveError(el){
    if(!el) return;
    if(!isO1ElementCurrent_(el)){
      logSave_('O1', 'stale callback skipped before error mark', { row: el.dataset?.row || '', col: el.dataset?.col || '' });
      return;
    }
    el.classList.remove('sgSaving');
    el.classList.add('redLight');
    setTimeout(()=>el.classList.remove('redLight'), 1200);
  }

  function updateActiveListMarkers(){
    const activeO1Row = current?.row ? String(current.row) : '';
    document.querySelectorAll('#fltList .listItem[data-row], #workList .listItem[data-row]').forEach((el)=>{
      el.classList.toggle('active', !!activeO1Row && el.dataset.row === activeO1Row);
    });

    const activeMccRow = mccProfile?.profileRow ? String(mccProfile.profileRow) : '';
    document.querySelectorAll('#mccStageFilterList .listItem[data-row], #mccWorkFilterList .listItem[data-row]').forEach((el)=>{
      el.classList.toggle('active', !!activeMccRow && el.dataset.row === activeMccRow);
    });
  }

  function adjustMainTop(){
    updateAppHeaderHeight();
  }

  function getActiveHeaderWrapper(){
    if(activePage === 'MCC') return document.getElementById('fixedHeaderMcc');
    if(activePage === 'COMPANY') return document.getElementById('fixedHeaderCompany');
    return document.getElementById('fixedHeaderO1');
  }

  function updateAppHeaderHeight(){
    const header = getActiveHeaderWrapper();
    if(!header) return;
    const height = Math.ceil(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--app-header-h', `${height}px`);
  }

  function setupHeaderResizeObserver(){
    if(typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(()=>requestAnimationFrame(updateAppHeaderHeight));
    const o1 = document.getElementById('fixedHeaderO1');
    const mcc = document.getElementById('fixedHeaderMcc');
    const company = document.getElementById('fixedHeaderCompany');
    if(o1) observer.observe(o1);
    if(mcc) observer.observe(mcc);
    if(company) observer.observe(company);
  }

  function choosePage(page){
    setActivePage(page, { persist:true, hideSelector:true });
  }

  function showHomeScreen(opts = {}){
    if(opts.remember && (activePage === 'O1' || activePage === 'MCC')){
      homeReturnPage = activePage;
      try{ localStorage.setItem(HOME_RETURN_KEY, activePage); }catch(e){}
    }
    activePage = '';
    try{ localStorage.removeItem(PAGE_KEY); }catch(e){}
    document.querySelectorAll('.pageRoot.active').forEach((page)=>page.classList.remove('active'));
    const selector = document.getElementById('pageSelector');
    if(selector) selector.classList.remove('hidden');
    document.documentElement.style.setProperty('--app-header-h', '0px');
    requestAnimationFrame(updateSideSyncButtons);
    requestAnimationFrame(updateO1TopButton);
    requestAnimationFrame(updateMccTopButton);
  }

  function toggleHomeScreen(){
    if(activePage){
      showHomeScreen({ remember:true });
      return;
    }
    const saved = homeReturnPage || localStorage.getItem(HOME_RETURN_KEY) || localStorage.getItem(PAGE_KEY) || 'O1';
    const next = (saved === 'O1' || saved === 'MCC') ? saved : 'O1';
    setActivePage(next, { persist:true, hideSelector:true });
  }

  function setActivePage(page, opts = {}){
    const next = (page === 'MCC') ? 'MCC' : (page === 'COMPANY' ? 'COMPANY' : 'O1');
    activePage = next;

    const o1 = document.getElementById('pageO1');
    const mcc = document.getElementById('pageMcc');
    const company = document.getElementById('pageCompany');
    if(o1) o1.classList.toggle('active', next === 'O1');
    if(mcc) mcc.classList.toggle('active', next === 'MCC');
    if(company) company.classList.toggle('active', next === 'COMPANY');

    updatePageSwitchers(next);
    if(opts.persist) localStorage.setItem(PAGE_KEY, next);

    if(opts.hideSelector){
      const selector = document.getElementById('pageSelector');
      if(selector) selector.classList.add('hidden');
    }

    applyPanelCollapseStates(next);
    requestAnimationFrame(adjustMainTop);
    requestAnimationFrame(updateO1TopButton);
    requestAnimationFrame(updateMccTopButton);
    requestAnimationFrame(updateMccProfileTabsVisibility);
    requestAnimationFrame(updateSideSyncButtons);
    if(next === 'MCC') requestAnimationFrame(()=>{ loadMccOverview({ silent:true }); preloadMccApellIndex(); });
    if(next === 'COMPANY') requestAnimationFrame(()=>updateCompanyMeta());
  }

  function updatePageSwitchers(page){
    const swO1 = document.getElementById('pageSwitchO1');
    const swMcc = document.getElementById('pageSwitchMcc');
    const swCompany = document.getElementById('pageSwitchCompany');
    if(swO1) swO1.value = page;
    if(swMcc) swMcc.value = page;
    if(swCompany) swCompany.value = page;
  }

  function initPageSelection(){
    const saved = localStorage.getItem(PAGE_KEY);
    if(saved === 'O1' || saved === 'MCC'){
      setActivePage(saved, { persist:false, hideSelector:true });
    } else {
      showHomeScreen();
    }
  }

  function setupPanelCollapses(){
    document.querySelectorAll('.panelCollapsible').forEach((panel)=>{
      const header = panel.querySelector('[data-panel-header]');
      if(!header || header.dataset.bound) return;
      header.dataset.bound = '1';
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');
      header.addEventListener('click', ()=>togglePanelCollapse(panel));
      header.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          togglePanelCollapse(panel);
        }
      });
    });
    applyPanelCollapseStates('O1');
    applyPanelCollapseStates('MCC');
  }

  function togglePanelCollapse(panel){
    const key = panel?.dataset?.panelKey;
    if(!key) return;
    const next = !panel.classList.contains('panelCollapsed');
    panel.classList.toggle('panelCollapsed', next);
    const header = panel.querySelector('[data-panel-header]');
    if(header) header.setAttribute('aria-expanded', String(!next));
    try{ localStorage.setItem(key, next ? '1' : '0'); }catch(e){}
    requestAnimationFrame(updateAppHeaderHeight);
  }

  function applyPanelCollapseStates(page){
    if(page === 'COMPANY') return;
    const root = page === 'MCC' ? document.getElementById('pageMcc') : document.getElementById('pageO1');
    if(!root) return;
    root.querySelectorAll('.panelCollapsible[data-panel-key]').forEach((panel)=>{
      const key = panel.dataset.panelKey;
      const collapsed = localStorage.getItem(key) === '1';
      panel.classList.toggle('panelCollapsed', collapsed);
      const header = panel.querySelector('[data-panel-header]');
      if(header) header.setAttribute('aria-expanded', String(!collapsed));
    });
    requestAnimationFrame(updateAppHeaderHeight);
  }

  function setupSideSyncButtons(){
    const o1Btn = document.getElementById('o1SyncLeft');
    const mccBtn = document.getElementById('mccSyncLeft');
    if(o1Btn && !o1Btn.dataset.bound){
      o1Btn.dataset.bound = '1';
      o1Btn.addEventListener('click', ()=>syncProfile());
    }
    if(mccBtn && !mccBtn.dataset.bound){
      mccBtn.dataset.bound = '1';
      mccBtn.addEventListener('click', ()=>mccSyncProfile());
    }
    updateSideSyncButtons();
  }

  function updateSideSyncButtons(){
    const o1Btn = document.getElementById('o1SyncLeft');
    const mccBtn = document.getElementById('mccSyncLeft');
    if(o1Btn){
      o1Btn.classList.toggle('hidden', activePage !== 'O1');
      o1Btn.disabled = !current;
    }
    if(mccBtn){
      mccBtn.classList.toggle('hidden', activePage !== 'MCC');
      mccBtn.disabled = !mccProfile;
    }
  }

  function scrollTabs(dir){
    const el=document.getElementById('tabsBar');
    el.scrollBy({ left: 320 * (dir>0?1:-1), behavior:'smooth' });
  }

  function toast(msg){
    const t=document.getElementById('toast');
    const text = String(msg || '');
    const isLoading = /загруз|синхрон|сохранение|loading|sync/i.test(text);
    const isSaved = /сохранено|готово|saved/i.test(text);
    t.classList.toggle('toastIcon', isLoading || isSaved);
    t.classList.toggle('toastLoading', isLoading);
    t.textContent=(isLoading || isSaved) ? '' : text;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'), 900);
  }
  function setError(msg){ document.getElementById('err').textContent = msg || ''; }

  function getTabKey(row){ return `O1#${row}`; }

  function setTabNavContext(tabKey, label, stage, items, ctxKey){
    tabNav[tabKey] = { label: label||'—', stage: stage||'', items: Array.isArray(items)?items:[], key: ctxKey||'' };
  }
  function getActiveNav(){ return activeTabKey ? (tabNav[activeTabKey] || null) : null; }

  function ensureTab(profilePayload, navInfo){
    if(!profilePayload?.row) return;
    mergeO1LocalValues_(profilePayload);
    const k=getTabKey(profilePayload.row);
    tabData[k]=profilePayload;
    if(!openTabs.includes(k)) openTabs.push(k);
    activeTabKey=k;
    current=tabData[k];

    if(navInfo) setTabNavContext(k, navInfo.label, navInfo.stage, navInfo.items, navInfo.key);
    else if(!tabNav[k]) setTabNavContext(k, 'Открыто', '', [], 'open');

    renderTabs();
  }

  function renderTabs(){
    const bar=document.getElementById('tabsBar');
    bar.innerHTML='';
    if(!openTabs.length) return;

    const frag=document.createDocumentFragment();
    for(const k of openTabs){
      const p=tabData[k];
      const pill=document.createElement('div');
      pill.className='tabPill' + (k===activeTabKey ? ' active' : '');

      const name=document.createElement('span');
      name.textContent=p?.__loading ? `Загрузка… (${p?.row || ''})` : (p?.profileName || k);
      name.title=p?.profileName || k;

      const close=document.createElement('button');
      close.className='tabClose';
      close.textContent='×';
      close.title='Закрыть вкладку';
      close.addEventListener('click', (e)=>{ e.stopPropagation(); closeTab(k); });

      pill.addEventListener('click', ()=>activateTab(k));
      pill.appendChild(name);
      pill.appendChild(close);
      frag.appendChild(pill);
    }
    bar.appendChild(frag);
    updateO1TabsColors();
  }

  function activateTab(k){
    if(!tabData[k]) return;
    activeTabKey=k;
    current=mergeO1LocalValues_(tabData[k]);
    editMode=false;
    renderProfile(current);
  }

  function closeTab(k){
    const idx=openTabs.indexOf(k);
    if(idx>=0) openTabs.splice(idx,1);

    const row = tabData[k]?.row || '';
    const pending = row ? getO1PendingCountForRow(row) : 0;
    if(pending > 0){
      logSave_('O1', 'tab closed with pending writes', { row, pending, tabKey: k });
      toast('Сохранение продолжится в фоне');
    }

    delete tabData[k];
    delete tabNav[k];

    if(activeTabKey===k){
      activeTabKey = openTabs[idx-1] || openTabs[idx] || openTabs[0] || '';
      current = activeTabKey ? tabData[activeTabKey] : null;
      editMode=false;
      document.getElementById('out').innerHTML='';
      if(current){ renderProfile(current); }
      else updateHeader();
    }
    renderTabs();
  }

  function clearAllTabs(){
    const pending = Array.from(_o1RowPendingWrites.values()).reduce((sum, n)=>sum + Number(n || 0), 0);
    if(pending > 0) toast('Сохранение продолжится в фоне');
    openTabs.splice(0, openTabs.length);
    for(const k of Object.keys(tabData)) delete tabData[k];
    for(const k of Object.keys(tabNav)) delete tabNav[k];
    activeTabKey='';
    current=null;
    editMode=false;
    document.getElementById('out').innerHTML='';
    renderTabs();
    updateHeader();
  }

  function getO1FieldValue(payload, col){
    if(!payload || !col) return '';
    const target = String(col).toUpperCase();
    for(const g of (payload.groups || [])){
      for(const f of (g.fields || [])){
        if(String(f.col).toUpperCase() === target) return String(f.value ?? '').trim();
      }
    }
    return '';
  }

  function setO1FieldValue(payload, col, value){
    if(!payload || !col) return null;
    const target = String(col).toUpperCase();
    for(const g of (payload.groups || [])){
      for(const f of (g.fields || [])){
        if(String(f.col).toUpperCase() === target){
          f.value = value;
          return f;
        }
      }
    }
    return null;
  }

  function isoTodayByTz(timeZone){
    try{
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year:'numeric',
        month:'2-digit',
        day:'2-digit'
      }).formatToParts(new Date());
      const y = parts.find((p)=>p.type==='year')?.value;
      const m = parts.find((p)=>p.type==='month')?.value;
      const d = parts.find((p)=>p.type==='day')?.value;
      if(y && m && d) return `${y}-${m}-${d}`;
    }catch(_){ }
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }

  function isoTodayLocal(){
    return isoTodayByTz('Asia/Ho_Chi_Minh');
  }

  function computeO1TabPill(payload){
    if(!payload) return '';
    if(payload.isBanned) return 'red';

    const mode = activeWorkState?.mode || '';
    if(mode){
      if(mode === 'today'){
        const today = isoTodayLocal();
        for(const gName of O1_WORK_GROUPS){
          const dateCol = O1_GROUP_DATE_COL[gName];
          const doneCol = O1_GROUP_DONE_COL[gName];
          const iso = getO1FieldValue(payload, dateCol);
          if(iso === today){
            const done = getO1FieldValue(payload, doneCol);
            if(done === '+') return 'green';
          }
        }
        return '';
      }

      if(mode === 'c1'){
        if(getO1FieldValue(payload, 'AE') !== 'С 1') return '';
        const iso = getO1FieldValue(payload, 'O');
        if(!iso) return '';
        const diff = diffDays(iso, isoTodayLocal());
        if(diff != null && diff >= -2 && diff <= 0) return 'yellow';
        return '';
      }

      return '';
    }

    const group = activeFilterState?.group || '';
    if(group && O1_GROUP_DONE_COL[group]){
      const done = getO1FieldValue(payload, O1_GROUP_DONE_COL[group]);
      if(done === '+') return 'green';
    }

    return '';
  }

  function applyO1TabColor(pill, payload){
    if(!pill) return;
    pill.classList.remove('greenLight','redLight','yellowLight');
    const pillColor = computeO1TabPill(payload);
    if(pillColor === 'red') pill.classList.add('redLight');
    else if(pillColor === 'green') pill.classList.add('greenLight');
    else if(pillColor === 'yellow') pill.classList.add('yellowLight');
  }

  function updateO1TabsColors(){
    const bar = document.getElementById('tabsBar');
    if(!bar || !openTabs.length) return;
    const pills = bar.querySelectorAll('.tabPill');
    pills.forEach((pill, idx)=>{
      const key = openTabs[idx];
      const payload = key ? tabData[key] : null;
      if(payload) applyO1TabColor(pill, payload);
    });
  }

  function applyProfilePillColor(){
    const pill=document.getElementById('profilePill');
    const bg = String(current?.geoBg || '').trim().toLowerCase();
    if(!bg || bg === '#ffffff' || bg === '#fff'){
      pill.style.background='';
      pill.style.borderColor='';
      return;
    }
    pill.style.background = bg;
    pill.style.borderColor = 'rgba(255,255,255,.22)';
  }

  function updateHeader(){
    const pill=document.getElementById('profilePill');
    const name = current?.profileName ? current.profileName : '—';
    pill.textContent = name;

    applyProfilePillColor();

    const banEl=document.getElementById('banText');
    if(current?.isBanned){
      banEl.style.display='';
      banEl.textContent = current?.banText || 'BAN';
      banEl.title = (current?.banAll?.length) ? current.banAll.join(', ') : '';
    } else {
      banEl.style.display='none';
      banEl.textContent='';
      banEl.title='';
    }

    const delEl=document.getElementById('deletedText');
    if(current?.isDeleted){
      delEl.style.display='';
      delEl.textContent='Профиль удален';
      delEl.title='Колонка B подсвечена #f4cccc';
    } else {
      delEl.style.display='none';
      delEl.textContent='';
      delEl.title='';
    }

    const meta=document.getElementById('fhMeta');
    meta.textContent = '';

    const btnEdit=document.getElementById('btnEdit');
    btnEdit.disabled = !current;
    btnEdit.textContent = editMode ? 'Готово' : 'Редактировать';

    const btnSync=document.getElementById('btnSync');
    const btnDeleted=document.getElementById('btnDeleted');
    const canUseProfile = !!current;

    btnSync.disabled = !canUseProfile;
    btnDeleted.disabled = !canUseProfile;
    btnDeleted.classList.toggle('btnDelActive', !!current?.isDeleted);

    updateSideSyncButtons();
    updateHeaderNav();
    requestAnimationFrame(adjustMainTop);
  }

  function toggleEdit(){
    if(!current) return;
    const scrollSnap = captureSproutScroll_('edit-toggle');
    editMode=!editMode;
    renderProfile(current, { preserveSmsPool: true, preserveScrollSnapshot: scrollSnap });
  }

  function toggleDeleted(){
    if(!current?.row) return;
    const prev = !!current.isDeleted;
    const next = !current.isDeleted;
    current.isDeleted = next;
    updateHeader();
    refreshColors({ source:'o1', skipFilters:true });
    google.script.run.withSuccessHandler(r=>{
      if(!r || r.ok===false){
        current.isDeleted = prev;
        updateHeader();
        refreshColors({ source:'o1', skipFilters:true });
        toast(r?.error || 'Ошибка');
        return;
      }
      current.isDeleted = !!r.isDeleted;
      updateHeader();
      refreshColors({ source:'o1', skipFilters:true });
    }).withFailureHandler(err=>{
      current.isDeleted = prev;
      updateHeader();
      refreshColors({ source:'o1', skipFilters:true });
      toast(String(err));
    }).toggleProfileDeleted(current.row, next);
  }

  function updateHeaderNav(){
    const nav=getActiveNav();
    const stageBox=document.getElementById('navStage');
    const stageText=document.getElementById('navStageText');
    const btnPrev=document.getElementById('btnPrev');
    const btnNext=document.getElementById('btnNext');

    const cLeft=document.getElementById('countLeft');
    const cMid=document.getElementById('countMid');
    const cRight=document.getElementById('countRight');

    if(nav?.stage){
      stageBox.style.display='';
      stageText.textContent = nav.stage;
      stageText.title = nav.stage;
    } else {
      stageBox.style.display='none';
      stageText.textContent='—';
      stageText.title='';
    }

    if(!current || !nav || !nav.items.length){
      btnPrev.disabled=true; btnNext.disabled=true;
      cLeft.style.display='none'; cMid.style.display='none'; cRight.style.display='none';
      return;
    }

    const items = [...nav.items].sort((a,b)=>Number(a.row)-Number(b.row));
    nav.items = items;

    const idx = items.findIndex(x=>Number(x.row)===Number(current.row));
    const total = items.length;

    const hasPrev = idx>0;
    const hasNext = idx>=0 && idx<total-1;

    btnPrev.disabled=!hasPrev;
    btnNext.disabled=!hasNext;

    cLeft.style.display=''; cMid.style.display=''; cRight.style.display='';
    cLeft.textContent = hasPrev ? `${idx}` : `0`;
    cMid.textContent = `${Math.max(1, idx+1)} / ${total}`;
    cRight.textContent = hasNext ? `${total-idx-1}` : `0`;
  }

  function navPrev(){
    const nav=getActiveNav();
    if(!nav || !nav.items.length || !current) return;
    const items=[...nav.items].sort((a,b)=>Number(a.row)-Number(b.row));
    const idx=items.findIndex(x=>Number(x.row)===Number(current.row));
    if(idx<=0) return;
    openByRow(items[idx-1].row, { navInfo: nav, propagateNav:true });
  }
  function navNext(){
    const nav=getActiveNav();
    if(!nav || !nav.items.length || !current) return;
    const items=[...nav.items].sort((a,b)=>Number(a.row)-Number(b.row));
    const idx=items.findIndex(x=>Number(x.row)===Number(current.row));
    if(idx<0 || idx>=items.length-1) return;
    openByRow(items[idx+1].row, { navInfo: nav, propagateNav:true });
  }

  function syncProfile(){
    if(!current?.row) return;
    const requestRow = current.row;
    const requestTabKey = activeTabKey;
    const requestWriteRevision = _o1WriteRevision;
    const scrollSnap = captureSproutScroll_('sync-current-profile');
    toast('Синхронизация…');
    google.script.run.withSuccessHandler(res=>{
      if(!res || !res.ok){
        restoreSproutScroll_(scrollSnap);
        toast(res?.error || 'Ошибка синхронизации');
        return;
      }
      if(!isActiveO1Row_(requestRow) || activeTabKey !== requestTabKey){
        restoreSproutScroll_(scrollSnap);
        logSave_('O1', 'skip stale sync response because active row changed', { requestRow, activeRow: current?.row || '', requestTabKey, activeTabKey });
        return;
      }
      if(getO1PendingCountForRow(requestRow) > 0 || requestWriteRevision !== _o1WriteRevision){
        mergeO1LocalValues_(res);
        restoreSproutScroll_(scrollSnap);
        logSave_('O1', 'skip sync response while writes pending or changed', { row: requestRow, pending: getO1PendingCountForRow(requestRow), requestWriteRevision, currentWriteRevision: _o1WriteRevision });
        toast('Сохранение ещё выполняется');
        return;
      }
      mergeO1LocalValues_(res);
      const k=getTabKey(res.row);
      const oldNav = tabNav[k] || getActiveNav() || null;

      tabData[k]=res;
      current=tabData[k];
      activeTabKey=k;

      if(oldNav){
        setTabNavContext(k, oldNav.label, oldNav.stage, oldNav.items, oldNav.key);
      }

      renderProfile(current, { preserveScrollSnapshot: scrollSnap });
      refreshColors({ source:'o1', skipFilters:true });
      toast('Обновлено');
    }).withFailureHandler(err=>{
      restoreSproutScroll_(scrollSnap);
      toast(String(err));
    }).getProfileByRow(requestRow);
  }

  function mccSyncProfile(){
    if(!mccProfile?.profileName) return;
    const scrollSnap = captureSproutScroll_('sync-current-profile');
    const requestWriteRevision = _mccWriteRevision;
    toast('Синхронизация…');
    google.script.run.withSuccessHandler(res=>{
      if(!res || res.ok===false){
        restoreSproutScroll_(scrollSnap);
        toast(res?.error || 'Ошибка синхронизации');
        return;
      }
      if(_mccPendingWrites > 0 || requestWriteRevision !== _mccWriteRevision){
        restoreSproutScroll_(scrollSnap);
        logSave_('MCC', 'skip sync response while writes pending or changed', { pending: _mccPendingWrites, requestWriteRevision, currentWriteRevision: _mccWriteRevision });
        toast('Сохранение ещё выполняется');
        return;
      }
      mccProfile = res;
      renderMccProfile({ preserveScrollSnapshot: scrollSnap });
      preloadMccApellIndex();
      updateMccPassLookupAndApply();
      addMccProfileTab(res);
      rememberMccActiveAccount();
      refreshColors({ source:'mcc', skipFilters:true });
      toast('Обновлено');
    }).withFailureHandler(err=>{
      restoreSproutScroll_(scrollSnap);
      toast(String(err));
    }).getMccProfile(mccProfile.profileName);
  }

  function mccToggleDeleted(){
    if(!mccProfile?.profileName) return;
    const prev = !!mccProfile.isDeleted;
    const next = !mccProfile.isDeleted;
    mccProfile.isDeleted = next;
    updateMccActionButtons();
    refreshColors({ source:'mcc', skipFilters:true });
    google.script.run.withSuccessHandler(r=>{
      if(!r || r.ok===false){
        mccProfile.isDeleted = prev;
        updateMccActionButtons();
        refreshColors({ source:'mcc', skipFilters:true });
        toast(r?.error || 'Ошибка');
        return;
      }
      mccProfile.isDeleted = !!r.isDeleted;
      updateMccActionButtons();
      refreshColors({ source:'mcc', skipFilters:true });
    }).withFailureHandler(err=>{
      mccProfile.isDeleted = prev;
      updateMccActionButtons();
      refreshColors({ source:'mcc', skipFilters:true });
      toast(String(err));
    }).toggleMccProfileDeleted(mccProfile.profileName, next);
  }

  function search(){
    setError('');
    const name=document.getElementById('profile').value.trim();
    if(!name){ setError('Введи название профиля'); return; }
    toast('Поиск…');
    const token = nextReqToken('profile');
    google.script.run.withSuccessHandler(res=>{
      if(!isLatestReq('profile', token)) return;
      if(!res || !res.ok){
        const sug=(res?.suggestions?.length) ? `\nПохожие: ${res.suggestions.join(', ')}` : '';
        setError((res?.error || 'Ошибка') + sug);
        return;
      }
      editMode=false;
      ensureTab(res, { label:'Поиск', stage:'', items:[], key:'search' });
      renderProfile(current);
      toast('Готово');
    }).withFailureHandler(err=>{
      if(!isLatestReq('profile', token)) return;
      setError(String(err));
    }).findProfile(name);
  }

  function openByRow(row, opts){
    setError('');
    const navInfo = opts?.navInfo || null;
    const propagateNav = !!opts?.propagateNav;

    toast('Открываю…');
    const targetKey=getTabKey(row);

    if(tabData[targetKey]?.__loading){
      activeTabKey = targetKey;
      current = null;
      renderTabs();
      return;
    }

    if(tabData[targetKey]){
      editMode=false;
      activeTabKey=targetKey;
      current=mergeO1LocalValues_(tabData[targetKey]);

      if(navInfo) setTabNavContext(targetKey, navInfo.label, navInfo.stage, navInfo.items, navInfo.key);
      else if(!tabNav[targetKey]) setTabNavContext(targetKey, 'Открыто', '', [], 'open');

      renderTabs();
      renderProfile(current);
      toast('Готово');
      return;
    }

    if(!openTabs.includes(targetKey)) openTabs.push(targetKey);
    tabData[targetKey] = { row:Number(row), profileName:`Row ${row}`, __loading:true };
    activeTabKey = targetKey;
    renderTabs();

    const token = nextReqToken('profile');
    google.script.run.withSuccessHandler(res=>{
      if(!isLatestReq('profile', token)) return;
      if(!res || !res.ok){ delete tabData[targetKey]; const i=openTabs.indexOf(targetKey); if(i>=0) openTabs.splice(i,1); renderTabs(); setError(res?.error || 'Ошибка'); return; }
      if(!openTabs.includes(targetKey)){
        logSave_('O1', 'skip getProfileByRow response because tab was closed', { row, tabKey: targetKey });
        return;
      }
      editMode=false;
      mergeO1LocalValues_(res);

      if(navInfo) ensureTab(res, { label:navInfo.label, stage:navInfo.stage, items:navInfo.items, key:navInfo.key });
      else ensureTab(res, { label:'Открыто', stage:'', items:[], key:'open' });

      if(propagateNav && navInfo){
        const k=getTabKey(res.row);
        setTabNavContext(k, navInfo.label, navInfo.stage, navInfo.items, navInfo.key);
      }

      document.getElementById('profile').value = res.profileName || '';
      renderProfile(current);
      toast('Готово');
    }).withFailureHandler(err=>{
      if(!isLatestReq('profile', token)) return;
      delete tabData[targetKey];
      const i=openTabs.indexOf(targetKey);
      if(i>=0) openTabs.splice(i,1);
      renderTabs();
      setError(String(err));
    }).getProfileByRow(row);
  }

  function runFilter(){
    setError('');
    const group=document.getElementById('fltGroup').value;
    const date=document.getElementById('fltDate').value;
    if(!date){ setError('Выбери дату'); return; }

    const state = { group, from: date, to: date };
    fetchFilter(state);
  }

  function clearFilter(){
    document.getElementById('fltDate').value='';
    document.getElementById('fltText').value='';
    cachedList=[];
    cachedFilterLabel='';
    activeFilterState = null;
    renderFilterList();
    updateHeaderNav();
    updateO1TabsColors();
  }

  function fetchFilter(state, opts = {}){
    const group = state?.group;
    const from = state?.from || '';
    const to = state?.to || '';
    if(!group || (!from && !to)) return;
    activeFilterState = { group, from, to };
    if(!opts.silent) toast('Фильтр…');
    const token = nextReqToken('filter');
    google.script.run.withSuccessHandler(res=>{
      if(!isLatestReq('filter', token)) return;
      if(!res || !res.ok){
        if(!opts.silent) setError(res?.error || 'Ошибка фильтра');
        return;
      }
      cachedList = (res.items || []).slice().sort((a,b)=>Number(a.row)-Number(b.row));
      const labelDate = from === to ? toRuDate(from) : `${from ? toRuDate(from) : '…'}–${to ? toRuDate(to) : '…'}`;
      cachedFilterLabel = `Основной фильтр → ${group} (${labelDate})`;
      renderFilterList();
      if(!opts.silent) toast(`Найдено: ${cachedList.length}`);
    }).withFailureHandler(err=>{
      if(!isLatestReq('filter', token)) return;
      if(!opts.silent) setError(String(err));
    }).listProfilesByGroupDate(group, from || to, to || from, 20000);
  }

  function getActiveFilterList(){
    const q=document.getElementById('fltText').value.trim().toLowerCase();
    const list = q ? cachedList.filter(x=>String(x.profileName||'').toLowerCase().includes(q)) : cachedList;
    return list.slice().sort((a,b)=>Number(a.row)-Number(b.row));
  }

  function renderFilterList(){
    const box=document.getElementById('fltList');
    box.innerHTML='';

    const list=getActiveFilterList();
    if(!list.length){
      box.innerHTML='<div style="color:rgba(255,255,255,.65);font-size:13px;">Нет результатов</div>';
      return;
    }

    const stage=cachedFilterLabel || 'Основной фильтр';
    const frag=document.createDocumentFragment();

    for(const it of list){
      const div=document.createElement('div');
      div.className='listItem sgFadeIn' + ((current && Number(it.row)===Number(current.row)) ? ' active' : '');
      div.dataset.row = String(it.row || '');

      const pill=document.createElement('span');
      pill.className='namePill';
      const dot=document.createElement('span'); dot.className='dot';
      pill.appendChild(dot);

      if(it.pill==='red') pill.classList.add('redLight');
      else if(it.pill==='green') pill.classList.add('greenLight');
      else if(it.pill==='yellow') pill.classList.add('yellowLight');

      const name=document.createElement('span');
      name.textContent=it.profileName;
      pill.appendChild(name);

      const dateSpan=document.createElement('span');
      dateSpan.style.color='rgba(255,255,255,.62)';
      dateSpan.style.fontSize='12px';
      dateSpan.textContent = it.date ? toRuDate(it.date) : '';

      div.appendChild(pill);
      div.appendChild(dateSpan);

      div.addEventListener('click', ()=>{
        const navInfo={ label: cachedFilterLabel || 'Основной фильтр', stage, items: list, key:'filter' };
        openByRow(it.row, { navInfo });
      });

      frag.appendChild(div);
    }

    box.appendChild(frag);
    updateO1TabsColors();
  }

  function loadWork(mode){
    setError('');
    const from=document.getElementById('workFrom').value || '';
    const to=document.getElementById('workTo').value || '';
    const state = { mode, from, to };
    fetchWork(state);
  }

  function fetchWork(state, opts = {}){
    const mode = state?.mode || '';
    const from = state?.from || '';
    const to = state?.to || '';
    if(!mode) return;
    activeWorkState = { mode, from, to };

    if(mode === 'cleanup'){
      if(!opts.silent) toast('Очистка…');
      const token = nextReqToken('work');
      google.script.run.withSuccessHandler(res=>{
        if(!isLatestReq('work', token)) return;
        if(!res || !res.ok){ if(!opts.silent) toast(res?.error || 'Ошибка'); return; }
        workCache = { mode: 'cleanup', groups: { 'Очистка профилей': (res.items || []) } };
        renderWorkList();
        if(!opts.silent) toast('Готово');
      }).withFailureHandler(err=>{ if(!isLatestReq('work', token)) return; if(!opts.silent) toast(String(err)); }).listProfilesForCleanup(20000);
      return;
    }

    if(!opts.silent) toast('Список…');
    const token = nextReqToken('work');
    google.script.run.withSuccessHandler(res=>{
      if(!isLatestReq('work', token)) return;
      if(!res || !res.ok){ if(!opts.silent) toast(res?.error || 'Ошибка'); return; }
      workCache = { mode: res.mode, groups: res.groups || {} };
      renderWorkList();
      if(!opts.silent) toast('Готово');
    }).withFailureHandler(err=>{ if(!isLatestReq('work', token)) return; if(!opts.silent) toast(String(err)); }).getWorkLists(mode, from, to);
  }

  function workLabel(mode, groupName){
    if(mode === 'today') return `Работа → Сегодня → ${groupName}`;
    if(mode === 'overdue') return `Работа → Просрочено → ${groupName}`;
    if(mode === 'new') return `Работа → Новые профили`;
    if(mode === 'verify') return `Работа → Верификации`;
    if(mode === 'c1') return `Работа → С1`;
    if(mode === 'review') return `Работа → На рассмотрении`;
    if(mode === 'nospend') return `Работа → Без расхода`;
    if(mode === 'cleanup') return `Работа → Очистка профилей`;
    return `Работа → ${groupName}`;
  }

  function wkKey(mode, gName){ return `${mode}::${gName}`; }

  function renderWorkList(){
    const box=document.getElementById('workList');
    box.innerHTML='';

    const mode=workCache.mode;
    if(!mode){
      box.innerHTML='<div style="color:rgba(255,255,255,.65);font-size:13px;">Нет данных</div>';
      updateHeaderNav();
      return;
    }

    const groupsOrder =
      (mode === 'c1') ? ['С1']
      : (mode === 'new') ? ['Новые профили']
      : (mode === 'verify') ? ['Верификация']
      : (mode === 'review') ? ['На рассмотрении']
      : (mode === 'nospend') ? ['Без расхода']
      : (mode === 'cleanup') ? ['Очистка профилей']
      : ['Ads Видео','Платежка','Речек'];

    const frag=document.createDocumentFragment();

    for(const gName of groupsOrder){
      let items = (workCache.groups && workCache.groups[gName]) ? workCache.groups[gName] : [];
      items = items.slice().sort((a,b)=>Number(a.row)-Number(b.row));

      const label=workLabel(mode, gName);
      const k = wkKey(mode, gName);
      const collapsed = !!workCollapsed[k];

      const header=document.createElement('div');
      header.className='workGroupHeader';

      const left=document.createElement('div');
      left.className='workGroupTitle';

      const caret=document.createElement('span');
      caret.className='caret';
      caret.textContent = collapsed ? '＋' : '－';

      const title=document.createElement('span');
      title.textContent = `${label} • ${items.length}`;

      left.appendChild(caret);
      left.appendChild(title);

      const actions=document.createElement('div');
      actions.className='workGroupActions';

      const btnTabs=document.createElement('button');
      btnTabs.className='btn';
      btnTabs.textContent='Во вкладки';
      btnTabs.disabled = !items.length;
      btnTabs.addEventListener('click', (e)=>{
        e.stopPropagation();
        openWorkGroupInTabs(items, { label, stage: label, key:`work:${mode}:${gName}` });
      });

      actions.appendChild(btnTabs);

      header.appendChild(left);
      header.appendChild(actions);

      header.addEventListener('click', ()=>{
        workCollapsed[k] = !workCollapsed[k];
        renderWorkList();
      });

      frag.appendChild(header);

      const itemsBox=document.createElement('div');
      itemsBox.style.display = collapsed ? 'none' : '';

      if(!items.length){
        const empty=document.createElement('div');
        empty.style.color='rgba(255,255,255,.55)';
        empty.style.fontSize='13px';
        empty.style.padding='8px 0 4px';
        empty.textContent='Нет результатов';
        itemsBox.appendChild(empty);
        frag.appendChild(itemsBox);
        continue;
      }

      for(const it of items){
        const div=document.createElement('div');
        div.className='listItem sgFadeIn' + ((current && Number(it.row)===Number(current.row)) ? ' active' : '');
        div.dataset.row = String(it.row || '');

        const pill=document.createElement('span');
        pill.className='namePill';

        if(it.pill==='green') pill.classList.add('greenLight');
        if(it.pill==='yellow') pill.classList.add('yellowLight');
        if(it.pill==='red') pill.classList.add('redLight');

        const dot=document.createElement('span'); dot.className='dot';
        pill.appendChild(dot);

        const name=document.createElement('span');
        name.textContent=it.profileName;
        pill.appendChild(name);

        const dateSpan=document.createElement('span');
        dateSpan.style.color='rgba(255,255,255,.62)';
        dateSpan.style.fontSize='12px';
        dateSpan.textContent = it.date ? toRuDate(it.date) : '';

        div.appendChild(pill);
        div.appendChild(dateSpan);

        div.addEventListener('click', ()=>{
          const navInfo={ label, stage: label, items: items, key:`work:${mode}:${gName}` };
          openByRow(it.row, { navInfo });
        });

        itemsBox.appendChild(div);
      }

      frag.appendChild(itemsBox);
    }

    box.appendChild(frag);
    updateHeaderNav();
    updateO1TabsColors();
  }

  function refreshO1Filters(){
    if(activeFilterState){
      fetchFilter(activeFilterState, { silent:true });
    } else {
      renderFilterList();
    }

    if(activeWorkState){
      fetchWork(activeWorkState, { silent:true });
    } else {
      renderWorkList();
    }
  }

  function openWorkGroupInTabs(items, navBase){
    const rows = items.map(x=>Number(x.row)).filter(Boolean);
    if(!rows.length) return;

    toast('Загрузка во вкладки…');

    google.script.run.withSuccessHandler(res=>{
      if(!res || res.ok===false){ toast(res?.error || 'Ошибка'); return; }
      const byRow = new Map((res.items || []).map(x=>[Number(x.row), x]));
      const arr = rows.map(r=>byRow.get(Number(r))).filter(Boolean);
      if(!arr.length){ toast('Нет данных'); return; }

      clearAllTabs();

      for(const p of arr){
        const key=getTabKey(p.row);
        tabData[key]=p;
        openTabs.push(key);
        setTabNavContext(key, navBase.label, navBase.stage, items, navBase.key);
      }

      activeTabKey = getTabKey(arr[0].row);
      current = tabData[activeTabKey];
      editMode = false;

      renderTabs();
      renderProfile(current);
      toast('Готово');
    }).withFailureHandler(err=>toast(String(err))).getProfilesByRows(rows);
  }

  function refreshColors(opts = {}){
    const skipFilters = opts.skipFilters === true;
    if(current){
      updateHeader();
      updateAllGroupBadges();

      document.querySelectorAll('#out select[data-col]').forEach((sel)=>{
        applySelectColor(sel, sel.dataset.col, sel.value);
      });

      document.querySelectorAll('#out [data-bs="1"]').forEach((el)=>{
        const val = (el.tagName === 'INPUT' || el.tagName === 'SELECT') ? el.value : el.textContent;
        applyBSColor(el, val);
      });

      const verifyGroup = (current.groups || []).find(g=>isVerificationGroupName(g.name));
      if(verifyGroup){
        const fieldMap = {};
        for(const f of verifyGroup.fields){
          fieldMap[String(f.col).toUpperCase()] = f;
        }
        const card = document.querySelector(`.card[data-group="${cssEscape(verifyGroup.name)}"]`);
        if(card) applyVerificationCardColor(card, fieldMap);
      }
    }

    if(mccProfile){
      updateMccTabsColors();
      document.querySelectorAll('#mccOut select[data-col]').forEach((sel)=>{
        const col = sel.dataset.col;
        if(['N','O','Z'].includes(col)){
          applyMccSelectColor(sel, col, sel.value);
        }
      });
      document.querySelectorAll('#mccOut [data-bs="1"]').forEach((el)=>{
        const val = (el.tagName === 'INPUT' || el.tagName === 'SELECT') ? el.value : el.textContent;
        applyMccExpenseColor(el, val);
      });
      document.querySelectorAll('.mccVerificationBlock').forEach((block)=>{
        const uSelect = block.querySelector('select[data-col="U"]');
        const vSelect = block.querySelector('select[data-col="V"]');
        if(uSelect && vSelect){
          applyMccVerificationColors(uSelect, vSelect, uSelect.value, vSelect.value);
        }
      });
      document.querySelectorAll('.mccProxyCard [data-proxy-color="1"]').forEach((btn)=>{
        if(mccProfile?.profileRow) applyMccProxyUserIspColor(btn, mccProfile.profileRow, btn.dataset.col);
      });
      updateMccActionButtons();
    }

    if(!skipFilters){
      scheduleFiltersRefresh('refreshColors');
    }
    updateO1TabsColors();
    updateO1TopButton();
    updateMccTopButton();
    updateMccProfileTabsVisibility();
  }

  // --------------------- Instant save ---------------------
  function saveCellInstant(row, col, value, onOk, onFail, opts = {}){
    const c = String(col || '').toUpperCase().trim();
    if(!c){ onFail?.('Bad col'); return null; }
    return saveCellsInstant(row, { [c]: value }, onOk, onFail, opts);
  }

  function getCommitted(row, col, fallback){
    const key = `${row}:${col}`;
    return (_saveState.get(key)?.committed ?? fallback);
  }

  function initO1SaveState_(row, col, committed){
    const c = String(col || '').toUpperCase().trim();
    if(!row || !c) return;
    const key = `${row}:${c}`;
    const cur = _saveState.get(key);
    if(cur?.pending) return;
    _saveState.set(key, { ...(cur || {}), token: cur?.token || 0, committed, pending:false, failed:false });
  }

  function cancelO1QueuedJob_(job){
    if(!job || job.started || job.canceled) return false;
    job.canceled = true;
    if(job.singleKey) _o1QueuedSingleByCell.delete(job.singleKey);
    if(job.counted){
      job.counted = false;
      _o1PendingWrites = Math.max(0, _o1PendingWrites - job.cols.length);
      adjustO1PendingRow_(job.row, -job.cols.length);
      emitLocalQueue_();
    }
    return true;
  }

  function tryCollapseO1SingleWrite_(row, normalized, onOk){
    const cols = Object.keys(normalized || {});
    if(cols.length !== 1) return false;
    const col = cols[0];
    const key = `${row}:${col}`;
    const prevJob = _o1QueuedSingleByCell.get(key);
    if(!prevJob || prevJob.started || prevJob.canceled) return false;
    const nextValue = String(normalized[col] ?? '');
    const committed = String(prevJob.prevCommitted ?? '');
    if(nextValue !== committed) return false;
    if(!cancelO1QueuedJob_(prevJob)) return false;
    const cur = _saveState.get(key) || { token: 0, committed };
    cur.token += 1;
    cur.pending = false;
    cur.failed = false;
    cur.nextValue = committed;
    cur.committed = committed;
    _saveState.set(key, cur);
    rememberO1LocalValues_(row, { [col]: committed });
    onOk?.({ ok:true, canceled:true, applied:{ [col]: committed } });
    refreshColors({ source:'o1', skipFilters:true });
    return true;
  }


  function saveCellsInstant(row, updates, onOk, onFail, opts = {}){
    const normalized = Object.entries(updates || {}).reduce((acc, [col, value])=>{
      const c = String(col || '').toUpperCase().trim();
      if(c) acc[c] = value;
      return acc;
    }, {});
    const cols = Object.keys(normalized);
    if(!cols.length){ onFail?.('Нет данных для сохранения'); return; }

    if(tryCollapseO1SingleWrite_(row, normalized, onOk)) return { page:'O1', row:Number(row), cols, canceled:true };

    const tokens = {};
    const writeId = ++_o1WriteSeq;
    const tabKey = opts.tabKey || getTabKey(row);
    const profileName = opts.profileName || tabData[tabKey]?.profileName || (current?.row && String(current.row) === String(row) ? current.profileName : '');
    const ctx = { page:'O1', row:Number(row), cols, tabKey, profileName, writeId };

    for(const c of cols){
      const key = `${row}:${c}`;
      const st = _saveState.get(key) || { token: 0, committed: '' };
      st.token += 1;
      tokens[c] = st.token;
      st.pending = true;
      st.lastWriteId = writeId;
      st.nextValue = normalized[c];
      _saveState.set(key, st);
    }

    rememberO1LocalValues_(row, normalized);
    _o1PendingWrites += cols.length;
    emitLocalQueue_();
    adjustO1PendingRow_(row, cols.length);
    logSave_('O1', 'write queued', { row, cols, writeId, tabKey, profileName, pending: _o1PendingWrites });

    const singleKey = cols.length === 1 ? `${row}:${cols[0]}` : '';
    const job = {
      page:'O1',
      row,
      cols,
      writeId,
      singleKey,
      prevCommitted: singleKey ? String((_saveState.get(singleKey)?.committed) ?? '') : '',
      counted:true,
      started:false,
      canceled:false
    };
    if(singleKey) _o1QueuedSingleByCell.set(singleKey, job);

    enqueueWrite_('O1', (resolve)=>{
      if(job.canceled){ resolve(); return; }
      job.started = true;
      if(job.singleKey && _o1QueuedSingleByCell.get(job.singleKey) === job) _o1QueuedSingleByCell.delete(job.singleKey);
      let settled = false;
      const startedAt = Date.now();
      const settle = (kind, payload)=>{
        if(settled){
          logSave_('O1', `late ${kind} ignored`, { row, cols, writeId });
          return;
        }
        settled = true;
        clearTimeout(timer);

        const staleCols = cols.filter((c)=>{
          const cur = _saveState.get(`${row}:${c}`);
          return !cur || cur.token !== tokens[c];
        });
        const activeContext = isO1WriteContextActive_(ctx);
        const success = kind === 'success' && payload && payload.ok !== false;
        const error = success ? '' : (payload?.error || payload?.message || String(payload || 'Ошибка'));

        try {
          if(success){
            const rawApplied = (payload.applied && typeof payload.applied === 'object') ? payload.applied : normalized;
            const acceptedApplied = {};
            for(const c of cols){
              if(staleCols.includes(c)) continue;
              const key = `${row}:${c}`;
              const cur = _saveState.get(key) || { token: 0, committed: '' };
              cur.committed = Object.prototype.hasOwnProperty.call(rawApplied, c) ? rawApplied[c] : normalized[c];
              cur.pending = false;
              cur.failed = false;
              _saveState.set(key, cur);
              acceptedApplied[c] = cur.committed;
            }
            if(Object.keys(acceptedApplied).length){
              _o1WriteRevision += 1;
              rememberO1LocalValues_(row, acceptedApplied);
            }
            if(staleCols.length){
              logSave_('O1', 'stale success settled without UI overwrite', { row, cols, staleCols, writeId });
            } else if(activeContext){
              onOk?.({ ...payload, applied: Object.keys(acceptedApplied).length ? acceptedApplied : rawApplied, context: ctx });
            } else {
              logSave_('O1', 'closed/inactive tab write completed without DOM update', { row, cols, writeId, activeRow: current?.row || '' });
            }

            if(cols.some((c)=>O1_REFRESH_COLS.has(c))){
              scheduleFiltersRefresh('status-change');
            }
            if(activeContext) refreshColors({ source:'o1', skipFilters:true });
            logSave_('O1', 'success/applied', { row, cols, writeId, applied: acceptedApplied, ms: Date.now() - startedAt });
          } else {
            _o1FailedWrites += staleCols.length === cols.length ? 0 : 1;
            for(const c of cols){
              const cur = _saveState.get(`${row}:${c}`);
              if(cur && cur.token === tokens[c]){
                cur.pending = false;
                cur.failed = true;
                _saveState.set(`${row}:${c}`, cur);
              }
            }
            if(staleCols.length === cols.length){
              logSave_('O1', 'stale failure settled', { row, cols, writeId, error });
            } else if(activeContext){
              onFail?.(error);
            } else {
              toast('Ошибка фонового сохранения');
              logSave_('O1', 'background failure without DOM update', { row, cols, writeId, error });
            }
            logSave_('O1', kind === 'timeout' ? 'timeout' : 'failure', { row, cols, writeId, error, failed: _o1FailedWrites, ms: Date.now() - startedAt });
          }
        } finally {
          if(job.counted){
            job.counted = false;
            _o1PendingWrites = Math.max(0, _o1PendingWrites - cols.length);
            emitLocalQueue_();
            adjustO1PendingRow_(row, -cols.length);
          }
          replayInactiveO1PendingNext_(ctx, normalized, activeContext);
          logSave_('O1', 'queue settle', { row, cols, writeId, pending: _o1PendingWrites, rowPending: getO1PendingCountForRow(row) });
          resolve();
        }
      };

      const timer = setTimeout(()=>{
        settle('timeout', { ok:false, error:'Таймаут сохранения' });
      }, O1_SAVE_TIMEOUT_MS);

      logSave_('O1', 'queue start', { row, cols, writeId });
      try {
        google.script.run
        .withSuccessHandler((r)=>settle('success', r))
        .withFailureHandler((err)=>settle('failure', { ok:false, error:String(err) }))
        .updateCells(row, normalized);
      } catch (err) {
        settle('failure', { ok:false, error:String(err) });
      }
    });

    return ctx;
  }

  function commitO1CellFromElement(opts){
    const el = opts?.el || null;
    const row = opts?.row;
    const col = String(opts?.col || '').toUpperCase().trim();
    const field = opts?.field || null;
    const value = opts?.value ?? '';
    if(!row || !col) return null;

    if(el && el.dataset.saving === '1'){
      const queued = _o1QueuedSingleByCell.get(`${row}:${col}`);
      if(queued && !queued.started && !queued.canceled && String(value ?? '') === String(queued.prevCommitted ?? '')){
        if(field) field.value = value;
        if('value' in el) el.value = value;
        else el.textContent = value;
        delete el.dataset.pendingNextValue;
        el.dataset.saving = '0';
        return saveCellInstant(row, col, value, (r)=>{
          markFieldSaved(el);
          opts.onSaved?.(r, value);
        }, (err)=>{
          markFieldSaveError(el);
          opts.onFailed?.(err);
        }, opts.saveOptions || {});
      }
      el.dataset.pendingNextValue = String(value ?? '');
      setO1PendingNext_(row, col, value, opts.saveOptions || {});
      logSave_('O1', 'pendingNextValue detected', { row, col, value: el.dataset.pendingNextValue });
      return null;
    }

    if(el){
      el.dataset.saving = '1';
      el.dataset.row = String(row);
      el.dataset.col = col;
    }
    if(field) field.value = value;
    toast(opts.savingText || 'Сохранение…');
    if(el) markFieldSaving(el, true);

    const committedValue = value;
    const finish = (ok)=>{
      if(el){
        el.dataset.saving = '0';
        const hasPending = Object.prototype.hasOwnProperty.call(el.dataset, 'pendingNextValue');
        const pendingValue = hasPending ? el.dataset.pendingNextValue : null;
        delete el.dataset.pendingNextValue;
        if(ok) delete el.dataset.unsaved;
        else el.dataset.unsaved = '1';

        if(ok && hasPending){
          takeO1PendingNext_(row, col);
          if(String(pendingValue) !== String(committedValue)){
            if('value' in el) el.value = pendingValue;
            else el.textContent = pendingValue;
            logSave_('O1', 'pendingNextValue replay', { row, col, value: pendingValue });
            setTimeout(()=>commitO1CellFromElement({ ...opts, value: pendingValue }), 0);
          }
        } else if(!ok && hasPending){
          el.dataset.pendingNextValue = pendingValue;
        }
      }
    };

    return saveCellInstant(row, col, committedValue, (r)=>{
      const applied = o1AppliedValue_(r, col, committedValue);
      if(field) field.value = applied;
      if(el){
        if('value' in el) el.value = applied;
        else el.textContent = applied;
        markFieldSaved(el);
      }
      opts.onSaved?.(r, applied);
      finish(true);
    }, (err)=>{
      if(el) markFieldSaveError(el);
      opts.onFailed?.(err);
      finish(false);
    }, opts.saveOptions || {});
  }

  function saveO1RechekExpenseInstant(row, nextValue, fieldMap, uiContext = {}){
    const nextBS = String(nextValue ?? '');
    const hasExpense = !!nextBS.trim();
    const prevDate = String(fieldMap?.BQ?.value || getO1FieldValue(tabData[getTabKey(row)] || current, 'BQ') || '').trim();
    const oldBwValue = String(fieldMap?.BW?.value || getO1FieldValue(tabData[getTabKey(row)] || current, 'BW') || '').trim();
    const updates = { BS: nextBS };
    const shouldEmitRechekPlus = hasExpense && oldBwValue !== '+';

    if(hasExpense && !prevDate) updates.BQ = isoTodayByTz('Asia/Ho_Chi_Minh');
    if(hasExpense && oldBwValue !== '+') updates.BW = '+';

    logSave_('O1', 'rechek atomic queued', { row, updates, oldBwValue });
    return saveCellsInstant(row, updates, (r)=>{
      const applied = (r?.applied && typeof r.applied === 'object') ? r.applied : updates;
      for(const [col, value] of Object.entries(applied)){
        if(fieldMap?.[col]) fieldMap[col].value = value;
      }

      const fieldsWrap = uiContext.fieldsWrap || null;
      if(fieldsWrap && isActiveO1Row_(row)){
        const dateEl = fieldsWrap.querySelector(`[data-row="${row}"][data-col="BQ"]`);
        if(dateEl && Object.prototype.hasOwnProperty.call(applied, 'BQ') && 'value' in dateEl) dateEl.value = String(applied.BQ || '');
        const bwEl = fieldsWrap.querySelector(`[data-row="${row}"][data-col="BW"]`);
        if(bwEl && Object.prototype.hasOwnProperty.call(applied, 'BW')){
          if('value' in bwEl) bwEl.value = String(applied.BW || '');
          applySelectColor(bwEl, 'BW', applied.BW || '');
        }
      }

      if(applied.BW === '+' && shouldEmitRechekPlus){
        sproutgEmitStatusEvent('O1', 'Речек', '+', 'BW', row, oldBwValue);
      }
      logSave_('O1', 'rechek atomic success/applied', { row, applied });
      uiContext.onSaved?.(r, applied);
    }, (err)=>{
      logSave_('O1', 'rechek atomic failure', { row, updates, error: String(err || '') });
      uiContext.onFailed?.(err);
    }, {
      tabKey: uiContext.tabKey || getTabKey(row),
      profileName: uiContext.profileName || tabData[getTabKey(row)]?.profileName || ''
    });
  }

  // ---------- Helpers ----------
  function getGroup(payload, name){ return payload?.groups?.find(g=>g.name===name) || null; }
  function getField(group, col){ return group?.fields?.find(f=>String(f.col).toUpperCase()===String(col).toUpperCase()) || null; }
  function getValue(payload, groupName, col){
    const g=getGroup(payload, groupName);
    const f=getField(g, col);
    return String(f?.value || '').trim();
  }

  // ✅ FarmA_0.3.9.7_dev: Verification group name + whole card coloring
  function isVerificationGroupName(name){
    return /вериф/i.test(String(name || '').trim());
  }
  function applyVerificationCardColor(card, fieldMap){
    if(!card || !fieldMap) return;
    card.classList.remove('verifyGreen','verifyRed');
    const v = String(fieldMap['BO']?.value ?? '').trim();
    if(v === 'Успешно') card.classList.add('verifyGreen');
    else if(v === 'Отказ') card.classList.add('verifyRed');
  }

  function autoSetO1VerificationBan(card, fieldMap){
    const desired = 'Разбан вериф бизнес';
    const bpField = fieldMap?.BP;
    if(!bpField) return;
    const options = (bpField.options || []).map(x=>String(x ?? '').trim());
    if(!options.includes(desired)){
      toast('Нет опции "Разбан вериф бизнес" для BP');
      return;
    }
    if(String(bpField.value || '').trim() === desired) return;
    bpField.value = desired;
    const bpSelect = card?.querySelector('select[data-col="BP"]');
    if(bpSelect){
      bpSelect.value = desired;
      applySelectColor(bpSelect, 'BP', desired);
    }
    toast('Сохранение…');
    saveCellInstant(current.row, 'BP', desired, ()=>toast('Сохранено'), (err)=>toast(err||'Ошибка'));
  }

  // ---------- Δ days badges ----------
  const DELTA_RULES = [
    { group:'Ads Видео', dateCol:'AQ', prevGroup:'Аккаунт', prevDateCol:'O', expected:1 },
    { group:'Платежка', dateCol:'BC', prevGroup:'Ads Видео', prevDateCol:'AQ', expected:1 },
    { group:'Речек', dateCol:'BQ', prevGroup:'Платежка', prevDateCol:'BC', expected:7 },
    { group:'РК', dateCol:'BZ', prevGroup:'Платежка', prevDateCol:'BC', expected:3 },
  ];

  function isoToUtc(iso){
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3]), 0,0,0);
  }
  function diffDays(isoA, isoB){
    const a=isoToUtc(isoA), b=isoToUtc(isoB);
    if(a==null || b==null) return null;
    return Math.round((a-b)/86400000);
  }

  function buildBadge(text, cls){
    const s=document.createElement('span');
    s.className='badge ' + (cls||'');
    s.textContent=text;
    return s;
  }

  function insertBeforeAnchor(meta, node){
    const anchor = meta.querySelector('.banBtn') || meta.querySelector('.numBtn') || null;
    if(anchor) meta.insertBefore(node, anchor);
    else meta.appendChild(node);
  }

  function updateAllGroupBadges(){
    if(!current) return;

    const dateMap = {
      'O': getValue(current,'Аккаунт','O'),
      'AQ': getValue(current,'Ads Видео','AQ'),
      'BC': getValue(current,'Платежка','BC'),
      'BQ': getValue(current,'Речек','BQ'),
      'BZ': getValue(current,'РК','BZ'),
    };

    for(const g of current.groups){
      const card=document.querySelector(`.card[data-group="${cssEscape(g.name)}"]`);
      if(!card) continue;
      const meta=card.querySelector('.meta2');
      if(!meta) continue;

      const old = meta.querySelectorAll('[data-badge="date"],[data-badge="delta"]');
      old.forEach(x=>x.remove());

      if(g.date?.iso){
        const b=buildBadge('Дата: ' + toRuDate(g.date.iso), '');
        b.dataset.badge='date';
        insertBeforeAnchor(meta, b);
      }

      const rule = DELTA_RULES.find(r=>r.group===g.name);
      if(rule){
        const curIso = dateMap[rule.dateCol] || '';
        const prevIso = dateMap[rule.prevDateCol] || '';
        const d = diffDays(curIso, prevIso);
        if(d != null){
          let cls='';
          if(d === rule.expected) cls='greenLight';
          else if(d < rule.expected) cls='yellowLight';
          else cls='redLight';

          const b=buildBadge(`Δ ${d}д`, cls);
          b.dataset.badge='delta';
          insertBeforeAnchor(meta, b);
        }
      }
    }
  }

  // ---------- Select coloring ----------
  function applySelectColor(el, col, value){
    el.classList.remove('greenLight','yellowLight','redLight','blueLight','pinkLight');
    delete el.dataset.appcolor;
    const v=String(value||'').trim();

    if(col==='AE'){
      const greenSet=new Set(['Без 1','Без 2','Номер С 1','Номер С 2']);
      if(greenSet.has(v)) el.classList.add('greenLight');
      else if(v==='С 1') el.classList.add('yellowLight');
      else if(v==='С 2') el.classList.add('redLight');
      if(el.classList.contains('greenLight') || el.classList.contains('yellowLight') || el.classList.contains('redLight')) el.dataset.appcolor = '1';
      return;
    }
    if(['AZ','BI','CF'].includes(col)){
      if(v==='+') el.classList.add('greenLight');
      else if(v==='?') el.classList.add('yellowLight');
      else if(v==='Бан') el.classList.add('redLight');
      if(el.classList.contains('greenLight') || el.classList.contains('yellowLight') || el.classList.contains('redLight')) el.dataset.appcolor = '1';
      return;
    }
    if(col==='BW'){
      if(v==='+') el.classList.add('greenLight');
      else if(v==='?') el.classList.add('yellowLight');
      else if(v==='Бан') el.classList.add('redLight');
      else if(v==='Вышел') el.classList.add('blueLight');
      else if(v==='Не вышел') el.classList.add('redLight');
      else if(BAN_YELLOW_VALUES.has(v)) el.classList.add('yellowLight');
      if(el.classList.contains('greenLight') || el.classList.contains('yellowLight') || el.classList.contains('blueLight') || el.classList.contains('redLight')) el.dataset.appcolor = '1';
      return;
    }
    if(col==='BO'){
      if(v==='Успешно') el.classList.add('greenLight');
      else if(v==='На рассмотрении') el.classList.add('blueLight');
      else if(v==='Отказ') el.classList.add('redLight');
      else if(BAN_YELLOW_VALUES.has(v)) el.classList.add('yellowLight');
      if(el.classList.contains('greenLight') || el.classList.contains('blueLight') || el.classList.contains('redLight') || el.classList.contains('yellowLight')) el.dataset.appcolor = '1';
      return;
    }
    if(col==='BP'){
      if(!v) return;
      if(v==='Бан аккаунта') el.classList.add('redLight');
      else el.classList.add('greenLight');
      if(el.classList.contains('greenLight') || el.classList.contains('redLight')) el.dataset.appcolor = '1';
      return;
    }

    // ✅ FarmA_0.3.9.6_dev FIX: BAN-reasons dropdown coloring (Verification BX and also BA/BJ/CG)
    if(['BA','BJ','BX','CG'].includes(col)){
      if(!v) return;
      if(BAN_RED_VALUES.has(v)) el.classList.add('redLight');
      else if(BAN_YELLOW_VALUES.has(v)) el.classList.add('yellowLight');
      if(el.classList.contains('yellowLight') || el.classList.contains('redLight')) el.dataset.appcolor = '1';
      return;
    }
  }

  function applyBSColor(el, v){
    el.classList.remove('redLight','greenLight','yellowLight');
    delete el.dataset.appcolor;
    const s=String(v||'').trim();
    if(!s) return;
    if(s === '0.00$') el.classList.add('redLight');
    else el.classList.add('greenLight');
    if(el.classList.contains('redLight') || el.classList.contains('greenLight')) el.dataset.appcolor = '1';
  }

  function applySheetCellColorHint(el, bgHex){
    if(!el) return;
    el.classList.remove('sheetHinted');
    el.style.removeProperty('--sheet-hint');
    if(el.dataset.appcolor === '1') return;
    const hasInlineBackground = !!String(el.style.background || '').trim() || !!String(el.style.backgroundColor || '').trim();
    const hasInlineBorder = !!String(el.style.border || '').trim() || !!String(el.style.borderColor || '').trim();
    if(hasInlineBackground || hasInlineBorder) return;
    const bg = String(bgHex || '').trim().toLowerCase();
    if(!bg || bg === '#fff' || bg === '#ffffff') return;
    if(!/^#[0-9a-f]{6}$/.test(bg)) return;
    el.style.setProperty('--sheet-hint', bg);
    el.classList.add('sheetHinted');
  }

  // ---------- Special rows builders ----------
  function splitBF(raw){
    const s = String(raw||'').trim().replace(/\s+/g,' ');
    if(!s) return {p1:'',p2:'',p3:''};
    const m = s.match(/(\d{16})\s+(\d{2}\/\d{2})\s+(\d{3})/);
    if(m) return {p1:m[1], p2:m[2], p3:m[3]};
    const digits = s.replace(/[^\d]/g,'');
    const exp = (s.match(/\d{2}\/\d{2}/) || [])[0] || '';
    let p1 = digits.slice(0,16);
    let p3 = digits.length>=19 ? digits.slice(-3) : '';
    return {p1, p2:exp, p3};
  }

  function renderCompanyRow(fieldsWrap, fieldMap){
    const fBH = fieldMap['BH'];
    const labelText = (fBH?.label && String(fBH.label).trim()) ? fBH.label : 'Компания';
    const cols = ['BH','CO','CP','CQ'];

    const row=document.createElement('div');
    row.className='field';

    const label=document.createElement('div');
    label.className='label';
    label.textContent=labelText;
    label.title='BH + CO..CQ';

    const grid=document.createElement('div');
    grid.className='companyGrid4';

    for(const c of cols){
      const f = fieldMap[c];
      const v = String(f?.value ?? '').trim();

      if(editMode){
        const inp=document.createElement('input');
        inp.type='text';
        inp.className='value';
        inp.value=v;
        inp.title=c;
        inp.dataset.col = c;
        inp.dataset.row = String(current?.row || '');

        inp.addEventListener('blur', ()=>{
          if(!f) return;
          f.value = inp.value;
          commitO1CellFromElement({
            row: inp.dataset.row,
            col: c,
            value: inp.value,
            el: inp,
            field: f,
            saveOptions: { tabKey: getTabKey(inp.dataset.row), profileName: current?.profileName || '' },
            onSaved: ()=>toast('Сохранено'),
            onFailed: (err)=>toast(err||'Ошибка')
          });
        });
        inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }});
        grid.appendChild(inp);
      } else {
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='btn value';
        btn.textContent=v;
        btn.title=c;
        btn.addEventListener('click', ()=>copyText(v));
        grid.appendChild(btn);
      }
    }

    row.appendChild(label);
    row.appendChild(grid);
    row.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row);
  }

  function renderEEDunsRow(fieldsWrap, fieldMap){
    const cols = ['CR','CS'];

    const row=document.createElement('div');
    row.className='field';

    const label=document.createElement('div');
    label.className='label';
    label.textContent='EE&DUNS';
    label.title='CR + CS';

    const grid=document.createElement('div');
    grid.className='eedunsGrid';

    for(const c of cols){
      const f = fieldMap[c];
      const v = String(f?.value ?? '').trim();

      if(editMode){
        const inp=document.createElement('input');
        inp.type='text';
        inp.className='value';
        inp.value=v;
        inp.title=c;
        inp.dataset.col = c;
        inp.dataset.row = String(current?.row || '');

        inp.addEventListener('blur', ()=>{
          if(!f) return;
          f.value = inp.value;
          commitO1CellFromElement({
            row: inp.dataset.row,
            col: c,
            value: inp.value,
            el: inp,
            field: f,
            saveOptions: { tabKey: getTabKey(inp.dataset.row), profileName: current?.profileName || '' },
            onSaved: ()=>toast('Сохранено'),
            onFailed: (err)=>toast(err||'Ошибка')
          });
        });
        inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }});
        grid.appendChild(inp);
      } else {
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='btn value';
        btn.textContent=v;
        btn.title=c;
        btn.addEventListener('click', ()=>copyText(v));
        grid.appendChild(btn);
      }
    }

    row.appendChild(label);
    row.appendChild(grid);
    row.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row);
  }

  function renderBFRow(fieldsWrap, fieldMap){
    const fBF = fieldMap['BF'];
    if(!fBF) return;
    const labelText = (fBF?.label && String(fBF.label).trim()) ? fBF.label : 'BF';
    const parts = splitBF(fBF?.value);

    const row=document.createElement('div');
    row.className='field';

    const label=document.createElement('div');
    label.className='label';
    label.textContent=labelText;
    label.title='BF';

    const grid=document.createElement('div');
    grid.className='bfRow';

    const makeBtn = (txt, auto=false)=>{
      const b=document.createElement('button');
      b.type='button';
      b.className=('btn value centerText ' + (auto?'bfAuto':'')).trim();
      b.textContent=txt;
      b.addEventListener('click', ()=>copyText(txt));
      return b;
    };

    if(editMode){
      const i1=document.createElement('input'); i1.type='text'; i1.className='value centerText'; i1.value=parts.p1;
      const i2=document.createElement('input'); i2.type='text'; i2.className='value centerText bfAuto'; i2.value=parts.p2;
      const i3=document.createElement('input'); i3.type='text'; i3.className='value centerText bfAuto'; i3.value=parts.p3;
      const rowNum = String(current?.row || '');
      const profileName = current?.profileName || '';
      for(const el of [i1,i2,i3]){
        el.dataset.row = rowNum;
        el.dataset.col = 'BF';
      }

      const commit = ()=>{
        const p1=String(i1.value||'').trim();
        const p2=String(i2.value||'').trim();
        const p3=String(i3.value||'').trim();
        const combined = [p1,p2,p3].filter(x=>x.length).join(' ').trim();
        fBF.value = combined;

        toast('Сохранение…');
        saveCellInstant(rowNum, 'BF', combined, ()=>toast('Сохранено'), (err)=>toast(err||'Ошибка'), { tabKey: getTabKey(rowNum), profileName });
      };

      for(const el of [i1,i2,i3]){
        el.addEventListener('blur', commit);
        el.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); el.blur(); }});
      }

      grid.appendChild(i1); grid.appendChild(i2); grid.appendChild(i3);
    } else {
      grid.appendChild(makeBtn(parts.p1, false));
      grid.appendChild(makeBtn(parts.p2, true));
      grid.appendChild(makeBtn(parts.p3, true));
    }

    row.appendChild(label);
    row.appendChild(grid);
    row.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row);
  }

  function renderYouTubeRow(fieldsWrap){
    const v1 = getO1FieldValue(current, 'AS');
    const v2 = getO1FieldValue(current, 'AY');

    const row=document.createElement('div');
    row.className='field';

    const label=document.createElement('div');
    label.className='label';
    label.textContent='YouTube';
    label.title='AS + AY';

    const grid=document.createElement('div');
    grid.className='youtubeRow';

    const makeBtn = (txt)=>{
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='btn value';
      btn.textContent=String(txt ?? '').trim();
      btn.addEventListener('click', ()=>copyText(btn.textContent));
      return btn;
    };

    grid.appendChild(makeBtn(v1));
    grid.appendChild(makeBtn(v2));

    row.appendChild(label);
    row.appendChild(grid);
    row.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row);
  }

  function renderRKGeoBudgetRow(fieldsWrap, fieldMap){
    const fCB = fieldMap['CB'];
    const fCC = fieldMap['CC'];
    const fCD = fieldMap['CD'];

    const row=document.createElement('div');
    row.className='field';

    const label=document.createElement('div');
    label.className='label';
    label.textContent='Гео/$/Бюджет';
    label.title='CB + CC + CD';

    const grid=document.createElement('div');
    grid.className='rkGeoRow';

    const makeBtn=(txt)=> {
      const b=document.createElement('button');
      b.type='button';
      b.className='btn value centerText rkMini';
      b.textContent=txt;
      b.addEventListener('click', ()=>copyText(txt));
      return b;
    };

    const makeInp=(col, f)=>{
      const inp=document.createElement('input');
      inp.type='text';
      inp.className='value centerText rkMini';
      inp.value=String(f?.value ?? '').trim();
      inp.title=col;
      inp.dataset.col = col;
      inp.dataset.row = String(current?.row || '');

      inp.addEventListener('blur', ()=>{
        if(!f) return;
        f.value = inp.value;
        commitO1CellFromElement({
          row: inp.dataset.row,
          col,
          value: inp.value,
          el: inp,
          field: f,
          saveOptions: { tabKey: getTabKey(inp.dataset.row), profileName: current?.profileName || '' },
          onSaved: ()=>toast('Сохранено'),
          onFailed: (err)=>toast(err||'Ошибка')
        });
      });
      inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }});
      return inp;
    };

    if(editMode){
      grid.appendChild(makeInp('CB', fCB));
      grid.appendChild(makeInp('CC', fCC));
      grid.appendChild(makeInp('CD', fCD));
    } else {
      grid.appendChild(makeBtn(String(fCB?.value ?? '').trim()));
      grid.appendChild(makeBtn(String(fCC?.value ?? '').trim()));
      grid.appendChild(makeBtn(String(fCD?.value ?? '').trim()));
    }

    row.appendChild(label);
    row.appendChild(grid);
    row.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row);
  }

  function renderDOBRow(fieldsWrap, fieldMap){
    const fT = fieldMap['T'];
    const fU = fieldMap['U'];
    const fV = fieldMap['V'];

    const row=document.createElement('div');
    row.className='field';

    const label=document.createElement('div');
    label.className='label';
    label.textContent='Дата Рождения';
    label.title='T + U + V';

    const grid=document.createElement('div');
    grid.className='dobRow';

    const makeBtn=(txt)=> {
      const b=document.createElement('button');
      b.type='button';
      b.className='btn value centerText';
      b.textContent=txt;
      b.addEventListener('click', ()=>copyText(txt));
      return b;
    };

    const makeInp=(col, f)=>{
      const inp=document.createElement('input');
      inp.type='text';
      inp.className='value centerText';
      inp.value=String(f?.value ?? '').trim();
      inp.title=col;
      inp.dataset.col = col;
      inp.dataset.row = String(current?.row || '');

      inp.addEventListener('blur', ()=>{
        if(!f) return;
        f.value = inp.value;
        commitO1CellFromElement({
          row: inp.dataset.row,
          col,
          value: inp.value,
          el: inp,
          field: f,
          saveOptions: { tabKey: getTabKey(inp.dataset.row), profileName: current?.profileName || '' },
          onSaved: ()=>toast('Сохранено'),
          onFailed: (err)=>toast(err||'Ошибка')
        });
      });
      inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }});
      return inp;
    };

    if(editMode){
      grid.appendChild(makeInp('T', fT));
      grid.appendChild(makeInp('U', fU));
      grid.appendChild(makeInp('V', fV));
    } else {
      grid.appendChild(makeBtn(String(fT?.value ?? '').trim()));
      grid.appendChild(makeBtn(String(fU?.value ?? '').trim()));
      grid.appendChild(makeBtn(String(fV?.value ?? '').trim()));
    }

    row.appendChild(label);
    row.appendChild(grid);
    row.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row);
  }

  // ---------- TOTP (AD) ----------
  function base32ToBytes(base32){
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = String(base32||'').toUpperCase().replace(/[^A-Z2-7]/g,'');
    if(!clean) return new Uint8Array([]);

    let bits = 0;
    let value = 0;
    const out = [];

    for (let i=0;i<clean.length;i++){
      const idx = alphabet.indexOf(clean[i]);
      if(idx < 0) continue;
      value = (value << 5) | idx;
      bits += 5;
      if(bits >= 8){
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  function counterToBytes(counter){
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    const hi = Math.floor(counter / 0x100000000);
    const lo = counter >>> 0;
    view.setUint32(0, hi);
    view.setUint32(4, lo);
    return new Uint8Array(buf);
  }

  async function hmacSha1(keyBytes, msgBytes){
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name:'HMAC', hash:'SHA-1' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
    return new Uint8Array(sig);
  }

  async function totp(secretBase32, period=30, digits=6){
    const keyBytes = base32ToBytes(secretBase32);
    if(!keyBytes || !keyBytes.length) return null;

    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / period);
    const msg = counterToBytes(counter);

    const hs = await hmacSha1(keyBytes, msg);
    const offset = hs[hs.length - 1] & 0x0f;
    const binCode =
      ((hs[offset] & 0x7f) << 24) |
      ((hs[offset + 1] & 0xff) << 16) |
      ((hs[offset + 2] & 0xff) << 8) |
      (hs[offset + 3] & 0xff);

    const mod = 10 ** digits;
    const code = String(binCode % mod).padStart(digits,'0');
    const remain = period - (now % period);

    return { code, remain };
  }

  function stopTotp(){
    if(totpInterval){
      clearInterval(totpInterval);
      totpInterval = null;
    }
  }

  function stopSmsPool(){
    if(smsPoolUIState.pollTimerId){
      clearInterval(smsPoolUIState.pollTimerId);
      smsPoolUIState.pollTimerId = null;
    }
    if(smsPoolUIState.countdownTimerId){
      clearInterval(smsPoolUIState.countdownTimerId);
      smsPoolUIState.countdownTimerId = null;
    }
    if(smsPoolUIState.balanceTimerId){
      clearInterval(smsPoolUIState.balanceTimerId);
      smsPoolUIState.balanceTimerId = null;
    }
  }

  function smsPoolDefaultState(){
    return {
      activeOrder: null,
      balanceLastTs: 0,
      balanceText: '—',
      apFillPending: false,
      codeText: 'Готов к заказу',
      codeValue: '',
      orderRow: null
    };
  }

  function smsPoolStoreState(row){
    if(!row) return;
    smsPoolProfileStates.set(String(row), {
      activeOrder: smsPoolUIState.activeOrder,
      balanceLastTs: smsPoolUIState.balanceLastTs,
      balanceText: smsPoolUIState.balanceText,
      apFillPending: smsPoolUIState.apFillPending,
      codeText: smsPoolUIState.codeText,
      codeValue: smsPoolUIState.codeValue,
      orderRow: smsPoolUIState.orderRow
    });
  }

  function smsPoolLoadState(row){
    const base = smsPoolDefaultState();
    const stored = smsPoolProfileStates.get(String(row));
    const next = stored ? { ...base, ...stored } : base;
    smsPoolUIState.profileRow = row;
    smsPoolUIState.activeOrder = next.activeOrder;
    smsPoolUIState.balanceLastTs = next.balanceLastTs;
    smsPoolUIState.balanceText = next.balanceText;
    smsPoolUIState.apFillPending = next.apFillPending;
    smsPoolUIState.codeText = next.codeText;
    smsPoolUIState.codeValue = next.codeValue;
    smsPoolUIState.orderRow = next.orderRow;
  }

  function smsPoolFindOrderRow(orderId){
    if(!orderId) return '';
    for(const [row, state] of smsPoolProfileStates.entries()){
      const storedId = state?.activeOrder?.order_id;
      if(storedId && String(storedId) === String(orderId)) return row;
    }
    return '';
  }

  // ✅ FarmA_0.3.9.7_dev: dynamic TOTP button color by timer
  function applyTotpColor(btn, remain){
    btn.classList.remove('greenLight','yellowLight','redLight');
    const r = Number(remain);
    if(!Number.isFinite(r)) return;
    if(r <= 5) btn.classList.add('redLight');
    else if(r <= 10) btn.classList.add('yellowLight');
    else btn.classList.add('greenLight');
  }

  function renderTotpRow(fieldsWrap, fieldMap){
    const fAD = fieldMap['AD'];
    if(!fAD) return;

    const row=document.createElement('div');
    row.className='field';

    const label=document.createElement('div');
    label.className='label';
    label.textContent='2FA (TOTP)';
    label.title='AD';

    const wrap=document.createElement('div');
    wrap.className='totpField';

    const codeBtn=document.createElement('button');
    codeBtn.type='button';
    codeBtn.className='btn value totpCodeBtn centerText';
    codeBtn.textContent='------';
    codeBtn.title='Нажми чтобы скопировать код';

    codeBtn.addEventListener('click', ()=>copyText(codeBtn.textContent));

    const meta=document.createElement('div');
    meta.className='totpMeta';

    const timer=document.createElement('span');
    timer.textContent='—';
    meta.appendChild(timer);

    wrap.appendChild(codeBtn);
    wrap.appendChild(meta);

    row.appendChild(label);
    row.appendChild(wrap);
    row.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row);

    // start updater
    stopTotp();
    const update = async ()=>{
      const sec = String(fAD.value || '').trim();
      if(!sec){
        codeBtn.textContent='------';
        timer.textContent='нет AD';
        applyTotpColor(codeBtn, NaN);
        return;
      }
      try{
        const r = await totp(sec, 30, 6);
        if(!r){
          codeBtn.textContent='------';
          timer.textContent='ошибка AD';
          applyTotpColor(codeBtn, NaN);
          return;
        }
        codeBtn.textContent = r.code;
        timer.textContent = `${r.remain}s`;
        applyTotpColor(codeBtn, r.remain);
      }catch(e){
        codeBtn.textContent='------';
        timer.textContent='ошибка';
        applyTotpColor(codeBtn, NaN);
      }
    };

    update();
    totpInterval = setInterval(update, 1000);
  }

  // ---------- AP row (end of Account group) ----------
  function renderAPRow(fieldsWrap, fieldMap){
    const fAP = fieldMap['AP'];
    if(!fAP) return;
    if(fieldsWrap.querySelector('.apField')) return;

    const row=document.createElement('div');
    row.className='field apField';

    const label=document.createElement('div');
    label.className='label';
    label.textContent=(fAP.label && String(fAP.label).trim()) ? fAP.label : fAP.col;
    label.title=`${fAP.col} • ${fAP.label || ''}`.trim();

    const actions=document.createElement('div');
    actions.className='actions';

    if(editMode){
      const inp=document.createElement('input');
      inp.type='text';
      inp.className='value';
      inp.value=String(fAP.value ?? '');
      inp.title='AP';
      inp.dataset.col = 'AP';
      inp.dataset.row = String(current?.row || '');

      inp.addEventListener('blur', ()=>{
        fAP.value = inp.value;
        commitO1CellFromElement({
          row: inp.dataset.row,
          col: 'AP',
          value: inp.value,
          el: inp,
          field: fAP,
          saveOptions: { tabKey: getTabKey(inp.dataset.row), profileName: current?.profileName || '' },
          onSaved: ()=>toast('Сохранено'),
          onFailed: (err)=>toast(err||'Ошибка')
        });
      });
      inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }});

      row.appendChild(label);
      row.appendChild(inp);
      row.appendChild(actions);
      fieldsWrap.appendChild(row);
    } else {
      const btn=document.createElement('button');
      btn.className='btn value';
      btn.type='button';
      btn.textContent=fAP.value ?? '';
      btn.addEventListener('click', ()=>copyText(btn.textContent));

      row.appendChild(label);
      row.appendChild(btn);
      row.appendChild(actions);
      fieldsWrap.appendChild(row);
    }
  }

  // ---------- SMSPool ----------
  function renderSmsPoolCard(){
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.group = 'SMSPool';
    card.dataset.section = 'SMSPool';
    card.innerHTML = `
      <div class="title">
        <h3>SMSPool • One-time</h3>
        <div class="meta2">
          <button class="btn btnPrimary smsPoolOrderBtn" type="button">Заказать номер</button>
          <button class="btn smsPoolRefundBtn" type="button" disabled>Refund</button>
        </div>
      </div>
      <div class="field">
        <div class="label">Номер</div>
        <button class="btn value smsPoolNumber" type="button">—</button>
        <div class="actions">
          <div class="smsPoolPrice smsPoolMeta">—</div>
        </div>
      </div>
      <div class="field">
        <div class="label">Таймер</div>
        <div class="value smsPoolTimer">—</div>
        <div class="actions">
          <div class="smsPoolBalance smsPoolMeta">—</div>
        </div>
      </div>
      <div class="field">
        <div class="label">Код</div>
        <div class="value smsPoolCode">Готов к заказу</div>
        <div class="actions"></div>
      </div>
    `;

    const elements = {
      orderBtn: card.querySelector('.smsPoolOrderBtn'),
      refundBtn: card.querySelector('.smsPoolRefundBtn'),
      number: card.querySelector('.smsPoolNumber'),
      timer: card.querySelector('.smsPoolTimer'),
      code: card.querySelector('.smsPoolCode'),
      price: card.querySelector('.smsPoolPrice'),
      balance: card.querySelector('.smsPoolBalance')
    };
    smsPoolUIState.elements = elements;

    elements.orderBtn.addEventListener('click', smsPoolOrder);
    elements.refundBtn.addEventListener('click', smsPoolRefund);
    elements.number.addEventListener('click', ()=>{
      const raw = smsPoolUIState.activeOrder?.number || elements.number.textContent || '';
      const num = smsPoolNormalizeNumber(raw);
      if(num && num !== '—') copyText(num);
    });

    return card;
  }

  function smsPoolNormalizeNumber(raw){
    const s = String(raw || '').trim();
    if(!s) return '';
    return s.startsWith('+') ? s : `+${s}`;
  }

  function smsPoolDigitsOnly(raw){
    return String(raw || '').replace(/[^\d]/g, '');
  }

  function smsPoolFormatMoney(raw){
    if(raw == null) return '—';
    const text = String(raw).trim();
    if(!text) return '—';
    if(/[^0-9.]/.test(text)) return text;
    const num = Number(text);
    if(Number.isFinite(num)) return `$${num.toFixed(2)}`;
    return text;
  }

  function smsPoolRenderPrice(raw){
    const el = smsPoolUIState.elements;
    if(!el) return;
    const txt = smsPoolFormatMoney(raw);
    el.price.textContent = txt;
  }

  function smsPoolRenderBalance(raw){
    const el = smsPoolUIState.elements;
    if(!el) return;
    const txt = smsPoolFormatMoney(raw);
    smsPoolUIState.balanceText = txt;
    el.balance.textContent = txt;
  }

  function smsPoolRenderNumber(raw){
    const el = smsPoolUIState.elements;
    if(!el) return;
    const txt = smsPoolNormalizeNumber(raw);
    el.number.textContent = txt || '—';
    el.number.disabled = !txt;
  }

  function smsPoolSetCodeDisplay(code, fallback){
    const el = smsPoolUIState.elements;
    if(!el) return;
    el.code.innerHTML = '';
    if(code){
      smsPoolUIState.codeValue = code;
      smsPoolUIState.codeText = '';
      const btn = document.createElement('button');
      btn.type='button';
      btn.className='btn value smsPoolCodeBtn centerText';
      btn.textContent = code;
      btn.addEventListener('click', ()=>copyText(code));
      el.code.appendChild(btn);
      return;
    }
    smsPoolUIState.codeValue = '';
    smsPoolUIState.codeText = fallback || 'Ожидание…';
    el.code.textContent = fallback || 'Ожидание…';
  }

  function smsPoolApplyStoredCode(){
    if(smsPoolUIState.codeValue){
      smsPoolSetCodeDisplay(smsPoolUIState.codeValue);
      return;
    }
    const fallback = smsPoolUIState.codeText || 'Ожидание…';
    smsPoolSetCodeDisplay('', fallback);
  }

  function smsPoolExtractGoogleCode(text){
    const raw = String(text || '');
    const match = raw.match(/G-\s*(\d{6})/i);
    return match ? match[1] : '';
  }

  function smsPoolUpdateBalance(opts = {}){
    const now = Date.now();
    if(!opts.force && now - smsPoolUIState.balanceLastTs < 20000) return;
    smsPoolUIState.balanceLastTs = now;
    google.script.run.withSuccessHandler(res=>{
      if(!res || res.ok === false){
        smsPoolRenderBalance(smsPoolUIState.balanceText || '—');
        return;
      }
      smsPoolRenderBalance(res.balance);
    }).withFailureHandler(()=>{
      smsPoolRenderBalance(smsPoolUIState.balanceText || '—');
    }).smspoolBalanceO1();
  }

  function smsPoolStartBalancePoll(){
    if(smsPoolUIState.balanceTimerId){
      clearInterval(smsPoolUIState.balanceTimerId);
    }
    smsPoolUpdateBalance({ force:true });
    smsPoolUIState.balanceTimerId = setInterval(smsPoolUpdateBalance, 30000);
  }

  function smsPoolMaybeFillAP(code){
    if(!code) return;
    if(!current?.row) return;
    const order = smsPoolUIState.activeOrder;
    if(!order?.number) return;
    if(!smsPoolUIState.orderRow || String(smsPoolUIState.orderRow) !== String(current.row)) return;
    if(smsPoolUIState.apFillPending) return;
    const existing = getO1FieldValue(current, 'AP');
    if(existing) return;
    const normalizedNumber = String(order.number || '').trim().replace(/\s+/g, '');
    const apValue = normalizedNumber.slice(2);
    if(!apValue) return;

    smsPoolUIState.apFillPending = true;
    toast('Сохранение AP…');
    saveCellInstant(current.row, 'AP', apValue, ()=>{
      setO1FieldValue(current, 'AP', apValue);
      updateApFieldUI(apValue);
      smsPoolUIState.apFillPending = false;
      toast('AP заполнен');
    }, (err)=>{
      smsPoolUIState.apFillPending = false;
      toast(err || 'Ошибка');
    });
  }

  function updateApFieldUI(value){
    const row = document.querySelector('.apField');
    if(!row) return;
    const input = row.querySelector('input.value');
    if(input) input.value = value;
    const btn = row.querySelector('button.value');
    if(btn) btn.textContent = value;
  }

  function smsPoolSetOrderLoading(loading){
    const el = smsPoolUIState.elements;
    if(!el) return;
    el.orderBtn.disabled = !!loading;
    el.orderBtn.textContent = loading ? 'Заказ…' : 'Заказать номер';
  }

  function smsPoolRenderIdle(){
    const el = smsPoolUIState.elements;
    if(!el) return;
    smsPoolRenderNumber('');
    smsPoolRenderPrice(null);
    el.timer.textContent = '—';
    smsPoolSetCodeDisplay('', 'Готов к заказу');
    el.refundBtn.disabled = true;
    smsPoolUIState.apFillPending = false;
    smsPoolUIState.orderRow = null;
    smsPoolSetOrderLoading(false);
  }

  function smsPoolRenderActive(opts = {}){
    const el = smsPoolUIState.elements;
    const order = smsPoolUIState.activeOrder;
    if(!el || !order) return;
    if(!smsPoolUIState.orderRow && current?.row){
      smsPoolUIState.orderRow = current.row;
    }
    smsPoolRenderNumber(order.number);
    smsPoolRenderPrice(order.price ?? order.cost);
    el.refundBtn.disabled = false;
    if(opts.preserveCode) smsPoolApplyStoredCode();
    else smsPoolSetCodeDisplay('', 'Ожидание…');
    smsPoolUpdateCountdown();
  }

  function smsPoolUpdateCountdown(){
    const el = smsPoolUIState.elements;
    const order = smsPoolUIState.activeOrder;
    if(!el || !order) return;
    const leftMs = Number(order.expiresAtMs || 0) - Date.now();
    if(leftMs <= 0){
      stopSmsPool();
      smsPoolUIState.activeOrder = null;
      smsPoolUIState.orderRow = null;
      el.timer.textContent = 'Время истекло';
      smsPoolSetCodeDisplay('', 'Время истекло');
      smsPoolRenderNumber('');
      smsPoolRenderPrice(null);
      el.refundBtn.disabled = true;
      smsPoolSetOrderLoading(false);
      return;
    }
    const totalSec = Math.floor(leftMs / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2,'0');
    const ss = String(totalSec % 60).padStart(2,'0');
    el.timer.textContent = `${mm}:${ss}`;
  }

  function smsPoolStartCountdown(){
    if(smsPoolUIState.countdownTimerId){
      clearInterval(smsPoolUIState.countdownTimerId);
    }
    smsPoolUpdateCountdown();
    smsPoolUIState.countdownTimerId = setInterval(smsPoolUpdateCountdown, 1000);
  }

  function smsPoolCheck(){
    const order = smsPoolUIState.activeOrder;
    const el = smsPoolUIState.elements;
    if(!order || !el) return;
    const profileRow = smsPoolUIState.profileRow;
    google.script.run.withSuccessHandler(res=>{
      if(!profileRow || smsPoolUIState.profileRow !== profileRow || String(current?.row || '') !== String(profileRow)) return;
      if(!res || res.ok === false){
        el.code.textContent = res?.error || 'Ошибка проверки';
        return;
      }
      const smsRaw = String(res.sms ?? '').trim();
      const fullRaw = String(res.full_sms ?? '').trim();
      const smsText = fullRaw || smsRaw;
      if(smsRaw && smsRaw !== '0'){
        const code = smsPoolExtractGoogleCode(smsText);
        if(code){
          smsPoolSetCodeDisplay(code);
          smsPoolMaybeFillAP(code);
        } else {
          smsPoolSetCodeDisplay('', 'Код не получен');
        }
        if(smsPoolUIState.pollTimerId){
          clearInterval(smsPoolUIState.pollTimerId);
          smsPoolUIState.pollTimerId = null;
        }
      } else {
        smsPoolSetCodeDisplay('', 'Ожидание…');
      }
    }).withFailureHandler(err=>{
      smsPoolSetCodeDisplay('', String(err));
    }).smspoolCheckO1(order.order_id);
  }

  function smsPoolStartPoll(){
    if(smsPoolUIState.pollTimerId){
      clearInterval(smsPoolUIState.pollTimerId);
    }
    smsPoolCheck();
    smsPoolUIState.pollTimerId = setInterval(smsPoolCheck, 3000);
  }

  function smsPoolInit(opts = {}){
    const el = smsPoolUIState.elements;
    if(!el) return;
    const preserve = opts.preserve === true;
    const profileRow = current?.row ? String(current.row) : '';
    if(!profileRow) return;
    if(!preserve){
      stopSmsPool();
      smsPoolLoadState(profileRow);
      smsPoolUIState.apFillPending = false;
      smsPoolSetCodeDisplay('', 'Загрузка…');
      smsPoolRenderNumber('');
      smsPoolRenderPrice(null);
      el.timer.textContent = '—';
      el.refundBtn.disabled = true;
      smsPoolSetOrderLoading(false);
    } else {
      smsPoolUIState.profileRow = profileRow;
    }

    smsPoolStartBalancePoll();
    if(preserve){
      if(smsPoolUIState.activeOrder){
        smsPoolRenderActive({ preserveCode: true });
        if(!smsPoolUIState.countdownTimerId) smsPoolStartCountdown();
        if(!smsPoolUIState.codeValue && !smsPoolUIState.pollTimerId) smsPoolStartPoll();
      } else {
        smsPoolRenderIdle();
      }
      return;
    }

    if(smsPoolUIState.activeOrder){
      smsPoolRenderActive({ preserveCode: true });
      smsPoolStartCountdown();
      if(!smsPoolUIState.codeValue) smsPoolStartPoll();
      return;
    }

    google.script.run.withSuccessHandler(res=>{
      if(!res || res.ok === false){
        smsPoolSetCodeDisplay('', res?.error || 'Ошибка загрузки');
        return;
      }
      if(!smsPoolUIState.profileRow || smsPoolUIState.profileRow !== profileRow) return;
      const incomingOrder = res.order || null;
      const orderRowMatch = incomingOrder ? smsPoolFindOrderRow(incomingOrder.order_id) : '';
      if(orderRowMatch && String(orderRowMatch) !== String(profileRow)){
        smsPoolUIState.activeOrder = null;
        smsPoolUIState.orderRow = null;
        smsPoolRenderIdle();
        return;
      }
      smsPoolUIState.activeOrder = incomingOrder;
      smsPoolUIState.orderRow = smsPoolUIState.activeOrder ? profileRow : null;
      if(!smsPoolUIState.activeOrder){
        smsPoolRenderIdle();
        return;
      }
      smsPoolRenderActive();
      smsPoolStartCountdown();
      smsPoolStartPoll();
    }).withFailureHandler(err=>{
      smsPoolSetCodeDisplay('', String(err));
    }).smspoolGetStateO1();
  }

  function smsPoolOrder(){
    const el = smsPoolUIState.elements;
    if(!el) return;
    smsPoolSetOrderLoading(true);
    el.code.textContent = 'Заказ…';
    google.script.run.withSuccessHandler(res=>{
      smsPoolSetOrderLoading(false);
      if(!res || res.ok === false){
        smsPoolSetCodeDisplay('', res?.error || 'Ошибка заказа');
        return;
      }
      smsPoolUIState.activeOrder = res.order || null;
      smsPoolUIState.apFillPending = false;
      smsPoolUIState.orderRow = smsPoolUIState.activeOrder ? current?.row : null;
      if(!smsPoolUIState.activeOrder){
        smsPoolRenderIdle();
        return;
      }
      smsPoolRenderActive();
      smsPoolStartCountdown();
      smsPoolStartPoll();
      smsPoolUpdateBalance({ force:true });
    }).withFailureHandler(err=>{
      smsPoolSetOrderLoading(false);
      smsPoolSetCodeDisplay('', String(err));
    }).smspoolOrderO1();
  }

  function smsPoolRefund(){
    const el = smsPoolUIState.elements;
    const order = smsPoolUIState.activeOrder;
    if(!el || !order) return;
    if(!confirm('Отменить номер и вернуть средства?')) return;
    el.refundBtn.disabled = true;
    google.script.run.withSuccessHandler(res=>{
      if(!res || res.ok === false){
        el.refundBtn.disabled = false;
        toast(res?.error || 'Ошибка Refund');
        return;
      }
      stopSmsPool();
      smsPoolUIState.activeOrder = null;
      smsPoolUIState.orderRow = null;
      smsPoolRenderIdle();
      toast('Refund выполнен');
      smsPoolStartBalancePoll();
      smsPoolUpdateBalance({ force:true });
    }).withFailureHandler(err=>{
      el.refundBtn.disabled = false;
      toast(String(err));
    }).smspoolRefundO1(order.order_id);
  }

  // ---------- BAN button color class ----------
  function banClassForValue(v){
    const s=String(v||'').trim();
    if(!s) return '';
    if(BAN_RED_VALUES.has(s)) return 'banRed';
    if(BAN_YELLOW_VALUES.has(s)) return 'banYellow';
    return '';
  }

  // ---------- Rendering ----------
  function renderProfile(res, opts = {}){
    // stop old totp timer (important when switching tabs/profiles)
    stopTotp();
    if(res?.row) mergeO1LocalValues_(res);
    if(current?.row) smsPoolStoreState(current.row);
    const preserveSmsPool = !!opts.preserveSmsPool && current?.row && res?.row && current.row === res.row;
    if(!preserveSmsPool) stopSmsPool();

    current = res;
    updateHeader();
    renderTabs();

    const out=document.getElementById('out');
    out.innerHTML='';
    if(!res){
      updateHeader();
      if(opts.preserveScrollSnapshot) restoreSproutScroll_(opts.preserveScrollSnapshot);
      return;
    }

    const shell=document.createElement('div');
    shell.id='profileShell';
    shell.className='profileShell sgFadeIn' + (res.isBanned ? ' profileBanned' : '');
    out.appendChild(shell);

    const proxyUser = getValue(res,'Прокси','J');
    const proxyType = getValue(res,'Прокси','L');
    const proxyOk = (proxyUser === 'ruslanhardhead' && proxyType === 'ipv4');

    const accountGender = getValue(res,'Аккаунт','W');

    for(let gi = 0; gi < res.groups.length; gi++){
      const g = res.groups[gi];
      const card=document.createElement('div');
      card.className='card sgFadeIn';
      card.dataset.group=g.name;
      card.dataset.section = g.name;
      card.id = `o1-section-${gi}`;

      const banAllowed=!!g.ban;
      const banValue = banAllowed ? String(g.ban.value||'').trim() : '';
      const banActive = banValue === 'Бан почты';
      const banColorClass = banClassForValue(banValue);

      const numberAllowed = !!g.number?.col;
      const numberActive = !!g.number?.active;

      const isO1Verification = isVerificationGroupName(g.name);
      card.innerHTML = `
        <div class="title">
          <h3>${escapeHtml(g.name)}</h3>
          <div class="meta2">
            ${isO1Verification ? `<button class="btn" data-appeal="1">Апелляция</button>` : ''}
            ${numberAllowed ? `<button class="btn btnPrimary numBtn ${numberActive?'btnNumActive':''}" data-group="${escapeHtml(g.name)}">Номер</button>` : ''}
            ${banAllowed ? `<button class="btn banBtn ${banColorClass} ${banActive?'active':''}" data-group="${escapeHtml(g.name)}">BAN</button>` : ''}
          </div>
        </div>
      `;

      const fieldsWrap=document.createElement('div');

      const banBtn=card.querySelector('.banBtn');
      if(banBtn) banBtn.dataset.appcolor = '1';
      if(banBtn && !banBtn.dataset.bound){
        banBtn.dataset.bound='1';
        banBtn.addEventListener('click', ()=>{
          const prevActive = banBtn.classList.contains('active');
          banBtn.classList.toggle('active', !prevActive);
          if(!prevActive) banBtn.classList.add('banRed');
          google.script.run.withSuccessHandler(r=>{
            if(!r || r.ok===false){
              banBtn.classList.toggle('active', prevActive);
              if(!prevActive) banBtn.classList.remove('banRed');
              toast(r?.error || 'Ошибка BAN');
              return;
            }
            scheduleFiltersRefresh('status-change');
            syncProfile();
          }).withFailureHandler(err=>{
            banBtn.classList.toggle('active', prevActive);
            if(!prevActive) banBtn.classList.remove('banRed');
            toast(String(err));
          }).toggleBan(res.row, g.name);
        });
      }

      const numBtn=card.querySelector('.numBtn');
      if(numBtn) numBtn.dataset.appcolor = '1';
      if(numBtn && !numBtn.dataset.bound){
        numBtn.dataset.bound='1';
        numBtn.addEventListener('click', ()=>{
          const curOn = numBtn.classList.contains('btnNumActive');
          const next = !curOn;
          numBtn.classList.toggle('btnNumActive', next);
          if(g.number){
            g.number.active = next;
            g.number.value = next ? 'Номер' : '';
          }
          refreshColors({ source:'o1', skipFilters:true });
          google.script.run.withSuccessHandler(r=>{
            if(!r || r.ok===false){
              numBtn.classList.toggle('btnNumActive', curOn);
              if(g.number){
                g.number.active = curOn;
                g.number.value = curOn ? 'Номер' : '';
              }
              refreshColors({ source:'o1', skipFilters:true });
              toast(r?.error || 'Ошибка');
              return;
            }
            numBtn.classList.toggle('btnNumActive', !!r.active);
            if(g.number){
              g.number.active = !!r.active;
              g.number.value = r.active ? 'Номер' : '';
            }
            refreshColors({ source:'o1', skipFilters:true });
            scheduleFiltersRefresh('status-change');
            toast('Готово');
          }).withFailureHandler(err=>{
            numBtn.classList.toggle('btnNumActive', curOn);
            if(g.number){
              g.number.active = curOn;
              g.number.value = curOn ? 'Номер' : '';
            }
            refreshColors({ source:'o1', skipFilters:true });
            toast(String(err));
          }).setGroupNumber(res.row, g.name, next);
        });
      }

      const fieldMap = {};
      for(const f of g.fields){
        fieldMap[String(f.col).toUpperCase()] = f;
      }
      const o1AppealBtn = card.querySelector('[data-appeal="1"]');
      if(o1AppealBtn && !o1AppealBtn.dataset.bound){
        o1AppealBtn.dataset.bound = '1';
        o1AppealBtn.addEventListener('click', ()=>openO1AppealModal(res, fieldMap, card));
      }

      // ✅ whole verification group color (BO)
      if(isVerificationGroupName(g.name)){
        applyVerificationCardColor(card, fieldMap);
      }

      const handledPayment = new Set(['BH','CO','CP','CQ','CR','CS','BF','BG']);
      const handledRK = new Set(['CB','CC','CD']);
      const handledDOB = new Set(['T','U','V']);
      const handledTOTP = new Set(['AP']); // AP rendered at end of Account group

      for(const f of g.fields){
        if(f.hidden) continue;
        const col = String(f.col).toUpperCase();

        if(g.name==='Платежка' && handledPayment.has(col)) continue;
        if(g.name==='РК' && handledRK.has(col)) continue;
        if(g.name==='Аккаунт' && handledDOB.has(col)) continue;
        if(g.name==='Аккаунт' && handledTOTP.has(col)) continue;

        const row=document.createElement('div');
        row.className='field';

        const label=document.createElement('div');
        label.className='label';
        label.textContent=(f.label && String(f.label).trim()) ? f.label : f.col;
        label.title=`${f.col} • ${f.label || ''}`.trim();

        const actions=document.createElement('div');
        actions.className='actions';

        const proxyClass=(g.name==='Прокси' && (f.col==='J' || f.col==='L'))
          ? (proxyOk ? 'proxyGood' : 'proxyBad')
          : '';
        const truncClass=(g.name==='Прокси') ? ' proxyTrunc' : '';
        const rsClass=(g.name==='Аккаунт' && (f.col==='R' || f.col==='S'))
          ? (accountGender==='M' ? ' blueLight' : (accountGender==='F' ? ' pinkLight' : ''))
          : '';

        if(f.isDropdown){
          const sel=document.createElement('select');
          sel.className=('value '+proxyClass+truncClass+rsClass).trim();
          sel.dataset.col = f.col;
          sel.dataset.row = String(res.row);

          const curRaw = String(f.value ?? '').trim();
          const curNorm = normOpt(curRaw);

          initO1SaveState_(res.row, f.col, curRaw);

          const optEmpty=document.createElement('option');
          optEmpty.value=''; optEmpty.textContent='';
          sel.appendChild(optEmpty);

          const rawOptions = (f.options || []).map(x => String(x ?? '').trim()).filter(x => x.length);
          const shouldSplitPlus = g.name !== 'Аккаунт' && rawOptions.some(v => v === '+');
          const options = shouldSplitPlus ? rawOptions.filter(v => v !== '+') : rawOptions;
          const normSet = new Set(options.map(normOpt));

          if(curRaw && !(shouldSplitPlus && curRaw === '+') && !normSet.has(curNorm)){
            const o=document.createElement('option');
            o.value=curRaw;
            o.textContent=curRaw + ' (в таблице)';
            o.selected=true;
            sel.appendChild(o);
          }

          for(const v of options){
            const o=document.createElement('option');
            o.value=v;
            o.textContent=v;
            if(normOpt(v) === curNorm) o.selected=true;
            sel.appendChild(o);
          }
          if(curRaw === '+' && shouldSplitPlus) sel.value = '';
          else if(curRaw && !sel.value) sel.value = curRaw;
          sel.dataset.prevValue = curRaw;

          applySelectColor(sel, f.col, sel.value);
          applySheetCellColorHint(sel, f.bg);

          let plusBtn = null;
          const syncPlusUi = (value)=>{
            if(!plusBtn) return;
            plusBtn.classList.toggle('is-active', String(value || '').trim() === '+');
          };

          const saveDropdownValue = (newVal)=>{
            const oldValue = String(f.value ?? sel.dataset.uiValue ?? sel.dataset.prevValue ?? '');
            if(oldValue === newVal) return;
            f.value = newVal;
            sel.dataset.uiValue = newVal;
            if(newVal === '+') sel.value = '';
            applySelectColor(sel, f.col, newVal === '+' ? '+' : sel.value);
            syncPlusUi(newVal);

            if(isVerificationGroupName(g.name) && col==='BO'){
              applyVerificationCardColor(card, fieldMap);
              if(newVal === 'Успешно'){
                autoSetO1VerificationBan(card, fieldMap);
              }
            }

            commitO1CellFromElement({
              row: res.row,
              col: f.col,
              value: newVal,
              el: sel,
              field: f,
              saveOptions: { tabKey: getTabKey(res.row), profileName: res.profileName || '' },
              onSaved: (r, applied)=>{
                const finalValue = String(applied ?? newVal);
                toast('Сохранено');
                updateAllGroupBadges();

                if(isVerificationGroupName(g.name) && col==='BO'){
                  applyVerificationCardColor(card, fieldMap);
                }

                if(['BA','BJ','BX','CG'].includes(col)) syncProfile();
                sel.dataset.prevValue = finalValue;
                sel.dataset.uiValue = finalValue;
                if(finalValue === '+') sel.value = '';
                syncPlusUi(finalValue);
                sproutgEmitStatusEvent('O1', g.name || 'O1', finalValue, f.col, res.row, oldValue);
              },
              onFailed: (err)=>{
                toast(err || 'Ошибка');
                f.value = newVal;
                sel.dataset.uiValue = newVal;
                sel.value = newVal === '+' ? '' : newVal;
                applySelectColor(sel, f.col, newVal);
                syncPlusUi(newVal);

                if(isVerificationGroupName(g.name) && col==='BO'){
                  applyVerificationCardColor(card, fieldMap);
                }

                updateAllGroupBadges();
              }
            });
          };
          const onPick = ()=>saveDropdownValue(String(sel.value ?? ''));

          sel.addEventListener('input', onPick);
          sel.addEventListener('change', onPick);

          row.appendChild(label);
          if(shouldSplitPlus){
            const split = document.createElement('div');
            split.className = 'statusSplit';
            plusBtn = document.createElement('button');
            plusBtn.type = 'button';
            plusBtn.className = 'btn statusPlusBtn';
            plusBtn.textContent = '+';
            plusBtn.title = '+';
            plusBtn.addEventListener('click', ()=>{
              const activeValue = String(f.value ?? sel.dataset.uiValue ?? sel.dataset.prevValue ?? '').trim();
              saveDropdownValue(activeValue === '+' ? '' : '+');
            });
            syncPlusUi(curRaw);
            split.appendChild(plusBtn);
            split.appendChild(sel);
            row.appendChild(split);
          } else {
            row.appendChild(sel);
          }
          row.appendChild(actions);
          fieldsWrap.appendChild(row);

          if(g.name==='Платежка' && col==='BC'){
            renderCompanyRow(fieldsWrap, fieldMap);
            renderEEDunsRow(fieldsWrap, fieldMap);
            renderBFRow(fieldsWrap, fieldMap);
            renderYouTubeRow(fieldsWrap);
          }

          if(g.name==='Аккаунт' && col==='S'){
            renderDOBRow(fieldsWrap, fieldMap);
          }

          // ✅ TOTP below AD (secret taken from AD)
          if(g.name==='Аккаунт' && col==='AD'){
            renderTotpRow(fieldsWrap, fieldMap);
          }

          continue;
        }

        if(f.isDateField){
          const inp=document.createElement('input');
          inp.type='date';
          inp.className=('value '+proxyClass+truncClass+rsClass).trim();
          inp.value=String(f.value||'');
          inp.dataset.col = f.col;
          inp.dataset.row = String(res.row);
          inp.dataset.prevValue = String(f.value || '');
          applySheetCellColorHint(inp, f.bg);

          initO1SaveState_(res.row, f.col, String(f.value||''));

          const onDatePick = ()=>{
            const newVal = inp.value;
            if(inp.dataset.prevValue === newVal && inp.dataset.saving !== '1') return;
            f.value = newVal;

            updateAllGroupBadges();

            commitO1CellFromElement({
              row: res.row,
              col: f.col,
              value: newVal,
              el: inp,
              field: f,
              saveOptions: { tabKey: getTabKey(res.row), profileName: res.profileName || '' },
              onSaved: (r, applied)=>{
                inp.dataset.prevValue = String(applied ?? newVal);
                toast('Сохранено');
                updateAllGroupBadges();
              },
              onFailed: (err)=>{
                toast(err || 'Ошибка');
                f.value = inp.value;
                updateAllGroupBadges();
              }
            });
          };

          inp.addEventListener('input', onDatePick);
          inp.addEventListener('change', onDatePick);

          row.appendChild(label);
          row.appendChild(inp);
          row.appendChild(actions);
          fieldsWrap.appendChild(row);

          // RK row second after date
          if(g.name==='РК' && col==='BZ'){
            renderRKGeoBudgetRow(fieldsWrap, fieldMap);
          }

          if(g.name==='Платежка' && col==='BC'){
            renderCompanyRow(fieldsWrap, fieldMap);
            renderEEDunsRow(fieldsWrap, fieldMap);
            renderBFRow(fieldsWrap, fieldMap);
            renderYouTubeRow(fieldsWrap);
          }

          if(g.name==='Аккаунт' && col==='S'){
            renderDOBRow(fieldsWrap, fieldMap);
          }

          // ✅ TOTP below AD (secret taken from AD)
          if(g.name==='Аккаунт' && col==='AD'){
            renderTotpRow(fieldsWrap, fieldMap);
          }

          continue;
        }

        // TEXT
        if(editMode || (g.name==='Речек' && col==='BS')){
          const inp=document.createElement('input');
          inp.type='text';
          inp.className=('value '+proxyClass+truncClass+rsClass).trim();
          inp.value=String(f.value ?? '');
          inp.dataset.col = f.col;
          inp.dataset.row = String(res.row);

          if(g.name==='Речек' && col==='BS'){
            inp.dataset.bs = '1';
            applyBSColor(inp, inp.value);
            if(!String(inp.value||'').trim()){
              inp.value='0.00$';
              inp.dataset.placeholderDefault = '1';
            }
            applyBSColor(inp, inp.value);
            inp.addEventListener('input', ()=>{
              delete inp.dataset.placeholderDefault;
              inp.dataset.dirty = '1';
              applyBSColor(inp, inp.value);
              if(inp.dataset.saving === '1'){
                inp.dataset.pendingNextValue = inp.value;
                setO1PendingNext_(res.row, 'BS', inp.value, {
                  tabKey: getTabKey(res.row),
                  profileName: res.profileName || '',
                  replay: (value)=>saveO1RechekExpenseInstant(res.row, value, fieldMap, {
                    fieldsWrap,
                    tabKey: getTabKey(res.row),
                    profileName: res.profileName || ''
                  })
                });
                logSave_('O1', 'pendingNextValue detected', { row: res.row, col:'BS', value: inp.value });
              }
            });
          }
          applySheetCellColorHint(inp, f.bg);

          inp.addEventListener('blur', ()=>{
            if(g.name==='Речек' && col==='BS' && inp.dataset.placeholderDefault === '1'){
              return;
            }
            const nextValue = inp.value;
            f.value = nextValue;
            if(g.name==='Речек' && col==='BS') applyBSColor(inp, nextValue);
            const isProxyMain = g.name === 'Прокси' && col === 'F';

            if(g.name==='Речек' && col==='BS'){
              if(inp.dataset.saving === '1'){
                inp.dataset.pendingNextValue = nextValue;
                setO1PendingNext_(res.row, 'BS', nextValue, {
                  tabKey: getTabKey(res.row),
                  profileName: res.profileName || '',
                  replay: (value)=>saveO1RechekExpenseInstant(res.row, value, fieldMap, {
                    fieldsWrap,
                    tabKey: getTabKey(res.row),
                    profileName: res.profileName || ''
                  })
                });
                logSave_('O1', 'pendingNextValue detected', { row: res.row, col:'BS', value: nextValue });
                return;
              }
              const committedValue = nextValue;
              inp.dataset.saving = '1';
              toast('Сохранение…');
              markFieldSaving(inp, true);

              const finishRechek = (ok)=>{
                inp.dataset.saving = '0';
                const hasPending = Object.prototype.hasOwnProperty.call(inp.dataset, 'pendingNextValue');
                const pendingValue = hasPending ? inp.dataset.pendingNextValue : null;
                delete inp.dataset.pendingNextValue;
                if(ok) delete inp.dataset.unsaved;
                else inp.dataset.unsaved = '1';
                if(ok && hasPending){
                  takeO1PendingNext_(res.row, 'BS');
                  if(String(pendingValue) !== String(committedValue)){
                    inp.value = pendingValue;
                    applyBSColor(inp, pendingValue);
                    logSave_('O1', 'pendingNextValue replay', { row: res.row, col:'BS', value: pendingValue });
                    setTimeout(()=>inp.dispatchEvent(new Event('blur')), 0);
                  }
                } else if(!ok && hasPending){
                  inp.dataset.pendingNextValue = pendingValue;
                }
              };

              saveO1RechekExpenseInstant(res.row, committedValue, fieldMap, {
                fieldsWrap,
                tabKey: getTabKey(res.row),
                profileName: res.profileName || '',
                onSaved: ()=>{
                  markFieldSaved(inp);
                  finishRechek(true);
                  updateAllGroupBadges();
                  updateO1TabsColors();
                  toast('Сохранено');
                },
                onFailed: (err)=>{
                  markFieldSaveError(inp);
                  finishRechek(false);
                  updateAllGroupBadges();
                  toast(err||'Ошибка');
                }
              });
              return;
            }

            commitO1CellFromElement({
              row: res.row,
              col: f.col,
              value: nextValue,
              el: inp,
              field: f,
              saveOptions: { tabKey: getTabKey(res.row), profileName: res.profileName || '' },
              onSaved: ()=>{
                toast('Сохранено');
                if(isProxyMain) updateProxyFieldsFromServer('O1', res.row, nextValue);
              },
              onFailed: (err)=>{ toast(err||'Ошибка'); }
            });
          });

          inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }});

          row.appendChild(label);
          row.appendChild(inp);
          row.appendChild(actions);
          fieldsWrap.appendChild(row);

          if(g.name==='Платежка' && col==='BC'){
            renderCompanyRow(fieldsWrap, fieldMap);
            renderEEDunsRow(fieldsWrap, fieldMap);
            renderBFRow(fieldsWrap, fieldMap);
            renderYouTubeRow(fieldsWrap);
          }

          if(g.name==='Аккаунт' && col==='S'){
            renderDOBRow(fieldsWrap, fieldMap);
          }

          // ✅ TOTP below AD (secret taken from AD)
          if(g.name==='Аккаунт' && col==='AD'){
            renderTotpRow(fieldsWrap, fieldMap);
          }

        } else {
          const btn=document.createElement('button');
          btn.className=('btn value '+proxyClass+truncClass+rsClass).trim();
          btn.type='button';
          btn.textContent=f.value ?? '';
          btn.dataset.col = f.col;
          btn.dataset.row = String(res.row);
          btn.addEventListener('click', ()=>{
            if(g.name === 'Аккаунт' && col === 'X'){
              const curVal = String(f.value ?? '').trim();
              if(!curVal){
                const next = '0.00$';
                f.value = next;
                btn.textContent = next;
                toast('Сохранение…');
                saveCellInstant(res.row, 'X', next, ()=>toast('Сохранено'), (err)=>toast(err||'Ошибка'));
                return;
              }
            }
            copyText(btn.textContent);
          });

          if(g.name==='Речек' && col==='BS'){
            btn.dataset.bs = '1';
            applyBSColor(btn, btn.textContent);
          }
          applySheetCellColorHint(btn, f.bg);

          row.appendChild(label);
          row.appendChild(btn);
          row.appendChild(actions);
          fieldsWrap.appendChild(row);

          if(g.name==='Платежка' && col==='BC'){
            renderCompanyRow(fieldsWrap, fieldMap);
            renderEEDunsRow(fieldsWrap, fieldMap);
            renderBFRow(fieldsWrap, fieldMap);
            renderYouTubeRow(fieldsWrap);
          }

          if(g.name==='Аккаунт' && col==='S'){
            renderDOBRow(fieldsWrap, fieldMap);
          }

          // ✅ TOTP below AD (secret taken from AD)
          if(g.name==='Аккаунт' && col==='AD'){
            renderTotpRow(fieldsWrap, fieldMap);
          }
        }
      }

      // ensure RK row exists even if date empty
      if(g.name==='РК' && !fieldsWrap.querySelector('.rkGeoRow')){
        renderRKGeoBudgetRow(fieldsWrap, fieldMap);
      }

      // ensure TOTP exists even if AD missing in iteration order
      if(g.name==='Аккаунт' && !fieldsWrap.querySelector('.totpField')){
        renderTotpRow(fieldsWrap, fieldMap);
      }

      // ✅ AP row must be at the end of Account group
      if(g.name==='Аккаунт'){
        renderAPRow(fieldsWrap, fieldMap);
      }

      card.appendChild(fieldsWrap);
      shell.appendChild(card);

      if(g.name==='Аккаунт'){
        shell.appendChild(renderSmsPoolCard());
        smsPoolInit({ preserve: preserveSmsPool });
      }
    }

    updateAllGroupBadges();
    updateHeader();
    updateActiveListMarkers();
    if(opts.preserveScrollSnapshot) restoreSproutScroll_(opts.preserveScrollSnapshot);
  }

  // ---------- MCC ----------
  function setMccError(msg){
    document.getElementById('mccErr').textContent = msg || '';
  }

  function setMccFilterError(msg){
    const el = document.getElementById('mccFilterErr');
    if(el) el.textContent = msg || '';
  }

  function mccApplyStageFilter(opts = {}){
    if(!opts.silent) setMccFilterError('');
    const stage = document.getElementById('mccStageFilter').value;
    const from = document.getElementById('mccStageFrom').value || '';
    const to = document.getElementById('mccStageTo').value || '';
    if(!from && !to){
      if(!opts.silent) setMccFilterError('Выбери дату от или до');
      return;
    }
    mccStageFilterState = { stage, from, to, items: [], active: true };
    if(!opts.silent) toast('Фильтр…');
    google.script.run.withSuccessHandler(res=>{
      if(!res || !res.ok){
        if(!opts.silent) setMccFilterError(res?.error || 'Ошибка фильтра');
        return;
      }
      mccStageFilterState.items = res.items || [];
      renderMccStageFilterList();
      if(!opts.silent) toast(`Найдено: ${mccStageFilterState.items.length}`);
    }).withFailureHandler(err=>{
      if(!opts.silent) setMccFilterError(String(err));
    }).listMccProfilesByStageDate(stage, from, to, 20000);
  }

  function mccClearStageFilter(){
    document.getElementById('mccStageFrom').value = '';
    document.getElementById('mccStageTo').value = '';
    mccStageFilterState = { stage: document.getElementById('mccStageFilter').value, from:'', to:'', items: [], active: false };
    renderMccStageFilterList();
    setMccFilterError('');
  }

  function renderMccStageFilterList(){
    const box = document.getElementById('mccStageFilterList');
    box.innerHTML = '';
    const items = (mccStageFilterState.items || []).slice().sort((a,b)=>Number(a.row)-Number(b.row));
    if(!items.length){
      box.innerHTML = '<div style="color:rgba(255,255,255,.65);font-size:13px;">Нет результатов</div>';
      return;
    }
    const stageLabel = { D:'MCC', T:'Верификация', W:'Речек' }[mccStageFilterState.stage] || 'MCC';
    const labelDate = (mccStageFilterState.from === mccStageFilterState.to)
      ? toRuDate(mccStageFilterState.from)
      : `${mccStageFilterState.from ? toRuDate(mccStageFilterState.from) : '…'}–${mccStageFilterState.to ? toRuDate(mccStageFilterState.to) : '…'}`;
    const title = `Фильтр этапов → ${stageLabel} (${labelDate})`;

    const frag = document.createDocumentFragment();
    const targetSectionId = mccStageFilterState.stage === 'T'
      ? 'mccVerificationSection'
      : (mccStageFilterState.stage === 'W' ? 'mccRechekSection' : '');
    for(const it of items){
      const div = document.createElement('div');
      div.className = 'listItem';
      div.dataset.row = String(it.row || '');
      div.classList.toggle('active', String(mccProfile?.profileRow || '') === String(it.row || ''));
      const pill = document.createElement('span');
      pill.className = 'namePill';
      if(it.pill === 'green') pill.classList.add('greenLight');
      else if(it.pill === 'yellow') pill.classList.add('yellowLight');
      else if(it.pill === 'red') pill.classList.add('redLight');
      const dot = document.createElement('span');
      dot.className = 'dot';
      pill.appendChild(dot);
      const name = document.createElement('span');
      name.textContent = it.profileName;
      pill.appendChild(name);
      const dateSpan = document.createElement('span');
      dateSpan.style.color = 'rgba(255,255,255,.62)';
      dateSpan.style.fontSize = '12px';
      dateSpan.textContent = it.date ? toRuDate(it.date) : '';
      div.appendChild(pill);
      div.appendChild(dateSpan);
      div.title = title;
      div.addEventListener('click', ()=>{
        openMccProfileByName(it.profileName, { targetSectionId });
      });
      frag.appendChild(div);
    }
    box.appendChild(frag);
  }

  function mccLoadWorkFilter(mode, opts = {}){
    if(mode === 'clear'){
      mccWorkFilterState = { mode: null, items: [], collapsed: {}, active: false };
      renderMccWorkFilterList();
      if(!opts.silent) setMccFilterError('');
      return;
    }
    if(!opts.silent) setMccFilterError('');
    mccWorkFilterState = { mode, items: [], collapsed: mccWorkFilterState.collapsed || {}, active: true };
    if(!opts.silent) toast('Фильтр…');
    google.script.run.withSuccessHandler(res=>{
      if(!res || !res.ok){
        if(!opts.silent) setMccFilterError(res?.error || 'Ошибка фильтра');
        return;
      }
      mccWorkFilterState.mode = res.mode || mode;
      mccWorkFilterState.items = res.items || [];
      mccWorkFilterState.active = true;
      renderMccWorkFilterList();
      if(!opts.silent) toast(`Найдено: ${mccWorkFilterState.items.length}`);
    }).withFailureHandler(err=>{
      if(!opts.silent) setMccFilterError(String(err));
    }).getMccWorkFilter(mode, 20000);
  }

  function renderMccWorkFilterList(){
    const box = document.getElementById('mccWorkFilterList');
    box.innerHTML = '';
    const items = mccWorkFilterState.items || [];
    const mode = String(mccWorkFilterState.mode || '').trim();
    if(!items.length){
      box.innerHTML = '<div style="color:rgba(255,255,255,.65);font-size:13px;">Нет данных</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for(const profile of items){
      const header = document.createElement('div');
      header.className = 'workGroupHeader';
      header.dataset.row = String(profile.row || '');
      const left = document.createElement('div');
      left.className = 'workGroupTitle';
      const key = profile.profileName || String(profile.row || '');
      const collapsed = !!mccWorkFilterState.collapsed[key];
      const caret = document.createElement('button');
      caret.type = 'button';
      caret.className = 'caret';
      caret.textContent = collapsed ? '＋' : '－';
      caret.addEventListener('click', (e)=>{
        e.stopPropagation();
        mccWorkFilterState.collapsed[key] = !mccWorkFilterState.collapsed[key];
        renderMccWorkFilterList();
      });
      const title = document.createElement('span');
      const profileLabel = profile.profileName || `Профиль ${profile.row || ''}`.trim();
      const rawAccounts = profile.accounts || [];
      const filteredAccounts = mode === 'inwork'
        ? rawAccounts.filter(acc => !String(acc?.statusU || '').trim())
        : rawAccounts;
      title.textContent = `${profileLabel} • ${filteredAccounts.length}`;
      left.appendChild(caret);
      left.appendChild(title);
      header.appendChild(left);
      header.addEventListener('click', ()=>{
        const targetAccount = filteredAccounts[0]?.accountName || rawAccounts[0]?.accountName || '';
        openMccProfileByName(profile.profileName, { targetAccountName: targetAccount });
      });
      frag.appendChild(header);

      const accountsWrap = document.createElement('div');
      accountsWrap.className = 'mccFilterAccounts';
      accountsWrap.style.display = collapsed ? 'none' : '';
      const accounts = filteredAccounts;
      if(!accounts.length){
        const empty = document.createElement('div');
        empty.style.color = 'rgba(255,255,255,.55)';
        empty.style.fontSize = '12px';
        empty.textContent = 'Нет аккаунтов';
        accountsWrap.appendChild(empty);
      } else {
        for(const acc of accounts){
          const accRow = document.createElement('div');
          accRow.className = 'mccFilterAccount';
          const name = document.createElement('span');
          name.className = 'mccFilterAccountName';
          name.textContent = acc.accountName || `Аккаунт ${acc.row}`;
          accRow.appendChild(name);

          if(mode === 'inwork'){
            const note = document.createElement('span');
            note.className = 'mccFilterAccountMeta';
            note.textContent = 'Статус: —';
            accRow.appendChild(note);
          } else if(mode === 'review'){
            const note = document.createElement('span');
            note.className = 'mccFilterAccountBadge mccFilterAccountNoteBlue';
            note.textContent = 'На рассмотрении';
            accRow.appendChild(note);
          } else if(mode === 'nospend'){
            const expense = String(acc.expense || '').trim();
            if(expense){
              const note = document.createElement('span');
              note.className = 'mccFilterAccountBadge redLight';
              note.textContent = expense;
              accRow.appendChild(note);
            }
          }
          accRow.addEventListener('click', ()=>{
            openMccProfileByName(profile.profileName, { targetAccountName: acc.accountName || '' });
          });
          accountsWrap.appendChild(accRow);
        }
      }
      frag.appendChild(accountsWrap);
    }
    box.appendChild(frag);
  }

  function refreshMccFilters(){
    if(mccStageFilterState?.active){
      mccApplyStageFilter({ silent:true });
    } else {
      renderMccStageFilterList();
    }

    if(mccWorkFilterState?.active){
      mccLoadWorkFilter(mccWorkFilterState.mode, { silent:true });
    } else {
      renderMccWorkFilterList();
    }
  }

  function getMccProfileKey(name){
    return String(name || '').trim().toLowerCase();
  }

  function loadMccProfileTabsFromStorage(){
    try{
      const raw = localStorage.getItem(MCC_PROFILE_TABS_KEY);
      if(!raw) return;
      const items = JSON.parse(raw);
      if(!Array.isArray(items)) return;
      mccProfileTabs.length = 0;
      mccProfileTabMap.clear();
      for(const item of items){
        const name = String(item?.profileName || '').trim();
        if(!name) continue;
        const key = String(item?.key || getMccProfileKey(name)).trim();
        if(!key) continue;
        const entry = {
          key,
          profileName: name,
          profileRow: item?.profileRow || null,
          lastAccount: String(item?.lastAccount || ''),
          lastUsed: Number(item?.lastUsed || 0)
        };
        mccProfileTabs.push(entry);
        mccProfileTabMap.set(key, entry);
      }
      pruneMccProfileTabs();
    }catch(e){}
  }

  function loadMccProfileCacheFromStorage(){
    try{
      const raw = localStorage.getItem(MCC_PROFILE_CACHE_KEY);
      if(!raw) return;
      const data = JSON.parse(raw);
      const items = Array.isArray(data?.items) ? data.items : [];
      for(const item of items){
        if(!item?.key || !item?.profile) continue;
        mccProfileCache.set(String(item.key), { profile: item.profile, lastUsed: Number(item.lastUsed || 0) });
      }
      pruneMccProfileCache();
    }catch(e){}
  }

  function pruneMccProfileTabs(){
    if(mccProfileTabs.length <= MCC_PROFILE_CACHE_LIMIT) return;
    const sorted = [...mccProfileTabs].sort((a,b)=>(a.lastUsed||0)-(b.lastUsed||0));
    const remove = sorted.slice(0, mccProfileTabs.length - MCC_PROFILE_CACHE_LIMIT);
    for(const entry of remove){
      mccProfileTabMap.delete(entry.key);
      const idx = mccProfileTabs.findIndex(t=>t.key === entry.key);
      if(idx >= 0) mccProfileTabs.splice(idx,1);
      mccProfileCache.delete(entry.key);
    }
  }

  function pruneMccProfileCache(){
    if(mccProfileCache.size <= MCC_PROFILE_CACHE_LIMIT) return;
    const items = Array.from(mccProfileCache.entries())
      .sort((a,b)=>(a[1].lastUsed||0)-(b[1].lastUsed||0));
    const remove = items.slice(0, mccProfileCache.size - MCC_PROFILE_CACHE_LIMIT);
    for(const [key] of remove){
      mccProfileCache.delete(key);
    }
  }

  function persistMccProfileCache(){
    pruneMccProfileCache();
    const items = Array.from(mccProfileCache.entries()).map(([key, val])=>({
      key,
      profile: val.profile,
      lastUsed: Number(val.lastUsed || 0)
    }));
    items.sort((a,b)=>(b.lastUsed||0)-(a.lastUsed||0));
    const trimmed = items.slice(0, MCC_PROFILE_CACHE_LIMIT);
    try{ localStorage.setItem(MCC_PROFILE_CACHE_KEY, JSON.stringify({ items: trimmed })); }catch(e){}
  }

  function persistMccProfileTabs(){
    pruneMccProfileTabs();
    try{
      const data = mccProfileTabs.map(entry=>({
        key: entry.key,
        profileName: entry.profileName,
        profileRow: entry.profileRow || null,
        lastAccount: entry.lastAccount || '',
        lastUsed: entry.lastUsed || 0
      }));
      localStorage.setItem(MCC_PROFILE_TABS_KEY, JSON.stringify(data));
    }catch(e){}
    persistMccProfileCache();
  }

  function touchMccProfileTab(key){
    const entry = mccProfileTabMap.get(key);
    if(!entry) return;
    entry.lastUsed = Date.now();
  }

  function cacheMccProfile(profile){
    const name = String(profile?.profileName || '').trim();
    if(!name) return;
    const key = getMccProfileKey(name);
    mccProfileCache.set(key, { profile, lastUsed: Date.now() });
    persistMccProfileCache();
  }

  function getCachedMccProfile(key){
    const entry = mccProfileCache.get(key);
    if(!entry?.profile) return null;
    entry.lastUsed = Date.now();
    return entry.profile;
  }

  function openMccProfileTab(entry, opts = {}){
    if(!entry?.profileName) return;
    rememberMccActiveAccount();
    touchMccProfileTab(entry.key);
    mccActiveProfileKey = entry.key;
    renderMccProfileTabsSelect();

    const targetAccountName = String(opts.targetAccountName || '').trim();
    const targetSectionId = String(opts.targetSectionId || '').trim();
    const cached = getCachedMccProfile(entry.key);
    if(cached){
      mccProfile = cached;
      mccEditMode = false;
      mccActiveAccount = targetAccountName || entry.lastAccount || cached.rows?.[0]?.accountName || '';
      renderMccProfile();
      rememberMccActiveAccount();
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(targetAccountName){
          const idx = mccProfile?.rows?.findIndex(r=>String(r.accountName || '').trim() === targetAccountName) ?? -1;
          if(idx >= 0) return mccScrollToAccountSection(idx);
        }
        if(targetSectionId) mccScrollToSection(targetSectionId);
      }));

      const requestWriteRevision = _mccWriteRevision;
      google.script.run.withSuccessHandler(res=>{
        if(!res || res.ok===false) return;
        if(_mccPendingWrites > 0 || requestWriteRevision !== _mccWriteRevision){
          logSave_('MCC', 'skip getMccProfile response while writes pending or changed', { pending: _mccPendingWrites, requestWriteRevision, currentWriteRevision: _mccWriteRevision });
          return;
        }
        cacheMccProfile(res);
        const key = getMccProfileKey(res.profileName);
        if(mccActiveProfileKey !== key) return;
        const scrollSnap = captureSproutScroll_('mcc-refresh');
        mccProfile = res;
        mccEditMode = false;
        renderMccProfile({ preserveScrollSnapshot: scrollSnap });
      }).getMccProfile(entry.profileName);
      return;
    }

    openMccProfileByName(entry.profileName, opts);
  }

  function renderMccProfileTabsSelect(){
    const select = document.getElementById('mccProfileTabsSelect');
    if(!select) return;
    select.innerHTML = '';
    if(!mccProfileTabs.length){
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'MCC вкладки';
      select.appendChild(opt);
      select.disabled = true;
      updateMccProfileTabsVisibility();
      return;
    }
    for(const entry of mccProfileTabs){
      const opt = document.createElement('option');
      opt.value = entry.key;
      opt.textContent = entry.profileName;
      select.appendChild(opt);
    }
    select.disabled = false;
    if(mccActiveProfileKey) select.value = mccActiveProfileKey;
    updateMccProfileTabsVisibility();
  }

  function updateMccProfileTabsVisibility(){
    const box = document.getElementById('mccProfileTabsWrap');
    if(!box) return;
    box.classList.toggle('show', activePage === 'MCC' && mccProfileTabs.length > 0);
    requestAnimationFrame(updateAppHeaderHeight);
  }

  function rememberMccActiveAccount(){
    if(!mccProfile?.profileName) return;
    const key = getMccProfileKey(mccProfile.profileName);
    const entry = mccProfileTabMap.get(key);
    if(entry){
      entry.lastAccount = mccActiveAccount || entry.lastAccount || '';
      entry.lastUsed = Date.now();
      persistMccProfileTabs();
    }
  }

  function addMccProfileTab(profile){
    const name = String(profile?.profileName || '').trim();
    if(!name) return;
    const key = getMccProfileKey(name);
    let entry = mccProfileTabMap.get(key);
    if(!entry){
      entry = {
        key,
        profileName: name,
        profileRow: profile?.profileRow?.row || null,
        lastAccount: mccActiveAccount || '',
        lastUsed: Date.now()
      };
      mccProfileTabMap.set(key, entry);
      mccProfileTabs.push(entry);
    } else {
      entry.profileRow = entry.profileRow || profile?.profileRow?.row || null;
      entry.lastAccount = mccActiveAccount || entry.lastAccount || '';
      entry.lastUsed = Date.now();
    }
    mccActiveProfileKey = key;
    cacheMccProfile(profile);
    persistMccProfileTabs();
    renderMccProfileTabsSelect();
  }


  // Мини-проверки v0.4.4.0:
  // 1) MCC → Все MCC: профиль с >30 аккаунтами показывает все dot-pill.
  // 2) cleanDone: N='+', O пусто и X пусто/0 → dot-piIl с меткой cleanDone.
  // 3) MCC → Верификация: блока/селектов "Резерв" нет, MCC!I из UI больше не резервируется.
  // 4) O1: openByRow/openWorkGroupInTabs сохраняют порядок кликов/массива items.
  // 5) MCC Апелляция: модалка открывается, данные Apell кешируются, кнопки копирования работают.
  // 6) MCC Верификация: ФИО подсветка F/G + дубли (желтый), пустой "Адрес вериф" авто-сохраняется.

  function loadMccOverview(opts = {}){
    if(mccOverviewState.loading) return;
    if(opts.silent && mccOverviewState.loaded){
      renderMccOverviewList();
      return;
    }
    mccOverviewState.loading = true;
    if(!opts.silent) toast('Загрузка списка MCC…');
    google.script.run.withSuccessHandler(res=>{
      mccOverviewState.loading = false;
      if(!res || res.ok===false){
        if(!opts.silent) toast(res?.error || 'Ошибка списка MCC');
        return;
      }
      mccOverviewState.items = res.items || [];
      mccOverviewState.loaded = true;
      renderMccOverviewList();
      if(!opts.silent) toast('Готово');
    }).withFailureHandler(err=>{
      mccOverviewState.loading = false;
      if(!opts.silent) toast(String(err));
    }).getMccProfilesOverview(20000);
  }

  function renderMccOverviewList(){
    const box = document.getElementById('mccOverviewList');
    if(!box) return;
    box.innerHTML = '';
    const items = mccOverviewState.items || [];
    if(!items.length){
      box.innerHTML = '<div style="color:rgba(255,255,255,.65);font-size:13px;">Нет данных</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for(const profile of items){
      const row = document.createElement('div');
      row.className = 'mccOverviewRow';

      const info = document.createElement('div');
      info.className = 'mccOverviewInfo';
      const label = profile.profileName || `Профиль ${profile.profileRow || ''}`.trim();
      info.textContent = profile.profileRow ? `${label} • Row ${profile.profileRow}` : label;
      row.appendChild(info);

      const dots = document.createElement('div');
      dots.className = 'mccOverviewDots';
      for(const acc of (profile.accounts || [])){
        const dot = document.createElement('span');
        dot.className = 'dotPill';
        dot.textContent = acc.accountName || '';
        if(acc.status === 'green') dot.classList.add('greenLight');
        if(acc.isCleanDone) dot.classList.add('cleanDone');
        else if(acc.status === 'yellow') dot.classList.add('yellowLight');
        else if(acc.status === 'red') dot.classList.add('redLight');
        dots.appendChild(dot);
      }
      row.appendChild(dots);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'Во вкладку';
      btn.addEventListener('click', ()=>{
        const targetAccount = profile.accounts?.[0]?.accountName || '';
        openMccProfileByName(profile.profileName, { targetAccountName: targetAccount });
      });
      row.appendChild(btn);
      frag.appendChild(row);
    }
    box.appendChild(frag);
  }

  function openMccProfileByName(name, opts = {}){
    const val = String(name || '').trim();
    if(!val) return;
    const input = document.getElementById('mccProfileInput');
    if(input) input.value = val;
    mccSearch(opts);
  }

  function mccSearch(opts = {}){
    const name = String(document.getElementById('mccProfileInput').value || '').trim();
    if(!name){ setMccError('Введите название профиля'); return; }
    setMccError('');
    toast('Загрузка MCC…');
    const token = nextReqToken('mcc');

    google.script.run.withSuccessHandler(res=>{
      if(!isLatestReq('mcc', token)) return;
      if(!res || res.ok===false){
        const msg = res?.error || 'Ошибка';
        const sug = (res?.suggestions || []).map(s=>`• ${s}`).join('\n');
        setMccError(sug ? `${msg}\n${sug}` : msg);
        return;
      }
      const key = getMccProfileKey(res.profileName);
      mccActiveProfileKey = key;
      mccProfile = res;
      mccEditMode = false;
      mccActiveAccount = res.rows?.[0]?.accountName || '';
      renderMccProfile();
      preloadMccApellIndex();
      updateMccPassLookupAndApply();
      addMccProfileTab(res);
      rememberMccActiveAccount();
      const targetAccountName = String(opts.targetAccountName || '').trim();
      const targetSectionId = String(opts.targetSectionId || '').trim();
      if(targetAccountName || targetSectionId){
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if(targetAccountName){
            const idx = mccProfile?.rows?.findIndex(r=>String(r.accountName || '').trim() === targetAccountName) ?? -1;
            if(idx >= 0) return mccScrollToAccountSection(idx);
          }
          if(targetSectionId) mccScrollToSection(targetSectionId);
        }));
      }
      toast('Готово');
    }).withFailureHandler(err=>{
      if(!isLatestReq('mcc', token)) return;
      setMccError(String(err));
    }).getMccProfile(name);
  }

  function updateMccHeader(){
    const meta = document.getElementById('mccMeta');
    meta.textContent = '';

    const btnEdit = document.getElementById('mccBtnEdit');
    btnEdit.disabled = !mccProfile;
    btnEdit.textContent = mccEditMode ? 'Готово' : 'Редактировать';

    updateMccActionButtons();

    const pill = document.getElementById('mccProfilePill');
    pill.innerHTML = '';
    if(!mccProfile){
      pill.textContent = '—';
    } else if(mccEditMode){
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'value';
      inp.value = mccProfile.profileName || '';
      inp.addEventListener('blur', ()=>{
        const next = String(inp.value || '').trim();
        if(!next || next === mccProfile.profileName) return;
        const rows = (mccProfile.rows || []).map(r=>r.row);
        toast('Сохранение…');
        google.script.run.withSuccessHandler(r=>{
          if(!r || r.ok===false){ toast(r?.error || 'Ошибка'); return; }
          mccProfile.profileName = next;
          for (const row of mccProfile.rows || []) row.values.B = next;
          toast('Сохранено');
          refreshColors({ source:'mcc', skipFilters:true });
        }).withFailureHandler(err=>toast(String(err))).updateMccProfileName(rows, next);
      });
      pill.appendChild(inp);
    } else {
      pill.textContent = mccProfile.profileName || '—';
    }

    updateMccNav();
    requestAnimationFrame(adjustMainTop);
  }

  function updateMccActionButtons(){
    const btnSync = document.getElementById('mccBtnSync');
    const btnDeleted = document.getElementById('mccBtnDeleted');
    const canUseProfile = !!mccProfile;
    if(btnSync) btnSync.disabled = !canUseProfile;
    if(btnDeleted){
      btnDeleted.disabled = !canUseProfile;
      btnDeleted.classList.toggle('btnDelActive', !!mccProfile?.isDeleted);
    }
    updateSideSyncButtons();
  }

  function toggleMccEdit(){
    if(!mccProfile) return;
    const scrollSnap = captureSproutScroll_('edit-toggle');
    mccEditMode = !mccEditMode;
    renderMccProfile({ preserveScrollSnapshot: scrollSnap });
  }

  function updateMccNav(){
    const count = mccProfile?.rows?.length || 0;
    const idx = mccProfile?.rows?.findIndex(r=>r.accountName === mccActiveAccount) ?? -1;
    const navAccount = document.getElementById('mccNavAccount');
    navAccount.textContent = mccActiveAccount || '—';
    navAccount.title = mccActiveAccount || '';

    const navCount = document.getElementById('mccNavCount');
    if(count){
      navCount.style.display = '';
      navCount.textContent = `${idx + 1} / ${count}`;
    } else {
      navCount.style.display = 'none';
      navCount.textContent = '0 / 0';
    }

    const btnPrev = document.getElementById('mccPrev');
    const btnNext = document.getElementById('mccNext');
    btnPrev.disabled = !(count && idx > 0);
    btnNext.disabled = !(count && idx >= 0 && idx < count - 1);

    renderMccTabs();
    rememberMccActiveAccount();
  }

  function mccNavPrev(){
    const idx = mccProfile?.rows?.findIndex(r=>r.accountName === mccActiveAccount) ?? -1;
    if(idx > 0) mccScrollToAccount(idx - 1);
  }

  function mccNavNext(){
    const idx = mccProfile?.rows?.findIndex(r=>r.accountName === mccActiveAccount) ?? -1;
    const total = mccProfile?.rows?.length || 0;
    if(idx >= 0 && idx < total - 1) mccScrollToAccount(idx + 1);
  }

  function scrollMccTabs(dir){
    const el=document.getElementById('mccAccountTabs');
    el.scrollBy({ left: 320 * (dir>0?1:-1), behavior:'smooth' });
  }

  function renderMccTabs(){
    const bar = document.getElementById('mccAccountTabs');
    const prevScrollLeft = bar?.scrollLeft || 0;
    bar.innerHTML = '';
    if(!mccProfile?.rows?.length) return;

    const frag = document.createDocumentFragment();
    mccProfile.rows.forEach((row, idx)=>{
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'tabPill' + (row.accountName === mccActiveAccount ? ' active' : '');
      pill.dataset.idx = String(idx);

      const label = document.createElement('span');
      label.textContent = row.accountName || `Account ${idx + 1}`;
      label.title = row.accountName || '';

      pill.appendChild(label);
      pill.addEventListener('click', ()=>mccScrollToAccount(idx));
      applyMccTabColor(pill, row);
      frag.appendChild(pill);
    });
    bar.appendChild(frag);
    requestAnimationFrame(()=>{ if(bar) bar.scrollLeft = prevScrollLeft; });
  }

  function mccGetHeaderOffset(){
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-header-h') || '0';
    const val = parseFloat(raw);
    return Number.isFinite(val) ? val : 0;
  }

  function mccGetAccountIndex(el){
    const id = el?.id || '';
    const match = id.match(/^mcc-account-(\d+)$/);
    return match ? Number(match[1]) : null;
  }

  function mccEnsureTabVisible(idx){
    const bar = document.getElementById('mccAccountTabs');
    if(!bar) return;
    const pill = bar.querySelector(`.tabPill[data-idx="${idx}"]`);
    if(!pill) return;
    const barRect = bar.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    if(pillRect.left < barRect.left || pillRect.right > barRect.right){
      pill.scrollIntoView({ behavior:'smooth', inline:'nearest', block:'nearest' });
    }
  }

  function mccSetActiveAccountByScroll(idx){
    const row = mccProfile?.rows?.[idx];
    if(!row) return;
    const name = row.accountName || '';
    if(mccActiveAccount === name) return;
    mccActiveAccount = name;
    updateMccNav();
    rememberMccActiveAccount();
    requestAnimationFrame(()=>mccEnsureTabVisible(idx));
  }

  function mccUpdateActiveAccountFromScroll(){
    const container = document.getElementById('mainScrollMcc');
    if(!container || !mccProfile?.rows?.length) return;
    const headerOffset = mccGetHeaderOffset();
    const containerRect = container.getBoundingClientRect();
    const candidates = mccAccountVisible.size
      ? Array.from(mccAccountVisible.values())
      : Array.from(document.querySelectorAll('[id^="mcc-account-"]'));
    let closestIdx = null;
    let closestDist = Infinity;
    for(const card of candidates){
      const idx = mccGetAccountIndex(card);
      if(!Number.isFinite(idx)) continue;
      const rect = card.getBoundingClientRect();
      if(rect.bottom < containerRect.top + headerOffset || rect.top > containerRect.bottom) continue;
      const dist = Math.abs(rect.top - (containerRect.top + headerOffset));
      if(dist < closestDist){
        closestDist = dist;
        closestIdx = idx;
      }
    }
    if(closestIdx != null) mccSetActiveAccountByScroll(closestIdx);
  }

  function mccSetupAccountScrollSpy(){
    const container = document.getElementById('mainScrollMcc');
    if(!container) return;
    if(mccAccountObserver){
      mccAccountObserver.disconnect();
      mccAccountObserver = null;
    }
    if(mccAccountScrollHandler){
      container.removeEventListener('scroll', mccAccountScrollHandler);
      mccAccountScrollHandler = null;
    }
    if(mccAccountResizeHandler){
      window.removeEventListener('resize', mccAccountResizeHandler);
      mccAccountResizeHandler = null;
    }

    mccAccountVisible = new Map();
    const cards = Array.from(document.querySelectorAll('[id^="mcc-account-"]'));
    if(!cards.length) return;

    const scheduleUpdate = ()=>{
      if(mccAccountScrollRaf) return;
      mccAccountScrollRaf = requestAnimationFrame(()=>{
        mccAccountScrollRaf = null;
        mccUpdateActiveAccountFromScroll();
      });
    };

    if('IntersectionObserver' in window){
      const rootMargin = `-${mccGetHeaderOffset()}px 0px -60% 0px`;
      mccAccountObserver = new IntersectionObserver((entries)=>{
        entries.forEach((entry)=>{
          const idx = mccGetAccountIndex(entry.target);
          if(idx == null) return;
          if(entry.isIntersecting) mccAccountVisible.set(idx, entry.target);
          else mccAccountVisible.delete(idx);
        });
        scheduleUpdate();
      }, { root: container, threshold:[0, 0.1, 0.5, 1], rootMargin });
      cards.forEach(card=>mccAccountObserver.observe(card));
    } else {
      cards.forEach((card)=>{
        const idx = mccGetAccountIndex(card);
        if(idx != null) mccAccountVisible.set(idx, card);
      });
    }

    mccAccountScrollHandler = scheduleUpdate;
    mccAccountResizeHandler = scheduleUpdate;
    container.addEventListener('scroll', scheduleUpdate, { passive:true });
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();
  }

  function updateMccTabsColors(){
    const bar = document.getElementById('mccAccountTabs');
    if(!bar || !mccProfile?.rows?.length) return;
    const pills = bar.querySelectorAll('.tabPill');
    pills.forEach((pill)=>{
      const idx = Number(pill.dataset.idx);
      const row = Number.isFinite(idx) ? mccProfile.rows[idx] : null;
      if(row) applyMccTabColor(pill, row);
    });
  }

  function applyMccTabColor(pill, row){
    if(!pill) return;
    pill.classList.remove('greenLight','redLight','yellowLight');
    if(isBannedForMccAccount(row)) pill.classList.add('redLight');
    else if(String(row?.values?.N || '').trim() === '+') pill.classList.add('greenLight');
    else if(String(row?.values?.N || '').trim() === '?') pill.classList.add('yellowLight');
  }

  function isBannedForMccAccount(row){
    const oVal = String(row?.values?.O || '').trim();
    return BAN_RED_VALUES.has(oVal) || BAN_YELLOW_VALUES.has(oVal);
  }

  function mccScrollToAccountSection(idx){
    const row = mccProfile?.rows?.[idx];
    if(!row) return;
    mccActiveAccount = row.accountName || '';
    updateMccNav();
    rememberMccActiveAccount();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      mccScrollToSection(`mcc-account-${idx}`);
    }));
  }

  function mccScrollToAccount(idx){
    mccScrollToAccountSection(idx);
  }

  function mccToggleAccountDeleted(rowObj, btn){
    if(!rowObj?.row) return;
    const prev = !!rowObj.isDeleted;
    const next = !rowObj.isDeleted;
    rowObj.isDeleted = next;
    if(btn){
      btn.classList.toggle('banRed', rowObj.isDeleted);
      btn.classList.toggle('active', rowObj.isDeleted);
    }
    refreshColors({ source:'mcc', skipFilters:true });
    google.script.run.withSuccessHandler(r=>{
      if(!r || r.ok===false){
        rowObj.isDeleted = prev;
        if(btn){
          btn.classList.toggle('banRed', rowObj.isDeleted);
          btn.classList.toggle('active', rowObj.isDeleted);
        }
        refreshColors({ source:'mcc', skipFilters:true });
        toast(r?.error || 'Ошибка');
        return;
      }
      rowObj.isDeleted = !!r.isDeleted;
      if(btn){
        btn.classList.toggle('banRed', rowObj.isDeleted);
        btn.classList.toggle('active', rowObj.isDeleted);
      }
      refreshColors({ source:'mcc', skipFilters:true });
    }).withFailureHandler(err=>{
      rowObj.isDeleted = prev;
      if(btn){
        btn.classList.toggle('banRed', rowObj.isDeleted);
        btn.classList.toggle('active', rowObj.isDeleted);
      }
      refreshColors({ source:'mcc', skipFilters:true });
      toast(String(err));
    }).toggleMccAccountDeleted(rowObj.row, next);
  }


  function applyMccSavedValues_(row, values){
    const normalized = Object.entries(values || {}).reduce((acc, [col, value])=>{
      const c = String(col || '').toUpperCase().trim();
      if(c) acc[c] = value;
      return acc;
    }, {});
    const cols = Object.keys(normalized);
    if(!cols.length || !mccProfile?.rows) return;
    const targetRow = Number(row);
    const rowObj = mccProfile.rows.find((item)=>Number(item?.row) === targetRow);
    if(!rowObj?.values) return;
    for(const c of cols) rowObj.values[c] = normalized[c];
    cacheMccProfile(mccProfile);
  }

  function cancelMccQueuedJob_(job){
    if(!job || job.started || job.canceled) return false;
    job.canceled = true;
    if(job.singleKey) _mccQueuedSingleByCell.delete(job.singleKey);
    if(job.counted){
      job.counted = false;
      _mccPendingWrites = Math.max(0, _mccPendingWrites - job.cols.length);
      emitLocalQueue_();
    }
    return true;
  }

  function tryCollapseMccSingleWrite_(row, normalized, onOk){
    const cols = Object.keys(normalized || {});
    if(cols.length !== 1) return false;
    const col = cols[0];
    const key = `mcc:${row}:${col}`;
    const prevJob = _mccQueuedSingleByCell.get(key);
    if(!prevJob || prevJob.started || prevJob.canceled) return false;
    const nextValue = String(normalized[col] ?? '');
    const committed = String(prevJob.prevCommitted ?? '');
    if(nextValue !== committed) return false;
    if(!cancelMccQueuedJob_(prevJob)) return false;
    const cur = _mccSaveState.get(key) || { token: 0, committed };
    cur.token += 1;
    cur.committed = committed;
    _mccSaveState.set(key, cur);
    applyMccSavedValues_(row, { [col]: committed });
    onOk?.({ ok:true, canceled:true, applied:{ [col]: committed } });
    refreshColors({ source:'mcc', skipFilters:true });
    return true;
  }

  function saveMccCellsInstant(row, updates, onOk, onFail){
    const normalized = Object.entries(updates || {}).reduce((acc, [col, value])=>{
      const c = String(col || '').toUpperCase().trim();
      if(c) acc[c] = value;
      return acc;
    }, {});
    const cols = Object.keys(normalized);
    if(!cols.length){ onFail?.('Нет данных для сохранения'); return; }

    if(tryCollapseMccSingleWrite_(row, normalized, onOk)) return;

    _mccPendingWrites += cols.length;
    emitLocalQueue_();
    logSave_('MCC', 'queued updateMccCells', { row, cols, pending: _mccPendingWrites });
    const singleKey = cols.length === 1 ? `mcc:${row}:${cols[0]}` : '';
    const job = {
      row,
      cols,
      singleKey,
      prevCommitted: singleKey ? String((_mccSaveState.get(singleKey)?.committed) ?? '') : '',
      counted:true,
      started:false,
      canceled:false
    };
    if(singleKey) _mccQueuedSingleByCell.set(singleKey, job);
    enqueueWrite_('MCC', (resolve)=>{
      if(job.canceled){ resolve(); return; }
      job.started = true;
      if(job.singleKey && _mccQueuedSingleByCell.get(job.singleKey) === job) _mccQueuedSingleByCell.delete(job.singleKey);
      google.script.run
      .withSuccessHandler((r)=>{
        if(!r || r.ok === false){
          onFail?.(r?.error || 'Ошибка');
          if(job.counted){
            job.counted = false;
            _mccPendingWrites = Math.max(0, _mccPendingWrites - cols.length);
            emitLocalQueue_();
          }
          logSave_('MCC', 'failed updateMccCells', { row, cols, pending: _mccPendingWrites, error: r?.error || 'Ошибка' });
          resolve();
          return;
        }
        const applied = (r.applied && typeof r.applied === 'object') ? r.applied : normalized;
        for(const c of cols){
          const key = `mcc:${row}:${c}`;
          const cur = _mccSaveState.get(key) || { token: 0, committed: '' };
          cur.token += 1;
          cur.committed = Object.prototype.hasOwnProperty.call(applied, c) ? applied[c] : normalized[c];
          _mccSaveState.set(key, cur);
        }
        _mccWriteRevision += 1;
        applyMccSavedValues_(row, applied);
        onOk?.(r);
        if(cols.some((c)=>['N','O','U','V','Z','D','T','W','X'].includes(c))){
          scheduleFiltersRefresh('status-change');
        }
        updateMccTabsColors();
        refreshColors({ source:'mcc', skipFilters:true });
        if(job.counted){
          job.counted = false;
          _mccPendingWrites = Math.max(0, _mccPendingWrites - cols.length);
          emitLocalQueue_();
        }
        logSave_('MCC', 'confirmed updateMccCells', { row, cols, pending: _mccPendingWrites });
        resolve();
      })
      .withFailureHandler((err)=>{
        onFail?.(String(err));
        if(job.counted){
          job.counted = false;
          _mccPendingWrites = Math.max(0, _mccPendingWrites - cols.length);
          emitLocalQueue_();
        }
        logSave_('MCC', 'transport error updateMccCells', { row, cols, pending: _mccPendingWrites, error: String(err) });
        resolve();
      })
      .updateMccCells(row, normalized);
    });
  }

  function saveMccCellInstant(row, col, value, onOk, onFail){
    const c = String(col || '').toUpperCase().trim();
    if(!c){ onFail?.('Bad col'); return; }
    saveMccCellsInstant(row, { [c]: value }, onOk, onFail);
  }
  function mccBuildButton(text, col, isDate=false){
    const btn = document.createElement('button');
    btn.type='button';
    btn.className='btn value';
    const val = String(text ?? '').trim();
    btn.textContent = isDate ? (val ? toRuDate(val) : '') : val;
    btn.title = col;
    btn.dataset.col = col;
    btn.addEventListener('click', ()=>copyText(btn.textContent));
    if(mccIsExpenseCol(col)){
      btn.dataset.bs = '1';
      applyMccExpenseColor(btn, val);
    }
    return btn;
  }

  function mccBuildInput(rowObj, col, value, isDate=false, opts = {}){
    const inp = document.createElement('input');
    inp.type = isDate ? 'date' : 'text';
    inp.className = 'value';
    inp.value = String(value ?? '').trim();
    inp.title = col;
    inp.dataset.col = col;
    inp.dataset.row = String(rowObj.row);
    if(mccIsExpenseCol(col)){
      inp.dataset.bs = '1';
      applyMccExpenseColor(inp, inp.value);
      inp.addEventListener('input', ()=>applyMccExpenseColor(inp, inp.value));
    }
    applySheetCellColorHint(inp, rowObj?.bgMap?.[col]);

    inp.addEventListener('input', ()=>{
      if(inp.dataset.saving === '1'){
        inp.dataset.pendingNextValue = inp.value;
        opts.onPending?.(inp.value);
      }
    });

    const commit = ()=>{
      const nextValue = inp.value;
      if(inp.dataset.saving === '1'){
        inp.dataset.pendingNextValue = nextValue;
        opts.onPending?.(nextValue);
        return;
      }

      const committedValue = nextValue;
      const finish = (ok)=>{
        inp.dataset.saving = '0';
        const hasPending = Object.prototype.hasOwnProperty.call(inp.dataset, 'pendingNextValue');
        const pendingValue = hasPending ? inp.dataset.pendingNextValue : null;
        delete inp.dataset.pendingNextValue;
        if(ok) delete inp.dataset.unsaved;
        else inp.dataset.unsaved = '1';
        if(ok && hasPending && String(pendingValue) !== String(committedValue)){
          inp.value = pendingValue;
          setTimeout(commit, 0);
        } else if(!ok && hasPending){
          inp.dataset.pendingNextValue = pendingValue;
        }
      };

      if(typeof opts.onCommit === 'function'){
        inp.dataset.saving = '1';
        opts.onCommit(committedValue, {
          done: ()=>finish(true),
          fail: ()=>finish(false)
        });
        return;
      }

      inp.dataset.saving = '1';
      toast('Сохранение…');
      saveMccCellInstant(rowObj.row, col, committedValue, ()=>{
        rowObj.values[col] = committedValue;
        finish(true);
        toast('Сохранено');
        opts.onSave?.(committedValue);
      }, (err)=>{ finish(false); toast(err||'Ошибка'); });
      updateMccTabsColors();
    };

    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }});
    return inp;
  }

  function mccBuildDateInput(rowObj, col, value, opts = {}){
    const inp = document.createElement('input');
    inp.type = 'date';
    inp.className = 'value';
    inp.value = mccToIsoDate(value);
    inp.title = col;
    inp.dataset.col = col;
    inp.dataset.row = String(rowObj.row);
    applySheetCellColorHint(inp, rowObj?.bgMap?.[col]);

    const commit = ()=>{
      if(inp.dataset.saving === '1') return;
      const iso = inp.value;
      const prevValue = String(rowObj.values[col] ?? '');
      rowObj.values[col] = iso;

      if(typeof opts.onCommit === 'function'){
        inp.dataset.saving = '1';
        opts.onCommit(iso, { prevValue,
          done: ()=>{ inp.dataset.saving = '0'; },
          fail: ()=>{ inp.dataset.saving = '0'; }
        });
        return;
      }

      inp.dataset.saving = '1';
      toast('Сохранение…');
      saveMccCellInstant(rowObj.row, col, iso, ()=>{ inp.dataset.saving = '0'; toast('Сохранено'); }, (err)=>{ inp.dataset.saving = '0'; toast(err||'Ошибка'); });
      updateMccTabsColors();
    };

    inp.addEventListener('input', commit);
    inp.addEventListener('change', commit);
    return inp;
  }

  function mccBuildSelect(rowObj, col, value, options, onChange, meta = {}){
    const sel = document.createElement('select');
    sel.className = 'value';
    sel.dataset.col = col;
    sel.dataset.row = String(rowObj.row);
    const optEmpty=document.createElement('option');
    optEmpty.value=''; optEmpty.textContent='';
    sel.appendChild(optEmpty);
    const opts = Array.isArray(options) ? options : [];
    for(const opt of opts){
      const o=document.createElement('option');
      o.value=opt; o.textContent=opt;
      sel.appendChild(o);
    }
    if(!opts.includes(String(value ?? ''))){
      const o=document.createElement('option');
      o.value=String(value ?? '');
      o.textContent=String(value ?? '');
      sel.appendChild(o);
    }
    sel.value = String(value ?? '');
    sel.dataset.prevValue = String(value ?? '');
    sel.dataset.uiValue = String(value ?? '');
    const saveKey = `mcc:${rowObj.row}:${col}`;
    if(!_mccSaveState.has(saveKey)) _mccSaveState.set(saveKey, { token: 0, committed: String(value ?? '') });
    applySheetCellColorHint(sel, rowObj?.bgMap?.[col]);

    sel.addEventListener('change', ()=>{
      const oldValue = String(rowObj.values[col] ?? sel.dataset.uiValue ?? sel.dataset.prevValue ?? '');
      const next = String(sel.value ?? '');
      if(oldValue === next) return;
      rowObj.values[col] = next;
      sel.dataset.uiValue = next;
      updateMccTabsColors();
      onChange?.(next);
      toast('Сохранение…');
      saveMccCellInstant(rowObj.row, col, next, ()=>{
        toast('Сохранено');
        sel.dataset.prevValue = next;
        sel.dataset.uiValue = next;
        sproutgEmitStatusEvent('MCC', meta.group || rowObj.groupName || 'MCC', next, meta.col || col, rowObj.row, oldValue);
      }, (err)=>toast(err||'Ошибка'));
    });

    return sel;
  }

  function mccBuildPlusSelectControl(rowObj, col, value, options, onChange, meta = {}){
    const wrap = document.createElement('div');
    wrap.className = 'statusSplit';
    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'btn statusPlusBtn';
    plusBtn.textContent = '+';
    plusBtn.title = '+';

    const opts = (Array.isArray(options) ? options : []).filter(opt => String(opt ?? '').trim() !== '+');
    const sel = mccBuildSelect(rowObj, col, value === '+' ? '' : value, opts, (next)=>{
      plusBtn.classList.toggle('is-active', false);
      onChange?.(next);
    }, meta);
    sel.dataset.prevValue = String(value ?? '');
    sel.dataset.uiValue = String(value ?? '');
    plusBtn.classList.toggle('is-active', String(value ?? '').trim() === '+');

    plusBtn.addEventListener('click', ()=>{
      const oldValue = String(rowObj.values[col] ?? sel.dataset.uiValue ?? sel.dataset.prevValue ?? '');
      const nextValue = oldValue === '+' ? '' : '+';
      rowObj.values[col] = nextValue;
      sel.value = nextValue === '+' ? '' : nextValue;
      sel.dataset.uiValue = nextValue;
      plusBtn.classList.toggle('is-active', nextValue === '+');
      updateMccTabsColors();
      onChange?.(nextValue);
      saveMccCellInstant(rowObj.row, col, nextValue, ()=>{
        sel.dataset.prevValue = nextValue;
        sel.dataset.uiValue = nextValue;
        sproutgEmitStatusEvent('MCC', meta.group || rowObj.groupName || 'MCC', nextValue, meta.col || col, rowObj.row, oldValue);
      }, (err)=>toast(err||'Ошибка'));
    });

    wrap.appendChild(plusBtn);
    wrap.appendChild(sel);
    return { wrap, select: sel, plusBtn };
  }


  function loadMccApellIndex(force = false){
    return new Promise((resolve)=>{
      google.script.run.withSuccessHandler((res)=>{
        if(res && res.ok){
          mccApellIndexCache = res;
          resolve(res);
          return;
        }
        resolve(null);
      }).withFailureHandler(()=>resolve(null)).getApellDataIndex({ force: !!force });
    });
  }

  function preloadMccApellIndex(){
    if(mccApellIndexCache) return;
    loadMccApellIndex(false);
  }

  function mccProfileCountryCode(){
    const name = String(mccProfile?.profileName || '').trim();
    return profileCountryCodeFromName(name);
  }

  function profileCountryCodeFromName(nameRaw){
    const name = String(nameRaw || '').trim();
    const matchTail = name.match(/([A-Za-z]{2})\s*$/);
    if(matchTail) return String(matchTail[1] || '').trim().toUpperCase();

    const parts = name.split(/\s+/).filter(Boolean);
    const tail = String(parts[parts.length - 1] || '').replace(/[^A-Za-z]/g, '');
    return tail ? tail.slice(-2).toUpperCase() : '';
  }

  function chooseApellRowByCode(code){
    const normalizedCode = String(code || '').toUpperCase();
    const byCode = mccApellIndexCache?.blocksByCode || {};
    let selectedCode = normalizedCode;
    let blocks = byCode[selectedCode] || [];
    if(!blocks.length && selectedCode !== 'EN'){
      selectedCode = 'EN';
      blocks = byCode[selectedCode] || [];
    }
    if(!blocks.length) return null;

    const maxAttempts = Math.min(blocks.length * 2, 12);
    for(let i = 0; i < maxAttempts; i++){
      const block = blocks[Math.floor(Math.random() * blocks.length)] || [];
      const rows = block.filter((r)=>r && !r.isEmpty && (r.country || r.activity || r.payer || r.card));
      if(!rows.length) continue;
      const picked = rows[Math.floor(Math.random() * rows.length)] || null;
      if(!picked) continue;
      return { row: picked, selectedCode, fallbackUsed: selectedCode !== normalizedCode };
    }
    return null;
  }

  function mccApellCodesHint(limit = 10){
    const list = Array.isArray(mccApellIndexCache?.availableCodes) ? mccApellIndexCache.availableCodes : [];
    return list.slice(0, limit).join(', ');
  }

  async function openMccAppealModal(rowObj){
    const code = mccProfileCountryCode();

    if(!mccApellIndexCache){
      await loadMccApellIndex(false);
    }

    let apellPick = chooseApellRowByCode(code);
    if(!apellPick){
      await loadMccApellIndex(true);
      apellPick = chooseApellRowByCode(code);
    }
    if(!apellPick){
      const codesHint = mccApellCodesHint();
      const suffix = codesHint ? `. Доступные коды: ${codesHint}` : '';
      toast(`Нет данных Apell для кода ${code || '??'}${suffix}`);
      return;
    }
    if(apellPick.fallbackUsed){
      toast(`Нет данных Apell для ${code || '??'} — использован ${apellPick.selectedCode}`);
    }
    const apell = apellPick.row;

    const overlay = document.createElement('div');
    overlay.className = 'appealModalOverlay';
    const modal = document.createElement('div');
    modal.className = 'appealModal';
    const close = ()=>{ document.removeEventListener('keydown', onEsc); overlay.remove(); };
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
    const onEsc = (e)=>{ if(e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);

    const head = document.createElement('div');
    head.className = 'appealModalHead';
    head.innerHTML = `<b>Апелляция • ${rowObj.accountName || ''}</b>`;
    const xBtn = document.createElement('button');
    xBtn.type = 'button'; xBtn.className = 'btn'; xBtn.textContent = '×';
    xBtn.addEventListener('click', close);
    head.appendChild(xBtn);

    const dateText = rowObj.values?.D ? toRuDate(mccToIsoDate(rowObj.values.D) || rowObj.values.D) : '';
    const items = [
      ['Страна', apell.country || ''],
      ['Деятельность', apell.activity || ''],
      ['Ссылка', String(rowObj.values?.J || '').trim()],
      ['Кто оплатил?', apell.payer || ''],
      ['Карта', apell.card || ''],
      ['Дата', dateText || '']
    ];

    const grid = document.createElement('div');
    grid.className = 'appealModalGrid';
    for(const [label, value] of items){
      const row = document.createElement('div');
      row.className = 'field';
      const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn value'; b.textContent = value;
      b.addEventListener('click', ()=>copyText(value));
      row.appendChild(l); row.appendChild(b); row.appendChild(document.createElement('div')).className='actions';
      grid.appendChild(row);
    }

    const footer = document.createElement('div');
    footer.className = 'appealModalFooter';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', close);

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'btn btnPrimary';
    doneBtn.textContent = 'Готово';

    const statusCol = 'N';
    const rowNum = Number(rowObj?.row);
    const statusSelect = document.querySelector(`#mccOut select[data-row="${rowObj.row}"][data-col="${statusCol}"]`);
    if(!Number.isFinite(rowNum) || rowNum <= 0 || !statusCol){
      doneBtn.disabled = true;
    }

    doneBtn.addEventListener('click', ()=>{
      if(doneBtn.disabled || doneBtn.dataset.saving === '1') return;

      const oldValue = String(rowObj.values?.[statusCol] ?? statusSelect?.dataset?.prevValue ?? statusSelect?.value ?? '').trim();
      if(oldValue === 'Апелл'){
        close();
        return;
      }

      doneBtn.dataset.saving = '1';
      doneBtn.disabled = true;
      doneBtn.textContent = 'Сохранение…';
      cancelBtn.disabled = true;

      const nextValue = 'Апелл';
      saveMccCellInstant(rowNum, statusCol, nextValue, ()=>{
        rowObj.values[statusCol] = nextValue;
        if(statusSelect){
          if(!Array.from(statusSelect.options || []).some((opt)=>String(opt.value || '') === nextValue)){
            const opt = document.createElement('option');
            opt.value = nextValue;
            opt.textContent = nextValue;
            statusSelect.appendChild(opt);
          }
          statusSelect.value = nextValue;
          statusSelect.dataset.prevValue = nextValue;
          applyMccSelectColor(statusSelect, statusCol, nextValue);
        }
        updateMccTabsColors();
        sproutgEmitStatusEvent('MCC', 'Апелл', nextValue, statusCol, rowNum, oldValue);
        toast('Сохранено');
        close();
      }, (err)=>{
        doneBtn.dataset.saving = '0';
        doneBtn.disabled = false;
        doneBtn.textContent = 'Готово';
        cancelBtn.disabled = false;
        toast(err || 'Ошибка');
      });
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(doneBtn);

    modal.appendChild(head);
    modal.appendChild(grid);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  async function openO1AppealModal(profile, fieldMap, card){
    const code = profileCountryCodeFromName(profile?.profileName || '');
    const rowNum = Number(profile?.row);
    if(!mccApellIndexCache) await loadMccApellIndex(false);
    let apellPick = chooseApellRowByCode(code);
    if(!apellPick){
      await loadMccApellIndex(true);
      apellPick = chooseApellRowByCode(code);
    }
    if(!apellPick){ toast('Нет данных Apell'); return; }
    if(apellPick.fallbackUsed){ toast(`Нет данных Apell для ${code || '??'} — использован ${apellPick.selectedCode}`); }

    const apell = apellPick.row;
    const verificationGroup = (profile?.groups || []).find((g)=>isVerificationGroupName(g?.name));
    const fByCol = {};
    for(const f of (verificationGroup?.fields || [])) fByCol[String(f.col || '').toUpperCase()] = f;

    const rowData = await new Promise((resolve)=>{
      if(!Number.isFinite(rowNum) || rowNum < 2){ resolve(null); return; }
      google.script.run
        .withSuccessHandler((res)=>resolve(res && res.ok ? res : null))
        .withFailureHandler(()=>resolve(null))
        .getO1AppealRowData(rowNum);
    });

    const linkValue = String(rowData?.link || '').trim();
    const dateDisplay = String(rowData?.dateDisplay || '').trim();
    const dateIso = String(rowData?.dateIso || '').trim();
    const dateText = dateDisplay || (dateIso ? toRuDate(dateIso) : '');

    const overlay = document.createElement('div');
    overlay.className = 'appealModalOverlay';
    const modal = document.createElement('div');
    modal.className = 'appealModal';
    const close = ()=>{ document.removeEventListener('keydown', onEsc); overlay.remove(); };
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
    const onEsc = (e)=>{ if(e.key === 'Escape') close(); };
    document.addEventListener('keydown', onEsc);

    const head = document.createElement('div');
    head.className = 'appealModalHead';
    head.innerHTML = `<b>Апелляция • ${profile?.profileName || ''}</b>`;
    const xBtn = document.createElement('button');
    xBtn.type = 'button'; xBtn.className = 'btn'; xBtn.textContent = '×';
    xBtn.addEventListener('click', close);
    head.appendChild(xBtn);

    const items = [
      ['Страна', apell.country || ''],
      ['Деятельность', apell.activity || ''],
      ['Ссылка', linkValue],
      ['Кто оплатил?', apell.payer || ''],
      ['Карта', apell.card || ''],
      ['Дата', dateText || '']
    ];
    const grid = document.createElement('div');
    grid.className = 'appealModalGrid';
    for(const [label, value] of items){
      const row = document.createElement('div');
      row.className = 'field';
      const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn value'; b.textContent = value;
      if((label === 'Ссылка' || label === 'Дата') && !value){ b.disabled = true; }
      else b.addEventListener('click', ()=>copyText(value));
      row.appendChild(l); row.appendChild(b); row.appendChild(document.createElement('div')).className='actions';
      grid.appendChild(row);
    }

    const footer = document.createElement('div');
    footer.className = 'appealModalFooter';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'btn'; cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', close);
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button'; doneBtn.className = 'btn btnPrimary'; doneBtn.textContent = 'Готово';
    doneBtn.addEventListener('click', ()=>{
      if(doneBtn.dataset.saving === '1') return;
      const oldValue = String(rowData?.bwValue || fByCol.BW?.value || '').trim();
      if(oldValue === 'Апелл'){ close(); return; }
      const bwSelect = document.querySelector(`#out [data-row="${profile.row}"][data-col="BW"]`);
      doneBtn.dataset.saving = '1'; doneBtn.disabled = true; cancelBtn.disabled = true;
      saveCellInstant(profile.row, 'BW', 'Апелл', ()=>{
        if(fByCol.BW) fByCol.BW.value = 'Апелл';
        if(bwSelect){
          if(bwSelect.tagName === 'SELECT' && !Array.from(bwSelect.options).some(o=>o.value==='Апелл')){
            const opt = document.createElement('option'); opt.value='Апелл'; opt.textContent='Апелл'; bwSelect.appendChild(opt);
          }
          bwSelect.value = 'Апелл';
          bwSelect.dataset.prevValue = 'Апелл';
          applySelectColor(bwSelect, 'BW', 'Апелл');
        }
        if(card) applyVerificationCardColor(card, fieldMap || {});
        if(oldValue !== 'Апелл') sproutgEmitStatusEvent('O1', 'Речек', 'Апелл', 'BW', profile.row, oldValue);
        syncProfile({ preserveSmsPool:true });
        toast('Сохранено');
        close();
      }, (err)=>{ doneBtn.dataset.saving='0'; doneBtn.disabled=false; cancelBtn.disabled=false; toast(err||'Ошибка'); });
    });
    footer.appendChild(cancelBtn); footer.appendChild(doneBtn);
    modal.appendChild(head); modal.appendChild(grid); modal.appendChild(footer); overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function detectMccHeaderColumns(){
    const headers = mccProfile?.headers || {};
    let fioCol = '';
    let addrCol = '';
    for(const [col, labelRaw] of Object.entries(headers)){
      const label = String(labelRaw || '').trim();
      const norm = label.toLowerCase().replace(/ё/g,'е');
      if(!fioCol && label === 'ФИО') fioCol = col;
      if(!addrCol && norm.includes('адрес') && norm.includes('вериф')) addrCol = col;
    }
    return { fioCol, addrCol };
  }

  function updateMccPassLookupAndApply(){
    const { fioCol, addrCol } = detectMccHeaderColumns();
    const rows = mccProfile?.rows || [];
    const fios = rows.map(r=>String(r.values?.[fioCol] || '').trim()).filter(Boolean);
    const counts = new Map();
    for(const fio of fios) counts.set(fio, (counts.get(fio) || 0) + 1);
    mccPassLookupState.duplicateFios = new Set([...counts.entries()].filter(([,c])=>c>1).map(([k])=>k));
    mccPassLookupState.fioCol = fioCol;
    mccPassLookupState.addrCol = addrCol;
    if(!fioCol){ return; }
    if(!fios.length){ applyMccFioVisualMarks(); return; }
    if(mccPassLookupState.inFlight) return;
    mccPassLookupState.inFlight = true;
    google.script.run.withSuccessHandler((res)=>{
      mccPassLookupState.inFlight = false;
      if(!res || res.ok===false){ applyMccFioVisualMarks(); return; }
      mccPassLookupState.byFio = res.items || {};
      applyMccFioVisualMarks();
      autoFillMccVerificationAddresses();
    }).withFailureHandler(()=>{ mccPassLookupState.inFlight = false; applyMccFioVisualMarks(); }).getPassLookupForFios(fios);
  }

  function applyMccFioVisualMarks(){
    const fioCol = mccPassLookupState.fioCol;
    if(!fioCol) return;
    const byFio = mccPassLookupState.byFio || {};
    const duplicates = mccPassLookupState.duplicateFios || new Set();
    document.querySelectorAll(`#mccOut [data-col="${fioCol}"]`).forEach((el)=>{
      const fio = String(el.value ?? el.textContent ?? '').trim();
      el.classList.remove('fioPassF','fioPassG','fioDuplicate');
      const info = byFio[fio];
      if(info?.src === 'F') el.classList.add('fioPassF');
      else if(info?.src === 'G') el.classList.add('fioPassG');
      if(duplicates.has(fio)) el.classList.add('fioDuplicate');
    });
  }

  function autoFillMccVerificationAddresses(){
    const fioCol = mccPassLookupState.fioCol;
    const addrCol = mccPassLookupState.addrCol;
    if(!fioCol || !addrCol) return;
    for(const rowObj of (mccProfile?.rows || [])){
      const fio = String(rowObj.values?.[fioCol] || '').trim();
      const curAddr = String(rowObj.values?.[addrCol] || '').trim();
      const info = mccPassLookupState.byFio?.[fio];
      const nextAddr = String(info?.address || '').trim();
      if(!fio || !nextAddr || curAddr) continue;
      const key = `addrfill:${rowObj.row}:${addrCol}`;
      if(_mccSaveState.get(key)) continue;
      _mccSaveState.set(key, { token:1, pending:true });
      rowObj.values[addrCol] = nextAddr;
      saveMccCellInstant(rowObj.row, addrCol, nextAddr, ()=>{
        _mccSaveState.delete(key);
        const el = document.querySelector(`#mccOut [data-row="${rowObj.row}"][data-col="${addrCol}"]`);
        if(el){ if('value' in el) el.value = nextAddr; else el.textContent = nextAddr; }
      }, ()=>_mccSaveState.delete(key));
    }
  }

  function applyMccSelectColor(el, col, value){
    el.classList.remove('greenLight','yellowLight','redLight','blueLight','orangeLight');
    delete el.dataset.appcolor;
    const v = String(value || '').trim();

    if(col === 'N'){
      if(v === '+') el.classList.add('greenLight');
      else if(BAN_YELLOW_VALUES.has(v)) el.classList.add('yellowLight');
      else if(v === 'Вышел') el.classList.add('blueLight');
      else if(v === 'Не вышел') el.classList.add('redLight');
      if(el.classList.contains('greenLight') || el.classList.contains('yellowLight') || el.classList.contains('blueLight') || el.classList.contains('redLight')) el.dataset.appcolor = '1';
      return;
    }

    if(col === 'O'){
      if(BAN_RED_VALUES.has(v)) el.classList.add('redLight');
      else if(BAN_YELLOW_VALUES.has(v)) el.classList.add('yellowLight');
      if(el.classList.contains('yellowLight') || el.classList.contains('redLight')) el.dataset.appcolor = '1';
      return;
    }

    if(col === 'Z'){
      if(v === '+') el.classList.add('greenLight');
      if(el.classList.contains('greenLight')) el.dataset.appcolor = '1';
      return;
    }
  }

  function getMccGroupColorClass(nVal, oVal){
    const n = String(nVal || '').trim();
    const o = String(oVal || '').trim();
    const isORed = BAN_RED_VALUES.has(o);
    const isOYellow = BAN_YELLOW_VALUES.has(o);

    if(n === 'Не вышел') return 'redLight';
    if(n === 'Вышел') return isORed ? 'redLight' : 'blueLight';
    if(n === '+') return isORed ? 'redLight' : 'greenLight';
    if(BAN_YELLOW_VALUES.has(n)) return 'yellowLight';
    if(isORed) return 'redLight';
    if(isOYellow) return 'yellowLight';
    return '';
  }

  function setMccGroupColor(card, nVal, oVal){
    card.classList.remove('greenLight','yellowLight','redLight','blueLight');
    const cls = getMccGroupColorClass(nVal, oVal);
    if(cls) card.classList.add(cls);
  }

  function splitMccCell(raw){
    const s = String(raw || '').trim().replace(/\s+/g,' ');
    if(!s) return { p1:'', p2:'', p3:'' };
    const m = s.match(/(\d{16})\s+(\d{2}\/\d{2})\s+(\d{3})/);
    if(m) return { p1:m[1], p2:m[2], p3:m[3] };
    const digits = s.replace(/[^\d]/g,'');
    const exp = (s.match(/\d{2}\/\d{2}/) || [])[0] || '';
    const p1 = digits.slice(0,16);
    const p3 = digits.length >= 19 ? digits.slice(-3) : '';
    return { p1, p2:exp, p3 };
  }

  function stopMccTotp(){
    if(mccTotpInterval){
      clearInterval(mccTotpInterval);
      mccTotpInterval = null;
    }
  }

  function renderMccTotpRow(fieldsWrap, secret){
    const row=document.createElement('div');
    row.className='field';

    const label=document.createElement('div');
    label.className='label';
    label.textContent='2FA (TOTP)';
    label.title='AO';

    const wrap=document.createElement('div');
    wrap.className='totpField';

    const codeBtn=document.createElement('button');
    codeBtn.type='button';
    codeBtn.className='btn value totpCodeBtn centerText';
    codeBtn.textContent='------';
    codeBtn.title='Нажми чтобы скопировать код';
    codeBtn.addEventListener('click', ()=>copyText(codeBtn.textContent));

    const meta=document.createElement('div');
    meta.className='totpMeta';

    const timer=document.createElement('span');
    timer.textContent='—';
    meta.appendChild(timer);

    wrap.appendChild(codeBtn);
    wrap.appendChild(meta);

    row.appendChild(label);
    row.appendChild(wrap);
    row.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row);

    stopMccTotp();
    const update = async ()=>{
      const sec = String(secret || '').trim();
      if(!sec){
        codeBtn.textContent='------';
        timer.textContent='нет AO';
        applyTotpColor(codeBtn, NaN);
        return;
      }
      try{
        const r = await totp(sec, 30, 6);
        if(!r){
          codeBtn.textContent='------';
          timer.textContent='ошибка AO';
          applyTotpColor(codeBtn, NaN);
          return;
        }
        codeBtn.textContent = r.code;
        timer.textContent = `${r.remain}s`;
        applyTotpColor(codeBtn, r.remain);
      }catch(e){
        codeBtn.textContent='------';
        timer.textContent='ошибка';
        applyTotpColor(codeBtn, NaN);
      }
    };

    update();
    mccTotpInterval = setInterval(update, 1000);
  }

  function updateMccVerificationPairColors(rowObj){
    if(!rowObj?.row) return;
    const rowSelector = `#mccOut select[data-row="${rowObj.row}"][data-col="U"]`;
    document.querySelectorAll(rowSelector).forEach((uSel)=>{
      const scope = uSel.closest('.mccVerificationBlock, .mccAccountVerificationDup') || uSel.parentElement;
      const vSel = scope?.querySelector(`select[data-row="${rowObj.row}"][data-col="V"]`);
      if(vSel) applyMccVerificationColors(uSel, vSel, rowObj.values.U, rowObj.values.V);
    });
  }

  function syncMccVerificationControls(rowObj, updates = {}){
    if(!rowObj?.row) return;
    for(const [colRaw, value] of Object.entries(updates || {})){
      const col = String(colRaw || '').toUpperCase();
      if(!col) continue;
      rowObj.values[col] = value;
      document.querySelectorAll(`#mccOut [data-row="${rowObj.row}"][data-col="${col}"]`).forEach((el)=>{
        if('value' in el) el.value = String(value ?? '');
        else el.textContent = String(value ?? '');
      });
    }
    updateMccVerificationPairColors(rowObj);
    updateMccTabsColors();
  }

  function buildMccVerificationDateControl(rowObj){
    return mccBuildDateInput(rowObj, 'T', rowObj.values.T, {
      onCommit: (iso, flow)=>{
        const prevT = String(flow.prevValue || '').trim();
        const prevU = String(rowObj.values.U || '').trim();
        const updates = { T: iso };
        if(iso && !prevT && !prevU) updates.U = 'Взять в работу';
        for(const [col, val] of Object.entries(updates)) rowObj.values[col] = val;
        toast('Сохранение…');
        saveMccCellsInstant(rowObj.row, updates, ()=>{
          syncMccVerificationControls(rowObj, updates);
          flow.done();
          toast('Сохранено');
        }, (err)=>{ flow.fail(); toast(err||'Ошибка'); });
      }
    });
  }

  function handleMccVerificationStatusChange(rowObj, uSelect, vSelect, next){
    updateMccVerificationPairColors(rowObj);
    if(String(next || '').trim() === 'Успешно'){
      const desired = 'Разбан вериф бизнес';
      const hasOption = Array.from(vSelect.options).some(opt=>opt.value === desired);
      if(!hasOption){
        toast('Нет опции "Разбан вериф бизнес" для V');
      } else if(vSelect.value !== desired){
        rowObj.values.V = desired;
        syncMccVerificationControls(rowObj, { V: desired });
        toast('Сохранение…');
        saveMccCellInstant(rowObj.row, 'V', desired, ()=>toast('Сохранено'), (err)=>toast(err||'Ошибка'));
      }
    }
    refreshColors({ source:'mcc', skipFilters:true });
  }

  function appendMccAccountVerificationRows(fieldsWrap, rowObj){
    const row1 = document.createElement('div');
    row1.className = 'field mccAccountVerificationDup';
    const label1 = document.createElement('div');
    label1.className = 'label';
    label1.textContent = 'Вериф';
    const grid1 = document.createElement('div');
    grid1.className = 'mccInlineGrid2';
    grid1.appendChild(mccWrapFieldLabel('T', buildMccVerificationDateControl(rowObj)));
    grid1.appendChild(mccWrapFieldLabel('AW', mccEditMode ? mccBuildInput(rowObj, 'AW', rowObj.values.AW) : mccBuildButton(rowObj.values.AW, 'AW')));
    row1.appendChild(label1);
    row1.appendChild(grid1);
    row1.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'field mccVerificationBlock mccAccountVerificationDup';
    const label2 = document.createElement('div');
    label2.className = 'label';
    label2.textContent = 'Статус';
    const grid2 = document.createElement('div');
    grid2.className = 'mccInlineGrid2';
    const uValue = rowObj.values.U ?? '';
    const vValue = rowObj.values.V ?? '';
    const uSelect = mccBuildSelect(rowObj, 'U', uValue, mccProfile.dropdowns?.U, (next)=>handleMccVerificationStatusChange(rowObj, uSelect, vSelect, next), { group:'Верификация' });
    const vSelect = mccBuildSelect(rowObj, 'V', vValue, mccProfile.dropdowns?.V, ()=>updateMccVerificationPairColors(rowObj), { group:'Верификация' });
    applyMccVerificationColors(uSelect, vSelect, uValue, vValue);
    grid2.appendChild(mccWrapFieldLabel('U', uSelect));
    grid2.appendChild(mccWrapFieldLabel('V', vSelect));
    row2.appendChild(label2);
    row2.appendChild(grid2);
    row2.appendChild(document.createElement('div')).className='actions';
    fieldsWrap.appendChild(row2);
  }

  function renderMccProfile(opts = {}){
    stopMccTotp();
    updateMccHeader();

    const out = document.getElementById('mccOut');
    out.innerHTML = '';
    if(!mccProfile){
      if(opts.preserveScrollSnapshot) restoreSproutScroll_(opts.preserveScrollSnapshot);
      return;
    }

    const shell = document.createElement('div');
    shell.id = 'mccProfileShell';
    out.appendChild(shell);

    const proxyCols = ['AG','AH','AI','AK','AJ','AL'];
    const accountCols = ['AM','AN','AO'];

    const profileRow = mccProfile.profileRow;

    const proxyCard = document.createElement('div');
    proxyCard.className = 'card mccProxyCard';
    proxyCard.innerHTML = `
      <div class="title">
        <h3>Прокси</h3>
        <div class="meta2"></div>
      </div>
    `;
    const proxyFields = document.createElement('div');
    for(const col of proxyCols){
      const row=document.createElement('div');
      row.className='field';
      const label=document.createElement('div');
      label.className='label';
      label.textContent=mccGetLabel(col);

      const value = profileRow.values[col] ?? '';
      if(mccEditMode){
        row.appendChild(label);
        if(col === 'AG'){
          row.appendChild(mccBuildInput(profileRow, col, value, false, {
            onSave:(next)=>updateProxyFieldsFromServer('MCC', profileRow.row, next)
          }));
        } else {
          row.appendChild(mccBuildInput(profileRow, col, value));
        }
        row.appendChild(document.createElement('div')).className='actions';
      } else {
        row.appendChild(label);
        const btn = mccBuildButton(value, col);
        if(col === 'AJ' || col === 'AL'){
          btn.dataset.proxyColor = '1';
          applyMccProxyUserIspColor(btn, profileRow, col);
        }
        row.appendChild(btn);
        row.appendChild(document.createElement('div')).className='actions';
      }
      proxyFields.appendChild(row);
    }
    proxyCard.appendChild(proxyFields);
    shell.appendChild(proxyCard);

    const accCard = document.createElement('div');
    accCard.className = 'card';
    accCard.innerHTML = `
      <div class="title">
        <h3>Аккаунт</h3>
        <div class="meta2"></div>
      </div>
    `;
    const accFields = document.createElement('div');
    for(const col of accountCols){
      const row=document.createElement('div');
      row.className='field';
      const label=document.createElement('div');
      label.className='label';
      label.textContent=mccGetLabel(col);

      const value = profileRow.values[col] ?? '';
      if(mccEditMode){
        row.appendChild(label);
        row.appendChild(mccBuildInput(profileRow, col, value));
        row.appendChild(document.createElement('div')).className='actions';
      } else {
        row.appendChild(label);
        row.appendChild(mccBuildButton(value, col));
        row.appendChild(document.createElement('div')).className='actions';
      }
      accFields.appendChild(row);
    }
    renderMccTotpRow(accFields, profileRow.values.AO || '');
    accCard.appendChild(accFields);
    shell.appendChild(accCard);

    mccProfile.rows.forEach((rowObj, idx)=>{
      const card = document.createElement('div');
      card.className = 'card';
      card.id = `mcc-account-${idx}`;
      card.dataset.account = rowObj.accountName || '';

      const header = document.createElement('div');
      header.className = 'title mccCardHeader';
      const h3 = document.createElement('h3');
      h3.className = 'mccAccountName';
      h3.textContent = rowObj.accountName || `Аккаунт ${idx + 1}`;
      header.appendChild(h3);
      const headerMeta = document.createElement('div');
      headerMeta.className = 'meta2';
      const appealBtn = document.createElement('button');
      appealBtn.type = 'button';
      appealBtn.className = 'btn';
      appealBtn.textContent = 'Апелляция';
      appealBtn.addEventListener('click', ()=>openMccAppealModal(rowObj));
      headerMeta.appendChild(appealBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = `btn accountDeleteBtn${rowObj.isDeleted ? ' banRed active' : ''}`;
      delBtn.textContent = 'Аккаунт удален';
      delBtn.addEventListener('click', ()=>{
        mccToggleAccountDeleted(rowObj, delBtn);
      });
      headerMeta.appendChild(delBtn);
      header.appendChild(headerMeta);
      card.appendChild(header);

      const fieldsWrap = document.createElement('div');

      const mainRow = document.createElement('div');
      mainRow.className = 'field';
      const mainLabel = document.createElement('div');
      mainLabel.className = 'label';
      mainLabel.textContent = 'Основное';
      const mainWrap = document.createElement('div');
      mainWrap.className = 'mccRowMain';

      const primaryGrid = document.createElement('div');
      primaryGrid.className = 'mccPrimaryRow';
      primaryGrid.appendChild(mccWrapFieldLabel('D', mccBuildDateInput(rowObj, 'D', rowObj.values.D)));
      if(mccEditMode){
        primaryGrid.appendChild(mccWrapFieldLabel('J', mccBuildInput(rowObj, 'J', rowObj.values.J)));
        primaryGrid.appendChild(mccWrapFieldLabel('K', mccBuildInput(rowObj, 'K', rowObj.values.K)));
      } else {
        primaryGrid.appendChild(mccWrapFieldLabel('J', mccBuildButton(rowObj.values.J, 'J')));
        primaryGrid.appendChild(mccWrapFieldLabel('K', mccBuildButton(rowObj.values.K, 'K')));
      }

      const companyGrid = document.createElement('div');
      companyGrid.className = 'mccInlineGrid2';
      if(mccEditMode){
        companyGrid.appendChild(mccWrapFieldLabel('I', mccBuildInput(rowObj, 'I', rowObj.values.I)));
      } else {
        companyGrid.appendChild(mccWrapFieldLabel('I', mccBuildButton(rowObj.values.I, 'I')));
      }

      const addressGrid = document.createElement('div');
      addressGrid.className = 'mccInlineGrid3';
      if(mccEditMode){
        addressGrid.appendChild(mccWrapFieldLabel('AP', mccBuildInput(rowObj, 'AP', rowObj.values.AP)));
        addressGrid.appendChild(mccWrapFieldLabel('AQ', mccBuildInput(rowObj, 'AQ', rowObj.values.AQ)));
        addressGrid.appendChild(mccWrapFieldLabel('AR', mccBuildInput(rowObj, 'AR', rowObj.values.AR)));
      } else {
        addressGrid.appendChild(mccWrapFieldLabel('AP', mccBuildButton(rowObj.values.AP, 'AP')));
        addressGrid.appendChild(mccWrapFieldLabel('AQ', mccBuildButton(rowObj.values.AQ, 'AQ')));
        addressGrid.appendChild(mccWrapFieldLabel('AR', mccBuildButton(rowObj.values.AR, 'AR')));
      }

      mainWrap.appendChild(primaryGrid);
      mainWrap.appendChild(companyGrid);
      mainWrap.appendChild(addressGrid);
      mainRow.appendChild(mainLabel);
      mainRow.appendChild(mainWrap);
      mainRow.appendChild(document.createElement('div')).className='actions';
      fieldsWrap.appendChild(mainRow);

      const eedunsRow = document.createElement('div');
      eedunsRow.className = 'field';
      const eedunsLabel = document.createElement('div');
      eedunsLabel.className = 'label';
      eedunsLabel.textContent = 'EE&DUNS';
      const eedunsGrid = document.createElement('div');
      eedunsGrid.className = 'mccInlineGrid2';
      if(mccEditMode){
        eedunsGrid.appendChild(mccWrapFieldLabel('AS', mccBuildInput(rowObj, 'AS', rowObj.values.AS)));
        eedunsGrid.appendChild(mccWrapFieldLabel('AT', mccBuildInput(rowObj, 'AT', rowObj.values.AT)));
      } else {
        eedunsGrid.appendChild(mccWrapFieldLabel('AS', mccBuildButton(rowObj.values.AS, 'AS')));
        eedunsGrid.appendChild(mccWrapFieldLabel('AT', mccBuildButton(rowObj.values.AT, 'AT')));
      }
      eedunsRow.appendChild(eedunsLabel);
      eedunsRow.appendChild(eedunsGrid);
      eedunsRow.appendChild(document.createElement('div')).className='actions';
      fieldsWrap.appendChild(eedunsRow);

      const splitCol = mccProfile.splitCol || 'P';
      const split = splitMccCell(rowObj.values[splitCol]);
      const splitRow = document.createElement('div');
      splitRow.className = 'field';
      const splitLabel = document.createElement('div');
      splitLabel.className = 'label';
      splitLabel.textContent = mccGetLabel(splitCol);
      const splitGrid = document.createElement('div');
      splitGrid.className = 'mccInlineGrid3';
      splitGrid.appendChild(mccBuildButton(split.p1, splitCol));
      splitGrid.appendChild(mccBuildButton(split.p2, splitCol));
      splitGrid.appendChild(mccBuildButton(split.p3, splitCol));
      splitRow.appendChild(splitLabel);
      splitRow.appendChild(splitGrid);
      splitRow.appendChild(document.createElement('div')).className='actions';
      fieldsWrap.appendChild(splitRow);

      const rRow = document.createElement('div');
      rRow.className = 'field';
      const rLabel = document.createElement('div');
      rLabel.className = 'label';
      rLabel.textContent = mccGetLabel('R');
      rRow.appendChild(rLabel);
      const rWrap = document.createElement('div');
      rWrap.className = 'mccInlineGrid2';
      const rInput = mccBuildDateInput(rowObj, 'R', rowObj.values.R);
      rWrap.appendChild(rInput);
      const underReviewBtn = document.createElement('button');
      underReviewBtn.type = 'button';
      underReviewBtn.className = 'btn';
      underReviewBtn.textContent = 'На рассмотрении';
      underReviewBtn.dataset.appcolor = '1';
      underReviewBtn.addEventListener('click', ()=>{
        if(underReviewBtn.disabled) return;
        underReviewBtn.disabled = true;
        google.script.run
          .withSuccessHandler((res)=>{
            underReviewBtn.disabled = false;
            if(!res || res.ok === false){ toast(res?.error || 'Ошибка'); return; }
            rowObj.bgMap = rowObj.bgMap || {};
            rowObj.bgMap.R = '#7dd3fc';
            refreshColors({ source:'mcc', skipFilters:true });
            toast('Помечено: На рассмотрении');
          })
          .withFailureHandler((err)=>{ underReviewBtn.disabled = false; toast(String(err)); })
          .mccSetUnderReviewBg(rowObj.row);
      });
      rWrap.appendChild(underReviewBtn);
      rRow.appendChild(rWrap);
      rRow.appendChild(document.createElement('div')).className='actions';
      fieldsWrap.appendChild(rRow);

      const nRow = document.createElement('div');
      nRow.className = 'field';
      const nLabel = document.createElement('div');
      nLabel.className = 'label';
      nLabel.textContent = mccGetLabel('N');
      rowObj.groupName = 'Аккаунт MCC';
      const nValue = rowObj.values.N ?? '';
      const nStatus = mccBuildPlusSelectControl(rowObj, 'N', nValue, mccProfile.dropdowns?.N, (next)=>{
        applyMccSelectColor(nSelect, 'N', next);
        setMccGroupColor(card, next, rowObj.values.O);
      }, { group:'Аккаунт MCC' });
      const nSelect = nStatus.select;
      applyMccSelectColor(nSelect, 'N', nValue);
      nRow.appendChild(nLabel);
      nRow.appendChild(nStatus.wrap);
      nRow.appendChild(document.createElement('div')).className='actions';
      fieldsWrap.appendChild(nRow);

      const oRow = document.createElement('div');
      oRow.className = 'field';
      const oLabel = document.createElement('div');
      oLabel.className = 'label';
      oLabel.textContent = mccGetLabel('O');
      const oValue = rowObj.values.O ?? '';
      const oSelect = mccBuildSelect(rowObj, 'O', oValue, mccProfile.dropdowns?.O, (next)=>{
        applyMccSelectColor(oSelect, 'O', next);
        setMccGroupColor(card, rowObj.values.N, next);
      }, { group:'Аккаунт MCC' });
      applyMccSelectColor(oSelect, 'O', oValue);
      oRow.appendChild(oLabel);
      oRow.appendChild(oSelect);
      oRow.appendChild(document.createElement('div')).className='actions';
      fieldsWrap.appendChild(oRow);

      appendMccAccountVerificationRows(fieldsWrap, rowObj);
      setMccGroupColor(card, rowObj.values.N, rowObj.values.O);

      card.appendChild(fieldsWrap);
      shell.appendChild(card);
    });

    const verificationCard = document.createElement('div');
    verificationCard.className = 'card';
    verificationCard.id = 'mccVerificationSection';
    verificationCard.dataset.group = 'Верификация';
    verificationCard.innerHTML = `
      <div class="title">
        <h3>Верификации</h3>
        <div class="meta2 mccNavHint">для всех аккаунтов</div>
      </div>
    `;
    const verificationFields = document.createElement('div');

    mccProfile.rows.forEach((rowObj)=>{
      const vBlock = document.createElement('div');
      vBlock.className = 'mccVerificationBlock mccVerificationCard';

      const accLabel = document.createElement('div');
      accLabel.className = 'mccAccountLabel';
      accLabel.textContent = rowObj.accountName || 'Аккаунт';
      vBlock.appendChild(accLabel);

      const row1 = document.createElement('div');
      row1.className = 'field';
      const label1 = document.createElement('div');
      label1.className = 'label';
      label1.textContent = 'Верификация';
      const grid1 = document.createElement('div');
      grid1.className = 'mccInlineGrid2';
      if(mccEditMode){
        grid1.appendChild(mccWrapFieldLabel('T', mccBuildDateInput(rowObj, 'T', rowObj.values.T, {
          onCommit: (iso, flow)=>{
            const prevT = String(flow.prevValue || '').trim();
            const prevU = String(rowObj.values.U || '').trim();
            const updates = { T: iso };
            if(iso && !prevT && !prevU){
              updates.U = 'Взять в работу';
            }
            for(const [col, val] of Object.entries(updates)) rowObj.values[col] = val;
            toast('Сохранение…');
            saveMccCellsInstant(rowObj.row, updates, ()=>{
              syncMccVerificationControls(rowObj, updates);
              flow.done();
              toast('Сохранено');
            }, (err)=>{ flow.fail(); toast(err||'Ошибка'); });
          }
        })));
        grid1.appendChild(mccWrapFieldLabel('AW', mccBuildInput(rowObj, 'AW', rowObj.values.AW)));
      } else {
        grid1.appendChild(mccWrapFieldLabel('T', mccBuildDateInput(rowObj, 'T', rowObj.values.T, {
          onCommit: (iso, flow)=>{
            const prevT = String(flow.prevValue || '').trim();
            const prevU = String(rowObj.values.U || '').trim();
            const updates = { T: iso };
            if(iso && !prevT && !prevU){
              updates.U = 'Взять в работу';
            }
            for(const [col, val] of Object.entries(updates)) rowObj.values[col] = val;
            toast('Сохранение…');
            saveMccCellsInstant(rowObj.row, updates, ()=>{
              syncMccVerificationControls(rowObj, updates);
              flow.done();
              toast('Сохранено');
            }, (err)=>{ flow.fail(); toast(err||'Ошибка'); });
          }
        })));
        grid1.appendChild(mccWrapFieldLabel('AW', mccBuildButton(rowObj.values.AW, 'AW')));
      }
      row1.appendChild(label1);
      row1.appendChild(grid1);
      row1.appendChild(document.createElement('div')).className='actions';
      vBlock.appendChild(row1);

      const row2 = document.createElement('div');
      row2.className = 'field';
      const label2 = document.createElement('div');
      label2.className = 'label';
      label2.textContent = 'Компания';
      const grid2 = document.createElement('div');
      grid2.className = 'mccInlineGrid2';
      if(mccEditMode){
        grid2.appendChild(mccWrapFieldLabel('I', mccBuildInput(rowObj, 'I', rowObj.values.I)));
        grid2.appendChild(mccWrapFieldLabel('S', mccBuildInput(rowObj, 'S', rowObj.values.S)));
      } else {
        grid2.appendChild(mccWrapFieldLabel('I', mccBuildButton(rowObj.values.I, 'I')));
        grid2.appendChild(mccWrapFieldLabel('S', mccBuildButton(rowObj.values.S, 'S')));
      }
      row2.appendChild(label2);
      row2.appendChild(grid2);
      row2.appendChild(document.createElement('div')).className='actions';
      vBlock.appendChild(row2);

      const row3 = document.createElement('div');
      row3.className = 'field';
      const label3 = document.createElement('div');
      label3.className = 'label';
      label3.textContent = 'Статус';
      const grid3 = document.createElement('div');
      grid3.className = 'mccInlineGrid2';

      rowObj.groupName = 'Верификация';
      const uValue = rowObj.values.U ?? '';
      const vValue = rowObj.values.V ?? '';

      const uSelect = mccBuildSelect(rowObj, 'U', uValue, mccProfile.dropdowns?.U, (next)=>{
        handleMccVerificationStatusChange(rowObj, uSelect, vSelect, next);
      }, { group:'Верификация' });
      const vSelect = mccBuildSelect(rowObj, 'V', vValue, mccProfile.dropdowns?.V, ()=>updateMccVerificationPairColors(rowObj), { group:'Верификация' });

      applyMccVerificationColors(uSelect, vSelect, uValue, vValue);
      grid3.appendChild(mccWrapFieldLabel('U', uSelect));
      grid3.appendChild(mccWrapFieldLabel('V', vSelect));

      row3.appendChild(label3);
      row3.appendChild(grid3);
      row3.appendChild(document.createElement('div')).className='actions';
      vBlock.appendChild(row3);

      verificationFields.appendChild(vBlock);
    });

    verificationCard.appendChild(verificationFields);
    shell.appendChild(verificationCard);

    const rechekCard = document.createElement('div');
    rechekCard.className = 'card';
    rechekCard.id = 'mccRechekSection';
    rechekCard.dataset.group = 'Речек';
    rechekCard.innerHTML = `
      <div class="title">
        <h3>Речек</h3>
        <div class="meta2 mccNavHint">по аккаунтам</div>
      </div>
    `;
    const rechekFields = document.createElement('div');

    mccProfile.rows.forEach((rowObj)=>{
      const row = document.createElement('div');
      row.className = 'field';
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = rowObj.accountName || 'Аккаунт';

      const grid = document.createElement('div');
      grid.className = 'mccRechekRow';

      if(mccEditMode){
        grid.appendChild(mccWrapFieldLabel('W', mccBuildDateInput(rowObj, 'W', rowObj.values.W)));
        grid.appendChild(mccWrapFieldLabel('X', mccBuildInput(rowObj, 'X', rowObj.values.X, false, {
          onCommit: (next, flow)=>saveMccRechekExpenseInstant(rowObj, next, flow),
          onPending: (pending)=>logMccRechek_('pendingNextValue', { row: rowObj.row, nextX: pending })
        })));
        grid.appendChild(mccWrapFieldLabel('Y', mccBuildInput(rowObj, 'Y', rowObj.values.Y)));
      } else {
        grid.appendChild(mccWrapFieldLabel('W', mccBuildDateInput(rowObj, 'W', rowObj.values.W)));
        grid.appendChild(mccWrapFieldLabel('X', mccBuildInput(rowObj, 'X', rowObj.values.X, false, {
          onCommit: (next, flow)=>saveMccRechekExpenseInstant(rowObj, next, flow),
          onPending: (pending)=>logMccRechek_('pendingNextValue', { row: rowObj.row, nextX: pending })
        })));
        grid.appendChild(mccWrapFieldLabel('Y', mccBuildButton(rowObj.values.Y, 'Y')));
      }

      rowObj.groupName = 'Речек';
      const zValue = rowObj.values.Z ?? '';
      const zStatus = mccBuildPlusSelectControl(rowObj, 'Z', zValue, mccProfile.dropdowns?.Z, (next)=>applyMccSelectColor(zSelect, 'Z', next), { group:'Речек' });
      const zSelect = zStatus.select;
      applyMccSelectColor(zSelect, 'Z', zValue);
      grid.appendChild(mccWrapFieldLabel('Z', zStatus.wrap));

      row.appendChild(label);
      row.appendChild(grid);
      row.appendChild(document.createElement('div')).className='actions';
      rechekFields.appendChild(row);
    });

    rechekCard.appendChild(rechekFields);
    shell.appendChild(rechekCard);

    updateMccNav();
    updateMccTabsColors();
    applyMccFioVisualMarks();
    mccSetupAccountScrollSpy();
    if(opts.preserveScrollSnapshot) restoreSproutScroll_(opts.preserveScrollSnapshot);
  }

  function logMccRechek_(msg, meta){
    if(!window.SPROUTG_DEBUG) return;
    const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
    console.info(`[SproutG:MCC:Rechek] ${msg}${suffix}`);
  }

  function saveMccRechekExpenseInstant(rowObj, nextValue, flow){
    const nextX = String(nextValue ?? '');
    const hasExpense = !!nextX.trim();
    const prevW = String(rowObj?.values?.W || '').trim();
    const prevZ = String(rowObj?.values?.Z || '').trim();
    const updates = { X: nextX };
    const oldZValue = prevZ;
    const shouldEmitRechekPlus = hasExpense && prevZ !== '+';

    if(hasExpense && !prevW) updates.W = isoTodayByTz('Asia/Ho_Chi_Minh');
    if(hasExpense && prevZ !== '+') updates.Z = '+';

    logMccRechek_('blur X', { row: rowObj?.row, nextX, prevW, prevZ, updates });
    toast('Сохранение…');
    logMccRechek_('queued updateMccCells', { row: rowObj?.row, updates });
    saveMccCellsInstant(rowObj.row, updates, (r)=>{
      const applied = (r?.applied && typeof r.applied === 'object') ? r.applied : updates;
      if(rowObj?.values){
        for(const [col, val] of Object.entries(applied)) rowObj.values[col] = val;
      }
      const wInput = document.querySelector(`#mccOut input[data-row="${rowObj.row}"][data-col="W"]`);
      if(wInput && Object.prototype.hasOwnProperty.call(applied, 'W')) wInput.value = applied.W;
      const zSel = document.querySelector(`#mccOut select[data-row="${rowObj.row}"][data-col="Z"]`);
      if(zSel && Object.prototype.hasOwnProperty.call(applied, 'Z')){
        zSel.value = applied.Z;
        applyMccSelectColor(zSel, 'Z', applied.Z);
      }
      flow.done();
      updateMccTabsColors();
      if(applied.Z === '+' && shouldEmitRechekPlus){
        sproutgEmitStatusEvent('MCC', 'Речек', '+', 'Z', rowObj.row, oldZValue);
      }
      logMccRechek_('confirmed updateMccCells', { row: rowObj?.row, applied });
      toast('Сохранено');
    }, (err)=>{
      flow.fail();
      logMccRechek_('failed updateMccCells', { row: rowObj?.row, updates, error: String(err || '') });
      toast(err||'Ошибка');
    });
  }
  function applyMccVerificationColors(uSelect, vSelect, uValue, vValue){
    uSelect.classList.remove('greenLight','yellowLight','redLight','blueLight');
    vSelect.classList.remove('greenLight','yellowLight','redLight','blueLight');
    const u = String(uValue || '').trim();
    const v = String(vValue || '').trim();

    if(u === 'На рассмотрении'){
      uSelect.classList.add('blueLight');
      if(BAN_RED_VALUES.has(v)) vSelect.classList.add('redLight');
      else if(BAN_YELLOW_VALUES.has(v)) vSelect.classList.add('yellowLight');
      return;
    }
    if(u === 'Взять в работу' || BAN_YELLOW_VALUES.has(u)){
      uSelect.classList.add('yellowLight');
      if(BAN_RED_VALUES.has(v)) vSelect.classList.add('redLight');
      else if(BAN_YELLOW_VALUES.has(v)) vSelect.classList.add('yellowLight');
      return;
    }
    if(u === 'Отказ' || BAN_RED_VALUES.has(u)){
      uSelect.classList.add('redLight');
      if(v === 'Бан аккаунта' || BAN_RED_VALUES.has(v)) vSelect.classList.add('redLight');
      else if(BAN_YELLOW_VALUES.has(v)) vSelect.classList.add('yellowLight');
      return;
    }
    if(u === 'Успешно'){
      uSelect.classList.add('greenLight');
      vSelect.classList.add('greenLight');
      return;
    }
    if(BAN_RED_VALUES.has(v)) vSelect.classList.add('redLight');
    else if(BAN_YELLOW_VALUES.has(v)) vSelect.classList.add('yellowLight');
  }

  // ---------- Utils ----------
  async function copyText(text){
    text=String(text ?? '');
    try{
      await navigator.clipboard.writeText(text);
      toast('Скопировано');
    }catch(e){
      const ta=document.createElement('textarea');
      ta.value=text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      toast('Скопировано');
    }
  }

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g,(c)=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function cssEscape(s){ return String(s||'').replace(/["\\]/g,'\\$&'); }

  function toRuDate(iso){
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return '';
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  function mccToIsoDate(value){
    const v = String(value || '').trim();
    if(!v) return '';
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m) return v;
    m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if(m) return `${m[3]}-${m[2]}-${m[1]}`;
    return '';
  }

  function mccGetLabel(col, opts = {}){
    if(MCC_LABEL_OVERRIDES[col]) return MCC_LABEL_OVERRIDES[col];
    const header = String(mccProfile?.headers?.[col] || '').trim();
    if(header) return header;
    return opts.allowFallback ? col : '';
  }

  function mccIsExpenseCol(col){
    const header = String(mccProfile?.headers?.[col] || '').trim();
    return header === 'Расходы';
  }

  function mccParseExpenseValue(value){
    const raw = String(value || '').trim();
    if(!raw) return null;
    const num = parseFloat(raw.replace('$','').replace(',','.'));
    if(Number.isNaN(num)) return null;
    return num;
  }

  function applyMccExpenseColor(btn, value){
    if(!btn) return;
    btn.classList.remove('greenLight','redLight');
    delete btn.dataset.appcolor;
    const raw = String(value || '').trim();
    if(!raw) return;
    if(raw.replace(/\s+/g,'') === '0.00$'){
      btn.classList.add('redLight');
      btn.dataset.appcolor = '1';
      return;
    }
    const num = mccParseExpenseValue(raw);
    if(num != null && num > 0){
      btn.classList.add('greenLight');
      btn.dataset.appcolor = '1';
    }
  }

  function mccEnsureExpenseDefaults(){
    return;
  }

  function applyMccProxyUserIspColor(btn, rowObj, col){
    if(!btn || !rowObj) return;
    btn.classList.remove('greenLight','redLight');
    const ajVal = String(rowObj.values.AJ ?? '').trim();
    const alVal = String(rowObj.values.AL ?? '').trim();
    const val = String(rowObj.values[col] ?? '').trim();
    if(!val) return;
    if(ajVal === 'ruslanhardhead' && alVal === 'ipv4'){
      btn.classList.add('greenLight');
      return;
    }
    btn.classList.add('redLight');
  }

  function updateProxyFieldsFromServer(mode, row, value){
    if(!row) return;
    const requestRow = row;
    const runner = google.script.run.withSuccessHandler(r=>{
      if(!r || r.ok === false){
        toast(r?.error || 'Ошибка прокси');
        return;
      }
      if(mode === 'O1') applyO1ProxyFields(r.values || {}, requestRow);
      else applyMccProxyFields(r.values || {});
      refreshColors({ source: mode === 'O1' ? 'o1' : 'mcc' });
    }).withFailureHandler(err=>toast(String(err)));
    if(mode === 'O1') runner.updateProxyFromValue(row, value);
    else runner.updateMccProxyFromValue(row, value);
  }

  function applyO1ProxyFields(values, row){
    if(!current || String(current.row || '') !== String(row || '')) return;
    for(const [col, val] of Object.entries(values || {})){
      updateO1FieldValue(col, val);
    }
  }

  function applyMccProxyFields(values){
    if(!mccProfile?.profileRow) return;
    for(const [col, val] of Object.entries(values || {})){
      updateMccFieldValue(col, val);
    }
  }

  function updateO1FieldValue(col, value){
    if(!current) return;
    const targetCol = String(col || '').toUpperCase();
    for(const g of (current.groups || [])){
      for(const f of (g.fields || [])){
        if(String(f.col).toUpperCase() === targetCol){
          f.value = value;
        }
      }
    }
    document.querySelectorAll(`#out [data-row="${current.row}"][data-col="${targetCol}"]`).forEach((el)=>{
      if(el.tagName === 'INPUT' || el.tagName === 'SELECT'){
        el.value = value;
      } else {
        el.textContent = value ?? '';
      }
    });
  }

  function updateMccFieldValue(col, value){
    if(!mccProfile?.profileRow) return;
    const targetCol = String(col || '').toUpperCase();
    mccProfile.profileRow.values[targetCol] = value;
    document.querySelectorAll(`#mccOut .mccProxyCard [data-col="${targetCol}"]`).forEach((el)=>{
      if(el.tagName === 'INPUT' || el.tagName === 'SELECT'){
        el.value = value;
      } else {
        el.textContent = value ?? '';
      }
    });
  }

  function clearMccSectionScrollTimers(){
    for(const t of mccSectionScrollTimers){
      clearTimeout(t);
    }
    mccSectionScrollTimers = [];
  }

  function getMccStickyOffset_(){
    const root = document.documentElement;
    const appHeaderH = parseFloat(getComputedStyle(root).getPropertyValue('--app-header-h')) || 0;
    return appHeaderH + 10;
  }

  function getScrollTopForTarget_(scroller, target, offset){
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return Math.max(0, scroller.scrollTop + (targetRect.top - scrollerRect.top) - (offset || 0));
  }

  function isMccTargetAligned_(scroller, target, offset){
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const diff = targetRect.top - scrollerRect.top - (offset || 0);
    return Math.abs(diff) <= 6;
  }

  function mccScrollToSection(id, opts = {}){
    const scroller = getMccScroller_() || document.getElementById('mainScrollMcc');
    const target = document.getElementById(id);
    if(!scroller || !target) return;

    const seq = ++mccSectionScrollSeq;
    clearMccSectionScrollTimers();
    sproutgProgrammaticScrollUntil = Date.now() + 1000;

    const prefersReducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = opts.behavior || (prefersReducedMotion ? 'auto' : 'smooth');

    function doMeasureAndScroll(pass, scrollBehavior){
      if(seq !== mccSectionScrollSeq) return;
      if(!document.body.contains(target)) return;

      sproutgProgrammaticScrollUntil = Date.now() + 700;
      const offset = getMccStickyOffset_();
      const top = getScrollTopForTarget_(scroller, target, offset);
      scroller.scrollTo({ top, behavior: scrollBehavior || 'auto' });

      if(pass === 0){
        target.classList.add('sgSavePulse');
        setTimeout(()=>target.classList.remove('sgSavePulse'), 650);
      }
    }

    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        if(seq !== mccSectionScrollSeq) return;
        doMeasureAndScroll(0, behavior);
        const correctionDelays = [120, 280, 520];
        for(const delay of correctionDelays){
          const timer = setTimeout(()=>{
            if(seq !== mccSectionScrollSeq) return;
            if(!document.body.contains(target)) return;
            const offset = getMccStickyOffset_();
            if(!isMccTargetAligned_(scroller, target, offset)){
              doMeasureAndScroll(1, 'auto');
            }
          }, delay);
          mccSectionScrollTimers.push(timer);
        }
      });
    });
  }

  function mccWrapFieldLabel(col, fieldEl){
    try{
      const c = String(col || '').toUpperCase();
      const rowNum = String(fieldEl?.dataset?.row || '');
      const rowObj = (mccProfile?.rows || []).find(r=>String(r.row) === rowNum);
      applySheetCellColorHint(fieldEl, rowObj?.bgMap?.[c]);
    }catch(e){}
    const labelText = String(mccGetLabel(col, { allowFallback:true }) || '').trim();
    if(!labelText) return fieldEl;
    const wrap = document.createElement('div');
    wrap.className = 'mccFieldStack';
    const lbl = document.createElement('div');
    lbl.className = 'mccFieldLabel';
    lbl.textContent = labelText;
    lbl.title = labelText;
    wrap.appendChild(lbl);
    wrap.appendChild(fieldEl);
    return wrap;
  }

  function setupO1TopButton(){
    const btn = document.getElementById('o1ToTop');
    const scroller = document.getElementById('mainScrollO1');
    if(!btn || !scroller) return;
    btn.addEventListener('click', ()=>{
      scroller.scrollTo({ top:0, behavior:'smooth' });
    });
    scroller.addEventListener('scroll', updateO1TopButton);
    updateO1TopButton();
  }

  function updateO1TopButton(){
    const cluster = document.getElementById('o1TopCluster');
    const scroller = document.getElementById('mainScrollO1');
    if(!cluster || !scroller) return;
    cluster.classList.toggle('show', scroller.scrollTop > 200 && activePage === 'O1');
  }

  function setupMccTopButton(){
    const btn = document.getElementById('mccToTop');
    const btnVerification = document.getElementById('mccToVerification');
    const btnRechek = document.getElementById('mccToRechek');
    const scroller = document.getElementById('mainScrollMcc');
    if(!btn || !scroller) return;
    if(btn.dataset.boundMccScroll !== '1'){
      btn.dataset.boundMccScroll = '1';
      btn.addEventListener('click', (e)=>{
        e.preventDefault();
        const localScroller = getMccScroller_() || document.getElementById('mainScrollMcc');
        if(!localScroller) return;
        ++mccSectionScrollSeq;
        clearMccSectionScrollTimers();
        sproutgProgrammaticScrollUntil = Date.now() + 800;
        localScroller.scrollTo({ top:0, behavior:'smooth' });
      });
    }
    if(btnVerification && btnVerification.dataset.boundMccScroll !== '1'){
      btnVerification.dataset.boundMccScroll = '1';
      btnVerification.addEventListener('click', (e)=>{
        e.preventDefault();
        mccScrollToSection('mccVerificationSection');
      });
    }
    if(btnRechek && btnRechek.dataset.boundMccScroll !== '1'){
      btnRechek.dataset.boundMccScroll = '1';
      btnRechek.addEventListener('click', (e)=>{
        e.preventDefault();
        mccScrollToSection('mccRechekSection');
      });
    }
    if(scroller.dataset.boundMccScroll !== '1'){
      scroller.dataset.boundMccScroll = '1';
      scroller.addEventListener('scroll', updateMccTopButton);
    }
    updateMccTopButton();
  }

  function updateMccTopButton(){
    const cluster = document.getElementById('mccTopCluster');
    const scroller = document.getElementById('mainScrollMcc');
    if(!cluster || !scroller) return;
    cluster.classList.toggle('show', scroller.scrollTop > 200 && activePage === 'MCC');
  }



  function getTheme(){
    const root = document.documentElement;
    const t = THEME_ALIASES[root.getAttribute('data-theme')] || root.getAttribute('data-theme');
    return THEMES.includes(t) ? t : 'dark-classic';
  }

  function updateThemeButtons(){
    const theme = getTheme();
    document.querySelectorAll('[data-theme-choice]').forEach((btn)=>{
      btn.classList.toggle('btnPrimary', btn.dataset.themeChoice === theme);
    });
  }

  function getThemeColorsFromCss(){
    const css = getComputedStyle(document.documentElement);
    return {
      topbarColor: css.getPropertyValue('--topbar-bg').trim() || '#0b1220',
      topbarTextColor: css.getPropertyValue('--topbar-fg').trim() || '#ffffff'
    };
  }

  function sproutgPostToDesktop(type, payload){
    if(window.SproutGDesktopBridge?.post){
      window.SproutGDesktopBridge.post(type, payload);
      return;
    }
    const msg = { source:'sproutg-web', type, payload };
    const target = (window.top && window.top !== window) ? window.top : window;
    try{ target.postMessage(msg, '*'); } catch(e){ try{ window.postMessage(msg, '*'); }catch(_){} }
  }

  function sendThemeColorsToDesktop(){
    const payload = getThemeColorsFromCss();
    payload.theme = getTheme();
    sproutgPostToDesktop('THEME_COLORS', payload);
  }

  function setTheme(theme, opts = {}){
    const nextRaw = THEME_ALIASES[String(theme || '')] || String(theme || '');
    const next = THEMES.includes(nextRaw) ? nextRaw : 'dark-classic';
    if(document.documentElement.getAttribute('data-theme') === next){
      updateThemeButtons();
      return;
    }
    document.documentElement.classList.add('theme-switching');
    document.documentElement.setAttribute('data-theme', next);
    clearTimeout(__themeSwitchTimer);
    __themeSwitchTimer = setTimeout(() => document.documentElement.classList.remove('theme-switching'), 140);
    if(opts.persist !== false){
      try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
    }
    updateThemeButtons();
    requestAnimationFrame(updateAppHeaderHeight);
    sendThemeColorsToDesktop();
    if(opts.notifyDesktop){
      const status = document.getElementById('desktopIntegrationStatus');
      if(status) status.textContent = `Тема применена локально: ${next}.`;
    }
  }

  function initTheme(){
    const saved = (localStorage.getItem(THEME_KEY) || '').trim();
    setTheme(THEME_ALIASES[saved] || saved || 'dark-classic', { persist:false });
    const meta = document.getElementById('settingsMeta');
    if(meta) meta.textContent = '';
    updateCompanyMeta();
  }

  function updateCompanyMeta(){
    const meta = document.getElementById('companyMeta');
    if(meta) meta.textContent = '';
  }

  function setCompanyError(msg){
    const el = document.getElementById('companyErr');
    if(el) el.textContent = msg || '';
  }

  function getCompanyInputs(){
    return Array.from(document.querySelectorAll('#companyFormGrid input[data-company-col]'));
  }

  function validateCompanyValues(values){
    const clean = (Array.isArray(values) ? values : []).map(v=>String(v || '').trim());
    if(clean.length !== 6) return { ok:false, error:'Нужно заполнить 6 полей' };
    if(clean.some(v=>!v)) return { ok:false, error:'Все 6 полей обязательны' };
    if(companyDuplicateState.duplicate && companyDuplicateState.value === clean[0].toLowerCase()){
      return { ok:false, error:'Компания с таким значением в колонке A уже существует' };
    }
    if(!/^EE\d{9}$/.test(clean[4])) return { ok:false, error:'Колонка E: формат EE + 9 цифр' };
    if(!/^\d{9}$/.test(clean[5])) return { ok:false, error:'Колонка F: ровно 9 цифр' };
    return { ok:true, values: clean };
  }

  function openCompanyForm(){
    setCompanyError('');
    const wrap = document.getElementById('companyFormWrap');
    const grid = document.getElementById('companyFormGrid');
    if(!wrap || !grid) return;
    if(companyFormMeta?.headers?.length === 6){
      renderCompanyInputs(companyFormMeta.headers);
      wrap.style.display = '';
      return;
    }
    google.script.run.withSuccessHandler((res)=>{
      if(!res || res.ok===false){ setCompanyError(res?.error || 'Ошибка загрузки формы'); return; }
      companyFormMeta = res;
      renderCompanyInputs(res.headers || []);
      wrap.style.display = '';
    }).withFailureHandler((err)=>setCompanyError(String(err))).getCompanyFormMeta();
  }

  function renderCompanyInputs(headers){
    const grid = document.getElementById('companyFormGrid');
    if(!grid) return;
    grid.innerHTML = '';
    for(let i=0;i<6;i++){
      const row = document.createElement('div');
      row.className = 'field';
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = String(headers?.[i] || String.fromCharCode(65+i));
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'value';
      inp.dataset.companyCol = String.fromCharCode(65+i);
      if(i === 0){
        inp.addEventListener('input', ()=>scheduleCompanyDuplicateCheck(inp));
      }
      row.appendChild(l);
      row.appendChild(inp);
      row.appendChild(document.createElement('div')).className = 'actions';
      grid.appendChild(row);
    }
  }

  function scheduleCompanyDuplicateCheck(inp){
    clearTimeout(companyDuplicateTimer);
    const value = String(inp?.value || '').trim();
    companyDuplicateState = { value: value.toLowerCase(), duplicate: false, checking: !!value };
    setCompanyError('');
    const submit = document.getElementById('companySubmitBtn');
    if(submit) submit.disabled = false;
    if(!value) return;
    companyDuplicateTimer = setTimeout(()=>{
      const expected = String(inp.value || '').trim();
      if(!expected) return;
      google.script.run.withSuccessHandler((res)=>{
        const currentValue = String(inp.value || '').trim().toLowerCase();
        if(currentValue !== expected.toLowerCase()) return;
        if(!res || res.ok === false){
          setCompanyError(res?.error || 'Ошибка проверки компании');
          return;
        }
        companyDuplicateState = { value: currentValue, duplicate: !!res.duplicate, checking: false };
        if(res.duplicate){
          setCompanyError(`Компания уже есть в колонке A${res.row ? `, строка ${res.row}` : ''}`);
          const btn = document.getElementById('companySubmitBtn');
          if(btn) btn.disabled = true;
        }
      }).withFailureHandler((err)=>setCompanyError(String(err))).checkCompanyDuplicate(expected);
    }, 260);
  }

  function submitCompanyForm(){
    setCompanyError('');
    const inputs = getCompanyInputs();
    const values = inputs.map(i=>String(i.value || '').trim());
    const vr = validateCompanyValues(values);
    if(!vr.ok){ setCompanyError(vr.error); return; }
    google.script.run.withSuccessHandler((res)=>{
      if(!res || res.ok===false){ setCompanyError(res?.error || 'Ошибка сохранения'); return; }
      toast('Компания добавлена');
      inputs.forEach(i=>{ i.value = ''; });
    }).withFailureHandler((err)=>setCompanyError(String(err))).addCompanyRow(vr.values);
  }

  function setupDesktopIntegration(){
    if(window.SproutGDesktopBridge) return;
    window.SproutGDesktopBridge = (function(){
      const state = { isDesktop:false, lastSettings:null, readySent:false };
      function post(type, payload){
        const msg = { source:'sproutg-web', type, payload };
        const target = (window.top && window.top !== window) ? window.top : window;
        try { target.postMessage(msg, '*'); }
        catch(e){ try { window.postMessage(msg, '*'); } catch(_){} }
      }
      function sendReady(){
        if(state.readySent) return;
        state.readySent = true;
        post('READY', { appVersion: APP_VERSION, theme: getTheme ? getTheme() : '', ts: Date.now() });
      }
      function handleMessage(event){
        const data = event?.data;
        if(!data || data.source !== 'sproutg-desktop') return;
        state.isDesktop = true;
        document.documentElement.classList.add('is-desktop');
        if(data.type === 'PING'){
          sendThemeColorsToDesktop();
          post('PONG', { ts: Date.now(), appVersion: APP_VERSION });
          sendReady();
          return;
        }
        if(data.type !== 'SETTINGS') return;
        const payload = data.payload || {};
        state.lastSettings = payload;
        const theme = THEME_ALIASES[payload.theme] || payload.theme;
        if(THEMES.includes(theme)){
          setTheme(theme, { persist:true, notifyDesktop:true });
          sendThemeColorsToDesktop();
        }
        const status = document.getElementById('desktopIntegrationStatus');
        if(status){
          status.textContent = `Получены SETTINGS от Desktop: theme=${payload.theme || '—'}, zoom=${payload.zoom ?? '—'}, alwaysOnTop=${payload.alwaysOnTop ?? '—'}`;
        }
      }
      window.addEventListener('message', handleMessage);
      document.addEventListener('DOMContentLoaded', ()=>setTimeout(sendReady, 80));
      setTimeout(sendReady, 120);
      return { state, post, sendReady };
    })();
    sendThemeColorsToDesktop();
  }


  function normalizeStatusValue(value){
    return String(value ?? '')
      .replace(/\u00A0/g, ' ')
      .trim();
  }

  function sproutgPostStatusEvent(payload){
    const msg = { source:'sproutg-desktop', type:'STATUS_EVENT', payload };
    const target = (window.top && window.top !== window) ? window.top : window;
    try{
      target.postMessage(msg, '*');
    }catch(e){
      try{ window.postMessage(msg, '*'); }catch(_){ }
    }
  }


  function sproutgEmitStatusEvent(page, group, newValue, col, row, oldValue){
    const normalizedPage = page === 'MCC' ? 'MCC' : (page === 'O1' ? 'O1' : '');
    const normalizedGroup = String(group || '').trim();
    if(!normalizedPage || !normalizedGroup) return;
    const normalizedCol = String(col || '').trim().toUpperCase();
    const normalizedNewValue = normalizeStatusValue(newValue);
    const normalizedOldValue = normalizeStatusValue(oldValue);
    if(normalizedNewValue === normalizedOldValue) return;
    const payload = {
      page: normalizedPage,
      group: normalizedGroup,
      value: normalizedNewValue,
      newValue: normalizedNewValue,
      oldValue: normalizedOldValue,
      ts: Date.now()
    };
    if(normalizedCol) payload.col = normalizedCol;
    if(Number.isFinite(Number(row))) payload.row = Number(row);
    sproutgPostStatusEvent(payload);
    console.log('[SproutG] STATUS_EVENT sent', { source: 'sproutg-desktop', type: 'STATUS_EVENT', payload });
  }

  function normOpt(s){
    return String(s ?? '')
      .replace(/\u00A0/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .toLowerCase();
  }

  initPageSelection();


