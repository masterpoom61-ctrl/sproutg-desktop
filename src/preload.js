const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sproutg', {
  getSettings: () => ipcRenderer.invoke('sproutg:get-settings'),
  setSetting: (partial) => ipcRenderer.invoke('sproutg:set-setting', partial),
  openSettings: () => ipcRenderer.invoke('sproutg:open-settings'),
  openStats: () => ipcRenderer.invoke('sproutg:open-stats'),
  openCompany: () => ipcRenderer.invoke('sproutg:open-company'),
  openBridgeLogin: () => ipcRenderer.invoke('sproutg:open-bridge-login'),
  reloadWeb: () => ipcRenderer.invoke('sproutg:reload-web'),
  windowControl: (action) => ipcRenderer.send('sproutg:window-control', action),
  getUpdateState: () => ipcRenderer.invoke('sproutg:get-update-state'),
  getPoints: () => ipcRenderer.invoke('sproutg:get-points'),
  checkForUpdates: () => ipcRenderer.invoke('sproutg:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('sproutg:download-update'),
  installUpdate: () => ipcRenderer.invoke('sproutg:install-update'),
  apiCall: (action, payload, opts) => ipcRenderer.invoke('sproutg:api-call', action, payload, opts),
  apiBatch: (calls, opts) => ipcRenderer.invoke('sproutg:api-batch', calls, opts),
  legacyCall: (action, payload, opts) => ipcRenderer.invoke('sproutg:legacy-call', action, payload, opts),
  getBridgeState: () => ipcRenderer.invoke('sproutg:bridge-state'),
  postWebMessage: (msg) => ipcRenderer.send('sproutg:web-message', msg),
  onUpdateState: (cb) => ipcRenderer.on('sproutg:update-state', (_e, payload) => cb(payload)),
  onNotice: (cb) => ipcRenderer.on('sproutg:notice', (_e, payload) => cb(payload)),
  onBridgeState: (cb) => ipcRenderer.on('sproutg:bridge-state', (_e, payload) => cb(payload)),
  onThemeColors: (cb) => ipcRenderer.on('sproutg:theme-colors', (_e, payload) => cb(payload)),
  onPointsUpdated: (cb) => ipcRenderer.on('sproutg:points-updated', (_e, payload) => cb(payload)),
  onPointsDelta: (cb) => ipcRenderer.on('sproutg:points-delta', (_e, payload) => cb(payload)),
  onApplySettings: (cb) => ipcRenderer.on('sproutg:apply-settings', (_e, settings) => cb(settings))
});
