const { BrowserWindow, ipcMain } = require('electron');
const EventEmitter = require('events');
const crypto = require('crypto');
const path = require('path');
const { isReadAction } = require('../shared/actions');

const DEFAULT_TIMEOUT_MS = 30000;
const READ_RETRIES = 1;
const MAX_INFLIGHT = 6;
const FRAME_RELAY_NAME = '__sproutgNativeBridge230';
const FRAME_RELAY_MARKER = '__sproutgNativeBridge230Installed';

function serializeForFrame(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildFramePostScript(message) {
  return `(() => {
    const bridge = window[${JSON.stringify(FRAME_RELAY_NAME)}];
    if (!bridge || typeof bridge.relay !== 'function') return false;
    const marker = ${JSON.stringify(FRAME_RELAY_MARKER)};
    if (!window[marker]) {
      Object.defineProperty(window, marker, {
        value:true,
        configurable:false,
        enumerable:false,
        writable:false
      });
      window.addEventListener('message', (event) => {
        const data = event && event.data;
        if (event.source !== window || !data || typeof data !== 'object') return;
        if (data.source !== 'sproutg-bridge') return;
        if (!['BRIDGE_READY', 'PONG', 'API_RESULT'].includes(data.type)) return;
        bridge.relay(data);
      });
    }
    window.postMessage(${serializeForFrame(message)}, window.location.origin);
    return true;
  })()`;
}

function normalizedEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  } catch (_error) {
    return raw.replace(/\/+$/, '');
  }
}

function parseVersion(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(value, wanted) {
  const left = parseVersion(value);
  const right = parseVersion(wanted);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function isAllowedBridgeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      host === 'script.google.com'
      || host === 'script.googleusercontent.com'
      || host.endsWith('.googleusercontent.com')
    );
  } catch (_error) {
    return false;
  }
}

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
    this.generation = 0;
    this.bridgeNonce = this.createNonce();
    this.bridgeVersion = null;
    this.bridgeAuthenticated = false;
    this.sawModernBridge = false;
    this.challengeId = '';
    this.challengeTimers = [];
    this.frameChallenges = new Map();
    this.bridgeFrame = null;
    this.bridgeFrameKey = '';
    this.writeQueueState = {
      pending: 0,
      inflight: 0,
      retrying: 0,
      blocked: 0,
      blockedEndpoint: 0,
      blockedBackend: 0,
      backendCompatible: false,
      backendVersion: '',
      minimumWriteBackendVersion: '2.3.0',
      oldestAgeMs: 0,
      lastError: '',
      lastAppliedAt: 0
    };
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

    ipcMain.on('sproutg:bridge-message', (event, message) => {
      if (!this.window || this.window.isDestroyed()) return;
      if (event.sender !== this.window.webContents) return;
      if (!isAllowedBridgeUrl(event.senderFrame?.url)) return;
      this.handleMessage(message, event.senderFrame);
    });
  }

  createNonce() {
    return crypto.randomBytes(24).toString('base64url');
  }

  getEndpointKey() {
    return normalizedEndpoint(this.url);
  }

  frameKey(frame) {
    if (!frame) return '';
    const processId = Number(frame.processId);
    const routingId = Number(frame.routingId);
    return Number.isInteger(processId) && Number.isInteger(routingId)
      ? `${processId}:${routingId}`
      : '';
  }

  resetDocumentHandshake(reason = 'Перезагрузка моста Google Таблицы') {
    this.ready = false;
    this.bridgeVersion = null;
    this.bridgeAuthenticated = false;
    this.sawModernBridge = false;
    this.bridgeFrame = null;
    this.bridgeFrameKey = '';
    this.frameChallenges.clear();
    for (const timer of this.challengeTimers) clearTimeout(timer);
    this.challengeTimers = [];
    this.generation += 1;
    this.bridgeNonce = this.createNonce();
    this.challengeId = `challenge-${Date.now()}-${this.generation}`;
    if (this.pending.size) this.rejectAllPending(reason, 'BRIDGE_RECONNECT');
  }

  setWriteQueueState(state) {
    this.writeQueueState = { ...this.writeQueueState, ...(state || {}) };
    this.emit('state', this.getState());
  }

  getState() {
    return {
      ...this.state,
      writeQueue: { ...this.writeQueueState },
      bridgeAuthenticated: this.bridgeAuthenticated,
      metrics: {
        ...this.metrics,
        pending: this.pending.size,
        queued: this.queue.length
      }
    };
  }

  setState(patch) {
    this.state = {
      ...this.state,
      ...(patch || {}),
      ready: this.ready,
      url: this.url,
      ts: Date.now()
    };
    this.emit('state', this.getState());
  }

  load(url) {
    if (this.destroyed) return;
    const previousEndpoint = normalizedEndpoint(this.url);
    const nextEndpoint = normalizedEndpoint(url);
    clearTimeout(this.readyTimer);
    clearTimeout(this.reconnectTimer);
    for (const timer of this.challengeTimers) clearTimeout(timer);
    this.challengeTimers = [];
    if (previousEndpoint && previousEndpoint !== nextEndpoint) {
      this.rejectAllQueued(
        'URL Apps Script изменён до выполнения запроса',
        'BRIDGE_ENDPOINT_CHANGED'
      );
    }
    this.url = url || null;
    this.ready = false;
    this.bridgeVersion = null;
    this.bridgeAuthenticated = false;
    this.sawModernBridge = false;
    this.frameChallenges.clear();
    this.bridgeFrame = null;
    this.bridgeFrameKey = '';
    this.generation += 1;
    this.bridgeNonce = this.createNonce();
    this.challengeId = `challenge-${Date.now()}-${this.generation}`;
    this.rejectAllPending('Переподключение к Google Таблице', 'BRIDGE_RECONNECT');

    if (!this.url) {
      this.setState({
        status: 'missing-url',
        message: 'Не задан URL Apps Script',
        error: null,
        bridgeVersion: null
      });
      return;
    }

    if (this.window) {
      try { this.window.destroy(); } catch (_error) {}
      this.window = null;
    }

    const bridgeWindow = new BrowserWindow({
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

    this.window = bridgeWindow;
    const wc = bridgeWindow.webContents;
    wc.on('did-start-loading', () => {
      if (this.window !== bridgeWindow) return;
      this.setState({
        status: 'connecting',
        message: 'Подключение к Google Таблице',
        error: null
      });
    });
    // Rotate handshake secrets only after a navigation commits. A cancelled
    // did-start-navigation leaves the old document alive and must not orphan it
    // with a nonce the desktop has already forgotten.
    wc.on('did-frame-navigate', (
      _event,
      _url,
      _httpResponseCode,
      _httpStatusText,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      if (this.window !== bridgeWindow) return;
      const navigatedFrameKey = (
        Number.isInteger(Number(frameProcessId))
        && Number.isInteger(Number(frameRoutingId))
      ) ? `${Number(frameProcessId)}:${Number(frameRoutingId)}` : '';
      const isPinnedFrame = !!navigatedFrameKey && navigatedFrameKey === this.bridgeFrameKey;
      if (!isMainFrame && !isPinnedFrame) return;
      this.resetDocumentHandshake();
    });
    wc.on('did-finish-load', () => {
      if (this.window !== bridgeWindow) return;
      this.scheduleBridgeChallenges();
      clearTimeout(this.readyTimer);
      this.readyTimer = setTimeout(() => {
        if (this.window !== bridgeWindow || this.ready) return;
        this.setState({
          status: 'login-required',
          message: 'Нужен вход в Google или доступ к таблице',
          error: null
        });
      }, 5000);
    });
    wc.on('did-fail-load', (
      _event,
      code,
      description,
      _validatedUrl,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      if (this.window !== bridgeWindow) return;
      if (Number(code) === -3) return;
      const failedFrameKey = (
        Number.isInteger(Number(frameProcessId))
        && Number.isInteger(Number(frameRoutingId))
      ) ? `${Number(frameProcessId)}:${Number(frameRoutingId)}` : '';
      const isPinnedFrame = !!failedFrameKey && failedFrameKey === this.bridgeFrameKey;
      if (isMainFrame === false && !isPinnedFrame) return;
      this.ready = false;
      this.setState({
        status: 'error',
        message: 'Не удалось загрузить мост Google Таблицы',
        error: `${code}: ${description}`
      });
      this.scheduleReconnect();
    });
    wc.on('render-process-gone', (_event, details) => {
      if (this.window !== bridgeWindow) return;
      this.ready = false;
      this.rejectAllPending('Мост Google Таблицы остановлен', 'BRIDGE_GONE');
      this.setState({
        status: 'disconnected',
        message: 'Мост Google Таблицы остановлен',
        error: details?.reason || null
      });
      this.scheduleReconnect();
    });
    wc.on('destroyed', () => {
      if (this.window !== bridgeWindow) return;
      this.ready = false;
      this.setState({
        status: 'disconnected',
        message: 'Мост Google Таблицы закрыт'
      });
    });
    bridgeWindow.on('closed', () => {
      if (this.window !== bridgeWindow) return;
      this.window = null;
      this.ready = false;
      this.setState({
        status: 'disconnected',
        message: 'Окно моста закрыто'
      });
    });

    this.setState({
      status: 'connecting',
      message: 'Подключение к Google Таблице',
      error: null,
      bridgeVersion: null
    });
    wc.loadURL(this.url).catch((error) => {
      if (this.window !== bridgeWindow) return;
      this.ready = false;
      this.setState({
        status: 'error',
        message: 'Ошибка загрузки моста Google Таблицы',
        error: error?.message || String(error)
      });
      this.scheduleReconnect();
    });
  }

  reload() {
    if (this.destroyed) return;
    if (this.url) this.load(this.url);
  }

  scheduleReconnect() {
    if (this.destroyed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.destroyed || !this.url) return;
      this.setState({
        status: 'reconnecting',
        message: 'Повторное подключение к Google Таблице',
        error: null
      });
      this.load(this.url);
    }, 1500);
  }

  bridgeFrames() {
    if (this.destroyed || !this.window || this.window.webContents.isDestroyed()) return [];
    try {
      const mainFrame = this.window.webContents.mainFrame;
      const frames = [mainFrame, ...(mainFrame?.framesInSubtree || [])];
      const byKey = new Map();
      for (const frame of frames) {
        const key = this.frameKey(frame);
        if (!key || byKey.has(key) || frame.detached || frame.isDestroyed()) continue;
        if (!isAllowedBridgeUrl(frame.url)) continue;
        byKey.set(key, frame);
      }
      return Array.from(byKey.values());
    } catch (_error) {
      return [];
    }
  }

  sendToFrame(frame, message) {
    if (!frame || frame.detached || frame.isDestroyed()) return false;
    if (typeof frame.executeJavaScript !== 'function') {
      try {
        frame.send('sproutg:bridge-post', message);
        return true;
      } catch (_error) {
        return false;
      }
    }
    try {
      frame.executeJavaScript(buildFramePostScript(message), true)
        .then((sent) => {
          if (sent) return;
          try { frame.send('sproutg:bridge-post', message); } catch (_error) {}
        })
        .catch(() => {
          try { frame.send('sproutg:bridge-post', message); } catch (_error) {}
        });
      return true;
    } catch (_error) {
      return false;
    }
  }

  ensureFrameChallenge(frame) {
    const key = this.frameKey(frame);
    if (!key) return null;
    const existing = this.frameChallenges.get(key);
    if (existing && existing.frame === frame) return existing;
    const challenge = {
      frame,
      key,
      nonce:this.createNonce(),
      id:`challenge-${this.generation}-${crypto.randomBytes(12).toString('base64url')}`
    };
    this.frameChallenges.set(key, challenge);
    return challenge;
  }

  post(message) {
    if (this.destroyed || !this.bridgeFrame || !this.bridgeFrameKey) return false;
    if (this.frameKey(this.bridgeFrame) !== this.bridgeFrameKey) return false;
    return this.sendToFrame(this.bridgeFrame, message);
  }

  sendBridgeChallenge() {
    if (this.destroyed || this.ready) return false;
    let sent = 0;
    for (const frame of this.bridgeFrames()) {
      const challenge = this.ensureFrameChallenge(frame);
      if (!challenge) continue;
      if (this.sendToFrame(frame, {
        source:'sproutg-desktop',
        type:'PING',
        id:challenge.id,
        bridgeNonce:challenge.nonce,
        meta:{ challenge:true, generation:this.generation }
      })) {
        sent += 1;
      }
    }
    return sent > 0;
  }

  scheduleBridgeChallenges() {
    for (const timer of this.challengeTimers) clearTimeout(timer);
    this.challengeTimers = [];
    for (const delay of [0, 180, 500, 1100, 2200, 4000]) {
      const timer = setTimeout(() => this.sendBridgeChallenge(), delay);
      this.challengeTimers.push(timer);
    }
  }

  messageHasValidNonce(message, frame) {
    const key = this.frameKey(frame);
    if (!key || !this.bridgeFrameKey || key !== this.bridgeFrameKey) return false;
    if (!versionAtLeast(this.bridgeVersion, '2.3.0')) return true;
    return (
      message?.authenticated === true
      && !!message?.bridgeNonce
      && message.bridgeNonce === this.bridgeNonce
    );
  }

  handleMessage(message, frame) {
    if (!message || typeof message !== 'object') return;
    const frameKey = this.frameKey(frame);
    if (!frameKey) return;
    if (this.bridgeFrameKey && frameKey !== this.bridgeFrameKey) return;
    const challenge = this.frameChallenges.get(frameKey);

    if (message.type === 'BRIDGE_READY') {
      const advertisedVersion = message.bridgeVersion || null;
      const modern = versionAtLeast(advertisedVersion, '2.3.0');
      if (modern) {
        this.sawModernBridge = true;
        const authenticated = (
          !!challenge
          && message.authenticated === true
          && message.bridgeNonce === challenge.nonce
          && message.challengeId === challenge.id
        );
        if (!authenticated) {
          if (this.ready && !this.bridgeAuthenticated) {
            this.ready = false;
            this.rejectAllPending('Мост требует повторной аутентификации', 'BRIDGE_AUTH_REQUIRED');
          }
          this.sendBridgeChallenge();
          return;
        }
        this.bridgeFrame = frame;
        this.bridgeFrameKey = frameKey;
        this.bridgeNonce = challenge.nonce;
        this.challengeId = challenge.id;
        this.bridgeAuthenticated = true;
      } else {
        if (this.sawModernBridge || this.bridgeAuthenticated) return;
        this.bridgeFrame = frame;
        this.bridgeFrameKey = frameKey;
        this.bridgeNonce = '';
        this.challengeId = '';
        this.bridgeAuthenticated = false;
      }
      this.ready = true;
      this.bridgeVersion = advertisedVersion;
      for (const timer of this.challengeTimers) clearTimeout(timer);
      this.challengeTimers = [];
      this.setState({
        status: 'ready',
        message: 'Google Таблица подключена',
        error: null,
        bridgeVersion: this.bridgeVersion
      });
      this.flushQueue();
      return;
    }

    if (
      message.type === 'PONG'
      && versionAtLeast(message.bridgeVersion, '2.3.0')
      && !!challenge
      && message.id === challenge.id
      && message.authenticated === true
      && message.bridgeNonce === challenge.nonce
    ) {
      this.sawModernBridge = true;
      this.bridgeFrame = frame;
      this.bridgeFrameKey = frameKey;
      this.bridgeNonce = challenge.nonce;
      this.challengeId = challenge.id;
      this.bridgeAuthenticated = true;
      this.bridgeVersion = message.bridgeVersion;
      return;
    }

    if (
      message.type === 'PONG'
      && !!challenge
      && message.id === challenge.id
      && !versionAtLeast(message.bridgeVersion, '2.3.0')
    ) {
      if (this.sawModernBridge || this.bridgeAuthenticated) return;
      this.bridgeFrame = frame;
      this.bridgeFrameKey = frameKey;
      this.bridgeNonce = '';
      this.challengeId = '';
      this.bridgeAuthenticated = false;
      this.bridgeVersion = message.bridgeVersion || null;
      this.ready = true;
      for (const timer of this.challengeTimers) clearTimeout(timer);
      this.challengeTimers = [];
      this.setState({
        status:'ready',
        message:'Google Таблица подключена',
        error:null,
        bridgeVersion:this.bridgeVersion
      });
      this.flushQueue();
      return;
    }

    if (!this.messageHasValidNonce(message, frame)) return;

    if (message.type === 'PONG') {
      this.settle(message.id, {
        ok: true,
        data: {
          pong: true,
          bridgeVersion: message.bridgeVersion,
          ts: message.ts
        }
      });
      return;
    }

    if (message.type === 'API_RESULT') {
      this.settle(message.id, message.result);
    }
  }

  flushQueue() {
    const queuedAtStart = this.queue.length;
    let scanned = 0;
    while (
      this.ready
      && this.pending.size < MAX_INFLIGHT
      && this.queue.length
      && scanned < queuedAtStart
    ) {
      const item = this.queue.shift();
      scanned += 1;
      if (!item || item.settled) continue;
      if (Date.now() >= item.deadlineAt) {
        this.rejectItem(item, 'Google Таблица недоступна', 'BRIDGE_UNAVAILABLE');
        continue;
      }
      if (!this.itemBridgeCompatible(item)) {
        this.queue.push(item);
        continue;
      }
      this.sendRequest(item);
    }
    this.emit('state', this.getState());
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
      queueTimeoutMs: opts.queueTimeoutMs,
      minBridgeVersion: opts.minBridgeVersion,
      retries: opts.retries ?? (isReadAction(action) ? READ_RETRIES : 0)
    });
  }

  batchApi(calls = [], opts = {}) {
    const readOnly = (Array.isArray(calls) ? calls : [])
      .every((call) => isReadAction(call && call.action));
    return this.request({
      type: 'API_BATCH',
      calls,
      timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
      queueTimeoutMs: opts.queueTimeoutMs,
      minBridgeVersion: opts.minBridgeVersion,
      retries: opts.retries ?? (readOnly ? READ_RETRIES : 0)
    });
  }

  ping() {
    return this.request({
      type: 'PING',
      timeoutMs: 10000,
      queueTimeoutMs: 10000,
      retries: 0
    });
  }

  request(req) {
    return new Promise((resolve, reject) => {
      const timeoutMs = Math.max(1000, Number(req.timeoutMs || DEFAULT_TIMEOUT_MS));
      const queueTimeoutMs = Math.max(
        timeoutMs,
        Number(req.queueTimeoutMs || Math.max(30000, timeoutMs * 2))
      );
      const item = {
        ...req,
        requestId: this.nextId(),
        resolve,
        reject,
        attempts: 0,
        timeoutMs,
        createdAt: Date.now(),
        deadlineAt: Date.now() + queueTimeoutMs,
        settled: false,
        queueTimer: null
      };

      if (!this.ready || this.pending.size >= MAX_INFLIGHT) {
        this.enqueueRequest(item);
        if (this.url && (!this.window || this.window.webContents.isDestroyed())) {
          this.load(this.url);
        }
        return;
      }

      this.sendRequest(item);
    });
  }

  enqueueRequest(item, front = false) {
    if (!item || item.settled) return;
    clearTimeout(item.queueTimer);
    const remaining = Math.max(0, item.deadlineAt - Date.now());
    item.queueTimer = setTimeout(() => this.expireQueued(item.requestId), remaining);
    if (front) this.queue.unshift(item);
    else this.queue.push(item);
    this.emit('state', this.getState());
  }

  expireQueued(requestId) {
    const index = this.queue.findIndex((item) => item.requestId === requestId);
    if (index < 0) return;
    const [item] = this.queue.splice(index, 1);
    this.rejectItem(item, 'Google Таблица недоступна', 'BRIDGE_UNAVAILABLE');
    this.flushQueue();
  }

  itemBridgeCompatible(item) {
    const minimum = String(item?.minBridgeVersion || '').trim();
    return !minimum || versionAtLeast(this.bridgeVersion, minimum);
  }

  sendRequest(item) {
    if (!this.ready || this.pending.size >= MAX_INFLIGHT) {
      this.enqueueRequest(item, true);
      return;
    }
    if (!this.itemBridgeCompatible(item)) {
      this.enqueueRequest(item, true);
      return;
    }

    clearTimeout(item.queueTimer);
    item.queueTimer = null;
    const remainingMs = Math.max(0, Number(item.deadlineAt || 0) - Date.now());
    if (remainingMs <= 0) {
      this.rejectItem(item, 'Google Таблица недоступна', 'BRIDGE_UNAVAILABLE');
      this.flushQueue();
      return;
    }
    item.attempts += 1;
    item.startedAt = Date.now();
    const transportId = `${item.requestId}-a${item.attempts}-g${this.generation}`;
    item.transportId = transportId;
    this.metrics.lastAction = item.action || item.type;
    this.metrics.lastStartedAt = item.startedAt;
    this.metrics.pending = this.pending.size + 1;
    this.metrics.queued = this.queue.length;
    const message = {
      source: 'sproutg-desktop',
      type: item.type,
      id: transportId,
      bridgeNonce: this.bridgeNonce,
      meta: {
        requestId: item.requestId,
        attempt: item.attempts
      }
    };
    if (item.type === 'API_CALL') {
      message.action = item.action;
      message.payload = item.payload || {};
    } else if (item.type === 'API_BATCH') {
      message.calls = Array.isArray(item.calls) ? item.calls : [];
    }

    const attemptTimeoutMs = Math.max(
      1,
      Math.min(item.timeoutMs || DEFAULT_TIMEOUT_MS, remainingMs)
    );
    const timer = setTimeout(() => this.timeout(transportId), attemptTimeoutMs);
    this.pending.set(transportId, { ...item, timer });
    this.emit('state', this.getState());

    if (!this.post(message)) {
      clearTimeout(timer);
      this.pending.delete(transportId);
      this.recordMetric({ item, ok: false });
      this.ready = false;
      this.enqueueRequest(item, true);
      this.setState({
        status: 'disconnected',
        message: 'Мост Google Таблицы недоступен',
        error: null
      });
      this.scheduleReconnect();
    }
  }

  timeout(transportId) {
    const item = this.pending.get(transportId);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(transportId);
    this.recordMetric({ item, ok: false, timeout: true });

    if (item.attempts <= item.retries) {
      this.setState({
        status: 'timeout',
        message: 'Google Таблица отвечает медленно, повторяем запрос',
        error: item.action || item.type
      });
      this.enqueueRequest(item, true);
      setTimeout(() => this.flushQueue(), 250);
      return;
    }

    this.rejectItem(
      item,
      'Google Таблица отвечает слишком долго',
      'BRIDGE_TIMEOUT'
    );
    this.flushQueue();
  }

  settle(transportId, result) {
    const item = this.pending.get(transportId);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(transportId);
    this.recordMetric({ item, ok: !(result && result.ok === false) });
    if (!item.settled) {
      item.settled = true;
      item.resolve(result);
    }
    this.flushQueue();
  }

  rejectItem(item, message, code) {
    if (!item || item.settled) return;
    clearTimeout(item.timer);
    clearTimeout(item.queueTimer);
    item.settled = true;
    item.reject(Object.assign(new Error(message), { code }));
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
    this.metrics.maxDurationMs = Math.max(
      Number(this.metrics.maxDurationMs || 0),
      duration
    );
    const prevAvg = Number(this.metrics.avgDurationMs || 0);
    this.metrics.avgDurationMs = this.metrics.total <= 1
      ? duration
      : Math.round((prevAvg * (this.metrics.total - 1) + duration) / this.metrics.total);
    this.metrics.pending = this.pending.size;
    this.metrics.queued = this.queue.length;
    this.emit('state', this.getState());
  }

  rejectAllPending(message, code) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      this.rejectItem(item, message, code);
    }
    this.pending.clear();
    this.flushQueue();
  }

  rejectAllQueued(message, code) {
    const queued = this.queue.splice(0);
    for (const item of queued) this.rejectItem(item, message, code);
  }

  destroy() {
    this.destroyed = true;
    this.ready = false;
    clearTimeout(this.readyTimer);
    clearTimeout(this.reconnectTimer);
    for (const timer of this.challengeTimers) clearTimeout(timer);
    this.challengeTimers = [];
    this.rejectAllPending('Приложение закрывается', 'APP_QUIT');
    this.rejectAllQueued('Приложение закрывается', 'APP_QUIT');
    if (this.window && !this.window.isDestroyed()) {
      try { this.window.destroy(); } catch (_error) {}
    }
    this.window = null;
  }
}

module.exports = {
  BridgeManager,
  MAX_INFLIGHT,
  isAllowedBridgeUrl,
  normalizedEndpoint,
  versionAtLeast
};
