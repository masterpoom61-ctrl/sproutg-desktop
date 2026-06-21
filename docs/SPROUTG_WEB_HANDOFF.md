# SproutG.Web Handoff

Target project: `C:\Users\Poom\Documents\GitHub\FarmA`

SproutG.Web is the Apps Script side of SproutG. Desktop SproutG renders the UI locally and uses SproutG.Web only as the hidden bridge/API to Google Sheets and server-side services.

## Current Desktop Expectations

- App name in Apps Script: `SproutG.Web`.
- Desktop app name: `SproutG`.
- Versions should stay synchronized with desktop releases.
- Current desktop version: `2.0.1-beta.1`.
- Apps Script visible UI should not be the main user interface anymore.
- Apps Script must keep exposing bridge methods:
  - `apiCall(action, payload, meta)`
  - `apiBatch(calls, meta)`
- Bridge page must post:
  - `BRIDGE_READY`
  - `API_RESULT`
  - `PONG`
- Bridge source names expected by desktop:
  - request source: `sproutg-desktop`
  - response source: `sproutg-bridge`

## Required SproutG.Web Changes

- Bump `APP_VERSION` and bridge version to `2.0.1-beta.1`.
- Keep the default `Index.html` as a small bridge-only page.
- Keep old UI only behind `?legacy=1` if it is still needed for fallback/debug.
- Remove or archive obsolete Apps Script UI code that is no longer used by desktop.
- Keep SMSPool keys and other secrets only in Apps Script/ScriptProperties, never in desktop renderer.
- Keep all bridge-visible text Russian where it can appear to the user.
- Ensure Apps Script deploy is updated after code changes, otherwise desktop may still connect to an older bridge.

## Already Applied Locally In FarmA During This Work

- `apps-script/src/Code.gs`
  - added `APP_NAME = 'SproutG.Web'`;
  - changed title to `SproutG.Web`;
  - changed `APP_VERSION` from old `0.4.5.5` to beta version.
- `apps-script/src/Index.html`
  - bridge page status changed to `SproutG.Web: мост готов`;
  - bridge failure text changed to Russian;
  - bridge version changed to beta version.
- `apps-script/src/LegacyIndex.html`
  - legacy visible version changed to beta version.
- `docs/APPS_SCRIPT_BRIDGE_API.md`
  - renamed bridge documentation to `SproutG.Web`.

## Manual Checks In FarmA

- Deploy Apps Script as a new Web App version.
- Open deploy URL directly and verify it shows only the small bridge status page.
- Verify desktop status changes to `Статус: ✓`.
- Verify O1 search, MCC search, Company add and SMSPool calls still resolve through `apiCall` / `apiBatch`.
- Verify Google authorization is requested only when the Apps Script deploy or browser session actually needs it.

## Notes For The Next Codex Pass In FarmA

- FarmA currently has unrelated dirty files and untracked files. Do not revert them without explicit permission.
- Before committing FarmA, inspect:
  - `apps-script/src/Code.gs`
  - `apps-script/src/Index.html`
  - `apps-script/src/LegacyIndex.html`
  - `docs/APPS_SCRIPT_BRIDGE_API.md`
- Avoid touching desktop UI code in FarmA unless `?legacy=1` fallback is intentionally being kept.
