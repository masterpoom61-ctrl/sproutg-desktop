const { ipcRenderer } = require('electron');

const BRIDGE_TYPES = new Set(['BRIDGE_READY', 'PONG', 'API_RESULT']);

window.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data || typeof data !== 'object') return;
  if (data.source !== 'sproutg-bridge') return;
  if (!BRIDGE_TYPES.has(data.type)) return;
  ipcRenderer.send('sproutg:bridge-message', data);
});

ipcRenderer.on('sproutg:bridge-post', (_event, message) => {
  try {
    window.postMessage(message, '*');
  } catch (e) {}
});
