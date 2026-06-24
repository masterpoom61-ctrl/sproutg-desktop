const { app, BrowserWindow, ipcMain, Menu, session, screen, globalShortcut, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const { BridgeManager } = require('./main/bridgeManager');
const { registerApiIpc } = require('./main/apiIpc');

const TOPBAR_HEIGHT = 38;
const PARTITION = 'persist:sproutg';
const MIN_WIDTH = 420;   // allow 9:16 portrait-like
const MIN_HEIGHT = 560;

const store = new Store({
  name: 'sproutg-desktop',
  defaults: {
    ui: { statsBounds: null, companyBounds: null },
    points: { days: {}, workDays: {} },
    statusState: {},
    settings: { theme: 'dark-classic', zoom: 1.0, alwaysOnTop: false, graphicsMode: 'ultra', contrastMode: false, classicTrafficLights: false },
    window: { bounds: null, isMaximized: false },
    web: { url: null }
  }
});

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function normalizeWebUrl(input){
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return `https://script.google.com/macros/s/${raw}/exec`;
  return null;
}

function readConfig(){
  const cfg = { webUrl: null, openDevTools: false, updates: {} };

  const userCfg = path.join(app.getPath('userData'), 'sproutg.config.json');
  const appCfg  = path.join(app.getAppPath(), 'sproutg.config.json');
  for (const p of [appCfg, userCfg]) {
    try {
      if (fs.existsSync(p)) {
        const fileCfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        cfg.webUrl = fileCfg.webUrl || fileCfg.url || cfg.webUrl;
        cfg.openDevTools = !!fileCfg.openDevTools;
        cfg.updates = { ...(cfg.updates || {}), ...(fileCfg.updates || {}) };
      }
    } catch(e) {}
  }

  const stored = store.get('web.url');
  if (stored) cfg.webUrl = stored;

  if (process.env.SPROUTG_WEB_URL && String(process.env.SPROUTG_WEB_URL).trim()) {
    cfg.webUrl = String(process.env.SPROUTG_WEB_URL).trim();
  }
  if (process.env.SPROUTG_UPDATE_OWNER && String(process.env.SPROUTG_UPDATE_OWNER).trim()) {
    cfg.updates.owner = String(process.env.SPROUTG_UPDATE_OWNER).trim();
  }
  if (process.env.SPROUTG_UPDATE_REPO && String(process.env.SPROUTG_UPDATE_REPO).trim()) {
    cfg.updates.repo = String(process.env.SPROUTG_UPDATE_REPO).trim();
  }
  if (process.env.SPROUTG_UPDATE_CHANNEL && String(process.env.SPROUTG_UPDATE_CHANNEL).trim()) {
    cfg.updates.channel = String(process.env.SPROUTG_UPDATE_CHANNEL).trim();
  }

  return cfg;
}

function isRectVisible(bounds){
  const displays = screen.getAllDisplays();
  return displays.some(d => {
    const wa = d.workArea;
    return (
      bounds.x < wa.x + wa.width &&
      bounds.x + bounds.width > wa.x &&
      bounds.y < wa.y + wa.height &&
      bounds.y + bounds.height > wa.y
    );
  });
}

function sanitizeBounds(bounds){
  if (!bounds || typeof bounds !== 'object') return null;
  const w = clamp(bounds.width || 1200, MIN_WIDTH, 2600);
  const h = clamp(bounds.height || 800,  MIN_HEIGHT, 1800);
  const x = Number.isFinite(bounds.x) ? bounds.x : 0;
  const y = Number.isFinite(bounds.y) ? bounds.y : 0;
  const normalized = { x, y, width: w, height: h };

  if (isRectVisible(normalized)) return normalized;

  const primary = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(primary.x + (primary.width - w) / 2),
    y: Math.round(primary.y + (primary.height - h) / 2),
    width: w, height: h
  };
}

let mainWindow = null;
let bridgeManager = null;
let settingsWindow = null;
let statsWindow = null;
let companyWindow = null;
let urlWindow = null;
let bridgeLoginWindow = null;
let ses = null;
let lastSettingsClosedAt = 0;
let isQuitting = false;

function getSession(){
  if (!ses) ses = session.fromPartition(PARTITION);
  return ses;
}

async function flushGoogleSession(){
  try { await getSession().cookies.flushStore(); } catch(e) {}
}

const UPDATE_PLACEHOLDER_RE = /^(CHANGE_ME|YOUR_|OWNER_|REPO_|example$)/i;
let updaterConfigured = false;
let updaterCheckInFlight = false;
let updateReminderTimer = null;
let updateState = {
  status: 'idle',
  message: 'Обновления еще не проверялись',
  version: app.getVersion(),
  availableVersion: null,
  downloaded: false,
  progress: null,
  error: null,
  isPackaged: app.isPackaged
};
let updateCheckMode = 'manual';

function isPlaceholderValue(v){
  const raw = String(v || '').trim();
  return !raw || UPDATE_PLACEHOLDER_RE.test(raw);
}

function getUpdatesConfig(){
  const cfg = readConfig();
  const updates = { ...(cfg.updates || {}) };
  return {
    enabled: updates.enabled !== false,
    provider: updates.provider || 'github',
    owner: String(updates.owner || '').trim(),
    repo: String(updates.repo || '').trim(),
    channel: updates.channel || 'latest',
    private: !!updates.private,
    autoCheckOnStart: updates.autoCheckOnStart !== false,
    allowPrerelease: !!updates.allowPrerelease
  };
}

const THEME_ALIASES = {
  dark: 'dark-classic',
  light: 'light-classic',
  'dark-classic': 'dark-classic',
  'light-classic': 'light-classic',
  'dark-ios': 'dark-ios',
  'light-ios': 'light-ios',
  'dark-oldmoney': 'dark-oldmoney',
  'light-oldmoney': 'light-oldmoney',
  'dark-midnight-pro': 'dark-midnight-pro',
  'light-midnight-pro': 'light-midnight-pro',
  'midnight-pro': 'dark-midnight-pro',
  'dark-forest': 'dark-forest',
  'light-forest': 'light-forest',
  forest: 'dark-forest',
  cyberpunk: 'cyberpunk',
  'cyberpunk-neon': 'cyberpunk',
  'nordic-frost': 'nordic-frost',
  'coffee-sepia': 'coffee-sepia',
  'retro-terminal': 'retro-terminal',
  synthwave: 'synthwave',
  vaporwave: 'vaporwave',
  'dark-academia': 'dark-academia',
  'light-academia': 'light-academia',
  'art-deco': 'art-deco',
  bauhaus: 'bauhaus',
  'graphite-pro': 'graphite-pro',
  obsidian: 'obsidian',
  'slate-blue': 'slate-blue',
  'platinum-light': 'platinum-light',
  'notion-clean': 'notion-clean',
  'linear-dark': 'linear-dark',
  'royal-navy': 'royal-navy',
  'emerald-gold': 'emerald-gold',
  'burgundy-club': 'burgundy-club',
  caviar: 'caviar',
  'paper-white': 'paper-white',
  'milk-glass': 'milk-glass',
  'deep-space': 'deep-space',
  'tokyo-night': 'tokyo-night',
  aurora: 'aurora',
  'rainy-day': 'rainy-day',
  terracotta: 'terracotta',
  blueprint: 'blueprint',
  swiss: 'swiss',
  executive: 'executive',
  'banking-green': 'banking-green',
  marble: 'marble',
  typewriter: 'typewriter',
  'amber-terminal': 'amber-terminal',
  mountain: 'mountain'
};

function normalizeTheme(theme){
  return THEME_ALIASES[String(theme || '').trim()] || 'dark-classic';
}

function broadcastUpdateState(){
  const payload = { ...updateState, version: app.getVersion(), isPackaged: app.isPackaged };
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sproutg:update-state', payload); } catch(e) {}
  try { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('sproutg:update-state', payload); } catch(e) {}
}

function sendDesktopNotice(payload){
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sproutg:notice', payload); } catch(e) {}
}

function notifyUpdateAvailable(version){
  const clean = String(version || '').replace(/^v/i, '');
  const title = 'Доступно обновление SproutG';
  const body = clean ? `Новая версия v${clean}. Установить можно в Настройках.` : 'Новая версия доступна в Настройках.';
  sendDesktopNotice({ type:'update', title, body, durationMs: 60000, dismissible: true });
  try {
    if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  } catch(e) {}
}

function currentBootKey(){
  const bootMs = Date.now() - Math.round(os.uptime() * 1000);
  return String(Math.floor(bootMs / 60000));
}

function broadcastBridgeState(state){
  const payload = state || (bridgeManager ? bridgeManager.getState() : { status:'idle', ready:false });
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sproutg:bridge-state', payload); } catch(e) {}
  try { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('sproutg:bridge-state', payload); } catch(e) {}
}

function setUpdateState(patch){
  updateState = { ...updateState, ...(patch || {}), version: app.getVersion(), isPackaged: app.isPackaged };
  broadcastUpdateState();
  return updateState;
}

function configureAutoUpdater(){
  if (updaterConfigured) return true;
  const cfg = getUpdatesConfig();

  if (!cfg.enabled) {
    setUpdateState({ status: 'disabled', message: 'Обновления отключены в конфиге', error: null });
    return false;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = cfg.allowPrerelease;
  if (cfg.channel) autoUpdater.channel = cfg.channel;

  if (cfg.provider === 'github' && !isPlaceholderValue(cfg.owner) && !isPlaceholderValue(cfg.repo)) {
    const feed = { provider: 'github', owner: cfg.owner, repo: cfg.repo, private: cfg.private };
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) feed.token = token;
    autoUpdater.setFeedURL(feed);
  }

  updaterConfigured = true;
  return true;
}

autoUpdater.on('checking-for-update', () => {
  setUpdateState({ status: 'checking', message: 'Проверяем обновления...', error: null, progress: null });
});

autoUpdater.on('update-available', (info) => {
  const availableVersion = info?.version || null;
  setUpdateState({
    status: 'available',
    message: ('Доступно обновление: v' + String(availableVersion || '').replace(/^v/i, '')).trim(),
    availableVersion,
    updateInfo: info || null,
    downloaded: false,
    error: null,
    progress: null
  });
  if (updateCheckMode === 'boot' || updateCheckMode === 'scheduled') notifyUpdateAvailable(availableVersion);
});

autoUpdater.on('update-not-available', (info) => {
  const installed = 'v' + String(app.getVersion()).replace(/^v/i, '');
  setUpdateState({
    status: 'not-available',
    message: 'Установлена последняя версия: ' + installed,
    availableVersion: info?.version || null,
    downloaded: false,
    error: null,
    progress: null
  });
});

autoUpdater.on('download-progress', (p) => {
  const percent = Math.round(Number(p?.percent || 0));
  setUpdateState({ status: 'downloading', message: 'Скачивание обновления... ' + percent + '%', progress: p || null, error: null });
});

autoUpdater.on('update-downloaded', (info) => {
  const availableVersion = info?.version || updateState.availableVersion || '';
  const v = 'v' + String(availableVersion).replace(/^v/i, '');
  setUpdateState({ status: 'downloaded', message: 'Обновление ' + v + ' загружено и готово к установке', availableVersion, downloaded: true, progress: null, error: null });
});

autoUpdater.on('error', (err) => {
  const msg = err?.message || String(err || 'Неизвестная ошибка обновления');
  setUpdateState({ status: 'error', message: 'Ошибка обновления', error: msg, progress: null });
});

async function checkForUpdates(manual, mode){
  if (!app.isPackaged) {
    return setUpdateState({ status: 'dev', message: 'Проверка обновлений работает только в установленной Windows-сборке', error: null });
  }
  if (updaterCheckInFlight) return updateState;
  if (!configureAutoUpdater()) return updateState;

  updaterCheckInFlight = true;
  updateCheckMode = mode || (manual ? 'manual' : 'boot');
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    if (manual) setUpdateState({ status: 'error', message: 'Не удалось проверить обновления', error: e?.message || String(e) });
  } finally {
    updaterCheckInFlight = false;
    updateCheckMode = 'manual';
  }
  return updateState;
}

function scheduleBootUpdateNoticeCheck(){
  if (!app.isPackaged) return;
  const cfg = getUpdatesConfig();
  if (!cfg.enabled) return;
  const bootKey = currentBootKey();
  const last = store.get('updates.lastBootNoticeCheck');
  if (last === bootKey) return;
  store.set('updates.lastBootNoticeCheck', bootKey);
  setTimeout(() => { checkForUpdates(false, 'boot').catch(() => {}); }, 12000);
}

function schedulePeriodicUpdateChecks(){
  if (!app.isPackaged || updateReminderTimer) return;
  const cfg = getUpdatesConfig();
  if (!cfg.enabled) return;
  updateReminderTimer = setInterval(() => {
    checkForUpdates(false, 'scheduled').catch(() => {});
  }, 60 * 60 * 1000);
}

async function downloadUpdate(){
  if (!app.isPackaged) return checkForUpdates(true);
  if (!configureAutoUpdater()) return updateState;
  try {
    setUpdateState({ status: 'downloading', message: 'Начинаю скачивание обновления…', error: null });
    await autoUpdater.downloadUpdate();
  } catch (e) {
    setUpdateState({ status: 'error', message: 'Не удалось скачать обновление', error: e?.message || String(e), progress: null });
  }
  return updateState;
}

function installDownloadedUpdate(){
  if (!app.isPackaged) return setUpdateState({ status: 'dev', message: 'Установка обновлений доступна только в установленной сборке Windows' });
  if (!updateState.downloaded) return setUpdateState({ status: updateState.status || 'idle', message: 'Сначала скачай обновление' });
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    return setUpdateState({ status: 'error', message: 'Не удалось установить обновление', error: e?.message || String(e) });
  }
  return updateState;
}

function normalizeSettings(input){
  const raw = input && typeof input === 'object' ? input : {};
  const next = {
    theme: normalizeTheme(raw.theme),
    zoom: clamp(Number(raw.zoom || 1), 0.7, 1.6),
    alwaysOnTop: !!raw.alwaysOnTop,
    graphicsMode: raw.graphicsMode === 'lite' ? 'lite' : 'ultra',
    contrastMode: !!raw.contrastMode,
    classicTrafficLights: !!raw.classicTrafficLights
  };
  if (next.graphicsMode === 'lite' && next.theme !== 'dark-classic' && next.theme !== 'light-classic') {
    next.theme = 'dark-classic';
  }
  return next;
}

function getSettings(){
  const settings = store.get('settings') || {};
  const next = normalizeSettings(settings);
  if (JSON.stringify(settings) !== JSON.stringify(next)) store.set('settings', next);
  return next;
}
function clampToWorkArea(bounds){
  try{
    const { screen } = require('electron');
    const display = screen.getDisplayNearestPoint({ x: bounds.x ?? 0, y: bounds.y ?? 0 });
    const wa = display.workArea; // {x,y,width,height}
    const w = bounds.width ?? 640;
    const h = bounds.height ?? 520;
    let x = (bounds.x ?? wa.x) ;
    let y = (bounds.y ?? wa.y) ;
    // clamp within work area with a small margin
    const margin = 8;
    x = Math.min(Math.max(x, wa.x + margin), wa.x + wa.width - w - margin);
    y = Math.min(Math.max(y, wa.y + margin), wa.y + wa.height - h - margin);
    return { x, y, width: w, height: h };
  } catch(e){
    return bounds;
  }
}

function getPoints(){
  const p = store.get('points') || { days: {}, workDays: {} };
  if (!p.days) p.days = {};
  if (!p.workDays) p.workDays = {};
  return p;
}

function getStoredStatsBounds(){
  const ui = store.get('ui') || {};
  return ui.statsBounds || null;
}

function setStoredStatsBounds(bounds){
  const ui = store.get('ui') || {};
  ui.statsBounds = { x: bounds.x, y: bounds.y };
  store.set('ui', ui);
}

function getStoredCompanyBounds(){
  const ui = store.get('ui') || {};
  const bounds = ui.companyBounds || null;
  if (bounds && !bounds.compactV && Number(bounds.height || 0) > 334) {
    return { ...bounds, height: 334 };
  }
  return bounds;
}

function setStoredCompanyBounds(bounds){
  if (!bounds) return;
  const ui = store.get('ui') || {};
  ui.companyBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, compactV: 1 };
  store.set('ui', ui);
}

let cachedAppBytes = null;

function fileOrDirSizeSafe(target, depth = 0){
  if (!target || depth > 16) return 0;
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return 0;
    if (stat.isFile()) return stat.size || 0;
    if (!stat.isDirectory()) return 0;
    let total = 0;
    for (const name of fs.readdirSync(target)) {
      total += fileOrDirSizeSafe(path.join(target, name), depth + 1);
    }
    return total;
  } catch(e) {
    return 0;
  }
}

function getStorageInfo(){
  const userData = app.getPath('userData');
  const cacheDirs = [
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnCache',
    'ShaderCache',
    'Partitions'
  ];
  const cacheBytes = cacheDirs.reduce((sum, name) => sum + fileOrDirSizeSafe(path.join(userData, name)), 0);
  if (cachedAppBytes === null) {
    cachedAppBytes = fileOrDirSizeSafe(app.getAppPath());
  }
  return {
    cacheBytes,
    appBytes: cachedAppBytes,
    userData
  };
}

function setPoints(points){
  store.set('points', points);
  return points;
}

function dateKeyFromTs(ts){
  const d = new Date(Number(ts) || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function normalizeText(v){
  return String(v || '').trim().toLowerCase().replace(/\s+/g,' ');
}

function getStatusState(){
  return store.get('statusState') || {};
}
function setStatusState(state){
  store.set('statusState', state || {});
  return state;
}

function normalizeValue(v){
  return String(v ?? '').replace(/\u00A0/g,' ').trim();
}

function makeStateKey(payload){
  const explicit = String(payload?.dedupeKey || payload?.eventId || '').trim();
  if (explicit) return explicit;
  const page = String(payload?.page || '').toUpperCase();
  const group = normalizeText(payload?.group);
  const col = String(payload?.col || '').trim().toUpperCase();
  const row = String(payload?.row ?? '').trim();
  const action = normalizeText(payload?.action || payload?.event || payload?.kind || '');
  const profile = normalizeText(payload?.profile || payload?.account || payload?.accountId || payload?.profileId || '');
  const dateRef = normalizeText(payload?.date || payload?.day || '');
  return page + '|' + group + '|' + col + '|' + row + '|' + action + '|' + profile + '|' + dateRef;
}

function useV202Rules(payload){
  const key = dateKeyFromTs(payload?.ts || Date.now());
  return key >= '2026-06-01';
}

function classifyWork(payload, valueRaw){
  const pageN = String(payload?.page || '').toUpperCase();
  const group = payload?.group;
  const grp = normalizeText(group);
  const vRaw = normalizeValue(valueRaw);
  const v = normalizeText(vRaw);
  const actionText = normalizeText(payload?.action || payload?.event || payload?.kind || '');
  const isAppealAction = actionText.includes('апел') && (actionText.includes('готов') || actionText.includes('done') || actionText.includes('complete'));

  const plus = vRaw.trim() === '+';
  const isSuccess = v === 'успешно';
  const isReject  = v === 'отказ';
  const isNumC = /номер\s*[сc]\s*(1|2)/i.test(vRaw);
  const isMini = grp.includes('мини');
  const isAppeal = grp.includes('апел');
  const isAccMcc = (pageN === 'MCC' && grp.includes('аккаунт') && grp.includes('mcc'));
  const v202 = useV202Rules(payload);
  const verificationSuccessPoints = v202 ? 40 : 50;
  const verificationRejectPoints = v202 ? 0 : 10;
  const mccPlusPoints = v202 ? 80 : 100;

  if (pageN === 'O1'){
    if (grp.includes('аккаунт') && isNumC) return { type: 'Аккаунт (O1)', points: 60, clicks: 1 };
    if (grp.includes('ads') && grp.includes('видео') && plus) return { type: 'Ads Видео (O1)', points: 25, clicks: 1 };
    if (grp.includes('платеж') && plus) return { type: 'Платежка (O1)', points: 50, clicks: 1 };
    if (grp.includes('речек') && plus) return { type: 'Речек (O1)', points: 10, clicks: 1 };
    if ((grp === 'рк' || grp.includes(' рк') || grp.includes('рк ')) && plus) return { type: 'РК (O1)', points: 20, clicks: 1 };
    if (grp.includes('вериф') && (isSuccess || isReject)) return { type: 'Верификации (O1+MCC)', points: (isSuccess ? verificationSuccessPoints : verificationRejectPoints), clicks: isSuccess ? 1 : (v202 ? 0 : 1) };
    if ((isAppeal && plus) || isAppealAction) return { type: 'Апелляции O1', points: 25, clicks: 1 };
    if (isMini && plus) return { type: 'Мини (O1+MCC)', points: 25, clicks: 1 };
  }

  if (pageN === 'MCC'){
    if (isAccMcc){
      if (plus) return { type: 'Аккаунт MCC (MCC)', points: mccPlusPoints, clicks: 1 };
      if (v === 'вышел') return { type: 'Аккаунт MCC (MCC)', points: 50, clicks: 1 };
      if (v.replace(/\s+/g,'') === 'вышел/невышел' || v === 'вышел/не вышел' || v === 'не вышел') return { type: 'Аккаунт MCC (MCC)', points: 25, clicks: 1 };
    }
    if (grp.includes('речек') && plus) return { type: 'Речек (MCC)', points: 10, clicks: 1 };
    if (grp.includes('вериф') && (isSuccess || isReject)) return { type: 'Верификации (O1+MCC)', points: (isSuccess ? verificationSuccessPoints : verificationRejectPoints), clicks: isSuccess ? 1 : (v202 ? 0 : 1) };
    if ((isAppeal && plus) || isAppealAction) return { type: 'Апелляции MCC', points: 25, clicks: 1 };
    if (isMini && plus) return { type: 'Мини (O1+MCC)', points: 25, clicks: 1 };
  }

  return null;
}

function scoreFor(payload, value){
  const info = classifyWork(payload, value);
  if (!info) return { points: 0, clicks: 0, type: null };
  return { points: Number(info.points||0), clicks: Number(info.clicks||0), type: info.type || null };
}

function applyEventWithAntiCheat(payload){
  if (!payload || typeof payload !== 'object') return null;

  if (typeof payload.delta === 'number' && payload.delta !== 0) {
    return { deltaPoints: payload.delta, deltaClicks: 0, newScore: { type: payload.key || 'custom' }, oldScore: { type: payload.key || 'custom' } };
  }

  const key = makeStateKey(payload);
  const state = getStatusState();

  const newValue = normalizeValue(payload.newValue ?? payload.value ?? '');
  const oldValueFromPayload = (payload.oldValue !== undefined) ? normalizeValue(payload.oldValue) : null;
  const prevValue = (oldValueFromPayload !== null) ? oldValueFromPayload : normalizeValue(state[key] ?? '');

  state[key] = newValue;
  setStatusState(state);

  const newScore = scoreFor(payload, newValue);
  const oldScore = scoreFor(payload, prevValue);

  let deltaPoints = newScore.points - oldScore.points;
  let deltaClicks = newScore.clicks - oldScore.clicks;

  // Exception: MCC Account MCC + -> Вышел should NOT subtract 100
  try{
    const pageN = String(payload.page || '').toUpperCase();
    const grp = normalizeText(payload.group);
    const oldV = normalizeValue(prevValue);
    const newVn = normalizeText(newValue);
    const isAccMcc = (pageN === 'MCC' && grp.includes('аккаунт') && grp.includes('mcc'));
    if (isAccMcc && oldV.trim() === '+' && newVn === 'вышел'){
      deltaPoints = newScore.points;
      deltaClicks = newScore.clicks;
    }
  }catch(e){}

  
// Work-clicks: count not only new completions, but also upgrades/downgrades between scoring states.
// This fixes cases like "Отказ -> Успешно" where points change but clicks stayed 0.
if (deltaClicks === 0 && deltaPoints !== 0) {
  const ns = newScore || {};
  const os = oldScore || {};
  if ((ns.clicks||0) > 0 && (os.clicks||0) > 0) {
    deltaClicks = deltaPoints > 0 ? 1 : -1;
  }
}

  if (deltaPoints === 0 && deltaClicks === 0) return null;
  return { deltaPoints, deltaClicks, newScore, oldScore };
}


function addPoints(payload){
  const res = applyEventWithAntiCheat(payload);
  if (!res) return null;

  const points = getPoints();
  const days = points.days || {};
  const workDays = points.workDays || {};

  const k = dateKeyFromTs(payload?.ts || Date.now());

  if (!days[k]) days[k] = { total: 0, byKey: {} };
  if (!workDays[k]) workDays[k] = { total: 0, byType: {} };
  if (!workDays[k].slots) workDays[k].slots = {};

  days[k].total = Number(days[k].total || 0) + Number(res.deltaPoints || 0);

  const bucket = res.newScore?.type || payload?.key || 'custom';
  days[k].byKey[bucket] = Number(days[k].byKey[bucket] || 0) + Number(res.deltaPoints || 0);

  workDays[k].total = Number(workDays[k].total || 0) + Number(res.deltaClicks || 0);
  const t = res.newScore?.type;
  if (t){
    workDays[k].byType[t] = Number(workDays[k].byType[t] || 0) + Number(res.deltaClicks || 0);
    const eventDate = new Date(Number(payload?.ts) || Date.now());
    const slot = Math.max(0, Math.min(71, Math.floor(((eventDate.getHours() * 60) + eventDate.getMinutes()) / 20)));
    if (!workDays[k].slots[slot]) workDays[k].slots[slot] = { total: 0, byType: {} };
    workDays[k].slots[slot].total = Number(workDays[k].slots[slot].total || 0) + Number(res.deltaClicks || 0);
    workDays[k].slots[slot].byType[t] = Number(workDays[k].slots[slot].byType[t] || 0) + Number(res.deltaClicks || 0);
  }

  points.days = days;
  points.workDays = workDays;
  setPoints(points);

  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.webContents.send('sproutg:points-updated', points);
  }
  safeSend(mainWindow, 'sproutg:points-updated', points);
  safeSend(mainWindow, 'sproutg:points-delta', {
    delta: Number(res.deltaPoints || 0),
    clicks: Number(res.deltaClicks || 0),
    type: res.newScore?.type || payload?.key || 'custom',
    dayKey: k,
    todayTotal: Number(days[k]?.total || 0),
    ts: Number(payload?.ts) || Date.now()
  });
  return points;
}


function setSettings(partial){
  const cur = getSettings();
  const next = normalizeSettings({ ...cur, ...(partial || {}) });
  store.set('settings', next);
  return next;
}

function applySettings(next){
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(!!next.alwaysOnTop);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.setZoomFactor(next.zoom || 1); } catch(e) {}
  }
  safeSend(mainWindow, 'sproutg:apply-settings', next);
  safeSend(settingsWindow, 'sproutg:apply-settings', next);
  safeSend(statsWindow, 'sproutg:apply-settings', next);
  safeSend(companyWindow, 'sproutg:apply-settings', next);
}


function getWebUrl(){
  const cfg = readConfig();
  return normalizeWebUrl(cfg.webUrl);
}

function setWebUrl(input){
  const url = normalizeWebUrl(input);
  if (!url) return null;
  store.set('web.url', url);
  return url;
}

function loadWeb(url){
  if (!bridgeManager) return;
  bridgeManager.load(url);
}

function destroyAuxiliaryWindows(){
  for (const win of [settingsWindow, statsWindow, companyWindow, urlWindow, bridgeLoginWindow]) {
    try {
      if (win && !win.isDestroyed()) win.destroy();
    } catch(e) {}
  }
  settingsWindow = null;
  statsWindow = null;
  companyWindow = null;
  urlWindow = null;
  bridgeLoginWindow = null;
  try { if (bridgeManager) bridgeManager.destroy(); } catch(e) {}
}

function shutdownApp(){
  if (isQuitting) return;
  isQuitting = true;
  destroyAuxiliaryWindows();
  try { flushGoogleSession(); } catch(e) {}
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  } catch(e) {}
  setTimeout(() => {
    try { app.exit(0); } catch(e) {}
  }, 1200);
  app.quit();
}

function positionSettingsWindow(){
  if (!mainWindow || !settingsWindow || settingsWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  const sw = settingsWindow.getBounds().width;
  settingsWindow.setPosition(Math.round(b.x + b.width - sw - 12), Math.round(b.y + TOPBAR_HEIGHT + 6), false);
}

function closeSettingsWindow(){
  if (!settingsWindow || settingsWindow.isDestroyed()) return false;
  lastSettingsClosedAt = Date.now();
  return closeWindowAnimated(settingsWindow);
}

function safeSend(win, channel, payload){
  try {
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return false;
    win.webContents.send(channel, payload);
    return true;
  } catch(e) {
    return false;
  }
}

function closeWindowAnimated(win, delayMs = 420){
  if (!win || win.isDestroyed()) return false;
  try {
    if (win.__sproutgClosing) return true;
    win.__sproutgClosing = true;
    safeSend(win, 'sproutg:prepare-close', {});
    setTimeout(() => {
      try {
        if (win && !win.isDestroyed()) win.close();
      } catch(e) {}
    }, delayMs);
    return true;
  } catch(e) {
    try { win.close(); return true; } catch(_) { return false; }
  }
}

function openSettingsWindow(){
  if (!mainWindow) return;
  if (Date.now() - lastSettingsClosedAt < 260) return;

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isVisible()) {
      closeSettingsWindow();
      return;
    }
    positionSettingsWindow();
    settingsWindow.show();
    settingsWindow.focus();
    settingsWindow.webContents.send('sproutg:apply-settings', getSettings());
    return;
  }

  settingsWindow = new BrowserWindow({
    parent: mainWindow,
    modal: false,
    show: false,
    width: 360,
    height: 680,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings', 'index.html'));

  settingsWindow.on('closed', () => { lastSettingsClosedAt = Date.now(); settingsWindow = null; });
  try { settingsWindow.webContents.setVisualZoomLevelLimits(1, 1); settingsWindow.webContents.setZoomFactor(1); } catch(e) {}
  settingsWindow.webContents.on('before-input-event', (event, input) => {
    const isZoomKey = (input.key === '+' || input.key === '-' || input.key === '=' || input.key === '0');
    if ((input.control || input.meta) && isZoomKey) event.preventDefault();
  });


  settingsWindow.once('ready-to-show', () => {
    positionSettingsWindow();
    settingsWindow.show();
    settingsWindow.focus();
    settingsWindow.webContents.send('sproutg:apply-settings', getSettings());
  });

  mainWindow.on('move', positionSettingsWindow);
  mainWindow.on('resize', positionSettingsWindow);
}

function openStatsWindow(){
  if (!mainWindow) return;

  if (statsWindow && !statsWindow.isDestroyed()) {
  if (statsWindow.isVisible()) {
    closeStatsWindow();
    return;
  }
  positionStatsWindow();
  statsWindow.show();
  statsWindow.focus();
  statsWindow.webContents.send('sproutg:apply-settings', getSettings());
  statsWindow.webContents.send('sproutg:points-updated', getPoints());
  setTimeout(() => { try { statsWindow && !statsWindow.isDestroyed() && statsWindow.webContents.send('sproutg:points-updated', getPoints()); } catch(e){} }, 80);
  return;
}

  statsWindow = new BrowserWindow({
    parent: mainWindow,
    modal: false,
    show: false,
    width: 640,
    height: 520,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'stats', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });


let _statsMoveTimer = null;
const _saveStatsPos = () => {
  try{
    if (!statsWindow || statsWindow.isDestroyed()) return;
    clearTimeout(_statsMoveTimer);
    _statsMoveTimer = setTimeout(() => {
      try { setStoredStatsBounds(statsWindow.getBounds()); } catch(e) {}
    }, 150);
  }catch(e){}
};
statsWindow.on('move', _saveStatsPos);
statsWindow.on('moved', _saveStatsPos);
statsWindow.on('close', () => { try{ setStoredStatsBounds(statsWindow.getBounds()); }catch(e){} });


try{
  const stored = getStoredStatsBounds();
  if (stored && typeof stored.x === 'number' && typeof stored.y === 'number'){
    const clamped = clampToWorkArea({ x: stored.x, y: stored.y, width: 640, height: 520 });
    statsWindow.setBounds(clamped, false);
  } else {
    positionStatsWindow();
  }
} catch(e) {
  // ignore
}

statsWindow.loadFile(path.join(__dirname, 'stats', 'index.html'));

  statsWindow.on('closed', () => { statsWindow = null; });
  try { statsWindow.webContents.setVisualZoomLevelLimits(1, 1); statsWindow.webContents.setZoomFactor(1); } catch(e) {}
  statsWindow.webContents.on('before-input-event', (event, input) => {
    const isZoomKey = (input.key === '+' || input.key === '-' || input.key === '=' || input.key === '0');
    if ((input.control || input.meta) && isZoomKey) event.preventDefault();
  });


  statsWindow.once('ready-to-show', () => {
    try{
      const stored = getStoredStatsBounds();
      if (!stored) positionStatsWindow();
    } catch(e) {}
    statsWindow.show();
    statsWindow.focus();
    statsWindow.webContents.send('sproutg:apply-settings', getSettings());
    statsWindow.webContents.send('sproutg:points-updated', getPoints());
    setTimeout(() => { try { statsWindow && !statsWindow.isDestroyed() && statsWindow.webContents.send('sproutg:points-updated', getPoints()); } catch(e){} }, 80);
  });

}

function positionStatsWindow(){
  if (!mainWindow || !statsWindow || statsWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  const sw = statsWindow.getBounds().width;
  statsWindow.setPosition(Math.round(b.x + b.width - sw - 12), Math.round(b.y + TOPBAR_HEIGHT + 6), false);
}

function closeStatsWindow(){
  if (!statsWindow || statsWindow.isDestroyed()) return false;
  try { setStoredStatsBounds(statsWindow.getBounds()); } catch(e) {}
  return closeWindowAnimated(statsWindow);
}

function positionCompanyWindow(){
  if (!mainWindow || !companyWindow || companyWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  const cw = companyWindow.getBounds().width;
  companyWindow.setPosition(Math.round(b.x + b.width - cw - 12), Math.round(b.y + TOPBAR_HEIGHT + 6), false);
}

function closeCompanyWindow(){
  if (!companyWindow || companyWindow.isDestroyed()) return false;
  try { setStoredCompanyBounds(companyWindow.getBounds()); } catch(e) {}
  return closeWindowAnimated(companyWindow);
}

function openCompanyWindow(){
  if (!mainWindow) return;

  if (companyWindow && !companyWindow.isDestroyed()) {
    if (companyWindow.isVisible()) {
      closeCompanyWindow();
      return;
    }
    positionCompanyWindow();
    companyWindow.show();
    companyWindow.focus();
    companyWindow.webContents.send('sproutg:apply-settings', getSettings());
    return;
  }

  const storedBounds = getStoredCompanyBounds();
  const initialBounds = storedBounds ? clampToWorkArea(storedBounds) : null;
  const companyWindowOptions = {
    parent: mainWindow,
    modal: false,
    show: false,
    width: initialBounds?.width || 420,
    height: initialBounds?.height || 334,
    minWidth: 360,
    minHeight: 334,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'company', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  };
  if (initialBounds) {
    companyWindowOptions.x = initialBounds.x;
    companyWindowOptions.y = initialBounds.y;
  }
  companyWindow = new BrowserWindow(companyWindowOptions);

  companyWindow.loadFile(path.join(__dirname, 'company', 'index.html'));
  const _saveCompanyBounds = () => {
    if (!companyWindow || companyWindow.isDestroyed()) return;
    try { setStoredCompanyBounds(companyWindow.getBounds()); } catch(e) {}
  };
  companyWindow.on('move', _saveCompanyBounds);
  companyWindow.on('moved', _saveCompanyBounds);
  companyWindow.on('resize', _saveCompanyBounds);
  companyWindow.on('resized', _saveCompanyBounds);
  companyWindow.on('close', _saveCompanyBounds);
  companyWindow.on('closed', () => { companyWindow = null; });
  try { companyWindow.webContents.setVisualZoomLevelLimits(1, 1); companyWindow.webContents.setZoomFactor(1); } catch(e) {}
  companyWindow.webContents.on('before-input-event', (event, input) => {
    const isZoomKey = (input.key === '+' || input.key === '-' || input.key === '=' || input.key === '0');
    if ((input.control || input.meta) && isZoomKey) event.preventDefault();
  });
  companyWindow.once('ready-to-show', () => {
    if (!initialBounds) positionCompanyWindow();
    companyWindow.show();
    companyWindow.focus();
    companyWindow.webContents.send('sproutg:apply-settings', getSettings());
  });

}


function openUrlWindow(firstRun){
  if (!mainWindow) return;

  if (urlWindow && !urlWindow.isDestroyed()) {
    urlWindow.show(); urlWindow.focus(); return;
  }

  urlWindow = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    show: false,
    width: 520,
    height: 290,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'settings', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  urlWindow.loadFile(path.join(__dirname, 'settings', 'url.html'), { query: { firstRun: firstRun ? '1' : '0' } });
  urlWindow.once('ready-to-show', () => { urlWindow.show(); urlWindow.focus(); });
  urlWindow.on('closed', () => { urlWindow = null; });
}

function openBridgeLoginWindow(){
  if (!mainWindow) return false;
  const url = getWebUrl();
  if (!url) {
    openUrlWindow(true);
    return false;
  }

  if (bridgeLoginWindow && !bridgeLoginWindow.isDestroyed()) {
    bridgeLoginWindow.show();
    bridgeLoginWindow.focus();
    return true;
  }

  bridgeLoginWindow = new BrowserWindow({
    parent: mainWindow,
    modal: false,
    show: false,
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: 'Вход в Google Таблицу',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  bridgeLoginWindow.loadURL(url);
  bridgeLoginWindow.once('ready-to-show', () => {
    if (bridgeLoginWindow && !bridgeLoginWindow.isDestroyed()) bridgeLoginWindow.show();
  });
  bridgeLoginWindow.on('closed', () => {
    bridgeLoginWindow = null;
    flushGoogleSession();
    if (bridgeManager) bridgeManager.reload();
  });
  return true;
}

function toggleAOT(){
  const next = setSettings({ alwaysOnTop: !getSettings().alwaysOnTop });
  applySettings(next);
  return next;
}
function reloadWeb(){
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  if (bridgeManager) bridgeManager.reload();
}
function zoom(dir){
  const s = getSettings();
  const step = 0.1;
  const nextZoom = clamp((s.zoom || 1) + (dir === 'in' ? step : -step), 0.7, 1.6);
  const next = setSettings({ zoom: nextZoom });
  applySettings(next);
  return next;
}

function attachShortcuts(wc){
  if (!wc) return;
  wc.on('before-input-event', (event, input) => {
    const ctrl = input.control || input.meta;
    const key = input.key;

    if (ctrl && String(key).toLowerCase() === 'r') {
      event.preventDefault(); reloadWeb(); return;
    }

    if (ctrl && (key === '+' || key === '=' || key === 'Add')) {
      event.preventDefault(); zoom('in'); return;
    }
    if (ctrl && (key === '-' || key === 'Subtract')) {
      event.preventDefault(); zoom('out'); return;
    }

    if (key === 'F9') {
      event.preventDefault(); toggleAOT(); return;
    }
  });
}

function createMainWindow(){
  const winState = store.get('window');
  const safeBounds = sanitizeBounds(winState.bounds);

  mainWindow = new BrowserWindow({
    title: 'SproutG',
    ...(safeBounds ? safeBounds : { width: 1200, height: 820 }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    show: false,
    backgroundColor: '#0f1115',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  const s = getSettings();
  mainWindow.setAlwaysOnTop(!!s.alwaysOnTop);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'app.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // save bounds
  let lastNormal = safeBounds || mainWindow.getBounds();
  let timer = null;
  function scheduleSave(){
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!mainWindow) return;
      const isMax = mainWindow.isMaximized();
      const bounds = isMax ? lastNormal : mainWindow.getBounds();
      store.set('window', { bounds, isMaximized: isMax });
    }, 150);
  }
  mainWindow.on('move', () => { if (!mainWindow.isMaximized()) lastNormal = mainWindow.getBounds(); scheduleSave(); });
  mainWindow.on('resize', () => { if (!mainWindow.isMaximized()) lastNormal = mainWindow.getBounds(); scheduleSave(); });
  mainWindow.on('maximize', scheduleSave);
  mainWindow.on('unmaximize', scheduleSave);
  mainWindow.on('close', (event) => {
    const isMax = mainWindow.isMaximized();
    const bounds = isMax ? lastNormal : mainWindow.getBounds();
    store.set('window', { bounds, isMaximized: isMax });
    if (!isQuitting) {
      event.preventDefault();
      shutdownApp();
    }
  });

  const url = getWebUrl();
  if (!url) {
    mainWindow.webContents.once('did-finish-load', () => openUrlWindow(true));
  } else {
    loadWeb(url);
  }

  mainWindow.webContents.on('did-finish-load', () => applySettings(getSettings()));
  if (winState && winState.isMaximized) mainWindow.maximize();

  attachShortcuts(mainWindow.webContents);
}

function registerGlobal(){
  globalShortcut.register('F9', () => {
    if (BrowserWindow.getFocusedWindow()) toggleAOT();
  });
}

app.whenReady().then(() => {
  app.setName('SproutG');
  if (process.platform === 'win32') app.setAppUserModelId('com.sproutg.desktop');
  bridgeManager = new BridgeManager({ getSession, partition: PARTITION, appDir: __dirname });
  bridgeManager.on('state', broadcastBridgeState);
  bridgeManager.on('state', (state) => { if (state?.status === 'ready') flushGoogleSession(); });
  registerApiIpc(ipcMain, bridgeManager);
  createMainWindow();
  registerGlobal();

  scheduleBootUpdateNoticeCheck();
  schedulePeriodicUpdateChecks();
});

app.on('will-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  destroyAuxiliaryWindows();
});
app.on('before-quit', () => { isQuitting = true; flushGoogleSession(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* IPC */
ipcMain.handle('sproutg:get-version', () => app.getVersion());
ipcMain.handle('sproutg:get-update-state', () => ({ ...updateState, version: app.getVersion(), isPackaged: app.isPackaged }));
ipcMain.handle('sproutg:check-for-updates', () => checkForUpdates(true));
ipcMain.handle('sproutg:download-update', () => downloadUpdate());
ipcMain.handle('sproutg:install-update', () => installDownloadedUpdate());
ipcMain.handle('sproutg:get-settings', () => getSettings());
ipcMain.handle('sproutg:set-setting', (_e, partial) => { const n = setSettings(partial); applySettings(n); return n; });
ipcMain.handle('sproutg:zoom', (_e, dir) => zoom(dir));
ipcMain.handle('sproutg:toggle-aot', () => toggleAOT());
ipcMain.handle('sproutg:reload-web', () => { reloadWeb(); return true; });
ipcMain.handle('sproutg:close-settings-window', () => closeSettingsWindow());
ipcMain.handle('sproutg:close-stats-window', () => closeStatsWindow());
ipcMain.handle('sproutg:close-company-window', () => closeCompanyWindow());
ipcMain.handle('sproutg:get-storage-info', () => getStorageInfo());

ipcMain.handle('sproutg:clear-cache', async () => {
  const s = getSession();
  await s.clearCache();
  await flushGoogleSession();
  reloadWeb();
  return true;
});
ipcMain.handle('sproutg:logout', async () => {
  await getSession().clearStorageData({ storages:['cookies','localstorage','indexdb','serviceworkers','caches'] });
  store.set('points', { days: {}, workDays: {} });
    store.set('statusState', {});
  if (statsWindow && !statsWindow.isDestroyed()) statsWindow.webContents.send('sproutg:points-updated', getPoints());
    setTimeout(() => { try { statsWindow && !statsWindow.isDestroyed() && statsWindow.webContents.send('sproutg:points-updated', getPoints()); } catch(e){} }, 80);
  reloadWeb();
  return true;
});

ipcMain.handle('sproutg:open-settings', () => { openSettingsWindow(); return true; });

ipcMain.handle('sproutg:open-stats', () => { openStatsWindow(); return true; });
ipcMain.handle('sproutg:open-company', () => { openCompanyWindow(); return true; });
ipcMain.handle('sproutg:get-points', () => getPoints());
ipcMain.handle('sproutg:open-url', (_e, firstRun) => { openUrlWindow(!!firstRun); return true; });
ipcMain.handle('sproutg:open-bridge-login', () => openBridgeLoginWindow());

ipcMain.handle('sproutg:set-web-url', (_e, input) => {
  const url = setWebUrl(input);
  if (!url) return { ok:false, error:'Неверный URL или ID' };
  if (bridgeManager) loadWeb(url);
  if (urlWindow && !urlWindow.isDestroyed()) urlWindow.close();
  return { ok:true, url };
});

ipcMain.on('sproutg:window-control', (_e, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') return mainWindow.minimize();
  if (action === 'maximize-toggle') return mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  if (action === 'close') return shutdownApp();
});

ipcMain.on('sproutg:web-message', (_e, msg) => {
  if (!msg || !msg.type) return;
  const t = msg.type;
  if (t === 'THEME_COLORS' && msg.payload) {
    safeSend(mainWindow, 'sproutg:theme-colors', msg.payload);
    return;
  }
  if ((t === 'STATUS_EVENT' || t === 'POINT_EVENT') && msg.payload) {
    addPoints(msg.payload);
    return;
  }
});

setInterval(() => { try { addPoints({ delta: 1, key: 'Desktop:Active10min', ts: Date.now() }); } catch(e) {} }, 10*60*1000);

