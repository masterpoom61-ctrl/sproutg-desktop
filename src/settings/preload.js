const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sproutgSettings', {
  getSettings: () => ipcRenderer.invoke('sproutg:get-settings'),
  setSetting: (partial) => ipcRenderer.invoke('sproutg:set-setting', partial),
  zoomIn: () => ipcRenderer.invoke('sproutg:zoom', 'in'),
  zoomOut: () => ipcRenderer.invoke('sproutg:zoom', 'out'),
  toggleAOT: () => ipcRenderer.invoke('sproutg:toggle-aot'),
  clearCache: () => ipcRenderer.invoke('sproutg:clear-cache'),
  logout: () => ipcRenderer.invoke('sproutg:logout'),
  reloadWeb: () => ipcRenderer.invoke('sproutg:reload-web'),
  openUrl: () => ipcRenderer.invoke('sproutg:open-url', false),
  setWebUrl: (val) => ipcRenderer.invoke('sproutg:set-web-url', val),
  getVersion: () => ipcRenderer.invoke('sproutg:get-version'),
  getUpdateState: () => ipcRenderer.invoke('sproutg:get-update-state'),
  getStorageInfo: () => ipcRenderer.invoke('sproutg:get-storage-info'),
  checkForUpdates: () => ipcRenderer.invoke('sproutg:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('sproutg:download-update'),
  installUpdate: () => ipcRenderer.invoke('sproutg:install-update'),
  apiCall: (action, payload, opts) => ipcRenderer.invoke('sproutg:api-call', action, payload, opts),
  closeWindow: () => ipcRenderer.invoke('sproutg:close-settings-window'),
  onApplySettings: (cb) => ipcRenderer.on('sproutg:apply-settings', (_e, s) => cb(s)),
  onUpdateState: (cb) => ipcRenderer.on('sproutg:update-state', (_e, s) => cb(s)),
  onPrepareClose: (cb) => ipcRenderer.on('sproutg:prepare-close', () => cb())
});
