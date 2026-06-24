const $ = (id) => document.getElementById(id);

const elToday = $('todayValue');
const elTodayHint = $('todayHint');
const elMonthTotal = $('monthTotal');
const elMonthHint = $('monthHint');
const elMonthRecord = $('monthRecord');
const elMonthRecordHint = $('monthRecordHint');
const elMonthAvg = $('monthAvg');
const elMonthAvgHint = $('monthAvgHint');

const weekCanvas = $('weekChart');
const weekTooltip = $('weekTooltip');
const todayCanvas = $('todayChart');
const todayTooltip = $('todayTooltip');
const monthCanvas = $('monthChart');
const monthTooltip = $('monthTooltip');
const todayLegend = $('todayLegend');
const weekLegend = $('weekLegend');
const monthLegend = $('monthLegend');

const workAllCanvas = $('workAllChart');
const workAllTooltip = $('workAllTooltip');
const workOneCanvas = $('workOneChart');
const workOneTooltip = $('workOneTooltip');
const workTable = $('workTable');
const workChips = $('workChips');
const workOneTitle = $('workOneTitle');
const workTabs = $('workTabs');
const monthSelect = $('monthSelect');
const monthTabs = $('monthTabs');
const periodButton = $('periodButton');
const monthPicker = $('monthPicker');
const monthPickerMonth = $('monthPickerMonth');
const monthPickerYear = $('monthPickerYear');
const monthPickerApply = $('monthPickerApply');
const todayPrevBtn = $('todayPrevBtn');
const todayNextBtn = $('todayNextBtn');
const todayChartTitle = $('todayChartTitle');
const statsCloseBtn = $('statsCloseBtn');
const weekPrevBtn = $('weekPrevBtn');
const weekNextBtn = $('weekNextBtn');
const monthPrevBtn = $('monthPrevBtn');
const monthNextBtn = $('monthNextBtn');
const weekTitle = $('weekTitle');
const monthTitle = $('monthTitle');

let __lastPoints = null;
let closing = false;
let __retryTimer = null;
let __retryCount = 0;
const STATS_MONTH_KEY = 'sproutg.stats.selectedMonth';
const STATS_DAY_KEY = 'sproutg.stats.selectedDay';
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
function scheduleRetry(){
  if (__retryTimer) return;
  if (__retryCount > 12) return; // ~1s max
  __retryCount++;
  __retryTimer = setTimeout(() => {
    __retryTimer = null;
    if (__lastPoints) { try { render(__lastPoints); } catch(e) {} }
  }, 80);
}


function pad2(n){ return String(n).padStart(2,'0'); }
function toDateKey(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

function startOfWeekMonday(date){
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}
function daysInMonth(y,m0){ return new Date(y, m0+1, 0).getDate(); }
function dateFromKey(key){
  const [y,m,d] = String(key || '').split('-').map(Number);
  return new Date(y || 2000, (m || 1) - 1, d || 1);
}
function addDays(date, delta){
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + delta);
  return d;
}
function addMonthsToKey(monthKey, delta){
  const [y,m] = String(monthKey || monthKeyFromDate(new Date())).split('-').map(Number);
  return monthKeyFromDate(new Date(y || new Date().getFullYear(), (m || 1) - 1 + delta, 1));
}
function formatDateRange(start, end){
  return `${toDateKey(start).split('-').reverse().join('.')} — ${toDateKey(end).split('-').reverse().join('.')}`;
}
function isSameDateKey(a, b){ return toDateKey(a) === toDateKey(b); }
function persistStatsSelection(){
  try {
    if(selectedMonthKey) localStorage.setItem(STATS_MONTH_KEY, selectedMonthKey);
    if(selectedDayKey) localStorage.setItem(STATS_DAY_KEY, selectedDayKey);
  } catch(e) {}
}

function dayLabel(dayKey){
  const now = new Date();
  const today = toDateKey(now);
  const yesterday = toDateKey(addDays(now, -1));
  if(dayKey === today) return 'Сегодня';
  if(dayKey === yesterday) return 'Вчера';
  return String(dayKey || '').split('-').reverse().join('.');
}

function clampSelectedDay(){
  const today = toDateKey(new Date());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(selectedDayKey || '')) || selectedDayKey > today){
    selectedDayKey = today;
  }
  persistStatsSelection();
}

function getCssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function clearCanvas(c){
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  const w = rect.width || 0;
  const h = rect.height || 0;
  if (w < 20 || h < 20) {
    // Layout not ready (0x0 / too small). Skip drawing; caller may retry.
    try { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,1,1); } catch(e) {}
    return { ctx, w, h, notReady: true };
  }
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  return { ctx, w, h, notReady: false };
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}


function drawAreaSeries(canvas, labels, seriesMap, colors, opts = {}){
  const { ctx, w, h, notReady } = clearCanvas(canvas);
  if (notReady) return false;
  const border = getCssVar('--border');
  const muted2 = getCssVar('--muted2');
  const padX = 10, padY = 10;
  const baseY = h - padY;
  const n = labels.length;
  if (!n) return;

  // compute max
  let max = 1;
  for (const key of Object.keys(seriesMap)){
    const arr = seriesMap[key] || [];
    for (const v of arr) max = Math.max(max, Number(v||0));
  }
  // grid
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  for (let i=1;i<=3;i++){
    const y = padY + ((baseY - padY) * i/4);
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(w - padX, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const stepX = (w - padX*2) / Math.max(1, n-1);
  const hoverIndex = Number.isFinite(opts.hoverIndex) ? Math.max(0, Math.min(n - 1, opts.hoverIndex)) : null;

  function yFor(v){
    return baseY - (Number(v||0)/max) * (baseY - padY);
  }

  for (const key of Object.keys(seriesMap)){
    const arr = seriesMap[key] || [];
    const col = colors[key] || ['rgba(56,189,248,0.55)','rgba(99,102,241,0.25)'];
    // path
    ctx.beginPath();
    for (let i=0;i<n;i++){
      const x = padX + i*stepX;
      const y = yFor(arr[i] || 0);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    // fill to baseline
    ctx.lineTo(padX + (n-1)*stepX, baseY);
    ctx.lineTo(padX, baseY);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, padY, 0, baseY);
    grad.addColorStop(0, col[0]);
    grad.addColorStop(1, col[1]);
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;

    // outline
    ctx.beginPath();
    for (let i=0;i<n;i++){
      const x = padX + i*stepX;
      const y = yFor(arr[i] || 0);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = col[0];
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (hoverIndex !== null){
    const hx = padX + hoverIndex * stepX;
    ctx.save();
    ctx.strokeStyle = border;
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, padY);
    ctx.lineTo(hx, baseY);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const key of Object.keys(seriesMap)){
      const arr = seriesMap[key] || [];
      const v = Number(arr[hoverIndex] || 0);
      if(!v) continue;
      const col = colors[key] || ['rgba(56,189,248,0.55)','rgba(99,102,241,0.25)'];
      const hy = yFor(v);
      ctx.globalAlpha = 1;
      ctx.fillStyle = getCssVar('--panel') || 'rgba(0,0,0,.78)';
      ctx.strokeStyle = col[0];
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // x labels (sparse)
  ctx.fillStyle = muted2;
  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.textAlign = 'center';
  for (let i=0;i<n;i++){
    if (n <= 8 || i===0 || i===n-1 || (i%2===0 && n<=14) || (i%5===0 && n>14)){
      const x = padX + i*stepX;
      ctx.fillText(labels[i], x, h - 2);
    }
  }
  canvas.__redraw = (hoverIndex = null)=>drawAreaSeries(canvas, labels, seriesMap, colors, { hoverIndex });
  return true;
}


function drawBars(canvas, labels, values, opts={}){
  if (!canvas) return false;
  const r = clearCanvas(canvas);
  if (r.notReady) return false;
  const { ctx, w, h } = r;
  labels = Array.isArray(labels) ? labels : [];
  values = Array.isArray(values) ? values : [];
  if (!labels.length || !values.length) return false;
  try {
  const border = getCssVar('--border');
  const muted2 = getCssVar('--muted2');

  const max = Math.max(10, ...values);
  const padX = 6;
  const padY = 8;
  const barGap = 6;
  const barW = (w - padX*2 - barGap*(labels.length-1)) / labels.length;
  const baseY = h - padY;
  const hoverIndex = Number.isFinite(opts.hoverIndex) ? Math.max(0, Math.min(labels.length - 1, opts.hoverIndex)) : null;

  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  for (let i=1;i<=3;i++){
    const y = padY + ((baseY - padY) * i/4);
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(w - padX, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (let i=0;i<labels.length;i++){
    const v = values[i] || 0;
    const x = padX + i*(barW + barGap);
    const barH = Math.round((v / max) * (baseY - padY));
    const y = baseY - barH;

    const grad = ctx.createLinearGradient(0, y, 0, baseY);
    const p = themePalette();
    grad.addColorStop(0, hexToRgba(p.a, 0.62));
    grad.addColorStop(1, hexToRgba(p.b, 0.26));

    ctx.fillStyle = grad;
    roundRect(ctx, x, y, barW, barH, 10);
    ctx.fill();

    if(i === hoverIndex){
      ctx.save();
      ctx.strokeStyle = getCssVar('--text') || 'rgba(255,255,255,.9)';
      ctx.fillStyle = getCssVar('--panel') || 'rgba(0,0,0,.78)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x + barW / 2, Math.max(padY + 5, y), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = muted2;
    ctx.font = '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW/2, h - 2);
  }

  if (opts.showMax){
    ctx.fillStyle = muted2;
    ctx.font = '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'right';
    ctx.fillText(`макс: ${max}`, w - 2, 10);
  }
  canvas.__redraw = (hoverIndex = null)=>drawBars(canvas, labels, values, { ...opts, hoverIndex });
  } catch (e) {
    return false;
  }
  return true;
}



const WORK_LABELS = {
  'Аккаунт (O1)': 'Аккаунты',
  'Аккаунт MCC (MCC)': 'Аккаунты MCC',
  'Речек (O1)': 'Речек O1',
  'Речек (MCC)': 'Речек MCC',
  'Ads Видео (O1)': 'Ads Видео',
  'Платежка (O1)': 'Платежка',
  'РК (O1)': 'РК',
  'Верификации (O1+MCC)': 'Верификации',
  'Апелляции O1': 'Апелляции O1',
  'Апелляции MCC': 'Апелляции MCC',
  'Мини (O1+MCC)': 'Мини',
};
function labelForType(t){
  return WORK_LABELS[t] || String(t||'').replace(/\s*\([^)]*\)\s*/g,'').trim();
}

const WORK_TYPES = [
  'Аккаунт (O1)',
  'Ads Видео (O1)',
  'Платежка (O1)',
  'Речек (O1)',
  'РК (O1)',
  'Аккаунт MCC (MCC)',
  'Речек (MCC)',
  'Верификации (O1+MCC)',
  'Апелляции O1',
  'Апелляции MCC',
];

const WORK_COLORS = {
  'Аккаунт (O1)': ['rgba(56,189,248,0.55)','rgba(56,189,248,0.08)'],
  'Ads Видео (O1)': ['rgba(99,102,241,0.55)','rgba(99,102,241,0.08)'],
  'Платежка (O1)': ['rgba(16,185,129,0.55)','rgba(16,185,129,0.08)'],
  'Речек (O1)': ['rgba(245,158,11,0.55)','rgba(245,158,11,0.08)'],
  'РК (O1)': ['rgba(244,63,94,0.55)','rgba(244,63,94,0.08)'],
  'Аккаунт MCC (MCC)': ['rgba(147,51,234,0.55)','rgba(147,51,234,0.08)'],
  'Речек (MCC)': ['rgba(14,165,233,0.55)','rgba(14,165,233,0.08)'],
  'Верификации (O1+MCC)': ['rgba(236,72,153,0.55)','rgba(236,72,153,0.08)'],
  'Апелляции O1': ['rgba(34,197,94,0.55)','rgba(34,197,94,0.08)'],
  'Апелляции MCC': ['rgba(132,204,22,0.55)','rgba(132,204,22,0.08)'],
};
function getWorkColors(){
  const p = themePalette();
  const palette = [
    [p.a, 0.64], [p.b, 0.62], [p.c, 0.60], [p.d, 0.60],
    [p.a, 0.52], [p.b, 0.56], [p.c, 0.54], [p.d, 0.54],
    [p.a, 0.48], [p.b, 0.48], [p.c, 0.46]
  ];
  return WORK_TYPES.reduce((acc, type, index) => {
    const [color, alpha] = palette[index % palette.length];
    acc[type] = [hexToRgba(color, alpha), hexToRgba(color, 0.08)];
    return acc;
  }, {});
  return {
    'РђРєРєР°СѓРЅС‚ (O1)': [hexToRgba(p.a,0.62), hexToRgba(p.a,0.08)],
    'Ads Р’РёРґРµРѕ (O1)': [hexToRgba(p.b,0.62), hexToRgba(p.b,0.08)],
    'РџР»Р°С‚РµР¶РєР° (O1)': [hexToRgba(p.c,0.62), hexToRgba(p.c,0.08)],
    'Р РµС‡РµРє (O1)': [hexToRgba(p.d,0.62), hexToRgba(p.d,0.08)],
    'Р Рљ (O1)': [hexToRgba(p.d,0.56), hexToRgba(p.d,0.08)],
    'РђРєРєР°СѓРЅС‚ MCC (MCC)': [hexToRgba(p.a,0.56), hexToRgba(p.a,0.08)],
    'Р РµС‡РµРє (MCC)': [hexToRgba(p.b,0.56), hexToRgba(p.b,0.08)],
    'Р’РµСЂРёС„РёРєР°С†РёРё (O1+MCC)': [hexToRgba(p.c,0.56), hexToRgba(p.c,0.08)],
    'РђРїРµР»Р»СЏС†РёРё O1': [hexToRgba(p.a,0.50), hexToRgba(p.a,0.08)],
    'РђРїРµР»Р»СЏС†РёРё MCC': [hexToRgba(p.b,0.50), hexToRgba(p.b,0.08)],
    'РњРёРЅРё (O1+MCC)': [hexToRgba(p.c,0.50), hexToRgba(p.c,0.08)]
  };
}

function prepareClose(){
  if (closing) return;
  closing = true;
  document.body.classList.add('sgClosing');
}

statsCloseBtn?.addEventListener('click', () => {
  prepareClose();
  window.sproutgStats.closeWindow?.().catch?.(()=>{});
});

function bindHorizontalWheel(el){
  if(!el || el.dataset.wheelTabsBound === '1') return;
  el.dataset.wheelTabsBound = '1';
  el.addEventListener('wheel', (event)=>{
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if(!delta) return;
    event.preventDefault();
    el.scrollBy({ left: delta, behavior:'smooth' });
  }, { passive:false });
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
  }, { passive:false });
}

let currentWorkRange = 'week';
let currentWorkType = WORK_TYPES[0];
let selectedMonthKey = (() => { try { return localStorage.getItem(STATS_MONTH_KEY) || ''; } catch(e) { return ''; } })();
let selectedWeekStartKey = '';
let selectedDayKey = (() => { try { return localStorage.getItem(STATS_DAY_KEY) || ''; } catch(e) { return ''; } })();

function setActive(el, cls){
  for (const b of el.parentElement.querySelectorAll('.'+cls)) b.classList.remove('is-active');
  el.classList.add('is-active');
  return true;
}


function ensureWorkChips(){
  if (!workChips) return;
  if (workChips.dataset.ready === '1') return;
  workChips.innerHTML = '';
  for (const t of WORK_TYPES){
    const b = document.createElement('button');
    b.className = 'chip' + (t===currentWorkType ? ' is-active':'' );
    b.textContent = labelForType(t);
    b.title = t;
    b.addEventListener('click', () => {
      currentWorkType = t;
      for (const ch of workChips.querySelectorAll('.chip')) ch.classList.remove('is-active');
      b.classList.add('is-active');
      // re-render using last data
      if (window.__lastStatsData) render(window.__lastStatsData);
    });
    workChips.appendChild(b);
  }
  workChips.dataset.ready = '1';
}

function bindWorkTabs(){
  if (!workTabs) return;
  if (workTabs.dataset.ready === '1') return;
  for (const b of workTabs.querySelectorAll('.tab')){
    b.addEventListener('click', () => {
      for (const t of workTabs.querySelectorAll('.tab')) t.classList.remove('is-active');
      b.classList.add('is-active');
      currentWorkRange = b.dataset.range || 'week';
      if (window.__lastStatsData) render(window.__lastStatsData);
    });
  }
  workTabs.dataset.ready = '1';
}

function animatePeriod(kind, delta){
  const wrap = kind === 'week' ? weekCanvas?.closest('.chartwrap') : monthCanvas?.closest('.chartwrap');
  if(!wrap) return;
  wrap.classList.remove('period-left', 'period-right');
  void wrap.offsetWidth;
  wrap.classList.add(delta < 0 ? 'period-right' : 'period-left');
  setTimeout(() => wrap.classList.remove('period-left', 'period-right'), 240);
}

function updatePeriodControls(){
  const now = new Date();
  const currentWeekKey = toDateKey(startOfWeekMonday(now));
  if(!selectedWeekStartKey) selectedWeekStartKey = currentWeekKey;
  const weekStart = dateFromKey(selectedWeekStartKey);
  const weekEnd = addDays(weekStart, 6);
  if(weekTitle) {
    weekTitle.textContent = selectedWeekStartKey === currentWeekKey ? 'Текущая неделя' : formatDateRange(weekStart, weekEnd);
  }
  if(weekNextBtn) weekNextBtn.disabled = selectedWeekStartKey >= currentWeekKey;

  const currentMonthKey = monthKeyFromDate(now);
  if(!selectedMonthKey) selectedMonthKey = currentMonthKey;
  if(periodButton) periodButton.textContent = selectedMonthKey === currentMonthKey ? 'Текущий месяц' : monthLabel(selectedMonthKey);
  if(monthTitle) {
    monthTitle.textContent = selectedMonthKey === currentMonthKey ? 'Текущий месяц' : monthLabel(selectedMonthKey);
  }
  if(monthNextBtn) monthNextBtn.disabled = selectedMonthKey >= currentMonthKey;

  clampSelectedDay();
  if(todayChartTitle) todayChartTitle.textContent = dayLabel(selectedDayKey);
  if(todayNextBtn) todayNextBtn.disabled = selectedDayKey >= toDateKey(new Date());
}

function bindPeriodNavigation(){
  if(todayPrevBtn && todayPrevBtn.dataset.bound !== '1'){
    todayPrevBtn.dataset.bound = '1';
    todayPrevBtn.addEventListener('click', () => {
      clampSelectedDay();
      selectedDayKey = toDateKey(addDays(dateFromKey(selectedDayKey), -1));
      persistStatsSelection();
      const wrap = todayCanvas?.closest('.chartwrap');
      if(wrap){
        wrap.classList.remove('period-left', 'period-right');
        void wrap.offsetWidth;
        wrap.classList.add('period-right');
        setTimeout(() => wrap.classList.remove('period-left', 'period-right'), 260);
      }
      if(window.__lastStatsData) render(window.__lastStatsData);
    });
  }
  if(todayNextBtn && todayNextBtn.dataset.bound !== '1'){
    todayNextBtn.dataset.bound = '1';
    todayNextBtn.addEventListener('click', () => {
      clampSelectedDay();
      const today = toDateKey(new Date());
      const next = toDateKey(addDays(dateFromKey(selectedDayKey), 1));
      if(next > today) return;
      selectedDayKey = next;
      persistStatsSelection();
      const wrap = todayCanvas?.closest('.chartwrap');
      if(wrap){
        wrap.classList.remove('period-left', 'period-right');
        void wrap.offsetWidth;
        wrap.classList.add('period-left');
        setTimeout(() => wrap.classList.remove('period-left', 'period-right'), 260);
      }
      if(window.__lastStatsData) render(window.__lastStatsData);
    });
  }
  if(periodButton && periodButton.dataset.bound !== '1'){
    periodButton.dataset.bound = '1';
    periodButton.addEventListener('click', () => {
      setupMonthPickerUi();
      if(monthPicker) monthPicker.hidden = !monthPicker.hidden;
    });
  }
  if(monthPickerApply && monthPickerApply.dataset.bound !== '1'){
    monthPickerApply.dataset.bound = '1';
    monthPickerApply.addEventListener('click', () => {
      const m0 = Math.max(0, Math.min(11, Number(monthPickerMonth?.value || 0)));
      const year = Math.max(2020, Math.min(2100, Number(monthPickerYear?.value || new Date().getFullYear())));
      selectedMonthKey = monthKeyFromDate(new Date(year, m0, 1));
      persistStatsSelection();
      if(monthSelect) monthSelect.value = selectedMonthKey;
      if(monthPicker) monthPicker.hidden = true;
      animatePeriod('month', 1);
      if(window.__lastStatsData) render(window.__lastStatsData);
    });
  }
  if(monthPicker && monthPicker.dataset.outsideBound !== '1'){
    monthPicker.dataset.outsideBound = '1';
    document.addEventListener('pointerdown', (event)=>{
      if(monthPicker.hidden) return;
      if(monthPicker.contains(event.target) || periodButton?.contains(event.target)) return;
      monthPicker.hidden = true;
    });
  }
  if(weekPrevBtn && weekPrevBtn.dataset.bound !== '1'){
    weekPrevBtn.dataset.bound = '1';
    weekPrevBtn.addEventListener('click', () => {
      const base = selectedWeekStartKey ? dateFromKey(selectedWeekStartKey) : startOfWeekMonday(new Date());
      selectedWeekStartKey = toDateKey(addDays(base, -7));
      persistStatsSelection();
      animatePeriod('week', -1);
      if(window.__lastStatsData) render(window.__lastStatsData);
    });
  }
  if(weekNextBtn && weekNextBtn.dataset.bound !== '1'){
    weekNextBtn.dataset.bound = '1';
    weekNextBtn.addEventListener('click', () => {
      const nowWeek = toDateKey(startOfWeekMonday(new Date()));
      const base = selectedWeekStartKey ? dateFromKey(selectedWeekStartKey) : startOfWeekMonday(new Date());
      const next = toDateKey(addDays(base, 7));
      if(next > nowWeek) return;
      selectedWeekStartKey = next;
      persistStatsSelection();
      animatePeriod('week', 1);
      if(window.__lastStatsData) render(window.__lastStatsData);
    });
  }
  if(monthPrevBtn && monthPrevBtn.dataset.bound !== '1'){
    monthPrevBtn.dataset.bound = '1';
    monthPrevBtn.addEventListener('click', () => {
      selectedMonthKey = addMonthsToKey(selectedMonthKey || monthKeyFromDate(new Date()), -1);
      persistStatsSelection();
      if(monthSelect) monthSelect.value = selectedMonthKey;
      animatePeriod('month', -1);
      if(window.__lastStatsData) render(window.__lastStatsData);
    });
  }
  if(monthNextBtn && monthNextBtn.dataset.bound !== '1'){
    monthNextBtn.dataset.bound = '1';
    monthNextBtn.addEventListener('click', () => {
      const nowKey = monthKeyFromDate(new Date());
      const next = addMonthsToKey(selectedMonthKey || nowKey, 1);
      if(next > nowKey) return;
      selectedMonthKey = next;
      persistStatsSelection();
      if(monthSelect) monthSelect.value = selectedMonthKey;
      animatePeriod('month', 1);
      if(window.__lastStatsData) render(window.__lastStatsData);
    });
  }
}

function setupMonthPickerUi(){
  if(!monthPickerMonth || !monthPickerYear) return;
  if(monthPickerMonth.dataset.ready !== '1'){
    monthPickerMonth.dataset.ready = '1';
    monthPickerMonth.innerHTML = '';
    MONTHS_RU.forEach((name, index)=>{
      const opt = document.createElement('option');
      opt.value = String(index);
      opt.textContent = name;
      monthPickerMonth.appendChild(opt);
    });
  }
  const [y, m] = String(selectedMonthKey || monthKeyFromDate(new Date())).split('-').map(Number);
  monthPickerMonth.value = String(Math.max(0, (m || 1) - 1));
  monthPickerYear.value = String(y || new Date().getFullYear());
}



function computeCountsForKeys(workDays, keys){
  const res = {};
  for (const k of keys){
    const by = workDays?.[k]?.byType || {};
    for (const [t,v] of Object.entries(by)){
      res[t] = (res[t] || 0) + Number(v || 0);
    }
  }
  return res;
}

function renderWorkTable(workDays){
  if (!workTable) return;

  const now = new Date();
  const todayKey = toDateKey(now);
  const selected = selectedMonthKey || monthKeyFromDate(now);
  const selectedParts = selected.split('-').map(Number);
  const selectedYear = selectedParts[0] || now.getFullYear();
  const selectedMonth0 = selectedParts[1] ? selectedParts[1] - 1 : now.getMonth();

  const w0 = selectedWeekStartKey ? dateFromKey(selectedWeekStartKey) : startOfWeekMonday(now);
  const weekKeys = [];
  for (let i=0;i<7;i++){
    const d = new Date(w0);
    d.setDate(w0.getDate()+i);
    weekKeys.push(toDateKey(d));
  }

  const y = selectedYear;
  const m0 = selectedMonth0;
  const dim = daysInMonth(y,m0);
  const monthKeys = [];
  for (let day=1; day<=dim; day++){
    monthKeys.push(toDateKey(new Date(y,m0,day)));
  }

  const todayCounts = computeCountsForKeys(workDays, [todayKey]);
  const weekCounts  = computeCountsForKeys(workDays, weekKeys);
  const monthCounts = computeCountsForKeys(workDays, monthKeys);

  const types = new Set([...Object.keys(todayCounts), ...Object.keys(weekCounts), ...Object.keys(monthCounts)]);
  const rows = Array.from(types)
    .map(t => [t, todayCounts[t]||0, weekCounts[t]||0, monthCounts[t]||0])
    .filter(([,a,b,c]) => (a+b+c) !== 0)
    .sort((r1,r2) => (r2[1]+r2[2]+r2[3]) - (r1[1]+r1[2]+r1[3]));

  if (!rows.length){
    workTable.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:11px;font-weight:900;">Пока нет данных.</div>';
    return;
  }

  const esc = (s)=>String(s).replace(/[&<>"]/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  let html = '<table><thead><tr><th>Категория</th><th style="text-align:right;">Сегодня</th><th style="text-align:right;">Неделя</th><th style="text-align:right;">Месяц</th></tr></thead><tbody>';
  for (const [t,a,b,c] of rows){
    html += `<tr><td title="${esc(t)}">${esc(labelForType(t))}</td><td class="num">${a}</td><td class="num">${b}</td><td class="num">${c}</td></tr>`;
  }
  html += '</tbody></table>';
  workTable.innerHTML = html;
}



function setCanvasTooltipData(canvas, data){
  if (!canvas) return;
  canvas.__ttData = data;
}

function slotTime(slot){
  const minutes = Math.max(0, Math.min(72, Number(slot) || 0)) * 20;
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function activitySummary(dayData, type){
  const slots = dayData?.slots || {};
  const rows = Object.entries(slots).map(([slot, info]) => {
    const total = type ? Number(info?.byType?.[type] || 0) : Number(info?.total || 0);
    return { slot: Number(slot), total };
  }).filter((row) => row.total > 0).sort((a, b) => a.slot - b.slot);
  if (!rows.length) return '';
  const first = rows[0].slot;
  const last = rows[rows.length - 1].slot;
  const peak = rows.reduce((best, row) => row.total > best.total ? row : best, rows[0]);
  return `A ${slotTime(first)}–${slotTime(last + 1)} · P ${slotTime(peak.slot)} (${peak.total})`;
}

function tooltipActivityLine(data, index, type){
  const key = data?.dayKeys?.[index];
  if(!key) return '';
  const dayData = data?.workDays?.[key];
  const total = type
    ? Number(dayData?.byType?.[type] || 0)
    : Number(dayData?.total || 0);
  const summary = activitySummary(data?.workDays?.[key], type);
  if(!summary && !total) return '';
  return `<div class="tt-note">Всего за сутки: ${total}${summary ? `<br>${summary}` : ''}</div>`;
}

function ensureAreaTooltip(canvas, tooltipEl, kind){
  if (!canvas || !tooltipEl) return;
  if (canvas.dataset.ttBound === '1') return;
  canvas.dataset.ttBound = '1';

  const update = (evt) => {
    const data = canvas.__ttData || {};
    const labels = data.labels || [];
    const seriesMap = data.seriesMap || {};
    const colors = data.colors || {};
    const title = data.title || '';
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const n = labels.length;

    if (!n || rect.width <= 2){
      tooltipEl.style.display = 'none';
      return;
    }

    const idx = Math.round((x / rect.width) * (n - 1));
    const i = Math.max(0, Math.min(n-1, idx));
    if(typeof canvas.__redraw === 'function') canvas.__redraw(i);

    if (kind === 'single'){
      const t = data.singleType || Object.keys(seriesMap)[0];
      const arr = seriesMap?.[t] || [];
      const v = Number(arr?.[i] || 0);
      const col = colors?.[t]?.[0] || 'rgba(56,189,248,0.9)';
      let inner = `<div class="tt-title">${labels[i]}</div>`;
      inner += `<div class="tt-row"><div class="tt-name"><span class="tt-dot" style="border-color:${col};"></span>${labelForType(t)}</div><div class="tt-val">${v}</div></div>`;
      inner += tooltipActivityLine(data, i, t);
      tooltipEl.innerHTML = inner;
      tooltipEl.style.display = 'block';
      return;
    }

    // stacked / multi
    const rows = [];
    for (const [t,arr] of Object.entries(seriesMap)){
      const v = Number(arr?.[i] || 0);
      if (v) rows.push([t,v]);
    }
    rows.sort((a,b)=>b[1]-a[1]);

    if (!rows.length){
      tooltipEl.style.display = 'none';
      return;
    }

    const top = rows.slice(0, 7);
    let inner = `<div class="tt-title">${labels[i]}</div>`;
    for (const [t,v] of top){
      const col = colors?.[t]?.[0] || 'rgba(56,189,248,0.9)';
      inner += `<div class="tt-row"><div class="tt-name"><span class="tt-dot" style="border-color:${col};"></span>${labelForType(t)}</div><div class="tt-val">${v}</div></div>`;
    }
    if (rows.length > top.length){
      inner += `<div class="tt-row"><div class="tt-name" style="color:var(--muted);">ещё…</div><div class="tt-val" style="color:var(--muted);">+${rows.length - top.length}</div></div>`;
    }
    inner += tooltipActivityLine(data, i, null);
    tooltipEl.innerHTML = inner;
    tooltipEl.style.display = 'block';
  };

  canvas.addEventListener('mousemove', update);
  canvas.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; if(typeof canvas.__redraw === 'function') canvas.__redraw(null); });
}

function ensureBarsTooltip(canvas, tooltipEl){
  if (!canvas || !tooltipEl) return;
  if (canvas.dataset.ttBound === '1') return;
  canvas.dataset.ttBound = '1';

  const update = (evt) => {
    const data = canvas.__ttData || {};
    const labels = data.labels || [];
    const values = data.values || [];
    const dotColor = data.dotColor || 'rgba(56,189,248,0.9)';
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const n = labels.length;

    if (!n || rect.width <= 2){
      tooltipEl.style.display = 'none';
      return;
    }

    const idx = Math.round((x / rect.width) * (n - 1));
    const i = Math.max(0, Math.min(n-1, idx));
    const v = Number(values?.[i] || 0);
    if(typeof canvas.__redraw === 'function') canvas.__redraw(i);

    let inner = `<div class="tt-title">${labels[i]}</div>`;
    inner += `<div class="tt-row"><div class="tt-name"><span class="tt-dot" style="border-color:${dotColor};"></span>${data.name || 'Значение'}</div><div class="tt-val">${v}</div></div>`;
    inner += tooltipActivityLine(data, i, null);
    tooltipEl.innerHTML = inner;
    tooltipEl.style.display = 'block';
  };

  canvas.addEventListener('mousemove', update);
  canvas.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; if(typeof canvas.__redraw === 'function') canvas.__redraw(null); });
}

function buildTodayHourSeries(dayData){
  const hours = Array.from({ length:24 }, ()=>({ total:0, byType:{} }));
  const slots = dayData?.slots || {};
  for(const [slotRaw, info] of Object.entries(slots)){
    const slot = Number(slotRaw);
    if(!Number.isFinite(slot)) continue;
    const hour = Math.max(0, Math.min(23, Math.floor((slot * 20) / 60)));
    const byType = info?.byType || {};
    const entries = Object.entries(byType).filter(([, value])=>Number(value || 0) > 0);
    if(entries.length){
      for(const [type, value] of entries){
        const n = Number(value || 0);
        hours[hour].byType[type] = (hours[hour].byType[type] || 0) + n;
        hours[hour].total += n;
      }
    } else {
      const n = Number(info?.total || 0);
      if(n > 0){
        hours[hour].byType['Действия'] = (hours[hour].byType['Действия'] || 0) + n;
        hours[hour].total += n;
      }
    }
  }
  return hours;
}

function drawTodayHours(canvas, hours, colors, opts = {}){
  if(!canvas) return false;
  const r = clearCanvas(canvas);
  if(r.notReady) return false;
  const { ctx, w, h } = r;
  const labels = Array.from({ length:24 }, (_, i)=>pad2(i));
  const border = getCssVar('--border');
  const muted2 = getCssVar('--muted2');
  const text = getCssVar('--text');
  const padX = 8;
  const padY = 10;
  const baseY = h - 16;
  const gap = 3;
  const barW = Math.max(4, (w - padX * 2 - gap * 23) / 24);
  const max = Math.max(1, ...hours.map(hour=>Number(hour.total || 0)));
  const hoverIndex = Number.isFinite(opts.hoverIndex) ? Math.max(0, Math.min(23, opts.hoverIndex)) : null;
  const typeOrder = Array.from(new Set([
    ...WORK_TYPES,
    ...hours.flatMap(hour=>Object.keys(hour.byType || {}))
  ]));

  ctx.save();
  ctx.globalAlpha = .58;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  for(let i=1;i<=3;i++){
    const y = padY + ((baseY - padY) * i/4);
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(w - padX, y);
    ctx.stroke();
  }
  ctx.restore();

  for(let i=0;i<24;i++){
    const hour = hours[i] || { total:0, byType:{} };
    const x = padX + i * (barW + gap);
    let y = baseY;
    for(const type of typeOrder){
      const v = Number(hour.byType?.[type] || 0);
      if(!v) continue;
      const hPart = Math.max(2, (v / max) * (baseY - padY));
      const col = colors[type]?.[0] || hexToRgba(themePalette().a, .58);
      ctx.fillStyle = col;
      const nextY = Math.max(padY, y - hPart);
      const drawH = Math.max(1, y - nextY);
      roundRect(ctx, x, nextY, barW, drawH + .5, Math.min(6, barW / 2));
      ctx.fill();
      y = nextY;
      if(y <= padY) break;
    }
    if(!hour.total){
      ctx.fillStyle = border;
      roundRect(ctx, x, baseY - 2, barW, 2, 2);
      ctx.fill();
    }
    if(i === hoverIndex){
      ctx.save();
      ctx.strokeStyle = text;
      ctx.globalAlpha = .72;
      ctx.lineWidth = 1.5;
      roundRect(ctx, x - 1.5, padY, barW + 3, baseY - padY, Math.min(8, barW / 2 + 2));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = getCssVar('--panel') || 'rgba(0,0,0,.78)';
      ctx.strokeStyle = text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + barW / 2, Math.max(padY + 5, y || baseY), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.fillStyle = muted2;
  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial';
  ctx.textAlign = 'center';
  for(let i=0;i<24;i+=3){
    const x = padX + i * (barW + gap) + barW / 2;
    ctx.fillText(labels[i], x, h - 2);
  }

  canvas.__redraw = (hoverIndex = null)=>drawTodayHours(canvas, hours, colors, { hoverIndex });
  return true;
}

function bindTodayTooltip(hours, colors){
  if(!todayCanvas || !todayTooltip) return;
  if(todayCanvas.dataset.todayTtBound !== '1'){
    todayCanvas.dataset.todayTtBound = '1';
    todayCanvas.addEventListener('mousemove', (evt)=>{
      const rect = todayCanvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const idx = Math.max(0, Math.min(23, Math.floor((x / Math.max(1, rect.width)) * 24)));
      if(typeof todayCanvas.__redraw === 'function') todayCanvas.__redraw(idx);
      const hour = todayCanvas.__todayHours?.[idx] || { total:0, byType:{} };
      if(!hour.total){
        todayTooltip.style.display = 'none';
        return;
      }
      const rows = Object.entries(hour.byType || {})
        .map(([type, value])=>[type, Number(value || 0)])
        .filter(([, value])=>value > 0)
        .sort((a,b)=>b[1]-a[1]);
      let inner = `<div class="tt-title">${pad2(idx)}:00–${pad2(idx + 1)}:00 · всего ${hour.total}</div>`;
      for(const [type, value] of rows.slice(0, 8)){
        const col = colors?.[type]?.[0] || 'rgba(56,189,248,0.9)';
        inner += `<div class="tt-row"><div class="tt-name"><span class="tt-dot" style="border-color:${col};"></span>${labelForType(type)}</div><div class="tt-val">${value}</div></div>`;
      }
      if(rows.length > 8){
        inner += `<div class="tt-row"><div class="tt-name" style="color:var(--muted);">ещё…</div><div class="tt-val" style="color:var(--muted);">+${rows.length - 8}</div></div>`;
      }
      todayTooltip.innerHTML = inner;
      todayTooltip.style.display = 'block';
    });
    todayCanvas.addEventListener('mouseleave', ()=>{
      todayTooltip.style.display = 'none';
      if(typeof todayCanvas.__redraw === 'function') todayCanvas.__redraw(null);
    });
  }
  todayCanvas.__todayHours = hours;
}

function bindWorkAllTooltip(labels, seriesMap, dayKeys, workDays){
  // legacy wrapper: keep API, but store data so tooltip works for week+month without re-binding
  try{
    setCanvasTooltipData(workAllCanvas, { labels, seriesMap, colors: getWorkColors(), dayKeys, workDays });
    ensureAreaTooltip(workAllCanvas, workAllTooltip, 'stack');
  }catch(e){}
}


function renderWork(data){
  ensureWorkChips();
  bindWorkTabs();

  const workDays = data?.workDays || {};
  const now = new Date();

  let labels = [];
  let keys = [];

  if (currentWorkRange === 'month'){
    const selected = selectedMonthKey || monthKeyFromDate(now);
    const selectedParts = selected.split('-').map(Number);
    const y = selectedParts[0] || now.getFullYear();
    const m0 = selectedParts[1] ? selectedParts[1] - 1 : now.getMonth();
    const dim = daysInMonth(y,m0);
    for (let day=1; day<=dim; day++){
      const d = new Date(y,m0,day);
      const k = toDateKey(d);
      keys.push(k);
      labels.push(String(day));
    }
  } else {
    const w0 = selectedWeekStartKey ? dateFromKey(selectedWeekStartKey) : startOfWeekMonday(now);
    const weekLabels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    for (let i=0;i<7;i++){
      const d = new Date(w0);
      d.setDate(w0.getDate()+i);
      keys.push(toDateKey(d));
      labels.push(weekLabels[i]);
    }
  }

  const allSeries = {};
  for (const t of WORK_TYPES){
    allSeries[t] = keys.map(k => Number(workDays[k]?.byType?.[t] || 0));
  }

  const colors = getWorkColors();
  const okAll = drawAreaSeries(workAllCanvas, labels, allSeries, colors);
  try{ bindWorkAllTooltip(labels, allSeries, keys, workDays); }catch(e){}

  const oneSeries = {};
  oneSeries[currentWorkType] = allSeries[currentWorkType] || keys.map(()=>0);
  workOneTitle.textContent = labelForType(currentWorkType);
  const okOne = drawAreaSeries(workOneCanvas, labels, oneSeries, colors);
  try{ setCanvasTooltipData(workOneCanvas, { labels, seriesMap: oneSeries, colors, singleType: currentWorkType, dayKeys: keys, workDays }); ensureAreaTooltip(workOneCanvas, workOneTooltip, 'single'); }catch(e){}

  if (okAll === false || okOne === false) return false;
  // summary table
  try{ renderWorkTable(workDays); }catch(e){}
  return true;
}



function render(points){
  __lastPoints = points;
  const days = points?.days || {};
  bindPeriodNavigation();
  ensureMonthSelect(days);
  updatePeriodControls();
  const now = new Date();
  const todayKey = toDateKey(now);
  const today = days[todayKey]?.total || 0;

  elToday.textContent = String(today);
  elTodayHint.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())} · 00:00–23:59`;

  clampSelectedDay();
  const chartDayKey = selectedDayKey || todayKey;
  const todayHours = buildTodayHourSeries(points?.workDays?.[chartDayKey]);
  const todayColors = getWorkColors();
  const okToday = drawTodayHours(todayCanvas, todayHours, todayColors);
  try{ bindTodayTooltip(todayHours, todayColors); }catch(e){}
  if(!okToday) { scheduleRetry(); return; }
  if(todayLegend){
    const activeHours = todayHours.filter(hour=>Number(hour.total || 0) > 0).length;
    const totalActions = todayHours.reduce((sum, hour)=>sum + Number(hour.total || 0), 0);
    todayLegend.textContent = activeHours ? `${dayLabel(chartDayKey)} · ${activeHours} ч активности · ${totalActions} действий` : `${dayLabel(chartDayKey)} · нет действий по часам`;
  }

  if (!selectedWeekStartKey) selectedWeekStartKey = toDateKey(startOfWeekMonday(now));
  const w0 = dateFromKey(selectedWeekStartKey);
  const weekLabels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const weekValues = [];
  const weekKeys = [];
  const weekTooltipLabels = [];
  for (let i=0;i<7;i++){
    const d = new Date(w0);
    d.setDate(w0.getDate()+i);
    const k = toDateKey(d);
    weekKeys.push(k);
    weekValues.push(days[k]?.total || 0);
    weekTooltipLabels.push(`${weekLabels[i]} ${k.split('-').reverse().join('.')}`);
  }
  const okWeek = drawBars(weekCanvas, weekLabels, weekValues, {showMax:true});
  try{ setCanvasTooltipData(weekCanvas, { labels: weekTooltipLabels, values: weekValues, name: 'Поинты', dayKeys: weekKeys, workDays: points?.workDays || {}, dotColor: (document.documentElement.getAttribute('data-theme')==='light'?'rgba(56,189,248,0.85)':'rgba(56,189,248,0.9)') }); ensureBarsTooltip(weekCanvas, weekTooltip); }catch(e){}

  if (!okWeek) { scheduleRetry(); return; }
  weekLegend.textContent = `${weekKeys[0].split('-').reverse().join('.')} — ${weekKeys[6].split('-').reverse().join('.')}`;

  const selected = String(selectedMonthKey || monthKeyFromDate(now));
  const selectedParts = selected.split('-').map(Number);
  const y = selectedParts[0] || now.getFullYear();
  const m0 = selectedParts[1] ? selectedParts[1] - 1 : now.getMonth();
  const dim = daysInMonth(y, m0);

  let monthSum = 0;
  let monthMax = 0;
  let monthMaxKey = null;
  const monthValues = [];
  const monthKeys = [];

  for (let day=1; day<=dim; day++){
    const d = new Date(y, m0, day);
    const k = toDateKey(d);
    const v = days[k]?.total || 0;
    monthKeys.push(k);
    monthValues.push(v);
    monthSum += v;
    if (v > monthMax) { monthMax = v; monthMaxKey = k; }
  }


// global record (all-time), does NOT reset by month
let recordMax = 0;
let recordKey = null;
for (const [k,obj] of Object.entries(days || {})){
  const v = Number(obj?.total || 0);
  if (v > recordMax){
    recordMax = v;
    recordKey = k;
  }
}

  elMonthTotal.textContent = String(monthSum);
  elMonthHint.textContent = `${pad2(m0+1)}.${y}`;
  elMonthRecord.textContent = String(recordMax);
  elMonthRecordHint.textContent = recordKey ? recordKey.split('-').reverse().join('.') : '—';

  const elapsedDays = monthKeyFromDate(now) === selected ? now.getDate() : dim;
  const avg = elapsedDays ? Math.round(monthSum / elapsedDays) : 0;
  elMonthAvg.textContent = String(avg);
  elMonthAvgHint.textContent = `за ${elapsedDays} дн.`;

  const labels = monthValues.map((_,i)=> (i%5===0 ? String(i+1) : ''));
  const okMonth = drawBars(monthCanvas, labels, monthValues, {showMax:false});
  try{ setCanvasTooltipData(monthCanvas, { labels: monthKeys.map(k=>k.split('-').reverse().join('.')), values: monthValues, name: 'Поинты', dayKeys: monthKeys, workDays: points?.workDays || {}, dotColor: themePalette().a }); ensureBarsTooltip(monthCanvas, monthTooltip); }catch(e){}
  if (!okMonth) { scheduleRetry(); return; }
  monthLegend.textContent = `Дни 1–${dim}`;

  // Work summary (counts, not points)
  window.__lastStatsData = points;
  const okWork = renderWork(points);
  if (okWork === false) { scheduleRetry(); return; }

  __retryCount = 0;
}

function setTheme(theme){
  const aliases = { dark:'dark-classic', light:'light-classic', 'midnight-pro':'dark-midnight-pro', forest:'dark-forest', 'cyberpunk-neon':'cyberpunk' };
  const next = aliases[theme] || theme || 'dark-classic';
  const allowed = new Set(['dark-classic', 'light-classic', 'dark-ios', 'light-ios', 'dark-oldmoney', 'light-oldmoney', 'dark-midnight-pro', 'light-midnight-pro', 'dark-forest', 'light-forest', 'cyberpunk', 'nordic-frost', 'coffee-sepia', 'retro-terminal', 'synthwave', 'vaporwave', 'dark-academia', 'light-academia', 'art-deco', 'bauhaus', 'graphite-pro', 'obsidian', 'slate-blue', 'platinum-light', 'notion-clean', 'linear-dark', 'royal-navy', 'emerald-gold', 'burgundy-club', 'caviar', 'paper-white', 'milk-glass', 'deep-space', 'tokyo-night', 'aurora', 'rainy-day', 'terracotta', 'blueprint', 'swiss', 'executive', 'banking-green', 'marble', 'typewriter', 'amber-terminal', 'mountain']);
  document.documentElement.setAttribute('data-theme', allowed.has(next) ? next : 'dark-classic');
  if (__lastPoints) render(__lastPoints);
}

function applySettingsUi(settings = {}){
  if (settings.theme) setTheme(settings.theme);
  document.documentElement.dataset.graphics = settings.graphicsMode === 'lite' ? 'lite' : 'ultra';
  document.documentElement.dataset.contrast = settings.contrastMode ? 'on' : 'off';
  document.documentElement.dataset.zjk = settings.classicTrafficLights ? 'on' : 'off';
}

function monthKeyFromDate(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
}

function monthLabel(monthKey){
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if(!y || !m) return String(monthKey || '');
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month:'long', year:'numeric' });
}

function ensureMonthSelect(days){
  if(!monthSelect && !monthTabs) return;
  const nowKey = monthKeyFromDate(new Date());
  const keys = new Set([nowKey]);
  for(const k of Object.keys(days || {})){
    const m = String(k || '').slice(0, 7);
    if(/^\d{4}-\d{2}$/.test(m)) keys.add(m);
  }
  if(/^\d{4}-\d{2}$/.test(String(selectedMonthKey || ''))) keys.add(selectedMonthKey);
  const sorted = Array.from(keys).sort().reverse();
  if(!selectedMonthKey) selectedMonthKey = nowKey;
  const currentValue = selectedMonthKey || (monthSelect ? monthSelect.value : nowKey);
  if(monthSelect){
    monthSelect.innerHTML = '';
    for(const key of sorted){
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = monthLabel(key);
      monthSelect.appendChild(opt);
    }
    monthSelect.value = keys.has(currentValue) ? currentValue : selectedMonthKey;
    selectedMonthKey = monthSelect.value;
    persistStatsSelection();
    if(monthSelect.dataset.bound !== '1'){
      monthSelect.dataset.bound = '1';
      monthSelect.addEventListener('change', ()=>{
        selectedMonthKey = monthSelect.value || nowKey;
        persistStatsSelection();
        renderMonthTabs(sorted);
        if(window.__lastStatsData) render(window.__lastStatsData);
      });
    }
  }
  renderMonthTabs(sorted);
}

function renderMonthTabs(sortedKeys){
  if(!monthTabs) return;
  const keys = Array.isArray(sortedKeys) ? sortedKeys : [];
  monthTabs.innerHTML = '';
  for(const key of keys){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'monthTab' + (key === selectedMonthKey ? ' is-active' : '');
    btn.textContent = monthLabel(key);
    btn.dataset.month = key;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', key === selectedMonthKey ? 'true' : 'false');
    btn.addEventListener('click', ()=>{
      if(selectedMonthKey === key) return;
      selectedMonthKey = key;
      persistStatsSelection();
      if(monthSelect) monthSelect.value = key;
      renderMonthTabs(keys);
      if(window.__lastStatsData) render(window.__lastStatsData);
    });
    monthTabs.appendChild(btn);
  }
}

function themePalette(){
  const a = getCssVar('--chartA') || '#38bdf8';
  const b = getCssVar('--chartB') || '#22c55e';
  const c = getCssVar('--chartC') || '#f59e0b';
  const d = getCssVar('--chartD') || '#f43f5e';
  return { a, b, c, d };
}

function hexToRgba(hex, alpha){
  const raw = String(hex || '').trim();
  const m = raw.match(/^#?([0-9a-f]{6})$/i);
  if(!m) return raw;
  const n = parseInt(m[1], 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
}

window.sproutgStats.onApplySettings((s) => { if (s) applySettingsUi(s); });
window.sproutgStats.onPointsUpdated((data) => render(data));
window.sproutgStats.onPrepareClose(prepareClose);
bindHorizontalWheel(monthTabs);
bindHorizontalWheel(workChips);
setupElasticBounce(document.querySelector('.card'));

(async () => {
  const s = await window.sproutgStats.getSettings();
  applySettingsUi(s || { theme: 'dark' });
  const data = await window.sproutgStats.getPoints();
  render(data);
})();
