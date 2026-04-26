const $ = (id) => document.getElementById(id);

let __btnLock = { stats:false, settings:false };
function lockBtn(key, ms=220){
  if (__btnLock[key]) return false;
  __btnLock[key] = true;
  setTimeout(() => { __btnLock[key] = false; }, ms);
  return true;
}

$('btnStats').addEventListener('click', () => { if (!lockBtn('stats')) return; window.sproutg.openStats(); });
$('btnSettings').addEventListener('click', () => { if (!lockBtn('settings')) return; window.sproutg.openSettings(); });
$('btnMin').addEventListener('click', () => window.sproutg.windowControl('minimize'));
$('btnMax').addEventListener('click', () => window.sproutg.windowControl('maximize-toggle'));
$('btnClose').addEventListener('click', () => window.sproutg.windowControl('close'));

function setTheme(theme){
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

window.sproutg.onThemeColors((p) => {
  if (!p) return;
  if (p.topbarColor) document.documentElement.style.setProperty('--topbar-bg', p.topbarColor);
  if (p.topbarTextColor) document.documentElement.style.setProperty('--topbar-fg', p.topbarTextColor);
});

window.sproutg.onApplySettings((s) => { if (s && s.theme) setTheme(s.theme); });

(async () => {
  const s = await window.sproutg.getSettings();
  setTheme(s.theme || 'dark');
})();