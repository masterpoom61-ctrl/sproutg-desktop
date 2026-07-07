const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sproutgCompany', {
  getSettings: () => ipcRenderer.invoke('sproutg:get-settings'),
  apiCall: (action, payload, opts) => ipcRenderer.invoke('sproutg:api-call', action, payload, opts),
  addPoints: (payload) => ipcRenderer.send('sproutg:web-message', { source:'sproutg-company', type:'POINT_EVENT', payload }),
  closeWindow: () => ipcRenderer.invoke('sproutg:close-company-window'),
  dragWindowStart: (point) => ipcRenderer.invoke('sproutg:aux-window-drag-start', point),
  dragWindowMove: (point) => ipcRenderer.invoke('sproutg:aux-window-drag-move', point),
  dragWindowEnd: () => ipcRenderer.invoke('sproutg:aux-window-drag-end'),
  onApplySettings: (cb) => ipcRenderer.on('sproutg:apply-settings', (_e, s) => cb(s)),
  onPrepareClose: (cb) => ipcRenderer.on('sproutg:prepare-close', () => cb())
});
