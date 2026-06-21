# SproutG v2.0.1-beta.0

## Desktop

- Fixed mojibake in local UI strings so Russian text renders normally.
- Reworked the topbar buttons into compact icon-only controls with Russian tooltips.
- Replaced the old table badge text with compact `Статус:` and a status mark/spinner.
- Improved light theme contrast across panels, inputs, buttons and badges.
- Shifted Light OldMoney toward a green old-money palette.
- Added guarded theme switching to avoid flicker/desync during rapid theme changes.
- Fixed the settings topbar button so an already-open settings window closes instead of reopening.
- Removed the obsolete embedded settings page from the main renderer.
- Kept updates manual-only from Settings; startup checks only show notifications.

## SproutG.Web

- Renamed the Apps Script bridge title/status to `SproutG.Web`.
- Updated bridge/API version to `2.0.1-beta.0`.
- Kept Apps Script as the API bridge only; the desktop UI remains local.
