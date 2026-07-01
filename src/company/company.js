const $ = (id) => document.getElementById(id);

const THEMES = new Set(['dark-classic', 'light-classic', 'dark-ios', 'light-ios', 'dark-oldmoney', 'light-oldmoney', 'dark-midnight-pro', 'light-midnight-pro', 'dark-forest', 'light-forest', 'cyberpunk', 'nordic-frost', 'coffee-sepia', 'retro-terminal', 'synthwave', 'vaporwave', 'dark-academia', 'light-academia', 'art-deco', 'bauhaus', 'graphite-pro', 'obsidian', 'slate-blue', 'platinum-light', 'notion-clean', 'linear-dark', 'royal-navy', 'emerald-gold', 'burgundy-club', 'caviar', 'paper-white', 'milk-glass', 'deep-space', 'tokyo-night', 'aurora', 'rainy-day', 'terracotta', 'blueprint', 'swiss', 'executive', 'banking-green', 'marble', 'typewriter', 'amber-terminal', 'mountain']);
const THEME_ALIASES = { dark: 'dark-classic', light: 'light-classic', 'midnight-pro': 'dark-midnight-pro', forest: 'dark-forest', 'cyberpunk-neon': 'cyberpunk' };

const card = $('companyCard');
const grid = $('companyFormGrid');
const submitBtn = $('companySubmitBtn');
const errEl = $('companyErr');
const closeBtn = $('companyCloseBtn');
const COMPANY_LABELS = ['Компания', 'Адресс', 'Индекс', 'Город', 'EE', 'DUNS'];

let duplicateTimer = null;
let duplicateState = { value: '', duplicate: false, checking: false };
let closing = false;

function prepareClose() {
  if (closing) return;
  closing = true;
  document.body.classList.add('sgClosing');
}

function normalizeTheme(theme) {
  const next = THEME_ALIASES[theme] || theme || 'dark-classic';
  return THEMES.has(next) ? next : 'dark-classic';
}

const CUSTOM_THEME_PROPS = [
  '--bg', '--bg-grad-1', '--bg-grad-2', '--bg-grad-3',
  '--panel', '--panel2', '--surface', '--surface-alt',
  '--btn', '--btnH', '--custom-glow', '--select-bg', '--select-option-bg', '--calendar-bg',
  '--border', '--line', '--line-strong',
  '--text', '--muted', '--muted2', '--accent',
  '--chartA', '--chartB', '--chartC', '--chartD',
  '--glassTop', '--glassFog', '--custom-bg-url'
];
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
function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '');
  const n = parseInt(value, 16);
  if (!Number.isFinite(n)) return `rgba(255,255,255,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
function normalizeCustomVars(vars = {}) {
  const isHex = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
  return Object.fromEntries(Object.entries(CUSTOM_THEME_DEFAULTS).map(([key, fallback]) => {
    const raw = String(vars?.[key] || fallback).trim();
    return [key, isHex(raw) ? raw : fallback];
  }));
}
function selectedCustomTheme(settings = {}) {
  const id = String(settings?.customThemeId || '').trim();
  if (!id) return null;
  return (Array.isArray(settings?.customThemes) ? settings.customThemes : []).find((item) => item?.id === id) || null;
}
function customBgUrl(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/').replace(/"/g, '');
  const withScheme = /^[a-z]+:/i.test(normalized) ? normalized : `file:///${normalized}`;
  return `url("${withScheme}")`;
}
function applyCustomThemeVars(settings = {}) {
  const root = document.documentElement;
  for (const prop of CUSTOM_THEME_PROPS) root.style.removeProperty(prop);
  const custom = selectedCustomTheme(settings);
  root.dataset.customTheme = custom ? 'on' : 'off';
  root.dataset.customBg = 'off';
  if (!custom) return;
  const vars = normalizeCustomVars(custom.vars);
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
  root.style.setProperty('--glassTop', hexToRgba(vars.glow, .20));
  root.style.setProperty('--glassFog', hexToRgba(vars.bgB, .62));
  const bg = customBgUrl(custom.backgroundImage);
  if (bg) {
    root.style.setProperty('--custom-bg-url', bg);
    root.dataset.customBg = 'on';
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', normalizeTheme(theme));
}

function applySettingsUi(settings = {}) {
  if (settings.theme) setTheme(settings.theme);
  document.documentElement.dataset.graphics = settings.graphicsMode === 'lite' ? 'lite' : 'ultra';
  document.documentElement.dataset.contrast = settings.contrastMode ? 'on' : 'off';
  document.documentElement.dataset.zjk = settings.classicTrafficLights ? 'on' : 'off';
  document.documentElement.dataset.textScale = Math.abs((Number(settings.fontScale || 1)) - 1) > 0.001 ? 'on' : 'off';
  document.documentElement.style.setProperty('--app-font-scale', String(settings.fontScale || 1));
  applyCustomThemeVars(settings);
}

function setError(msg) {
  errEl.textContent = msg || '';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBridgeTimeout(error) {
  const text = String(error?.code || error?.message || error || '').toLowerCase();
  return text.includes('bridge_timeout') || text.includes('timeout') || text.includes('слишком долго') || text.includes('too long');
}

async function confirmCompanyStored(companyName) {
  const value = String(companyName || '').trim();
  if (!value) return false;
  const delays = [350, 700, 1200, 1800];
  for (const delay of delays) {
    await wait(delay);
    try {
      const res = await window.sproutgCompany.apiCall('company.checkDuplicate', { value }, { timeoutMs: 3000 });
      const payload = res?.data && typeof res.data === 'object' ? res.data : res;
      if (res && res.ok !== false && payload?.duplicate) return true;
    } catch (error) {
      if (!isBridgeTimeout(error)) throw error;
    }
  }
  return false;
}

function emitCompanyPoints() {
  window.sproutgCompany.addPoints?.({
    kind: 'company',
    page: 'COMPANY',
    group: 'Компании',
    workType: 'Компания',
    key: 'Компания',
    count: 1,
    deltaClicks: 1,
    deltaPoints: 10,
    delta: 10,
    ts: Date.now()
  });
}

function resetCompanyForm(message) {
  getInputs().forEach((input) => {
    input.value = '';
    delete input.dataset.state;
  });
  duplicateState = { value: '', duplicate: false, checking: false };
  setError(message || 'Компания добавлена');
  setTimeout(() => setError(''), 1300);
}

function setSubmitEnabled() {
  const values = getValues();
  const full = values.length === 6 && values.every(Boolean);
  submitBtn.disabled = !full || duplicateState.checking || duplicateState.duplicate;
}

function getInputs() {
  return Array.from(grid.querySelectorAll('input[data-company-col]'));
}

function getValues() {
  return getInputs().map((input) => String(input.value || '').trim());
}

function validate(values) {
  const clean = values.map((v) => String(v || '').trim());
  if (clean.length !== 6) return { ok: false, error: 'Нужно заполнить 6 полей' };
  if (clean.some((v) => !v)) return { ok: false, error: 'Все 6 полей обязательны' };
  if (duplicateState.duplicate && duplicateState.value === clean[0].toLowerCase()) {
    return { ok: false, error: 'Компания с таким значением в колонке A уже существует' };
  }
  if (!/^EE\d{9}$/.test(clean[4])) return { ok: false, error: 'EE: формат EE + 9 цифр' };
  if (!/^\d{9}$/.test(clean[5])) return { ok: false, error: 'DUNS: ровно 9 цифр' };
  return { ok: true, values: clean };
}

async function checkDuplicate(input) {
  const expected = String(input.value || '').trim();
  if (!expected) return;
  duplicateState = { value: expected.toLowerCase(), duplicate: false, checking: true };
  setSubmitEnabled();

  try {
    const res = await window.sproutgCompany.apiCall('company.checkDuplicate', { value: expected }, { timeoutMs: 12000 });
    const current = String(input.value || '').trim().toLowerCase();
    if (current !== expected.toLowerCase()) return;
    if (!res || res.ok === false) throw new Error(res?.error || 'Ошибка проверки компании');
    const payload = res?.data && typeof res.data === 'object' ? res.data : res;

    duplicateState = { value: current, duplicate: !!payload?.duplicate, checking: false };
    input.dataset.state = payload?.duplicate ? 'bad' : 'ok';
    if (payload?.duplicate) {
      setError(`Компания уже есть в колонке A${payload.row ? `, строка ${payload.row}` : ''}`);
    } else {
      setError('');
    }
  } catch (error) {
    duplicateState = { value: expected.toLowerCase(), duplicate: false, checking: false };
    setError(String(error?.message || error));
  } finally {
    setSubmitEnabled();
  }
}

function scheduleDuplicateCheck(input) {
  clearTimeout(duplicateTimer);
  const value = String(input.value || '').trim();
  delete input.dataset.state;
  duplicateState = { value: value.toLowerCase(), duplicate: false, checking: !!value };
  setError('');
  setSubmitEnabled();
  if (!value) return;
  duplicateTimer = setTimeout(() => checkDuplicate(input), 260);
}

function renderInputs() {
  grid.innerHTML = '';
  for (let i = 0; i < 6; i += 1) {
    const row = document.createElement('div');
    row.className = 'field';

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = COMPANY_LABELS[i] || String.fromCharCode(65 + i);
    label.title = label.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.dataset.companyCol = String.fromCharCode(65 + i);
    input.autocomplete = 'off';
    input.addEventListener('input', () => {
      if (i === 0) scheduleDuplicateCheck(input);
      else setSubmitEnabled();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitCompany();
      }
    });

    row.appendChild(label);
    row.appendChild(input);
    grid.appendChild(row);
  }
  setSubmitEnabled();
  const first = grid.querySelector('input');
  if (first) first.focus();
}

async function loadMeta() {
  setError('');
  renderInputs();
}

async function submitCompany() {
  const vr = validate(getValues());
  if (!vr.ok) {
    setError(vr.error);
    setSubmitEnabled();
    return;
  }

  submitBtn.disabled = true;
  setError('');
  try {
    let stored = false;
    try {
      const res = await window.sproutgCompany.apiCall('company.addRow', { values: vr.values }, { cache: false, timeoutMs: 3500 });
      if (!res || res.ok === false) throw new Error(res?.error || 'Ошибка сохранения');
      stored = true;
    } catch (error) {
      if (!isBridgeTimeout(error)) throw error;
      stored = await confirmCompanyStored(vr.values[0]);
      if (!stored) throw error;
    }
    emitCompanyPoints();
    resetCompanyForm(stored ? 'Компания добавлена' : 'Компания добавлена, синхронизация продолжается');
  } catch (error) {
    setError(String(error?.message || error));
  } finally {
    setSubmitEnabled();
  }
}

submitBtn.addEventListener('click', submitCompany);
closeBtn?.addEventListener('click', () => {
  prepareClose();
  window.sproutgCompany.closeWindow().catch(() => {});
});

window.sproutgCompany.onApplySettings((settings) => {
  if (settings) applySettingsUi(settings);
});
window.sproutgCompany.onPrepareClose(prepareClose);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    prepareClose();
    window.sproutgCompany.closeWindow().catch(() => {});
  }
});

(async () => {
  const settings = await window.sproutgCompany.getSettings();
  applySettingsUi(settings || { theme: 'dark-classic' });
  await loadMeta();
})();
