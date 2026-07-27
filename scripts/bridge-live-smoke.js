const { app, session } = require('electron');
const path = require('path');
const { BridgeManager } = require('../src/main/bridgeManager');

const targetUrl = String(process.env.SPROUTG_BRIDGE_SMOKE_URL || '').trim();
const isolatedUserData = String(process.env.SPROUTG_BRIDGE_SMOKE_USER_DATA || '').trim();
const timeoutMs = Math.max(5000, Number(process.env.SPROUTG_BRIDGE_SMOKE_TIMEOUT_MS || 12000));
const expectedVersion = String(process.env.SPROUTG_BRIDGE_SMOKE_VERSION || '2.3.0').trim();
const apiAction = String(process.env.SPROUTG_BRIDGE_SMOKE_ACTION || '').trim();
const apiPayload = process.env.SPROUTG_BRIDGE_SMOKE_PAYLOAD
  ? JSON.parse(process.env.SPROUTG_BRIDGE_SMOKE_PAYLOAD)
  : {};
const selectedAccounts = new Set(
  String(process.env.SPROUTG_BRIDGE_SMOKE_SELECT_ACCOUNTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

if (!targetUrl || !isolatedUserData) {
  process.stderr.write('Missing isolated bridge smoke configuration\n');
  process.exit(2);
}

app.setPath('userData', isolatedUserData);
app.commandLine.appendSwitch('disable-gpu');

let manager = null;
let finished = false;
let latestState = null;
let apiStarted = false;
let apiObservation = null;
const stateHistory = [];

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return `${url.protocol}//${url.hostname}${url.pathname === '/blank' ? '/blank' : ''}`;
  } catch (_error) {
    return String(value || '');
  }
}

function frameSnapshot() {
  try {
    if (!manager?.window || manager.window.isDestroyed()) return [];
    const mainFrame = manager.window.webContents.mainFrame;
    return [mainFrame, ...(mainFrame?.framesInSubtree || [])].map((frame) => ({
      key: manager.frameKey(frame),
      url: safeUrl(frame.url),
      parentUrl: safeUrl(frame.parent?.url),
      allowedByCurrentFilter: manager.bridgeFrames().some((candidate) => (
        manager.frameKey(candidate) === manager.frameKey(frame)
      ))
    }));
  } catch (error) {
    return [{ error:error?.message || String(error) }];
  }
}

function projectApiResult(result) {
  if (!selectedAccounts.size || apiAction !== 'mcc.profile') return result;
  const data = result?.data && typeof result.data === 'object' ? result.data : {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return {
    ...result,
    data: {
      profileName:data.profileName,
      rows:rows
        .filter((row) => selectedAccounts.has(String(row?.accountName || '').trim()))
        .map((row) => ({
          row:row.row,
          accountName:row.accountName,
          N:row?.values?.N,
          U:row?.values?.U
        }))
    }
  };
}

function finish(reason, exitCode) {
  if (finished) return;
  finished = true;
  const result = {
    reason,
    state: latestState && {
      status: latestState.status,
      ready: latestState.ready,
      bridgeVersion: latestState.bridgeVersion,
      bridgeAuthenticated: latestState.bridgeAuthenticated,
      message: latestState.message,
      error: latestState.error
    },
    api: apiObservation,
    stateHistory,
    frames: frameSnapshot()
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  try { manager?.destroy(); } catch (_error) {}
  setTimeout(() => app.exit(exitCode), 50);
}

app.whenReady().then(() => {
  const partition = 'persist:sproutg';
  manager = new BridgeManager({
    getSession: () => session.fromPartition(partition),
    partition,
    appDir: path.join(__dirname, '..', 'src')
  });
  manager.on('state', (state) => {
    latestState = state;
    const summary = `${state.status}:${state.bridgeVersion || '-'}:${state.bridgeAuthenticated ? 'auth' : 'noauth'}`;
    if (stateHistory[stateHistory.length - 1] !== summary) stateHistory.push(summary);
    if (
      state.ready
      && state.bridgeVersion === expectedVersion
      && state.bridgeAuthenticated
      && !apiStarted
    ) {
      if (!apiAction) {
        apiStarted = true;
        setTimeout(() => finish('ready', 0), 300);
        return;
      }
      apiStarted = true;
      const startedAt = Date.now();
      manager.callApi(apiAction, apiPayload, {
        timeoutMs:Math.max(1000, timeoutMs - 1000),
        queueTimeoutMs:timeoutMs,
        retries:0,
        minBridgeVersion:expectedVersion
      }).then((result) => {
        apiObservation = {
          action:apiAction,
          durationMs:Date.now() - startedAt,
          result:projectApiResult(result)
        };
        finish('api-result', 0);
      }).catch((error) => {
        apiObservation = {
          action:apiAction,
          durationMs:Date.now() - startedAt,
          error:error?.message || String(error),
          code:error?.code || ''
        };
        finish('api-error', 1);
      });
    }
  });
  manager.load(targetUrl);
  setTimeout(() => finish('timeout', 1), timeoutMs);
}).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(2);
});
