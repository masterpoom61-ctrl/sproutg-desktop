# SproutG Desktop v1.4.0

## Main Changes

- Ported the main SproutG UI from Apps Script legacy HTML into local Electron renderer files.
- Replaced the visible Apps Script wrapper with a local desktop interface.
- Added hidden Apps Script bridge transport over `postMessage`.
- Added main-process API request manager with:
  - `callApi(action, payload)`;
  - `batchApi(calls)`;
  - queueing until `BRIDGE_READY`;
  - timeout handling;
  - bridge reconnect;
  - retry for read actions.
- Added renderer API client and compatibility adapter for the existing O1/MCC/Company/SMSPool UI calls.

## Preserved

- `appId: com.sproutg.desktop`.
- `productName: SproutG`.
- Electron session partition `persist:sproutg`.
- Stored `web.url`, settings, window bounds, points, workDays, statusState and stats.
- Clear cache/logout behavior.
- Settings window, stats window, topbar, zoom, always-on-top and theme sync.
- GitHub Releases auto-update flow and `latest.yml` publishing through electron-builder.

## Apps Script Role

Apps Script remains responsible for Google Sheets reads/writes, cache/version invalidation, LockService-protected writes, ScriptProperties and SMSPool API calls. The desktop app owns UI rendering, tabs, filters, local state, save feedback and bridge request management.
