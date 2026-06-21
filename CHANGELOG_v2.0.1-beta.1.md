# SproutG v2.0.1-beta.1

## Desktop

- Added a topbar Home button that opens the O1/MCC start screen from any section.
- Company is no longer persisted as the startup page, so the app will not reopen locked to Company.
- Added hover and active feedback for topbar icon buttons, the status badge and window controls.
- Added matching gradient backgrounds for Dark Classic, Light Classic, Dark IOS and Light OldMoney.
- Added a controlled shutdown path for the close button:
  - destroys settings, stats, URL and login windows;
  - destroys the hidden SproutG.Web bridge window;
  - clears bridge reconnect timers and pending requests;
  - exits Electron so duplicate processes do not remain in Task Manager.

## SproutG.Web

- Added `docs/SPROUTG_WEB_HANDOFF.md` with a compact summary for the Apps Script project.
