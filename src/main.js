const { app, BrowserWindow, ipcMain, Menu, session, screen, globalShortcut, Notification, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const Store = require('electron-store');
const { BridgeManager } = require('./main/bridgeManager');
const { registerApiIpc } = require('./main/apiIpc');
const {
  classifyHeroSmsOrderResponse,
  classifyHeroSmsRefundResponse,
  normalizeHeroSmsOwnerIdentity,
  sameHeroSmsOwnerIdentity
} = require('./main/heroSmsSafety');
const { MutationRegistry } = require('./main/mutationRegistry');
const { createRollbackBackup } = require('./main/rollbackBackup');
const { isHeroSmsStateMutation } = require('./main/heroSmsMutationPolicy');
const { prepareStoreBootstrap } = require('./main/storeRecovery');
const { saveWorkSession, loadWorkSession } = require('./main/workSessionStore');

// Acquire process ownership before electron-store or the durable WAL are
// opened. A losing process must never initialize either persistence writer.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {

const TOPBAR_HEIGHT = 38;
const PARTITION = 'persist:sproutg';
const MIN_WIDTH = 420;   // allow 9:16 portrait-like
const MIN_HEIGHT = 560;
const RUNTIME_SESSION_ID = String(Date.now());
const USER_DATA_DIR = app.getPath('userData');
const DURABLE_WAL_PATH = path.join(USER_DATA_DIR, 'sproutg-pending-writes.wal.json');

const STORE_DEFAULTS = {
    ui: { statsBounds: null, companyBounds: null },
    points: { days: {}, workDays: {} },
    statusState: {},
    settings: { theme: 'dark-classic', zoom: 1.0, fontScale: 1.0, alwaysOnTop: false, graphicsMode: 'ultra', contrastMode: false, classicTrafficLights: false, mccVerificationInline: true, mccValidityInline: true, statCardGlow: true, smsService: 'smspool', customThemeId: '', customThemes: [] },
    heroSms: {
      apiKey: '',
      activeOrder: null,
      orderIntent: null,
      refundIntent: null,
      country: '0',
      service: 'go',
      catalog: null,
      catalogTs: 0
    },
    window: { bounds: null, isMaximized: false },
    web: { url: null },
    pendingWrites: [],
    pendingWritesBackup: [],
    pendingWritesSnapshot: { schemaVersion: 0, revision: 0, completedIds: [], items: [] }
};
let storeBootstrap;
try {
  storeBootstrap = prepareStoreBootstrap({
    userDataDir:USER_DATA_DIR,
    baseName:'sproutg-desktop',
    walPath:DURABLE_WAL_PATH
  });
} catch (error) {
  dialog.showErrorBox(
    'SproutG: локальное хранилище недоступно',
    `Приложение остановлено до безопасного восстановления данных.\n\n${error?.message || error}`
  );
  app.quit();
  throw error;
}
const storageIntegrity = Object.freeze({ ...storeBootstrap.integrity });
const store = new Store({
  name:storeBootstrap.storeName,
  clearInvalidConfig:false,
  defaults:STORE_DEFAULTS
});

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function normalizeWebUrl(input){
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) {
    return `https://script.google.com/macros/s/${raw}/exec`;
  }
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:'
      || url.hostname !== 'script.google.com'
      || !/^\/macros\/s\/[a-zA-Z0-9_-]{20,}\/exec\/?$/.test(url.pathname)
    ) {
      return null;
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch (_error) {}
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
let writeQueueController = null;
let writeGateClosed = false;
let writeBarrierState = 'open';
let activeWriteBarrierToken = '';
let writeBarrierSeq = 0;
const writeBarrierWaiters = new Map();
const directMutationRegistry = new MutationRegistry();
let settingsWindow = null;
let statsWindow = null;
let companyWindow = null;
let urlWindow = null;
let bridgeLoginWindow = null;
let ses = null;
let lastSettingsClosedAt = 0;
let isQuitting = false;
let quitApproved = false;

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
});

function getSession(){
  if (!ses) ses = session.fromPartition(PARTITION);
  return ses;
}

async function flushGoogleSession(){
  try { await getSession().cookies.flushStore(); } catch(e) {}
}

async function flushRendererStorageData(){
  await Promise.all([
    session.defaultSession.flushStorageData(),
    getSession().flushStorageData(),
    getSession().cookies.flushStore()
  ]);
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
let rollbackInfoCache = null;
let installBarrierToken = '';
let installBarrierWatchdog = null;

function cancelInstallExitBarrier(){
  clearTimeout(installBarrierWatchdog);
  installBarrierWatchdog = null;
  quitApproved = false;
  if (installBarrierToken) releaseWriteBarrier(installBarrierToken);
  installBarrierToken = '';
}

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

function publicStorageIntegrity(){
  return {
    active:storageIntegrity.active === true,
    code:String(storageIntegrity.code || ''),
    message:String(storageIntegrity.message || ''),
    walValid:storageIntegrity.walValid === true,
    sheetWritesBlocked:storageIntegrity.sheetWritesBlocked === true,
    heroSmsBlocked:storageIntegrity.heroSmsBlocked === true,
    primaryPath:String(storageIntegrity.primaryPath || ''),
    recoveryPath:String(storageIntegrity.recoveryPath || ''),
    quarantinePaths:Array.isArray(storageIntegrity.quarantines)
      ? storageIntegrity.quarantines.map((item) => String(item?.path || '')).filter(Boolean)
      : []
  };
}

function notifyStorageIntegrity(){
  if (!storageIntegrity.active) return;
  const state = publicStorageIntegrity();
  safeSend(mainWindow, 'sproutg:storage-integrity', state);
  sendDesktopNotice({
    type:'error',
    title:'Защита локальных данных включена',
    body:state.message,
    durationMs:0,
    dismissible:false
  });
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
  const base = state || (bridgeManager ? bridgeManager.getState() : { status:'idle', ready:false });
  const payload = { ...base, storageIntegrity:publicStorageIntegrity() };
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
  if (installBarrierToken && !isQuitting) cancelInstallExitBarrier();
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
  if (!cfg.enabled || !cfg.autoCheckOnStart) return;
  setTimeout(() => { checkForUpdates(false, 'boot').catch(() => {}); }, 1800);
  setTimeout(() => { checkForUpdates(false, 'scheduled').catch(() => {}); }, 90 * 1000);
  setTimeout(() => { checkForUpdates(false, 'scheduled').catch(() => {}); }, 5 * 60 * 1000);
}

function schedulePeriodicUpdateChecks(){
  if (!app.isPackaged || updateReminderTimer) return;
  const cfg = getUpdatesConfig();
  if (!cfg.enabled) return;
  updateReminderTimer = setInterval(() => {
    checkForUpdates(false, 'scheduled').catch(() => {});
  }, 5 * 60 * 1000);
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

async function installDownloadedUpdate(){
  if (!app.isPackaged) return setUpdateState({ status: 'dev', message: 'Установка обновлений доступна только в установленной сборке Windows' });
  if (!updateState.downloaded) return setUpdateState({ status: updateState.status || 'idle', message: 'Сначала скачай обновление' });
  const barrier = await beginWriteBarrier('install-update', 30000);
  if (!barrier?.ok) {
    return setUpdateState({
      status:'error',
      message:'Установка остановлена: последние изменения не сохранены',
      error:barrier?.error || 'Интерфейс не подтвердил сохранение',
      progress:null
    });
  }
  setUpdateState({ status:'install-waiting', message:'Проверяем, что все данные сохранены...', error:null, progress:null });
  const pending = writeQueueController
    ? await writeQueueController.drain(60000)
    : await waitForPendingWrites(60000);
  if (pending > 0) {
    releaseWriteBarrier(barrier.barrierToken);
    return setUpdateState({
      status:'error',
      message:'Установка остановлена: остались несохранённые данные',
      error:`В надёжной очереди: ${pending}. Дождись синхронизации с Google Таблицей.`,
      progress:null
    });
  }
  try { await flushGoogleSession(); } catch (_error) {}
  try {
    installBarrierToken = barrier.barrierToken;
    quitApproved = true;
    clearTimeout(installBarrierWatchdog);
    installBarrierWatchdog = setTimeout(() => {
      if (!installBarrierToken || isQuitting) return;
      cancelInstallExitBarrier();
      setUpdateState({
        status:'error',
        message:'Установщик обновления не запустился',
        error:'Защитный таймаут снял блокировку записи; попробуй установить обновление ещё раз',
        progress:null
      });
    }, 20000);
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    cancelInstallExitBarrier();
    return setUpdateState({ status: 'error', message: 'Не удалось установить обновление', error: e?.message || String(e) });
  }
  return updateState;
}

function parseVersionParts(value){
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b){
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function publicRollbackInfo(info){
  if (!info || info.available === false) return info || { available:false };
  return {
    available:true,
    version:info.version,
    name:info.name,
    size:info.size,
    publishedAt:info.publishedAt
  };
}

async function fetchGithubJson(url){
  const response = await net.fetch(url, {
    headers:{
      Accept:'application/vnd.github+json',
      'User-Agent':`SproutG/${app.getVersion()}`,
      'X-GitHub-Api-Version':'2022-11-28'
    }
  });
  if (!response.ok) throw new Error(`GitHub ответил ${response.status}`);
  return response.json();
}

async function getRollbackInfo(force = false){
  const now = Date.now();
  if (!force && rollbackInfoCache && now - rollbackInfoCache.checkedAt < 5 * 60 * 1000) {
    return publicRollbackInfo(rollbackInfoCache.info);
  }

  const cfg = getUpdatesConfig();
  if (cfg.provider !== 'github' || isPlaceholderValue(cfg.owner) || isPlaceholderValue(cfg.repo)) {
    const info = { available:false, message:'Репозиторий обновлений не настроен' };
    rollbackInfoCache = { checkedAt:now, info };
    return info;
  }

  try {
    const releases = await fetchGithubJson(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/releases?per_page=30`);
    const currentVersion = app.getVersion();
    const candidates = (Array.isArray(releases) ? releases : [])
      .filter((release) => !release?.draft && (!release?.prerelease || cfg.allowPrerelease))
      .map((release) => ({ release, version:String(release?.tag_name || '').replace(/^v/i, '') }))
      .filter((item) => parseVersionParts(item.version) && compareVersions(item.version, currentVersion) < 0)
      .sort((a, b) => compareVersions(b.version, a.version));

    let info = { available:false, message:'Предыдущий публичный релиз не найден' };
    for (const candidate of candidates) {
      const expectedName = `SproutG-Setup-${candidate.version}.exe`.toLowerCase();
      const asset = (Array.isArray(candidate.release?.assets) ? candidate.release.assets : [])
        .find((item) => String(item?.name || '').toLowerCase() === expectedName);
      if (!asset?.browser_download_url) continue;
      info = {
        available:true,
        version:candidate.version,
        name:String(asset.name || `SproutG-Setup-${candidate.version}.exe`),
        size:Number(asset.size || 0),
        digest:String(asset.digest || ''),
        publishedAt:String(candidate.release?.published_at || candidate.release?.created_at || ''),
        assetUrl:String(asset.browser_download_url)
      };
      break;
    }
    rollbackInfoCache = { checkedAt:now, info };
    return publicRollbackInfo(info);
  } catch (error) {
    const info = { available:false, message:'Не удалось получить предыдущую версию', error:error?.message || String(error) };
    rollbackInfoCache = { checkedAt:now, info };
    return info;
  }
}

async function waitForPendingWrites(timeoutMs = 60000){
  if (writeQueueController) return writeQueueController.drain(timeoutMs);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const pending = store.get('pendingWrites');
    if (!Array.isArray(pending) || pending.length === 0) return 0;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const pending = store.get('pendingWrites');
  return Array.isArray(pending) ? pending.length : 0;
}

function backupRollbackData(targetVersion){
  return createRollbackBackup({
    userData:app.getPath('userData'),
    storePath:store.path,
    fromVersion:app.getVersion(),
    targetVersion
  });
}

async function downloadRollbackAsset(info){
  const finalPath = path.join(app.getPath('temp'), info.name);
  const partialPath = `${finalPath}.part`;
  try { if (fs.existsSync(partialPath)) fs.rmSync(partialPath, { force:true }); } catch (e) {}
  try { if (fs.existsSync(finalPath)) fs.rmSync(finalPath, { force:true }); } catch (e) {}

  const controller = new AbortController();
  const overallTimer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  let response;
  try {
    response = await net.fetch(info.assetUrl, {
      redirect:'follow',
      signal:controller.signal,
      headers:{ 'User-Agent':`SproutG/${app.getVersion()}`, Accept:'application/octet-stream' }
    });
  } catch (error) {
    clearTimeout(overallTimer);
    throw new Error(error?.name === 'AbortError'
      ? 'Скачивание установщика превысило безопасный таймаут'
      : (error?.message || String(error)));
  }
  if (!response.ok || !response.body) {
    clearTimeout(overallTimer);
    throw new Error(`Не удалось скачать установщик: HTTP ${response.status}`);
  }

  const total = Number(response.headers.get('content-length') || info.size || 0);
  const file = await fs.promises.open(partialPath, 'w').catch((error) => {
    clearTimeout(overallTimer);
    throw error;
  });
  const reader = response.body.getReader();
  let received = 0;
  let lastProgressAt = 0;
  const hash = crypto.createHash('sha256');
  try {
    while (true) {
      let stallTimer = null;
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          stallTimer = setTimeout(() => {
            controller.abort();
            reject(new Error('Скачивание установщика остановилось более чем на 45 секунд'));
          }, 45000);
        })
      ]).finally(() => clearTimeout(stallTimer));
      if (chunk.done) break;
      const buffer = Buffer.from(chunk.value);
      await file.write(buffer, 0, buffer.length, null);
      hash.update(buffer);
      received += buffer.length;
      if (Date.now() - lastProgressAt > 140) {
        lastProgressAt = Date.now();
        const percent = total > 0 ? Math.round(received / total * 100) : 0;
        setUpdateState({
          status:'rollback-downloading',
          message:`Скачивание v${info.version} для отката... ${percent}%`,
          progress:{ percent, transferred:received, total },
          error:null
        });
      }
    }
  } finally {
    clearTimeout(overallTimer);
    await file.close();
  }

  if (info.size && received !== info.size) {
    try { fs.rmSync(partialPath, { force:true }); } catch (e) {}
    throw new Error(`Размер установщика не совпал: ${received} вместо ${info.size}`);
  }
  const expectedDigest = String(info.digest || '').replace(/^sha256:/i, '').toLowerCase();
  const actualDigest = hash.digest('hex').toLowerCase();
  if (expectedDigest && actualDigest !== expectedDigest) {
    try { fs.rmSync(partialPath, { force:true }); } catch (e) {}
    throw new Error('Контрольная сумма установщика не совпала');
  }
  fs.renameSync(partialPath, finalPath);
  return finalPath;
}

async function rollbackToPreviousVersion(){
  if (!app.isPackaged) return { ok:false, error:'Откат доступен только в установленной Windows-сборке' };
  const infoPublic = await getRollbackInfo(true);
  const info = rollbackInfoCache?.info;
  if (!infoPublic?.available || !info?.assetUrl) {
    return { ok:false, error:infoPublic?.error || infoPublic?.message || 'Предыдущая версия недоступна' };
  }

  const confirmation = await dialog.showMessageBox(settingsWindow || mainWindow, {
    type:'warning',
    title:'Вернуться к предыдущей версии',
    message:`Вернуться с v${app.getVersion()} на v${info.version}?`,
    detail:'SproutG сначала дождётся сохранения очереди и создаст резервную копию локальных данных. Затем откроется установщик предыдущей версии.',
    buttons:['Вернуться', 'Отмена'],
    defaultId:1,
    cancelId:1,
    noLink:true
  });
  if (confirmation.response !== 0) return { ok:false, canceled:true };

  const barrier = await beginWriteBarrier('rollback-update', 30000);
  if (!barrier?.ok) {
    return setUpdateState({
      status:'error',
      message:'Откат остановлен: последние изменения не сохранены',
      error:barrier?.error || 'Интерфейс не подтвердил сохранение',
      progress:null
    });
  }
  setUpdateState({ status:'rollback-waiting', message:'Ждём завершения сохранения данных...', progress:null, error:null });
  const pending = await waitForPendingWrites(60000);
  if (pending > 0) {
    releaseWriteBarrier(barrier.barrierToken);
    return setUpdateState({
      status:'error',
      message:'Откат остановлен: остались несохранённые данные',
      error:`В очереди: ${pending}. Дождись синхронизации и повтори.`,
      progress:null
    });
  }

  try {
    try {
      await Promise.all([
        session.defaultSession.flushStorageData(),
        getSession().flushStorageData(),
        flushGoogleSession()
      ]);
    } catch (_error) {}
    backupRollbackData(info.version);
    setUpdateState({ status:'rollback-downloading', message:`Скачивание v${info.version} для отката...`, progress:{ percent:0 }, error:null });
    const installerPath = await downloadRollbackAsset(info);
    setUpdateState({ status:'rollback-ready', message:`Запускаем установщик v${info.version}...`, progress:null, error:null });
    const openError = await shell.openPath(installerPath);
    if (openError) throw new Error(openError);
    quitApproved = true;
    setTimeout(() => app.quit(), 1400);
    return { ok:true, version:info.version };
  } catch (error) {
    quitApproved = false;
    releaseWriteBarrier(barrier.barrierToken);
    return setUpdateState({ status:'error', message:'Не удалось выполнить откат', error:error?.message || String(error), progress:null });
  }
}

const HERO_SMS_API_BASE = 'https://hero-sms.com/api/v1';
const HERO_SMS_HANDLER_BASE = 'https://hero-sms.com/stubs/handler_api.php';
const HERO_SMS_GOOGLE_SERVICE = 'go';
const HERO_SMS_ERRORS_RU = {
  BAD_KEY: 'Неверный API ключ HeroSMS',
  BAD_ACTION: 'Некорректный метод HeroSMS',
  BAD_SERVICE: 'Сервис Google/Gmail/YouTube недоступен',
  BAD_STATUS: 'Некорректный статус активации',
  NO_BALANCE: 'Недостаточно баланса HeroSMS',
  NO_NUMBERS: 'Нет доступных номеров для выбранной страны',
  NO_ACTIVATION: 'Активация не найдена или уже закрыта',
  STATUS_CANCEL: 'Активация отменена',
  ACCOUNT_INACTIVE: 'Аккаунт HeroSMS неактивен',
  BANNED: 'Аккаунт HeroSMS временно заблокирован',
  ERROR_SQL: 'Ошибка HeroSMS: один из параметров не принят',
  SQL_ERROR: 'Ошибка HeroSMS: один из параметров не принят',
  WRONG_SERVICE: 'Этот сервис не поддерживает запрошенную операцию',
  WRONG_SECURITY: 'Операция недоступна для этой активации',
  ACCESS_CANCEL: 'Активация отменена',
  ACCESS_ACTIVATION: 'Активация завершена',
  ACCESS_READY: 'Ожидание новой SMS',
  ACCESS_RETRY_GET: 'Запрошена повторная SMS',
  STATUS_WAIT_CODE: 'Ожидаем SMS с кодом',
  STATUS_WAIT_RETRY: 'Ожидаем повторную SMS',
  STATUS_WAIT_RESEND: 'Ожидаем повторную отправку',
  STATUS_OK: 'Код получен'
};

function heroSmsTranslate(text){
  const raw = String(text || '').trim();
  const key = raw.split(':')[0];
  return HERO_SMS_ERRORS_RU[key] || raw || 'Неизвестный ответ HeroSMS';
}

function heroSmsApiKey(){
  return String(store.get('heroSms.apiKey') || '').trim();
}

function setHeroSmsApiKey(key){
  const clean = String(key || '').trim();
  const previous = heroSmsApiKey();
  const activeOrder = store.get('heroSms.activeOrder');
  const orderIntent = store.get('heroSms.orderIntent');
  const refundIntent = store.get('heroSms.refundIntent');
  if (clean !== previous && (activeOrder || orderIntent || refundIntent)) {
    return {
      ok:false,
      code:'HERO_SMS_ORDER_ACTIVE',
      error:'Нельзя изменить или удалить API key, пока есть активная или восстанавливаемая HeroSMS-активация. Сначала заверши или отмени её.'
    };
  }
  store.set('heroSms.apiKey', clean);
  if (clean !== previous) {
    store.set('heroSms.catalog', null);
    store.set('heroSms.catalogTs', 0);
  }
  return { ok: true, hasKey: !!clean };
}

function heroSmsHeaders(json = false){
  const key = heroSmsApiKey();
  return {
    Accept: json ? 'application/json,text/plain,*/*' : 'text/plain,*/*',
    Authorization: `Bearer ${key}`,
    'X-Api-Key': key
  };
}

async function heroSmsFetch(url, options = {}, timeoutMs = 20000){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 20000)));
  try {
    return await fetch(url, { ...options, signal:controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('HeroSMS не ответил за 20 секунд');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function heroSmsHandlerFetch(params = {}, opts = {}){
  const key = heroSmsApiKey();
  if (!key) return { ok:false, sent:false, error:'Укажи HeroSMS API key в настройках' };
  const query = new URLSearchParams({ ...params, api_key: key });
  const res = await heroSmsFetch(`${HERO_SMS_HANDLER_BASE}?${query.toString()}`, {
    method: 'GET',
    headers: heroSmsHeaders(!!opts.json)
  });
  const text = String(await res.text() || '').trim();
  if (!res.ok) {
    return {
      ok:false,
      sent:true,
      status:Number(res.status || 0),
      text,
      error:`HeroSMS HTTP ${res.status}: ${text || res.statusText}`
    };
  }
  if (!opts.json) return { ok:true, sent:true, text };
  try {
    return { ok:true, sent:true, text, data: JSON.parse(text) };
  } catch (e) {
    return { ok:false, sent:true, text, error:heroSmsTranslate(text) };
  }
}

async function heroSmsApiFetch(pathname, params = {}){
  const key = heroSmsApiKey();
  if (!key) return { ok:false, error:'Укажи HeroSMS API key в настройках' };
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await heroSmsFetch(`${HERO_SMS_API_BASE}${pathname}${suffix}`, {
    method: 'GET',
    headers: heroSmsHeaders(true)
  });
  const text = String(await res.text() || '').trim();
  if (!res.ok) return { ok:false, error:`HeroSMS HTTP ${res.status}: ${heroSmsTranslate(text || res.statusText)}` };
  try {
    return { ok:true, text, data: JSON.parse(text) };
  } catch (e) {
    return { ok:false, error:heroSmsTranslate(text) };
  }
}

function heroSmsCountryName(countries, id){
  const src = countries?.[id] || countries?.[String(Number(id))] || {};
  return {
    id: String(src.id ?? id),
    rus: String(src.rus || '').trim(),
    eng: String(src.eng || '').trim()
  };
}

function normalizeHeroSmsTopRows(raw){
  const rows = Array.isArray(raw)
    ? raw.flatMap((item) => {
        if (item && typeof item === 'object' && !Object.prototype.hasOwnProperty.call(item, 'country')) {
          return Object.values(item).flat();
        }
        return [item];
      })
    : [];
  const map = new Map();
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const id = String(row.country ?? row.countryId ?? row.country_id ?? row.id ?? '').trim();
    if (!id) return;
    const rawSuccess = row.success ?? row.successRate ?? row.rate ?? row.percent ?? row.conversion ?? row.rating;
    const successNum = Number.parseFloat(String(rawSuccess ?? '').replace(',', '.'));
    const success = Number.isFinite(successNum) && successNum > 0 && successNum <= 1 ? successNum * 100 : successNum;
    const count = Number(row.physicalTotalCount ?? row.count ?? row.available ?? row.qty);
    const price = Number(row.retail_price ?? row.price);
    map.set(id, {
      rank: index + 1,
      success: Number.isFinite(success) ? success : null,
      count: Number.isFinite(count) ? count : null,
      cost: Number.isFinite(price) ? price : null
    });
  });
  return map;
}

function qualityFromRank(rank, total){
  const r = Number(rank || 0);
  const t = Math.max(1, Number(total || 1));
  if (!r) return null;
  return Math.max(1, Math.round((1 - ((r - 1) / t)) * 100));
}

async function heroSmsCatalog(payload = {}){
  const force = !!payload.force;
  const cached = store.get('heroSms.catalog');
  const cachedTs = Number(store.get('heroSms.catalogTs') || 0);
  if (!force && Array.isArray(cached) && cached.length && Date.now() - cachedTs < 5 * 60 * 1000) {
    return { ok:true, countries: cached };
  }

  const service = String(payload.service || store.get('heroSms.service') || HERO_SMS_GOOGLE_SERVICE).trim() || HERO_SMS_GOOGLE_SERVICE;
  store.set('heroSms.service', service);
  const [offersRes, countriesRes] = await Promise.all([
    heroSmsApiFetch('/activations/offers', { services: service }),
    heroSmsHandlerFetch({ action:'getCountries' }, { json:true })
  ]);
  let topRes = await heroSmsHandlerFetch({ action:'getTopCountriesByServiceRank', service }, { json:true })
    .catch((e) => ({ ok:false, error:String(e?.message || e) }));
  if (!topRes.ok) {
    topRes = await heroSmsHandlerFetch({ action:'getTopCountriesByService', service }, { json:true })
      .catch((e) => ({ ok:false, error:String(e?.message || e) }));
  }

  if (!countriesRes.ok) return countriesRes;
  const countries = Array.isArray(countriesRes.data)
    ? countriesRes.data.reduce((acc, item) => { acc[String(item.id)] = item; return acc; }, {})
    : (countriesRes.data || {});
  const top = normalizeHeroSmsTopRows(topRes.ok ? topRes.data : null);
  const rows = [];
  const offers = offersRes.ok ? (offersRes.data?.data?.[service] || offersRes.data?.[service] || {}) : {};

  for (const [countryId, info] of Object.entries(offers || {})) {
    const name = heroSmsCountryName(countries, countryId);
    const topInfo = top.get(String(countryId)) || {};
    const cost = Number(info?.prices?.retail ?? info?.prices?.default ?? info?.prices?.min ?? topInfo.cost);
    const count = Number(info?.counts?.total ?? info?.counts?.physical ?? topInfo.count ?? 0);
    rows.push({
      id: String(name.id || countryId),
      rus: name.rus,
      eng: name.eng,
      cost: Number.isFinite(cost) ? cost : null,
      count: Number.isFinite(count) ? count : 0,
      success: Number.isFinite(Number(topInfo.success)) ? Number(topInfo.success) : null,
      quality: qualityFromRank(topInfo.rank, top.size || Object.keys(offers || {}).length),
      rank: topInfo.rank || null
    });
  }

  if (!rows.length) {
    const pricesRes = await heroSmsHandlerFetch({ action:'getPrices', service }, { json:true });
    if (!pricesRes.ok) return pricesRes;
    const prices = pricesRes.data || {};
    for (const [countryId, services] of Object.entries(prices || {})) {
      const info = services?.[service] || services;
      if (!info) continue;
      const name = heroSmsCountryName(countries, countryId);
      const topInfo = top.get(String(countryId)) || {};
      const cost = Number(info.cost ?? info.price ?? topInfo.cost);
      const count = Number(info.count ?? info.physicalCount ?? topInfo.count ?? 0);
      rows.push({
        id: String(name.id || countryId),
        rus: name.rus,
        eng: name.eng,
        cost: Number.isFinite(cost) ? cost : null,
        count: Number.isFinite(count) ? count : 0,
        success: Number.isFinite(Number(topInfo.success)) ? Number(topInfo.success) : null,
        quality: qualityFromRank(topInfo.rank, top.size || Object.keys(prices || {}).length),
        rank: topInfo.rank || null
      });
    }
  }

  rows.sort((a, b) => {
    const aq = Number.isFinite(Number(a.success)) ? Number(a.success) : Number(a.quality || -1);
    const bq = Number.isFinite(Number(b.success)) ? Number(b.success) : Number(b.quality || -1);
    if (bq !== aq) return bq - aq;
    const bc = Number(b.count || 0) - Number(a.count || 0);
    if (bc !== 0) return bc;
    return Number(a.cost || 9999) - Number(b.cost || 9999);
  });

  store.set('heroSms.catalog', rows);
  store.set('heroSms.catalogTs', Date.now());
  return { ok:true, countries: rows, source: offersRes.ok ? 'offers' : 'handler' };
}

function heroSmsGetActiveOrder(){
  const order = store.get('heroSms.activeOrder') || null;
  if (order?.expiresAtMs && Number(order.expiresAtMs) <= Date.now()) {
    store.set('heroSms.activeOrder', null);
    return null;
  }
  return order;
}

function normalizeHeroSmsActivations(data){
  const root = data && typeof data === 'object' ? data : {};
  const rows = (
    root.activeActivations
    || root.activations
    || root.data?.activeActivations
    || root.data?.activations
    || (Array.isArray(root.data) ? root.data : null)
    || (Array.isArray(root) ? root : null)
    || []
  );
  return (Array.isArray(rows) ? rows : Object.values(rows || {}))
    .map((row) => {
      const item = row && typeof row === 'object' ? row : {};
      return {
        id:String(item.activationId ?? item.activation_id ?? item.order_id ?? item.id ?? '').trim(),
        number:String(item.phoneNumber ?? item.phone_number ?? item.number ?? item.phone ?? '').trim(),
        service:String(item.serviceCode ?? item.service_code ?? item.service ?? '').trim(),
        country:String(item.countryCode ?? item.country_code ?? item.countryId ?? item.country_id ?? item.country ?? '').trim()
      };
    })
    .filter((item) => item.id);
}

async function heroSmsActiveActivations(){
  const result = await heroSmsHandlerFetch({ action:'getActiveActivations' }, { json:true });
  if (!result.ok) return { ok:false, error:result.error || 'Не удалось сверить активные HeroSMS-заказы' };
  return { ok:true, items:normalizeHeroSmsActivations(result.data) };
}

function heroSmsOrderFromActivation(activation, intent){
  const catalog = Array.isArray(store.get('heroSms.catalog')) ? store.get('heroSms.catalog') : [];
  const countryInfo = catalog.find((item) => String(item.id) === String(intent.country)) || {};
  const now = Date.now();
  return {
    order_id:String(activation.id),
    number:String(activation.number || ''),
    price:countryInfo.cost ?? '',
    country:String(intent.country),
    countryName:countryInfo.rus || countryInfo.eng || '',
    service:String(intent.service),
    provider:'herosms',
    ownerIdentity:normalizeHeroSmsOwnerIdentity(intent.ownerIdentity),
    expiresAtMs:now + 20 * 60 * 1000,
    createdAtMs:Number(intent.createdAtMs || now),
    recovered:true
  };
}

async function reconcileHeroSmsOrderIntent(){
  const intent = store.get('heroSms.orderIntent');
  if (!intent || typeof intent !== 'object') return { ok:true, order:null };
  if (!intent.baselineKnown) {
    return {
      ok:false,
      uncertain:true,
      error:'Предыдущий HeroSMS-заказ имеет неопределённый статус; проверь активные заказы у провайдера'
    };
  }
  const active = await heroSmsActiveActivations();
  if (!active.ok) return { ...active, uncertain:true };
  const baseline = new Set(Array.isArray(intent.baselineIds) ? intent.baselineIds.map(String) : []);
  const candidates = active.items.filter((item) => {
    if (baseline.has(item.id)) return false;
    if (item.service && intent.service && item.service !== String(intent.service)) return false;
    if (item.country && intent.country && item.country !== String(intent.country)) return false;
    return true;
  });
  if (candidates.length !== 1) {
    return {
      ok:false,
      uncertain:true,
      error:candidates.length > 1
        ? 'Найдено несколько новых HeroSMS-заказов; автоматическое сопоставление остановлено'
        : 'HeroSMS ещё не подтвердил предыдущий заказ; повторная покупка заблокирована'
    };
  }
  const order = heroSmsOrderFromActivation(candidates[0], intent);
  store.set('heroSms.activeOrder', order);
  store.set('heroSms.orderIntent', null);
  return { ok:true, order, recovered:true };
}

async function heroSmsBalance(){
  const res = await heroSmsHandlerFetch({ action:'getBalance' });
  if (!res.ok) return res;
  const text = res.text;
  if (text.startsWith('ACCESS_BALANCE:')) return { ok:true, balance: text.slice('ACCESS_BALANCE:'.length) };
  return { ok:false, error:heroSmsTranslate(text) };
}

async function heroSmsOrder(payload = {}){
  const ownerIdentity = normalizeHeroSmsOwnerIdentity(payload.ownerIdentity);
  if (!ownerIdentity.profileName) {
    return {
      ok:false,
      code:'HERO_SMS_OWNER_REQUIRED',
      error:'HeroSMS-заказ не привязан к профилю; покупка остановлена'
    };
  }
  const refundIntent = store.get('heroSms.refundIntent');
  if (refundIntent) {
    if (!sameHeroSmsOwnerIdentity(refundIntent.ownerIdentity, ownerIdentity)) {
      return {
        ok:false,
        code:'HERO_SMS_OWNER_MISMATCH',
        error:'Незавершённая отмена HeroSMS принадлежит другому профилю'
      };
    }
    const reconciledRefund = await reconcileHeroSmsRefundIntent(ownerIdentity);
    if (!(reconciledRefund.ok && reconciledRefund.canceled)) {
      return {
        ...reconciledRefund,
        ok:false,
        code:reconciledRefund.code || 'HERO_SMS_REFUND_PENDING'
      };
    }
  }
  const existingOrder = heroSmsGetActiveOrder();
  if (existingOrder) {
    if (!sameHeroSmsOwnerIdentity(existingOrder.ownerIdentity, ownerIdentity)) {
      return {
        ok:false,
        code:'HERO_SMS_OWNER_MISMATCH',
        error:'Активный HeroSMS-заказ принадлежит другому профилю'
      };
    }
    return { ok:true, order:existingOrder, idempotent:true };
  }
  const existingIntent = store.get('heroSms.orderIntent');
  if (existingIntent) {
    if (!sameHeroSmsOwnerIdentity(existingIntent.ownerIdentity, ownerIdentity)) {
      return {
        ok:false,
        code:'HERO_SMS_OWNER_MISMATCH',
        error:'Восстанавливаемый HeroSMS-заказ принадлежит другому профилю'
      };
    }
    const recovered = await reconcileHeroSmsOrderIntent();
    if (recovered.ok && recovered.order) return recovered;
    return recovered;
  }
  const country = String(payload.country || store.get('heroSms.country') || '0').trim() || '0';
  const service = String(payload.service || store.get('heroSms.service') || HERO_SMS_GOOGLE_SERVICE).trim() || HERO_SMS_GOOGLE_SERVICE;
  store.set('heroSms.country', country);
  store.set('heroSms.service', service);
  let baseline = { ok:false, items:[] };
  try {
    baseline = await heroSmsActiveActivations();
  } catch (_error) {}
  if (!baseline.ok) {
    return {
      ok:false,
      error:baseline.error || 'Не удалось безопасно сверить активные HeroSMS-заказы; покупка не отправлена',
      code:'HERO_SMS_BASELINE_UNAVAILABLE'
    };
  }
  const intent = {
    country,
    service,
    baselineKnown:true,
    baselineIds:baseline.items.map((item) => item.id),
    ownerIdentity,
    createdAtMs:Date.now()
  };
  store.set('heroSms.orderIntent', intent);
  let res;
  try {
    res = await heroSmsHandlerFetch({ action:'getNumber', service, country });
  } catch (error) {
    return {
      ok:false,
      uncertain:true,
      code:'HERO_SMS_ORDER_UNCERTAIN',
      error:`HeroSMS не подтвердил результат покупки: ${error?.message || error}. Повторная покупка заблокирована до сверки активных заказов.`
    };
  }
  const classified = classifyHeroSmsOrderResponse(res);
  if (classified.state === 'rejected') {
    store.set('heroSms.orderIntent', null);
    return {
      ok:false,
      code:classified.code || res.code || 'HERO_SMS_ORDER_REJECTED',
      error:heroSmsTranslate(classified.text || res.error)
    };
  }
  if (classified.state !== 'success') {
    return {
      ok:false,
      uncertain:true,
      code:'HERO_SMS_ORDER_UNCERTAIN',
      error:`HeroSMS вернул неопределённый ответ: ${heroSmsTranslate(classified.text || res.error)}. Повторная покупка заблокирована до сверки активных заказов.`
    };
  }
  const catalog = Array.isArray(store.get('heroSms.catalog')) ? store.get('heroSms.catalog') : [];
  const countryInfo = catalog.find((item) => String(item.id) === country) || {};
  const now = Date.now();
  const order = {
    order_id: classified.id,
    number: classified.number,
    price: countryInfo.cost ?? '',
    country,
    countryName: countryInfo.rus || countryInfo.eng || '',
    service,
    provider: 'herosms',
    ownerIdentity,
    expiresAtMs: now + 20 * 60 * 1000,
    createdAtMs: now
  };
  store.set('heroSms.activeOrder', order);
  store.set('heroSms.orderIntent', null);
  return { ok:true, order };
}

async function heroSmsCheck(payload = {}){
  const id = String(payload.orderId || payload.order_id || '').trim();
  if (!id) return { ok:false, error:'Не указан ID активации' };
  const ownerIdentity = normalizeHeroSmsOwnerIdentity(payload.ownerIdentity);
  const activeOrder = heroSmsGetActiveOrder();
  if (!ownerIdentity.profileName) {
    return { ok:false, code:'HERO_SMS_OWNER_REQUIRED', error:'Не указан владелец HeroSMS-заказа' };
  }
  if (!activeOrder || String(activeOrder.order_id || '') !== id) {
    return { ok:false, code:'HERO_SMS_ORDER_MISMATCH', error:'HeroSMS-заказ не совпадает с активным заказом' };
  }
  if (!sameHeroSmsOwnerIdentity(activeOrder.ownerIdentity, ownerIdentity)) {
    return { ok:false, code:'HERO_SMS_OWNER_MISMATCH', error:'HeroSMS-заказ принадлежит другому профилю' };
  }
  const res = await heroSmsHandlerFetch({ action:'getStatus', id });
  if (!res.ok) return res;
  const text = res.text;
  if (text.startsWith('STATUS_OK:')) {
    const sms = text.slice('STATUS_OK:'.length).trim();
    return { ok:true, status:'completed', sms, full_sms:sms };
  }
  if (text === 'STATUS_CANCEL') {
    const latest = store.get('heroSms.activeOrder');
    if (
      String(latest?.order_id || '') === id
      && sameHeroSmsOwnerIdentity(latest?.ownerIdentity, ownerIdentity)
    ) store.set('heroSms.activeOrder', null);
    return { ok:true, status:text, sms:'0', full_sms:'', message:heroSmsTranslate(text) };
  }
  if (text.startsWith('STATUS_WAIT')) {
    return { ok:true, status:text, sms:'0', full_sms:'', message:heroSmsTranslate(text) };
  }
  return { ok:false, error:heroSmsTranslate(text) };
}

function clearHeroSmsCanceledOrder(id, ownerIdentity) {
  const activeOrder = store.get('heroSms.activeOrder');
  if (
    String(activeOrder?.order_id || '') === String(id || '')
    && sameHeroSmsOwnerIdentity(activeOrder?.ownerIdentity, ownerIdentity)
  ) {
    store.set('heroSms.activeOrder', null);
  }
  const refundIntent = store.get('heroSms.refundIntent');
  if (
    String(refundIntent?.orderId || '') === String(id || '')
    && sameHeroSmsOwnerIdentity(refundIntent?.ownerIdentity, ownerIdentity)
  ) {
    store.set('heroSms.refundIntent', null);
  }
}

async function reconcileHeroSmsRefundIntent(ownerIdentity = null) {
  const intent = store.get('heroSms.refundIntent');
  if (!intent || typeof intent !== 'object') return { ok:true, canceled:false };
  if (
    ownerIdentity
    && !sameHeroSmsOwnerIdentity(intent.ownerIdentity, ownerIdentity)
  ) {
    return {
      ok:false,
      code:'HERO_SMS_OWNER_MISMATCH',
      error:'Отмена HeroSMS принадлежит другому профилю'
    };
  }
  let result;
  try {
    result = await heroSmsHandlerFetch({
      action:'getStatus',
      id:String(intent.orderId || '')
    });
  } catch (error) {
    return {
      ok:false,
      uncertain:true,
      error:`Не удалось сверить отмену HeroSMS: ${error?.message || error}`
    };
  }
  const classified = classifyHeroSmsRefundResponse(result);
  if (classified.state === 'canceled') {
    clearHeroSmsCanceledOrder(intent.orderId, intent.ownerIdentity);
    store.set('heroSms.orderIntent', null);
    return { ok:true, canceled:true, reconciled:true };
  }
  if (!result.ok) {
    return {
      ok:false,
      uncertain:true,
      error:result.error || 'Не удалось сверить отмену HeroSMS'
    };
  }
  return {
    ok:false,
    pending:true,
    canRetry:true,
    error:'HeroSMS ещё не подтвердил отмену заказа'
  };
}

async function heroSmsRefund(payload = {}){
  const id = String(payload.orderId || payload.order_id || '').trim();
  if (!id) return { ok:false, error:'Не указан ID активации' };
  const ownerIdentity = normalizeHeroSmsOwnerIdentity(payload.ownerIdentity);
  if (!ownerIdentity.profileName) {
    return { ok:false, code:'HERO_SMS_OWNER_REQUIRED', error:'Не указан владелец HeroSMS-заказа' };
  }
  const activeOrder = store.get('heroSms.activeOrder');
  if (
    !activeOrder
    || String(activeOrder.order_id || '') !== id
    || !sameHeroSmsOwnerIdentity(activeOrder.ownerIdentity, ownerIdentity)
  ) {
    const pendingIntent = store.get('heroSms.refundIntent');
    if (
      !pendingIntent
      || String(pendingIntent.orderId || '') !== id
      || !sameHeroSmsOwnerIdentity(pendingIntent.ownerIdentity, ownerIdentity)
    ) {
      return {
        ok:false,
        code:'HERO_SMS_ORDER_MISMATCH',
        error:'Отменяется не тот HeroSMS-заказ или заказ принадлежит другому профилю'
      };
    }
  }

  const existingIntent = store.get('heroSms.refundIntent');
  if (existingIntent) {
    if (
      String(existingIntent.orderId || '') !== id
      || !sameHeroSmsOwnerIdentity(existingIntent.ownerIdentity, ownerIdentity)
    ) {
      return {
        ok:false,
        code:'HERO_SMS_REFUND_IN_PROGRESS',
        error:'Уже восстанавливается отмена другого HeroSMS-заказа'
      };
    }
    const reconciled = await reconcileHeroSmsRefundIntent(ownerIdentity);
    if (reconciled.ok && reconciled.canceled) {
      return { ok:true, message:'HeroSMS подтвердил отмену', reconciled:true };
    }
    if (!reconciled.canRetry) return reconciled;
  } else {
    store.set('heroSms.refundIntent', {
      orderId:id,
      ownerIdentity,
      status:'pending',
      createdAtMs:Date.now()
    });
  }

  let res;
  try {
    res = await heroSmsHandlerFetch({ action:'setStatus', id, status:8 });
  } catch (error) {
    return {
      ok:false,
      uncertain:true,
      code:'HERO_SMS_REFUND_UNCERTAIN',
      error:`HeroSMS не подтвердил отмену: ${error?.message || error}`
    };
  }
  const classified = classifyHeroSmsRefundResponse(res);
  if (classified.state !== 'canceled') {
    return {
      ok:false,
      uncertain:true,
      code:'HERO_SMS_REFUND_UNCERTAIN',
      error:heroSmsTranslate(classified.text || classified.error)
    };
  }
  clearHeroSmsCanceledOrder(id, ownerIdentity);
  store.set('heroSms.orderIntent', null);
  return { ok:true, message:heroSmsTranslate(classified.text) };
}

async function heroSmsHandle(action, payload = {}){
  const name = String(action || '').trim();
  try {
    if (name === 'setApiKey') return setHeroSmsApiKey(payload.key || payload.apiKey || payload.value);
    if (name === 'Catalog') return heroSmsCatalog(payload);
    if (name === 'Balance') return heroSmsBalance();
    if (name === 'Order') return heroSmsOrder(payload);
    if (name === 'Check') return heroSmsCheck(payload);
    if (name === 'Refund') return heroSmsRefund(payload);
    if (name === 'GetState') {
      let order = heroSmsGetActiveOrder();
      const requestedOwner = normalizeHeroSmsOwnerIdentity(payload.ownerIdentity);
      if (store.get('heroSms.refundIntent')) {
        const refund = await reconcileHeroSmsRefundIntent(
          requestedOwner.profileName ? requestedOwner : null
        );
        if (refund.ok && refund.canceled) order = null;
      }
      if (!order && store.get('heroSms.orderIntent')) {
        const recovered = await reconcileHeroSmsOrderIntent();
        if (recovered.ok) order = recovered.order;
        else return { ...recovered, order:null };
      }
      if (
        order
        && requestedOwner.profileName
        && !sameHeroSmsOwnerIdentity(order.ownerIdentity, requestedOwner)
      ) {
        return {
          ok:false,
          code:'HERO_SMS_OWNER_MISMATCH',
          error:'Активный HeroSMS-заказ принадлежит другому профилю',
          order:null
        };
      }
      return {
        ok:true,
        order,
        ownerUnknown:!!order && !normalizeHeroSmsOwnerIdentity(order.ownerIdentity).profileName,
        refundPending:!!store.get('heroSms.refundIntent')
      };
    }
    return { ok:false, error:'Неизвестное действие HeroSMS' };
  } catch (e) {
    return { ok:false, error:String(e?.message || e) };
  }
}

function normalizeSettings(input){
  const raw = input && typeof input === 'object' ? input : {};
  const next = {
    theme: normalizeTheme(raw.theme),
    zoom: clamp(Number(raw.zoom || 1), 0.7, 1.6),
    fontScale: clamp(Number(raw.fontScale || 1), 0.75, 1.45),
    alwaysOnTop: !!raw.alwaysOnTop,
    graphicsMode: raw.graphicsMode === 'lite' ? 'lite' : 'ultra',
    contrastMode: !!raw.contrastMode,
    classicTrafficLights: !!raw.classicTrafficLights,
    mccVerificationInline: raw.mccVerificationInline !== false,
    mccValidityInline: raw.mccValidityInline !== false,
    statCardGlow: raw.statCardGlow !== false,
    smsService: raw.smsService === 'herosms' ? 'herosms' : 'smspool',
    customThemeId: String(raw.customThemeId || '').trim(),
    customThemes: Array.isArray(raw.customThemes) ? raw.customThemes.slice(0, 24).map((item) => ({
      id: String(item?.id || '').trim(),
      name: String(item?.name || 'Своя тема').trim().slice(0, 40),
      vars: item?.vars && typeof item.vars === 'object' ? item.vars : {},
      backgroundImage: String(item?.backgroundImage || '').trim()
    })).filter((item) => item.id) : []
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
  return { ...next, runtimeSessionId: RUNTIME_SESSION_ID };
}

const auxWindowDrag = new Map();

function startAuxWindowDrag(sender, point){
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) return false;
  auxWindowDrag.set(sender.id, {
    x: Number(point?.x || 0),
    y: Number(point?.y || 0),
    bounds: win.getBounds()
  });
  return true;
}

function moveAuxWindowDrag(sender, point){
  const state = auxWindowDrag.get(sender.id);
  const win = BrowserWindow.fromWebContents(sender);
  if (!state || !win || win.isDestroyed()) return false;
  const next = clampToWorkArea({
    ...state.bounds,
    x: Math.round(state.bounds.x + Number(point?.x || 0) - state.x),
    y: Math.round(state.bounds.y + Number(point?.y || 0) - state.y)
  });
  win.setBounds(next, false);
  return true;
}

function endAuxWindowDrag(sender){
  auxWindowDrag.delete(sender.id);
  return true;
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

  if (payload.kind === 'extra-work' || payload.workType || Object.prototype.hasOwnProperty.call(payload, 'deltaClicks')) {
    const deltaPoints = Number(payload.deltaPoints ?? payload.delta ?? 0);
    const deltaClicks = Number(payload.deltaClicks ?? payload.count ?? 0);
    if (!deltaPoints && !deltaClicks) return null;
    const type = String(payload.workType || payload.key || 'custom').trim() || 'custom';
    return { deltaPoints, deltaClicks, newScore: { type }, oldScore: { type } };
  }

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

async function chooseCustomThemeBackground(){
  const owner = (settingsWindow && !settingsWindow.isDestroyed()) ? settingsWindow : mainWindow;
  const res = await dialog.showOpenDialog(owner, {
    title: 'Выбери фон темы',
    properties: ['openFile'],
    filters: [
      { name: 'Картинки', extensions: ['jpg', 'jpeg', 'png'] }
    ]
  });
  if (res.canceled || !Array.isArray(res.filePaths) || !res.filePaths[0]) return { ok:true, canceled:true, path:'' };
  return { ok:true, canceled:false, path:res.filePaths[0] };
}

function applySettings(next){
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(!!next.alwaysOnTop);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.setZoomFactor(next.zoom || 1); } catch(e) {}
  }
  const payload = { ...next, runtimeSessionId: RUNTIME_SESSION_ID };
  safeSend(mainWindow, 'sproutg:apply-settings', payload);
  safeSend(settingsWindow, 'sproutg:apply-settings', payload);
  safeSend(statsWindow, 'sproutg:apply-settings', payload);
  safeSend(companyWindow, 'sproutg:apply-settings', payload);
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

let shutdownPromise = null;
function shutdownApp(){
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const barrier = await beginWriteBarrier('shutdown', 30000);
    if (!barrier?.ok) {
      notifyWriteBarrierFailure(barrier, 'Закрытие отменено');
      shutdownPromise = null;
      isQuitting = false;
      return { ok:false, error:barrier?.error };
    }
    isQuitting = true;
    try {
      if (writeQueueController) await writeQueueController.drain(3000);
    } catch (_error) {}
    const queueState = writeQueueController?.getState?.() || {};
    if (queueState.integrityBlocked || queueState.persistenceDirty) {
      isQuitting = false;
      shutdownPromise = null;
      releaseWriteBarrier(barrier.barrierToken);
      const result = {
        ok:false,
        error:queueState.restoreError || queueState.lastError || 'Локальная очередь не записана на диск'
      };
      notifyWriteBarrierFailure(result, 'Закрытие отменено');
      return result;
    }
    try { await flushGoogleSession(); } catch (_error) {}
    destroyAuxiliaryWindows();
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    } catch (_error) {}
    quitApproved = true;
    app.quit();
    setTimeout(() => {
      try { app.exit(0); } catch (_error) {}
    }, 1200);
    return { ok:true };
  })();
  return shutdownPromise;
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

function requestWindowWriteBarrier(win, reason, timeoutMs = 30000, context = {}){
  if (
    !win
    || win.isDestroyed()
    || !win.webContents
    || win.webContents.isDestroyed()
    || (typeof win.webContents.isLoadingMainFrame === 'function'
      && win.webContents.isLoadingMainFrame())
  ) {
    return Promise.resolve({ ok:true, skipped:true });
  }
  const id = `barrier-${Date.now()}-${++writeBarrierSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      writeBarrierWaiters.delete(id);
      resolve({
        ok:false,
        error:'Интерфейс не подтвердил сохранение последних изменений'
      });
    }, Math.max(1000, Number(timeoutMs || 30000)));
    writeBarrierWaiters.set(id, {
      senderId:win.webContents.id,
      resolve:(result) => {
        clearTimeout(timer);
        resolve(result);
      }
    });
    if (!safeSend(win, 'sproutg:prepare-write-barrier', {
      id,
      reason:String(reason || 'operation'),
      timeoutMs:Math.max(1000, Number(timeoutMs || 30000)) - 500,
      allowDurableFailures:context.allowDurableFailures === true
    })) {
      clearTimeout(timer);
      writeBarrierWaiters.delete(id);
      resolve({ ok:false, error:'Не удалось запросить сохранение интерфейса' });
    }
  });
}

async function requestRendererWriteBarrier(reason, timeoutMs = 30000, context = {}){
  const targets = [mainWindow, companyWindow]
    .filter((win, index, list) => win && list.indexOf(win) === index);
  const results = await Promise.all(
    targets.map((win) => requestWindowWriteBarrier(win, reason, timeoutMs, context))
  );
  const failed = results.find((result) => !result?.ok);
  if (failed) return failed;
  return results.reduce((merged, result) => ({
    ...merged,
    ...(result || {}),
    ok:true
  }), { ok:true });
}

function releaseRendererWriteBarriers(){
  safeSend(mainWindow, 'sproutg:release-write-barrier', {});
  safeSend(companyWindow, 'sproutg:release-write-barrier', {});
}

async function beginWriteBarrier(reason, timeoutMs = 30000, context = {}){
  if (writeBarrierState !== 'open') {
    return { ok:false, error:'Другая операция сохранения уже выполняется' };
  }
  const barrierToken = `owner-${Date.now()}-${++writeBarrierSeq}`;
  const startedAt = Date.now();
  writeBarrierState = 'preparing';
  activeWriteBarrierToken = barrierToken;
  const result = await requestRendererWriteBarrier(reason, timeoutMs, context);
  if (!result?.ok) {
    if (activeWriteBarrierToken === barrierToken) {
      writeBarrierState = 'open';
      activeWriteBarrierToken = '';
    }
    releaseRendererWriteBarriers();
    return result || { ok:false, error:'Не удалось сохранить последние изменения' };
  }
  if (activeWriteBarrierToken !== barrierToken) {
    return { ok:false, error:'Барьер сохранения был отменён' };
  }
  writeGateClosed = true;
  const directMutationPending = await directMutationRegistry.drain(
    Math.max(0, Number(timeoutMs || 30000) - (Date.now() - startedAt))
  );
  if (directMutationPending > 0) {
    writeGateClosed = false;
    writeBarrierState = 'open';
    activeWriteBarrierToken = '';
    releaseRendererWriteBarriers();
    return {
      ok:false,
      error:`Не завершены прямые операции записи: ${directMutationPending}`
    };
  }
  try {
    await flushRendererStorageData();
  } catch (error) {
    writeGateClosed = false;
    writeBarrierState = 'open';
    activeWriteBarrierToken = '';
    releaseRendererWriteBarriers();
    return {
      ok:false,
      error:`Локальные черновики не удалось записать на диск: ${error?.message || error}`
    };
  }
  writeBarrierState = 'closed';
  return { ...result, barrierToken };
}

function releaseWriteBarrier(barrierToken){
  if (!barrierToken || barrierToken !== activeWriteBarrierToken) return false;
  writeGateClosed = false;
  writeBarrierState = 'open';
  activeWriteBarrierToken = '';
  releaseRendererWriteBarriers();
  return true;
}

function notifyWriteBarrierFailure(result, title = 'Операция отменена'){
  safeSend(mainWindow, 'sproutg:notice', {
    type:'error',
    title,
    body:result?.error || 'Не все последние изменения удалось сохранить',
    durationMs:9000
  });
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
  companyWindow.__sproutgCloseApproved = true;
  return closeWindowAnimated(companyWindow);
}

function openCompanyWindow(){
  if (!mainWindow) return;

  if (companyWindow && !companyWindow.isDestroyed()) {
    if (companyWindow.isVisible()) {
      safeSend(companyWindow, 'sproutg:native-close-request', {});
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
  companyWindow.on('close', (event) => {
    _saveCompanyBounds();
    if (companyWindow?.__sproutgCloseApproved) return;
    event.preventDefault();
    safeSend(companyWindow, 'sproutg:native-close-request', {});
  });
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
    reloadBridgeAfterLogin().catch(() => {});
  });
  return true;
}

async function reloadBridgeAfterLogin(){
  if (!bridgeManager) return false;
  const barrier = await beginWriteBarrier('bridge-login-reload', 30000, {
    allowDurableFailures:true
  });
  if (!barrier?.ok) {
    notifyWriteBarrierFailure(barrier, 'Переподключение Google отложено');
    return false;
  }
  try {
    bridgeManager.reload();
    return true;
  } finally {
    releaseWriteBarrier(barrier.barrierToken);
  }
}

function toggleAOT(){
  const next = setSettings({ alwaysOnTop: !getSettings().alwaysOnTop });
  applySettings(next);
  return next;
}
function performWebReload({ reloadBridge = true } = {}){
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  if (reloadBridge && bridgeManager) bridgeManager.reload();
}
async function reloadWeb(reason = 'reload'){
  const barrier = await beginWriteBarrier(reason, 30000);
  if (!barrier?.ok) {
    notifyWriteBarrierFailure(barrier, 'Перезагрузка отменена');
    return { ok:false, error:barrier?.error || 'Не удалось сохранить последние изменения' };
  }
  try {
    performWebReload({ reloadBridge:false });
    return { ok:true };
  } finally {
    releaseWriteBarrier(barrier.barrierToken);
  }
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

  mainWindow.webContents.on('did-finish-load', () => {
    applySettings(getSettings());
    notifyStorageIntegrity();
  });
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
  writeQueueController = registerApiIpc(ipcMain, bridgeManager, store, {
    walPath:DURABLE_WAL_PATH,
    getEndpointKey: () => bridgeManager?.getEndpointKey?.() || getWebUrl() || '',
    isWriteGateClosed: () => writeGateClosed,
    getStorageIntegrity:() => publicStorageIntegrity(),
    getWriteIntegrityBlock: () => (
      storageIntegrity.sheetWritesBlocked
        ? publicStorageIntegrity()
        : null
    ),
    confirmArchiveBlocked:async ({ state }) => {
      const blocked = Math.max(0, Number(state?.blocked || 0));
      const messageBoxOptions = {
        type:'warning',
        title:'Архивация блокированных записей',
        message:`Архивировать ${blocked} блокированных записей и причинно зависимые изменения?`,
        detail:'Сначала будет создан и проверен локальный архив. После этого записи будут удалены из активной очереди и больше не отправятся автоматически.',
        buttons:['Отмена', 'Архивировать'],
        defaultId:0,
        cancelId:0,
        noLink:true
      };
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showMessageBox(mainWindow, messageBoxOptions)
        : await dialog.showMessageBox(messageBoxOptions);
      return result.response === 1;
    },
    trackMutation: (work) => directMutationRegistry.run(work),
    onQueueState: (state) => {
      if (bridgeManager) {
        bridgeManager.setWriteQueueState({
          ...state,
          storageIntegrity:publicStorageIntegrity()
        });
      }
    }
  });
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
app.on('before-quit', (event) => {
  if (!quitApproved) {
    event.preventDefault();
    shutdownApp();
    return;
  }
  isQuitting = true;
  flushGoogleSession();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* IPC */
ipcMain.on('sproutg:write-barrier-result', (event, payload) => {
  const id = String(payload?.id || '');
  const waiter = writeBarrierWaiters.get(id);
  if (!waiter || event.sender.id !== waiter.senderId) return;
  writeBarrierWaiters.delete(id);
  waiter.resolve({
    ...payload,
    id,
    ok:payload?.ok === true
  });
});

ipcMain.handle('sproutg:get-version', () => app.getVersion());
ipcMain.handle('sproutg:get-work-session', () => loadWorkSession(path.join(USER_DATA_DIR, 'work-session.json'), getWebUrl()));
ipcMain.on('sproutg:save-work-session', (event, snapshot) => {
  if(event.sender !== mainWindow?.webContents) return;
  try { saveWorkSession(path.join(USER_DATA_DIR, 'work-session.json'), getWebUrl(), snapshot); }
  catch(error) { console.error('[SproutG] Cannot save work session', error); }
});
ipcMain.handle('sproutg:get-storage-integrity', () => publicStorageIntegrity());
ipcMain.handle('sproutg:get-update-state', () => ({ ...updateState, version: app.getVersion(), isPackaged: app.isPackaged }));
ipcMain.handle('sproutg:check-for-updates', () => checkForUpdates(true));
ipcMain.handle('sproutg:download-update', () => downloadUpdate());
ipcMain.handle('sproutg:install-update', () => installDownloadedUpdate());
ipcMain.handle('sproutg:get-rollback-info', () => getRollbackInfo(false));
ipcMain.handle('sproutg:rollback-update', () => rollbackToPreviousVersion());
ipcMain.handle('sproutg:hero-sms', (_e, action, payload) => {
  const mutation = isHeroSmsStateMutation(action);
  if (storageIntegrity.heroSmsBlocked && mutation) {
    return {
      ok:false,
      error:'Операция HeroSMS заблокирована: локальное хранилище повреждено, исход финансовой операции нельзя доказать безопасно',
      code:'LOCAL_STORE_INTEGRITY_BLOCKED'
    };
  }
  if (writeGateClosed && mutation) {
    return {
      ok:false,
      error:'Операция временно остановлена: приложение завершает сохранение данных',
      code:'WRITE_GATE_CLOSED'
    };
  }
  return mutation
    ? directMutationRegistry.run(() => heroSmsHandle(action, payload || {}))
    : heroSmsHandle(action, payload || {});
});
ipcMain.handle('sproutg:get-settings', () => getSettings());
ipcMain.handle('sproutg:set-setting', (_e, partial) => { const n = setSettings(partial); applySettings(n); return getSettings(); });
ipcMain.handle('sproutg:choose-custom-theme-bg', () => chooseCustomThemeBackground());
ipcMain.handle('sproutg:zoom', (_e, dir) => zoom(dir));
ipcMain.handle('sproutg:toggle-aot', () => toggleAOT());
ipcMain.handle('sproutg:reload-web', () => reloadWeb('manual-reload'));
ipcMain.handle('sproutg:reconnect-bridge', async () => {
  const ok = await reloadBridgeAfterLogin();
  return ok
    ? { ok:true }
    : { ok:false, error:'Не удалось безопасно переподключить Google Таблицу' };
});
ipcMain.handle('sproutg:close-settings-window', () => closeSettingsWindow());
ipcMain.handle('sproutg:close-stats-window', () => closeStatsWindow());
ipcMain.handle('sproutg:close-company-window', () => closeCompanyWindow());
ipcMain.handle('sproutg:aux-window-drag-start', (event, point) => startAuxWindowDrag(event.sender, point));
ipcMain.handle('sproutg:aux-window-drag-move', (event, point) => moveAuxWindowDrag(event.sender, point));
ipcMain.handle('sproutg:aux-window-drag-end', (event) => endAuxWindowDrag(event.sender));
ipcMain.handle('sproutg:get-storage-info', () => getStorageInfo());

ipcMain.handle('sproutg:clear-cache', async () => {
  const barrier = await beginWriteBarrier('clear-cache', 30000);
  if (!barrier?.ok) {
    notifyWriteBarrierFailure(barrier, 'Очистка кэша отменена');
    return { ok:false, error:barrier?.error };
  }
  try {
    const pending = writeQueueController ? await writeQueueController.drain(30000) : 0;
    if (pending > 0) {
      return {
        ok:false,
        error:`Очистка остановлена: в очереди ${pending} несохранённых записей`
      };
    }
    const s = getSession();
    await s.clearCache();
    await flushGoogleSession();
    performWebReload();
    return { ok:true };
  } finally {
    releaseWriteBarrier(barrier.barrierToken);
  }
});
ipcMain.handle('sproutg:logout', async () => {
  const barrier = await beginWriteBarrier('logout', 30000);
  if (!barrier?.ok) return { ok:false, error:barrier?.error };
  try {
    const pending = writeQueueController ? await writeQueueController.drain(30000) : 0;
    if (pending > 0) {
      return {
        ok:false,
        error:`Выход остановлен: в очереди ${pending} несохранённых записей`
      };
    }
    await getSession().clearStorageData({ storages:['cookies','localstorage','indexdb','serviceworkers','caches'] });
    store.set('points', { days: {}, workDays: {} });
    store.set('statusState', {});
    if (statsWindow && !statsWindow.isDestroyed()) statsWindow.webContents.send('sproutg:points-updated', getPoints());
    setTimeout(() => { try { statsWindow && !statsWindow.isDestroyed() && statsWindow.webContents.send('sproutg:points-updated', getPoints()); } catch(e){} }, 80);
    performWebReload();
    return { ok:true };
  } finally {
    releaseWriteBarrier(barrier.barrierToken);
  }
});

ipcMain.handle('sproutg:open-settings', () => { openSettingsWindow(); return true; });

ipcMain.handle('sproutg:open-stats', () => { openStatsWindow(); return true; });
ipcMain.handle('sproutg:open-company', () => { openCompanyWindow(); return true; });
ipcMain.handle('sproutg:get-points', () => getPoints());
ipcMain.handle('sproutg:open-url', (_e, firstRun) => { openUrlWindow(!!firstRun); return true; });
ipcMain.handle('sproutg:open-bridge-login', () => openBridgeLoginWindow());

ipcMain.handle('sproutg:set-web-url', async (_e, input) => {
  const url = normalizeWebUrl(input);
  if (!url) return { ok:false, error:'Неверный URL или ID' };
  const initialEndpointBinding = !getWebUrl();
  const barrier = await beginWriteBarrier('change-endpoint', 30000, {
    allowDurableFailures:initialEndpointBinding
  });
  if (!barrier?.ok) return { ok:false, error:barrier?.error };
  try {
    const boundConflicts = writeQueueController
      ? writeQueueController.hasBoundPendingForEndpointChange(url)
      : 0;
    if (boundConflicts > 0) {
      return {
        ok:false,
        code:'PENDING_WRITES_ENDPOINT_MISMATCH',
        error:`Нельзя сменить таблицу: ${boundConflicts} записей ещё привязаны к текущему Apps Script`
      };
    }
    const binding = writeQueueController
      ? writeQueueController.bindUnboundToEndpoint(url)
      : { ok:true, bound:0 };
    if (!binding.ok) return { ok:false, code:'WRITE_QUEUE_BIND_FAILED', error:binding.error };
    const blocked = writeQueueController
      ? writeQueueController.hasPendingForEndpointChange(url)
      : 0;
    if (blocked > 0) {
      return {
        ok:false,
        code:'PENDING_WRITES_ENDPOINT_MISMATCH',
        error:`Нельзя сменить таблицу: ${blocked} записей ещё привязаны к текущему Apps Script`
      };
    }
    store.set('web.url', url);
    if (bridgeManager) loadWeb(url);
    if (urlWindow && !urlWindow.isDestroyed()) urlWindow.close();
    return { ok:true, url };
  } finally {
    releaseWriteBarrier(barrier.barrierToken);
  }
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

}
