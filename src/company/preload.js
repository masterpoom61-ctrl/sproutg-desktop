const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sproutgCompany', {
  getSettings: () => ipcRenderer.invoke('sproutg:get-settings'),
  apiCall: (action, payload, opts) => ipcRenderer.invoke('sproutg:api-call', action, payload, opts),
  closeWindow: () => ipcRenderer.invoke('sproutg:close-company-window'),
  onApplySettings: (cb) => ipcRenderer.on('sproutg:apply-settings', (_e, s) => cb(s)),
  onPrepareClose: (cb) => ipcRenderer.on('sproutg:prepare-close', () => cb())
});
