"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("renderer hands writes to the durable main queue without waiting for reads", () => {
  const renderer = source("src/renderer/app.js");
  assert.match(renderer, /function enqueueWrite_[\s\S]{0,320}const job = new Promise\(run\)/);
  assert.doesNotMatch(
    renderer,
    /waitForPriorityReads_\(\)[\s\S]{0,160}new Promise\(run\)/
  );
  assert.match(renderer, /superseding value enqueued immediately/);
  assert.match(renderer, /superseding BS value enqueued immediately/);
});

test("semantic edit drafts are bounded, synchronous, identity-keyed, and ACK-cleared", () => {
  const renderer = source("src/renderer/app.js");
  assert.match(renderer, /EDIT_DRAFT_MAX_RECORDS\s*=\s*300/);
  assert.match(renderer, /EDIT_DRAFT_MAX_BYTES\s*=\s*512 \* 1024/);
  assert.match(renderer, /localStorage\.setItem\(EDIT_DRAFTS_KEY,\s*serialized\)/);
  assert.match(renderer, /bindRenderedO1EditDrafts_\(res\)/);
  assert.match(renderer, /bindRenderedMccEditDrafts_\(mccProfile\)/);
  assert.match(renderer, /editDraftDescriptor_\(\s*'PASS',\s*\[String\(item\.value/);
  assert.match(renderer, /editDraftDescriptor_\(\s*'MCC_RENAME'/);
  assert.match(renderer, /for\(const candidate of document\.querySelectorAll\('\[data-edit-draft-key\]'\)\)/);
  assert.match(renderer, /semanticDraftsAtRisk[\s\S]{0,180}_editDrafts\.size/);
  assert.match(renderer, /EDIT_DRAFTS_KEY}:quarantine:/);
  assert.match(renderer, /_editDraftIntegrityBlocked = true/);
  assert.match(renderer, /const semanticDraftIntegrityRisk = _editDraftIntegrityBlocked \? 1 : 0/);
  assert.match(renderer, /\+ semanticDraftIntegrityRisk/);
  assert.match(
    renderer,
    /#out input\[data-row\]\[data-col\]:is\(\[type="text"\],\[type="date"\]\)/
  );
  assert.match(
    renderer,
    /#mccOut input\[data-row\]\[data-col\]:is\(\[type="text"\],\[type="date"\]\)/
  );
});

test("corrupt renderer journals are quarantined and counted instead of overwritten", () => {
  const renderer = source("src/renderer/app.js");
  const api = source("src/renderer/core/api.js");
  const company = source("src/company/company.js");
  assert.match(renderer, /FAILED_DRAFTS_KEY}:quarantine:/);
  assert.match(renderer, /const failedDraftIntegrityRisk =/);
  assert.match(renderer, /\+ failedDraftIntegrityRisk/);
  assert.match(api, /DURABLE_FAILURES_KEY}:quarantine:/);
  assert.match(api, /durableFailureIntegrityBlocked[\s\S]{0,500}return false/);
  assert.match(api, /__sproutgDurableFailurePending = durableFailures\.size \+ risk/);
  assert.match(company, /COMPANY_DRAFT_KEY}:quarantine:/);
  assert.match(company, /companyDraftIntegrityBlocked[\s\S]{0,500}return false/);
  assert.match(renderer, /COMPANY_INLINE_DRAFT_KEY}:quarantine:/);
  assert.match(
    renderer,
    /_companyInlineDraftIntegrityBlocked[\s\S]{0,900}return false/
  );
  assert.match(
    renderer,
    /localStorage\.getItem\(COMPANY_INLINE_DRAFT_KEY\) !== serialized/
  );
  assert.match(renderer, /readCompanyInlineDraft_\(\);/);
  assert.match(renderer, /\+ companyInlineDraftIntegrityRisk/);
});

test("MCC reads retain overlays and cannot revive a pre-rename identity", () => {
  const renderer = source("src/renderer/app.js");
  assert.match(
    renderer,
    /function mccSearch[\s\S]{0,1300}mergeMccLocalValues_\(payload\);[\s\S]{0,100}cacheMccProfile\(payload\);[\s\S]{0,180}mccProfile = payload/
  );
  assert.match(
    renderer,
    /function mccSyncProfile[\s\S]{0,500}requestProfileName[\s\S]{0,900}requestWriteRevision !== _mccWriteRevision[\s\S]{0,300}mccReadBlockedByRename_\(requestProfileName\)/
  );
  assert.match(
    renderer,
    /_mccPendingRenamesByOld\.set\(oldProfileName,\s*renameAttempt\);[\s\S]{0,100}_mccWriteRevision \+= 1/
  );
  assert.match(
    renderer,
    /action === 'mcc\.updateProfileName'[\s\S]{0,300}confirmation\?\.target\?\.profileName[\s\S]{0,300}scheduleMccConfirmedRefresh_\(nextProfileName\)/
  );
});

test("PASS catalog refresh waits for the newest causal write confirmation", () => {
  const renderer = source("src/renderer/app.js");
  assert.match(
    renderer,
    /action\.startsWith\('pass\.'\)[\s\S]{0,180}if\(_passAwaitingConfirmations\.size\)[\s\S]{0,260}setTimeout/
  );
  assert.match(
    renderer,
    /setTimeout\(\(\)=>\{[\s\S]{0,100}if\(_passAwaitingConfirmations\.size\)[\s\S]{0,220}syncPassCatalog\(\{ force:true, confirmed:true \}\)/
  );
  assert.match(
    renderer,
    /\} else if\(!_passAwaitingConfirmations\.size\) \{[\s\S]{0,100}syncPassCatalog\(\{ force:true, confirmed:true \}\)/
  );
});

test("MCC rapid revert clears the canceled optimistic overlay", () => {
  const renderer = source("src/renderer/app.js");
  assert.match(
    renderer,
    /function tryCollapseMccSingleWrite_[\s\S]{0,1300}rememberMccLocalValues_\(context,\s*\{ \[col\]: committed \}\);[\s\S]{0,180}retireMccLocalValues_\(context,\s*\[col\],\s*\{ refresh:false \}\)/
  );
});

test("SMS state and native HeroSMS mutations carry an exact profile owner", () => {
  const renderer = source("src/renderer/app.js");
  const main = source("src/main.js");
  assert.match(renderer, /ownerIdentity:\{\s*profileName:context\.profileName\s*\}/);
  assert.match(renderer, /incomingOrder\.ownerIdentity\?\.profileName/);
  assert.match(renderer, /if\(!isSmsProfileContextActive_\(context\)\) return;/);
  assert.match(main, /ownerIdentity:normalizeHeroSmsOwnerIdentity\(intent\.ownerIdentity\)/);
  assert.match(main, /heroSms\.refundIntent/);
  assert.match(main, /reconcileHeroSmsRefundIntent/);
  assert.match(main, /HERO_SMS_OWNER_MISMATCH/);
});

test("stale direct callbacks update captured models, not a newly selected profile", () => {
  const renderer = source("src/renderer/app.js");
  assert.match(renderer, /function toggleDeleted\(\)[\s\S]{0,420}const targetProfile = current/);
  assert.match(renderer, /function mccToggleDeleted\(\)[\s\S]{0,420}const targetProfile = mccProfile/);
  assert.match(renderer, /function migrateMccProfileIdentity_/);
  assert.match(renderer, /mccProfileTabMap\.delete\(oldKey\)/);
  assert.match(renderer, /mccProfileCache\.delete\(oldKey\)/);
});

test("sheet and desktop notice labels are inserted as text, not dynamic HTML", () => {
  const renderer = source("src/renderer/app.js");
  const api = source("src/renderer/core/api.js");
  assert.doesNotMatch(renderer, /head\.innerHTML\s*=\s*`<b>[^`]*\$\{rowObj\.accountName/);
  assert.doesNotMatch(renderer, /head\.innerHTML\s*=\s*`<b>[^`]*\$\{profile\?\.profileName/);
  assert.match(renderer, /headTitle\.textContent\s*=\s*`Апелляция • \$\{rowObj\.accountName/);
  assert.match(renderer, /headTitle\.textContent\s*=\s*`Апелляция • \$\{profile\?\.profileName/);
  assert.doesNotMatch(api, /box\.innerHTML\s*=\s*`<b>\$\{payload\?\.title/);
  assert.match(api, /title\.textContent = String\(payload\?\.title/);
  assert.match(api, /body\.textContent = String\(payload\?\.body/);
});
