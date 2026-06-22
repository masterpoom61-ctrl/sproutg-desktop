const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sproutgStats', {
  getSettings: () => ipcRenderer.invoke('sproutg:get-settings'),
  getPoints: () => ipcRenderer.invoke('sproutg:get-points'),
  onApplySettings: (cb) => ipcRenderer.on('sproutg:apply-settings', (_e, s) => cb(s)),
  onPointsUpdated: (cb) => ipcRenderer.on('sproutg:points-updated', (_e, data) => cb(data)),
  onPrepareClose: (cb) => ipcRenderer.on('sproutg:prepare-close', () => cb())
});
