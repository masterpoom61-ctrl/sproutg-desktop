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
const monthCanvas = $('monthChart');
const monthTooltip = $('monthTooltip');
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

let __lastPoints = null;
let __retryTimer = null;
let __retryCount = 0;
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


function drawAreaSeries(canvas, labels, seriesMap, colors){
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
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    grad.addColorStop(0, isLight ? 'rgba(56,189,248,0.55)' : 'rgba(56,189,248,0.45)');
    grad.addColorStop(1, isLight ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.25)');

    ctx.fillStyle = grad;
    roundRect(ctx, x, y, barW, barH, 10);
    ctx.fill();

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
  'Апелл (O1+MCC)': 'Апелл',
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
  'Апелл (O1+MCC)',
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
  'Апелл (O1+MCC)': ['rgba(34,197,94,0.55)','rgba(34,197,94,0.08)'],
};

let currentWorkRange = 'week';
let currentWorkType = WORK_TYPES[0];

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

  const w0 = startOfWeekMonday(now);
  const weekKeys = [];
  for (let i=0;i<7;i++){
    const d = new Date(w0);
    d.setDate(w0.getDate()+i);
    weekKeys.push(toDateKey(d));
  }

  const y = now.getFullYear();
  const m0 = now.getMonth();
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

    if (kind === 'single'){
      const t = data.singleType || Object.keys(seriesMap)[0];
      const arr = seriesMap?.[t] || [];
      const v = Number(arr?.[i] || 0);
      const col = colors?.[t]?.[0] || 'rgba(56,189,248,0.9)';
      let inner = `<div class="tt-title">${labels[i]}</div>`;
      inner += `<div class="tt-row"><div class="tt-name"><span class="tt-dot" style="border-color:${col};"></span>${labelForType(t)}</div><div class="tt-val">${v}</div></div>`;
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
    tooltipEl.innerHTML = inner;
    tooltipEl.style.display = 'block';
  };

  canvas.addEventListener('mousemove', update);
  canvas.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; });
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

    let inner = `<div class="tt-title">${labels[i]}</div>`;
    inner += `<div class="tt-row"><div class="tt-name"><span class="tt-dot" style="border-color:${dotColor};"></span>${data.name || 'Значение'}</div><div class="tt-val">${v}</div></div>`;
    tooltipEl.innerHTML = inner;
    tooltipEl.style.display = 'block';
  };

  canvas.addEventListener('mousemove', update);
  canvas.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; });
}

function bindWorkAllTooltip(labels, seriesMap){
  // legacy wrapper: keep API, but store data so tooltip works for week+month without re-binding
  try{
    setCanvasTooltipData(workAllCanvas, { labels, seriesMap, colors: WORK_COLORS });
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
    const y = now.getFullYear();
    const m0 = now.getMonth();
    const dim = daysInMonth(y,m0);
    for (let day=1; day<=dim; day++){
      const d = new Date(y,m0,day);
      const k = toDateKey(d);
      keys.push(k);
      labels.push(String(day));
    }
  } else {
    const w0 = startOfWeekMonday(now);
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

  const okAll = drawAreaSeries(workAllCanvas, labels, allSeries, WORK_COLORS);
  try{ bindWorkAllTooltip(labels, allSeries); }catch(e){}

  const oneSeries = {};
  oneSeries[currentWorkType] = allSeries[currentWorkType] || keys.map(()=>0);
  workOneTitle.textContent = labelForType(currentWorkType);
  const okOne = drawAreaSeries(workOneCanvas, labels, oneSeries, WORK_COLORS);
  try{ setCanvasTooltipData(workOneCanvas, { labels, seriesMap: oneSeries, colors: WORK_COLORS, singleType: currentWorkType }); ensureAreaTooltip(workOneCanvas, workOneTooltip, 'single'); }catch(e){}

  if (okAll === false || okOne === false) return false;
  // summary table
  try{ renderWorkTable(workDays); }catch(e){}
  return true;
}



function render(points){
  __lastPoints = points;
  const days = points?.days || {};
  const now = new Date();
  const todayKey = toDateKey(now);
  const today = days[todayKey]?.total || 0;

  elToday.textContent = String(today);
  elTodayHint.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())} · 00:00–23:59`;

  const w0 = startOfWeekMonday(now);
  const weekLabels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const weekValues = [];
  const weekKeys = [];
  for (let i=0;i<7;i++){
    const d = new Date(w0);
    d.setDate(w0.getDate()+i);
    const k = toDateKey(d);
    weekKeys.push(k);
    weekValues.push(days[k]?.total || 0);
  }
  const okWeek = drawBars(weekCanvas, weekLabels, weekValues, {showMax:true});
  try{ setCanvasTooltipData(weekCanvas, { labels: weekLabels, values: weekValues, name: 'Поинты', dotColor: (document.documentElement.getAttribute('data-theme')==='light'?'rgba(56,189,248,0.85)':'rgba(56,189,248,0.9)') }); ensureBarsTooltip(weekCanvas, weekTooltip); }catch(e){}

  if (!okWeek) { scheduleRetry(); return; }
  weekLegend.textContent = `${weekKeys[0].split('-').reverse().join('.')} — ${weekKeys[6].split('-').reverse().join('.')}`;

  const y = now.getFullYear();
  const m0 = now.getMonth();
  const dim = daysInMonth(y, m0);

  let monthSum = 0;
  let monthMax = 0;
  let monthMaxKey = null;
  const monthValues = [];

  for (let day=1; day<=dim; day++){
    const d = new Date(y, m0, day);
    const k = toDateKey(d);
    const v = days[k]?.total || 0;
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

  const elapsedDays = now.getDate();
  const avg = elapsedDays ? Math.round(monthSum / elapsedDays) : 0;
  elMonthAvg.textContent = String(avg);
  elMonthAvgHint.textContent = `за ${elapsedDays} дн.`;

  const labels = monthValues.map((_,i)=> (i%5===0 ? String(i+1) : ''));
  const okMonth = drawBars(monthCanvas, labels, monthValues, {showMax:false});
  if (!okMonth) { scheduleRetry(); return; }
  monthLegend.textContent = `Дни 1–${dim}`;

  // Work summary (counts, not points)
  window.__lastStatsData = points;
  const okWork = renderWork(points);
  if (okWork === false) { scheduleRetry(); return; }

  __retryCount = 0;
}

function setTheme(theme){
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

window.sproutgStats.onApplySettings((s) => { if (s?.theme) setTheme(s.theme); });
window.sproutgStats.onPointsUpdated((data) => render(data));

(async () => {
  const s = await window.sproutgStats.getSettings();
  setTheme(s?.theme || 'dark');
  const data = await window.sproutgStats.getPoints();
  render(data);
})();