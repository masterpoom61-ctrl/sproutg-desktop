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
  executive: 'Executive',
  'deep-space': 'Deep Space',
  'rainy-day': 'Rainy Day',
  'tokyo-night': 'Tokyo Night',
  mountain: 'Mountain',
  aurora: 'Aurora',
  blueprint: 'Blueprint',
  terracotta: 'Terracotta',
  'slate-blue': 'Slate Blue',
  'banking-green': 'Banking Green',
  typewriter: 'Typewriter',
  'amber-terminal': 'Amber Terminal'
};
const THEME_ALIASES = { dark: 'dark-classic', light: 'light-classic', 'midnight-pro': 'dark-midnight-pro', forest: 'dark-forest', 'cyberpunk-neon': 'cyberpunk' };

const btnAOT = $('btnAOT');
const btnZoomIn = $('btnZoomIn');
const btnZoomOut = $('btnZoomOut');
const zoomValue = $('zoomValue');
const btnFontScaleIn = $('btnFontScaleIn');
const btnFontScaleOut = $('btnFontScaleOut');
const fontScaleValue = $('fontScaleValue');
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
const statGlowOn = $('statGlowOn');
const statGlowOff = $('statGlowOff');
const customThemeName = $('customThemeName');
const customBgA = $('customBgA');
const customBgB = $('customBgB');
const customPanel = $('customPanel');
const customSurface = $('customSurface');
const customText = $('customText');
const customAccent = $('customAccent');
const customGlow = $('customGlow');
const customSelectBg = $('customSelectBg');
const customCalendarBg = $('customCalendarBg');
const customBgImage = $('customBgImage');
const btnBrowseCustomBg = $('btnBrowseCustomBg');
const btnClearCustomBg = $('btnClearCustomBg');
const btnSaveCustomTheme = $('btnSaveCustomTheme');
const btnDeleteCustomTheme = $('btnDeleteCustomTheme');
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
const smsServiceSmsPool = $('smsServiceSmsPool');
const smsServiceHeroSms = $('smsServiceHeroSms');
const smsPoolStatus = $('smsPoolStatus');
const techDesktopVersion = $('techDesktopVersion');
const techWebVersion = $('techWebVersion');
const techAppSize = $('techAppSize');
const settingsCloseBtn = $('settingsCloseBtn');

let current = { theme: 'dark-classic', zoom: 1.0, fontScale: 1.0, alwaysOnTop: false, graphicsMode: 'ultra', contrastMode: false, classicTrafficLights: false, statCardGlow: true, smsService: 'smspool', customThemeId: '', customThemes: [] };
let closing = false;
let colorClipboard = '';
let liveThemeTimer = null;

// RELEASE_HISTORY: при каждом публичном релизе добавляй новую запись сверху,
// чтобы раздел "История обновлений" в настройках всегда был актуален для пользователей.
const RELEASE_HISTORY = [
  {
    version: '2.1.8',
    date: '2026-06-26',
    changes: [
      'Кастомные темы применяются сразу при настройке, добавлены копирование/вставка цветов и выбор фоновой картинки через проводник.',
      'Расширены цвета пользовательской темы: свечение, выпадающие списки и календарь; текст и TOTP лучше подчиняются выбранному цвету.',
      'Размер текста масштабирует основные элементы интерфейса, а переключатель контраста приведен к порядку Вкл/Выкл.',
      'BAN-статусы в O1/MCC окрашиваются в красный при любом написании ban/бан.',
      'Карточки Сегодня, Этот месяц и Среднее в день получили лиги, а счетчики лиг стали цветными и читаемыми.',
      'Авто-проверка обновлений запускается быстрее после старта и чаще в фоне.'
    ]
  },
  {
    version: '2.1.7',
    date: '2026-06-26',
    changes: [
      'Раздел O1 "SMS Activate" переведен на HeroSMS: каталог стран, цены, количество и русские ответы сервиса.',
      'Лиги статистики получили фиксированные бронзовые, серебряные, золотые, алмазные и легендарные цвета.',
      'Добавлены настройка свечения карточек статистики, размер текста и редактор пользовательских тем.',
      'Исправлены иконки навигации в "Лигах месяца" и первое сохранение Gmail/Аутентификатора в O1.'
    ]
  },
  {
    version: '2.1.6',
    date: '2026-06-25',
    changes: [
      'Подготовлен каталог стран для SMS-сервиса O1 с ценой, количеством и сортировкой.',
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

const CUSTOM_THEME_DEFAULTS = {
  bgA: '#0f172a',
  bgB: '#111827',
  panel: '#111827',
  surface: '#1f2937',
  text: '#f8fafc',
  accent: '#38bdf8',
  glow: '#38bdf8',
  selectBg: '#111827',
  calendarBg: '#1f2937'
};
const CUSTOM_THEME_PROPS = [
  '--bg', '--bg-grad-1', '--bg-grad-2', '--bg-grad-3',
  '--panel', '--panel2', '--surface', '--surface-alt',
  '--btn', '--btnH', '--control-hover', '--control-active',
  '--custom-glow', '--select-bg', '--select-option-bg', '--calendar-bg',
  '--border', '--line', '--line-strong', '--text', '--muted', '--muted2',
  '--accent', '--chartA', '--chartB', '--chartC', '--chartD',
  '--topbar-bg', '--topbar-fg', '--glassTop', '--glassFog', '--custom-bg-url'
];

function clampNumber(value, min, max, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
}

function normalizeThemeVars(vars = {}) {
  return Object.fromEntries(Object.entries(CUSTOM_THEME_DEFAULTS).map(([key, fallback]) => {
    const raw = String(vars?.[key] || fallback).trim();
    return [key, isHexColor(raw) ? raw : fallback];
  }));
}

function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '');
  const n = parseInt(value, 16);
  if (!Number.isFinite(n)) return `rgba(255,255,255,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function customBgUrl(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/').replace(/"/g, '');
  const withScheme = /^[a-z]+:/i.test(normalized) ? normalized : `file:///${normalized}`;
  return `url("${withScheme}")`;
}

function selectedCustomTheme(settings = current) {
  const id = String(settings?.customThemeId || '').trim();
  if (!id) return null;
  return (Array.isArray(settings?.customThemes) ? settings.customThemes : []).find((item) => item?.id === id) || null;
}

function applyCustomThemeVars(settings = current) {
  const root = document.documentElement;
  for (const prop of CUSTOM_THEME_PROPS) root.style.removeProperty(prop);
  const custom = selectedCustomTheme(settings);
  root.dataset.customTheme = custom ? 'on' : 'off';
  root.dataset.customBg = 'off';
  if (!custom) return;
  const vars = normalizeThemeVars(custom.vars);
  root.style.setProperty('--bg', vars.bgA);
  root.style.setProperty('--bg-grad-1', hexToRgba(vars.accent, .24));
  root.style.setProperty('--bg-grad-2', hexToRgba(vars.surface, .28));
  root.style.setProperty('--bg-grad-3', vars.bgB);
  root.style.setProperty('--panel', hexToRgba(vars.panel, .92));
  root.style.setProperty('--panel2', hexToRgba(vars.surface, .28));
  root.style.setProperty('--surface', hexToRgba(vars.surface, .76));
  root.style.setProperty('--surface-alt', hexToRgba(vars.panel, .72));
  root.style.setProperty('--btn', hexToRgba(vars.surface, .48));
  root.style.setProperty('--btnH', hexToRgba(vars.accent, .18));
  root.style.setProperty('--control-hover', hexToRgba(vars.accent, .16));
  root.style.setProperty('--control-active', hexToRgba(vars.accent, .24));
  root.style.setProperty('--custom-glow', vars.glow);
  root.style.setProperty('--select-bg', hexToRgba(vars.selectBg, .92));
  root.style.setProperty('--select-option-bg', vars.selectBg);
  root.style.setProperty('--calendar-bg', vars.calendarBg);
  root.style.setProperty('--border', hexToRgba(vars.accent, .30));
  root.style.setProperty('--line', hexToRgba(vars.accent, .22));
  root.style.setProperty('--line-strong', hexToRgba(vars.accent, .46));
  root.style.setProperty('--text', vars.text);
  root.style.setProperty('--muted', hexToRgba(vars.text, .68));
  root.style.setProperty('--muted2', hexToRgba(vars.text, .52));
  root.style.setProperty('--accent', vars.accent);
  root.style.setProperty('--chartA', vars.accent);
  root.style.setProperty('--chartB', vars.glow);
  root.style.setProperty('--chartC', vars.surface);
  root.style.setProperty('--chartD', vars.calendarBg);
  root.style.setProperty('--topbar-bg', hexToRgba(vars.panel, .96));
  root.style.setProperty('--topbar-fg', vars.text);
  root.style.setProperty('--glassTop', hexToRgba(vars.glow, .20));
  root.style.setProperty('--glassFog', hexToRgba(vars.bgB, .62));
  const bg = customBgUrl(custom.backgroundImage);
  if (bg) {
    root.style.setProperty('--custom-bg-url', bg);
    root.dataset.customBg = 'on';
  }
}

function setFontScaleUi(fontScale) {
  if (fontScaleValue) fontScaleValue.textContent = `${Math.round(clampNumber(fontScale, .75, 1.45, 1) * 100)}%`;
}

function setStatGlowUi(enabled) {
  if (statGlowOn) statGlowOn.dataset.active = enabled ? 'true' : 'false';
  if (statGlowOff) statGlowOff.dataset.active = enabled ? 'false' : 'true';
}

function renderCustomThemeOptions(settings = current) {
  if (!themeList) return;
  themeList.querySelectorAll('[data-custom-theme-id]').forEach((btn) => btn.remove());
  const customThemes = Array.isArray(settings.customThemes) ? settings.customThemes : [];
  for (const item of customThemes) {
    const vars = normalizeThemeVars(item.vars);
    const btn = document.createElement('button');
    btn.className = 'themeOption themeOptionCustom';
    btn.type = 'button';
    btn.dataset.customThemeId = item.id;
    btn.textContent = item.name || 'Своя тема';
    btn.style.setProperty('--themeA', vars.bgA);
    btn.style.setProperty('--themeB', vars.bgB);
    btn.style.setProperty('--themeText', vars.text);
    btn.style.setProperty('--themeBorder', hexToRgba(vars.accent, .42));
    btn.style.setProperty('--themeRing', vars.accent);
    themeList.appendChild(btn);
  }
}

function customColorInputs() {
  return [
    customBgA,
    customBgB,
    customPanel,
    customSurface,
    customText,
    customAccent,
    customGlow,
    customSelectBg,
    customCalendarBg
  ].filter(Boolean);
}

function customThemeIdForEdit() {
  return selectedCustomTheme(current)?.id || String(current.customThemeId || '') || `custom-${Date.now().toString(36)}`;
}

function buildCustomThemeFromEditor(id) {
  const vars = {};
  for (const input of customColorInputs()) {
    const key = input.dataset.colorKey;
    if (key) vars[key] = input.value;
  }
  const selected = selectedCustomTheme(current);
  const name = String(customThemeName?.value || selected?.name || 'Своя тема').trim().slice(0, 40) || 'Своя тема';
  return {
    id,
    name,
    vars: normalizeThemeVars(vars),
    backgroundImage: String(customBgImage?.value || '').trim()
  };
}

function upsertCustomTheme(themeItem) {
  const list = Array.isArray(current.customThemes) ? current.customThemes : [];
  const next = list.filter((theme) => theme.id !== themeItem.id);
  next.push(themeItem);
  return next;
}

function scheduleLiveCustomThemePersist(nextSettings) {
  clearTimeout(liveThemeTimer);
  liveThemeTimer = setTimeout(async () => {
    try {
      current = await window.sproutgSettings.setSetting({
        customThemes: nextSettings.customThemes,
        customThemeId: nextSettings.customThemeId
      });
      applySettingsUi(current);
    } catch (e) {}
  }, 120);
}

function livePreviewCustomTheme() {
  const id = customThemeIdForEdit();
  const item = buildCustomThemeFromEditor(id);
  const nextSettings = {
    ...current,
    customThemeId: id,
    customThemes: upsertCustomTheme(item)
  };
  current = nextSettings;
  applySettingsUi(nextSettings, { skipEditorHydrate: true });
  scheduleLiveCustomThemePersist(nextSettings);
}

function setupColorTools() {
  for (const input of customColorInputs()) {
    const field = input.closest('.colorField');
    if (!field || field.dataset.toolsReady === '1') continue;
    field.dataset.toolsReady = '1';
    const tools = document.createElement('span');
    tools.className = 'colorTools';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'colorToolBtn';
    copy.title = 'Скопировать цвет';
    copy.setAttribute('aria-label', 'Скопировать цвет');
    copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M5 15V7a2 2 0 0 1 2-2h8"></path></svg>';
    copy.addEventListener('click', (event) => {
      event.preventDefault();
      colorClipboard = input.value;
    });
    const paste = document.createElement('button');
    paste.type = 'button';
    paste.className = 'colorToolBtn';
    paste.title = 'Вставить цвет';
    paste.setAttribute('aria-label', 'Вставить цвет');
    paste.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8l1 3H7l1-3Z"></path><rect x="6" y="8" width="12" height="12" rx="2"></rect><path d="M10 12h4"></path></svg>';
    paste.addEventListener('click', (event) => {
      event.preventDefault();
      if (!colorClipboard) return;
      input.value = colorClipboard;
      livePreviewCustomTheme();
    });
    tools.append(copy, paste);
    field.appendChild(tools);
  }
}

function hydrateCustomThemeEditor(settings = current) {
  const custom = selectedCustomTheme(settings);
  const vars = normalizeThemeVars(custom?.vars || {});
  if (customThemeName) customThemeName.value = custom?.name || '';
  if (customBgA) customBgA.value = vars.bgA;
  if (customBgB) customBgB.value = vars.bgB;
  if (customPanel) customPanel.value = vars.panel;
  if (customSurface) customSurface.value = vars.surface;
  if (customText) customText.value = vars.text;
  if (customAccent) customAccent.value = vars.accent;
  if (customGlow) customGlow.value = vars.glow;
  if (customSelectBg) customSelectBg.value = vars.selectBg;
  if (customCalendarBg) customCalendarBg.value = vars.calendarBg;
  if (customBgImage) customBgImage.value = custom?.backgroundImage || '';
  if (btnDeleteCustomTheme) btnDeleteCustomTheme.disabled = !custom;
}

function setThemeUi(theme) {
  const next = normalizeTheme(theme);
  document.documentElement.setAttribute('data-theme', next);
  const selectedCustomId = String(current?.customThemeId || '');
  for (const btn of document.querySelectorAll('[data-theme-value]')) {
    btn.dataset.active = !selectedCustomId && btn.dataset.themeValue === next ? 'true' : 'false';
  }
  for (const btn of document.querySelectorAll('[data-custom-theme-id]')) {
    btn.dataset.active = btn.dataset.customThemeId === selectedCustomId ? 'true' : 'false';
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
  const key = service === 'herosms' ? 'herosms' : 'smspool';
  if (smsServiceSmsPool) smsServiceSmsPool.dataset.active = key === 'smspool' ? 'true' : 'false';
  if (smsServiceHeroSms) smsServiceHeroSms.dataset.active = key === 'herosms' ? 'true' : 'false';
}

function applySettingsUi(settings = {}, options = {}) {
  const next = {
    ...current,
    ...(settings || {}),
    theme: normalizeTheme(settings.theme || current.theme),
    graphicsMode: normalizeGraphics(settings.graphicsMode || current.graphicsMode),
    fontScale: clampNumber(settings.fontScale ?? current.fontScale, .75, 1.45, 1),
    statCardGlow: settings.statCardGlow !== false,
    customThemeId: String(settings.customThemeId || ''),
    customThemes: Array.isArray(settings.customThemes) ? settings.customThemes : [],
    smsService: settings.smsService === 'herosms' ? 'herosms' : 'smspool'
  };
  current = next;
  renderCustomThemeOptions(next);
  setThemeUi(next.theme);
  setZoomUi(next.zoom);
  setFontScaleUi(next.fontScale);
  setAotUi(!!next.alwaysOnTop);
  setGraphicsUi(next.graphicsMode);
  setSmsServiceUi(next.smsService);
  setStatGlowUi(next.statCardGlow !== false);
  setPair(contrastOff, contrastOn, !!next.contrastMode);
  setPair(trafficOff, trafficOn, !!next.classicTrafficLights);
  document.documentElement.dataset.graphics = next.graphicsMode;
  document.documentElement.dataset.contrast = next.contrastMode ? 'on' : 'off';
  document.documentElement.dataset.zjk = next.classicTrafficLights ? 'on' : 'off';
  document.documentElement.dataset.statGlow = next.statCardGlow === false ? 'off' : 'on';
  document.documentElement.dataset.textScale = Math.abs((next.fontScale || 1) - 1) > 0.001 ? 'on' : 'off';
  document.documentElement.style.setProperty('--app-font-scale', String(next.fontScale || 1));
  applyCustomThemeVars(next);
  if (!options.skipEditorHydrate) hydrateCustomThemeEditor(next);
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

btnFontScaleIn?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ fontScale: clampNumber((current.fontScale || 1) + 0.05, .75, 1.45, 1) });
  applySettingsUi(current);
});

btnFontScaleOut?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ fontScale: clampNumber((current.fontScale || 1) - 0.05, .75, 1.45, 1) });
  applySettingsUi(current);
});

themeList.addEventListener('click', async (event) => {
  const customBtn = event.target.closest('[data-custom-theme-id]');
  if (customBtn) {
    current = await window.sproutgSettings.setSetting({ customThemeId: customBtn.dataset.customThemeId });
    applySettingsUi(current);
    return;
  }
  const btn = event.target.closest('[data-theme-value]');
  if (!btn) return;
  const theme = normalizeTheme(btn.dataset.themeValue);
  current = await window.sproutgSettings.setSetting({ theme, customThemeId: '' });
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

statGlowOn?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ statCardGlow: true });
  applySettingsUi(current);
});

statGlowOff?.addEventListener('click', async () => {
  current = await window.sproutgSettings.setSetting({ statCardGlow: false });
  applySettingsUi(current);
});

customThemeName?.addEventListener('input', livePreviewCustomTheme);
for (const input of customColorInputs()) {
  input.addEventListener('input', livePreviewCustomTheme);
  input.addEventListener('change', livePreviewCustomTheme);
}

btnBrowseCustomBg?.addEventListener('click', async () => {
  const res = await window.sproutgSettings.chooseCustomThemeBg();
  if (!res || res.canceled || !res.path) return;
  if (customBgImage) customBgImage.value = res.path;
  livePreviewCustomTheme();
});

btnClearCustomBg?.addEventListener('click', () => {
  if (customBgImage) customBgImage.value = '';
  livePreviewCustomTheme();
});

btnSaveCustomTheme?.addEventListener('click', async () => {
  const id = customThemeIdForEdit();
  const item = buildCustomThemeFromEditor(id);
  const nextThemes = upsertCustomTheme(item);
  current = await window.sproutgSettings.setSetting({
    customThemes: nextThemes,
    customThemeId: id
  });
  applySettingsUi(current);
});

btnDeleteCustomTheme?.addEventListener('click', async () => {
  const selected = selectedCustomTheme(current);
  if (!selected) return;
  const nextThemes = (Array.isArray(current.customThemes) ? current.customThemes : []).filter((theme) => theme.id !== selected.id);
  current = await window.sproutgSettings.setSetting({
    customThemes: nextThemes,
    customThemeId: ''
  });
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
    const res = await window.sproutgSettings.heroSms('setApiKey', { key });
    if (!res || res.ok === false) throw new Error(res?.error || 'Ошибка сохранения');
    if (heroSmsApiKey) heroSmsApiKey.value = '';
    if (smsPoolStatus) smsPoolStatus.textContent = key ? 'HeroSMS API key сохранен локально.' : 'HeroSMS API key очищен.';
  } catch (e) {
    if (smsPoolStatus) smsPoolStatus.textContent = String(e?.message || e);
  } finally {
    btnSaveHeroSmsKey.disabled = false;
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

setupColorTools();
refresh();
setupElasticBounce(document.getElementById('scrollableContent') || settingsCard);

