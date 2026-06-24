const { BrowserWindow, ipcMain } = require('electron');
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
    this.window = null;
    this.url = null;
    this.ready = false;
    this.destroyed = false;
    this.pending = new Map();
    this.queue = [];
    this.seq = 0;
    this.metrics = {
      total: 0,
      ok: 0,
      failed: 0,
      timeouts: 0,
      pending: 0,
      queued: 0,
      lastAction: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastDurationMs: null,
      avgDurationMs: null,
      maxDurationMs: 0
    };
    this.state = {
      status: 'idle',
      ready: false,
      url: null,
      bridgeVersion: null,
      message: 'Мост к Google Таблице не подключён',
      error: null,
      ts: Date.now()
    };

    ipcMain.on('sproutg:bridge-message', (_event, message) => this.handleMessage(message));
  }

  getState() {
    return {
      ...this.state,
      metrics: {
        ...this.metrics,
        pending: this.pending.size,
        queued: this.queue.length
      }
    };
  }

  setState(patch) {
    this.state = { ...this.state, ...(patch || {}), ready: this.ready, url: this.url, ts: Date.now() };
    this.emit('state', this.getState());
  }

  load(url) {
    if (this.destroyed) return;
    this.url = url || null;
    this.ready = false;
    this.rejectAllPending('Переподключение к Google Таблице', 'BRIDGE_RECONNECT');

    if (!this.url) {
      this.setState({ status: 'missing-url', message: 'Не задан URL Apps Script', error: null, bridgeVersion: null });
      return;
    }

    if (this.window) {
      try { this.window.destroy(); } catch (e) {}
      this.window = null;
    }

    this.window = new BrowserWindow({
      show: false,
      width: 420,
      height: 320,
      skipTaskbar: true,
      title: 'SproutG.Web',
      webPreferences: {
        partition: this.partition,
        preload: path.join(this.appDir, 'bridgePreload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true
      }
    });

    const wc = this.window.webContents;
    wc.on('did-start-loading', () => this.setState({ status: 'connecting', message: 'Подключение к Google Таблице', error: null }));
    wc.on('did-finish-load', () => {
      clearTimeout(this.readyTimer);
      this.readyTimer = setTimeout(() => {
        if (this.ready) return;
        this.setState({
          status: 'login-required',
          message: 'Нужен вход в Google или доступ к таблице',
          error: null
        });
      }, 5000);
    });
    wc.on('did-fail-load', (_event, code, description) => {
      this.ready = false;
      this.setState({ status: 'error', message: 'Не удалось загрузить мост Google Таблицы', error: `${code}: ${description}` });
      this.scheduleReconnect();
    });
    wc.on('render-process-gone', (_event, details) => {
      this.ready = false;
      this.setState({ status: 'disconnected', message: 'Мост Google Таблицы остановлен', error: details?.reason || null });
      this.scheduleReconnect();
    });
    wc.on('destroyed', () => {
      this.ready = false;
      this.setState({ status: 'disconnected', message: 'Мост Google Таблицы закрыт' });
    });
    this.window.on('closed', () => {
      this.window = null;
      this.ready = false;
      this.setState({ status: 'disconnected', message: 'Окно моста закрыто' });
    });

    this.setState({ status: 'connecting', message: 'Подключение к Google Таблице', error: null, bridgeVersion: null });
    wc.loadURL(this.url).catch((err) => {
      this.ready = false;
      this.setState({ status: 'error', message: 'Ошибка загрузки моста Google Таблицы', error: err?.message || String(err) });
      this.scheduleReconnect();
    });
  }

  reload() {
    if (this.destroyed) return;
    if (this.window && !this.window.webContents.isDestroyed()) {
      this.ready = false;
      this.setState({ status: 'reconnecting', message: 'Перезагрузка моста Google Таблицы', error: null });
      this.window.webContents.reloadIgnoringCache();
      return;
    }
    if (this.url) this.load(this.url);
  }

  scheduleReconnect() {
    if (this.destroyed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.destroyed) return;
      if (!this.url) return;
      this.setState({ status: 'reconnecting', message: 'Повторное подключение к Google Таблице', error: null });
      this.load(this.url);
    }, 1500);
  }

  post(message) {
    if (this.destroyed) return false;
    if (!this.window || this.window.webContents.isDestroyed()) return false;
    this.window.webContents.send('sproutg:bridge-post', message);
    return true;
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'BRIDGE_READY') {
      this.ready = true;
      this.setState({
        status: 'ready',
        message: 'Google Таблица подключена',
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
        this.emit('state', this.getState());
        if (this.url && (!this.window || this.window.webContents.isDestroyed())) this.load(this.url);
        return;
      }

      this.sendRequest(item);
    });
  }

  sendRequest(item) {
    if (!this.ready) {
      this.queue.push(item);
      this.emit('state', this.getState());
      return;
    }

    item.attempts += 1;
    item.startedAt = Date.now();
    this.metrics.lastAction = item.action || item.type;
    this.metrics.lastStartedAt = item.startedAt;
    this.metrics.pending = this.pending.size + 1;
    this.metrics.queued = this.queue.length;
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
    this.emit('state', this.getState());

    if (!this.post(message)) {
      clearTimeout(timer);
      this.pending.delete(item.id);
      this.recordMetric({ item, ok: false });
      this.ready = false;
      this.queue.unshift(item);
      this.setState({ status: 'disconnected', message: 'Мост Google Таблицы недоступен', error: null });
      this.scheduleReconnect();
    }
  }

  timeout(id) {
    const item = this.pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(id);
    this.recordMetric({ item, ok: false, timeout: true });

    if (item.attempts <= item.retries) {
      this.setState({ status: 'timeout', message: 'Google Таблица отвечает медленно, повторяем запрос', error: item.action || item.type });
      this.reload();
      this.queue.unshift(item);
      return;
    }

    item.reject(Object.assign(new Error('Google Таблица отвечает слишком долго'), { code: 'BRIDGE_TIMEOUT' }));
  }

  settle(id, result) {
    const item = this.pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(id);
    this.recordMetric({ item, ok: !(result && result.ok === false) });
    item.resolve(result);
  }

  recordMetric({ item, ok, timeout } = {}) {
    const now = Date.now();
    const startedAt = Number(item?.startedAt || now);
    const duration = Math.max(0, now - startedAt);
    this.metrics.total += 1;
    if (ok) this.metrics.ok += 1;
    else this.metrics.failed += 1;
    if (timeout) this.metrics.timeouts += 1;
    this.metrics.lastAction = item?.action || item?.type || this.metrics.lastAction;
    this.metrics.lastFinishedAt = now;
    this.metrics.lastDurationMs = duration;
    this.metrics.maxDurationMs = Math.max(Number(this.metrics.maxDurationMs || 0), duration);
    const prevAvg = Number(this.metrics.avgDurationMs || 0);
    this.metrics.avgDurationMs = this.metrics.total <= 1 ? duration : Math.round((prevAvg * (this.metrics.total - 1) + duration) / this.metrics.total);
    this.metrics.pending = this.pending.size;
    this.metrics.queued = this.queue.length;
    this.emit('state', this.getState());
  }

  rejectAllPending(message, code) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(Object.assign(new Error(message), { code }));
    }
    this.pending.clear();
  }

  destroy() {
    this.destroyed = true;
    this.ready = false;
    clearTimeout(this.readyTimer);
    clearTimeout(this.reconnectTimer);
    this.rejectAllPending('Приложение закрывается', 'APP_QUIT');
    this.queue = [];
    if (this.window && !this.window.isDestroyed()) {
      try { this.window.destroy(); } catch (e) {}
    }
    this.window = null;
  }
}

module.exports = { BridgeManager };
