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

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', normalizeTheme(theme));
}

function setError(msg) {
  errEl.textContent = msg || '';
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

    duplicateState = { value: current, duplicate: !!res.duplicate, checking: false };
    input.dataset.state = res.duplicate ? 'bad' : 'ok';
    if (res.duplicate) {
      setError(`Компания уже есть в колонке A${res.row ? `, строка ${res.row}` : ''}`);
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
    const res = await window.sproutgCompany.apiCall('company.addRow', { values: vr.values }, { cache: false, timeoutMs: 18000 });
    if (!res || res.ok === false) throw new Error(res?.error || 'Ошибка сохранения');
    getInputs().forEach((input) => {
      input.value = '';
      delete input.dataset.state;
    });
    duplicateState = { value: '', duplicate: false, checking: false };
    setError('Компания добавлена');
    setTimeout(() => setError(''), 1300);
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
  if (settings?.theme) setTheme(settings.theme);
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
  setTheme(settings?.theme || 'dark-classic');
  await loadMeta();
})();
