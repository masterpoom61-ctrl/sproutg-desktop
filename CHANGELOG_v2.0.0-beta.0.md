# SproutG Desktop v2.0.0-beta.0

## Fixed

- Fixed bridge readiness detection when Apps Script runs the Web App HTML inside a nested iframe.
- Replaced the hidden bridge `BrowserView` with a hidden `BrowserWindow` using the same `persist:sproutg` session.
- Broadcast desktop API messages into all bridge frames so `API_CALL`, `API_BATCH` and `PING` reach the real Apps Script bridge frame.
- Stopped opening the diagnostic bridge page when the bridge is already ready; clicking the badge now reloads the bridge/UI in that state.
- Cleaned the desktop topbar labels that were showing broken question marks.

## Apps Script

- Updated `apps-script/src/Index.html` bridge version to `2.0.0-beta.0`.
- Bridge now posts `BRIDGE_READY` repeatedly for a short period and sends messages to window, parent, top and opener targets.

## Preserved

- `appId: com.sproutg.desktop`.
- `productName: SproutG`.
- Electron session partition `persist:sproutg`.
- Existing userData/electron-store data, Google session, stats, points and updater flow.
