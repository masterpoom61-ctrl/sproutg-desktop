const { app, session } = require('electron');
const path = require('path');
const { BridgeManager } = require('../src/main/bridgeManager');

const targetUrl = String(process.env.SPROUTG_BRIDGE_SMOKE_URL || '').trim();
const isolatedUserData = String(process.env.SPROUTG_BRIDGE_SMOKE_USER_DATA || '').trim();
const timeoutMs = Math.max(5000, Number(process.env.SPROUTG_BRIDGE_SMOKE_TIMEOUT_MS || 12000));
const expectedVersion = String(process.env.SPROUTG_BRIDGE_SMOKE_VERSION || '2.3.0').trim();

if (!targetUrl || !isolatedUserData) {
  process.stderr.write('Missing isolated bridge smoke configuration\n');
  process.exit(2);
}

app.setPath('userData', isolatedUserData);
app.commandLine.appendSwitch('disable-gpu');

let manager = null;
let finished = false;
let latestState = null;
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
    if (state.ready && state.bridgeVersion === expectedVersion && state.bridgeAuthenticated) {
      setTimeout(() => finish('ready', 0), 300);
    }
  });
  manager.load(targetUrl);
  setTimeout(() => finish('timeout', 1), timeoutMs);
}).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(2);
});
