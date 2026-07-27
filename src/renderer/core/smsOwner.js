(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SproutgSmsOwner = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function profileName(value) {
    return String(value?.profileName || "").trim();
  }

  function resolveOrderOwner(order, response) {
    const candidates = [
      profileName(order?.ownerIdentity),
      profileName(order?.owner),
      profileName(response?.ownerIdentity),
      profileName(response?.owner)
    ].filter(Boolean);
    const unique = Array.from(new Set(candidates));
    return unique.length === 1 ? { profileName:unique[0] } : null;
  }

  function normalizeOwnedOrder(order, response) {
    if (!order || typeof order !== "object") return null;
    const ownerIdentity = resolveOrderOwner(order, response);
    if (!ownerIdentity) return null;
    return {
      ...order,
      ownerIdentity
    };
  }

  return {
    normalizeOwnedOrder,
    resolveOrderOwner
  };
});
