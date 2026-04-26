const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sproutg', {
  getSettings: () => ipcRenderer.invoke('sproutg:get-settings'),
  setSetting: (partial) => ipcRenderer.invoke('sproutg:set-setting', partial),
  openSettings: () => ipcRenderer.invoke('sproutg:open-settings'),
  openStats: () => ipcRenderer.invoke('sproutg:open-stats'),
  windowControl: (action) => ipcRenderer.send('sproutg:window-control', action),
  getUpdateState: () => ipcRenderer.invoke('sproutg:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('sproutg:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('sproutg:download-update'),
  installUpdate: () => ipcRenderer.invoke('sproutg:install-update'),
  onUpdateState: (cb) => ipcRenderer.on('sproutg:update-state', (_e, payload) => cb(payload)),
  onThemeColors: (cb) => ipcRenderer.on('sproutg:theme-colors', (_e, payload) => cb(payload)),
  onApplySettings: (cb) => ipcRenderer.on('sproutg:apply-settings', (_e, settings) => cb(settings))
});
