const { ipcRenderer } = require('electron');

const BRIDGE_TYPES = new Set(['BRIDGE_READY', 'PONG', 'API_RESULT']);

window.addEventListener('message', (event) => {
  const data = event && event.data;
  if (!data || typeof data !== 'object') return;
  if (data.source !== 'sproutg-bridge') return;
  if (!BRIDGE_TYPES.has(data.type)) return;
  ipcRenderer.send('sproutg:bridge-message', data);
});

function postToFrames(win, message, seen) {
  if (!win || seen.has(win)) return;
  seen.add(win);
  try { win.postMessage(message, '*'); } catch (e) {}
  try {
    for (let i = 0; i < win.frames.length; i++) {
      try { postToFrames(win.frames[i], message, seen); } catch (e) {}
    }
  } catch (e) {}
}

ipcRenderer.on('sproutg:bridge-post', (_event, message) => {
  try {
    postToFrames(window, message, new Set());
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage(message, '*'); } catch (e) {}
    }
    if (window.top && window.top !== window) {
      try { window.top.postMessage(message, '*'); } catch (e) {}
    }
  } catch (e) {}
});
