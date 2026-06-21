const { BrowserView, ipcMain } = require('electron');
const EventEmitter = require('events');
const path = require('path');
const { isReadAction } = require('../shared/actions');

const DEFAULT_TIMEOUT_MS = 30000;
const READ_RETRIES = 1;

class BridgeManager extends EventEmitter {
  constructor({ getSession, partition, appDir }) {
    super();
    this.getSession = getSession;
    this.partition = partition;
    this.appDir = appDir;
    this.view = null;
    this.url = null;
    this.ready = false;
    this.pending = new Map();
    this.queue = [];
    this.seq = 0;
    this.state = {
      status: 'idle',
      ready: false,
      url: null,
      bridgeVersion: null,
      message: 'Bridge is not connected',
      error: null,
      ts: Date.now()
    };

    ipcMain.on('sproutg:bridge-message', (_event, message) => this.handleMessage(message));
  }

  getState() {
    return { ...this.state };
  }

  setState(patch) {
    this.state = { ...this.state, ...(patch || {}), ready: this.ready, url: this.url, ts: Date.now() };
    this.emit('state', this.getState());
  }

  load(url) {
    this.url = url || null;
    this.ready = false;
    this.rejectAllPending('Bridge reconnecting', 'BRIDGE_RECONNECT');

    if (!this.url) {
      this.setState({ status: 'missing-url', message: 'Bridge URL is not configured', error: null, bridgeVersion: null });
      return;
    }

    if (this.view) {
      try { this.view.webContents.destroy(); } catch (e) {}
      this.view = null;
    }

    this.view = new BrowserView({
      webPreferences: {
        partition: this.partition,
        preload: path.join(this.appDir, 'bridgePreload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });

    const wc = this.view.webContents;
    wc.on('did-start-loading', () => this.setState({ status: 'connecting', message: 'Connecting to Apps Script bridge', error: null }));
    wc.on('did-finish-load', () => {
      clearTimeout(this.readyTimer);
      this.readyTimer = setTimeout(() => {
        if (this.ready) return;
        this.setState({
          status: 'login-required',
          message: 'Bridge loaded but is not ready. Click the Bridge badge to sign in or grant access.',
          error: null
        });
      }, 5000);
    });
    wc.on('did-fail-load', (_event, code, description) => {
      this.ready = false;
      this.setState({ status: 'error', message: 'Bridge failed to load', error: `${code}: ${description}` });
      this.scheduleReconnect();
    });
    wc.on('render-process-gone', (_event, details) => {
      this.ready = false;
      this.setState({ status: 'disconnected', message: 'Bridge renderer stopped', error: details?.reason || null });
      this.scheduleReconnect();
    });
    wc.on('destroyed', () => {
      this.ready = false;
      this.setState({ status: 'disconnected', message: 'Bridge webContents destroyed' });
    });

    this.setState({ status: 'connecting', message: 'Connecting to Apps Script bridge', error: null, bridgeVersion: null });
    wc.loadURL(this.url).catch((err) => {
      this.ready = false;
      this.setState({ status: 'error', message: 'Bridge load error', error: err?.message || String(err) });
      this.scheduleReconnect();
    });
  }

  reload() {
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.ready = false;
      this.setState({ status: 'reconnecting', message: 'Reloading bridge', error: null });
      this.view.webContents.reloadIgnoringCache();
      return;
    }
    if (this.url) this.load(this.url);
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.url) return;
      this.setState({ status: 'reconnecting', message: 'Reconnecting bridge', error: null });
      this.load(this.url);
    }, 1500);
  }

  post(message) {
    if (!this.view || this.view.webContents.isDestroyed()) return false;
    this.view.webContents.send('sproutg:bridge-post', message);
    return true;
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'BRIDGE_READY') {
      this.ready = true;
      this.setState({
        status: 'ready',
        message: 'Bridge ready',
        error: null,
        bridgeVersion: message.bridgeVersion || null
      });
      this.flushQueue();
      return;
    }

    if (message.type === 'PONG') {
      this.settle(message.id, { ok: true, data: { pong: true, bridgeVersion: message.bridgeVersion, ts: message.ts } });
      return;
    }

    if (message.type === 'API_RESULT') {
      this.settle(message.id, message.result);
    }
  }

  flushQueue() {
    const queued = this.queue.splice(0);
    for (const item of queued) this.sendRequest(item);
  }

  nextId() {
    this.seq += 1;
    return `desktop-${Date.now()}-${this.seq}`;
  }

  callApi(action, payload = {}, opts = {}) {
    return this.request({
      type: 'API_CALL',
      action,
      payload,
      timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
      retries: opts.retries ?? (isReadAction(action) ? READ_RETRIES : 0)
    });
  }

  batchApi(calls = [], opts = {}) {
    const readOnly = (Array.isArray(calls) ? calls : []).every((c) => isReadAction(c && c.action));
    return this.request({
      type: 'API_BATCH',
      calls,
      timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
      retries: opts.retries ?? (readOnly ? READ_RETRIES : 0)
    });
  }

  ping() {
    return this.request({ type: 'PING', timeoutMs: 10000, retries: 0 });
  }

  request(req) {
    return new Promise((resolve, reject) => {
      const item = {
        ...req,
        id: this.nextId(),
        resolve,
        reject,
        attempts: 0
      };

      if (!this.ready) {
        this.queue.push(item);
        if (this.url && (!this.view || this.view.webContents.isDestroyed())) this.load(this.url);
        return;
      }

      this.sendRequest(item);
    });
  }

  sendRequest(item) {
    if (!this.ready) {
      this.queue.push(item);
      return;
    }

    item.attempts += 1;
    const message = {
      source: 'sproutg-desktop',
      type: item.type,
      id: item.id
    };
    if (item.type === 'API_CALL') {
      message.action = item.action;
      message.payload = item.payload || {};
    } else if (item.type === 'API_BATCH') {
      message.calls = Array.isArray(item.calls) ? item.calls : [];
    }

    const timer = setTimeout(() => this.timeout(item.id), item.timeoutMs || DEFAULT_TIMEOUT_MS);
    this.pending.set(item.id, { ...item, timer });

    if (!this.post(message)) {
      clearTimeout(timer);
      this.pending.delete(item.id);
      this.ready = false;
      this.queue.unshift(item);
      this.setState({ status: 'disconnected', message: 'Bridge is not available', error: null });
      this.scheduleReconnect();
    }
  }

  timeout(id) {
    const item = this.pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(id);

    if (item.attempts <= item.retries) {
      this.setState({ status: 'timeout', message: 'Bridge request timed out, retrying', error: item.action || item.type });
      this.reload();
      this.queue.unshift(item);
      return;
    }

    item.reject(Object.assign(new Error('Apps Script bridge timeout'), { code: 'BRIDGE_TIMEOUT' }));
  }

  settle(id, result) {
    const item = this.pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(id);
    item.resolve(result);
  }

  rejectAllPending(message, code) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(Object.assign(new Error(message), { code }));
    }
    this.pending.clear();
  }
}

module.exports = { BridgeManager };
