const { ipcRenderer } = require('electron');

const ALLOWED_TYPES = new Set(['THEME_COLORS', 'STATUS_EVENT', 'POINT_EVENT']);

window.addEventListener('message', (event) => {
  // IMPORTANT: do NOT require event.source === window.
  // Google Apps Script web apps can run inside iframes; messages may come from a child frame.
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  // Prefer messages from sproutg-web, but accept any source as long as type is allowlisted
  // (helps compatibility with web versions if source string differs)
  if (!data.type || !ALLOWED_TYPES.has(data.type)) return;

  ipcRenderer.send('sproutg:web-message', data);
});

ipcRenderer.on('sproutg:desktop-settings', (_e, settings) => {
  try {
    const msg = { source:'sproutg-desktop', type:'SETTINGS', payload: settings };
    // Current frame
    window.postMessage(msg, '*');
    // Also broadcast to child frames (Apps Script sometimes runs in an iframe)
    for (let i = 0; i < window.frames.length; i++) {
      try { window.frames[i].postMessage(msg, '*'); } catch(e) {}
    }
  } catch(e) {}
});
