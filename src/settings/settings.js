const $ = (id) => document.getElementById(id);

const THEMES = {
  'dark-classic': 'Dark Classic',
  'light-classic': 'Light Classic',
  'dark-ios': 'Dark IOS',
  'light-oldmoney': 'Light OldMoney'
};
const THEME_ALIASES = { dark: 'dark-classic', light: 'light-classic' };

const btnAOT = $('btnAOT');
const btnZoomIn = $('btnZoomIn');
const btnZoomOut = $('btnZoomOut');
const zoomValue = $('zoomValue');
const themeList = $('themeList');
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
const settingsCard = $('settingsCard');
const smsPoolApiKey = $('smsPoolApiKey');
const btnSaveSmsPoolKey = $('btnSaveSmsPoolKey');
const smsPoolStatus = $('smsPoolStatus');
const techDesktopVersion = $('techDesktopVersion');
const techWebVersion = $('techWebVersion');

let current = { theme: 'dark-classic', zoom: 1.0, alwaysOnTop: false };

function normalizeTheme(theme) {
  const next = THEME_ALIASES[theme] || theme || 'dark-classic';
  return THEMES[next] ? next : 'dark-classic';
}

function setThemeUi(theme) {
  const next = normalizeTheme(theme);
  document.documentElement.setAttribute('data-theme', next);
  for (const btn of document.querySelectorAll('[data-theme-value]')) {
    btn.dataset.active = btn.dataset.themeValue === next ? 'true' : 'false';
  }
}

function setZoomUi(zoom) {
  zoomValue.textContent = `${Math.round((zoom || 1) * 100)}%`;
}

function setAotUi(aot) {
  btnAOT.textContent = aot ? 'Вкл' : 'Выкл';
}

function updateLabel(state) {
  return ({
    idle: 'Ожидание',
    checking: 'Проверка',
    available: 'Есть новая',
    downloading: 'Скачивание',
    downloaded: 'Готово',
    'not-available': 'Актуально',
    error: 'Ошибка',
    disabled: 'Отключено',
    dev: 'Dev'
  })[state] || '—';
}

function formatVersion(v) {
  const raw = String(v || '').trim();
  if (!raw) return '—';
  return raw.startsWith('v') ? raw : `v${raw}`;
}

function renderUpdateState(state = {}) {
  const installedVersion = formatVersion(state.version);
  const availableVersion = formatVersion(state.availableVersion);
  appVersion.textContent = `Версия: ${installedVersion}`;
  updateBadge.textContent = updateLabel(state.status);

  const fallback = {
    checking: 'Проверяем обновления...',
    available: `Доступно обновление: ${availableVersion}`,
    downloading: `Скачивание обновления... ${Math.round(Number(state.progress?.percent || 0))}%`,
    downloaded: `Обновление ${availableVersion} загружено и готово к установке`,
    'not-available': `Установлена последняя версия: ${installedVersion}`,
    error: 'Ошибка обновления',
    idle: 'Проверка и установка обновлений только вручную.'
  };
  updateStatus.textContent = String(state.message || fallback[state.status] || fallback.idle).trim() +
    (state.error ? `\n${String(state.error).trim()}` : '');

  const isChecking = state.status === 'checking';
  const isDownloading = state.status === 'downloading';
  const isAvailable = state.status === 'available';
  const isDownloaded = state.status === 'downloaded' || state.downloaded;

  btnCheckUpdate.disabled = isChecking || isDownloading;
  btnDownloadUpdate.disabled = !isAvailable || isChecking || isDownloading;
  btnInstallUpdate.disabled = !isDownloaded;

  const percent = Math.round(Number(state.progress?.percent || 0));
  updateProgress.hidden = !isDownloading && percent <= 0;
  updateProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function closeSettingsSoon() {
  window.setTimeout(() => window.sproutgSettings.closeWindow().catch(() => {}), 0);
}

async function refresh() {
  current = await window.sproutgSettings.getSettings();
  setThemeUi(current.theme);
  setZoomUi(current.zoom);
  setAotUi(!!current.alwaysOnTop);
  try {
    renderUpdateState(await window.sproutgSettings.getUpdateState());
  } catch (e) {
    renderUpdateState({ status: 'error', message: 'Не удалось получить статус обновлений', error: String(e?.message || e) });
  }
  refreshTechInfo();
}

async function refreshTechInfo() {
  try {
    const state = await window.sproutgSettings.getUpdateState();
    if (techDesktopVersion) techDesktopVersion.textContent = formatVersion(state?.version);
  } catch (e) {
    if (techDesktopVersion) techDesktopVersion.textContent = '—';
  }
  try {
    const meta = await window.sproutgSettings.apiCall('meta.config', {}, { timeoutMs: 12000 });
    const webVersion = meta?.data?.appVersion || meta?.appVersion || '';
    if (techWebVersion) techWebVersion.textContent = formatVersion(webVersion);
  } catch (e) {
    if (techWebVersion) techWebVersion.textContent = '—';
  }
}

btnAOT.addEventListener('click', async () => {
  current = await window.sproutgSettings.toggleAOT();
  setAotUi(!!current.alwaysOnTop);
  closeSettingsSoon();
});

btnZoomIn.addEventListener('click', async () => {
  current = await window.sproutgSettings.zoomIn();
  setZoomUi(current.zoom);
});

btnZoomOut.addEventListener('click', async () => {
  current = await window.sproutgSettings.zoomOut();
  setZoomUi(current.zoom);
});

themeList.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-theme-value]');
  if (!btn) return;
  const theme = normalizeTheme(btn.dataset.themeValue);
  current = await window.sproutgSettings.setSetting({ theme });
  setThemeUi(theme);
});

btnReload.addEventListener('click', async () => {
  await window.sproutgSettings.reloadWeb();
  closeSettingsSoon();
});

btnClearCache.addEventListener('click', async () => {
  btnClearCache.disabled = true;
  try { await window.sproutgSettings.clearCache(); }
  finally { btnClearCache.disabled = false; }
  closeSettingsSoon();
});

btnLogout.addEventListener('click', async () => {
  btnLogout.disabled = true;
  try { await window.sproutgSettings.logout(); }
  finally { btnLogout.disabled = false; }
  closeSettingsSoon();
});

btnChangeUrl.addEventListener('click', () => window.sproutgSettings.openUrl());

btnSaveSmsPoolKey?.addEventListener('click', async () => {
  const key = String(smsPoolApiKey?.value || '').trim();
  btnSaveSmsPoolKey.disabled = true;
  if (smsPoolStatus) smsPoolStatus.textContent = 'Сохранение...';
  try {
    const res = await window.sproutgSettings.apiCall('smspool.setApiKey', { key }, { cache: false, timeoutMs: 15000 });
    if (!res || res.ok === false) throw new Error(res?.error || 'Ошибка сохранения');
    if (smsPoolApiKey) smsPoolApiKey.value = '';
    if (smsPoolStatus) smsPoolStatus.textContent = key ? 'SMSPool API key сохранен.' : 'SMSPool API key очищен.';
  } catch (e) {
    if (smsPoolStatus) smsPoolStatus.textContent = String(e?.message || e);
  } finally {
    btnSaveSmsPoolKey.disabled = false;
  }
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
  setThemeUi(current.theme);
  setZoomUi(current.zoom);
  setAotUi(!!current.alwaysOnTop);
});

window.sproutgSettings.onUpdateState(renderUpdateState);

document.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !settingsCard || settingsCard.contains(event.target)) return;
  closeSettingsSoon();
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettingsSoon();
});

refresh();

