"use strict";

const HERO_SMS_STATE_MUTATIONS = new Set([
  "Catalog",
  "Order",
  "Check",
  "Refund",
  "GetState",
  "setApiKey"
]);

function isHeroSmsStateMutation(action) {
  return HERO_SMS_STATE_MUTATIONS.has(String(action || ""));
}

module.exports = {
  HERO_SMS_STATE_MUTATIONS,
  isHeroSmsStateMutation
};
