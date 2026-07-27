const { ipcRenderer } = require('electron');

const BRIDGE_TYPES = new Set(['BRIDGE_READY', 'PONG', 'API_RESULT']);

function isAllowedOrigin(origin) {
  try {
    const candidate = (!origin || origin === 'null') ? window.location.href : origin;
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'script.google.com'
      || host === 'script.googleusercontent.com'
      || host.endsWith('.googleusercontent.com')
    );
  } catch (_error) {
    return false;
  }
}

window.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data || typeof data !== 'object') return;
  if (event.source !== window || !isAllowedOrigin(event.origin)) return;
  if (data.source !== 'sproutg-bridge') return;
  if (!BRIDGE_TYPES.has(data.type)) return;
  ipcRenderer.send('sproutg:bridge-message', data);
});

ipcRenderer.on('sproutg:bridge-post', (_event, message) => {
  try {
    window.postMessage(message, window.location.origin);
  } catch (_error) {}
});
