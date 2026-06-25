const $ = (id) => document.getElementById(id);

const THEMES = {
  'dark-classic': 'Dark Classic',
  'light-classic': 'Light Classic',
  'dark-ios': 'Dark IOS',
  'light-ios': 'Light IOS',
  'dark-oldmoney': 'Dark OldMoney',
  'light-oldmoney': 'Light OldMoney',
  'dark-midnight-pro': 'Midnight Pro',
  'light-midnight-pro': 'Light Midnight',
  'dark-forest': 'Dark Forest',
  'light-forest': 'Light Forest',
  cyberpunk: 'Cyberpunk Neon',
  'nordic-frost': 'Nordic Frost',
  'coffee-sepia': 'Coffee Sepia',
  'retro-terminal': 'Retro Terminal',
  synthwave: 'Synthwave',
  vaporwave: 'Vaporwave',
  'dark-academia': 'Dark Academia',
  'light-academia': 'Light Academia',
  'art-deco': 'Art Deco',
  bauhaus: 'Bauhaus',
  'graphite-pro': 'Graphite Pro',
  'platinum-light': 'Platinum Light',
  obsidian: 'Obsidian',
  'notion-clean': 'Notion Clean',
  'linear-dark': 'Linear Dark',
  'paper-white': 'Paper White',
  'royal-navy': 'Royal Navy',
  'milk-glass': 'Milk Glass',
  'emerald-gold': 'Emerald Gold',
  marble: 'Marble',
  'burgundy-club': 'Burgundy Club',
  swiss: 'Swiss',
  caviar: 'Caviar',
  'banking-green': 'Banking Green',
  'deep-space': 'Deep Space',
  typewriter: 'Typewriter',
  'tokyo-night': 'Tokyo Night',
  terracotta: 'Terracotta',
  aurora: 'Aurora',
  blueprint: 'Blueprint',
  mountain: 'Mountain',
  'slate-blue': 'Slate Blue',
  executive: 'Executive',
  'rainy-day': 'Rainy Day',
  'amber-terminal': 'Amber Terminal'
};
const THEME_ALIASES = { dark: 'dark-classic', light: 'light-classic', 'midnight-pro': 'dark-midnight-pro', forest: 'dark-forest', 'cyberpunk-neon': 'cyberpunk' };

const btnAOT = $('btnAOT');
const btnZoomIn = $('btnZoomIn');
const btnZoomOut = $('btnZoomOut');
const zoomValue = $('zoomValue');
const themeList = $('themeList');
const btnReload = $('btnReload');
const btnClearCache = $('btnClearCache');
const cacheSize = $('cacheSize');
const btnLogout = $('btnLogout');
const btnChangeUrl = $('btnChangeUrl');
const graphicsLite = $('graphicsLite');
const graphicsUltra = $('graphicsUltra');
const contrastOff = $('contrastOff');
const contrastOn = $('contrastOn');
const trafficOff = $('trafficOff');
const trafficOn = $('trafficOn');
const appVersion = $('appVersion');
const updateBadge = $('updateBadge');
const updateStatus = $('updateStatus');
const updateProgress = $('updateProgress');
const updateProgressBar = $('updateProgressBar');
const releaseHistorySelect = $('releaseHistorySelect');
const releaseHistoryBody = $('releaseHistoryBody');
const btnCheckUpdate = $('btnCheckUpdate');
const btnDownloadUpdate = $('btnDownloadUpdate');
const btnInstallUpdate = $('btnInstallUpdate');
const settingsCard = $('settingsCard');
const smsPoolApiKey = $('smsPoolApiKey');
const btnSaveSmsPoolKey = $('btnSaveSmsPoolKey');
const heroSmsApiKey = $('heroSmsApiKey');
const btnSaveHeroSmsKey = $('btnSaveHeroSmsKey');
const smsActivateApiKey = $('smsActivateApiKey');
const btnSaveSmsActivateKey = $('btnSaveSmsActivateKey');
const smsServiceSmsPool = $('smsServiceSmsPool');
const smsServiceHeroSms = $('smsServiceHeroSms');
const smsServiceSmsActivate = $('smsServiceSmsActivate');
const smsPoolStatus = $('smsPoolStatus');
const techDesktopVersion = $('techDesktopVersion');
const techWebVersion = $('techWebVersion');
const techAppSize = $('techAppSize');
const settingsCloseBtn = $('settingsCloseBtn');

let current = { theme: 'dark-classic', zoom: 1.0, alwaysOnTop: false, graphicsMode: 'ultra', contrastMode: false, classicTrafficLights: false, smsService: 'smspool' };
let closing = false;

// RELEASE_HISTORY: при каждом публичном релизе добавляй новую запись сверху,
// чтобы раздел "История обновлений" в настройках всегда был актуален для пользователей.
const RELEASE_HISTORY = [
  {
    version: '2.1.6',
    date: '2026-06-25',
    changes: [
      'SMS Activate: выбор стран для Google/Gmail/YouTube с ценой, количеством и сортировкой по успешности.',
      'Исправлена кнопка вверх на странице O1 и поведение пустого поля Gmail в колонке X.',
      'Лиги в статистике переведены с emoji на крупные кастомные SVG-иконки.',
      'Добавлена нижняя таблица лиг по дням, неделям, месяцу и рекордным достижениям.',
      'Усилен blur окна статистики, улучшена пружинка скролла и ускорена проверка обновлений.',
      'За добавление компании начисляется +10 поинтов и тип работы "Компания" попадает в статистику.'
    ]
  },
  {
    version: '2.1.5',
    date: '2026-06-25',
    changes: [
      'Добавлен раздел "Доп.Работа" с цифровой клавиатурой и начислением поинтов за черновики, Okto и номера.',
      'Статистика получила 6 игровых карточек с разбивкой по типам работ и отдельными лигами дня/недели/месяца.',
      'Добавлен выбор SMSPool/HeroSMS для O1 и поле API HeroSMS в настройках.',
      'Исправлены мини-уведомления, порядок тем, скролл настроек и поле "Резервная Почта" для O1.'
    ]
  },
  {
    version: '2.1.4',
    date: '2026-06-24',
    changes: [
      'Доработан HUD поинтов и reveal-анимация загрузки O1/MCC.',
      'Настройки получили Lite/Ultra, Контраст, З-Ж-К, размеры кеша/приложения и перетаскивание окна.',
      'Статус в шапке открывает окно с метриками подключения, очереди, задержки и успешности.',
      'Добавлен Lite CSS-режим без blur, анимаций и прозрачности.'
    ]
  },
  {
    version: '2.1.3',
    date: '2026-06-24',
    changes: [
      'Улучшены темы и семантические цвета интерфейса.',
      'Исправлены элементы статистики и связанные состояния окон.'
    ]
  },
  {
    version: '2.1.2',
    date: '2026-06-24',
    changes: [
      'Улучшена стабильность обновлений и отображение сервисных статусов.',
      'Исправлены регрессии после перехода на ветку 2.1.'
    ]
  },
  {
    version: '2.1.1',
    date: '2026-06-22',
    changes: [
      'Исправлены ошибки интерфейса после 2.1.0.',
      'Доработаны сохранение, статистика и локальные окна приложения.'
    ]
  },
  {
    version: '2.1.0',
    date: '2026-06-22',
    changes: [
      'Публичная ветка 2.1 с локальными окнами, настройками, статистикой и автообновлениями.',
      'Подготовлена основа для быстрых desktop-релизов SproutG.'
    ]
  },
  {
    version: '2.0.5',
    date: '2026-06-22',
    changes: [
      'Hotfix ветки 2.0: правки стабильности и сборки установщика.'
    ]
  },
  {
    version: '2.0.4',
    date: '2026-06-22',
    changes: [
      'Улучшены desktop-сборка, обновления и базовые окна приложения.'
    ]
  },
  {
    version: '2.0.3',
    date: '2026-06-21',
    changes: [
      'Правки UI и подготовка к публичному каналу обновлений.'
    ]
  },
  {
    version: '2.0.2',
    date: '2026-06-21',
    changes: [
      'Стабилизация SproutG Desktop 2.0 и публикация Windows-ассетов.'
    ]
  },
  {
    version: '1.4.0',
    date: '2026-06-21',
    changes: [
      'Релиз desktop-приложения SproutG на Electron.'
    ]
  },
  {
    version: '1.3.7',
    date: '2026-04-26',
    changes: [
      'Обновлены настройки, обновления и статистика в ранней desktop-ветке.'
    ]
  }
];

function prepareClose() {
  if (closing) return;
  closing = true;
  document.body.classList.add('sgClosing');
}

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

function normalizeGraphics(value) {
  return value === 'lite' ? 'lite' : 'ultra';
}

function setPair(offBtn, onBtn, enabled) {
  if (offBtn) offBtn.dataset.active = enabled ? 'false' : 'true';
  if (onBtn) onBtn.dataset.active = enabled ? 'true' : 'false';
}

function setGraphicsUi(mode) {
  const lite = normalizeGraphics(mode) === 'lite';
  if (graphicsLite) graphicsLite.dataset.active = lite ? 'true' : 'false';
  if (graphicsUltra) graphicsUltra.dataset.active = lite ? 'false' : 'true';
  themeList?.classList.toggle('liteThemeLock', lite);
}

function setSmsServiceUi(service) {
  const key = service === 'herosms' || service === 'smsactivate' ? service : 'smspool';
  if (smsServiceSmsPool) smsServiceSmsPool.dataset.active = key === 'smspool' ? 'true' : 'false';
  if (smsServiceHeroSms) smsServiceHeroSms.dataset.active = key === 'herosms' ? 'true' : 'false';
  if (smsServiceSmsActivate) smsServiceSmsActivate.dataset.active = key === 'smsactivate' ? 'true' : 'false';
}

function applySettingsUi(settings = {}) {
  const next = {
    ...current,
    ...(settings || {}),
    theme: normalizeTheme(settings.theme || current.theme),
    graphicsMode: normalizeGraphics(settings.graphicsMode || current.graphicsMode),
    smsService: settings.smsService === 'herosms' || settings.smsService === 'smsactivate' ? settings.smsService : 'smspool'
  };
  current = next;
  setThemeUi(next.theme);
  setZoomUi(next.zoom);
  setAotUi(!!next.alwaysOnTop);
  setGraphicsUi(next.graphicsMode);
  setSmsServiceUi(next.smsService);
  setPair(contrastOff, contrastOn, !!next.contrastMode);
  setPair(trafficOff, trafficOn, !!next.classicTrafficLights);
  document.documentElement.dataset.graphics = next.graphicsMode;
  document.documentElement.dataset.contrast = next.contrastMode ? 'on' : 'off';
  document.documentElement.dataset.zjk = next.classicTrafficLights ? 'on' : 'off';
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

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

function renderReleaseHistory(version) {
  if (!releaseHistorySelect || !releaseHistoryBody) return;
  if (releaseHistorySelect.dataset.ready !== '1') {
    releaseHistorySelect.dataset.ready = '1';
    releaseHistorySelect.innerHTML = RELEASE_HISTORY.map((item) => (
      `<option value="${escHtml(item.version)}">v${escHtml(item.version)} · ${escHtml(item.date)}</option>`
    )).join('');
    releaseHistorySelect.addEventListener('change', () => renderReleaseHistory(releaseHistorySelect.value));
  }
  const wanted = String(version || releaseHistorySelect.value || RELEASE_HISTORY[0]?.version || '').replace(/^v/i, '');
  const item = RELEASE_HISTORY.find((entry) => entry.version === wanted) || RELEASE_HISTORY[0];
  if (!item) {
    releaseHistoryBody.innerHTML = '';
    return;
  }
  releaseHistorySelect.value = item.version;
  releaseHistoryBody.innerHTML = `
    <div class="releaseHistoryTitle">v${escHtml(item.version)} · ${escHtml(item.date)}</div>
    <ul>${item.changes.map((change) => `<li>${escHtml(change)}</li>`).join('')}</ul>
  `;
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 КБ';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`;
  return `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} МБ`;
}

function renderUpdateState(state = {}) {
  const installedVersion = formatVersion(state.version);
  const availableVersion = formatVersion(state.availableVersion);
  appVersion.textContent = `Версия: ${installedVersion}`;
  updateBadge.textContent = updateLabel(state.status);
  updateBadge.dataset.state = state.status || 'idle';
  updateStatus.dataset.state = state.status || 'idle';

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
  prepareClose();
  window.setTimeout(() => window.sproutgSettings.closeWindow().catch(() => {}), 0);
}

function setupElasticBounce(container, target){
  if(!container || container.dataset.elasticBound === '1') return;
  container.dataset.elasticBound = '1';
  const moving = target || container;
  let offset = 0;
  let timer = null;
  const settle = ()=>{
    clearTimeout(timer);
    timer = setTimeout(()=>{
      offset = 0;
      moving.style.transition = 'transform .46s cubic-bezier(.18,.9,.22,1.18)';
      moving.style.transform = 'translateY(0)';
      setTimeout(()=>{ moving.style.transition = ''; }, 480);
    }, 28);
  };
  container.addEventListener('wheel', (event)=>{
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const atTop = container.scrollTop <= 0;
    const atBottom = container.scrollTop >= maxScroll - 1;
    const shouldElastic = maxScroll <= 0 || (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom);
    if(!shouldElastic) return;
    event.preventDefault();
    const maxOffset = 76;
    const resistance = 1 - Math.min(.72, Math.abs(offset) / (maxOffset * 1.25));
    offset += -event.deltaY * .22 * resistance;
    offset = Math.max(-maxOffset, Math.min(maxOffset, offset));
    moving.style.transition = 'none';
    moving.style.transform = `translateY(${offset}px)`;
    settle();
  }, { passive:false, capture:true });
}

async function refresh() {
  current = await window.sproutgSettings.getSettings();
  applySettingsUi(current);
  renderReleaseHistory(RELEASE_HISTORY[0]?.version);
  try {
    renderUpdateState(await window.sproutgSettings.getUpdateState());
  } catch (e) {
    renderUpdateState({ status: 'error', message: 'Не удалось получить статус обновлений', error: String(e?.message || e) });
  }
  refreshTechInfo();
  refreshStorageInfo();
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

async function refreshStorageInfo() {
  try {
    const info = await window.sproutgSettings.getStorageInfo();
    if (cacheSize) cacheSize.textContent = `Кеш: ${formatBytes(info?.cacheBytes)}`;
    if (techAppSize) techAppSize.textContent = formatBytes(info?.appBytes);
  } catch (e) {
    if (cacheSize) cacheSize.textContent = 'Кеш: —';
    if (techAppSize) techAppSize.textContent = '—';
  }
}

btnAOT.addEventListener('click', async () => {
  current = await window.sproutgSettings.toggleAOT();
  applySettingsUi(current);
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
  applySettingsUi(current);
});

graphicsLite?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ graphicsMode: 'lite' });
  applySettingsUi(current);
});

graphicsUltra?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ graphicsMode: 'ultra' });
  applySettingsUi(current);
});

contrastOff?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ contrastMode: false });
  applySettingsUi(current);
});

contrastOn?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ contrastMode: true });
  applySettingsUi(current);
});

trafficOff?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ classicTrafficLights: false });
  applySettingsUi(current);
});

trafficOn?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ classicTrafficLights: true });
  applySettingsUi(current);
});

smsServiceSmsPool?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ smsService: 'smspool' });
  applySettingsUi(current);
});

smsServiceHeroSms?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ smsService: 'herosms' });
  applySettingsUi(current);
});

smsServiceSmsActivate?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ smsService: 'smsactivate' });
  applySettingsUi(current);
});

btnReload.addEventListener('click', async () => {
  await window.sproutgSettings.reloadWeb();
});

btnClearCache.addEventListener('click', async () => {
  btnClearCache.disabled = true;
  try {
    await window.sproutgSettings.clearCache();
    await refreshStorageInfo();
  }
  finally { btnClearCache.disabled = false; }
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

btnSaveHeroSmsKey?.addEventListener('click', async () => {
  const key = String(heroSmsApiKey?.value || '').trim();
  btnSaveHeroSmsKey.disabled = true;
  if (smsPoolStatus) smsPoolStatus.textContent = 'Сохранение HeroSMS...';
  try {
    const res = await window.sproutgSettings.apiCall('herosms.setApiKey', { key }, { cache: false, timeoutMs: 15000 });
    if (!res || res.ok === false) throw new Error(res?.error || 'Ошибка сохранения');
    if (heroSmsApiKey) heroSmsApiKey.value = '';
    if (smsPoolStatus) smsPoolStatus.textContent = key ? 'HeroSMS API key сохранен.' : 'HeroSMS API key очищен.';
  } catch (e) {
    if (smsPoolStatus) smsPoolStatus.textContent = String(e?.message || e);
  } finally {
    btnSaveHeroSmsKey.disabled = false;
  }
});

btnSaveSmsActivateKey?.addEventListener('click', async () => {
  const key = String(smsActivateApiKey?.value || '').trim();
  btnSaveSmsActivateKey.disabled = true;
  if (smsPoolStatus) smsPoolStatus.textContent = 'Сохранение SMS Activate...';
  try {
    const res = await window.sproutgSettings.smsActivate('setApiKey', { key });
    if (!res || res.ok === false) throw new Error(res?.error || 'Ошибка сохранения');
    if (smsActivateApiKey) smsActivateApiKey.value = '';
    if (smsPoolStatus) smsPoolStatus.textContent = key ? 'SMS Activate API key сохранен локально.' : 'SMS Activate API key очищен.';
  } catch (e) {
    if (smsPoolStatus) smsPoolStatus.textContent = String(e?.message || e);
  } finally {
    btnSaveSmsActivateKey.disabled = false;
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

settingsCloseBtn?.addEventListener('click', closeSettingsSoon);

window.sproutgSettings.onApplySettings((s) => {
  if (!s) return;
  applySettingsUi(s);
});

window.sproutgSettings.onUpdateState(renderUpdateState);
window.sproutgSettings.onPrepareClose(prepareClose);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettingsSoon();
});

refresh();
setupElasticBounce(document.getElementById('scrollableContent') || settingsCard);

