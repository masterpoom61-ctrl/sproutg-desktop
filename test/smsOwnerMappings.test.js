"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { LEGACY_TO_ACTION } = require("../src/shared/actions");
const {
  normalizeOwnedOrder,
  resolveOrderOwner
} = require("../src/renderer/core/smsOwner");
const {
  isHeroSmsStateMutation
} = require("../src/main/heroSmsMutationPolicy");

const ownerOptions = {
  country:"7",
  ownerIdentity:{ profileName:"  Profile P  " }
};

test("legacy SMSPool calls retain captured owner options for every owner-bound action", () => {
  assert.deepEqual(
    LEGACY_TO_ACTION.smsPoolOrderO1.payload([ownerOptions]),
    {
      country:"7",
      ownerIdentity:{ profileName:"Profile P" }
    }
  );
  assert.deepEqual(
    LEGACY_TO_ACTION.smsPoolCheckO1.payload(["order-1", ownerOptions]),
    {
      country:"7",
      ownerIdentity:{ profileName:"Profile P" },
      orderId:"order-1"
    }
  );
  assert.deepEqual(
    LEGACY_TO_ACTION.smsPoolRefundO1.payload(["order-1", ownerOptions]),
    {
      country:"7",
      ownerIdentity:{ profileName:"Profile P" },
      orderId:"order-1"
    }
  );
  assert.deepEqual(
    LEGACY_TO_ACTION.smsPoolGetStateO1.payload([ownerOptions]),
    {
      country:"7",
      ownerIdentity:{ profileName:"Profile P" }
    }
  );
});

test("legacy lower-case SMSPool aliases preserve the same owner contract", () => {
  assert.equal(
    LEGACY_TO_ACTION.smspoolOrderO1,
    LEGACY_TO_ACTION.smsPoolOrderO1
  );
  assert.equal(
    LEGACY_TO_ACTION.smspoolCheckO1,
    LEGACY_TO_ACTION.smsPoolCheckO1
  );
});

test("browser API legacy and direct SMS functions accept owner options", () => {
  const api = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "core", "api.js"),
    "utf8"
  );
  assert.match(api, /smsPoolOrderO1:\s*smsPoolOrderSpec/);
  assert.match(api, /smsPoolCheckO1:\s*smsPoolCheckSpec/);
  assert.match(api, /smsPoolRefundO1:\s*smsPoolRefundSpec/);
  assert.match(api, /smsPoolGetStateO1:\s*smsPoolStateSpec/);
  assert.match(api, /smsPoolOrderO1:\s*\(options\)\s*=>/);
  assert.match(api, /smsPoolCheckO1:\s*\(orderId,\s*options\)\s*=>/);
  assert.match(api, /smsPoolRefundO1:\s*\(orderId,\s*options\)\s*=>/);
  assert.match(api, /smsPoolGetStateO1:\s*\(options\)\s*=>/);
});

test("SMS order responses require one exact, non-conflicting owner", () => {
  assert.deepEqual(
    resolveOrderOwner(
      { id:"1", ownerIdentity:{ profileName:"Profile P" } },
      { ownerIdentity:{ profileName:"Profile P" } }
    ),
    { profileName:"Profile P" }
  );
  assert.equal(
    resolveOrderOwner(
      { ownerIdentity:{ profileName:"Profile P" } },
      { ownerIdentity:{ profileName:"profile p" } }
    ),
    null
  );
  assert.equal(normalizeOwnedOrder({ id:"1" }, {}), null);
  assert.deepEqual(
    normalizeOwnedOrder(
      { id:"1" },
      { ownerIdentity:{ profileName:"Profile P" } }
    ),
    { id:"1", ownerIdentity:{ profileName:"Profile P" } }
  );
});

test("every native HeroSMS action that reads or changes provider state is serialized as a mutation", () => {
  for (const action of ["Catalog", "Order", "Check", "Refund", "GetState", "setApiKey"]) {
    assert.equal(isHeroSmsStateMutation(action), true, action);
  }
  assert.equal(isHeroSmsStateMutation("getApiKey"), false);
  assert.equal(isHeroSmsStateMutation("Balance"), false);

  const api = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "app.js"),
    "utf8"
  );
  assert.match(
    api,
    /\['Catalog',\s*'Order',\s*'Check',\s*'Refund',\s*'GetState'\]/
  );
});
