const $ = (id) => document.getElementById(id);

const elToday = $('todayValue');
const elTodayHint = $('todayHint');
const elMonthTotal = $('monthTotal');
const elMonthHint = $('monthHint');
const elMonthRecord = $('monthRecord');
const elMonthRecordHint = $('monthRecordHint');
const elMonthAvg = $('monthAvg');
const elMonthAvgHint = $('monthAvgHint');
const elTodayBreakdown = $('todayBreakdown');
const elMonthBreakdown = $('monthBreakdown');
const elDayRecordBreakdown = $('dayRecordBreakdown');
const elAvgBreakdown = $('avgBreakdown');
const elWeekRecord = $('weekRecord');
const elWeekRecordHint = $('weekRecordHint');
const elWeekRecordBreakdown = $('weekRecordBreakdown');
const elBestMonthRecord = $('bestMonthRecord');
const elBestMonthRecordHint = $('bestMonthRecordHint');
const elBestMonthBreakdown = $('bestMonthBreakdown');
const cardDayRecord = $('cardDayRecord');
const cardWeekRecord = $('cardWeekRecord');
const cardBestMonth = $('cardBestMonth');
const dayRecordBadge = $('dayRecordBadge');
const weekRecordBadge = $('weekRecordBadge');
const bestMonthBadge = $('bestMonthBadge');
const dayRecordLeague = $('dayRecordLeague');
const weekRecordLeague = $('weekRecordLeague');
const bestMonthLeague = $('bestMonthLeague');
const monthProgress = $('monthProgress');

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
const leaguePrevBtn = $('leaguePrevBtn');
const leagueNextBtn = $('leagueNextBtn');
const leagueMonthTitle = $('leagueMonthTitle');
const leagueMonthBoard = $('leagueMonthBoard');

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
  'Черновики MCC': 'Черновики',
  'Профиль Okto': 'Okto',
  'Номер': 'Номера',
  'Компания': 'Компания',
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
  'Черновики MCC',
  'Профиль Okto',
  'Номер',
  'Компания',
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

const LEAGUE_LEVELS = [
  { key:'none', name:'Без лиги', short:'Нет', colorVar:'--muted2' },
  { key:'bronze', name:'Бронза', short:'BRZ', colorVar:'--chartC' },
  { key:'silver', name:'Серебро', short:'SLV', colorVar:'--chartA' },
  { key:'gold', name:'Золото', short:'GLD', colorVar:'--chartB' },
  { key:'diamond', name:'Алмаз', short:'DIA', colorVar:'--chartD' },
  { key:'legendary', name:'Легендарно', short:'LEG', colorVar:'--chartC' }
];
const LEAGUE_BY_KEY = LEAGUE_LEVELS.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});
const DAY_LEAGUE_THRESHOLDS = { bronze:2500, silver:5000, gold:7500, diamond:10000, legendary:12500 };
const WEEK_LEAGUE_THRESHOLDS = { bronze:10000, silver:15000, gold:25000, diamond:35000, legendary:50000 };
const MONTH_LEAGUE_THRESHOLDS = { bronze:25000, silver:50000, gold:75000, diamond:100000, legendary:125000 };
const COUNTED_LEAGUES = ['bronze','silver','gold','diamond','legendary'];

function leagueForValue(value, thresholds){
  const n = Number(value || 0);
  if (n >= thresholds.legendary) return LEAGUE_BY_KEY.legendary;
  if (n >= thresholds.diamond) return LEAGUE_BY_KEY.diamond;
  if (n >= thresholds.gold) return LEAGUE_BY_KEY.gold;
  if (n >= thresholds.silver) return LEAGUE_BY_KEY.silver;
  if (n >= thresholds.bronze) return LEAGUE_BY_KEY.bronze;
  return LEAGUE_BY_KEY.none;
}

function emptyLeagueCounter(){
  return COUNTED_LEAGUES.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function countLeague(counter, league){
  const key = league?.key;
  if (key && key !== 'none' && Object.prototype.hasOwnProperty.call(counter, key)) counter[key] += 1;
}

function escHtml(s){
  return String(s ?? '').replace(/[&<>"]/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}

function leagueRank(key){
  return { none:0, bronze:1, silver:2, gold:3, diamond:4, legendary:5 }[key] || 0;
}

function highestLeagueFromCounter(counter){
  let best = LEAGUE_BY_KEY.none;
  for (const key of COUNTED_LEAGUES){
    if (Number(counter?.[key] || 0) > 0 && leagueRank(key) > leagueRank(best.key)) {
      best = LEAGUE_BY_KEY[key] || best;
    }
  }
  return best;
}

function countLeagueValues(values, thresholds){
  const counter = emptyLeagueCounter();
  for (const value of values || []) countLeague(counter, leagueForValue(value, thresholds));
  return counter;
}

function weekOverlapsMonth(record, monthKey){
  return (record?.keys || []).some((key)=>String(key || '').slice(0, 7) === monthKey);
}

function selectedMonthRecord(monthRecords, monthKey){
  return (monthRecords || []).find((record)=>record.monthKey === monthKey) || {
    monthKey,
    total: 0,
    byType: {}
  };
}

function achievementState(currentValue, bestValue){
  const current = Number(currentValue || 0);
  const best = Number(bestValue || 0);
  if (!current || !best) return { type:'empty', label:'нет данных' };
  if (current >= best) return { type:'record', label:'рекорд' };
  if (current >= best * 0.9) return { type:'near', label:'близко к рекорду' };
  return { type:'normal', label:'обычный результат' };
}

function buildLeagueMonthRows(days, weekRecords, monthRecords, monthKey){
  const monthDayKeys = keysForMonth(monthKey);
  const dayValues = monthDayKeys.map((key)=>Number(days?.[key]?.total || 0));
  const selectedWeeks = (weekRecords || []).filter((record)=>weekOverlapsMonth(record, monthKey));
  const monthRecord = selectedMonthRecord(monthRecords, monthKey);
  const bestWeekAll = bestByTotal(weekRecords);
  const bestWeekSelected = bestByTotal(selectedWeeks);
  const bestMonthAll = bestByTotal(monthRecords);
  const monthLeague = leagueForValue(monthRecord.total, MONTH_LEAGUE_THRESHOLDS);

  const monthCounter = emptyLeagueCounter();
  countLeague(monthCounter, monthLeague);

  const weekAchievement = achievementState(bestWeekSelected?.total || 0, bestWeekAll?.total || 0);
  const monthAchievement = achievementState(monthRecord.total, bestMonthAll?.total || 0);
  const weekAchievementCounter = emptyLeagueCounter();
  const monthAchievementCounter = emptyLeagueCounter();
  if (weekAchievement.type === 'record') countLeague(weekAchievementCounter, leagueForValue(bestWeekSelected?.total || 0, WEEK_LEAGUE_THRESHOLDS));
  if (monthAchievement.type === 'record') countLeague(monthAchievementCounter, monthLeague);

  return [
    {
      key:'day',
      title:'Дневные лиги',
      subtitle:'по каждому дню выбранного месяца',
      value: dayValues.reduce((sum, value)=>sum + value, 0),
      counters: countLeagueValues(dayValues, DAY_LEAGUE_THRESHOLDS),
      topLeague: highestLeagueFromCounter(countLeagueValues(dayValues, DAY_LEAGUE_THRESHOLDS)),
      note: `${dayValues.filter(Boolean).length} активн. дней`
    },
    {
      key:'week',
      title:'Недельные лиги',
      subtitle:'по продуктивным неделям месяца',
      value: selectedWeeks.reduce((sum, record)=>sum + Number(record.total || 0), 0),
      counters: countLeagueValues(selectedWeeks.map((record)=>record.total), WEEK_LEAGUE_THRESHOLDS),
      topLeague: highestLeagueFromCounter(countLeagueValues(selectedWeeks.map((record)=>record.total), WEEK_LEAGUE_THRESHOLDS)),
      note: `${selectedWeeks.length} нед.`
    },
    {
      key:'month',
      title:'Месячная лига',
      subtitle:'по сумме выбранного месяца',
      value: Number(monthRecord.total || 0),
      counters: monthCounter,
      topLeague: monthLeague,
      note: monthLabel(monthKey)
    },
    {
      key:'week-achievement',
      title:'Достижение недели',
      subtitle:'лучшая неделя против общего рекорда',
      value: Number(bestWeekSelected?.total || 0),
      counters: weekAchievementCounter,
      topLeague: weekAchievement.type === 'record'
        ? leagueForValue(bestWeekSelected?.total || 0, WEEK_LEAGUE_THRESHOLDS)
        : (weekAchievement.type === 'near' ? LEAGUE_BY_KEY.silver : LEAGUE_BY_KEY.none),
      note: weekAchievement.label
    },
    {
      key:'month-achievement',
      title:'Достижение месяца',
      subtitle:'выбранный месяц против лучшего месяца',
      value: Number(monthRecord.total || 0),
      counters: monthAchievementCounter,
      topLeague: monthAchievement.type === 'record' ? monthLeague : (monthAchievement.type === 'near' ? LEAGUE_BY_KEY.silver : LEAGUE_BY_KEY.none),
      note: monthAchievement.label
    }
  ];
}

function renderLeagueCounters(counter){
  return COUNTED_LEAGUES.map((key)=>{
    const league = LEAGUE_BY_KEY[key];
    const count = Number(counter?.[key] || 0);
    return `
      <span class="leagueCount league--${key}" title="${escHtml(league.name)}">
        <span class="leagueMaskIcon" aria-hidden="true"></span>
        <span>${count}</span>
      </span>`;
  }).join('');
}

function renderLeagueMonthBoard(days, weekRecords, monthRecords, monthKey){
  if (!leagueMonthBoard) return;
  const selected = String(monthKey || monthKeyFromDate(new Date()));
  if (leagueMonthTitle) leagueMonthTitle.textContent = `Лиги месяца · ${monthLabel(selected)}`;
  if (leagueNextBtn) leagueNextBtn.disabled = selected >= monthKeyFromDate(new Date());

  const rows = buildLeagueMonthRows(days, weekRecords, monthRecords, selected);
  leagueMonthBoard.innerHTML = rows.map((row)=>{
    const league = row.topLeague || LEAGUE_BY_KEY.none;
    const totalBadges = Object.values(row.counters || {}).reduce((sum, value)=>sum + Number(value || 0), 0);
    return `
      <div class="leagueMonthRow league--${league.key}" data-league="${league.key}">
        <div class="leagueMonthRow__badge leagueBadge league--${league.key}" title="${escHtml(league.name)}">
          <span class="leagueMaskIcon" aria-hidden="true"></span>
        </div>
        <div class="leagueMonthRow__main">
          <div class="leagueMonthRow__title">${escHtml(row.title)}</div>
          <div class="leagueMonthRow__sub">${escHtml(row.subtitle)}</div>
          <div class="leagueMonthRow__note">${escHtml(row.note)} · ${escHtml(league.name)} · ${totalBadges} лиг</div>
        </div>
        <div class="leagueMonthRow__value">${Number(row.value || 0)}</div>
        <div class="leagueMonthRow__counts">${renderLeagueCounters(row.counters)}</div>
      </div>`;
  }).join('');
}

function mergeTypeCounts(keys, workDays){
  const out = {};
  for (const key of keys || []){
    const byType = workDays?.[key]?.byType || {};
    for (const [type, value] of Object.entries(byType)){
      const n = Number(value || 0);
      if (!n) continue;
      out[type] = Number(out[type] || 0) + n;
    }
  }
  return out;
}

function sumDays(keys, days){
  return (keys || []).reduce((sum, key) => sum + Number(days?.[key]?.total || 0), 0);
}

function formatDayKey(key){
  return key ? String(key).split('-').reverse().join('.') : '—';
}

function monthKeysFromDays(days){
  const keys = new Set();
  for (const dayKey of Object.keys(days || {})){
    const monthKey = String(dayKey || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(monthKey)) keys.add(monthKey);
  }
  return Array.from(keys).sort();
}

function keysForMonth(monthKey){
  const [y, m] = String(monthKey || '').split('-').map(Number);
  if (!y || !m) return [];
  const dim = daysInMonth(y, m - 1);
  const keys = [];
  for (let day = 1; day <= dim; day++) keys.push(toDateKey(new Date(y, m - 1, day)));
  return keys;
}

function buildWeekRecords(days, workDays){
  const weekMap = new Map();
  for (const key of Object.keys(days || {})){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const start = startOfWeekMonday(dateFromKey(key));
    const startKey = toDateKey(start);
    if (!weekMap.has(startKey)){
      const keys = [];
      for (let i = 0; i < 7; i++) keys.push(toDateKey(addDays(start, i)));
      weekMap.set(startKey, {
        startKey,
        endKey: keys[6],
        keys,
        total: 0,
        byType: {}
      });
    }
  }
  for (const record of weekMap.values()){
    record.total = sumDays(record.keys, days);
    record.byType = mergeTypeCounts(record.keys, workDays);
  }
  return Array.from(weekMap.values()).sort((a, b) => a.startKey.localeCompare(b.startKey));
}

function buildMonthRecords(days, workDays){
  return monthKeysFromDays(days).map((monthKey) => {
    const keys = keysForMonth(monthKey);
    return {
      monthKey,
      keys,
      total: sumDays(keys, days),
      byType: mergeTypeCounts(keys, workDays)
    };
  });
}

function bestByTotal(items){
  let best = null;
  for (const item of items || []){
    if (!best || Number(item.total || 0) > Number(best.total || 0)) best = item;
  }
  return best;
}

function buildLeagueCounters(days, weekRecords, monthRecords, selectedMonthKey){
  const day = emptyLeagueCounter();
  const week = emptyLeagueCounter();
  const month = emptyLeagueCounter();
  const selected = String(selectedMonthKey || monthKeyFromDate(new Date()));
  for (const key of keysForMonth(selected)){
    countLeague(day, leagueForValue(days?.[key]?.total || 0, DAY_LEAGUE_THRESHOLDS));
  }
  for (const record of weekRecords || []){
    if (String(record.startKey || '').slice(0, 7) === selected) {
      countLeague(week, leagueForValue(record.total, WEEK_LEAGUE_THRESHOLDS));
    }
  }
  for (const record of monthRecords || []){
    countLeague(month, leagueForValue(record.total, MONTH_LEAGUE_THRESHOLDS));
  }
  return { day, week, month };
}

function renderTypeChips(container, byType, limit = 4){
  if (!container) return;
  const colors = getWorkColors();
  const rows = Object.entries(byType || {})
    .map(([type, value]) => [type, Number(value || 0)])
    .filter(([, value]) => value !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  container.innerHTML = '';
  if (!rows.length){
    const empty = document.createElement('span');
    empty.className = 'statChip statChip--empty';
    empty.textContent = 'нет данных';
    container.appendChild(empty);
    return;
  }
  const visible = rows.slice(0, limit);
  for (const [type, value] of visible){
    const chip = document.createElement('span');
    chip.className = 'statChip';
    chip.style.setProperty('--chip-accent', colors[type]?.[0] || 'var(--stat-accent)');
    chip.textContent = `${labelForType(type)} ${value}`;
    chip.title = type;
    container.appendChild(chip);
  }
  if (rows.length > visible.length){
    const more = document.createElement('span');
    more.className = 'statChip statChip--more';
    more.textContent = `+${rows.length - visible.length}`;
    container.appendChild(more);
  }
}

function applyLeagueCard(card, badge, leagueText, league, value, thresholds){
  if (!card) return;
  const next = league || leagueForValue(value, thresholds);
  card.dataset.league = next.key;
  card.style.setProperty('--stat-accent', `var(${next.colorVar})`);
  if (badge) {
    badge.className = `statCard__badge leagueBadge league--${next.key}`;
    badge.title = next.name;
    badge.innerHTML = '<span class="leagueMaskIcon" aria-hidden="true"></span>';
  }
  if (leagueText) leagueText.textContent = `${next.name} · ${next.short}`;
}

function nextLeagueProgress(value, thresholds){
  const n = Number(value || 0);
  const ordered = [
    thresholds.bronze,
    thresholds.silver,
    thresholds.gold,
    thresholds.diamond,
    thresholds.legendary
  ].filter(Number.isFinite);
  const next = ordered.find((threshold) => n < threshold) || ordered[ordered.length - 1] || 1;
  return Math.max(0, Math.min(100, Math.round((n / next) * 100)));
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
  }, { passive:false, capture:true });
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
  if(leaguePrevBtn && leaguePrevBtn.dataset.bound !== '1'){
    leaguePrevBtn.dataset.bound = '1';
    leaguePrevBtn.addEventListener('click', () => {
      selectedMonthKey = addMonthsToKey(selectedMonthKey || monthKeyFromDate(new Date()), -1);
      persistStatsSelection();
      if(monthSelect) monthSelect.value = selectedMonthKey;
      animatePeriod('month', -1);
      if(window.__lastStatsData) render(window.__lastStatsData);
    });
  }
  if(leagueNextBtn && leagueNextBtn.dataset.bound !== '1'){
    leagueNextBtn.dataset.bound = '1';
    leagueNextBtn.addEventListener('click', () => {
      const nowKey = monthKeyFromDate(new Date());
      const next = addMonthsToKey(selectedMonthKey || nowKey, 1);
      if(next > nowKey) return;
      selectedMonthKey = next;
      persistStatsSelection();
      if(monthSelect) monthSelect.value = next;
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
  const workDays = points?.workDays || {};
  bindPeriodNavigation();
  ensureMonthSelect(days);
  updatePeriodControls();
  const now = new Date();
  const todayKey = toDateKey(now);
  const today = days[todayKey]?.total || 0;

  elToday.textContent = String(today);
  elTodayHint.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())} · 00:00–23:59`;
  renderTypeChips(elTodayBreakdown, workDays?.[todayKey]?.byType || {}, 4);

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

  const monthTypeCounts = mergeTypeCounts(monthKeys, workDays);

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

  const weekRecords = buildWeekRecords(days, workDays);
  const monthRecords = buildMonthRecords(days, workDays);
  const bestWeek = bestByTotal(weekRecords);
  const bestMonth = bestByTotal(monthRecords);
  const leagueCounters = buildLeagueCounters(days, weekRecords, monthRecords, selected);
  window.__statsLeagueCounters = {
    dayLeague: leagueCounters.day,
    weekLeague: leagueCounters.week,
    monthLeague: leagueCounters.month,
    thresholds: {
      dayLeague: DAY_LEAGUE_THRESHOLDS,
      weekLeague: WEEK_LEAGUE_THRESHOLDS,
      monthLeague: MONTH_LEAGUE_THRESHOLDS
    }
  };
  renderLeagueMonthBoard(days, weekRecords, monthRecords, selected);

  elMonthTotal.textContent = String(monthSum);
  elMonthHint.textContent = monthLabel(selected);
  renderTypeChips(elMonthBreakdown, monthTypeCounts, 4);
  if (monthProgress?.firstElementChild) {
    monthProgress.firstElementChild.style.width = `${nextLeagueProgress(monthSum, MONTH_LEAGUE_THRESHOLDS)}%`;
  }
  elMonthRecord.textContent = String(recordMax);
  elMonthRecordHint.textContent = recordKey ? formatDayKey(recordKey) : '—';
  renderTypeChips(elDayRecordBreakdown, recordKey ? workDays?.[recordKey]?.byType || {} : {}, 4);
  applyLeagueCard(cardDayRecord, dayRecordBadge, dayRecordLeague, leagueForValue(recordMax, DAY_LEAGUE_THRESHOLDS), recordMax, DAY_LEAGUE_THRESHOLDS);

  const activeDays = monthKeys.filter((key) => Number(days?.[key]?.total || 0) > 0).length;
  const avg = activeDays ? Math.round(monthSum / activeDays) : 0;
  const avgTypeCounts = {};
  if (activeDays) {
    for (const [type, value] of Object.entries(monthTypeCounts)) {
      const avgValue = Math.round(Number(value || 0) / activeDays);
      if (avgValue) avgTypeCounts[type] = avgValue;
    }
  }
  elMonthAvg.textContent = String(avg);
  elMonthAvgHint.textContent = `за ${activeDays} активн. дн.`;
  renderTypeChips(elAvgBreakdown, avgTypeCounts, 4);

  if (bestWeek) {
    elWeekRecord.textContent = String(bestWeek.total || 0);
    elWeekRecordHint.textContent = `${formatDayKey(bestWeek.startKey)} — ${formatDayKey(bestWeek.endKey)}`;
    renderTypeChips(elWeekRecordBreakdown, bestWeek.byType || {}, 4);
    applyLeagueCard(cardWeekRecord, weekRecordBadge, weekRecordLeague, leagueForValue(bestWeek.total, WEEK_LEAGUE_THRESHOLDS), bestWeek.total, WEEK_LEAGUE_THRESHOLDS);
  } else {
    elWeekRecord.textContent = '0';
    elWeekRecordHint.textContent = '—';
    renderTypeChips(elWeekRecordBreakdown, {}, 4);
    applyLeagueCard(cardWeekRecord, weekRecordBadge, weekRecordLeague, LEAGUE_BY_KEY.none, 0, WEEK_LEAGUE_THRESHOLDS);
  }

  if (bestMonth) {
    elBestMonthRecord.textContent = String(bestMonth.total || 0);
    elBestMonthRecordHint.textContent = monthLabel(bestMonth.monthKey);
    renderTypeChips(elBestMonthBreakdown, bestMonth.byType || {}, 4);
    applyLeagueCard(cardBestMonth, bestMonthBadge, bestMonthLeague, leagueForValue(bestMonth.total, MONTH_LEAGUE_THRESHOLDS), bestMonth.total, MONTH_LEAGUE_THRESHOLDS);
  } else {
    elBestMonthRecord.textContent = '0';
    elBestMonthRecordHint.textContent = '—';
    renderTypeChips(elBestMonthBreakdown, {}, 4);
    applyLeagueCard(cardBestMonth, bestMonthBadge, bestMonthLeague, LEAGUE_BY_KEY.none, 0, MONTH_LEAGUE_THRESHOLDS);
  }

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
