const $ = (id) => document.getElementById(id);

const btnAOT = $('btnAOT');
const btnZoomIn = $('btnZoomIn');
const btnZoomOut = $('btnZoomOut');
const zoomValue = $('zoomValue');

const themeLight = $('themeLight');
const themeDark = $('themeDark');

const btnReload = $('btnReload');
const btnClearCache = $('btnClearCache');
const btnLogout = $('btnLogout');
const btnChangeUrl = $('btnChangeUrl');

const appVersion = $('appVersion');
const updateBadge = $('updateBadge');
const updateStatus = $('updateStatus');
const updateProgress = $('updateProgress');
const updateProgressBar = $('updateProgressBar');
const btnCheckUpdate = $('btnCheckUpdate');
const btnDownloadUpdate = $('btnDownloadUpdate');
const btnInstallUpdate = $('btnInstallUpdate');

let current = { theme:'dark', zoom:1.0, alwaysOnTop:false };
let currentUpdateState = null;

function setThemeUi(theme){
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  themeLight.setAttribute('data-active', theme === 'light' ? 'true' : 'false');
  themeDark.setAttribute('data-active', theme !== 'light' ? 'true' : 'false');
}

function setZoomUi(zoom){
  zoomValue.textContent = `${Math.round((zoom || 1) * 100)}%`;
}

function setAotUi(aot){
  btnAOT.textContent = aot ? 'Вкл' : 'Выкл';
}

function updateLabel(state){
  const map = {
    idle: 'Ожидание',
    checking: 'Проверка',
    available: 'Есть новая',
    downloading: 'Скачивание',
    downloaded: 'Готово',
    'not-available': 'Актуально',
    error: 'Ошибка',
    disabled: 'Отключено',
    dev: 'Dev'
  };
  return map[state] || '—';
}

function renderUpdateState(state){
  currentUpdateState = state || {};
  const version = currentUpdateState.version || '—';
  appVersion.textContent = `Версия: ${version}`;
  updateBadge.textContent = updateLabel(currentUpdateState.status);

  const msg = currentUpdateState.message || 'Обновления еще не проверялись';
  const err = currentUpdateState.error ? `\n${currentUpdateState.error}` : '';
  updateStatus.textContent = msg + err;

  const isChecking = currentUpdateState.status === 'checking';
  const isDownloading = currentUpdateState.status === 'downloading';
  const isAvailable = currentUpdateState.status === 'available';
  const isDownloaded = currentUpdateState.status === 'downloaded' || currentUpdateState.downloaded;

  btnCheckUpdate.disabled = isChecking || isDownloading;
  btnDownloadUpdate.disabled = !isAvailable || isChecking || isDownloading;
  btnInstallUpdate.disabled = !isDownloaded;

  const percent = Math.round(Number(currentUpdateState.progress?.percent || 0));
  updateProgress.hidden = !isDownloading && percent <= 0;
  updateProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

async function refresh(){
  current = await window.sproutgSettings.getSettings();
  setThemeUi(current.theme || 'dark');
  setZoomUi(current.zoom || 1);
  setAotUi(!!current.alwaysOnTop);

  try {
    const state = await window.sproutgSettings.getUpdateState();
    renderUpdateState(state);
  } catch(e) {
    renderUpdateState({ status:'error', message:'Не удалось получить статус обновлений', error:String(e?.message || e) });
  }
}

btnAOT.addEventListener('click', async () => {
  current = await window.sproutgSettings.toggleAOT();
  setAotUi(!!current.alwaysOnTop);
});

btnZoomIn.addEventListener('click', async () => {
  current = await window.sproutgSettings.zoomIn();
  setZoomUi(current.zoom);
});
btnZoomOut.addEventListener('click', async () => {
  current = await window.sproutgSettings.zoomOut();
  setZoomUi(current.zoom);
});

themeLight.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ theme:'light' });
  setThemeUi('light');
});
themeDark.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ theme:'dark' });
  setThemeUi('dark');
});

btnReload.addEventListener('click', async () => {
  await window.sproutgSettings.reloadWeb();
});

btnClearCache.addEventListener('click', async () => {
  btnClearCache.disabled = true;
  try { await window.sproutgSettings.clearCache(); }
  finally { btnClearCache.disabled = false; }
});

btnLogout.addEventListener('click', async () => {
  btnLogout.disabled = true;
  try { await window.sproutgSettings.logout(); }
  finally { btnLogout.disabled = false; }
});

btnChangeUrl.addEventListener('click', async () => {
  await window.sproutgSettings.openUrl();
});

btnCheckUpdate.addEventListener('click', async () => {
  btnCheckUpdate.disabled = true;
  try { renderUpdateState(await window.sproutgSettings.checkForUpdates()); }
  finally { btnCheckUpdate.disabled = false; }
});

btnDownloadUpdate.addEventListener('click', async () => {
  btnDownloadUpdate.disabled = true;
  try { renderUpdateState(await window.sproutgSettings.downloadUpdate()); }
  finally { btnDownloadUpdate.disabled = false; }
});

btnInstallUpdate.addEventListener('click', async () => {
  btnInstallUpdate.disabled = true;
  try { renderUpdateState(await window.sproutgSettings.installUpdate()); }
  finally { btnInstallUpdate.disabled = false; }
});

window.sproutgSettings.onApplySettings((s) => {
  if (!s) return;
  current = s;
  setThemeUi(current.theme || 'dark');
  setZoomUi(current.zoom || 1);
  setAotUi(!!current.alwaysOnTop);
});

window.sproutgSettings.onUpdateState((s) => renderUpdateState(s));

refresh();
