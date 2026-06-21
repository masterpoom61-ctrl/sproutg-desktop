const { app, BrowserWindow, BrowserView, ipcMain, Menu, session, screen, globalShortcut } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
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
    
    ui: { statsBounds: null },
points: { days: {}, workDays: {} },
    statusState: {},
    settings: { theme: 'dark', zoom: 1.0, alwaysOnTop: false },
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
let lastSettingsToggleAt = 0;
let lastStatsToggleAt = 0;
let view = null;
let bridgeManager = null;
let settingsWindow = null;
let statsWindow = null;
let urlWindow = null;
let bridgeLoginWindow = null;
let statsSaveTimer = null;
let ses = null;

function getSession(){
  if (!ses) ses = session.fromPartition(PARTITION);
  return ses;
}

const UPDATE_PLACEHOLDER_RE = /^(CHANGE_ME|YOUR_|OWNER_|REPO_|example$)/i;
let updaterConfigured = false;
let updaterCheckInFlight = false;
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

function broadcastUpdateState(){
  const payload = { ...updateState, version: app.getVersion(), isPackaged: app.isPackaged };
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sproutg:update-state', payload); } catch(e) {}
  try { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('sproutg:update-state', payload); } catch(e) {}
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

  // If owner/repo are configured in sproutg.config.json, use them explicitly.
  // If they are left as placeholders, electron-updater falls back to app-update.yml
  // generated by electron-builder after you replace publish.owner/repo before release build.
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
  setUpdateState({ status: 'checking', message: 'Проверяем обновления…', error: null, progress: null });
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
});

autoUpdater.on('update-not-available', (info) => {
  const installed = 'v' + String(app.getVersion()).replace(/^v/i, '');
  setUpdateState({
    status: 'not-available',
    message: `Установлена последняя версия: ${installed}`,
    availableVersion: info?.version || null,
    downloaded: false,
    error: null,
    progress: null
  });
});

autoUpdater.on('download-progress', (p) => {
  const percent = Math.round(Number(p?.percent || 0));
  setUpdateState({ status: 'downloading', message: 'Скачивание обновления… ' + percent + '%', progress: p || null, error: null });
});

autoUpdater.on('update-downloaded', (info) => {
  const availableVersion = info?.version || updateState.availableVersion || '';
  const v = 'v' + String(availableVersion).replace(/^v/i, '');
  setUpdateState({ status: 'downloaded', message: `Обновление ${v} загружено и готово к установке`, availableVersion, downloaded: true, progress: null, error: null });
});

autoUpdater.on('error', (err) => {
  const msg = err?.message || String(err || 'Неизвестная ошибка обновления');
  setUpdateState({ status: 'error', message: 'Ошибка обновления', error: msg, progress: null });
});

async function checkForUpdates(manual){
  if (!app.isPackaged) {
    return setUpdateState({ status: 'dev', message: 'Проверка обновлений работает только в установленной сборке Windows', error: null });
  }
  if (updaterCheckInFlight) return updateState;
  if (!configureAutoUpdater()) return updateState;

  updaterCheckInFlight = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    setUpdateState({ status: 'error', message: 'Не удалось проверить обновления', error: e?.message || String(e) });
  } finally {
    updaterCheckInFlight = false;
  }
  return updateState;
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

function getSettings(){ return store.get('settings'); }
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

  if (pageN === 'O1'){
    if (grp.includes('аккаунт') && isNumC) return { type: 'Аккаунт (O1)', points: 60, clicks: 1 };
    if (grp.includes('ads') && grp.includes('видео') && plus) return { type: 'Ads Видео (O1)', points: 25, clicks: 1 };
    if (grp.includes('платеж') && plus) return { type: 'Платежка (O1)', points: 50, clicks: 1 };
    if (grp.includes('речек') && plus) return { type: 'Речек (O1)', points: 10, clicks: 1 };
    if ((grp === 'рк' || grp.includes(' рк') || grp.includes('рк ')) && plus) return { type: 'РК (O1)', points: 20, clicks: 1 };
    if (grp.includes('вериф') && (isSuccess || isReject)) return { type: 'Верификации (O1+MCC)', points: (isSuccess ? 50 : 10), clicks: 1 };
    if ((isAppeal && plus) || isAppealAction) return { type: 'Апелляции O1', points: 25, clicks: 1 };
    if (isMini && plus) return { type: 'Мини (O1+MCC)', points: 25, clicks: 1 };
  }

  if (pageN === 'MCC'){
    if (isAccMcc){
      if (plus) return { type: 'Аккаунт MCC (MCC)', points: 100, clicks: 1 };
      if (v === 'вышел') return { type: 'Аккаунт MCC (MCC)', points: 50, clicks: 1 };
      if (v.replace(/\s+/g,'') === 'вышел/невышел' || v === 'вышел/не вышел' || v === 'не вышел') return { type: 'Аккаунт MCC (MCC)', points: 25, clicks: 1 };
    }
    if (grp.includes('речек') && plus) return { type: 'Речек (MCC)', points: 10, clicks: 1 };
    if (grp.includes('вериф') && (isSuccess || isReject)) return { type: 'Верификации (O1+MCC)', points: (isSuccess ? 50 : 10), clicks: 1 };
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

  days[k].total = Number(days[k].total || 0) + Number(res.deltaPoints || 0);

  const bucket = res.newScore?.type || payload?.key || 'custom';
  days[k].byKey[bucket] = Number(days[k].byKey[bucket] || 0) + Number(res.deltaPoints || 0);

  workDays[k].total = Number(workDays[k].total || 0) + Number(res.deltaClicks || 0);
  const t = res.newScore?.type;
  if (t){
    workDays[k].byType[t] = Number(workDays[k].byType[t] || 0) + Number(res.deltaClicks || 0);
  }

  points.days = days;
  points.workDays = workDays;
  setPoints(points);

  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.webContents.send('sproutg:points-updated', points);
  }
  return points;
}


function setSettings(partial){
  const cur = getSettings();
  const next = { ...cur, ...(partial || {}) };
  next.zoom = clamp(Number(next.zoom || 1), 0.7, 1.6);
  next.theme = (next.theme === 'light') ? 'light' : 'dark';
  next.alwaysOnTop = !!next.alwaysOnTop;
  store.set('settings', next);
  return next;
}

function applySettings(next){
  if (mainWindow) mainWindow.setAlwaysOnTop(!!next.alwaysOnTop);
  if (mainWindow) {
    try { mainWindow.webContents.setZoomFactor(next.zoom || 1); } catch(e) {}
  }
  if (view) view.webContents.setZoomFactor(next.zoom || 1);
  if (mainWindow) mainWindow.webContents.send('sproutg:apply-settings', next);
  if (settingsWindow) settingsWindow.webContents.send('sproutg:apply-settings', next);
  if (view) view.webContents.send('sproutg:desktop-settings', next);
  postSettingsToWeb(next);
}

  
function postMessageToWebFrames(msg){
  if(!view || view.isDestroyed?.()) return;
  try{
    const msgJson = JSON.stringify(msg || {});
    const js =
      "(function(){try{" +
      "const msg=" + msgJson + ";" +
      "const seen=new Set();" +
      "function postTo(win){" +
        "if(!win||seen.has(win)) return;" +
        "seen.add(win);" +
        "try{win.postMessage(msg,'*');}catch(e){}" +
        "try{const frames=win.frames; for(let i=0;i<frames.length;i++){ try{postTo(frames[i]);}catch(e){} }}catch(e){}" +
      "}" +
      "postTo(window);" +
      "}catch(e){} })();";
    view.webContents.executeJavaScript(js, true).catch(()=>{});
  }catch(e){}
}

function postSettingsToWeb(settings){
  postMessageToWebFrames({ source:'sproutg-desktop', type:'SETTINGS', payload: settings || {} });
}

function pingWebForTheme(){
  postMessageToWebFrames({ source:'sproutg-desktop', type:'PING', payload:{ ts: Date.now() } });
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

function updateViewBounds(){
  if (!mainWindow || !view) return;
  const [w, h] = mainWindow.getContentSize();
  view.setBounds({ x:0, y:TOPBAR_HEIGHT, width:w, height:Math.max(0, h - TOPBAR_HEIGHT) });
  view.setAutoResize({ width:true, height:true });
}

function loadWeb(url){
  if (!bridgeManager) return;
  bridgeManager.load(url);
}

function positionSettingsWindow(){
  if (!mainWindow || !settingsWindow || settingsWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  const sw = settingsWindow.getBounds().width;
  settingsWindow.setPosition(Math.round(b.x + b.width - sw - 12), Math.round(b.y + TOPBAR_HEIGHT + 6), false);
}

function closeSettingsWindow(){
  if (!settingsWindow || settingsWindow.isDestroyed()) return false;
  try { settingsWindow.close(); return true; } catch(e) { return false; }
}

function openSettingsWindow(){
  if (!mainWindow) return;

  if (settingsWindow && !settingsWindow.isDestroyed()) {
  // Toggle: if already visible -> close (destroy) to avoid "blink" / double-show glitches
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
    height: 620,
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

  // Ensure clean toggle behavior + prevent accidental zoom in auxiliary windows
  settingsWindow.on('closed', () => { settingsWindow = null; });
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
  settingsWindow.on('blur', () => closeSettingsWindow());

  mainWindow.on('move', positionSettingsWindow);
  mainWindow.on('resize', positionSettingsWindow);
}

function openStatsWindow(){
  if (!mainWindow) return;

  if (statsWindow && !statsWindow.isDestroyed()) {
  // Toggle: if already visible -> close (destroy) to avoid "blink" and scaling accumulation
  if (statsWindow.isVisible()) {
    try { statsWindow.close(); } catch(e) {}
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


// persist stats window position when user drags it
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


  // apply stored stats position (user can drag the window)
try{
  const stored = getStoredStatsBounds();
  if (stored && typeof stored.x === 'number' && typeof stored.y === 'number'){
    const clamped = clampToWorkArea({ x: stored.x, y: stored.y, width: 640, height: 520 });
    statsWindow.setBounds(clamped, false);
  } else {
    positionStatsWindow(); // default placement near main window
  }
} catch(e) {
  // ignore
}

statsWindow.loadFile(path.join(__dirname, 'stats', 'index.html'));

  // Ensure clean toggle behavior + prevent accidental zoom in Stats window
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

  // NOTE: no auto-hide on blur.
  // User requirement: the Stats button should reliably toggle open/close.
}

function positionStatsWindow(){
  if (!mainWindow || !statsWindow || statsWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  const sw = statsWindow.getBounds().width;
  statsWindow.setPosition(Math.round(b.x + b.width - sw - 12), Math.round(b.y + TOPBAR_HEIGHT + 6), false);
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
    title: 'SproutG Bridge Login',
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
  mainWindow.on('close', () => {
    const isMax = mainWindow.isMaximized();
    const bounds = isMax ? lastNormal : mainWindow.getBounds();
    store.set('window', { bounds, isMaximized: isMax });
  });

  // URL or first-run prompt
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
  registerApiIpc(ipcMain, bridgeManager);
  createMainWindow();
  registerGlobal();

  const updatesCfg = getUpdatesConfig();
  if (updatesCfg.enabled && updatesCfg.autoCheckOnStart) {
    setTimeout(() => { checkForUpdates(false).catch(() => {}); }, 4500);
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
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

ipcMain.handle('sproutg:clear-cache', async () => {
  const s = getSession();
  // Clear HTTP cache + site data that affects in-app lists (localStorage/IndexDB/etc.), but keep cookies (session).
  await s.clearCache();
  await s.clearStorageData({ storages: ['localstorage', 'indexdb', 'serviceworkers', 'caches'] });
  reloadWeb();
  return true;
});
ipcMain.handle('sproutg:logout', async () => {
  await getSession().clearStorageData({ storages:['cookies','localstorage','indexdb','serviceworkers','caches'] });
  // Reset local points only on full logout
  store.set('points', { days: {}, workDays: {} });
    store.set('statusState', {});
  if (statsWindow && !statsWindow.isDestroyed()) statsWindow.webContents.send('sproutg:points-updated', getPoints());
    setTimeout(() => { try { statsWindow && !statsWindow.isDestroyed() && statsWindow.webContents.send('sproutg:points-updated', getPoints()); } catch(e){} }, 80);
  reloadWeb();
  return true;
});

ipcMain.handle('sproutg:open-settings', () => { openSettingsWindow(); return true; });

ipcMain.handle('sproutg:open-stats', () => { openStatsWindow(); return true; });
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
  if (action === 'close') return mainWindow.close();
});

ipcMain.on('sproutg:web-message', (_e, msg) => {
  if (!msg || !msg.type) return;
  const t = msg.type;
  if (t === 'THEME_COLORS' && msg.payload && mainWindow) {
    mainWindow.webContents.send('sproutg:theme-colors', msg.payload);

    // Optional bidirectional theme sync: if web app reports current theme, store it.
    const theme = msg.payload?.theme;
    if (theme === 'light' || theme === 'dark') {
      const cur = getSettings();
      if (cur.theme !== theme) {
        const next = setSettings({ theme });
        applySettings(next);
      }
    }
    return;
  }
  if ((t === 'STATUS_EVENT' || t === 'POINT_EVENT') && msg.payload) {
    addPoints(msg.payload);
    return;
  }
});

setInterval(() => { try { addPoints({ delta: 1, key: 'Desktop:Active10min', ts: Date.now() }); } catch(e) {} }, 10*60*1000);
