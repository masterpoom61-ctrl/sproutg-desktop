# SproutG v2.0.1-beta.1

Electron desktop app for SproutG. The main SproutG interface is rendered locally, while Apps Script is used as `SproutG.Web`: a hidden bridge/API layer for Google Sheets, ScriptProperties, CacheService, LockService and SMSPool.

## What Changed In v2.0.1-beta.1

- Added a Home icon button in the topbar to return to the O1/MCC start screen.
- Prevented the Company page from being saved as the next startup page.
- Added hover/active feedback for topbar icon buttons and window controls.
- Added themed gradient backgrounds for all desktop themes.
- Fixed app shutdown so the close button stops hidden bridge/windows and exits Electron instead of leaving duplicate processes in Task Manager.
- Added a SproutG.Web handoff summary for the Apps Script project.

## What Changed In v2.0.1-beta.0

- Fixed broken Russian glyphs in the local renderer and settings UI.
- Reworked the topbar into compact icon buttons for companies, statistics and settings.
- Changed the Google Sheets badge to compact Russian `Статус:` with a check mark or loading spinner.
- Improved Light Classic, Dark IOS and Light OldMoney contrast; Light OldMoney now uses a greener palette.
- Added theme-switch guards to prevent flicker when themes are changed quickly.
- Fixed the settings button so clicking it while the settings window is open closes the window instead of reopening it.
- Removed the obsolete embedded settings page from the main renderer.
- Synchronized desktop `SproutG` and Apps Script `SproutG.Web` versions.

## What Changed In v2.0.0-beta.1

- Russian topbar and Google Sheet connection status.
- `Компании` moved to the topbar; internal page switchers now keep only O1/MCC.
- Added four theme ids: Dark Classic, Light Classic, Dark IOS, Light OldMoney.
- Moved UI/bridge reload into Settings.
- Added visible sync/loading indicator for bridge requests.
- Startup update check is notification-only and runs at most once per Windows boot.
- Removed obsolete wrapper renderer files and old BrowserView helpers.

## What Changed In v2.0.0-beta.0

- Fixed Apps Script bridge transport for Web App iframe/subframe rendering.
- Replaced the hidden detached `BrowserView` bridge with a hidden `BrowserWindow`.
- Bridge API messages are now broadcast into nested frames, which fixes stuck O1/MCC searches when desktop waits forever for `BRIDGE_READY`.
- The topbar labels were cleaned up to avoid broken glyphs in the local shell.

## What Changed In v1.4.0

- The main window no longer loads the Apps Script `/exec` UI as the visible application.
- The O1/MCC/Settings/Company UI was ported from the legacy Apps Script interface into local renderer files.
- A hidden bridge webContents keeps using the same Electron session partition: `persist:sproutg`.
- Renderer calls main process through IPC; main talks to Apps Script through `API_CALL` / `API_BATCH` postMessage transport.
- Added request queueing until `BRIDGE_READY`, request timeouts, bridge reconnect, and read-operation retry.
- Preserved local settings, stats, points, status state, stored web URL, window bounds, Google session and GitHub auto-update.

## Development

```bash
npm install
npm start
```

On first launch, paste the Apps Script Web App deploy URL or deploy ID. The stored value remains in `electron-store` under `web.url`.

## Windows Build

```bash
npm install
npm run dist:win
```

## Release With GitHub Auto-Update

The release workflow is still triggered by tags matching `v*.*.*`.

```bash
git add .
git commit -m "Release SproutG v2.0.1-beta.1"
git tag v2.0.1-beta.1
git push origin main
git push origin v2.0.1-beta.1
```

GitHub Actions runs `npm run dist:win:publish`. `electron-builder` publishes the installer and `latest.yml` to GitHub Releases.

## Compatibility Notes

- `appId` remains `com.sproutg.desktop`.
- `productName` remains `SproutG`.
- `persist:sproutg` remains unchanged to preserve Google login/session.
- NSIS keeps `deleteAppDataOnUninstall: false`.
- Do not reset `electron-store` or app `userData` during updates.
