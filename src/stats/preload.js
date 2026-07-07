const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sproutgStats', {
  getSettings: () => ipcRenderer.invoke('sproutg:get-settings'),
  getPoints: () => ipcRenderer.invoke('sproutg:get-points'),
  closeWindow: () => ipcRenderer.invoke('sproutg:close-stats-window'),
  dragWindowStart: (point) => ipcRenderer.invoke('sproutg:aux-window-drag-start', point),
  dragWindowMove: (point) => ipcRenderer.invoke('sproutg:aux-window-drag-move', point),
  dragWindowEnd: () => ipcRenderer.invoke('sproutg:aux-window-drag-end'),
  onApplySettings: (cb) => ipcRenderer.on('sproutg:apply-settings', (_e, s) => cb(s)),
  onPointsUpdated: (cb) => ipcRenderer.on('sproutg:points-updated', (_e, data) => cb(data)),
  onPrepareClose: (cb) => ipcRenderer.on('sproutg:prepare-close', () => cb())
});
