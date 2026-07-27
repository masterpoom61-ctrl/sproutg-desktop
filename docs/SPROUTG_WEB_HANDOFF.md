# SproutG.Web Handoff

Target project: the sibling `FarmA/apps-script` repository.

SproutG.Web is the Apps Script backend and hidden Google Sheets bridge used by
SproutG Desktop. The desktop and deployed bridge versions must remain
compatible.

## v2.3.0 Contract

- Desktop version: `2.3.0`.
- Apps Script `APP_VERSION`: `2.3.0`.
- `Index.html` bridge version: `2.3.0`.
- Desktop refuses to flush queued sheet mutations to a bridge older than
  `2.3.0`.
- Apps Script must expose:
  - `apiCall(action, payload, meta)`
  - `apiBatch(calls, meta)`
- The bridge must post `BRIDGE_READY`, `API_RESULT`, and `PONG`.
- Request source: `sproutg-desktop`; response source: `sproutg-bridge`.

## Non-negotiable Data Rules

- Never delete or rewrite the CM2 section in `Code.gs`. CM2 is an independent
  in-sheet Company/MCC synchronization script and remains production code.
- Every O1/MCC write must resolve its stable semantic identity immediately
  before mutation. A cached or UI row number is only a hint because users may
  insert rows anywhere.
- Ambiguous, missing, moved, or uncertain targets must fail closed. Never fall
  back to writing the original numeric row.
- Keep replay ledgers and write IDs for operations whose acknowledgement may be
  lost after the sheet was already changed.
- Keep SMS provider keys only in Apps Script `ScriptProperties` or the native
  desktop main process. Never expose them to a renderer or commit them.

## Release Order

1. Rotate any historically exposed SMSPool credential.
2. Set and verify a fresh `SMSPOOL_API_KEY` in Apps Script
   `ScriptProperties`.
3. Review the existing dirty FarmA worktree, especially any deleted files.
4. Push the intended Apps Script sources and deploy a new Web App version.
5. Open the deploy URL and verify bridge version `2.3.0`.
6. Start/update SproutG Desktop and verify the durable queue begins draining.

Publishing the desktop first is safe: v2.3.0 keeps writes on disk while the
deployed Apps Script bridge is older than `2.3.0`.

## Manual Verification

- Insert rows above active O1, MCC, PASS, and Company records, then confirm
  writes follow the exact identity rather than the old row number.
- Verify duplicate identities stop a write with an explicit error.
- Verify Company append does not use a row containing data or a formula outside
  columns A:F.
- Verify O1/MCC/PASS edits survive reload through local drafts and the durable
  queue.
- Verify Company add and SMS provider calls still resolve through
  `apiCall`/`apiBatch`.
- Verify CM2 Company/MCC synchronization still runs inside the spreadsheet.

## Repository Safety

FarmA can contain unrelated dirty and untracked files. Do not revert, stage, or
publish them without reviewing the exact diff. Apps Script deployment remains a
separate manual operation from the SproutG Desktop GitHub release.
