const $ = (id) => document.getElementById(id);

const THEMES = new Set(['dark-classic', 'light-classic', 'dark-ios', 'light-ios', 'dark-oldmoney', 'light-oldmoney', 'dark-midnight-pro', 'light-midnight-pro', 'dark-forest', 'light-forest', 'cyberpunk', 'nordic-frost', 'coffee-sepia', 'retro-terminal', 'synthwave', 'vaporwave', 'dark-academia', 'light-academia', 'art-deco', 'bauhaus', 'graphite-pro', 'obsidian', 'slate-blue', 'platinum-light', 'notion-clean', 'linear-dark', 'royal-navy', 'emerald-gold', 'burgundy-club', 'caviar', 'paper-white', 'milk-glass', 'deep-space', 'tokyo-night', 'aurora', 'rainy-day', 'terracotta', 'blueprint', 'swiss', 'executive', 'banking-green', 'marble', 'typewriter', 'amber-terminal', 'mountain']);
const THEME_ALIASES = { dark: 'dark-classic', light: 'light-classic', 'midnight-pro': 'dark-midnight-pro', forest: 'dark-forest', 'cyberpunk-neon': 'cyberpunk' };

const card = $('companyCard');
const grid = $('companyFormGrid');
const submitBtn = $('companySubmitBtn');
const errEl = $('companyErr');
const closeBtn = $('companyCloseBtn');
const COMPANY_LABELS = ['Компания', 'Адресс', 'Индекс', 'Город', 'EE', 'DUNS'];
const COMPANY_DRAFT_KEY = 'sproutg:companyDraft:v1';
let companyDraftIntegrityBlocked = false;
let companyDraftIntegrityError = '';
let companyDraftQuarantineKey = '';

let duplicateTimer = null;
let duplicateState = { value: '', duplicate: false, checking: false };
let closing = false;
let writeBarrierActive = false;
let submitJob = null;

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
  persistCompanyDraft();
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

function readCompanyDraft() {
  try {
    const raw = localStorage.getItem(COMPANY_DRAFT_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) throw new Error('Формат черновика компании повреждён');
    if (
      parsed.length > 6
      || parsed.some((value) => value != null && typeof value === 'object')
    ) {
      throw new Error('Черновик компании содержит неподдерживаемые данные');
    }
    return parsed.slice(0, 6).map((value) => String(value ?? ''));
  } catch (error) {
    let raw = null;
    try {
      raw = localStorage.getItem(COMPANY_DRAFT_KEY);
      if (raw != null) {
        companyDraftQuarantineKey = `${COMPANY_DRAFT_KEY}:quarantine:${Date.now()}`;
        localStorage.setItem(companyDraftQuarantineKey, raw);
        if (localStorage.getItem(companyDraftQuarantineKey) !== raw) {
          throw new Error('проверка карантинной копии не пройдена');
        }
      }
    } catch (quarantineError) {
      companyDraftQuarantineKey = '';
      companyDraftIntegrityError = `Не удалось создать карантинную копию: ${quarantineError?.message || quarantineError}`;
    }
    companyDraftIntegrityBlocked = true;
    companyDraftIntegrityError = [
      String(error?.message || error),
      companyDraftIntegrityError
    ].filter(Boolean).join('; ');
    window.__sproutgCompanyDraftIntegrityRisk = 1;
    window.__sproutgCompanyDraftIntegrityError = companyDraftIntegrityError;
    return [];
  }
}

function persistCompanyDraft() {
  const values = getInputs().map((input) => String(input.value || ''));
  if (companyDraftIntegrityBlocked) {
    companyDraftIntegrityError = (
      'Исходный черновик компании сохранён без перезаписи'
      + (companyDraftQuarantineKey ? ` (${companyDraftQuarantineKey})` : '')
    );
    window.__sproutgCompanyDraftIntegrityRisk = 1;
    window.__sproutgCompanyDraftIntegrityError = companyDraftIntegrityError;
    for (const input of getInputs()) input.dataset.unsaved = '1';
    return false;
  }
  try {
    if (values.some((value) => value.trim())) {
      localStorage.setItem(COMPANY_DRAFT_KEY, JSON.stringify(values));
    } else {
      localStorage.removeItem(COMPANY_DRAFT_KEY);
    }
    window.__sproutgCompanyDraftIntegrityRisk = 0;
    window.__sproutgCompanyDraftIntegrityError = '';
    for (const input of getInputs()) delete input.dataset.unsaved;
    return true;
  } catch (error) {
    companyDraftIntegrityError = String(error?.message || error);
    window.__sproutgCompanyDraftIntegrityRisk = 1;
    window.__sproutgCompanyDraftIntegrityError = companyDraftIntegrityError;
    for (const input of getInputs()) {
      if (String(input.value || '').trim()) input.dataset.unsaved = '1';
    }
    return false;
  }
}

async function waitForCompanySubmit(timeoutMs) {
  const activeSubmit = submitJob;
  if (!activeSubmit) return true;
  let timer = null;
  const completed = await Promise.race([
    activeSubmit.then(() => true, () => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(500, Number(timeoutMs || 5000)));
    })
  ]);
  clearTimeout(timer);
  return completed;
}

async function requestCompanyClose() {
  if (!(await waitForCompanySubmit(5000))) {
    setError('Добавление компании ещё сохраняется. Окно оставлено открытым.');
    return;
  }
  if (!persistCompanyDraft()) {
    setError('Черновик компании не удалось сохранить локально. Окно оставлено открытым.');
    return;
  }
  prepareClose();
  window.sproutgCompany.closeWindow().catch(() => {});
}

function releaseWriteBarrier() {
  writeBarrierActive = false;
  document.documentElement.removeAttribute('data-write-barrier');
  document.body.style.pointerEvents = '';
}

async function prepareWriteBarrier(request = {}) {
  writeBarrierActive = true;
  document.documentElement.dataset.writeBarrier = '1';
  document.body.style.pointerEvents = 'none';
  try { document.activeElement?.blur?.(); } catch (_error) {}
  const activeSubmit = submitJob;
  if (activeSubmit) {
    const submitWaitMs = Math.max(
      500,
      Math.min(5000, Number(request.timeoutMs || 6000) - 1000)
    );
    if (!(await waitForCompanySubmit(submitWaitMs))) {
      return {
        ok:false,
        error:'Добавление компании ещё сохраняется. Повтори операцию через несколько секунд.'
      };
    }
  }
  const persisted = persistCompanyDraft();
  const values = getValues();
  const hasDraft = values.some(Boolean);
  const draftWouldChangeTarget = (
    request.reason === 'logout'
    || (request.reason === 'change-endpoint' && request.allowDurableFailures !== true)
  );
  if (!persisted) {
    return { ok:false, error:'Черновик компании не удалось сохранить локально' };
  }
  if (hasDraft && draftWouldChangeTarget) {
    return { ok:false, error:'Сначала отправь или очисти черновик компании' };
  }
  return { ok:true, persistedDraft:hasDraft };
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

function setupElasticBounce(container){
  if(!container || container.dataset.elasticBound === '1') return;
  container.dataset.elasticBound = '1';
  let targetOffset = 0;
  let renderedOffset = 0;
  let timer = null;
  let raf = null;
  const renderElastic = () => {
    raf = null;
    renderedOffset += (targetOffset - renderedOffset) * 0.38;
    if (Math.abs(targetOffset - renderedOffset) < .35) renderedOffset = targetOffset;
    container.style.transform = `translateY(${renderedOffset}px)`;
    if (Math.abs(targetOffset - renderedOffset) >= .35) raf = requestAnimationFrame(renderElastic);
  };
  container.addEventListener('wheel', (event) => {
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const atTop = container.scrollTop <= 0;
    const atBottom = container.scrollTop >= maxScroll - 1;
    const shouldElastic = maxScroll <= 0 || (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom);
    if (!shouldElastic) return;
    event.preventDefault();
    const maxOffset = 54;
    const resistance = 1 - Math.min(.72, Math.abs(targetOffset) / (maxOffset * 1.25));
    targetOffset += -event.deltaY * .16 * resistance;
    targetOffset = Math.max(-maxOffset, Math.min(maxOffset, targetOffset));
    if(!raf) raf = requestAnimationFrame(renderElastic);
    clearTimeout(timer);
    timer = setTimeout(() => {
      targetOffset = 0;
      renderedOffset = 0;
      if(raf){ cancelAnimationFrame(raf); raf = null; }
      container.style.transition = 'transform .42s cubic-bezier(.18,.9,.22,1.12)';
      container.style.transform = 'translateY(0)';
      setTimeout(() => { container.style.transition = ''; }, 430);
    }, 28);
  }, { passive:false, capture:true });
}

function setupAuxWindowDrag(api){
  if(!api?.dragWindowStart || document.documentElement.dataset.auxDragBound === '1') return;
  document.documentElement.dataset.auxDragBound = '1';
  let dragging = false;
  let pendingPoint = null;
  let raf = null;
  const isDragTarget = (target)=>(
    target?.closest?.('.dragbar, .header') &&
    !target.closest('button,input,select,textarea,summary,a,[role="button"],.windowClose')
  );
  const flushMove = ()=>{
    raf = null;
    if(pendingPoint) api.dragWindowMove(pendingPoint).catch(()=>{});
    pendingPoint = null;
  };
  document.addEventListener('pointerdown', (event)=>{
    if(event.button !== 0 || !isDragTarget(event.target)) return;
    dragging = true;
    api.dragWindowStart({ x:event.screenX, y:event.screenY }).catch(()=>{});
    event.preventDefault();
  }, { capture:true });
  window.addEventListener('pointermove', (event)=>{
    if(!dragging) return;
    pendingPoint = { x:event.screenX, y:event.screenY };
    if(!raf) raf = requestAnimationFrame(flushMove);
    event.preventDefault();
  }, { capture:true });
  const end = ()=>{
    if(!dragging) return;
    dragging = false;
    pendingPoint = null;
    if(raf){ cancelAnimationFrame(raf); raf = null; }
    api.dragWindowEnd().catch(()=>{});
  };
  window.addEventListener('pointerup', end, { capture:true });
  window.addEventListener('pointercancel', end, { capture:true });
}

function renderInputs() {
  grid.innerHTML = '';
  const draft = readCompanyDraft();
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
    input.value = draft[i] || '';
    input.addEventListener('input', () => {
      persistCompanyDraft();
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
  const persisted = persistCompanyDraft();
  if (!persisted && companyDraftIntegrityError) {
    setError(`Черновик компании требует восстановления: ${companyDraftIntegrityError}`);
  }
  const first = grid.querySelector('input');
  if (first) first.focus();
}

async function loadMeta() {
  setError('');
  renderInputs();
}

async function submitCompany() {
  if (submitJob) return submitJob;
  const job = (async () => {
    const vr = validate(getValues());
    if (!vr.ok) {
      setError(vr.error);
      setSubmitEnabled();
      return;
    }

    submitBtn.disabled = true;
    setError('');
    try {
      const res = await window.sproutgCompany.apiCall('company.addRow', { values: vr.values }, { cache: false, timeoutMs: 3500 });
      if (!res || res.ok === false) throw new Error(res?.error || 'Ошибка сохранения');
      emitCompanyPoints();
      resetCompanyForm('Компания добавлена');
    } catch (error) {
      setError(String(error?.message || error));
    } finally {
      setSubmitEnabled();
    }
  })();
  submitJob = job;
  try {
    return await job;
  } finally {
    if (submitJob === job) submitJob = null;
  }
}

submitBtn.addEventListener('click', submitCompany);
closeBtn?.addEventListener('click', requestCompanyClose);

window.sproutgCompany.onApplySettings((settings) => {
  if (settings) applySettingsUi(settings);
});
window.sproutgCompany.onPrepareClose(prepareClose);
window.sproutgCompany.onPrepareWriteBarrier(async (request) => {
  try {
    window.sproutgCompany.completeWriteBarrier({
      id:request?.id,
      ...(await prepareWriteBarrier(request))
    });
  } catch (error) {
    window.sproutgCompany.completeWriteBarrier({
      id:request?.id,
      ok:false,
      error:String(error?.message || error)
    });
  }
});
window.sproutgCompany.onReleaseWriteBarrier(releaseWriteBarrier);
window.sproutgCompany.onNativeCloseRequest(requestCompanyClose);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    requestCompanyClose();
  }
});

(async () => {
  const settings = await window.sproutgCompany.getSettings();
  applySettingsUi(settings || { theme: 'dark-classic' });
  await loadMeta();
  setupElasticBounce(grid);
  setupAuxWindowDrag(window.sproutgCompany);
})();
